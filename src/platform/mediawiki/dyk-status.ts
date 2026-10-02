/**
 * @file src/platform/mediawiki/dyk-status.ts
 * Purpose: src / platform / mediawiki / dyk status module.
 *
 * Table of contents:
 * 1. Imports
 * 2. getDykStatus
 */

import { parseDykStatus, type DykStatus } from "../../domain/dyk-status.ts";
import type { ApiClient } from "./api.ts";

export async function getDykStatus(
    client: ApiClient,
    pageName: string,
): Promise<DykStatus> {
    const title = pageName.trim().replaceAll("_", " ");
    if (!title) return { passed: false, date: null };
    const response = await client.get({
        action: "query",
        formatversion: 2,
        titles: "Talk:" + title,
        redirects: true,
        prop: "revisions",
        rvslots: "main",
        rvprop: "content",
        rvlimit: 1,
    });
    const page = response?.query?.pages?.[0];
    if (response?.error || !page)
        throw new Error("MediaWiki returned no DYK talk-page snapshot");
    if (page.missing === true) return { passed: false, date: null };
    const revision = page.revisions?.[0];
    const content = revision?.slots?.main?.content;
    if (typeof content !== "string")
        throw new Error("MediaWiki returned no readable DYK talk-page content");
    return parseDykStatus(content);
}
