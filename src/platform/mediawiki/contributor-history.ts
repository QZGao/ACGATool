/**
 * @file src/platform/mediawiki/contributor-history.ts
 * Purpose: src / platform / mediawiki / contributor history module.
 *
 * Table of contents:
 * 1. Imports
 * 2. record
 * 3. queryPages
 * 4. pageRevisions
 * 5. revisionSize
 * 6. contributionRevision
 * 7. getLargestContributorLastYear
 */

import {
    largestContributor,
    type ContributionRevision,
} from "../../domain/contributors.ts";
import type { ApiClient } from "./api.ts";

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("MediaWiki returned no readable revision history");
    return value as Record<string, unknown>;
}

function queryPages(value: unknown): Record<string, unknown>[] {
    const response = record(value);
    const query = record(response.query);
    if (response.error || !Array.isArray(query.pages))
        throw new Error("MediaWiki returned no readable revision history");
    return query.pages.map(record);
}

function pageRevisions(
    page: Record<string, unknown>,
): Record<string, unknown>[] {
    if (page.revisions === undefined) return [];
    if (!Array.isArray(page.revisions))
        throw new Error("MediaWiki returned invalid revisions");
    return page.revisions.map(record);
}

function revisionSize(revision: Record<string, unknown>) {
    const { revid, size } = revision;
    if (typeof revid !== "number" || !Number.isSafeInteger(revid) || revid < 1)
        throw new Error("Revision IDs are unavailable");
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0)
        throw new Error("Revision size is unavailable");
    return { revid, size };
}

function contributionRevision(
    value: Record<string, unknown>,
): ContributionRevision {
    const { revid, size } = revisionSize(value);
    const { parentid, timestamp, user } = value;
    if (
        typeof parentid !== "number" ||
        !Number.isSafeInteger(parentid) ||
        parentid < 0
    )
        throw new Error("Revision IDs are unavailable");
    if (typeof timestamp !== "string")
        throw new Error("Revision timestamp is unavailable");
    return {
        revid,
        parentid,
        timestamp,
        size,
        ...(typeof user === "string" ? { user } : {}),
        ...(Object.prototype.hasOwnProperty.call(value, "userhidden")
            ? { userhidden: value.userhidden }
            : {}),
    };
}

/** Only reads revision metadata; history and parent baselines are fully paginated. */
export async function getLargestContributorLastYear(
    api: ApiClient,
    pageName: string,
    now: Date,
): Promise<string | null> {
    if (!pageName.trim()) return null;
    const until = new Date(now);
    const since = new Date(until);
    since.setUTCFullYear(since.getUTCFullYear() - 1);
    if (since.getUTCMonth() !== until.getUTCMonth()) since.setUTCDate(0);
    const parameters = {
        action: "query",
        formatversion: 2,
        titles: pageName,
        prop: "revisions",
        rvprop: "ids|timestamp|user|size",
        rvdir: "newer",
        rvstart: since.toISOString(),
        rvend: until.toISOString(),
        rvlimit: "max",
    };
    const revisions: ContributionRevision[] = [];
    let continuation: Record<string, string> = {};
    const seenContinuations = new Set<string>();
    for (;;) {
        const response = record(
            await api.get({ ...parameters, ...continuation }),
        );
        const pages = queryPages(response);
        if (pages.length !== 1)
            throw new Error("MediaWiki returned an ambiguous article history");
        const page = pages[0];
        if (Object.prototype.hasOwnProperty.call(page, "missing")) return null;
        if (Object.prototype.hasOwnProperty.call(page, "invalid"))
            throw new Error("MediaWiki returned an invalid article title");
        revisions.push(...pageRevisions(page).map(contributionRevision));
        const nextContinuation =
            response.continue === undefined ? {} : record(response.continue);
        const next = nextContinuation.rvcontinue;
        if (next === undefined) break;
        if (typeof next !== "string" || seenContinuations.has(next))
            throw new Error("MediaWiki revision continuation did not advance");
        seenContinuations.add(next);
        continuation = { rvcontinue: next };
        if (typeof nextContinuation.continue === "string")
            continuation.continue = nextContinuation.continue;
    }
    if (revisions.length === 0) return null;
    const revisionIds = new Set(revisions.map((revision) => revision.revid));
    const parentIds = [
        ...new Set(revisions.map((revision) => revision.parentid)),
    ].filter((id) => id !== 0 && !revisionIds.has(id));
    const parentSizes = new Map<number, number>();
    for (let offset = 0; offset < parentIds.length; offset += 50) {
        const response = await api.get({
            action: "query",
            formatversion: 2,
            prop: "revisions",
            revids: parentIds.slice(offset, offset + 50).join("|"),
            rvprop: "ids|size",
        });
        for (const page of queryPages(response)) {
            for (const value of pageRevisions(page)) {
                const { revid, size } = revisionSize(value);
                parentSizes.set(revid, size);
            }
        }
    }
    return largestContributor(revisions, parentSizes, since, until);
}
