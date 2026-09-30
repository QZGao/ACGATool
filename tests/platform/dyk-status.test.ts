import test from "node:test";
import assert from "node:assert/strict";
import { parseDykStatus } from "../../src/domain/dyk-status.ts";
import { createMediaWikiApi } from "../../src/platform/mediawiki/api.ts";

test("DYK invitations recognize active nominations with spaces, underscores, prefixes and parameters", () => {
    for (const source of [
        "{{DYK_Invite}}",
        "{{DYK Invite}}",
        "{{Template:DYK_Invite|article=Example|date=2026-09-30}}",
        "{{模板:dyk invite|Example}}",
        "{{Banner shell|1={{DYK_Invite}}}}",
    ]) {
        assert.deepEqual(parseDykStatus(source), {
            passed: false,
            date: null,
            nominated: true,
        });
    }
});

test("active DYK nominations coexist with passed banner milestones", () => {
    for (const history of [
        "{{DYKtalk|date=2025-08-05}}",
        "{{Article history|dykdate=2025-08-05}}",
    ]) {
        assert.deepEqual(parseDykStatus(history + "{{DYK Invite}}"), {
            passed: true,
            date: "2025-08-05",
            nominated: true,
        });
    }
});

test("active DYK nominations preserve passed and failed archive history", () => {
    assert.deepEqual(
        parseDykStatus(`{{DYK_Invite}}
{{DYKEntry/archive|author=First|result=+|hash|1754391689}}
{{DYKEntry/archive|author=Second|result=-|hash|1790489824}}`),
        {
            passed: false,
            date: "2026-09-27",
            nominated: true,
            records: [
                { author: "First", date: "2025-08-05", passed: true },
                { author: "Second", date: "2026-09-27", passed: false },
            ],
        },
    );
});

test("DYK invitations exclude literal examples, template parameters and lookalike names", () => {
    for (const source of [
        "DYK_Invite",
        "<!-- {{DYK_Invite}} -->",
        "<nowiki>{{DYK Invite}}</nowiki>",
        "<pre>{{DYK_Invite}}</pre>",
        "<source lang=wikitext>{{DYK Invite}}</source>",
        "<syntaxhighlight lang=wikitext>{{DYK_Invite}}</syntaxhighlight>",
        "{{DYK<nowiki>literal name</nowiki> Invite}}",
        "{{DYK_Invite/archive}}",
        "{{DYK_InviteExample}}",
        "{{{DYK_Invite}}}",
        "{{DYK_Invite",
    ]) {
        assert.deepEqual(parseDykStatus(source), { passed: false, date: null });
    }
});

test("DYK records recognize talk banners and numbered article-history dates", () => {
    for (const source of [
        "{{DYKtalk|2026年|9月30日}}",
        "{{Template:Didyouknow date|1=2026年|2=9月30日}}",
        "{{Article history|dyk2date=2026年9月30日|dyk2entry=[[A|B]]}}",
        "{{ArticleHistory\n|dyk1date = 2026年9月30日\n|action1 = GAN}}",
        "{{Banner shell|1={{DYKtalk|2026年|9月30日}}}}",
    ]) {
        assert.deepEqual(parseDykStatus(source), {
            passed: true,
            date: "2026年9月30日",
        });
    }
    assert.deepEqual(parseDykStatus("{{DYKtalk}}"), {
        passed: true,
        date: null,
    });
    assert.deepEqual(parseDykStatus("{{Article history|dykdate=20260930}}"), {
        passed: true,
        date: "2026-09-30",
    });
});

