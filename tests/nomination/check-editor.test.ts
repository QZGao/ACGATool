import assert from "node:assert/strict";
import test from "node:test";

import { createNominationModel } from "../../src/features/nomination/model.ts";
import { createDialogHost } from "../../src/features/nomination/dialog-host.ts";
import { dialogServices, dialogRuntime, instantiateHost } from "./fixture.ts";
const { nominationPayload } = createNominationModel(dialogServices);
import {
    formatNominationCheckWikitext,
    NominationRuleSet,
    parseReasonTokens,
} from "../../src/domain/rules.ts";

const { ruleNames, ruleDict } = NominationRuleSet();
const savedChecks: Array<{ payload: any; target: unknown }> = [];
const host = createDialogHost(
    dialogRuntime,
    {
        saveNewNomination() {
            assert.fail("unexpected new nomination");
        },
        saveModifiedNomination() {
            assert.fail("unexpected nomination edit");
        },
        saveRawNominationSource() {
            assert.fail("unexpected raw-source save");
        },
        async saveNominationCheck(payload, target) {
            savedChecks.push({ payload, target });
            return false;
        },
    },
    dialogServices,
);

function openCheck(reason: string, overrides = {}) {
    const vm = instantiateHost(host);
    vm.openCheck(
        {
            awarder: "Example",
            pageName: "Example article",
            requestReasonText: reason,
            reasonParse: parseReasonTokens(reason, ruleDict),
            ...overrides,
        },
        { type: "acg2", position: 1 },
    );
    return vm;
}

function formattedCheck(vm: any) {
    return formatNominationCheckWikitext(
        nominationPayload(vm.currentNomination, true),
        ruleNames,
        ruleDict,
    );
}

test.beforeEach(() => {
    savedChecks.length = 0;
});

test("checking preserves every supported complete-review code as one row through saving", async () => {
    for (const code of ["5x", "5x-bcr", "5x-gan", "5x-acr", "5x-fac"]) {
        const vm = openCheck(code);
        assert.equal(vm.view, "main");
        assert.deepEqual(
            vm.checkTableRows.map(
                (row: {
                    code: string;
                    rule: string;
                    index: number;
                    description: string;
                    score: string;
                }) => row.rule,
            ),
            [code],
        );
        assert.deepEqual(vm.checkedRowsModel, [0]);
        assert.deepEqual(formattedCheck(vm), {
            ok: true,
            wikitext: `{{ACG提名2/check|ver=1|${code}}}--~~~~`,
            reasonScore: ruleDict[code].score,
        });
        assert.ok(
            vm.checkRuleItems.some(
                (item: { value: string }) => item.value === code,
            ),
        );
        assert.ok(
            vm.codePreviewResult.text.includes(
                `|核對用1 = {{ACG提名2/check|ver=1|${code}}}--~~~~`,
            ),
        );
        await vm.save();
        const { payload } = savedChecks.at(-1)!;
        assert.deepEqual(
            payload.ruleTokens.map(
                (row: {
                    code: string;
                    rule: string;
                    index: number;
                    description: string;
                    score: string;
                }) => row.code,
            ),
            [code],
        );
        assert.equal(payload.requestReasonText, code);
        assert.equal(payload.replaceRequestReason, undefined);
    }
});

test("complete reviews retain custom totals, descriptions, and repeated occurrences", () => {
    const vm = openCheck("5x?(首項)[2.5] 5x(末項)[0.5]");
    assert.equal(vm.view, "main");
    assert.deepEqual(
        vm.checkTableRows.map(
            (row: {
                code: string;
                rule: string;
                index: number;
                description: string;
                score: string;
            }) => row.code,
        ),
        ["5x?", "5x"],
    );
    vm.checkedRowsModel = [0];
    assert.deepEqual(formattedCheck(vm), {
        ok: true,
        wikitext:
            "{{ACG提名2/check|ver=1|5x(首項)[2.5]|no=5x(末項)[0.5]}}--~~~~",
        reasonScore: 2.5,
    });
});

