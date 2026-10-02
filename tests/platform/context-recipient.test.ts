/**
 * @file tests/platform/context-recipient.test.ts
 * Purpose: tests / platform / context recipient.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. fixture
 * 3. Test scenarios
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createMediaWikiApi } from "../../src/platform/mediawiki/api.ts";

function fixture(response: unknown) {
    const requests: Record<string, unknown>[] = [];
    const api = createMediaWikiApi({
        createApi: () => ({
            async get(parameters) {
                requests.push(parameters);
                if (response instanceof Error) throw response;
                return response;
            },
            async postWithToken() {
                assert.fail("Context recipient lookup must never edit a page");
            },
        }),
    });
    return { api, requests };
}

test("file recipient lookup requests only the latest uploader for local and shared Commons files", async () => {
    for (const metadata of [
        { imagerepository: "local", pageid: 1 },
        { imagerepository: "shared", missing: true },
    ]) {
        const { api, requests } = fixture({
            query: {
                pages: [
                    { ...metadata, imageinfo: [{ user: "Last uploader" }] },
                ],
            },
        });
        assert.equal(
            await api.getLatestFileUploader("File:Example.svg"),
            "Last uploader",
        );
        assert.deepEqual(requests, [
            {
                action: "query",
                formatversion: 2,
                titles: "File:Example.svg",
                prop: "imageinfo",
                iiprop: "user",
                iilimit: 1,
            },
        ]);
    }
});

test("revision recipient lookup reads the exact revision instead of the latest editor", async () => {
    const { api, requests } = fixture({
        query: {
            pages: [
                {
                    revisions: [
                        { revid: 99, user: "Latest editor" },
                        { revid: 42, user: "Viewed editor" },
                    ],
                },
            ],
        },
    });
    assert.equal(await api.getRevisionEditor(42), "Viewed editor");
    assert.deepEqual(requests, [
        {
            action: "query",
            formatversion: 2,
            revids: 42,
            prop: "revisions",
            rvprop: "ids|user",
        },
    ]);
});

test("hidden and absent users yield no suggestion, while invalid responses remain errors", async () => {
    for (const method of [
        "getLatestFileUploader",
        "getRevisionEditor",
    ] as const) {
        const query =
            method === "getLatestFileUploader"
                ? { imageinfo: [{ user: "Hidden uploader", userhidden: true }] }
                : {
                      revisions: [
                          {
                              revid: 42,
                              user: "Hidden editor",
                              userhidden: true,
                          },
                      ],
                  };
        const { api } = fixture({ query: { pages: [query] } });
        assert.equal(
            await (method === "getLatestFileUploader"
                ? api.getLatestFileUploader("File:Example.svg")
                : api.getRevisionEditor(42)),
            null,
        );
        for (const badResponse of [
            {},
            { error: { code: "failed" } },
            new Error("offline"),
        ]) {
            const broken = fixture(badResponse);
            await assert.rejects(
                method === "getLatestFileUploader"
                    ? broken.api.getLatestFileUploader("File:Example.svg")
                    : broken.api.getRevisionEditor(42),
            );
        }
    }
    assert.equal(
        await fixture({
            query: { pages: [{ missing: true }] },
        }).api.getLatestFileUploader("File:Missing.svg"),
        null,
    );
    assert.equal(
        await fixture({ query: { pages: [] } }).api.getRevisionEditor(42),
        null,
    );
});
