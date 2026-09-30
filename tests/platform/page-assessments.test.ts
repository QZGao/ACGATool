import test from "node:test";
import assert from "node:assert/strict";
import { createMediaWikiApi } from "../../src/platform/mediawiki/api.ts";

function fixture(...responses: unknown[]) {
    const queries: Record<string, unknown>[] = [];
    const api = createMediaWikiApi({
        createApi: () => ({
            async get(parameters) {
                queries.push(parameters);
                const response = responses.shift();
                if (response instanceof Error) throw response;
                return response;
            },
            async postWithToken() {
                throw new Error("Assessment lookup must be read-only");
            },
        }),
    });
    return { api, queries };
}

test("assessment lookup follows article redirects, keeps punctuation and excludes taskforces", async () => {
    const { api, queries } = fixture({
        query: {
            pages: [
                {
                    pageid: 9031533,
                    title: "Re:Zero Example",
                    pageassessments: {
                        ACG: { class: "初", importance: "未知" },
                        虚构角色: { class: "乙", importance: "" },
                        电子游戏: { class: "丙", importance: "未知" },
                        "电子游戏/角色": { class: "甲", importance: "高" },
                        通用评级: { class: "初", importance: "" },
                    },
                },
            ],
        },
    });
    assert.deepEqual(await api.getPageAssessments(" Re:Zero_Example "), [
        { project: "ACG", class: "初" },
        { project: "虚构角色", class: "乙" },
        { project: "电子游戏", class: "丙" },
        { project: "通用评级", class: "初" },
    ]);
    assert.deepEqual(queries, [
        {
            action: "query",
            formatversion: 2,
            titles: "Re:Zero Example",
            redirects: true,
            prop: "pageassessments",
            palimit: "max",
        },
    ]);
});

test("assessment lookup accepts default object-keyed page responses and plain text metadata", async () => {
    const { api } = fixture({
        batchcomplete: "",
        query: {
            pages: {
                "9031533": {
                    pageid: 9031533,
                    title: "美竹兰",
                    pageassessments: {
                        " ACG ": { class: " 初 ", importance: "未知" },
                        "<img src=x onerror=alert(1)>": {
                            class: "<b>乙</b>",
                        },
                        "": { class: "甲" },
                        Blank: { class: " " },
                        Absent: { importance: "高" },
                        Numeric: { class: 1 },
                    },
                },
            },
        },
    });
    assert.deepEqual(await api.getPageAssessments("美竹兰"), [
        { project: "ACG", class: "初" },
        {
            project: "<img src=x onerror=alert(1)>",
            class: "<b>乙</b>",
        },
    ]);
});

test("blank, missing and unassessed pages return no assessments", async () => {
    const blank = fixture();
    assert.deepEqual(await blank.api.getPageAssessments("  "), []);
    assert.equal(blank.queries.length, 0);
    for (const page of [
        { missing: true },
        { missing: "" },
        { pageid: 1, title: "Example" },
        { pageid: 1, title: "Example", pageassessments: {} },
    ]) {
        assert.deepEqual(
            await fixture({ query: { pages: [page] } }).api.getPageAssessments(
                "Example",
            ),
            [],
        );
    }
});

test("assessment lookups consume continuation and merge repeated projects", async () => {
    const { api, queries } = fixture(
        {
            continue: { pacontinue: "1|12", continue: "||" },
            query: {
                pages: [
                    {
                        pageid: 1,
                        pageassessments: {
                            ACG: { class: "初" },
                            漫畫: { class: "丙" },
                        },
                    },
                ],
            },
        },
        {
            query: {
                pages: [
                    {
                        pageid: 1,
                        pageassessments: {
                            漫畫: { class: "乙" },
                            通用评级: { class: "初" },
                        },
                    },
                ],
            },
        },
    );
    assert.deepEqual(await api.getPageAssessments("Example"), [
        { project: "ACG", class: "初" },
        { project: "漫畫", class: "乙" },
        { project: "通用评级", class: "初" },
    ]);
    assert.equal(queries.length, 2);
    assert.equal(queries[1]?.pacontinue, "1|12");
    assert.equal(queries[1]?.continue, "||");
    assert.equal(queries[1]?.titles, "Example");
    assert.equal(queries[1]?.prop, "pageassessments");
});

test("API failures and malformed responses remain distinct from an unassessed page", async () => {
    for (const response of [
        new Error("network unavailable"),
        { error: { code: "readonly" } },
        { warnings: { main: { "*": "Unknown prop: pageassessments" } } },
        null,
        {},
        { query: { pages: [] } },
        { query: { pages: [{}, {}] } },
        { query: { pages: [null] } },
        { query: { pages: [{ invalid: true }] } },
        { query: { pages: [{ pageassessments: "unreadable" }] } },
        { query: { pages: [{ pageassessments: { ACG: null } }] } },
    ]) {
        await assert.rejects(
            fixture(response).api.getPageAssessments("Example"),
        );
    }
});

test("continuation failures never return a partial assessment collection", async () => {
    const partial = {
        query: {
            pages: [{ pageassessments: { ACG: { class: "初" } } }],
        },
        continue: { pacontinue: "1|12", continue: "||" },
    };
    for (const response of [
        new Error("network unavailable"),
        { error: { code: "badcontinue" } },
        partial,
        { ...partial, continue: { pacontinue: 12 } },
        { ...partial, continue: { pacontinue: "" } },
        { ...partial, continue: {} },
    ]) {
        const { api, queries } = fixture(partial, response);
        await assert.rejects(api.getPageAssessments("Example"));
        assert.equal(queries.length, 2);
    }
});
