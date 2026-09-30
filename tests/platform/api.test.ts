import test from "node:test";
import assert from "node:assert/strict";

import { createMediaWikiApi } from "../../src/platform/mediawiki/api.ts";
import {
    formatScoreListEditSummary,
    parseUserReason,
    queried2NomData,
    queryEntry,
    resolveEntryByFingerprint,
} from "../../src/domain/wikitext.ts";

let nextEditResponse: Record<string, any> = {};
let nextEditError: any = null;
let nextGetResponse: Record<string, any> = {};
let editRequests: any[] = [];
let getRequests: any[] = [];

const hostMw = {
    Api: class {
        async postWithToken(tokenName: any, params: any) {
            editRequests.push({ token: tokenName, params });
            if (nextEditError) {
                const error = nextEditError;
                nextEditError = null;
                throw error;
            }
            return nextEditResponse;
        }

        async get(params: any) {
            getRequests.push(params);
            return nextGetResponse;
        }
    },
    notify() {},
};

const {
    editACGAScoreList,
    editACGAScoreListBatch,
    editPage,
    getFullText,
    getPageSnapshot,
} = createMediaWikiApi({ createApi: () => new hostMw.Api() });

function scoreListResponse(score = 112) {
    return {
        query: {
            pageids: ["1"],
            pages: {
                1: {
                    revisions: [
                        {
                            revid: 66,
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

function token(code: any, overrides = {}) {
    return {
        code,
        pending: false,
        comment: null,
        scoreOverride: null,
        sourceIndex: 0,
        ...overrides,
    };
}

test("public reason parser preserves token order, duplicate occurrences, and modifiers", () => {
    const reason =
        "{{ACG提名2/request|ver=1|1C 4?(動員令)[0.5] DYK？ 4[1](編輯松)}}";

    assert.deepEqual(parseUserReason(reason), {
        ok: true,
        tokens: [
            token("1c"),
            token("4", {
                pending: true,
                comment: "動員令",
                scoreOverride: 0.5,
                sourceIndex: 1,
            }),
            token("4-dyk", { pending: true, sourceIndex: 2 }),
            token("4", { comment: "編輯松", scoreOverride: 1, sourceIndex: 3 }),
        ],
    });
});

test("public reason parser accepts parser-only complete quick-review codes", () => {
    assert.deepEqual(parseUserReason("5X-FAC-HALF?[4.5]"), {
        ok: true,
        tokens: [
            token("5x-fac-half", {
                pending: true,
                scoreOverride: 4.5,
            }),
        ],
    });
});

test("public reason parser returns a discriminated failure instead of partial state", () => {
    assert.deepEqual(
        parseUserReason("{{ACG提名2/request|ver=1|1c 4[bad] 3}}"),
        {
            ok: false,
            error: {
                code: "invalid-score",
                sourceIndex: 1,
                token: "4[bad]",
                score: "bad",
            },
            rawReason: "1c 4[bad] 3",
        },
    );
});

test("public reason parser treats every whitespace sequence as a token delimiter", () => {
    const parsed = parseUserReason(
        "{{ACG提名2/request|ver=1|4(基礎條目 擴充)}}",
    );

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "invalid-comment");
    assert.equal(parsed.error.sourceIndex, 0);
    assert.equal(parsed.rawReason, "4(基礎條目 擴充)");
});

function queried(type: any, values: any) {
    const params = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, { value }]),
    );
    return type === "acg2"
        ? { type, template: params }
        : { type, template: { params } };
}

for (const type of ["main", "extra", "acg2"]) {
    test(`queried2NomData preserves source and parse metadata for ${type}`, () => {
        const fields = {
            條目名稱: "Example",
            用戶名稱: "Editor",
            提名理由:
                " <!--keep source--> {{ACG提名2/request|ver=1|4?(活動)[0.5] 4}} ",
            核對用: "{{ACG提名2/check|ver=1|4}} <!--checked-->",
        };
        const nomData = queried2NomData(queried(type, fields));

        assert.equal(nomData.pageName, "Example");
        assert.equal(nomData.awarder, "Editor");
        assert.equal(nomData.requestReasonText, "4?(活動)[0.5] 4");
        assert.equal(nomData.requestReasonWikitext, fields["提名理由"]);
        assert.equal(nomData.checkWikitext, fields["核對用"]);
        assert.deepEqual(nomData.rawFields, fields);
        assert.deepEqual(nomData.reasonParse, {
            ok: true,
            tokens: [
                token("4", {
                    pending: true,
                    comment: "活動",
                    scoreOverride: 0.5,
                }),
                token("4", { sourceIndex: 1 }),
            ],
        });
    });
}

test("queried2NomData keeps malformed nominations available for source editing", () => {
    const fields = {
        條目名稱: "Example",
        用戶名稱: "Editor",
        提名理由: "{{ACG提名2/request|ver=1|4[bad]}}",
        核對用: "existing check text",
    };
    const nomData = queried2NomData(queried("main", fields));

    assert.notEqual(nomData, null);
    assert.deepEqual(nomData.rawFields, fields);
    assert.equal(nomData.reasonParse.ok, false);
    assert.equal(nomData.reasonParse.error.code, "invalid-score");
    assert.equal(nomData.requestReasonWikitext, fields["提名理由"]);
    assert.equal(nomData.checkWikitext, fields["核對用"]);
});

test("queried2NomData retains ACG提名2 source identity fields while exposing clean UI values", () => {
    const fields = {
        條目名稱: "<!--sort--> Example ",
        用戶名稱: " Editor <!--note-->",
        提名理由: "1c",
        核對用: "",
    };
    const nomData = queried2NomData(queried("acg2", fields));

    assert.equal(nomData.pageName, "Example");
    assert.equal(nomData.awarder, "Editor");
    assert.deepEqual(nomData.rawFields, fields);
});

test("queried2NomData rejects only unsupported entry types", () => {
    assert.equal(queried2NomData({ type: "unknown", template: {} }), null);
});

test("score-list edit summary is exact and supports fractional scores", () => {
    assert.equal(
        formatScoreListEditSummary("Example", 112, 0.5, 112.5, 123456),
        "[[User:Example|Example]]: 112 + [[Special:Diff/123456|0.5]] = 112.5 " +
            "([[User:SuperGrey/gadgets/ACGATool|ACGATool]] modified)",
    );
});

test("recheck score-list edits identify the review and subtract only the reduction", async () => {
    editRequests = [];
    getRequests = [];
    nextGetResponse = scoreListResponse();
    nextEditError = null;
    nextEditResponse = { edit: { result: "Success", newrevid: 987654 } };

    assert.equal(
        await editACGAScoreListBatch(
            [{ userName: "Example", score: -2 }],
            123456,
            null,
            true,
        ),
        false,
    );
    assert.equal(editRequests.length, 1);
    assert.match(editRequests[0].params.text, /\["Example"\] = 110/u);
    assert.equal(
        editRequests[0].params.summary,
        "復核積分：[[User:Example|Example]]: 112 − [[Special:Diff/123456|2]] = 110 " +
            "([[User:SuperGrey/gadgets/ACGATool|ACGATool]] modified)",
    );
});

test("batch score-list rechecks distinguish the summary and keep negative and positive deltas", async () => {
    editRequests = [];
    getRequests = [];
    nextGetResponse = scoreListResponse();
    nextEditError = null;
    nextEditResponse = { edit: { result: "Success", newrevid: 987654 } };

    assert.equal(
        await editACGAScoreListBatch(
            [
                { userName: "Example", score: -2 },
                { userName: "Other", score: 1 },
            ],
            123456,
            null,
            true,
        ),
        false,
    );
    assert.equal(editRequests.length, 1);
    assert.match(editRequests[0].params.text, /\["Example"\] = 110/u);
    assert.match(editRequests[0].params.text, /\["Other"\] = 1/u);
    assert.match(editRequests[0].params.summary, /^批次復核積分 /u);
    assert.match(editRequests[0].params.summary, /112 − 2 = 110/u);
    assert.match(editRequests[0].params.summary, /0 \+ 1 = 1/u);
});

test("score-list edit summary links to a safe DiscussionTools comment fragment", () => {
    assert.equal(
        formatScoreListEditSummary(
            "Example",
            112,
            3,
            115,
            123456,
            "c-LimiEi-20260818134500-8月18日",
        ),
        "[[User:Example|Example]]: 112 + " +
            "[[Special:Diff/123456#c-LimiEi-20260818134500-8月18日|3]] = 115 " +
            "([[User:SuperGrey/gadgets/ACGATool|ACGATool]] modified)",
    );
});

for (const unsafeCommentId of [
    "",
    "   ",
    "c-safe|changed-label",
    "c-safe#other",
    "c-safe\nother",
]) {
    test(`score-list edit summary rejects unsafe comment fragment ${JSON.stringify(unsafeCommentId)}`, () => {
        assert.ok(
            formatScoreListEditSummary(
                "Example",
                112,
                3,
                115,
                123456,
                unsafeCommentId,
            ).includes("[[Special:Diff/123456|3]]"),
        );
    });
}

test("getPageSnapshot preserves exact text and its revision id", async () => {
    getRequests = [];
    nextGetResponse = {
        query: {
            pageids: ["1"],
            pages: {
                1: {
                    revisions: [
                        {
                            revid: 13579,
                            slots: { main: { "*": "  page text  " } },
                        },
                    ],
                },
            },
        },
    };

    assert.deepEqual(await getPageSnapshot("Page"), {
        exists: true,
        text: "  page text  ",
        revisionId: 13579,
    });
    assert.equal(getRequests.length, 1);
    assert.equal(getRequests[0].rvprop, "ids|content");
});

test('getPageSnapshot treats the presence of missing="" as an absent page', async () => {
    nextGetResponse = {
        query: {
            pageids: ["-1"],
            pages: {
                "-1": { missing: "" },
            },
        },
    };

    assert.deepEqual(await getPageSnapshot("Missing"), {
        exists: false,
        text: "",
        revisionId: null,
    });
});

test("getFullText remains a text-only snapshot wrapper", async () => {
    nextGetResponse = {
        query: {
            pageids: ["1"],
            pages: {
                1: {
                    revisions: [
                        {
                            revid: 13579,
                            slots: { main: { "*": "  wrapped text  " } },
                        },
                    ],
                },
            },
        },
    };

    assert.equal(await getFullText("Page"), "  wrapped text  ");
});

test("queryEntry distinguishes duplicate date headings and returns its locator", () => {
    const text = [
        "=== 8月18日 ===",
        "{{ACG提名",
        "|條目名稱 = First article",
        "|用戶名稱 = First user",
        "|提名理由 = 1c",
        "|核對用 =",
        "}}",
        "=== 8月18日 ===",
        "{{ACG提名",
        "|條目名稱 = Second article",
        "|用戶名稱 = Second user",
        "|提名理由 = 1c",
        "|核對用 =",
        "}}",
    ].join("\n");

    const first = queryEntry(text, "8月18日", 1);
    const second = queryEntry(text, "8月18日", 1, 1);

    assert.equal(first.template.params["條目名稱"].value, "First article");
    assert.deepEqual(
        {
            date: first.date,
            index: first.index,
            sectionOccurrence: first.sectionOccurrence,
        },
        { date: "8月18日", index: 1, sectionOccurrence: 0 },
    );
    assert.equal(second.template.params["條目名稱"].value, "Second article");
    assert.deepEqual(
        {
            date: second.date,
            index: second.index,
            sectionOccurrence: second.sectionOccurrence,
        },
        { date: "8月18日", index: 1, sectionOccurrence: 1 },
    );
    assert.equal(queryEntry(text, "8月18日", 1, 2), null);
    assert.equal(queryEntry(text, "8月18日", 1, -1), null);
});

function nominationSource(pageName: any, awarder = "Example user") {
    return [
        "{{ACG提名",
        `|條目名稱 = ${pageName}`,
        `|用戶名稱 = ${awarder}`,
        "|提名理由 = 1c",
        "|核對用 =",
        "}}",
    ].join("\n");
}

test("queryEntry records an immutable exact source fingerprint", () => {
    const text = `=== 8月18日 ===\n${nominationSource("Target article")}`;
    const entry = queryEntry(text, "8月18日", 1);

    assert.equal(entry.sourceFingerprint, text.slice(entry.start, entry.end));
    assert.equal(
        Object.getOwnPropertyDescriptor(entry, "sourceFingerprint")?.writable,
        false,
    );
    assert.throws(() => {
        entry.sourceFingerprint = "replacement";
    }, TypeError);
});

test("resolveEntryByFingerprint accepts an unchanged original locator", () => {
    const text = `=== 8月18日 ===\n${nominationSource("Target article")}`;
    const original = queryEntry(text, "8月18日", 1);
    const resolved = resolveEntryByFingerprint(text, original);

    assert.notEqual(resolved, null);
    assert.equal(resolved.index, 1);
    assert.equal(resolved.sectionOccurrence, 0);
    assert.equal(resolved.sourceFingerprint, original.sourceFingerprint);
});

test("resolveEntryByFingerprint uniquely relocates an entry shifted within its date section", () => {
    const originalText = `=== 8月18日 ===\n${nominationSource("Target article")}`;
    const original = queryEntry(originalText, "8月18日", 1);
    const latestText = [
        "=== 8月18日 ===",
        nominationSource("Concurrent article"),
        nominationSource("Target article"),
    ].join("\n");
    const resolved = resolveEntryByFingerprint(latestText, original);

    assert.notEqual(resolved, null);
    assert.equal(resolved.index, 2);
    assert.equal(resolved.sectionOccurrence, 0);
    assert.equal(resolved.template.params["條目名稱"].value, "Target article");
});

test("resolveEntryByFingerprint uniquely relocates a shifted duplicate date heading", () => {
    const originalText = [
        "=== 8月18日 ===",
        nominationSource("First article"),
        "=== 8月18日 ===",
        nominationSource("Target article"),
    ].join("\n");
    const original = queryEntry(originalText, "8月18日", 1, 1);
    const latestText = [
        "=== 8月18日 ===",
        nominationSource("Concurrent article"),
        originalText,
    ].join("\n");
    const resolved = resolveEntryByFingerprint(latestText, original);

    assert.notEqual(resolved, null);
    assert.equal(resolved.index, 1);
    assert.equal(resolved.sectionOccurrence, 2);
    assert.equal(resolved.template.params["條目名稱"].value, "Target article");
});

test("resolveEntryByFingerprint aborts when the original source no longer exists", () => {
    const originalText = `=== 8月18日 ===\n${nominationSource("Target article")}`;
    const original = queryEntry(originalText, "8月18日", 1);
    const latestText = `=== 8月18日 ===\n${nominationSource("Changed article")}`;

    assert.equal(resolveEntryByFingerprint(latestText, original), null);
});

test("resolveEntryByFingerprint aborts ambiguous duplicate fingerprints after a locator shift", () => {
    const originalText = `=== 8月18日 ===\n${nominationSource("Target article")}`;
    const original = queryEntry(originalText, "8月18日", 1);
    const latestText = [
        "=== 8月18日 ===",
        nominationSource("Concurrent article"),
        nominationSource("Target article"),
        nominationSource("Target article"),
    ].join("\n");

    assert.equal(resolveEntryByFingerprint(latestText, original), null);
});

test("editPage returns the successful revision id", async () => {
    nextEditError = null;
    nextEditResponse = { edit: { result: "Success", newrevid: 24680 } };
    assert.deepEqual(await editPage("Page", "text", "summary"), {
        success: true,
        newRevId: 24680,
        errorCode: null,
    });
});

test("editPage preserves success when MediaWiki omits newrevid", async () => {
    nextEditError = null;
    nextEditResponse = { edit: { result: "Success" } };
    assert.deepEqual(await editPage("Page", "text", "summary"), {
        success: true,
        newRevId: null,
        errorCode: null,
    });
});

test("editPage submits conflict and creation guards when requested", async () => {
    editRequests = [];
    nextEditError = null;
    nextEditResponse = { edit: { result: "Success", newrevid: 24680 } };

    assert.equal(
        (
            await editPage("Page", "text", "summary", {
                baseRevisionId: 12345,
                createOnly: true,
            })
        ).success,
        true,
    );
    assert.deepEqual(editRequests[0].params, {
        action: "edit",
        title: "Page",
        text: "text",
        summary: "summary",
        baserevid: 12345,
        createonly: true,
    });
});

test("editPage returns a structured failure", async () => {
    nextEditError = null;
    nextEditResponse = { error: { code: "failed" } };
    assert.deepEqual(await editPage("Page", "text", "summary"), {
        success: false,
        newRevId: null,
        errorCode: "failed",
    });
});

test("editPage normalizes rejected API requests", async () => {
    nextEditError = Object.assign(new Error("edit conflict"), {
        code: "editconflict",
    });
    assert.deepEqual(await editPage("Page", "text", "summary"), {
        success: false,
        newRevId: null,
        errorCode: "editconflict",
    });
});

test("score-list editing refuses a missing registry revision without API calls", async () => {
    editRequests = [];
    getRequests = [];

    assert.equal(await editACGAScoreList("Example", 3, null), true);
    assert.equal(editRequests.length, 0);
    assert.equal(getRequests.length, 0);
});

test("score-list edits submit the exact summary with each registry revision id", async () => {
    editRequests = [];
    getRequests = [];
    nextEditError = null;
    nextEditResponse = { edit: { result: "Success", newrevid: 999 } };

    for (const registryRevisionId of [123456, 654321]) {
        nextGetResponse = scoreListResponse();
        assert.equal(
            await editACGAScoreList("Example", 3, registryRevisionId),
            false,
        );
    }

    assert.equal(getRequests.length, 2);
    assert.deepEqual(
        editRequests.map((request: any) => request.params.summary),
        [
            "[[User:Example|Example]]: 112 + [[Special:Diff/123456|3]] = 115 " +
                "([[User:SuperGrey/gadgets/ACGATool|ACGATool]] modified)",
            "[[User:Example|Example]]: 112 + [[Special:Diff/654321|3]] = 115 " +
                "([[User:SuperGrey/gadgets/ACGATool|ACGATool]] modified)",
        ],
    );
    assert.ok(
        editRequests.every(
            (request: any) => request.params.title === "Module:ACGaward/list",
        ),
    );
});

test("score-list editing forwards a safe comment id into its edit summary", async () => {
    editRequests = [];
    nextGetResponse = scoreListResponse();
    nextEditError = null;
    nextEditResponse = { edit: { result: "Success", newrevid: 999 } };

    assert.equal(
        await editACGAScoreList(
            "Example",
            3,
            123456,
            "c-LimiEi-20260818134500-8月18日",
        ),
        false,
    );
    assert.equal(
        editRequests[0].params.summary,
        "[[User:Example|Example]]: 112 + " +
            "[[Special:Diff/123456#c-LimiEi-20260818134500-8月18日|3]] = 115 " +
            "([[User:SuperGrey/gadgets/ACGATool|ACGATool]] modified)",
    );
});

test("score-list editing reports a resolved second-edit failure", async () => {
    editRequests = [];
    nextGetResponse = scoreListResponse();
    nextEditError = null;
    nextEditResponse = { error: { code: "failed" } };

    assert.equal(await editACGAScoreList("Example", 3, 123456), true);
    assert.equal(editRequests.length, 1);
});
