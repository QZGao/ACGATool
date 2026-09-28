import assert from "node:assert/strict";
import test from "node:test";
import { createMediaWikiApi } from "../../src/platform/mediawiki/api.ts";

test("wikitext preview posts only a read-only parse request with signature expansion", async () => {
    const requests: Record<string, unknown>[] = [];
    const api = createMediaWikiApi({
        createApi: () => ({
            async get() {
                assert.fail("Full nomination source should be posted");
            },
            async post(parameters) {
                requests.push(parameters);
                return {
                    parse: { text: "<table>Rendered nomination</table>" },
                };
            },
            async postWithToken() {
                assert.fail("Preview must not request a token or edit a page");
            },
        }),
    });
    assert.equal(
        await api.parseWikitext("{{ACG提名2}}\n~~~~", "Registry"),
        "<table>Rendered nomination</table>",
    );
    assert.deepEqual(requests, [
        {
            action: "parse",
            formatversion: 2,
            title: "Registry",
            text: "{{ACG提名2}}\n~~~~",
            contentmodel: "wikitext",
            prop: "text",
            pst: true,
            preview: true,
            disableeditsection: true,
        },
    ]);
});

test("wikitext preview rejects API errors and malformed HTML responses", async () => {
    for (const response of [
        { error: { code: "failed" } },
        {},
        { parse: {} },
        { parse: { text: { "*": "legacy format" } } },
    ]) {
        const api = createMediaWikiApi({
            createApi: () => ({
                async get() {
                    return response;
                },
                async postWithToken() {
                    assert.fail("Preview must never edit a page");
                },
            }),
        });
        await assert.rejects(
            api.parseWikitext("Source", "Registry"),
            /preview/u,
        );
    }
});

test("wikitext preview supports injected clients without a post method", async () => {
    const api = createMediaWikiApi({
        createApi: () => ({
            async get(parameters) {
                assert.equal(parameters.action, "parse");
                return { parse: { text: "<p>Preview</p>" } };
            },
            async postWithToken() {
                assert.fail("Preview must never edit a page");
            },
        }),
    });
    assert.equal(
        await api.parseWikitext("Source", "Registry"),
        "<p>Preview</p>",
    );
});