test("DYK records exclude literal examples, candidates, and blank milestone fields", () => {
    for (const source of [
        "<!-- {{DYKtalk|2026年|9月30日}} -->",
        "<nowiki>{{DYKtalk}}</nowiki>",
        "{{DYK<nowiki>literal template name</nowiki>talk}}",
        "<syntaxhighlight lang=wikitext>{{Article history|dykdate=2026-09-30}}</syntaxhighlight>",
        "{{DYKEntry|result=+|article=Example}}",
        "{{Article history|dykdate=|dykentry=Question}}",
        "{{Article history|dykdate={{Unresolved}}}}",
        "{{Article history|dykdate=20260230}}",
        "{{DYKtalk|2026年|9月30日",
    ])
        assert.deepEqual(parseDykStatus(source), { passed: false, date: null });
    assert.deepEqual(
        parseDykStatus("{{DYKtalk|<img src=x onerror=alert(1)>}}"),
        {
            passed: true,
            date: null,
        },
    );
});

test("named DYK banner dates and article histories prefer the latest readable milestone", () => {
    for (const source of [
        "{{DYKtalk|date=2025-08-05}}{{DYKtalk|2016年|3月30日}}",
        "{{DYKtalk|2016年|3月30日}}{{DYKtalk|date=2025-08-05}}",
        "{{Article history|dyk2date=2025-08-05|dyk1date=2016年3月30日}}",
    ]) {
        assert.deepEqual(parseDykStatus(source), {
            passed: true,
            date: "2025-08-05",
        });
    }
});

test("the Redstone circuit talk-page records preserve both successful authors and closing dates", () => {
    const source = `{{DYKtalk|date=2025-08-05}}
{{DYKtalk|2016年|3月30日}}
{{DYKEntry/archive
|article=紅石電路
|author=a2569875
|timestamp=1458900000
|result=+|hash|1459176172
|closets=1459329622
}}
{{DYKEntry/archive
|article=紅石電路
|author=Newbamboo
|timestamp=1754000000
|result=+|hash|1754391689
}}`;
    assert.deepEqual(parseDykStatus(source), {
        passed: true,
        date: "2025-08-05",
        records: [
            { author: "a2569875", date: "2016-03-30", passed: true },
            { author: "Newbamboo", date: "2025-08-05", passed: true },
        ],
    });
});

test("a later failed archive outcome takes precedence over old passed banners", () => {
    assert.deepEqual(
        parseDykStatus(`{{DYKtalk|date=2025-08-05}}
{{DYKEntry/archive|author=Pathfinbird|result=-|hash|1790489824}}`),
        {
            passed: false,
            date: "2026-09-27",
            records: [
                { author: "Pathfinbird", date: "2026-09-27", passed: false },
            ],
        },
    );
});

test("archive records without nomination timestamps use precise closing time and retain source order when wholly undated", () => {
    const source = `{{DYKEntry/archive|author=Same author|result=-|hash|1754395289}}
{{DYKEntry/archive|author=No date one|result=+}}
{{DYKEntry/archive|author=Same author|result=+|hash|1754391689}}
{{DYKEntry/archive|author=No date two|result=-}}`;
    assert.deepEqual(parseDykStatus(source), {
        passed: false,
        date: "2025-08-05",
        records: [
            { author: "No date one", date: null, passed: true },
            { author: "No date two", date: null, passed: false },
            { author: "Same author", date: "2025-08-05", passed: true },
            { author: "Same author", date: "2025-08-05", passed: false },
        ],
    });
});

test("finalized undated archives use nomination chronology without displaying it as the approval date", () => {
    assert.deepEqual(
        parseDykStatus(`{{DYKEntry/archive|author=First|timestamp=1754391689|result=+}}
{{DYKEntry/archive|author=Second|timestamp=1790489824|result=-}}`),
        {
            passed: false,
            date: null,
            records: [
                { author: "First", date: null, passed: true },
                { author: "Second", date: null, passed: false },
            ],
        },
    );
});

test("the latest nomination is selected even when an older nomination closes later", () => {
    const source = `{{DYKEntry/archive|author=Newer nomination|timestamp=1754390000|result=-|hash|1754395289}}
{{DYKEntry/archive|author=Older nomination|timestamp=1754300000|result=+|hash|1754564489}}`;
    assert.deepEqual(parseDykStatus(source), {
        passed: false,
        date: "2025-08-05",
        records: [
            { author: "Older nomination", date: "2025-08-07", passed: true },
            { author: "Newer nomination", date: "2025-08-05", passed: false },
        ],
    });
});

