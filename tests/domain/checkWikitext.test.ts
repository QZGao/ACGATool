import assert from "node:assert/strict";
import test from "node:test";

import {
    formatCheckedNominationItemWikitext,
    formatNominationCheckWikitext,
    formatNominationItemWikitext,
    hasMediaFilePrefix,
    normalizeMediaFileName,
    resolveAuthorTarget,
    resolveMediaPageName,
    serializeNominationReason,
} from "../../src/domain/rules.ts";

function ruleStatus(selected: any, desc: any, score: any, overrides = {}) {
    return {
        selected,
        desc,
        ogDesc: desc,
        score,
        maxScore: score,
        ...overrides,
    };
}

test("Rule 7 selection serializes directly to its canonical code", () => {
    assert.deepEqual(
        serializeNominationReason(
            {
                "7": ruleStatus(true, "他薦", 0.5),
            },
            ["7"],
        ),
        {
            ok: true,
            reasonText: "7",
            unselectedReasonText: "",
            reasonScore: 0.5,
        },
    );
});

test("Rule 3 supports an editable reason and score override", () => {
    const status = {
        selected: true,
        desc: "custom_reason",
        ogDesc: "格式",
        score: 1,
        maxScore: 1,
    };
    assert.equal(
        serializeNominationReason({ "3": status }, ["3"]).reasonText,
        "3(custom_reason)",
    );
    status.score = 2.5;
    assert.equal(
        serializeNominationReason({ "3": status }, ["3"]).reasonText,
        "3(custom_reason)[2.5]",
    );
});

test("author activity descriptions preserve complete wikilinks inside reason modifiers", () => {
    const description = "[[WP:NTUWP25|維基百科二十五周年紀念編輯松]]";
    assert.deepEqual(
        serializeNominationReason(
            {
                "4": [
                    {
                        selected: true,
                        desc: description,
                        ogDesc: "活動",
                        score: 1,
                        maxScore: 1,
                    },
                ],
            },
            ["4"],
        ),
        {
            ok: true,
            reasonText: `4(${description})`,
            unselectedReasonText: "",
            reasonScore: 1,
        },
    );
});

test("media page names accept optional namespace prefixes and article fallbacks", () => {
    assert.equal(normalizeMediaFileName(" Example.jpg "), "File:Example.jpg");
    assert.equal(
        normalizeMediaFileName("file:Example.jpg"),
        "File:Example.jpg",
    );
    assert.equal(
        normalizeMediaFileName("檔案:Example.jpg"),
        "File:Example.jpg",
    );
    assert.equal(
        normalizeMediaFileName("文件:Example.jpg"),
        "File:Example.jpg",
    );
    assert.equal(
        normalizeMediaFileName(" : Image : Example.jpg "),
        "File:Example.jpg",
    );
    assert.equal(
        normalizeMediaFileName("圖像:Example.jpg"),
        "File:Example.jpg",
    );
    assert.equal(
        normalizeMediaFileName("图像:Example.jpg"),
        "File:Example.jpg",
    );
    assert.equal(normalizeMediaFileName("File:   "), "");
    assert.equal(normalizeMediaFileName("  "), "");
    assert.equal(hasMediaFilePrefix(" : file : Example.jpg"), true);
    assert.equal(hasMediaFilePrefix("圖像:Example.jpg"), true);
    assert.equal(hasMediaFilePrefix("Example.jpg"), false);
    assert.equal(
        resolveMediaPageName({ fileName: "Cover.png", usagePageName: "條目" }),
        "File:Cover.png",
    );
    assert.equal(
        resolveMediaPageName({ fileName: "", usagePageName: "  條目  " }),
        "條目",
    );
    assert.equal(
        resolveMediaPageName({ pageName: " file:Cover.png " }),
        "File:Cover.png",
    );
    assert.equal(resolveMediaPageName({ pageName: " 使用條目 " }), "使用條目");
});

test("author targets follow the active category", () => {
    assert.deepEqual(
        resolveAuthorTarget({
            activeRuleCategory: "article",
            pageName: "  一般條目  ",
        }),
        {
            ok: true,
            pageName: "一般條目",
            family: "article",
        },
    );

    assert.deepEqual(
        resolveAuthorTarget({
            activeRuleCategory: "media",
            media: { pageName: " File:Cover.png " },
        }),
        {
            ok: true,
            pageName: "File:Cover.png",
            family: "media",
        },
    );

    assert.deepEqual(
        resolveAuthorTarget(
            {
                activeRuleCategory: "recommendation",
                pageName: "不採用這個名稱",
            },
            "他荐",
        ),
        {
            ok: true,
            pageName: "他荐",
            family: "recommendation",
        },
    );

    assert.deepEqual(
        resolveAuthorTarget({
            activeRuleCategory: "other",
            otherPageName: "  Template:範例  ",
        }),
        {
            ok: true,
            pageName: "Template:範例",
            family: "other",
        },
    );
});