test("changing a code updates defaults while retaining row order and selection", () => {
    const vm = openCheck("1c 4-dyk 4-dyk");
    vm.checkedRowsModel = [0, 2];
    vm.setCheckCode(vm.checkTableRows[0], "1a");
    vm.setCheckCode(vm.checkTableRows[1], "4-req");
    assert.deepEqual(
        vm.checkTableRows.map(
            (row: {
                code: string;
                rule: string;
                index: number;
                description: string;
                score: string;
            }) => row.rule,
        ),
        ["1a", "4-req", "4-dyk"],
    );
    assert.deepEqual(vm.checkedRowsModel, [0, 2]);
    assert.equal(vm.checkTableRows[0].description, ruleDict["1a"].label);
    assert.equal(vm.checkTableRows[0].score, "1");
    assert.equal(vm.checkTableRows[1].description, ruleDict["4-req"].label);
    assert.deepEqual(formattedCheck(vm), {
        ok: true,
        wikitext: "{{ACG提名2/check|ver=1|1a 4-dyk|no=4-req}}--~~~~",
        reasonScore: 2,
    });
    assert.equal(vm.currentNomination.requestReasonText, "1c 4-dyk 4-dyk");
});

test("changing a code preserves custom description and score and clears its pending marker", () => {
    const vm = openCheck("4-dyk?(筆記)[0.5]");
    vm.setCheckCode(vm.checkTableRows[0], "1c");
    assert.deepEqual(
        vm.checkTableRows.map(
            (row: {
                code: string;
                rule: string;
                index: number;
                description: string;
                score: string;
            }) => row.code,
        ),
        ["1c"],
    );
    assert.deepEqual(formattedCheck(vm), {
        ok: true,
        wikitext: "{{ACG提名2/check|ver=1|1c(筆記)[0.5]}}--~~~~",
        reasonScore: 0.5,
    });
});

test("adding and editing repeated items updates the preview and saved check", async () => {
    const vm = openCheck("1c 4-dyk");
    vm.checkedRowsModel = [0];
    vm.newCheckRuleCode = "4-dyk";
    vm.addCheckItem();
    assert.deepEqual(
        vm.checkTableRows.map(
            (row: {
                code: string;
                rule: string;
                index: number;
                description: string;
                score: string;
            }) => row.rule,
        ),
        ["1c", "4-dyk", "4-dyk"],
    );
    assert.deepEqual(vm.checkedRowsModel, [0, 2]);
    assert.equal(vm.newCheckRuleCode, null);
    vm.setCheckCode(vm.checkTableRows[0], "1a");
    vm.setCheckDescription(vm.checkTableRows[2], "追加");
    vm.setCheckScore(vm.checkTableRows[2], "0.5");
    const expected =
        "{{ACG提名2/check|ver=1|1a 4-dyk(追加)[0.5]|no=4-dyk}}--~~~~";
    assert.ok(vm.codePreviewResult.text.includes(`|核對用1 = ${expected}`));
    await vm.save();
    assert.equal(savedChecks.length, 1);
    const { payload, target } = savedChecks[0];
    assert.deepEqual(target, { type: "acg2", position: 1 });
    assert.deepEqual(
        formatNominationCheckWikitext(payload, ruleNames, ruleDict),
        {
            ok: true,
            wikitext: expected,
            reasonScore: 1.5,
        },
    );
    assert.equal(payload.requestReasonText, "1c 4-dyk");
    assert.equal(payload.replaceRequestReason, undefined);
});

test("items can be added and recoded after rebuilding a malformed request", () => {
    const vm = openCheck("4-dyk(");
    assert.equal(vm.view, "reason-builder");
    vm.checkReasonDraft.ruleStatus["1c"].selected = true;
    vm.continueCheckReasonBuilder();
    assert.equal(vm.currentNomination.ruleTokens, null);
    vm.setCheckCode(vm.checkTableRows[0], "1a");
    vm.newCheckRuleCode = "1c";
    vm.addCheckItem();
    assert.deepEqual(
        vm.checkTableRows.map(
            (row: {
                code: string;
                rule: string;
                index: number;
                description: string;
                score: string;
            }) => row.rule,
        ),
        ["1a", "1c"],
    );
    assert.deepEqual(vm.checkedRowsModel, [0, 1]);
    const payload = nominationPayload(vm.currentNomination, true);
    assert.equal(payload.replaceRequestReason, true);
    assert.equal(payload.requestReasonText, "1c");
    assert.deepEqual(formattedCheck(vm), {
        ok: true,
        wikitext: "{{ACG提名2/check|ver=1|1a 1c}}--~~~~",
        reasonScore: 4,
    });
    vm.checkedRowsModel = [];
    assert.deepEqual(formattedCheck(vm), {
        ok: true,
        wikitext: "{{ACG提名2/check|ver=1|0}}--~~~~",
        reasonScore: 0,
    });
});

