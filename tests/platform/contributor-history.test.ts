/**
 * @file tests/platform/contributor-history.test.ts
 * Purpose: tests / platform / contributor history.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. revision
 * 4. history
 * 5. fixture
 * 6. Test scenarios
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createMediaWikiApi } from "../../src/platform/mediawiki/api.ts";
import {
    largestContributor,
    type ContributionRevision,
} from "../../src/domain/contributors.ts";

const now = new Date("2026-09-27T12:00:00.000Z");
const since = new Date("2025-09-27T12:00:00.000Z");

function revision(
    revid: number,
    parentid: number,
    size: number,
    user = "Editor",
    timestamp = "2026-09-01T00:00:00Z",
): ContributionRevision {
    return { revid, parentid, timestamp, size, user };
}

function history(revisions: Partial<ContributionRevision>[], next?: string) {
    return {
        query: { pages: [{ pageid: 1, revisions }] },
        ...(next ? { continue: { continue: "||", rvcontinue: next } } : {}),
    };
}

function fixture(responses: unknown[], date = now) {
    const requests: Record<string, unknown>[] = [];
    const api = createMediaWikiApi({
        now: () => date,
        createApi: () => ({
            async get(parameters) {
                requests.push(parameters);
                const response = responses.shift();
                if (response instanceof Error) throw response;
                return response;
            },
            async postWithToken() {
                assert.fail("Contributor lookup must never edit a page");
            },
        }),
    });
    return { api, requests };
}

test("recipient lookup includes every history page and the exact parent before the cutoff", async () => {
    const { api, requests } = fixture([
        history(
            [
                revision(11, 10, 10_100, "First editor", since.toISOString()),
                revision(12, 11, 9_000, "Later winner"),
            ],
            "page-two",
        ),
        history([
            revision(13, 12, 9_400, "Later winner"),
            revision(14, 13, 9_550, "First editor"),
        ]),
        history([{ revid: 10, size: 10_000 }]),
    ]);
    assert.equal(
        await api.getLargestContributorLastYear("Example article"),
        "Later winner",
    );
    assert.deepEqual(requests[0], {
        action: "query",
        formatversion: 2,
        titles: "Example article",
        prop: "revisions",
        rvprop: "ids|timestamp|user|size",
        rvdir: "newer",
        rvstart: since.toISOString(),
        rvend: now.toISOString(),
        rvlimit: "max",
    });
    assert.deepEqual(requests[1], {
        ...requests[0],
        continue: "||",
        rvcontinue: "page-two",
    });
    assert.deepEqual(requests[2], {
        action: "query",
        formatversion: 2,
        prop: "revisions",
        revids: "10",
        rvprop: "ids|size",
    });
});

test("article creation uses zero parent bytes and no parent request", async () => {
    const { api, requests } = fixture([
        history([
            revision(1, 0, 3_000, "Article creator"),
            revision(2, 1, 3_100),
        ]),
    ]);
    assert.equal(
        await api.getLargestContributorLastYear("New article"),
        "Article creator",
    );
    assert.equal(requests.length, 1);
});

test("hidden editors are not suggested but their sizes remain the next edit's baseline", () => {
    assert.equal(
        largestContributor(
            [
                { ...revision(1, 0, 100_000, "Hidden"), userhidden: "" },
                revision(2, 1, 100_100, "Small addition"),
                revision(3, 2, 100_300, "Larger addition"),
            ],
            new Map(),
            since,
            now,
        ),
        "Larger addition",
    );
});

test("only edits within the rolling year count and repeated revision IDs count once", () => {
    const counted = revision(
        3,
        2,
        100_400,
        "Current editor",
        now.toISOString(),
    );
    assert.equal(
        largestContributor(
            [
                revision(1, 0, 100_000, "Old editor", "2025-09-27T11:59:59Z"),
                revision(2, 1, 100_250, "Boundary editor", since.toISOString()),
                counted,
                counted,
                revision(
                    4,
                    3,
                    1_000_000,
                    "Future editor",
                    "2026-09-27T12:00:01Z",
                ),
            ],
            new Map(),
            since,
            now,
        ),
        "Boundary editor",
    );
});

test("ties use a stable username order and no positive contribution yields no suggestion", () => {
    assert.equal(
        largestContributor(
            [revision(1, 0, 100, "Zed"), revision(2, 1, 200, "Alice")],
            new Map(),
            since,
            now,
        ),
        "Alice",
    );
    assert.equal(
        largestContributor(
            [revision(2, 1, 20), revision(3, 2, 20)],
            new Map([[1, 100]]),
            since,
            now,
        ),
        null,
    );
});

test("missing articles and articles without recent edits leave the recipient unchanged", async () => {
    for (const response of [
        { query: { pages: [{ missing: true }] } },
        history([]),
    ]) {
        const { api, requests } = fixture([response]);
        assert.equal(
            await api.getLargestContributorLastYear("Quiet article"),
            null,
        );
        assert.equal(requests.length, 1);
    }
});

test("recipient lookup fails when the parent baseline or revision size is unavailable", async () => {
    const missingParent = fixture([
        history([revision(2, 1, 10_000)]),
        history([]),
    ]);
    await assert.rejects(
        missingParent.api.getLargestContributorLastYear("Example"),
        /size/,
    );
    const missingSize = fixture([
        history([{ ...revision(1, 0, 0), size: undefined }]),
    ]);
    await assert.rejects(
        missingSize.api.getLargestContributorLastYear("Example"),
        /size/,
    );
});

test("network and malformed-history failures remain errors instead of incomplete suggestions", async () => {
    for (const response of [
        new Error("offline"),
        { error: { code: "failed" } },
        {},
    ]) {
        const { api } = fixture([response]);
        await assert.rejects(api.getLargestContributorLastYear("Example"));
    }
});

test("a repeated continuation stops without returning a partial winner", async () => {
    const { api, requests } = fixture([
        history([revision(1, 0, 100)], "same"),
        history([revision(2, 1, 200)], "same"),
    ]);
    await assert.rejects(
        api.getLargestContributorLastYear("Example"),
        /continuation/,
    );
    assert.equal(requests.length, 2);
});

test("the rolling calendar year clamps leap day and leaves the injected date unchanged", async () => {
    const leapDay = new Date("2024-02-29T10:15:30.000Z");
    const { api, requests } = fixture([history([])], leapDay);
    await api.getLargestContributorLastYear("Example");
    assert.equal(requests[0]?.rvstart, "2023-02-28T10:15:30.000Z");
    assert.equal(leapDay.toISOString(), "2024-02-29T10:15:30.000Z");
});
