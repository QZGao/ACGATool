import test from "node:test";
import assert from "node:assert/strict";
import { createMediaWikiApi } from "../../src/platform/mediawiki/api.ts";

function snapshot(score: number, revision: number) {
    return {
        query: {
            pageids: ["1"],
            pages: {
                "1": {
                    revisions: [
                        {
                            revid: revision,
                            slots: {
                                main: {
                                    "*": `return {\n    ["Example"] = ${score},\n}`,
                                },
                            },
                        },
                    ],
                },
            },
        },
    };
}

test("one batch produces one conflict-guarded score-list edit combining repeated users", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const api = createMediaWikiApi({
        createApi: () => ({
            async get() {
                return snapshot(10, 22);
            },
            async postWithToken(_token, parameters) {
                writes.push(parameters);
                return { edit: { result: "Success", newrevid: 23 } };
            },
        }),
    });
    assert.equal(
        await api.editACGAScoreListBatch(
            [
                { userName: "Example", score: 2 },
                { userName: "New", score: 3 },
                { userName: "Example", score: -0.5 },
            ],
            101,
        ),
        false,
    );
    assert.equal(writes.length, 1);
    assert.equal(writes[0].baserevid, 22);
    assert.equal(writes[0].title, "Module:ACGaward/list");
    assert.match(String(writes[0].text), /\["Example"\] = 11\.5,/u);
    assert.match(String(writes[0].text), /\["New"\] = 3,/u);
    assert.match(String(writes[0].summary), /Special:Diff\/101/u);
});

test("score-list conflict retries against fresh totals and never overwrites another writer", async () => {
    const writes: Array<Record<string, unknown>> = [];
    let reads = 0;
    const api = createMediaWikiApi({
        createApi: () => ({
            async get() {
                return ++reads === 1 ? snapshot(10, 22) : snapshot(15, 23);
            },
            async postWithToken(_token, parameters) {
                writes.push(parameters);
                return writes.length === 1
                    ? { error: { code: "editconflict" } }
                    : { edit: { result: "Success", newrevid: 24 } };
            },
        }),
    });
    assert.equal(
        await api.editACGAScoreListBatch(
            [{ userName: "Example", score: -2 }],
            100,
        ),
        false,
    );
    assert.equal(reads, 2);
    assert.equal(writes.length, 2);
    assert.equal(writes[1].baserevid, 23);
    assert.match(String(writes[1].text), /\["Example"\] = 13,/u);
});

test("zero totals skip all network work and missing revisions or unsupported Lua never write", async () => {
    let calls = 0;
    const api = createMediaWikiApi({
        createApi: () => ({
            async get() {
                calls++;
                return {
                    query: {
                        pageids: ["1"],
                        pages: {
                            "1": {
                                revisions: [
                                    { slots: { main: { "*": "return {\n}" } } },
                                ],
                            },
                        },
                    },
                };
            },
            async postWithToken() {
                calls++;
                throw new Error("must not write");
            },
        }),
    });
    assert.equal(
        await api.editACGAScoreListBatch(
            [{ userName: "Example", score: 0 }],
            100,
        ),
        false,
    );
    assert.equal(calls, 0);
    assert.equal(
        await api.editACGAScoreListBatch(
            [{ userName: "Example", score: 2 }],
            100,
        ),
        true,
    );
    assert.equal(calls, 1);
});

test("network adapter is lazy and rejects malformed snapshots instead of treating them as missing", async () => {
    let created = 0;
    const api = createMediaWikiApi({
        createApi: () => {
            created++;
            return {
                async get() {
                    return {};
                },
                async postWithToken() {
                    return { edit: { result: "Success" } };
                },
            };
        },
    });
    assert.equal(created, 0);
    await assert.rejects(api.getPageSnapshot(), /no page snapshot/u);
    await assert.rejects(api.getPageSnapshot(), /no page snapshot/u);
    assert.equal(created, 1);
});