test("adding to an empty check selects the new item and unavailable edits are ignored", () => {
    const vm = openCheck("");
    vm.addCheckItem();
    assert.equal(vm.checkTableRows.length, 0);
    vm.newCheckRuleCode = "invalid";
    vm.addCheckItem();
    assert.equal(vm.checkTableRows.length, 0);
    vm.newCheckRuleCode = "1c";
    vm.addCheckItem();
    assert.deepEqual(vm.checkedRowsModel, [0]);
    vm.setCheckCode(vm.checkTableRows[0], "invalid");
    vm.busy = true;
    vm.newCheckRuleCode = "1a";
    vm.addCheckItem();
    vm.setCheckCode(vm.checkTableRows[0], "1a");
    assert.deepEqual(
        vm.checkTableRows.map(
            (row: {
                code: string;
                rule: string;
                index: number;
                description: string;
                score: string;
            }) => row.rule,
        ),
        ["1c"],
    );
});

test("added items can move before existing items in the preview and saved check", async () => {
    const vm = openCheck("2-b 1c");
    vm.newCheckRuleCode = "2-c";
    vm.addCheckItem();
    const added = vm.checkTableRows[2];
    vm.moveCheckItem(added, -1);
    vm.moveCheckItem(added, -1);
    assert.deepEqual(
        vm.checkTableRows.map(
            (row: {
                code: string;
                rule: string;
                index: number;
                description: string;
                score: string;
            }) => row.rule,
        ),
        ["2-c", "2-b", "1c"],
    );
    assert.deepEqual(
        vm.checkTableRows.map(
            (row: {
                code: string;
                rule: string;
                index: number;
                description: string;
                score: string;
            }) => row.index,
        ),
        [0, 1, 2],
    );
    assert.deepEqual(vm.checkedRowsModel, [0, 1, 2]);
    const expected = "{{ACG提名2/check|ver=1|2-c 2-b 1c}}--~~~~";
    assert.ok(vm.codePreviewResult.text.includes(`|核對用1 = ${expected}`));
    await vm.save();
    const { payload } = savedChecks[0];
    assert.equal(payload.requestReasonText, "2-b 1c");
    assert.deepEqual(
        formatNominationCheckWikitext(payload, ruleNames, ruleDict),
        {
            ok: true,
            wikitext: expected,
            reasonScore: 7,
        },
    );
});

test("moving duplicate items keeps selections, descriptions, and scores on the correct occurrence", () => {
    const vm = openCheck("4-dyk?(首項)[2] 1c 4-dyk(末項)[0.5]");
    vm.checkedRowsModel = [0, 1];
    vm.moveCheckItem(vm.checkTableRows[2], -1);
    vm.moveCheckItem(vm.checkTableRows[0], 1);
    assert.deepEqual(
        vm.checkTableRows.map(
            (row: {
                code: string;
                rule: string;
                index: number;
                description: string;
                score: string;
            }) => row.description,
        ),
        ["末項", "首項", ruleDict["1c"].label],
    );
    assert.deepEqual(
        vm.checkTableRows.map(
            (row: {
                code: string;
                rule: string;
                index: number;
                description: string;
                score: string;
            }) => row.score,
        ),
        ["0.5", "2", "3"],
    );
    assert.deepEqual(vm.checkedRowsModel, [1, 2]);
    assert.equal(vm.checkTableRows[1].code, "4-dyk?");
    vm.setCheckCode(vm.checkTableRows[1], "4-req");
    vm.newCheckRuleCode = "2-c";
    vm.addCheckItem();
    assert.deepEqual(vm.checkedRowsModel, [1, 2, 3]);
    assert.deepEqual(formattedCheck(vm), {
        ok: true,
        wikitext:
            "{{ACG提名2/check|ver=1|4-req(首項)[2] 1c 2-c|no=4-dyk(末項)[0.5]}}--~~~~",
        reasonScore: 6,
    });
});

