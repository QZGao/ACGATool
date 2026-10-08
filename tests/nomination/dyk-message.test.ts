/**
 * @file tests/nomination/dyk-message.test.ts
 * Purpose: tests / nomination / dyk message.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. Test scenarios
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createTranslator } from "../../src/i18n/index.ts";
import { createDykMessage } from "../../src/features/nomination/dyk-message.ts";

const now = Date.parse("2026-09-30T00:00:00Z");

test("Chinese DYK appearance dates use calendar units and an inline selection link", () => {
    for (const date of ["2026-09-29", "2026年9月29日"]) {
        assert.deepEqual(
            createDykMessage(
                { passed: true, date },
                false,
                false,
                createTranslator("zh-Hans").msg,
                now,
            ),
            {
                beforeLink: "条目于2026年9月29日（1天前）",
                linkLabel: "入选",
                afterLink: "。",
            },
        );
    }
    assert.deepEqual(
        createDykMessage(
            { passed: true, date: "2026-09-29" },
            false,
            false,
            createTranslator("zh-Hant").msg,
            now,
        ),
        {
            beforeLink: "條目於2026年9月29日（1天前）",
            linkLabel: "入選",
            afterLink: "。",
        },
    );
});

test("DYK day counts follow UTC calendar days, including leap days and future dates", () => {
    const msg = createTranslator("en").msg;
    const message = (date: string, time: string) =>
        createDykMessage(
            { passed: true, date },
            false,
            false,
            msg,
            Date.parse(time),
        ).afterLink;
    assert.equal(
        message("2024-02-29", "2024-03-01T00:00:00Z"),
        " on 2024-02-29 (1 day ago).",
    );
    assert.equal(
        message("2024-02-29", "2024-03-01T23:59:59Z"),
        " on 2024-02-29 (1 day ago).",
    );
    assert.equal(
        message("2026-09-30", "2026-09-30T23:59:59Z"),
        " on 2026-09-30 (0 days ago).",
    );
    assert.equal(
        message("2026-10-01", "2026-09-30T00:00:00Z"),
        " on 2026-10-01 (in 1 day).",
    );
});

test("the latest DYK archive keeps its author and treats author placeholders as text", () => {
    assert.deepEqual(
        createDykMessage(
            {
                passed: true,
                date: "2026-09-29",
                records: [
                    { author: "Older", date: "2020-01-01", passed: false },
                    {
                        author: "{selection}<a>Editor</a>",
                        date: "2026-09-29",
                        passed: true,
                    },
                ],
            },
            false,
            false,
            createTranslator("zh-Hans").msg,
            now,
        ),
        {
            beforeLink:
                "最近一次提名主编为{selection}<a>Editor</a>，条目于2026年9月29日（1天前）",
            linkLabel: "入选",
            afterLink: "。",
        },
    );
});

test("undated appearances do not invent a date or age", () => {
    assert.deepEqual(
        createDykMessage(
            { passed: true, date: null },
            false,
            false,
            createTranslator("zh-Hans").msg,
            now,
        ),
        { beforeLink: "条目已", linkLabel: "入选", afterLink: "。" },
    );
});

test("failed and unsuccessful DYK records retain a manual talk-page link", () => {
    const msg = createTranslator("en").msg;
    const failed = createDykMessage(null, false, true, msg, now);
    const rejected = createDykMessage(
        {
            passed: false,
            date: "2026-09-29",
            records: [{ author: "Editor", date: "2026-09-29", passed: false }],
        },
        false,
        false,
        msg,
        now,
    );
    assert.match(failed.beforeLink, /could not be checked/u);
    assert.match(rejected.beforeLink, /Editor; did not pass on 2026-09-29/u);
    for (const message of [failed, rejected]) {
        assert.equal(message.linkLabel, "View talk page");
        assert.equal(message.afterLink, "");
    }
});

test("missing DYK records link the concise recent-record status to the talk page", () => {
    for (const [language, linkLabel] of [
        ["zh-Hans", "近期无DYK记录"],
        ["zh-Hant", "近期無DYK記錄"],
        ["en", "No recent DYK records"],
    ])
        for (const compact of [false, true])
            assert.deepEqual(
                createDykMessage(
                    { passed: false, date: null, records: [] },
                    false,
                    false,
                    createTranslator(language).msg,
                    now,
                    compact,
                ),
                { beforeLink: "", linkLabel, afterLink: "" },
            );
});

test("compact DYK hints put the date before the selection and the author last", () => {
    const status = {
        passed: true,
        date: "2026-09-27",
        records: [
            {
                author: "Perimeter Chou",
                date: "2026-09-27",
                passed: true,
            },
        ],
    };
    assert.deepEqual(
        createDykMessage(
            status,
            false,
            false,
            createTranslator("zh-Hans").msg,
            now,
            true,
        ),
        {
            beforeLink: "于2026年9月27日（3天前）",
            linkLabel: "入选DYK",
            afterLink: "，主编为Perimeter Chou。",
        },
    );
    assert.deepEqual(
        createDykMessage(
            status,
            false,
            false,
            createTranslator("zh-Hant").msg,
            now,
            true,
        ),
        {
            beforeLink: "於2026年9月27日（3天前）",
            linkLabel: "入選DYK",
            afterLink: "，主編為Perimeter Chou。",
        },
    );
    assert.deepEqual(
        createDykMessage(
            status,
            false,
            false,
            createTranslator("en").msg,
            now,
            true,
        ),
        {
            beforeLink: "",
            linkLabel: "Selected for DYK",
            afterLink:
                " on 2026-09-27 (3 days ago); main author: Perimeter Chou.",
        },
    );
});

test("compact banner hints omit unknown authors and undated hints omit dates", () => {
    const msg = createTranslator("zh-Hans").msg;
    assert.deepEqual(
        createDykMessage(
            { passed: true, date: "2026-09-27" },
            false,
            false,
            msg,
            now,
            true,
        ),
        {
            beforeLink: "于2026年9月27日（3天前）",
            linkLabel: "入选DYK",
            afterLink: "。",
        },
    );
    for (const records of [
        undefined,
        [{ author: null, date: null, passed: true }],
    ])
        assert.deepEqual(
            createDykMessage(
                { passed: true, date: null, records },
                false,
                false,
                msg,
                now,
                true,
            ),
            {
                beforeLink: "",
                linkLabel: "入选DYK",
                afterLink: "。",
            },
        );
    assert.deepEqual(
        createDykMessage(
            {
                passed: true,
                date: null,
                records: [{ author: "Editor", date: null, passed: true }],
            },
            false,
            false,
            msg,
            now,
            true,
        ),
        {
            beforeLink: "",
            linkLabel: "入选DYK",
            afterLink: "，主编为Editor。",
        },
    );
});

test("compact rejected nominations keep the latest outcome, date, author, and talk link", () => {
    const msg = createTranslator("zh-Hans").msg;
    const records = [
        { author: "Older", date: "2026-09-20", passed: true },
        { author: "Latest", date: "2026-09-27", passed: false },
    ];
    assert.deepEqual(
        createDykMessage(
            { passed: false, date: "2026-09-27", records },
            false,
            false,
            msg,
            now,
            true,
        ),
        {
            beforeLink: "于2026年9月27日（3天前）未通过DYK，主编为Latest。 ",
            linkLabel: "查看讨论页",
            afterLink: "",
        },
    );
    assert.deepEqual(
        createDykMessage(
            {
                passed: false,
                date: null,
                records: [{ author: null, date: null, passed: false }],
            },
            false,
            false,
            msg,
            now,
            true,
        ),
        {
            beforeLink: "未通过DYK。 ",
            linkLabel: "查看讨论页",
            afterLink: "",
        },
    );
});

test("compact hints keep loading, missing, and lookup failures distinct", () => {
    const msg = createTranslator("en").msg;
    const messages = [
        createDykMessage(null, true, false, msg, now, true),
        createDykMessage(
            { passed: false, date: null },
            false,
            false,
            msg,
            now,
            true,
        ),
        createDykMessage(null, false, true, msg, now, true),
    ];
    assert.match(messages[0].beforeLink, /Checking/u);
    assert.deepEqual(messages[1], {
        beforeLink: "",
        linkLabel: "No recent DYK records",
        afterLink: "",
    });
    assert.match(messages[2].beforeLink, /could not be checked/u);
    for (const message of [messages[0], messages[2]]) {
        assert.equal(message.linkLabel, "View talk page");
        assert.equal(message.afterLink, "");
    }
});

test("compact author text cannot supply or replace selection placeholders", () => {
    assert.deepEqual(
        createDykMessage(
            {
                passed: true,
                date: "2026-09-27",
                records: [
                    {
                        author: "{selection}<a>Editor</a>{authorClause}{date}",
                        date: "2026-09-27",
                        passed: true,
                    },
                ],
            },
            false,
            false,
            createTranslator("zh-Hans").msg,
            now,
            true,
        ),
        {
            beforeLink: "于2026年9月27日（3天前）",
            linkLabel: "入选DYK",
            afterLink: "，主编为{selection}<a>Editor</a>{authorClause}{date}。",
        },
    );
});
