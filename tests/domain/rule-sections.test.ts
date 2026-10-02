/**
 * @file tests/domain/rule-sections.test.ts
 * Purpose: tests / domain / rule sections.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Test scenarios
 */

import { createTranslator } from "../../src/i18n/index.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { NominationRuleSet, NominationRules } from "../../src/domain/rules.ts";

test("author rule metadata is divided into article, review, and other sections", () => {
    const groups = NominationRules();

    assert.deepEqual(
        groups.map((group: any) => group.section),
        [
            "article",
            "article",
            "article",
            "article",
            "review",
            "other",
            "other",
            "other",
        ],
    );
    assert.deepEqual(
        groups.map((group: any) => group.group),
        [
            "內容擴充",
            "品質提升",
            "格式",
            "(4) 活動",
            "(5) 內容評審",
            "(6) 檔案",
            "(7) 他薦",
            "(8) 其他",
        ],
    );
    assert.equal(groups[3].explanation, "");
    assert.equal(groups[4].explanation, "");
    assert.equal(groups[5].explanation, "");
    assert.equal(
        groups[6].explanation,
        "每有效提名他人 1 次得 0.5 分，每人每月最多得 5 分。若多次得分，請自行定義分數。",
    );
    assert.equal(
        groups[7].explanation,
        "獎勵維基人做出的其他難以量化的貢獻。請手動填寫理由和分數。實際得分或由專題成員商討得出。",
    );
    assert.equal(
        groups[1].explanation,
        "以條目品質評級為標準，提升條目品質。選擇完善前與完善後品質",
    );
    assert.deepEqual(
        groups[0].rules.map((rule: any) => rule.label),
        ["短新增", "中新增", "長新增"],
    );
});

test("simplified rule metadata uses the matching labels", () => {
    const groups = NominationRules(createTranslator("zh-Hans").msg);

    assert.deepEqual(
        groups.map((group: any) => group.group),
        [
            "内容扩充",
            "品质提升",
            "格式",
            "得分项目4 — 活动",
            "(5) 内容评审",
            "(6) 档案",
            "(7) 他荐",
            "(8) 其他",
        ],
    );
    assert.equal(groups[3].explanation, "");
    assert.equal(groups[4].explanation, "");
    assert.equal(groups[5].explanation, "");
    assert.equal(
        groups[6].explanation,
        "每有效提名他人 1 次得 0.5 分，每人每月最多得 5 分。若多次得分，请自行定义分数。",
    );
    assert.equal(
        groups[7].explanation,
        "奖励维基人做出的其他难以量化的贡献。请手动填写理由和分数。实际得分或由专题成员商讨得出。",
    );
    assert.equal(
        groups[1].explanation,
        "以条目品质评级为标准，提升条目品质。选择完善前与完善后品质",
    );
    assert.deepEqual(
        groups[0].rules.map((rule: any) => rule.label),
        ["短新增", "中新增", "长新增"],
    );
});

test("rule metadata matches every code supported by the live nominee-check module", () => {
    const reviewCodes = ["", "-fac", "-acr", "-gan", "-bcr"].flatMap(
        (suffix: any) => [
            `5x${suffix}`,
            `5a${suffix}`,
            `5a${suffix}-half`,
            `5b${suffix}`,
            `5b${suffix}-half`,
            `5c${suffix}`,
            `5c${suffix}-half`,
            `5${suffix}`,
            `5${suffix}-half`,
        ],
    );
    const supportedCodes = [
        "1a",
        "1b",
        "1c",
        "2-c",
        "2-b",
        "2-ga",
        "2-fa",
        "3",
        "4",
        "4-dyk",
        "4-req",
        "4-req-game",
        "4-req-ac",
        ...reviewCodes,
        "6",
        "6-fp",
        "7",
        "8",
    ];

    const { ruleNames } = NominationRuleSet();
    assert.equal(ruleNames.length, 62);
    assert.deepEqual([...ruleNames].sort(), supportedCodes.sort());
});
