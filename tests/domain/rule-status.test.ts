/**
 * @file tests/domain/rule-status.test.ts
 * Purpose: tests / domain / rule status.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Test scenarios
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
    REPEATABLE_RULES,
    allRuleOccurrences,
    getOrderedRuleOccurrences,
    getRuleOccurrences,
    isRepeatableRule,
    normalizeRepeatableRules,
} from "../../src/domain/rules.ts";

test("only Rule 4 and its subcodes use the repeatable representation", () => {
    assert.deepEqual(REPEATABLE_RULES, [
        "4",
        "4-req",
        "4-dyk",
        "4-req-game",
        "4-req-ac",
    ]);
    for (const rule of REPEATABLE_RULES)
        assert.equal(isRepeatableRule(rule), true);
    for (const rule of ["1a", "3", "5", "6", "8"])
        assert.equal(isRepeatableRule(rule), false);
});

test("occurrence access accepts canonical arrays and legacy scalar values", () => {
    const scalar = { selected: true };
    const repeated = [{ selected: true }, { selected: false }];
    const ruleStatus: Record<string, any> = { "4": repeated, "4-dyk": scalar };

    assert.equal(getRuleOccurrences(ruleStatus, "4"), repeated);
    assert.deepEqual(getRuleOccurrences(ruleStatus, "4-dyk"), [scalar]);
    assert.deepEqual(getRuleOccurrences(ruleStatus, "4-req"), []);
});

test("repeatable normalization does not rewrite ordinary status objects", () => {
    const ordinary = { selected: true };
    const legacyActivity = { selected: false };
    const source = { "1a": ordinary, "4": legacyActivity };
    const normalized = normalizeRepeatableRules(source, {
        includeMissing: true,
    });

    assert.notEqual(normalized, source);
    assert.equal(normalized["1a"], ordinary);
    assert.deepEqual(normalized["4"], [legacyActivity]);
    for (const rule of REPEATABLE_RULES)
        assert.ok(Array.isArray(normalized[rule]));
});

test("ordered occurrences use canonical code order and stable within-code order", () => {
    const first = { selected: true, desc: "first" };
    const second = { selected: true, desc: "second" };
    const dyk = { selected: true, desc: "dyk" };
    const entries = getOrderedRuleOccurrences(["1a", "4", "4-dyk"], {
        "4-dyk": [dyk],
        "4": [first, second],
        "1a": { selected: true },
    });

    assert.deepEqual(
        entries.map(({ rule, occurrence, key }) => ({ rule, occurrence, key })),
        [
            { rule: "1a", occurrence: 0, key: "1a:0" },
            { rule: "4", occurrence: 0, key: "4:0" },
            { rule: "4", occurrence: 1, key: "4:1" },
            { rule: "4-dyk", occurrence: 0, key: "4-dyk:0" },
        ],
    );
    assert.equal(entries[1].status, first);
    assert.equal(entries[2].status, second);
    assert.equal(entries[3].status, dyk);
});

test("all occurrences includes repeated and unknown stored keys for validation", () => {
    const entries = allRuleOccurrences({
        "4": [{ selected: true }, { selected: false }],
        custom: { selected: true },
        empty: null,
    });
    assert.deepEqual(
        entries.map(({ rule, occurrence }) => ({ rule, occurrence })),
        [
            { rule: "4", occurrence: 0 },
            { rule: "4", occurrence: 1 },
            { rule: "custom", occurrence: 0 },
        ],
    );
});
