/**
 * @file tests/domain/reason-tokens.test.ts
 * Purpose: tests / domain / reason tokens.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. Test scenarios
 * 4. token
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
    classifyRule5Code,
    decomposeRule5Tokens,
    parseReasonTokens,
    serializeReasonToken,
    serializeReasonTokens,
} from "../../src/domain/rules.ts";

const RULE_DICT: Record<string, { label: string; score: number }> = {
    "1c": { label: "長擴充", score: 3 },
    "2-c": { label: "丙級", score: 1 },
    "3": { label: "格式", score: 1 },
    "4": { label: "活動", score: 1 },
    "4-dyk": { label: "DYK", score: 1 },
};

const REVIEW_TIERS = {
    none: { suffix: "", aspectScore: 1 },
    bcr: { suffix: "-bcr", aspectScore: 1 },
    gan: { suffix: "-gan", aspectScore: 1 },
    acr: { suffix: "-acr", aspectScore: 2 },
    fac: { suffix: "-fac", aspectScore: 2 },
};

for (const [tier, { suffix, aspectScore }] of Object.entries(REVIEW_TIERS)) {
    for (const prefix of ["5", "5a", "5b", "5c"]) {
        RULE_DICT[`${prefix}${suffix}`] = {
            label: `${prefix}:${tier}`,
            score: prefix === "5" ? aspectScore * 3 : aspectScore,
        };
        RULE_DICT[`${prefix}${suffix}-half`] = {
            label: `${prefix}:${tier}:quick`,
            score: (prefix === "5" ? aspectScore * 3 : aspectScore) / 2,
        };
    }
    RULE_DICT[`5x${suffix}`] = {
        label: `5x:${tier}`,
        score: aspectScore * 3,
    };
}

const ALIASES = {
    "2a": "2-c",
    c: "2-c",
    "4a": "4-dyk",
    dyk: "4-dyk",
};

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

test("parser strips exact request wrappers and HTML comments, then preserves ordered occurrences", () => {
    const parsed = parseReasonTokens(
        "<!-- before --> {{ACG提名2/request|ver=1|DYK？ 4[0.5]（活動甲） 4?(活動乙)[1] 2A}} <!-- after -->",
        RULE_DICT,
        ALIASES,
    );

    assert.deepEqual(parsed, {
        ok: true,
        tokens: [
            token("4-dyk", { pending: true, sourceIndex: 0 }),
            token("4", {
                comment: "活動甲",
                scoreOverride: 0.5,
                sourceIndex: 1,
            }),
            token("4", {
                pending: true,
                comment: "活動乙",
                scoreOverride: 1,
                sourceIndex: 2,
            }),
            token("2-c", { sourceIndex: 3 }),
        ],
    });
});

test("parser accepts raw codes, both modifier orders, both comment widths, and decimal scores", () => {
    const parsed = parseReasonTokens(
        "4?[0.5](甲) 4？（乙）[01.25] 4[1.0](丙) 1C[0]",
        RULE_DICT,
        ALIASES,
    );

    assert.deepEqual(parsed, {
        ok: true,
        tokens: [
            token("4", {
                pending: true,
                comment: "甲",
                scoreOverride: 0.5,
                sourceIndex: 0,
            }),
            token("4", {
                pending: true,
                comment: "乙",
                scoreOverride: 1.25,
                sourceIndex: 1,
            }),
            token("4", { comment: "丙", scoreOverride: 1, sourceIndex: 2 }),
            token("1c", { scoreOverride: 0, sourceIndex: 3 }),
        ],
    });
    assert.deepEqual(parseReasonTokens("  \n\t ", RULE_DICT, ALIASES), {
        ok: true,
        tokens: [],
    });
    assert.deepEqual(
        parseReasonTokens("{{ACG提名2/request|ver=1|}}", RULE_DICT, ALIASES),
        { ok: true, tokens: [] },
    );
});

test("whitespace always splits tokens, including text inside comment delimiters", () => {
    const parsed = parseReasonTokens(
        "{{ACG提名2/request|ver=1|1c 4(基礎條目 擴充)}}",
        RULE_DICT,
        ALIASES,
    );

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "invalid-comment");
    assert.equal(parsed.error.sourceIndex, 1);
    assert.equal(parsed.error.token, "4(基礎條目");
    assert.equal(parsed.rawReason, "1c 4(基礎條目 擴充)");
});

test("parser preserves raw and entity-form wikilink comments as editable text", () => {
    const description = "[[WP:NTUWP25|維基百科二十五周年紀念編輯松]]";
    const entityDescription =
        "&#91;&#91;WP:NTUWP25&#124;維基百科二十五周年紀念編輯松&#93;&#93;";

    for (const sourceDescription of [description, entityDescription]) {
        const parsed = parseReasonTokens(
            `{{ACG提名2/request|ver=1|4(${sourceDescription})}}`,
            RULE_DICT,
            ALIASES,
        );
        assert.deepEqual(parsed, {
            ok: true,
            tokens: [token("4", { comment: description })],
        });
        assert.equal(
            serializeReasonTokens(parsed.tokens, RULE_DICT),
            `4(${description})`,
        );
    }
});

test("wikilink whitespace and delimiters are opaque to comment and score parsing", () => {
    const description = "[[Example (topic)|label [draft] with spaces]]";
    const parsed = parseReasonTokens(
        `4(${description})[0.5]`,
        RULE_DICT,
        ALIASES,
    );

    assert.deepEqual(parsed, {
        ok: true,
        tokens: [token("4", { comment: description, scoreOverride: 0.5 })],
    });
    assert.equal(
        serializeReasonTokens(parsed.tokens, RULE_DICT),
        `4(${description})[0.5]`,
    );
});

test("raw modifier closings inside wikilinks do not close the surrounding modifier", () => {
    const parsed = parseReasonTokens(
        "4([[Example)|label]])[0.5]",
        RULE_DICT,
        ALIASES,
    );
    assert.deepEqual(parsed, {
        ok: true,
        tokens: [
            token("4", { comment: "[[Example)|label]]", scoreOverride: 0.5 }),
        ],
    });
});

test("parser reports strict syntax failures without returning partial tokens", async (t: any) => {
    const cases = [
        ["unknown code", "not-a-rule?", "unknown-code"],
        ["late pending mark", "4(活動)?", "invalid-modifier"],
        ["two pending marks", "4??", "invalid-modifier"],
        ["empty ASCII comment", "4()", "empty-comment"],
        ["empty fullwidth comment", "4（）", "empty-comment"],
        ["unclosed ASCII comment", "4(活動", "invalid-comment"],
        ["crossed comment delimiters", "4（活動)", "invalid-comment"],
        ["duplicate comments", "4(甲)(乙)", "duplicate-comment"],
        ["duplicate scores", "4[1][2]", "duplicate-score"],
        ["partial number", "4[1x]", "invalid-score"],
        ["leading-dot decimal", "4[.5]", "invalid-score"],
        ["trailing-dot decimal", "4[1.]", "invalid-score"],
        ["negative number", "4[-1]", "invalid-score"],
        ["exponent", "4[1e2]", "invalid-score"],
        ["non-finite decimal", `4[${"9".repeat(400)}]`, "invalid-score"],
        ["fullwidth score brackets", "4［1］", "invalid-modifier"],
    ];

    for (const [name, reason, errorCode] of cases) {
        await t.test(name, () => {
            const parsed = parseReasonTokens(reason, RULE_DICT, ALIASES);
            assert.equal(parsed.ok, false);
            assert.equal(parsed.error.code, errorCode);
            assert.equal(parsed.rawReason, reason);
        });
    }
});

test("a request prefix without its exact closing wrapper is rejected", () => {
    assert.deepEqual(
        parseReasonTokens("{{ACG提名2/request|ver=1|4", RULE_DICT, ALIASES),
        {
            ok: false,
            error: { code: "invalid-wrapper" },
            rawReason: "{{ACG提名2/request|ver=1|4",
        },
    );
});

test("serializer emits canonical order and omits modifiers equal to defaults", () => {
    const tokens = [
        token("4-dyk", { pending: true, comment: "DYK", scoreOverride: 1 }),
        token("4", { comment: "動員令", scoreOverride: 0.5, sourceIndex: 1 }),
        token("1c", { comment: "長擴充", scoreOverride: 2, sourceIndex: 2 }),
    ];

    assert.equal(serializeReasonToken(tokens[0], RULE_DICT), "4-dyk?");
    assert.equal(
        serializeReasonTokens(tokens, RULE_DICT),
        "4-dyk? 4(動員令)[0.5] 1c[2]",
    );
});

test("serializer writes finite numeric values without exponent notation", () => {
    assert.equal(
        serializeReasonToken(token("4", { scoreOverride: 1e-7 }), RULE_DICT),
        "4[0.0000001]",
    );
    assert.equal(
        serializeReasonToken(token("4", { scoreOverride: 1e21 }), RULE_DICT),
        "4[1000000000000000000000]",
    );
});

test("serializer escapes ordinary comment delimiters and preserves complete wikilinks", () => {
    const description =
        "See [[First page|first label]] and [[Second (topic)|second]] | notes";
    const serialized =
        "4(See&nbsp;[[First page|first label]]&nbsp;and&nbsp;" +
        "[[Second (topic)|second]]&nbsp;&#124;&nbsp;notes)";
    assert.equal(
        serializeReasonToken(token("4", { comment: description }), RULE_DICT),
        serialized,
    );
    assert.deepEqual(parseReasonTokens(serialized, RULE_DICT, ALIASES), {
        ok: true,
        tokens: [token("4", { comment: description })],
    });

    const ordinary = "A | (B) [C]";
    assert.equal(
        serializeReasonToken(token("4", { comment: ordinary }), RULE_DICT),
        "4(A&nbsp;&#124;&nbsp;&#40;B&#41;&nbsp;&#91;C&#93;)",
    );
});

test("serializer treats malformed wikilinks as escaped plain text", () => {
    const cases = [
        [
            "Broken [[Page|label (draft)",
            "Broken&nbsp;&#91;&#91;Page&#124;label&nbsp;&#40;draft&#41;",
        ],
        ["Empty [[]] link", "Empty&nbsp;&#91;&#91;&#93;&#93;&nbsp;link"],
        [
            "Nested [[Outer [[Inner]] tail]] link",
            "Nested&nbsp;&#91;&#91;Outer&nbsp;&#91;&#91;Inner&#93;&#93;&nbsp;tail&#93;&#93;&nbsp;link",
        ],
    ];

    for (const [description, encodedDescription] of cases) {
        const serialized = serializeReasonToken(
            token("4", { comment: description }),
            RULE_DICT,
        );
        assert.equal(serialized, `4(${encodedDescription})`);
        assert.equal(serialized.includes("[["), false);
        assert.equal(
            parseReasonTokens(serialized, RULE_DICT, ALIASES).tokens[0].comment,
            description,
        );
    }
});

test("serializer still rejects invalid structured token values", () => {
    assert.throws(
        () =>
            serializeReasonToken(
                token("4", { scoreOverride: -0.5 }),
                RULE_DICT,
            ),
        { name: "TypeError" },
    );
    assert.throws(() => serializeReasonToken(token("missing"), RULE_DICT), {
        name: "TypeError",
    });
});

test("Rule 5 classifier distinguishes general, specialist, complete, tier, and quick", () => {
    assert.deepEqual(classifyRule5Code("5"), {
        kind: "general",
        aspect: null,
        tier: "none",
        quick: false,
    });
    assert.deepEqual(classifyRule5Code("5-fac-half"), {
        kind: "general",
        aspect: null,
        tier: "fac",
        quick: true,
    });
    assert.deepEqual(classifyRule5Code("5A-ACR"), {
        kind: "specialist",
        aspect: "writing",
        tier: "acr",
        quick: false,
    });
    assert.deepEqual(classifyRule5Code("5b-gan-half"), {
        kind: "specialist",
        aspect: "coverage",
        tier: "gan",
        quick: true,
    });
    assert.deepEqual(classifyRule5Code("5x-bcr"), {
        kind: "complete",
        aspect: null,
        tier: "bcr",
        quick: false,
    });
    assert.equal(classifyRule5Code("5-custom"), null);
    assert.equal(classifyRule5Code("4"), null);
});

test("parser-only complete Rule 5 codes expand into the three specialist aspects", () => {
    const parsed = parseReasonTokens(
        "5X-FAC-HALF?(快評)[3]",
        RULE_DICT,
        ALIASES,
    );
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.tokens, [
        token("5x-fac-half", {
            pending: true,
            comment: "快評",
            scoreOverride: 3,
        }),
    ]);

    const mapped = decomposeRule5Tokens(parsed.tokens, RULE_DICT);
    assert.equal(mapped.ok, true);
    assert.equal(mapped.mode, "aspects");
    assert.equal(mapped.general, null);
    assert.deepEqual(Object.keys(mapped.aspects), [
        "writing",
        "coverage",
        "source",
    ]);
    assert.deepEqual(mapped.tokens, [
        token("5a-fac-half", { pending: true, comment: "快評" }),
        token("5b-fac-half", { pending: true, comment: "快評" }),
        token("5c-fac-half", { pending: true, comment: "快評" }),
    ]);
});

test("complete Rule 5 expansion splits representable explicit totals equally", () => {
    const representable = decomposeRule5Tokens(
        [token("5x-acr", { scoreOverride: 6 })],
        RULE_DICT,
    );
    assert.equal(representable.ok, true);
    assert.deepEqual(
        representable.tokens.map((item: any) => item.code),
        ["5a-acr", "5b-acr", "5c-acr"],
    );
    assert.equal(
        representable.tokens.every((item: any) => item.scoreOverride === null),
        true,
    );

    const overridden = decomposeRule5Tokens(
        [token("5x-acr", { scoreOverride: 4.5 })],
        RULE_DICT,
    );
    assert.equal(overridden.ok, true);
    assert.deepEqual(
        overridden.tokens.map((item: any) => item.scoreOverride),
        [1.5, 1.5, 1.5],
    );

    assert.deepEqual(
        decomposeRule5Tokens(
            [token("5x-acr", { scoreOverride: 4 })],
            RULE_DICT,
        ),
        {
            ok: false,
            error: {
                code: "unrepresentable-explicit-total-score",
                sourceIndex: 0,
                rule: "5x-acr",
                score: 4,
                scorePerAspect: 4 / 3,
            },
        },
    );
});

test("complete Rule 5 expansion drops a redundant complete-code description", () => {
    const mapped = decomposeRule5Tokens(
        [token("5x", { comment: RULE_DICT["5x"].label })],
        RULE_DICT,
    );
    assert.equal(mapped.ok, true);
    assert.equal(
        mapped.tokens.every((item: any) => item.comment === null),
        true,
    );
});

test("Rule 5 decomposition rejects mixed modes and duplicate logical rows", () => {
    assert.equal(
        decomposeRule5Tokens(
            [token("5"), token("5a", { sourceIndex: 1 })],
            RULE_DICT,
        ).error.code,
        "mixed-general-specialist",
    );
    assert.equal(
        decomposeRule5Tokens(
            [token("5a"), token("5a-bcr", { sourceIndex: 1 })],
            RULE_DICT,
        ).error.code,
        "duplicate-specialist",
    );
    assert.equal(
        decomposeRule5Tokens(
            [token("5"), token("5-gan", { sourceIndex: 1 })],
            RULE_DICT,
        ).error.code,
        "duplicate-general",
    );
    assert.equal(
        decomposeRule5Tokens(
            [token("5x"), token("5c", { sourceIndex: 1 })],
            RULE_DICT,
        ).error.code,
        "duplicate-specialist",
    );
});

test("Rule 5 decomposition ignores other rules and reports an empty mapping", () => {
    assert.deepEqual(decomposeRule5Tokens([token("1c")], RULE_DICT), {
        ok: true,
        mode: "none",
        general: null,
        aspects: {},
        tokens: [],
    });
});