test("moving legacy check rows preserves their status when converting to ordered tokens", () => {
    const vm = openCheck("4-dyk(");
    vm.checkReasonDraft.ruleStatus["2-c"].selected = true;
    vm.checkReasonDraft.ruleStatus["2-b"].selected = true;
    vm.continueCheckReasonBuilder();
    assert.equal(vm.currentNomination.ruleTokens, null);
    vm.checkedRowsModel = [1];
    vm.moveCheckItem(vm.checkTableRows[1], -1);
    assert.deepEqual(
        vm.checkTableRows.map(
            (row: {
                code: string;
                rule: string;
                index: number;
                description: string;
                score: string;
            }) => row.rule,
        ),
        ["2-b", "2-c"],
    );
    assert.deepEqual(vm.checkedRowsModel, [0]);
    assert.equal(vm.currentNomination.replaceRequestReason, true);
    assert.equal(vm.currentNomination.requestReasonText, "2-c 2-b");
    assert.deepEqual(formattedCheck(vm), {
        ok: true,
        wikitext: "{{ACG提名2/check|ver=1|2-b|no=2-c}}--~~~~",
        reasonScore: 3,
    });
});

test("reordering respects boundaries and disabled controls", () => {
    const vm = openCheck("2-b 1c");
    vm.moveCheckItem(vm.checkTableRows[0], -1);
    vm.moveCheckItem(vm.checkTableRows[1], 1);
    vm.moveCheckItem(vm.checkTableRows[0], 2);
    vm.moveCheckItem({ status: {} }, 1);
    vm.busy = true;
    vm.moveCheckItem(vm.checkTableRows[0], 1);
    vm.busy = false;
    vm.view = "reason-builder";
    vm.moveCheckItem(vm.checkTableRows[0], 1);
    assert.deepEqual(
        vm.checkTableRows.map(
            (row: {
                code: string;
                rule: string;
                index: number;
                description: string;
                score: string;
            }) => row.rule,
        ),
        ["2-b", "1c"],
    );
    assert.deepEqual(vm.checkedRowsModel, [0, 1]);
});

test("deleting reordered duplicate items preserves remaining selections and saved scores", async () => {
    const vm = openCheck("4-dyk?(首項)[2] 1c 4-dyk(末項)[0.5]");
    vm.checkedRowsModel = [1, 2];
    vm.moveCheckItem(vm.checkTableRows[2], -1);
    vm.moveCheckItem(vm.checkTableRows[1], -1);
    vm.removeCheckItem(vm.checkTableRows[1]);
    assert.deepEqual(
        vm.checkTableRows.map(
            (row: {
                code: string;
                rule: string;
                index: number;
                description: string;
                score: string;
            }) => row.description,
        ),
        ["末項", ruleDict["1c"].label],
    );
    assert.deepEqual(vm.checkedRowsModel, [0, 1]);
    assert.deepEqual(formattedCheck(vm), {
        ok: true,
        wikitext: "{{ACG提名2/check|ver=1|4-dyk(末項)[0.5] 1c}}--~~~~",
        reasonScore: 3.5,
    });
    vm.removeCheckItem(vm.checkTableRows[0]);
    assert.deepEqual(vm.checkedRowsModel, [0]);
    const expected = "{{ACG提名2/check|ver=1|1c}}--~~~~";
    assert.ok(vm.codePreviewResult.text.includes(`|核對用1 = ${expected}`));
    await vm.save();
    const { payload } = savedChecks[0];
    assert.equal(
        payload.requestReasonText,
        "4-dyk?(首項)[2] 1c 4-dyk(末項)[0.5]",
    );
    assert.deepEqual(
        formatNominationCheckWikitext(payload, ruleNames, ruleDict),
        {
            ok: true,
            wikitext: expected,
            reasonScore: 3,
        },
    );
});

test("legacy items can be deleted down to an empty check and new items can still be added", () => {
    const vm = openCheck("4-dyk(");
    vm.checkReasonDraft.ruleStatus["2-c"].selected = true;
    vm.checkReasonDraft.ruleStatus["2-b"].selected = true;
    vm.continueCheckReasonBuilder();
    assert.equal(vm.currentNomination.ruleTokens, null);
    vm.checkedRowsModel = [1];
    vm.removeCheckItem(vm.checkTableRows[0]);
    assert.deepEqual(
        vm.checkTableRows.map(
            (row: {
                code: string;
                rule: string;
                index: number;
                description: string;
                score: string;
            }) => row.rule,
        ),
        ["2-b"],
    );
    assert.deepEqual(vm.checkedRowsModel, [0]);
    vm.removeCheckItem(vm.checkTableRows[0]);
    assert.deepEqual(vm.checkTableRows, []);
    assert.deepEqual(vm.checkedRowsModel, []);
    assert.deepEqual(formattedCheck(vm), {
        ok: true,
        wikitext: "{{ACG提名2/check|ver=1|0}}--~~~~",
        reasonScore: 0,
    });
    vm.newCheckRuleCode = "1c";
    vm.addCheckItem();
    assert.deepEqual(
        vm.checkTableRows.map(
            (row: {
                code: string;
                rule: string;
                index: number;
                description: string;
                score: string;
            }) => row.rule,
        ),
        ["1c"],
    );
    assert.deepEqual(vm.checkedRowsModel, [0]);
});