test("the latest nomination may have an unknown outcome date without borrowing its nomination date", () => {
    const source = `{{DYKEntry/archive|author=Latest nomination|timestamp=1790489824|result=-}}
{{DYKEntry/archive|author=Older nomination|timestamp=1754300000|result=+|hash|1754564489}}`;
    assert.deepEqual(parseDykStatus(source), {
        passed: false,
        date: null,
        records: [
            { author: "Older nomination", date: "2025-08-07", passed: true },
            { author: "Latest nomination", date: null, passed: false },
        ],
    });
});

test("DYK candidates, unfinished archives and literal archive examples do not become outcomes", () => {
    for (const source of [
        "{{DYKEntry|author=Candidate|result=+|hash|1754391689}}",
        "{{DYKEntry/archive|author=Candidate|result=?|hash|1754391689}}",
        "{{DYKEntry/archive|author=Candidate|result=+?|hash|1754391689}}",
        "{{DYKEntry/archive|author=Candidate|timestamp=1754391689}}",
        "<!-- {{DYKEntry/archive|author=Example|result=-|hash|1754391689}} -->",
        "<nowiki>{{DYKEntry/archive|author=Example|result=+|hash|1754391689}}</nowiki>",
        "<pre>{{DYKEntry/archive|author=Example|result=-|hash|1754391689}}</pre>",
        "{{DYKEntry<nowiki>literal</nowiki>/archive|author=Example|result=+|hash|1754391689}}",
    ]) {
        assert.deepEqual(parseDykStatus(source), { passed: false, date: null });
    }
});

test("archived authors are plain text and absent or hidden template values do not become account names", () => {
    assert.deepEqual(
        parseDykStatus(`{{DYKEntry/archive|author=[[User:Example|Displayed name]]|result=+|hash|1754391689}}
{{DYKEntry/archive|author=<img src=x onerror=alert(1)>|result=-}}
{{DYKEntry/archive|result=+}}`),
        {
            passed: true,
            date: "2025-08-05",
            records: [
                { author: null, date: null, passed: false },
                { author: null, date: null, passed: true },
                { author: "Example", date: "2025-08-05", passed: true },
            ],
        },
    );
});

function fixture(response: unknown) {
    const queries: Record<string, unknown>[] = [];
    const api = createMediaWikiApi({
        createApi: () => ({
            async get(parameters) {
                queries.push(parameters);
                return response;
            },
            async postWithToken() {
                throw new Error("DYK lookup must be read-only");
            },
        }),
    });
    return { api, queries };
}

test("DYK lookup follows talk redirects and keeps article punctuation", async () => {
    const { api, queries } = fixture({
        query: {
            pages: [
                {
                    revisions: [
                        {
                            slots: {
                                main: {
                                    content:
                                        "{{Article history|dykdate=2026-09-30}}",
                                },
                            },
                        },
                    ],
                },
            ],
        },
    });
    assert.deepEqual(await api.getDykStatus(" Re:Zero_Example "), {
        passed: true,
        date: "2026-09-30",
    });
    assert.equal(queries[0]!.titles, "Talk:Re:Zero Example");
    assert.equal(queries[0]!.redirects, true);
    assert.equal(queries[0]!.rvlimit, 1);
});

test("missing talk pages differ from unreadable or failed DYK queries", async () => {
    assert.deepEqual(
        await fixture({
            query: { pages: [{ missing: true }] },
        }).api.getDykStatus("Example"),
        { passed: false, date: null },
    );
    for (const response of [
        { error: { code: "readonly" } },
        {},
        { query: { pages: [{}] } },
    ])
        await assert.rejects(fixture(response).api.getDykStatus("Example"));
});