test("the active author category selects the target and ignores other rule families", () => {
    const nomination = {
        pageName: "一般條目",
        media: { pageName: " file:Cover.png " },
        otherPageName: "Template:範例",
        ruleStatus: {
            "1c": { selected: true },
            "5": { selected: true },
            "6": { selected: true },
            "7": { selected: true },
            "8": { selected: true },
        },
    };

    assert.deepEqual(
        resolveAuthorTarget({ ...nomination, activeRuleCategory: "article" }),
        {
            ok: true,
            pageName: "一般條目",
            family: "article",
        },
    );
    assert.deepEqual(
        resolveAuthorTarget({ ...nomination, activeRuleCategory: "review" }),
        {
            ok: true,
            pageName: "一般條目",
            family: "review",
        },
    );
    assert.deepEqual(
        resolveAuthorTarget({ ...nomination, activeRuleCategory: "media" }),
        {
            ok: true,
            pageName: "File:Cover.png",
            family: "media",
        },
    );
    assert.deepEqual(
        resolveAuthorTarget(
            { ...nomination, activeRuleCategory: "recommendation" },
            "他荐",
        ),
        {
            ok: true,
            pageName: "他荐",
            family: "recommendation",
        },
    );
    assert.deepEqual(
        resolveAuthorTarget({ ...nomination, activeRuleCategory: "other" }),
        {
            ok: true,
            pageName: "Template:範例",
            family: "other",
        },
    );
});

test("author target validation requires a category and rejects missing targets", () => {
    assert.deepEqual(
        resolveAuthorTarget({
            activeRuleCategory: "article",
            pageName: " ",
        }),
        {
            ok: false,
            code: "missing-page-name",
            pageName: "",
        },
    );
    assert.deepEqual(
        resolveAuthorTarget({
            activeRuleCategory: "media",
            media: { pageName: "" },
        }),
        {
            ok: false,
            code: "missing-media-target",
            pageName: "",
        },
    );
    assert.deepEqual(
        resolveAuthorTarget({
            activeRuleCategory: "media",
            media: { fileName: "Cover.png", usagePageName: "條目" },
        }),
        {
            ok: false,
            code: "ambiguous-media-target",
            pageName: "",
        },
    );
    assert.deepEqual(
        resolveAuthorTarget({
            activeRuleCategory: "other",
            otherPageName: "",
        }),
        {
            ok: true,
            pageName: "其他",
            family: "other",
        },
    );
    assert.deepEqual(
        resolveAuthorTarget({
            pageName: "同一條目",
            ruleStatus: {
                "1c": { selected: true },
                "5a": { selected: true },
            },
        }),
        {
            ok: false,
            code: "missing-author-category",
            pageName: "",
        },
    );
});

test("blank Rule 8 related page serializes with the canonical 其他 target", () => {
    const target = resolveAuthorTarget({
        activeRuleCategory: "other",
        otherPageName: "",
    });
    const source = formatNominationItemWikitext(
        {
            pageName: target.pageName,
            awarder: "Example",
        },
        1,
        "8(其他貢獻)[1]",
    );

    assert.match(source, /^\|條目名稱1 = 其他$/m);
});

test("check wikitext serializes accepted and rejected rules with score and comment", () => {
    const nomination = {
        message: "附註",
        ruleStatus: {
            "4": ruleStatus(true, "活動", 1),
            "4-dyk": ruleStatus(false, "DYK", 1),
            "6": ruleStatus(true, "媒體", 3),
        },
    };

    assert.deepEqual(
        formatNominationCheckWikitext(nomination, ["4", "4-dyk", "6"]),
        {
            ok: true,
            wikitext: "{{ACG提名2/check|ver=1|4 6|no=4-dyk}}附註--~~~~",
            reasonScore: 4,
        },
    );
});

test("pending markers are emitted for requests and ignored for checks", () => {
    const statuses = {
        "2-c": ruleStatus(true, "丙級", 1, { pending: true }),
        "4": ruleStatus(true, "活動", 1, { pending: true, desc: "動員令" }),
        "4-dyk": ruleStatus(false, "DYK", 1, { pending: true }),
    };

    assert.equal(
        serializeNominationReason(statuses, ["2-c", "4", "4-dyk"]).reasonText,
        "2-c? 4?(動員令)",
    );
    assert.deepEqual(
        formatNominationCheckWikitext({ ruleStatus: statuses }, [
            "2-c",
            "4",
            "4-dyk",
        ]),
        {
            ok: true,
            wikitext: "{{ACG提名2/check|ver=1|2-c 4(動員令)|no=4-dyk}}--~~~~",
            reasonScore: 2,
        },
    );
});

test("unselecting every rule marks the nomination invalid", () => {
    const nomination = {
        ruleStatus: {
            "4": ruleStatus(false, "活動", 1),
            "6": ruleStatus(false, "媒體", 3),
        },
    };

    assert.deepEqual(formatNominationCheckWikitext(nomination, ["4", "6"]), {
        ok: true,
        wikitext: "{{ACG提名2/check|ver=1|0}}--~~~~",
        reasonScore: 0,
    });
});