test("deleting stale rows or using disabled controls does not remove another item", () => {
    const vm = openCheck("2-b 1c");
    const deleted = vm.checkTableRows[0];
    vm.removeCheckItem(deleted);
    vm.removeCheckItem(deleted);
    vm.removeCheckItem({ status: {} });
    vm.busy = true;
    vm.removeCheckItem(vm.checkTableRows[0]);
    vm.busy = false;
    vm.view = "reason-builder";
    vm.removeCheckItem(vm.checkTableRows[0]);
    assert.deepEqual(
        vm.checkTableRows.map(
            (row: {
                code: string;
                rule: string;
                index: number;
                description: string;
                score: string;
            }) => row.rule,
        ),
        ["1c"],
    );
    assert.deepEqual(vm.checkedRowsModel, [0]);
});

test("checking offers exactly the five nomination categories and rejects cross-group changes", () => {
    const vm = openCheck("1a 4-dyk");
    assert.deepEqual(
        vm.nominationCategoryButtons.map(
            (button: { value: string }) => button.value,
        ),
        ["article", "review", "media", "recommendation", "other"],
    );
    assert.equal(vm.checkRuleCategory, "article");
    assert.ok(
        vm.checkRuleItems.every((item: { value: string }) =>
            /^[1-4](?:\D|$)/u.test(item.value),
        ),
    );
    vm.newCheckRuleCode = "5x";
    vm.addCheckItem();
    vm.setCheckCode(vm.checkTableRows[0], "6");
    vm.setCheckRuleCategory("review");
    assert.equal(vm.checkRuleCategory, "article");
    assert.deepEqual(
        vm.checkTableRows.map((row: { rule: string }) => row.rule),
        ["1a", "4-dyk"],
    );
    vm.removeCheckItem(vm.checkTableRows[0]);
    vm.removeCheckItem(vm.checkTableRows[0]);
    vm.setCheckRuleCategory("review");
    vm.newCheckRuleCode = "5x";
    vm.addCheckItem();
    assert.equal(vm.checkRuleCategory, "review");
    assert.deepEqual(
        vm.checkTableRows.map((row: { rule: string }) => row.rule),
        ["5x"],
    );
});

test("the empty check row infers its category and never selects an uncommitted row", () => {
    const vm = openCheck("1c");
    vm.removeCheckItem(vm.checkTableRows[0]);
    assert.ok(vm.checkRuleItems.some((item: any) => item.value === "6"));
    vm.addCheckItem("6");
    assert.equal(vm.checkRuleCategory, "media");
    assert.deepEqual(
        vm.checkTableRows.map((row: any) => row.rule),
        ["6"],
    );
    assert.ok(vm.checkRuleItems.every((item: any) => /^6/u.test(item.value)));
    vm.addCheckItem("1a");
    assert.equal(vm.checkTableRows.length, 1);
    vm.checkedRowsModel = [0, 1, -1, 0.5];
    assert.deepEqual(vm.checkedRowsModel, [0]);
});

test("reset restores the original checking rows without changing the checker comment", () => {
    const vm = openCheck("1c 4-dyk?(原始說明)[0.5]");
    const original = vm.codePreviewResult.text;
    vm.setCheckScore(vm.checkTableRows[0], "4.5");
    vm.setCheckDescription(vm.checkTableRows[1], "修改說明");
    vm.checkedRowsModel = [1];
    vm.addCheckItem("4-req");
    vm.removeCheckItem(vm.checkTableRows[0]);
    vm.currentNomination.message = "保留核對說明";
    vm.resetCheckItems();
    assert.deepEqual(
        vm.checkTableRows.map((row: any) => row.code),
        ["1c", "4-dyk?"],
    );
    assert.deepEqual(vm.checkedRowsModel, [0, 1]);
    assert.equal(vm.checkTableRows[1].description, "原始說明");
    assert.equal(vm.checkTableRows[1].score, "0.5");
    assert.equal(vm.currentNomination.message, "保留核對說明");
    vm.currentNomination.message = "";
    assert.equal(vm.codePreviewResult.text, original);
    vm.setCheckScore(vm.checkTableRows[0], "4");
    vm.busy = true;
    vm.resetCheckItems();
    assert.equal(vm.checkTableRows[0].score, "4");
    vm.busy = false;
    vm.resetCheckItems();
    assert.equal(vm.checkTableRows[0].score, "3");
    assert.deepEqual(savedChecks, []);
});

