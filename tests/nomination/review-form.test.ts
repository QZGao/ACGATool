/**
 * @file tests/nomination/review-form.test.ts
 * Purpose: tests / nomination / review form.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. reviewForm
 * 4. Test scenarios
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
    NominationRuleSet,
    parseReasonTokens,
    serializeNominationReason,
} from "../../src/domain/rules.ts";
import { createNominationModel } from "../../src/features/nomination/model.ts";
import { createDialogHost } from "../../src/features/nomination/dialog-host.ts";
import { createRuleFormComponents } from "../../src/features/nomination/rule-forms.ts";
import { dialogServices, dialogRuntime, instantiateHost } from "./fixture.ts";
import type { DialogOperations } from "../../src/features/nomination/contracts.ts";

const operations: DialogOperations = {
    saveNewNomination: async () => false,
    saveModifiedNomination: async () => false,
    saveNominationCheck: async () => false,
    saveRawNominationSource: async () => false,
};

function reviewForm(reason?: string) {
    const host = instantiateHost(
        createDialogHost(dialogRuntime, operations, dialogServices),
    );
    const { ruleDict, ruleNames } = NominationRuleSet();
    if (reason === undefined) {
        host.openNew();
    } else {
        host.openEdit(
            {
                awarder: "Example",
                pageName: "Example article",
                requestReasonText: reason,
                reasonParse: parseReasonTokens(reason, ruleDict),
            },
            { type: "acg2", position: 1 },
        );
    }
    const model = createNominationModel(dialogServices);
    const components = createRuleFormComponents({}, model);
    const context = {
        $root: host,
        $emit() {},
        nomination: host.currentNomination,
        ruleDict,
        ruleGroups: host.ruleGroups,
        disabled: false,
    };
    const author = instantiateHost(components.AuthorForm, context);
    author.setActiveRuleCategory("review");
    const review = instantiateHost(components.ReviewEditor, context);
    return {
        review,
        nomination: host.currentNomination,
        ruleNames,
        ruleDict,
        model,
    };
}

test("general review presets fill the editable row and retain custom descriptions and scores", () => {
    const { review, nomination, ruleNames, model } = reviewForm();
    assert.equal(review.reviewMode, "general");
    assert.equal(review.selectedTier, "none");
    assert.equal(review.generalItem.draft.tier, "none");
    assert.equal(review.scoreText.general, "1");
    review.setPresetTier("bcr");
    assert.equal(review.generalItem.draft.tier, "bcr");
    assert.equal(
        review.choiceText(review.generalItem),
        review.$root.reviewTierItems.find((tier: any) => tier.value === "bcr")
            .label,
    );
    assert.equal(review.scoreText.general, "1");
    review.setQuick(review.generalItem, true);
    assert.equal(review.scoreText.general, "0.5");
    review.setChoice(review.generalItem, "自訂評審");
    review.setScore(review.generalItem, "2.5");
    review.setPresetTier("arbitrary tier");
    assert.equal(review.generalItem.draft.tier, "bcr");
    assert.equal(review.choiceText(review.generalItem), "自訂評審");
    assert.deepEqual(
        serializeNominationReason(
            model.nominationPayload(nomination).ruleStatus,
            ruleNames,
        ),
        {
            ok: true,
            reasonText: "5-bcr-half(自訂評審)[2.5]",
            reasonScore: 2.5,
            unselectedReasonText: "",
        },
    );
});

test("review modes preserve their drafts and serialize only the active mode", () => {
    const { review, nomination, ruleNames, ruleDict, model } = reviewForm();
    review.setScore(review.generalItem, "2.5");
    review.setReviewMode("aspects");
    assert.equal(review.aspectItems.length, 3);
    assert.ok(review.aspectItems.every((item: any) => !item.draft.selected));
    const writing = review.aspectItems[0];
    review.setSelected(writing, true);
    const tierLabel = (tier: string) =>
        review.$root.reviewTierItems.find((item: any) => item.value === tier)
            .label;
    review.setChoice(writing, tierLabel("gan"));
    const coverage = review.aspectItems[1];
    review.setSelected(coverage, true);
    const source = review.aspectItems[2];
    review.setSelected(source, true);
    review.setChoice(source, tierLabel("fac"));
    review.setQuick(source, true);
    const mixed = serializeNominationReason(
        model.nominationPayload(nomination).ruleStatus,
        ruleNames,
    );
    assert.equal(mixed.ok, true);
    assert.equal(mixed.reasonScore, 3);
    assert.deepEqual(
        parseReasonTokens(mixed.reasonText, ruleDict)
            .tokens.map((token: any) => token.code)
            .sort(),
        ["5a-gan", "5b", "5c-fac-half"],
    );
    review.setReviewMode("general");
    assert.deepEqual(
        serializeNominationReason(
            model.nominationPayload(nomination).ruleStatus,
            ruleNames,
        ),
        {
            ok: true,
            reasonText: "5[2.5]",
            reasonScore: 2.5,
            unselectedReasonText: "",
        },
    );
    review.setReviewMode("aspects");
    assert.equal(writing.draft.tier, "gan");
    assert.equal(source.draft.tier, "fac");
    assert.equal(source.draft.quick, true);
    review.setReviewMode("complete");
    review.setPresetTier("bcr");
    assert.equal(review.completeItem.draft.quick, false);
    assert.equal(review.scoreText.complete, "3");
    assert.deepEqual(
        serializeNominationReason(
            model.nominationPayload(nomination).ruleStatus,
            ruleNames,
        ),
        {
            ok: true,
            reasonText: "5x-bcr",
            reasonScore: 3,
            unselectedReasonText: "",
        },
    );
});

test("stored custom review descriptions and score overrides survive editable mode mapping", () => {
    for (const [mode, reason] of [
        ["general", "5-gan(自訂評審)[2.5]"],
        ["aspects", "5a-gan(文筆意見)[1.5] 5b(覆蓋意見)[2]"],
        ["complete", "5x-acr(自訂綜合評審)[5.5]"],
    ] as const) {
        const { review, nomination, ruleNames, ruleDict, model } =
            reviewForm(reason);
        assert.equal(review.reviewMode, mode);
        assert.equal(nomination.rule5Unresolved, false);
        for (const item of review.displayedItems) {
            if (!item.draft.selected) continue;
            review.setChoice(item, review.choiceText(item));
            review.setScore(item, String(item.draft.score));
        }
        const serialized = serializeNominationReason(
            model.nominationPayload(nomination).ruleStatus,
            ruleNames,
        );
        assert.equal(serialized.ok, true);
        const values = (text: string) =>
            parseReasonTokens(text, ruleDict)
                .tokens.map((token: any) => ({
                    code: token.code,
                    comment: token.comment,
                    scoreOverride: token.scoreOverride,
                }))
                .sort((left: any, right: any) =>
                    left.code.localeCompare(right.code),
                );
        assert.deepEqual(values(serialized.reasonText), values(reason));
    }
});

test("incomplete review scores preserve selected rules and reject submission until corrected", () => {
    for (const mode of ["general", "aspects", "complete"] as const) {
        const { review, nomination, ruleNames, model } = reviewForm();
        nomination.pageName = "Example article";
        review.setReviewMode(mode);
        if (mode === "aspects") {
            review.setSelected(review.aspectItems[0], true);
            review.setSelected(review.aspectItems[1], true);
        }
        const item =
            mode === "aspects"
                ? review.aspectItems[0]
                : mode === "complete"
                  ? review.completeItem
                  : review.generalItem;
        const rule =
            mode === "aspects" ? "5a" : mode === "complete" ? "5x" : "5";
        for (const input of ["", "-0.5", "1.25"]) {
            assert.doesNotThrow(() => review.setScore(item, input));
            assert.equal(item.draft.selected, true);
            assert.equal(nomination.ruleStatus[rule].selected, true);
            if (mode === "aspects")
                assert.equal(nomination.ruleStatus["5b"].selected, true);
            assert.equal(
                serializeNominationReason(
                    model.nominationPayload(nomination).ruleStatus,
                    ruleNames,
                ).ok,
                false,
            );
            assert.equal(model.authorValidation([nomination]), nomination);
            assert.ok(nomination.errors.rules);
        }
        review.setScore(item, "2.5");
        assert.equal(review.scoreText[item.key], "2.5");
        assert.equal(model.authorValidation([nomination]), null);
        const serialized = serializeNominationReason(
            model.nominationPayload(nomination).ruleStatus,
            ruleNames,
        );
        assert.equal(serialized.ok, true);
        assert.equal(
            serialized.reasonText,
            mode === "aspects"
                ? "5a[2.5] 5b"
                : mode === "complete"
                  ? "5x[2.5]"
                  : "5[2.5]",
        );
    }
});

test("score labels use complete translated phrases and singular units", async () => {
    const { createTranslator } = await import("../../src/i18n/index.ts");
    const english = instantiateHost(
        createDialogHost(dialogRuntime, operations, {
            ...dialogServices,
            msg: createTranslator("en").msg,
        }),
    );
    assert.equal(english.formatScore(1), "1 point");
    assert.equal(english.formatScore(2), "2 points");
    assert.equal(english.formatScore(0.5), "0.5 points");
    assert.equal(english.formatScore(null), "? points");
    assert.equal(english.scoreUnit("1"), "point");
    assert.equal(english.scoreUnit("3"), "points");
    const chinese = instantiateHost(
        createDialogHost(dialogRuntime, operations, dialogServices),
    );
    assert.equal(chinese.formatScore(1), "1分");
    assert.equal(chinese.formatScore(2), "2分");
});