test("check wikitext preserves repeated Rule 4 instances independently", () => {
    const nomination = {
        ruleStatus: {
            "4": [
                ruleStatus(true, "活動", 1, { desc: "動員令" }),
                ruleStatus(false, "活動", 1, { desc: "編輯松", score: 0.5 }),
            ],
            "4-dyk": [ruleStatus(true, "DYK", 1), ruleStatus(true, "DYK", 1)],
        },
    };

    assert.deepEqual(
        formatNominationCheckWikitext(nomination, ["4", "4-dyk"]),
        {
            ok: true,
            wikitext:
                "{{ACG提名2/check|ver=1|4(動員令) 4-dyk 4-dyk|no=4(編輯松)[0.5]}}--~~~~",
            reasonScore: 3,
        },
    );
});

test("ordered check token rows preserve occurrences and resolve pending markers", () => {
    const ruleDict: Record<string, any> = {
        "4": { label: "活動", score: 1 },
        "4-dyk": { label: "DYK", score: 1 },
        "6": { label: "媒體", score: 3 },
    };
    const nomination = {
        message: "已核對",
        ruleTokens: [
            {
                code: "4-dyk",
                pending: true,
                comment: "舊描述",
                scoreOverride: 9,
                selected: true,
                desc: "DYK",
                score: 1,
            },
            {
                code: "4",
                pending: true,
                comment: null,
                scoreOverride: null,
                selected: false,
                desc: "動員 令",
                score: 0.5,
            },
            {
                code: "6",
                pending: true,
                comment: null,
                scoreOverride: null,
                selected: true,
                desc: "媒體",
                score: 2.5,
            },
            {
                code: "4-dyk",
                pending: false,
                comment: null,
                scoreOverride: null,
                selected: true,
                desc: "二次 DYK",
                score: 0.5,
            },
        ],
    };

    assert.deepEqual(formatNominationCheckWikitext(nomination, [], ruleDict), {
        ok: true,
        wikitext:
            "{{ACG提名2/check|ver=1|4-dyk 6[2.5] 4-dyk(二次&nbsp;DYK)[0.5]|no=4(動員&nbsp;令)[0.5]}}已核對--~~~~",
        reasonScore: 4,
    });
});

test("ordered check token rows use live fields and bypass abandoned invalid rows", () => {
    const ruleDict: Record<string, any> = { "4": { label: "活動", score: 1 } };

    assert.deepEqual(
        formatNominationCheckWikitext(
            {
                message: "無效",
                ruleTokens: [
                    {
                        code: "4",
                        pending: true,
                        comment: "舊值",
                        scoreOverride: 99,
                        selected: false,
                        desc: "",
                        score: Number.NaN,
                    },
                ],
            },
            [],
            ruleDict,
        ),
        {
            ok: true,
            wikitext: "{{ACG提名2/check|ver=1|0}}無效--~~~~",
            reasonScore: 0,
        },
    );

    const invalid = formatNominationCheckWikitext(
        {
            ruleTokens: [
                {
                    code: "4",
                    pending: false,
                    comment: null,
                    scoreOverride: null,
                    selected: true,
                    desc: "活動",
                    score: 0.25,
                },
            ],
        },
        [],
        ruleDict,
    );
    assert.deepEqual(invalid, {
        ok: false,
        error: { code: "invalid-score", rule: "4", occurrence: 0 },
    });
});

test("an all-unselected nomination bypasses abandoned malformed scores", () => {
    const nomination = {
        message: "提名無效",
        ruleStatus: {
            "6": ruleStatus(false, "媒體", 3, { score: Number.NaN }),
        },
    };

    assert.deepEqual(formatNominationCheckWikitext(nomination, ["6"]), {
        ok: true,
        wikitext: "{{ACG提名2/check|ver=1|0}}提名無效--~~~~",
        reasonScore: 0,
    });
});

test("check wikitext forwards serializer validation errors without partial output", () => {
    const result = formatNominationCheckWikitext(
        {
            ruleStatus: {
                "6": ruleStatus(true, "媒體", 3, { score: 0.25 }),
            },
        },
        ["6"],
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "invalid-score");
    assert.equal(result.error.rule, "6");
    assert.equal(Object.hasOwn(result, "wikitext"), false);
});

test("checked item preview exactly combines immutable request and live check wikitext", () => {
    const nomination = {
        pageName: "  岬奈子  ",
        awarder: "  Yumeto  ",
        ruleStatus: {
            "6": ruleStatus(true, "媒體", 3),
        },
    };
    const formattedCheck = formatNominationCheckWikitext(nomination, ["6"]);
    assert.equal(formattedCheck.ok, true);

    assert.equal(
        formatCheckedNominationItemWikitext(
            nomination,
            1,
            "6",
            formattedCheck.wikitext,
        ),
        [
            "|條目名稱1 = 岬奈子",
            "|用戶名稱1 = Yumeto",
            "|提名理由1 = {{ACG提名2/request|ver=1|6}}",
            "|核對用1 = {{ACG提名2/check|ver=1|6}}--~~~~",
        ].join("\n"),
    );
});

test("checked item preview requires a positive integer position", () => {
    for (const position of [0, -1, 1.5, Number.NaN]) {
        assert.throws(
            () => formatCheckedNominationItemWikitext({}, position, "", ""),
            RangeError,
        );
    }
});