test("reset after reason repair restores the rebuilt checking items", () => {
    const vm = openCheck("4-dyk(");
    vm.checkReasonDraft.ruleStatus["2-c"].selected = true;
    vm.continueCheckReasonBuilder();
    vm.removeCheckItem(vm.checkTableRows[0]);
    vm.addCheckItem("6");
    vm.resetCheckItems();
    assert.deepEqual(
        vm.checkTableRows.map((row: any) => row.rule),
        ["2-c"],
    );
    assert.equal(vm.checkRuleCategory, "article");
    assert.equal(vm.currentNomination.replaceRequestReason, true);
    assert.deepEqual(vm.checkedRowsModel, [0]);
});

test("mixed legacy nomination groups require explicit repair without changing identity", () => {
    const vm = openCheck("1a 5x 6");
    assert.equal(vm.view, "reason-builder");
    assert.equal(vm.checkOriginalRequestReasonText, "1a 5x 6");
    vm.checkReasonDraft.ruleStatus["1a"].selected = true;
    vm.continueCheckReasonBuilder();
    assert.equal(vm.view, "main");
    assert.equal(vm.currentNomination.awarder, "Example");
    assert.equal(vm.currentNomination.pageName, "Example article");
    assert.equal(vm.currentNomination.requestReasonText, "1a");
    assert.equal(vm.currentNomination.replaceRequestReason, true);
});

test("supported requests can be repaired with the same author form before checking", () => {
    const vm = openCheck("1a");
    assert.equal(vm.checkReasonRepairAvailable, true);
    vm.backToCheckReasonBuilder();
    assert.equal(vm.view, "reason-builder");
    assert.equal(vm.currentNomination.activeRuleCategory, "article");
    vm.checkReasonDraft.ruleStatus["1a"].selected = false;
    vm.checkReasonDraft.ruleStatus["1b"].selected = true;
    vm.continueCheckReasonBuilder();
    assert.equal(vm.view, "main");
    assert.equal(vm.currentNomination.requestReasonText, "1b");
    assert.equal(vm.currentNomination.replaceRequestReason, true);
});

test("batch actions describe staged results and the final submission", () => {
    const vm = openCheck("1a");
    vm.batchStatus = { current: 1, total: 2 };
    assert.equal(vm.saveLabel, "暫存並繼續");
    vm.batchStatus = { current: 2, total: 2 };
    assert.equal(vm.saveLabel, "儲存全部");
    vm.batchStatus = null;
    assert.equal(vm.saveLabel, "儲存");
});

test("repairing a nomination validates and saves corrected recipient and article together", async () => {
    const vm = openCheck("1a");
    vm.backToCheckReasonBuilder();
    vm.checkReasonDraft.awarder = "";
    vm.continueCheckReasonBuilder();
    assert.equal(vm.view, "reason-builder");
    assert.ok(vm.checkReasonDraft.errors.awarder);
    vm.checkReasonDraft.awarder = "Correct recipient";
    vm.checkReasonDraft.pageName = "Correct article";
    vm.continueCheckReasonBuilder();
    assert.equal(vm.view, "main");
    assert.equal(vm.currentNomination.awarder, "Correct recipient");
    assert.equal(vm.currentNomination.pageName, "Correct article");
    await vm.save();
    assert.equal(savedChecks[0].payload.awarder, "Correct recipient");
    assert.equal(savedChecks[0].payload.pageName, "Correct article");
    assert.equal(savedChecks[0].payload.replaceRequestReason, true);
});

test("unrepresentable pending reviews still expose deliberate nomination repair", () => {
    const vm = openCheck("5x?(Custom_review)[2.5]");
    assert.equal(vm.view, "main");
    assert.equal(vm.checkReasonRepairAvailable, true);
    assert.equal(
        vm.currentNomination.requestReasonText,
        "5x?(Custom_review)[2.5]",
    );
    vm.backToCheckReasonBuilder();
    assert.equal(vm.view, "reason-builder");
    assert.equal(vm.checkOriginalRequestReasonText, "5x?(Custom_review)[2.5]");
    assert.equal(vm.currentNomination.awarder, "Example");
});
