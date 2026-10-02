/**
 * @file tests/domain/rule-forms.test.ts
 * Purpose: tests / domain / rule forms.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. expectedReviewCode
 * 4. makeReviewRuleDict
 * 5. selectedStatus
 * 6. selectedRules
 * 7. Test scenarios
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
    ACTIVITY_DEFAULT_RULES,
    ACTIVITY_RULES,
    CONTENT_EXPANSION_RULES,
    QUALITY_LEVELS,
    QUALITY_RULES,
    REVIEW_APPLY_MODE,
    REVIEW_ASPECT_ROWS,
    REVIEW_TIERS,
    addActivityDraftRow,
    allocateQualityScore,
    applyActivityDraft,
    applyContentExpansionChoice,
    applyQualityDraft,
    applyReviewDraft,
    getActivityDraft,
    getContentExpansionDraft,
    getContentExpansionMenuItems,
    getQualityDraft,
    getReviewDefaultScore,
    getReviewDraft,
    NominationRuleSet,
    normalizeQualityScore,
    qualityTotal,
    reviewCode,
    serializeNominationReason,
    validateActivityDraft,
} from "../../src/domain/rules.ts";

const QUALITY_SCORES: Record<string, any> = [1, 3, 5, 10];
const CONTENT_EXPANSION_RULE_DICT = {
    "1a": { rule: "1a", label: "短擴充", score: 1 },
    "1b": { rule: "1b", label: "中擴充", score: 2 },
    "1c": { rule: "1c", label: "長擴充", score: 3 },
};
const QUALITY_RULE_DICT = Object.fromEntries(
    QUALITY_RULES.map((rule: any, index: any) => [
        rule,
        {
            rule,
            label: `quality:${rule}`,
            score: QUALITY_SCORES[index],
        },
    ]),
);

const TIER_SUFFIXES: Record<string, any> = {
    none: "",
    bcr: "-bcr",
    gan: "-gan",
    acr: "-acr",
    fac: "-fac",
};
const REVIEW_PREFIXES: Record<string, any> = {
    general: "5",
    writing: "5a",
    coverage: "5b",
    source: "5c",
};
const REVIEW_ROWS = Object.keys(REVIEW_PREFIXES);
const REVIEW_BASE_SCORES: Record<string, any> = {
    none: 1,
    bcr: 1,
    gan: 1,
    acr: 2,
    fac: 2,
};
const COMPLETE_REVIEW_SCORES: Record<string, any> = {
    none: 3,
    bcr: 3,
    gan: 3,
    acr: 6,
    fac: 6,
};
function expectedReviewCode(row: any, tier: any, quick: any) {
    return `${REVIEW_PREFIXES[row]}${TIER_SUFFIXES[tier]}${quick ? "-half" : ""}`;
}

function makeReviewRuleDict() {
    const ruleDict: Record<string, any> = {};
    for (const row of REVIEW_ROWS) {
        for (const tier of Object.keys(TIER_SUFFIXES)) {
            for (const quick of [false, true]) {
                const rule = expectedReviewCode(row, tier, quick);
                ruleDict[rule] = {
                    rule,
                    label: `review:${rule}`,
                    score: REVIEW_BASE_SCORES[tier] / (quick ? 2 : 1),
                };
            }
        }
    }
    for (const tier of Object.keys(TIER_SUFFIXES)) {
        const rule = `5x${TIER_SUFFIXES[tier]}`;
        ruleDict[rule] = {
            rule,
            label: `review:${rule}`,
            score: COMPLETE_REVIEW_SCORES[tier],
        };
    }
    return ruleDict;
}

const REVIEW_RULE_DICT = makeReviewRuleDict();
const { ruleDict: PRODUCTION_RULE_DICT } = NominationRuleSet();
const ACTIVITY_RULE_DICT = Object.fromEntries(
    ACTIVITY_RULES.map((rule: any) => [rule, PRODUCTION_RULE_DICT[rule]]),
);

function selectedStatus(rule: any, ruleDict: any, overrides = {}) {
    return {
        selected: true,
        desc: ruleDict[rule].label,
        score: ruleDict[rule].score,
        ...overrides,
    };
}

function selectedRules(ruleStatus: Record<string, any>, prefix = "") {
    return Object.entries(ruleStatus)
        .filter(([rule, status]) => rule.startsWith(prefix) && status?.selected)
        .map(([rule]) => rule)
        .sort();
}

test("compact form metadata uses the canonical activity, quality, and review rows", () => {
    assert.deepEqual(CONTENT_EXPANSION_RULES, ["1a", "1b", "1c"]);
    assert.deepEqual(ACTIVITY_RULES, [
        "4",
        "4-req",
        "4-dyk",
        "4-req-game",
        "4-req-ac",
    ]);
    assert.deepEqual(ACTIVITY_DEFAULT_RULES, ["4-dyk"]);
    assert.deepEqual(
        QUALITY_LEVELS.map((level: any) => level.value),
        ["base", "c", "b", "ga", "fa"],
    );
    assert.deepEqual(QUALITY_RULES, ["2-c", "2-b", "2-ga", "2-fa"]);
    assert.deepEqual(REVIEW_ASPECT_ROWS, ["writing", "coverage", "source"]);
    assert.deepEqual(REVIEW_APPLY_MODE, {
        GENERAL: "general",
        ASPECTS: "aspects",
        COMPLETE: "complete",
    });
});

test("content expansion menu contains only the three canonical presets", () => {
    assert.deepEqual(
        getContentExpansionMenuItems(CONTENT_EXPANSION_RULE_DICT),
        [
            { label: "短擴充", value: "短擴充" },
            { label: "中擴充", value: "中擴充" },
            { label: "長擴充", value: "長擴充" },
        ],
    );
});

test("content expansion presets occupy one rule and automatically restore 1, 2, or 3 points", () => {
    const ruleStatus: Record<string, any> = {};
    const draft = getContentExpansionDraft(
        ruleStatus,
        CONTENT_EXPANSION_RULE_DICT,
    );

    assert.deepEqual(draft, {
        legacy: false,
        enabled: false,
        rule: "1c",
        choice: "長擴充",
        score: 3,
    });
    draft.enabled = true;
    for (const [choice, expectedRule, expectedScore] of [
        ["短擴充", "1a", 1],
        ["中擴充", "1b", 2],
        ["長擴充", "1c", 3],
    ]) {
        applyContentExpansionChoice(
            ruleStatus,
            draft,
            choice,
            CONTENT_EXPANSION_RULE_DICT,
        );
        assert.equal(draft.rule, expectedRule);
        assert.equal(draft.enabled, true);
        assert.equal(draft.choice, choice);
        assert.equal(draft.score, expectedScore);
        assert.deepEqual(
            CONTENT_EXPANSION_RULES.filter(
                (rule: any) => ruleStatus[rule].selected,
            ),
            [expectedRule],
        );
        assert.equal(ruleStatus[expectedRule].score, expectedScore);
        assert.equal(ruleStatus[expectedRule].maxScore, expectedScore);
    }

    draft.enabled = false;
    applyContentExpansionChoice(
        ruleStatus,
        draft,
        draft.choice,
        CONTENT_EXPANSION_RULE_DICT,
    );
    assert.deepEqual(draft, {
        legacy: false,
        enabled: false,
        rule: "1c",
        choice: "長擴充",
        score: 3,
    });
    assert.deepEqual(
        CONTENT_EXPANSION_RULES.filter(
            (rule: any) => ruleStatus[rule].selected,
        ),
        [],
    );
});

test("custom content expansion text and score stay in the same compact row", () => {
    const ruleStatus: Record<string, any> = {};
    const draft = getContentExpansionDraft(
        ruleStatus,
        CONTENT_EXPANSION_RULE_DICT,
    );
    draft.enabled = true;

    applyContentExpansionChoice(
        ruleStatus,
        draft,
        "長擴充",
        CONTENT_EXPANSION_RULE_DICT,
    );
    applyContentExpansionChoice(
        ruleStatus,
        draft,
        "",
        CONTENT_EXPANSION_RULE_DICT,
    );
    assert.deepEqual(draft, {
        legacy: false,
        enabled: true,
        rule: "1c",
        choice: "",
        score: 3,
    });
    applyContentExpansionChoice(
        ruleStatus,
        draft,
        "7.7 kB擴充",
        CONTENT_EXPANSION_RULE_DICT,
    );

    assert.deepEqual(draft, {
        legacy: false,
        enabled: true,
        rule: "1c",
        choice: "7.7 kB擴充",
        score: 3,
    });
    assert.deepEqual(ruleStatus["1c"], {
        selected: true,
        desc: "7.7 kB擴充",
        ogDesc: "長擴充",
        score: 3,
        maxScore: 3,
    });

    draft.score = 2.5;
    ruleStatus["1c"].score = 2.5;
    applyContentExpansionChoice(
        ruleStatus,
        draft,
        "7.7 kB擴充",
        CONTENT_EXPANSION_RULE_DICT,
    );
    assert.equal(draft.score, 2.5);
    assert.equal(ruleStatus["1c"].score, 2.5);
    assert.equal(ruleStatus["1c"].maxScore, 3);

    applyContentExpansionChoice(
        ruleStatus,
        draft,
        "不適用",
        CONTENT_EXPANSION_RULE_DICT,
    );
    assert.equal(draft.enabled, true);
    assert.equal(ruleStatus["1c"].selected, true);
    assert.equal(ruleStatus["1c"].desc, "不適用");
});

test("content expansion hydration preserves custom text and score and rejects multi-rule legacy shapes", () => {
    assert.deepEqual(
        getContentExpansionDraft(
            {
                "1c": {
                    selected: true,
                    desc: "7.7 kB擴充",
                    ogDesc: "長擴充",
                    score: 3,
                    maxScore: 3,
                },
            },
            CONTENT_EXPANSION_RULE_DICT,
        ),
        {
            legacy: false,
            enabled: true,
            rule: "1c",
            choice: "7.7 kB擴充",
            score: 3,
        },
    );
    assert.deepEqual(
        getContentExpansionDraft(
            {
                "1a": { selected: true, desc: "短擴充", score: 1 },
                "1b": { selected: true, desc: "中擴充", score: 2 },
            },
            CONTENT_EXPANSION_RULE_DICT,
        ),
        { legacy: true },
    );
    assert.deepEqual(
        getContentExpansionDraft(
            {
                "1c": { selected: true, desc: "長擴充", score: 2.5 },
            },
            CONTENT_EXPANSION_RULE_DICT,
        ),
        {
            legacy: false,
            enabled: true,
            rule: "1c",
            choice: "長擴充",
            score: 2.5,
        },
    );
});

test("every compact mapping exists in the production nomination rule set", () => {
    const { ruleDict } = NominationRuleSet();

    for (const rule of QUALITY_RULES) {
        assert.ok(ruleDict[rule], `missing quality rule ${rule}`);
    }
    for (const row of REVIEW_ROWS) {
        for (const tier of REVIEW_TIERS) {
            for (const quick of [false, true]) {
                const rule = reviewCode(row, tier.value, quick);
                assert.ok(ruleDict[rule], `missing review rule ${rule}`);
                assert.equal(rule.startsWith("5x"), false);
            }
        }
    }
    for (const tier of REVIEW_TIERS) {
        const rule = `5x${tier.suffix}`;
        assert.ok(ruleDict[rule], `missing complete review rule ${rule}`);
    }
});

test("activity defaults are seeded only when explicitly requested", () => {
    assert.deepEqual(getActivityDraft({}, ACTIVITY_RULE_DICT), { rows: [] });

    const draft = getActivityDraft({}, ACTIVITY_RULE_DICT, {
        seedDefaults: true,
    });

    assert.deepEqual(
        draft.rows.map((row: any) => row.rule),
        ["4-dyk"],
    );
    assert.deepEqual(
        draft.rows.map((row: any) => row.selected),
        [false],
    );
    assert.deepEqual(
        draft.rows.map((row: any) => row.choice),
        [ACTIVITY_RULE_DICT["4-dyk"].label],
    );
    assert.equal(
        new Set(draft.rows.map((row: any) => row.id)).size,
        draft.rows.length,
    );
    assert.deepEqual(validateActivityDraft(draft), { ok: true });

    const ruleStatus: Record<string, any> = {};
    assert.deepEqual(
        applyActivityDraft(ruleStatus, draft, ACTIVITY_RULE_DICT),
        { ok: true },
    );
    const hydrated = getActivityDraft(ruleStatus, ACTIVITY_RULE_DICT);
    assert.deepEqual(
        hydrated.rows.map((row: any) => row.id),
        draft.rows.map((row: any) => row.id),
    );
});

test("activity drafts hydrate every stored occurrence without synthesizing missing defaults", () => {
    const ruleStatus: Record<string, any> = {
        "4": [
            {
                id: "four-1",
                selected: true,
                desc: "動員令",
                score: 1.5,
                pending: true,
            },
            {
                id: "four-2",
                selected: false,
                desc: ACTIVITY_RULE_DICT["4"].label,
                score: 1,
            },
        ],
        "4-dyk": [
            {
                id: "dyk-1",
                selected: true,
                desc: ACTIVITY_RULE_DICT["4-dyk"].label,
                score: 1,
            },
            { id: "dyk-2", selected: true, desc: "每週一條", score: 0.5 },
        ],
        "4-req-game": {
            selected: true,
            desc: "遊戲請求",
            score: 2,
            pending: true,
        },
        "4-req-ac": { selected: false, desc: "placeholder", score: 99 },
    };
    const before = structuredClone(ruleStatus);
    const draft = getActivityDraft(ruleStatus, ACTIVITY_RULE_DICT);

    assert.equal(draft.rows.length, 5);
    assert.deepEqual(
        draft.rows
            .filter((row: any) => row.rule === "4")
            .map((row: any) => row.id),
        ["four-1", "four-2"],
    );
    assert.equal(
        draft.rows.find((row: any) => row.id === "four-2")?.selected,
        false,
        "unchecked array rows are preserved",
    );
    assert.deepEqual(
        draft.rows
            .filter((row: any) => row.rule === "4-dyk")
            .map((row: any) => row.id),
        ["dyk-1", "dyk-2"],
    );
    assert.equal(
        draft.rows.filter((row: any) => row.rule === "4-req").length,
        0,
        "missing request is not synthesized",
    );
    assert.equal(
        draft.rows.some((row: any) => row.rule === "4-req-ac"),
        false,
        "legacy unselected placeholders are ignored",
    );
    assert.equal(
        draft.rows.find((row: any) => row.rule === "4-req-game")?.choice,
        "遊戲請求",
    );
    assert.equal(
        draft.rows.find((row: any) => row.id === "four-1")?.pending,
        true,
    );
    assert.equal(
        draft.rows.find((row: any) => row.id === "four-2")?.pending,
        false,
    );
    assert.equal(
        draft.rows.find((row: any) => row.rule === "4-req-game")?.pending,
        true,
    );
    assert.deepEqual(
        ruleStatus,
        before,
        "hydration does not mutate persisted activity rows",
    );
});

test("activity validation permits unlimited duplicate rules and descriptions but requires unique row ids", () => {
    const draft = {
        rows: Array.from({ length: 40 }, (_unused: any, index: any) => ({
            id: `repeat-${index}`,
            rule: index % 2 === 0 ? "4-dyk" : "4",
            selected: true,
            choice: "同一活動",
            score: index % 3 === 0 ? 0.5 : 1,
        })),
    };

    assert.deepEqual(validateActivityDraft(draft), { ok: true });
    draft.rows[39].id = draft.rows[0].id;
    assert.deepEqual(validateActivityDraft(draft), {
        ok: false,
        code: "duplicate-id",
        row: 39,
    });

    draft.rows[39].id = "repeat-39";
    draft.rows[17].score = 1.2;
    assert.deepEqual(validateActivityDraft(draft), {
        ok: false,
        code: "invalid-score",
        row: 17,
    });
});

test("activity descriptions accept text that the reason serializer will encode safely", () => {
    const draft = {
        rows: [
            {
                id: "safe-custom-text",
                rule: "4",
                selected: true,
                choice: "基礎條目 | 擴充（夏季）[測試]",
                score: 1,
            },
        ],
    };

    assert.deepEqual(validateActivityDraft(draft), { ok: true });
    const ruleStatus: Record<string, any> = {};
    assert.deepEqual(
        applyActivityDraft(ruleStatus, draft, ACTIVITY_RULE_DICT),
        { ok: true },
    );
    assert.equal(ruleStatus["4"][0].desc, "基礎條目 | 擴充（夏季）[測試]");
});

test("addActivityDraftRow always appends a selected generic activity with a unique stable id", () => {
    const draft = getActivityDraft({}, ACTIVITY_RULE_DICT, {
        seedDefaults: true,
    });
    const originalIds = draft.rows.map((row: any) => row.id);

    const added = Array.from({ length: 12 }, () =>
        addActivityDraftRow(draft, ACTIVITY_RULE_DICT),
    );

    assert.equal(added.every(Boolean), true);
    assert.equal(
        added.every((row: any) => row.rule === "4"),
        true,
    );
    assert.equal(
        added.every((row: any) => row.selected),
        true,
    );
    assert.equal(
        added.every((row: any) => row.choice === ACTIVITY_RULE_DICT["4"].label),
        true,
    );
    assert.equal(
        new Set(draft.rows.map((row: any) => row.id)).size,
        draft.rows.length,
    );
    assert.deepEqual(
        draft.rows.slice(0, originalIds.length).map((row: any) => row.id),
        originalIds,
    );
});

test("applyActivityDraft remaps known choices, retains custom backing rules, and rebuilds grouped arrays", () => {
    const draft = {
        rows: [
            {
                id: "default-dyk",
                rule: "4-dyk",
                selected: false,
                choice: ACTIVITY_RULE_DICT["4-dyk"].label,
                score: 1,
            },
            {
                id: "default-request",
                rule: "4-req",
                selected: false,
                choice: ACTIVITY_RULE_DICT["4-req"].label,
                score: 1,
            },
            {
                id: "known-code",
                rule: "4",
                selected: true,
                choice: "4-dyk",
                score: "1.5",
                pending: true,
            },
            {
                id: "known-description",
                rule: "4",
                selected: true,
                choice: ACTIVITY_RULE_DICT["4-req-game"].label,
                score: 2,
            },
            {
                id: "custom-1",
                rule: "4-req-ac",
                selected: true,
                choice: "動員令",
                score: 2,
            },
            {
                id: "custom-2",
                rule: "4-req-ac",
                selected: true,
                choice: "動員令",
                score: 0.5,
            },
        ],
    };
    const ruleStatus: Record<string, any> = {
        "4": [{ id: "stale", selected: true, desc: "stale", score: 99 }],
        other: { selected: true, marker: "keep" },
    };

    assert.deepEqual(
        applyActivityDraft(ruleStatus, draft, ACTIVITY_RULE_DICT),
        { ok: true },
    );
    assert.deepEqual(
        Object.fromEntries(
            ACTIVITY_RULES.map((rule: any) => [rule, ruleStatus[rule].length]),
        ),
        {
            "4": 0,
            "4-req": 1,
            "4-dyk": 2,
            "4-req-game": 1,
            "4-req-ac": 2,
        },
    );
    assert.deepEqual(ruleStatus.other, { selected: true, marker: "keep" });

    const remappedByCode = ruleStatus["4-dyk"].find(
        (status: any) => status.id === "known-code",
    );
    assert.deepEqual(remappedByCode, {
        id: "known-code",
        selected: true,
        desc: ACTIVITY_RULE_DICT["4-dyk"].label,
        ogDesc: ACTIVITY_RULE_DICT["4-dyk"].label,
        score: 1.5,
        maxScore: ACTIVITY_RULE_DICT["4-dyk"].score,
        pending: true,
    });
    assert.equal(
        ruleStatus["4-req-game"][0].desc,
        ACTIVITY_RULE_DICT["4-req-game"].label,
    );
    assert.deepEqual(
        ruleStatus["4-req-ac"].map((status: any) => status.desc),
        ["動員令", "動員令"],
    );
    assert.deepEqual(
        ruleStatus["4-req-ac"].map((status: any) => status.score),
        [2, 0.5],
    );
    assert.equal(
        draft.rows.find((row: any) => row.id === "known-code")?.rule,
        "4-dyk",
    );
    assert.equal(
        draft.rows.find((row: any) => row.id === "known-description")?.rule,
        "4-req-game",
    );
    assert.equal(
        draft.rows.find((row: any) => row.id === "custom-1")?.rule,
        "4-req-ac",
    );

    const roundTrip = getActivityDraft(ruleStatus, ACTIVITY_RULE_DICT);
    assert.deepEqual(
        new Set(roundTrip.rows.map((row: any) => row.id)),
        new Set(draft.rows.map((row: any) => row.id)),
        "stable ids survive apply and hydration",
    );
});

test("normalizeQualityScore accepts editable values and normalizes them to half-point steps", () => {
    assert.equal(normalizeQualityScore(0), 0);
    assert.equal(normalizeQualityScore(-0), 0);
    assert.equal(normalizeQualityScore("2.346"), 2.5);
    assert.equal(normalizeQualityScore(1.005), 1);
    assert.equal(normalizeQualityScore(10.075), 10);
    assert.equal(normalizeQualityScore(2.25), 2.5);

    for (const invalid of [
        null,
        undefined,
        "",
        "  ",
        "not a score",
        NaN,
        Infinity,
        {},
        true,
    ]) {
        assert.equal(
            Number.isNaN(normalizeQualityScore(invalid)),
            true,
            String(invalid),
        );
    }
});

test("qualityTotal calculates every possible upward transition", async (t: any) => {
    for (
        let fromIndex = 0;
        fromIndex < QUALITY_LEVELS.length - 1;
        fromIndex++
    ) {
        for (
            let toIndex = fromIndex + 1;
            toIndex < QUALITY_LEVELS.length;
            toIndex++
        ) {
            const expected = QUALITY_SCORES.slice(fromIndex, toIndex).reduce(
                (total: any, score: any) => total + score,
                0,
            );
            await t.test(
                `${QUALITY_LEVELS[fromIndex].value} -> ${QUALITY_LEVELS[toIndex].value}`,
                () => {
                    assert.equal(
                        qualityTotal(fromIndex, toIndex, QUALITY_RULE_DICT),
                        expected,
                    );
                },
            );
        }
    }
});

test("equal enabled quality levels produce no rule codes and rehydrate as disabled", async (t: any) => {
    for (let index = 0; index < QUALITY_LEVELS.length; index++) {
        await t.test(
            `${QUALITY_LEVELS[index].value} -> ${QUALITY_LEVELS[index].value}`,
            () => {
                assert.equal(qualityTotal(index, index, QUALITY_RULE_DICT), 0);
                assert.deepEqual(
                    allocateQualityScore(index, index, 99, QUALITY_RULE_DICT),
                    [],
                );

                const ruleStatus: Record<string, any> = Object.fromEntries(
                    QUALITY_RULES.map((rule: any) => [
                        rule,
                        {
                            selected: true,
                            pending: true,
                            desc: QUALITY_RULE_DICT[rule].label,
                            score: 99,
                        },
                    ]),
                );
                applyQualityDraft(
                    ruleStatus,
                    {
                        enabled: true,
                        fromIndex: index,
                        toIndex: index,
                        score: 0,
                    },
                    QUALITY_RULE_DICT,
                );

                assert.deepEqual(selectedRules(ruleStatus, "2-"), []);
                assert.equal(
                    QUALITY_RULES.every(
                        (rule: any) =>
                            !Object.hasOwn(ruleStatus[rule], "pending"),
                    ),
                    true,
                );
                assert.deepEqual(
                    getQualityDraft(ruleStatus, QUALITY_RULE_DICT),
                    {
                        legacy: false,
                        enabled: false,
                        fromIndex: 0,
                        toIndex: 1,
                        score: 1,
                    },
                );
            },
        );
    }
});

test("a fresh quality draft is disabled while displaying the base-to-C default", () => {
    const draft = getQualityDraft({}, QUALITY_RULE_DICT);

    assert.deepEqual(draft, {
        legacy: false,
        enabled: false,
        fromIndex: 0,
        toIndex: 1,
        score: 1,
    });
});

test("applyQualityDraft clears every quality rule when the draft is disabled", () => {
    const ruleStatus: Record<string, any> = Object.fromEntries(
        QUALITY_RULES.map((rule: any) => [
            rule,
            {
                selected: true,
                pending: true,
                desc: "stale custom description",
                score: 999,
            },
        ]),
    );
    ruleStatus.other = { selected: true, pending: true };

    applyQualityDraft(
        ruleStatus,
        {
            enabled: false,
            fromIndex: 1,
            toIndex: 4,
            score: 18,
        },
        QUALITY_RULE_DICT,
    );

    for (const rule of QUALITY_RULES) {
        assert.equal(ruleStatus[rule].selected, false);
        assert.equal(ruleStatus[rule].desc, QUALITY_RULE_DICT[rule].label);
        assert.equal(ruleStatus[rule].score, QUALITY_RULE_DICT[rule].score);
        assert.equal(ruleStatus[rule].maxScore, QUALITY_RULE_DICT[rule].score);
        assert.equal(Object.hasOwn(ruleStatus[rule], "pending"), false);
    }
    assert.deepEqual(ruleStatus.other, { selected: true, pending: true });
    assert.deepEqual(getQualityDraft(ruleStatus, QUALITY_RULE_DICT), {
        legacy: false,
        enabled: false,
        fromIndex: 0,
        toIndex: 1,
        score: 1,
    });
});

test("allocateQualityScore preserves canonical scores and apportions custom totals in half points", () => {
    assert.deepEqual(
        allocateQualityScore(0, 4, 19, QUALITY_RULE_DICT),
        [1, 3, 5, 10],
    );
    assert.deepEqual(
        allocateQualityScore(0, 3, 2, QUALITY_RULE_DICT),
        [0, 0.5, 1.5],
    );
    assert.deepEqual(
        allocateQualityScore(0, 3, 4.5, QUALITY_RULE_DICT),
        [0.5, 1.5, 2.5],
    );
    assert.deepEqual(
        allocateQualityScore(0, 4, 20, QUALITY_RULE_DICT),
        [1, 3, 5.5, 10.5],
    );
    assert.deepEqual(
        allocateQualityScore(0, 4, 0, QUALITY_RULE_DICT),
        [0, 0, 0, 0],
    );
    assert.deepEqual(
        allocateQualityScore(2, 3, 1.25, QUALITY_RULE_DICT),
        [1.5],
    );

    const repeatingRatio = allocateQualityScore(0, 3, 2, QUALITY_RULE_DICT);
    assert.equal(
        normalizeQualityScore(
            repeatingRatio.reduce((total: any, score: any) => total + score, 0),
        ),
        2,
    );
});

test("applyQualityDraft treats an omitted enabled flag as enabled and round-trips every transition", async (t: any) => {
    for (
        let fromIndex = 0;
        fromIndex < QUALITY_LEVELS.length - 1;
        fromIndex++
    ) {
        for (
            let toIndex = fromIndex + 1;
            toIndex < QUALITY_LEVELS.length;
            toIndex++
        ) {
            await t.test(
                `${QUALITY_LEVELS[fromIndex].value} -> ${QUALITY_LEVELS[toIndex].value}`,
                () => {
                    const ruleStatus: Record<string, any> = Object.fromEntries(
                        QUALITY_RULES.map((rule: any) => [
                            rule,
                            {
                                selected: true,
                                pending: true,
                                desc: "stale custom description",
                                score: 999,
                            },
                        ]),
                    );
                    const score = qualityTotal(
                        fromIndex,
                        toIndex,
                        QUALITY_RULE_DICT,
                    );

                    applyQualityDraft(
                        ruleStatus,
                        {
                            legacy: false,
                            fromIndex,
                            toIndex,
                            score,
                        },
                        QUALITY_RULE_DICT,
                    );

                    for (let index = 0; index < QUALITY_RULES.length; index++) {
                        const rule = QUALITY_RULES[index];
                        const crossed = index >= fromIndex && index < toIndex;
                        assert.equal(
                            ruleStatus[rule].selected,
                            crossed,
                            `${rule} selected`,
                        );
                        assert.equal(
                            Object.hasOwn(ruleStatus[rule], "pending"),
                            false,
                            `${rule} pending removed`,
                        );
                        assert.equal(
                            ruleStatus[rule].desc,
                            QUALITY_RULE_DICT[rule].label,
                            `${rule} description`,
                        );
                        assert.equal(
                            ruleStatus[rule].score,
                            QUALITY_RULE_DICT[rule].score,
                            `${rule} score`,
                        );
                        assert.equal(
                            ruleStatus[rule].maxScore,
                            QUALITY_RULE_DICT[rule].score,
                            `${rule} max score`,
                        );
                    }
                    assert.deepEqual(
                        getQualityDraft(ruleStatus, QUALITY_RULE_DICT),
                        {
                            legacy: false,
                            enabled: true,
                            fromIndex,
                            toIndex,
                            score,
                        },
                    );
                },
            );
        }
    }
});

test("applyQualityDraft apportions an editable aggregate and recognizes its round trip", () => {
    const ruleStatus: Record<string, any> = Object.fromEntries(
        QUALITY_RULES.map((rule: any) => [
            rule,
            {
                selected: false,
                pending: true,
                desc: QUALITY_RULE_DICT[rule].label,
                score: QUALITY_RULE_DICT[rule].score,
            },
        ]),
    );

    applyQualityDraft(
        ruleStatus,
        {
            fromIndex: 0,
            toIndex: 3,
            score: "2.004",
        },
        QUALITY_RULE_DICT,
    );

    assert.deepEqual(
        QUALITY_RULES.map((rule: any) => ruleStatus[rule].score),
        [0, 0.5, 1.5, 10],
    );
    assert.deepEqual(getQualityDraft(ruleStatus, QUALITY_RULE_DICT), {
        legacy: false,
        enabled: true,
        fromIndex: 0,
        toIndex: 3,
        score: 2,
    });
    for (const rule of QUALITY_RULES) {
        assert.equal(Object.hasOwn(ruleStatus[rule], "pending"), false);
    }
});

test("applyQualityDraft treats equal levels as a zero-point non-improvement and strips pending", () => {
    const ruleStatus: Record<string, any> = {
        "2-c": selectedStatus("2-c", QUALITY_RULE_DICT, {
            pending: true,
            score: 8,
        }),
        other: { selected: true, pending: true },
    };

    applyQualityDraft(
        ruleStatus,
        {
            enabled: true,
            fromIndex: 2,
            toIndex: 2,
            score: 0,
        },
        QUALITY_RULE_DICT,
    );

    for (const rule of QUALITY_RULES) {
        assert.equal(ruleStatus[rule].selected, false);
        assert.equal(ruleStatus[rule].score, QUALITY_RULE_DICT[rule].score);
        assert.equal(Object.hasOwn(ruleStatus[rule], "pending"), false);
    }
    assert.deepEqual(ruleStatus.other, { selected: true, pending: true });
    assert.deepEqual(getQualityDraft(ruleStatus, QUALITY_RULE_DICT), {
        legacy: false,
        enabled: false,
        fromIndex: 0,
        toIndex: 1,
        score: 1,
    });
});

test("applyQualityDraft treats an omitted aggregate as the canonical range total", () => {
    const ruleStatus: Record<string, any> = {};
    applyQualityDraft(
        ruleStatus,
        {
            fromIndex: 1,
            toIndex: 4,
        },
        QUALITY_RULE_DICT,
    );

    assert.deepEqual(getQualityDraft(ruleStatus, QUALITY_RULE_DICT), {
        legacy: false,
        enabled: true,
        fromIndex: 1,
        toIndex: 4,
        score: 18,
    });
});

test("quality pending state applies to every selected transition and round-trips", () => {
    const ruleStatus: Record<string, any> = {};
    applyQualityDraft(
        ruleStatus,
        {
            enabled: true,
            fromIndex: 0,
            toIndex: 3,
            score: 9,
            pending: true,
        },
        QUALITY_RULE_DICT,
    );

    assert.deepEqual(
        QUALITY_RULES.map((rule: any) => Boolean(ruleStatus[rule].pending)),
        [true, true, true, false],
    );
    assert.deepEqual(getQualityDraft(ruleStatus, QUALITY_RULE_DICT), {
        legacy: false,
        enabled: true,
        fromIndex: 0,
        toIndex: 3,
        score: 9,
        pending: true,
    });
    assert.equal(
        serializeNominationReason(ruleStatus, QUALITY_RULES).reasonText,
        "2-c? 2-b? 2-ga?",
    );
});

test("getQualityDraft recognizes canonical, proportional, and single-step custom sequences", async (t: any) => {
    const cases = {
        canonical: {
            status: {
                "2-b": selectedStatus("2-b", QUALITY_RULE_DICT, {
                    pending: true,
                }),
                "2-ga": selectedStatus("2-ga", QUALITY_RULE_DICT, {
                    pending: true,
                }),
                "2-fa": selectedStatus("2-fa", QUALITY_RULE_DICT, {
                    pending: true,
                }),
            },
            expected: {
                legacy: false,
                enabled: true,
                fromIndex: 1,
                toIndex: 4,
                score: 18,
                pending: true,
            },
        },
        proportional: {
            status: {
                "2-c": selectedStatus("2-c", QUALITY_RULE_DICT, { score: "0" }),
                "2-b": selectedStatus("2-b", QUALITY_RULE_DICT, {
                    score: "0.5",
                }),
                "2-ga": selectedStatus("2-ga", QUALITY_RULE_DICT, {
                    score: "1.5",
                }),
            },
            expected: {
                legacy: false,
                enabled: true,
                fromIndex: 0,
                toIndex: 3,
                score: 2,
            },
        },
        "single-step custom": {
            status: {
                "2-b": selectedStatus("2-b", QUALITY_RULE_DICT, { score: 2 }),
            },
            expected: {
                legacy: false,
                enabled: true,
                fromIndex: 1,
                toIndex: 2,
                score: 2,
            },
        },
    };

    for (const [name, { status, expected }] of Object.entries(cases)) {
        await t.test(name, () => {
            const before = structuredClone(status);
            const draft = getQualityDraft(status, QUALITY_RULE_DICT);
            assert.deepEqual(draft, expected);
            assert.equal(
                Boolean("pending" in draft && draft.pending),
                name === "canonical",
            );
            assert.deepEqual(
                status,
                before,
                "parsing does not mutate saved status",
            );
        });
    }
});

test("getQualityDraft preserves non-compact quality data in legacy mode", async (t: any) => {
    const cases = {
        "gapped rules": {
            "2-c": selectedStatus("2-c", QUALITY_RULE_DICT),
            "2-ga": selectedStatus("2-ga", QUALITY_RULE_DICT),
        },
        "custom description": {
            "2-c": selectedStatus("2-c", QUALITY_RULE_DICT, { desc: "custom" }),
        },
        "non-proportional score layout": {
            "2-c": selectedStatus("2-c", QUALITY_RULE_DICT, { score: 0.2 }),
            "2-b": selectedStatus("2-b", QUALITY_RULE_DICT, { score: 0.7 }),
            "2-ga": selectedStatus("2-ga", QUALITY_RULE_DICT, { score: 1.1 }),
        },
        "non-half-point score": {
            "2-c": selectedStatus("2-c", QUALITY_RULE_DICT, { score: 0.333 }),
        },
        "negative score": {
            "2-c": selectedStatus("2-c", QUALITY_RULE_DICT, { score: -1 }),
        },
        "non-finite score": {
            "2-c": selectedStatus("2-c", QUALITY_RULE_DICT, { score: NaN }),
        },
        "mixed pending state": {
            "2-c": selectedStatus("2-c", QUALITY_RULE_DICT, { pending: true }),
            "2-b": selectedStatus("2-b", QUALITY_RULE_DICT),
        },
    };

    for (const [name, ruleStatus] of Object.entries(cases)) {
        await t.test(name, () => {
            assert.deepEqual(getQualityDraft(ruleStatus, QUALITY_RULE_DICT), {
                legacy: true,
            });
        });
    }
});

test("reviewCode maps all 40 editable Rule 5 variants and uses dictionary scores", async (t: any) => {
    for (const row of REVIEW_ROWS) {
        for (const tier of Object.keys(TIER_SUFFIXES)) {
            for (const quick of [false, true]) {
                await t.test(
                    `${row}/${tier}/${quick ? "quick" : "normal"}`,
                    () => {
                        const expected = expectedReviewCode(row, tier, quick);
                        assert.equal(reviewCode(row, tier, quick), expected);
                        assert.equal(
                            getReviewDefaultScore(
                                row,
                                tier,
                                quick,
                                REVIEW_RULE_DICT,
                            ),
                            REVIEW_RULE_DICT[expected].score,
                        );
                    },
                );
            }
        }
    }

    assert.equal(reviewCode("complete", "none", false), "5x");
    assert.equal(reviewCode("complete", "bcr", true), "5x-bcr");
    assert.equal(
        getReviewDefaultScore("complete", "bcr", true, REVIEW_RULE_DICT),
        3,
    );
    assert.throws(() => reviewCode("writing", "unknown", false), {
        name: "TypeError",
    });
    // @ts-expect-error Exercise rejection of a malformed runtime value.
    assert.throws(() => reviewCode("writing", "none", 1), {
        name: "TypeError",
    });
});

test("getReviewDraft recognizes every editable Rule 5 variant without mutating status", async (t: any) => {
    for (const row of REVIEW_ROWS) {
        for (const tier of Object.keys(TIER_SUFFIXES)) {
            for (const quick of [false, true]) {
                await t.test(
                    `${row}/${tier}/${quick ? "quick" : "normal"}`,
                    () => {
                        const rule = expectedReviewCode(row, tier, quick);
                        const ruleStatus: Record<string, any> = {
                            [rule]: selectedStatus(rule, REVIEW_RULE_DICT, {
                                pending: true,
                            }),
                        };
                        const before = structuredClone(ruleStatus);
                        const parsed = getReviewDraft(
                            ruleStatus,
                            REVIEW_RULE_DICT,
                        );

                        assert.equal(Object.hasOwn(parsed, "legacy"), false);
                        assert.equal(
                            parsed.general.selected,
                            row === "general",
                        );
                        for (const aspect of REVIEW_ASPECT_ROWS) {
                            assert.equal(
                                parsed.aspects[aspect].selected,
                                aspect === row,
                            );
                        }
                        const selectedRow =
                            row === "general"
                                ? parsed.general
                                : parsed.aspects[row];
                        assert.deepEqual(selectedRow, {
                            selected: true,
                            tier,
                            quick,
                            score: REVIEW_RULE_DICT[rule].score,
                        });
                        assert.deepEqual(ruleStatus, before);
                    },
                );
            }
        }
    }
});

test("getReviewDraft hydrates independent specialist rows and editable custom scores", () => {
    const ruleStatus: Record<string, any> = {
        "5a-acr-half": selectedStatus("5a-acr-half", REVIEW_RULE_DICT, {
            score: 1.5,
        }),
        "5b-fac": selectedStatus("5b-fac", REVIEW_RULE_DICT),
        "5c-gan-half": selectedStatus("5c-gan-half", REVIEW_RULE_DICT),
    };
    const before = structuredClone(ruleStatus);
    const draft = getReviewDraft(ruleStatus, REVIEW_RULE_DICT);

    assert.deepEqual(draft.aspects.writing, {
        selected: true,
        tier: "acr",
        quick: true,
        score: 1.5,
    });
    assert.deepEqual(draft.aspects.coverage, {
        selected: true,
        tier: "fac",
        quick: false,
        score: 2,
    });
    assert.deepEqual(draft.aspects.source, {
        selected: true,
        tier: "gan",
        quick: true,
        score: 0.5,
    });
    draft.aspects.writing.score = 9;
    assert.deepEqual(
        ruleStatus,
        before,
        "draft rows are detached from stored status",
    );
});

test("all five complete 5x codes retain one complete row and canonical output", async (t: any) => {
    for (const tier of Object.keys(TIER_SUFFIXES)) {
        const rule = `5x${TIER_SUFFIXES[tier]}`;
        await t.test(rule, () => {
            const ruleStatus: Record<string, any> = {
                [rule]: selectedStatus(rule, REVIEW_RULE_DICT, {
                    pending: true,
                }),
            };
            const draft = getReviewDraft(ruleStatus, REVIEW_RULE_DICT);

            assert.equal(draft.mode, REVIEW_APPLY_MODE.COMPLETE);
            assert.equal(draft.general.selected, false);
            assert.deepEqual(draft.complete, {
                selected: true,
                tier,
                quick: false,
                score: REVIEW_RULE_DICT[rule].score,
            });
            assert.ok(
                REVIEW_ASPECT_ROWS.every((row) => !draft.aspects[row].selected),
            );

            applyReviewDraft(
                ruleStatus,
                draft,
                REVIEW_RULE_DICT,
                REVIEW_APPLY_MODE.COMPLETE,
            );
            assert.equal(ruleStatus[rule].selected, true);
            assert.deepEqual(selectedRules(ruleStatus, "5"), [rule]);
        });
    }
});

test("complete-review custom totals and descriptions remain a single lossless row", () => {
    for (const score of [4, 4.5]) {
        const ruleStatus = {
            "5x": selectedStatus("5x", REVIEW_RULE_DICT, {
                score,
                desc: "Custom review",
            }),
        };
        const draft = getReviewDraft(ruleStatus, REVIEW_RULE_DICT);
        assert.equal(draft.complete.score, score);
        assert.equal(draft.complete.description, "Custom review");
        applyReviewDraft(
            ruleStatus,
            draft,
            REVIEW_RULE_DICT,
            REVIEW_APPLY_MODE.COMPLETE,
        );
        assert.equal(
            serializeNominationReason(ruleStatus, ["5x"]).reasonText,
            `5x(Custom&nbsp;review)[${score}]`,
        );
    }
});

test("complete reviews preserve arbitrary scores without enabling quick review", () => {
    const draft = getReviewDraft({}, REVIEW_RULE_DICT);
    draft.complete = { selected: true, tier: "fac", quick: false, score: 3 };
    const ruleStatus: Record<string, any> = {};
    applyReviewDraft(
        ruleStatus,
        draft,
        REVIEW_RULE_DICT,
        REVIEW_APPLY_MODE.COMPLETE,
    );
    assert.deepEqual(selectedRules(ruleStatus, "5"), ["5x-fac"]);
    assert.equal(
        serializeNominationReason(ruleStatus, ["5x-fac"]).reasonText,
        "5x-fac[3]",
    );
    assert.equal(
        getReviewDraft(ruleStatus, REVIEW_RULE_DICT).complete.quick,
        false,
    );
    ruleStatus["5x-fac"].desc = "Custom review";
    assert.equal(
        getReviewDraft(ruleStatus, REVIEW_RULE_DICT).complete.quick,
        false,
    );
});

test("custom general and specialist descriptions preserve their codes and score overrides", () => {
    for (const [rule, mode] of [
        ["5-bcr", REVIEW_APPLY_MODE.GENERAL],
        ["5a-gan", REVIEW_APPLY_MODE.ASPECTS],
    ]) {
        const ruleStatus = {
            [rule]: selectedStatus(rule, REVIEW_RULE_DICT, {
                score: 2.5,
                desc: "Custom review",
            }),
        };
        const draft = getReviewDraft(ruleStatus, REVIEW_RULE_DICT);
        assert.equal(draft.mode, mode);
        applyReviewDraft(ruleStatus, draft, REVIEW_RULE_DICT, mode);
        assert.equal(
            serializeNominationReason(ruleStatus, [rule]).reasonText,
            `${rule}(Custom&nbsp;review)[2.5]`,
        );
    }
});

test("applyReviewDraft GENERAL emits exactly one bare-5 variant and strips pending", () => {
    const ruleStatus: Record<string, any> = {
        "2-c": selectedStatus("2-c", QUALITY_RULE_DICT, { pending: true }),
        "5": selectedStatus("5", REVIEW_RULE_DICT, { pending: true }),
        "5a": selectedStatus("5a", REVIEW_RULE_DICT, { pending: true }),
        "5c-fac": selectedStatus("5c-fac", REVIEW_RULE_DICT, { pending: true }),
    };
    const draft = getReviewDraft({}, REVIEW_RULE_DICT);
    draft.general = { selected: true, tier: "gan", quick: true, score: 3 };
    draft.aspects.writing = {
        selected: true,
        tier: "acr",
        quick: false,
        score: 2,
    };

    applyReviewDraft(
        ruleStatus,
        draft,
        REVIEW_RULE_DICT,
        REVIEW_APPLY_MODE.GENERAL,
    );

    assert.deepEqual(selectedRules(ruleStatus, "5"), ["5-gan-half"]);
    assert.equal(ruleStatus["5-gan-half"].score, 3);
    assert.equal(ruleStatus["5-gan-half"].maxScore, 0.5);
    assert.equal(
        serializeNominationReason({ "5-gan-half": ruleStatus["5-gan-half"] }, [
            "5-gan-half",
        ]).reasonText,
        "5-gan-half[3]",
    );
    for (const [rule, status] of Object.entries(ruleStatus)) {
        if (rule.startsWith("5"))
            assert.equal(Object.hasOwn(status, "pending"), false, rule);
    }
    assert.deepEqual(
        ruleStatus["2-c"],
        selectedStatus("2-c", QUALITY_RULE_DICT, { pending: true }),
    );
});

test("applyReviewDraft ASPECTS emits one canonical code for each selected specialist row", () => {
    const ruleStatus: Record<string, any> = {};
    const draft = getReviewDraft({}, REVIEW_RULE_DICT);
    draft.general = { selected: true, tier: "acr", quick: false, score: 8 };
    draft.aspects.writing = {
        selected: true,
        tier: "bcr",
        quick: false,
        score: 1.5,
    };
    draft.aspects.coverage = {
        selected: true,
        tier: "fac",
        quick: false,
        score: 3,
    };
    draft.aspects.source = {
        selected: true,
        tier: "gan",
        quick: true,
        score: 0.5,
    };

    applyReviewDraft(
        ruleStatus,
        draft,
        REVIEW_RULE_DICT,
        REVIEW_APPLY_MODE.ASPECTS,
    );

    assert.deepEqual(selectedRules(ruleStatus, "5"), [
        "5a-bcr",
        "5b-fac",
        "5c-gan-half",
    ]);
    assert.equal(ruleStatus["5a-bcr"].score, 1.5);
    assert.equal(ruleStatus["5b-fac"].score, 3);
    assert.equal(ruleStatus["5c-gan-half"].score, 0.5);
    assert.equal(ruleStatus["5-acr"]?.selected, undefined);
});

test("the last explicitly applied Rule 5 mode wins", () => {
    const ruleStatus: Record<string, any> = {};
    const aspectsDraft = getReviewDraft({}, REVIEW_RULE_DICT);
    aspectsDraft.aspects.writing = {
        selected: true,
        tier: "bcr",
        quick: false,
        score: 1,
    };
    aspectsDraft.aspects.source = {
        selected: true,
        tier: "gan",
        quick: false,
        score: 1,
    };
    applyReviewDraft(
        ruleStatus,
        aspectsDraft,
        REVIEW_RULE_DICT,
        REVIEW_APPLY_MODE.ASPECTS,
    );
    assert.deepEqual(selectedRules(ruleStatus, "5"), ["5a-bcr", "5c-gan"]);

    const generalDraft = getReviewDraft(ruleStatus, REVIEW_RULE_DICT);
    generalDraft.general = {
        selected: true,
        tier: "fac",
        quick: true,
        score: 6,
    };
    applyReviewDraft(
        ruleStatus,
        generalDraft,
        REVIEW_RULE_DICT,
        REVIEW_APPLY_MODE.GENERAL,
    );
    assert.deepEqual(selectedRules(ruleStatus, "5"), ["5-fac-half"]);

    const finalAspectsDraft = getReviewDraft(ruleStatus, REVIEW_RULE_DICT);
    finalAspectsDraft.aspects.coverage = {
        selected: true,
        tier: "acr",
        quick: false,
        score: 2,
    };
    applyReviewDraft(
        ruleStatus,
        finalAspectsDraft,
        REVIEW_RULE_DICT,
        REVIEW_APPLY_MODE.ASPECTS,
    );
    assert.deepEqual(selectedRules(ruleStatus, "5"), ["5b-acr"]);
});

test("explicitly applying an empty specialist draft clears Rule 5 only", () => {
    const ruleStatus: Record<string, any> = {
        "5a-bcr": selectedStatus("5a-bcr", REVIEW_RULE_DICT, { pending: true }),
        "5b-acr": selectedStatus("5b-acr", REVIEW_RULE_DICT, { pending: true }),
        other: { selected: true, pending: true },
    };
    const draft = getReviewDraft(ruleStatus, REVIEW_RULE_DICT);
    for (const row of REVIEW_ASPECT_ROWS) draft.aspects[row].selected = false;

    applyReviewDraft(
        ruleStatus,
        draft,
        REVIEW_RULE_DICT,
        REVIEW_APPLY_MODE.ASPECTS,
    );

    assert.deepEqual(selectedRules(ruleStatus, "5"), []);
    assert.deepEqual(
        getReviewDraft(ruleStatus, REVIEW_RULE_DICT),
        getReviewDraft({}, REVIEW_RULE_DICT),
    );
    assert.equal(Object.hasOwn(ruleStatus["5a-bcr"], "pending"), false);
    assert.equal(Object.hasOwn(ruleStatus["5b-acr"], "pending"), false);
    assert.deepEqual(ruleStatus.other, { selected: true, pending: true });
});

test("applyReviewDraft rejects implicit modes and invalid draft values", () => {
    const draft = getReviewDraft({}, REVIEW_RULE_DICT);
    assert.throws(() => applyReviewDraft({}, draft, REVIEW_RULE_DICT), {
        name: "TypeError",
        message: /general.*aspects/,
    });
    assert.throws(
        () => applyReviewDraft({}, draft, REVIEW_RULE_DICT, "automatic"),
        { name: "TypeError" },
    );

    draft.general = { selected: true, tier: "unknown", quick: false, score: 1 };
    assert.throws(
        () =>
            applyReviewDraft(
                {},
                draft,
                REVIEW_RULE_DICT,
                REVIEW_APPLY_MODE.GENERAL,
            ),
        { name: "TypeError" },
    );
    draft.general = { selected: true, tier: "none", quick: false, score: NaN };
    assert.throws(
        () =>
            applyReviewDraft(
                {},
                draft,
                REVIEW_RULE_DICT,
                REVIEW_APPLY_MODE.GENERAL,
            ),
        { name: "TypeError" },
    );
});

test("getReviewDraft throws for Rule 5 shapes that the focused UI cannot represent", async (t: any) => {
    const cases = {
        "multiple variants for one row": {
            "5a": selectedStatus("5a", REVIEW_RULE_DICT),
            "5a-bcr": selectedStatus("5a-bcr", REVIEW_RULE_DICT),
        },
        "duplicate occurrences for one row": {
            "5a": [
                selectedStatus("5a", REVIEW_RULE_DICT),
                selectedStatus("5a", REVIEW_RULE_DICT),
            ],
        },
        "general combined with an aspect": {
            "5": selectedStatus("5", REVIEW_RULE_DICT),
            "5c": selectedStatus("5c", REVIEW_RULE_DICT),
        },
        "complete combined with an aspect": {
            "5x": selectedStatus("5x", REVIEW_RULE_DICT),
            "5a": selectedStatus("5a", REVIEW_RULE_DICT),
        },
        "unknown Rule 5 code": {
            "5-custom": { selected: true, desc: "custom", score: 1 },
        },
        "invalid score": {
            "5": selectedStatus("5", REVIEW_RULE_DICT, { score: -1 }),
        },
    };

    for (const [name, ruleStatus] of Object.entries(cases)) {
        await t.test(name, () => {
            assert.throws(() => getReviewDraft(ruleStatus, REVIEW_RULE_DICT));
        });
    }
});
