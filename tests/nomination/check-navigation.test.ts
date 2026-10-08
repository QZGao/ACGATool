/**
 * @file tests/nomination/check-navigation.test.ts
 * Purpose: tests / nomination / check navigation.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. entry
 * 4. fixture
 * 5. rawCheckEntry
 * 6. state
 * 7. Test scenarios
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
    NominationRuleSet,
    parseReasonTokens,
} from "../../src/domain/rules.ts";
import { CHECK_OUTCOME } from "../../src/features/nomination/check-batch.ts";
import type {
    CheckBatchEntry,
    NominationData,
    NominationTarget,
    RawNominationFields,
} from "../../src/features/nomination/contracts.ts";
import { createDialogHost } from "../../src/features/nomination/dialog-host.ts";
import { dialogRuntime, dialogServices, instantiateHost } from "./fixture.ts";

const { ruleDict } = NominationRuleSet();

function entry(
    reason: string,
    position: number,
    tableKey = "first-table",
    tableIndex = 0,
): CheckBatchEntry {
    return {
        nomination: {
            awarder: `Recipient ${position}`,
            pageName: `Article ${position}`,
            requestReasonText: reason,
            reasonParse: parseReasonTokens(reason, ruleDict),
        },
        target: { type: "acg2", position },
        tableKey,
        tableIndex,
    };
}

function fixture(
    options: {
        completeResults?: boolean[];
        stage?: (
            nomination: NominationData,
            target: NominationTarget,
        ) => Promise<boolean>;
        rawStage?: (
            fields: RawNominationFields,
            target: NominationTarget,
            options: { check: boolean },
        ) => Promise<boolean>;
    } = {},
) {
    const stages: Array<{
        nomination: NominationData;
        target: NominationTarget;
    }> = [];
    const discarded: NominationTarget[] = [];
    const rawStages: Array<{
        fields: RawNominationFields;
        target: NominationTarget;
        check: boolean;
    }> = [];
    const committed: NominationData[][] = [];
    const staged = new Map<string | number, NominationData>();
    const events: string[] = [];
    const results = [...(options.completeResults ?? [])];
    const host = createDialogHost(
        dialogRuntime,
        {
            async saveNewNomination() {
                assert.fail("unexpected new nomination");
            },
            async saveModifiedNomination() {
                assert.fail("unexpected nomination edit");
            },
            async saveRawNominationSource(fields, target, rawOptions) {
                assert.ok(options.rawStage, "unexpected raw-source save");
                rawStages.push({
                    fields: { ...fields },
                    target: { ...target },
                    check: rawOptions.check,
                });
                events.push(`raw:${target.position}`);
                const failed = await options.rawStage(
                    fields,
                    target,
                    rawOptions,
                );
                if (!failed)
                    staged.set(target.position, {
                        awarder: fields.用戶名稱,
                        pageName: fields.條目名稱,
                        rawFields: { ...fields },
                    });
                return failed;
            },
            async saveNominationCheck(nomination, target) {
                const snapshot = JSON.parse(JSON.stringify(nomination));
                stages.push({ nomination: snapshot, target: { ...target } });
                events.push(`stage:${target.position}`);
                const failed = options.stage
                    ? await options.stage(nomination, target)
                    : false;
                if (!failed) staged.set(target.position, snapshot);
                return failed;
            },
            discardNominationCheck(target) {
                discarded.push({ ...target });
                events.push(`discard:${target.position}`);
                staged.delete(target.position);
            },
            async completeNominationCheckBatch() {
                events.push("complete");
                const failed = results.shift() ?? false;
                if (!failed) {
                    committed.push([...staged.values()]);
                    staged.clear();
                }
                return failed;
            },
        },
        dialogServices,
    );
    return {
        vm: instantiateHost(host),
        stages,
        rawStages,
        discarded,
        committed,
        events,
    };
}

function rawCheckEntry(position: number): CheckBatchEntry {
    const source = entry("1a", position);
    source.nomination.checkWikitext = "Manually checked: three points";
    return source;
}

function state(vm: any) {
    return {
        rows: vm.checkTableRows.map((row: any) => ({
            code: row.code,
            description: row.description,
            score: row.score,
        })),
        selected: [...vm.checkedRowsModel],
        message: vm.currentNomination.message,
        canUndo: vm.canUndoCheckEdit,
        canRedo: vm.canRedoCheckEdit,
    };
}

test("flat batch navigation preserves each item's edits, history, selection, and origins across tables", () => {
    const { vm, events } = fixture();
    vm.openCheckBatch([
        entry("4-dyk?(首項)[2] 4-dyk(末項)[0.5]", 1),
        entry("1c", 2),
        entry("6", 3, "second-table", 1),
    ]);
    assert.equal(vm.checkBatchIndex, 0);
    assert.deepEqual(vm.checkNavigationItems, [0, 1, 2]);
    assert.deepEqual(
        vm.checkNavigationItems.map((index: number) =>
            vm.checkBatchItemLabel(index),
        ),
        ["項目1 · 待核對", "項目2 · 待核對", "項目3 · 待核對"],
    );
    assert.deepEqual(
        vm.checkBatchEntries.map((item: CheckBatchEntry) => item.tableKey),
        ["first-table", "first-table", "second-table"],
    );
    vm.setCheckCode(vm.checkTableRows[0], "4-req");
    vm.setCheckScore(vm.checkTableRows[0], "4.5");
    vm.checkedRowsModel = [1];
    vm.setCheckMessage("第一項核對說明");
    vm.moveCheckItem(vm.checkTableRows[0], 1);
    const first = state(vm);

    vm.selectCheckBatchItem("1");
    assert.equal(vm.checkBatchIndex, 1);
    assert.equal(vm.currentNomination.pageName, "Article 2");
    assert.equal(vm.canUndoCheckEdit, false);

    vm.selectCheckBatchItem("invalid");
    vm.selectCheckBatchItem("-1");
    vm.selectCheckBatchItem("0.5");
    vm.selectCheckBatchItem("3");
    assert.equal(vm.checkBatchIndex, 1);
    assert.equal(vm.canRedoCheckEdit, false);
    assert.equal(vm.currentNomination.message, "");
    vm.setCheckScore(vm.checkTableRows[0], "1.5");
    vm.checkedRowsModel = [];
    vm.setCheckMessage("第二項核對說明");
    const second = state(vm);
    vm.selectCheckBatchItem("2");
    assert.equal(vm.checkBatchIndex, 2);
    assert.equal(vm.currentNomination.pageName, "Article 3");
    assert.equal(vm.checkTableRows[0].rule, "6");
    assert.equal(vm.canUndoCheckEdit, false);
    vm.setCheckScore(vm.checkTableRows[0], "2.5");
    vm.setCheckMessage("第三項核對說明");
    const third = state(vm);

    vm.selectCheckBatchItem("0");
    assert.deepEqual(state(vm), first);
    vm.undoCheckEdit();
    assert.deepEqual(
        vm.checkTableRows.map((row: any) => row.code),
        ["4-req", "4-dyk"],
    );
    assert.deepEqual(vm.checkedRowsModel, [1]);
    vm.redoCheckEdit();
    assert.deepEqual(state(vm), first);
    vm.resetCheckItem(vm.checkTableRows[1]);
    assert.equal(vm.checkTableRows[1].code, "4-dyk?");
    assert.equal(vm.checkTableRows[1].description, "首項");
    assert.equal(vm.checkTableRows[1].score, "2");
    assert.deepEqual(vm.checkedRowsModel, [0, 1]);
    vm.undoCheckEdit();
    vm.selectCheckBatchItem("1");
    assert.deepEqual(state(vm), second);
    vm.undoCheckEdit();
    assert.equal(vm.currentNomination.message, "");
    vm.previousCheckItem();
    assert.equal(vm.checkBatchIndex, 0);
    assert.equal(vm.currentNomination.message, "第一項核對說明");
    assert.equal(vm.checkTableRows[1].code, "4-req");
    vm.selectCheckBatchItem("2");
    assert.deepEqual(state(vm), third);
    vm.undoCheckEdit();
    assert.equal(vm.currentNomination.message, "");
    assert.equal(vm.checkTableRows[0].score, "2.5");
    vm.redoCheckEdit();
    assert.deepEqual(state(vm), third);
    assert.deepEqual(events, []);
});

test("switching batch tabs preserves unfinished reason repair and the rebuilt checking baseline", () => {
    const { vm, events } = fixture();
    vm.openCheckBatch([entry("4-dyk(", 1), entry("1c", 2)]);
    assert.equal(vm.view, "reason-builder");
    vm.checkReasonDraft.ruleStatus["2-c"].selected = true;
    vm.checkReasonDraft.ruleStatus["2-c"].desc = "修復說明";
    vm.checkReasonDraft.ruleStatus["2-c"].score = 1.5;
    vm.selectCheckBatchItem("1");
    assert.equal(vm.view, "main");
    vm.selectCheckBatchItem("0");
    assert.equal(vm.view, "reason-builder");
    assert.equal(vm.checkOriginalRequestReasonText, "4-dyk(");
    assert.equal(vm.checkReasonDraft.ruleStatus["2-c"].selected, true);
    assert.equal(vm.checkReasonDraft.ruleStatus["2-c"].desc, "修復說明");
    vm.continueCheckReasonBuilder();
    assert.equal(vm.view, "main");
    assert.equal(vm.canUndoCheckEdit, false);
    assert.equal(vm.currentNomination.replaceRequestReason, true);
    vm.setCheckScore(vm.checkTableRows[0], "4.5");
    vm.selectCheckBatchItem("1");
    vm.previousCheckItem();
    assert.equal(vm.view, "main");
    assert.equal(vm.checkTableRows[0].score, "4.5");
    assert.equal(vm.canUndoCheckEdit, true);
    vm.resetCheckItem(vm.checkTableRows[0]);
    assert.equal(vm.checkTableRows[0].score, "1.5");
    assert.equal(vm.checkTableRows[0].description, "修復說明");
    vm.undoCheckEdit();
    assert.equal(vm.checkTableRows[0].score, "4.5");
    assert.deepEqual(events, []);
});

test("Next stages each nomination and the final save completes the batch once", async () => {
    const { vm, stages, committed, events } = fixture();
    const outcome = vm.openCheckBatch([
        entry("1c", 1),
        entry("2-b", 2),
        entry("6", 3, "second-table", 1),
    ]);
    vm.setCheckMessage("第一項核對說明");
    await vm.save();
    assert.equal(vm.open, true);
    assert.equal(vm.checkBatchIndex, 1);
    assert.deepEqual(vm.checkBatchStatuses, ["saved", "pending", "pending"]);
    assert.deepEqual(events, ["stage:1"]);
    vm.setCheckScore(vm.checkTableRows[0], "1.5");
    await vm.save();
    assert.equal(vm.checkBatchIndex, 2);
    assert.deepEqual(events, ["stage:1", "stage:2"]);
    await vm.save();
    assert.equal(await outcome, CHECK_OUTCOME.SAVE);
    assert.equal(vm.open, false);
    assert.deepEqual(events, ["stage:1", "stage:2", "stage:3", "complete"]);
    assert.equal(committed.length, 1);
    assert.equal(committed[0].length, 3);
    assert.equal(stages[0].nomination.message, "第一項核對說明");
    assert.equal(stages[1].nomination.ruleTokens[0].score, 1.5);
});

test("failed completion keeps the last draft open and retry does not stage unchanged nominations twice", async () => {
    const { vm, stages, committed, events } = fixture({
        completeResults: [true, true, false],
    });
    const outcome = vm.openCheckBatch([entry("1c", 1), entry("2-b", 2)]);
    await vm.save();
    vm.setCheckMessage("保留最後一項說明");
    await vm.save();
    assert.equal(vm.open, true);
    assert.equal(vm.checkBatchIndex, 1);
    assert.deepEqual(vm.checkBatchStatuses, ["saved", "saved"]);
    assert.equal(vm.currentNomination.message, "保留最後一項說明");
    assert.equal(stages.length, 2);
    await vm.save();
    assert.equal(vm.open, true);
    assert.equal(stages.length, 2);
    vm.setCheckScore(vm.checkTableRows[0], "1.5");
    assert.deepEqual(vm.checkBatchStatuses, ["saved", "pending"]);
    await vm.save();
    assert.equal(await outcome, CHECK_OUTCOME.SAVE);
    assert.equal(stages.length, 3);
    assert.deepEqual(events, [
        "stage:1",
        "stage:2",
        "complete",
        "complete",
        "discard:2",
        "stage:2",
        "complete",
    ]);
    assert.equal(committed.length, 1);
    assert.equal(committed[0].length, 2);
    assert.equal(committed[0][1].ruleTokens[0].score, 1.5);
});

test("skipping a previously staged item discards its score before moving next", async () => {
    const { vm, discarded, committed, events } = fixture();
    const outcome = vm.openCheckBatch([entry("1c", 1), entry("2-b", 2)]);
    await vm.save();
    vm.previousCheckItem();
    assert.equal(vm.checkBatchIndex, 0);
    await vm.skip();
    assert.equal(vm.checkBatchIndex, 1);
    assert.deepEqual(vm.checkBatchStatuses, ["skipped", "pending"]);
    assert.deepEqual(discarded, [{ type: "acg2", position: 1 }]);
    await vm.save();
    assert.equal(await outcome, CHECK_OUTCOME.SAVE);
    assert.deepEqual(events, ["stage:1", "discard:1", "stage:2", "complete"]);
    assert.equal(committed[0].length, 1);
    assert.equal(committed[0][0].pageName, "Article 2");
});

test("saving the last tab returns to unprocessed checks before completing the batch", async () => {
    const { vm, stages, committed, events } = fixture();
    const outcome = vm.openCheckBatch([entry("1c", 1), entry("2-b", 2)]);
    vm.selectCheckBatchItem("1");
    await vm.save();
    assert.equal(vm.open, true);
    assert.equal(vm.checkBatchIndex, 0);
    assert.deepEqual(vm.checkBatchStatuses, ["pending", "saved"]);
    assert.deepEqual(events, ["stage:2"]);
    await vm.save();
    assert.equal(await outcome, CHECK_OUTCOME.SAVE);
    assert.deepEqual(events, ["stage:2", "stage:1", "complete"]);
    assert.equal(stages.length, 2);
    assert.equal(committed[0].length, 2);
});

test("a staging failure retains the current draft and does not advance the batch", async () => {
    const results = [true, false];
    const { vm, stages, events } = fixture({
        stage: async () => results.shift() ?? false,
    });
    const outcome = vm.openCheckBatch([entry("1c", 1), entry("2-b", 2)]);
    vm.setCheckMessage("保留失敗項目說明");
    await vm.save();
    assert.equal(vm.open, true);
    assert.equal(vm.checkBatchIndex, 0);
    assert.equal(vm.currentNomination.message, "保留失敗項目說明");
    assert.deepEqual(vm.checkBatchStatuses, ["pending", "pending"]);
    assert.deepEqual(events, ["stage:1"]);
    await vm.save();
    assert.equal(vm.checkBatchIndex, 1);
    assert.equal(stages.length, 2);
    assert.deepEqual(vm.checkBatchStatuses, ["saved", "pending"]);
    vm.requestCancel();
    assert.equal(await outcome, CHECK_OUTCOME.CANCEL);
});

test("cancel closes the continuous batch without committing staged items", async () => {
    const { vm, committed, events } = fixture();
    const outcome = vm.openCheckBatch([entry("1c", 1), entry("2-b", 2)]);
    await vm.save();
    vm.setCheckScore(vm.checkTableRows[0], "1.5");
    vm.requestCancel();
    assert.equal(await outcome, CHECK_OUTCOME.CANCEL);
    assert.equal(vm.open, false);
    assert.equal(vm.canUndoCheckEdit, false);
    assert.deepEqual(events, ["stage:1"]);
    assert.equal(committed.length, 0);
});

test("deferring the remaining item commits staged checks only and retains drafts after a completion failure", async () => {
    const { vm, committed, events } = fixture({
        completeResults: [true, false],
    });
    const outcome = vm.openCheckBatch([entry("1c", 1), entry("2-b", 2)]);
    await vm.save();
    vm.setCheckScore(vm.checkTableRows[0], "1.5");
    vm.setCheckMessage("未暫存的目前項目");
    const current = state(vm);
    await vm.skip();
    assert.equal(vm.open, true);
    assert.deepEqual(state(vm), current);
    assert.deepEqual(vm.checkBatchStatuses, ["saved", "skipped"]);
    assert.equal(committed.length, 0);
    await vm.skip();
    assert.equal(await outcome, CHECK_OUTCOME.SAVE);
    assert.equal(vm.open, false);
    assert.deepEqual(events, [
        "stage:1",
        "discard:2",
        "complete",
        "discard:2",
        "complete",
    ]);
    assert.equal(committed.length, 1);
    assert.equal(committed[0].length, 1);
    assert.equal(committed[0][0].pageName, "Article 1");
});

test("pending staging blocks navigation, cancellation, and duplicate Next actions", async () => {
    let release!: (failed: boolean) => void;
    const staged = new Promise<boolean>((resolve) => {
        release = resolve;
    });
    const { vm, stages, events } = fixture({ stage: () => staged });
    const outcome = vm.openCheckBatch([entry("1c", 1), entry("2-b", 2)]);
    const saving = vm.save();
    assert.equal(vm.busy, true);
    vm.selectCheckBatchItem("1");
    vm.previousCheckItem();
    vm.requestCancel();
    await vm.skip();
    await vm.completeCheckBatch();
    await vm.save();
    assert.equal(vm.open, true);
    assert.equal(vm.checkBatchIndex, 0);
    assert.equal(stages.length, 1);
    assert.deepEqual(events, ["stage:1"]);
    release(false);
    await saving;
    assert.equal(vm.busy, false);
    assert.equal(vm.checkBatchIndex, 1);
    vm.requestCancel();
    assert.equal(await outcome, CHECK_OUTCOME.CANCEL);
});

test("raw existing checks preserve their source across tabs and stage before advancing", async () => {
    const { vm, stages, rawStages, committed, events } = fixture({
        rawStage: async () => false,
    });
    const outcome = vm.openCheckBatch([rawCheckEntry(1), entry("2-b", 2)]);
    assert.equal(vm.view, "main");
    assert.equal(vm.sourceFallbackActive, true);
    assert.equal(vm.currentNomination.checkSourceOnly, true);
    assert.equal(vm.canUndoCheckEdit, false);
    const edited = vm.currentNomination.rawSourceText.replace(
        "Manually checked: three points",
        "{{ACG提名2/check|ver=1|1a}}--~~~~",
    );
    vm.setRawSourceText(edited);
    vm.selectCheckBatchItem("1");
    assert.equal(vm.sourceFallbackActive, false);
    vm.previousCheckItem();
    assert.equal(vm.currentNomination.rawSourceText, edited);
    await vm.save();
    assert.equal(vm.open, true);
    assert.equal(vm.checkBatchIndex, 1);
    assert.deepEqual(vm.checkBatchStatuses, ["saved", "pending"]);
    assert.deepEqual(rawStages, [
        {
            fields: {
                條目名稱: "Article 1",
                用戶名稱: "Recipient 1",
                提名理由: "{{ACG提名2/request|ver=1|1a}}",
                核對用: "{{ACG提名2/check|ver=1|1a}}--~~~~",
            },
            target: { type: "acg2", position: 1 },
            check: true,
        },
    ]);
    assert.equal(stages.length, 0);
    await vm.save();
    assert.equal(await outcome, CHECK_OUTCOME.SAVE);
    assert.deepEqual(events, ["raw:1", "stage:2", "complete"]);
    assert.equal(committed[0].length, 2);
});

test("failed raw staging retains source and retries without advancing prematurely", async () => {
    const results = [true, false];
    const { vm, rawStages, events } = fixture({
        rawStage: async () => results.shift() ?? false,
    });
    const outcome = vm.openCheckBatch([rawCheckEntry(1), entry("2-b", 2)]);
    const source = vm.currentNomination.rawSourceText;
    await vm.save();
    assert.equal(vm.open, true);
    assert.equal(vm.checkBatchIndex, 0);
    assert.equal(vm.currentNomination.rawSourceText, source);
    assert.deepEqual(vm.checkBatchStatuses, ["pending", "pending"]);
    await vm.save();
    assert.equal(vm.checkBatchIndex, 1);
    assert.equal(rawStages.length, 2);
    assert.deepEqual(events, ["raw:1", "raw:1"]);
    vm.requestCancel();
    assert.equal(await outcome, CHECK_OUTCOME.CANCEL);
});

test("editing an accepted raw check discards its staged result before deferring the remaining items", async () => {
    const { vm, rawStages, committed, events } = fixture({
        rawStage: async () => false,
    });
    const outcome = vm.openCheckBatch([rawCheckEntry(1), entry("2-b", 2)]);
    await vm.save();
    vm.previousCheckItem();
    vm.setRawSourceText(vm.currentNomination.rawSourceText);
    assert.deepEqual(vm.checkBatchStatuses, ["saved", "pending"]);
    assert.deepEqual(events, ["raw:1"]);
    vm.setRawSourceText(
        vm.currentNomination.rawSourceText.replace(
            "Manually checked: three points",
            "{{ACG提名2/check|ver=1|1a}}--~~~~",
        ),
    );
    assert.deepEqual(vm.checkBatchStatuses, ["pending", "pending"]);
    assert.deepEqual(events, ["raw:1", "discard:1"]);
    await vm.skip();
    await vm.skip();
    assert.equal(await outcome, CHECK_OUTCOME.SAVE);
    assert.equal(rawStages.length, 1);
    assert.equal(committed[0].length, 0);
    assert.deepEqual(events, [
        "raw:1",
        "discard:1",
        "discard:1",
        "discard:2",
        "complete",
    ]);
});

test("invalid raw fields cannot stage and pending raw saves reject late source updates", async () => {
    let release!: (failed: boolean) => void;
    const staging = new Promise<boolean>((resolve) => {
        release = resolve;
    });
    const { vm, rawStages, events } = fixture({ rawStage: () => staging });
    const outcome = vm.openCheckBatch([rawCheckEntry(1), entry("2-b", 2)]);
    const source = vm.currentNomination.rawSourceText;
    vm.setRawSourceText("incomplete source");
    await vm.save();
    assert.equal(vm.checkBatchIndex, 0);
    assert.equal(vm.error.length > 0, true);
    assert.equal(rawStages.length, 0);
    vm.setRawSourceText(source);
    const saving = vm.save();
    assert.equal(vm.busy, true);
    vm.setRawSourceText("late source update");
    vm.selectCheckBatchItem("1");
    await vm.save();
    assert.equal(vm.currentNomination.rawSourceText, source);
    assert.equal(vm.checkBatchIndex, 0);
    assert.equal(rawStages.length, 1);
    release(false);
    await saving;
    assert.equal(vm.checkBatchIndex, 1);
    assert.deepEqual(events, ["raw:1"]);
    vm.requestCancel();
    assert.equal(await outcome, CHECK_OUTCOME.CANCEL);
});
