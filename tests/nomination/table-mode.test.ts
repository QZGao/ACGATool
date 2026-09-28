import assert from "node:assert/strict";
import test from "node:test";

import { createDialogHost } from "../../src/features/nomination/dialog-host.ts";
import type { NewNominationBatch } from "../../src/features/nomination/contracts.ts";
import { dialogRuntime, dialogServices, instantiateHost } from "./fixture.ts";

function harness() {
    const previews: NewNominationBatch[] = [];
    const saves: NewNominationBatch[] = [];
    const vm = instantiateHost(
        createDialogHost(
            dialogRuntime,
            {
                async previewNewNomination(batch) {
                    previews.push(batch);
                    return { wikitext: "Preview source", html: "Preview" };
                },
                async saveNewNomination(batch) {
                    saves.push(batch);
                    return true;
                },
                saveModifiedNomination() {
                    assert.fail("unexpected edit");
                },
                saveNominationCheck() {
                    assert.fail("unexpected check");
                },
                saveRawNominationSource() {
                    assert.fail("unexpected source save");
                },
            },
            dialogServices,
        ),
    );
    void vm.openNew();
    return { vm, previews, saves };
}

function validArticle(draft: any, title: string) {
    draft.pageName = title;
    draft.ruleStatus["1c"].selected = true;
}

function titles(nominations: any[]) {
    return nominations.map((nomination) => nomination.pageName);
}

test("preview reports every invalid nomination in visible table order and skips frozen drafts", () => {
    const { vm } = harness();
    const first = vm.activeNomination;
    validArticle(first, "First article");
    vm.addNomination();
    const second = vm.activeNomination;
    validArticle(second, "Second article");
    vm.splitNominationTable();
    vm.addNominationTable();
    const third = vm.activeNomination;
    first.pageName = "";
    second.ruleStatus["1c"].score = 0.25;
    vm.reviewNominations();
    assert.equal(vm.activeTab, first.id);
    assert.match(vm.error, /（表格1）提名1、（表格1）提名2、（表格2）提名1/u);
    assert.ok(
        vm.errorDetails.some((issue: string) =>
            issue.startsWith("（表格1）提名2:"),
        ),
    );
    assert.ok(
        vm.errorDetails.some((issue: string) =>
            issue.startsWith("（表格2）提名1:"),
        ),
    );
    third.frozen = true;
    vm.reviewNominations();
    assert.doesNotMatch(vm.error, /表格2/u);
    vm.splitNominationTable();
    vm.reviewNominations();
    assert.match(vm.error, /提名1、提名2/u);
    assert.doesNotMatch(vm.error, /表格/u);
    vm.clearError();
    assert.deepEqual(vm.errorDetails, []);
});

test("split mode changes presentation without validating or replacing incomplete drafts", () => {
    const { vm } = harness();
    const first = vm.currentNomination;
    assert.equal(vm.splitTableMode, false);
    vm.splitNominationTable();
    assert.equal(vm.splitTableMode, true);
    assert.equal(vm.nominationTables.length, 1);
    assert.equal(vm.currentNomination, first);
    assert.equal(vm.error, "");

    vm.addNominationTable();
    assert.equal(vm.nominationTables.length, 1);
    assert.equal(vm.currentNomination, first);
    assert.notEqual(first.errors.pageName, "");
    assert.notEqual(first.errors.rules, "");
    validArticle(first, "First article");
    vm.addNominationTable();
    const second = vm.currentNomination;
    assert.equal(vm.nominationTables.length, 2);
    assert.notEqual(second.id, first.id);
    assert.equal(vm.error, "");
    vm.nominationTables[0].comment = "First comment";
    vm.nominationTables[1].comment = "Second comment";

    vm.splitNominationTable();
    assert.equal(vm.splitTableMode, false);
    assert.deepEqual(vm.nominations, [first, second]);
    assert.equal(vm.activeTab, second.id);
    vm.selectNomination(first.id);
    vm.splitNominationTable();
    assert.equal(vm.activeNominationTableIndex, 0);
    assert.equal(vm.currentNomination, first);
    assert.deepEqual(
        vm.nominationTables.map((table: any) => table.comment),
        ["First comment", "Second comment"],
    );
    assert.equal(first.errors.pageName, "");
    assert.equal(second.errors.pageName, "");
});

test("merged additions and removals update canonical groups and remove an emptied group", () => {
    const { vm } = harness();
    const first = vm.currentNomination;
    validArticle(first, "First article");
    vm.splitNominationTable();
    vm.addNominationTable();
    const second = vm.currentNomination;
    vm.nominationTables[0].comment = "Empty group comment";
    vm.nominationTables[1].comment = "Remaining group comment";
    vm.splitNominationTable();
    vm.selectNomination(first.id);
    vm.addNomination();
    const added = vm.activeNomination;
    assert.deepEqual(vm.nominationTables[0].nominations, [first]);
    assert.deepEqual(vm.nominationTables[1].nominations, [second, added]);

    vm.removeNomination(first.id);
    assert.equal(vm.nominationTables.length, 1);
    assert.deepEqual(vm.nominations, [second, added]);
    assert.equal(vm.nominationTables[0].comment, "Remaining group comment");
    vm.splitNominationTable();
    assert.deepEqual(vm.nominations, [second, added]);
    assert.equal(vm.nominationTables[0].comment, "Remaining group comment");
    assert.ok(vm.nominations.some((draft: any) => draft.id === vm.activeTab));
});

test("adding an item or table validates only the active nomination before changing groups", () => {
    const { vm } = harness();
    const first = vm.currentNomination;
    vm.addNomination();
    assert.equal(vm.nominations.length, 1);
    assert.equal(vm.activeTab, first.id);
    assert.notEqual(first.errors.pageName, "");
    assert.notEqual(first.errors.rules, "");

    validArticle(first, "First article");
    first.awarder = "";
    first.recipientDefault = "";
    first.articleRecipientDefault = "";
    first.ruleStatus["1c"].score = 0;
    vm.addNomination();
    assert.equal(vm.nominations.length, 1);
    assert.notEqual(first.errors.awarder, "");
    assert.notEqual(first.errors.rules, "");

    first.awarder = "Example";
    first.ruleStatus["1c"].score = 0.5;
    vm.addNomination();
    assert.equal(vm.nominations.length, 2);
    assert.equal(vm.error, "");
    const second = vm.activeNomination;
    vm.splitNominationTable();
    vm.addNominationTable();
    assert.equal(vm.nominationTables.length, 1);
    assert.equal(vm.activeTab, second.id);
    vm.selectNomination(first.id);
    vm.addNominationTable();
    assert.equal(vm.nominationTables.length, 2);
    assert.notEqual(vm.activeTab, second.id);
});

test("a merged summary edits original group coordinates and refreshes its flat draft view", () => {
    const { vm } = harness();
    validArticle(vm.currentNomination, "First article");
    vm.splitNominationTable();
    vm.addNominationTable();
    validArticle(vm.currentNomination, "Second article");
    vm.splitNominationTable();
    vm.reviewNominations();
    assert.equal(vm.view, "nomination-summary");
    assert.equal(vm.nominationSummaryTables.length, 1);
    const rows = vm.nominationSummaryTables[0].rows;
    assert.deepEqual(
        rows.map((row: any) => [row.tableIndex, row.index, row.number]),
        [
            [0, 0, 1],
            [1, 0, 2],
        ],
    );
    const second = rows[1];
    vm.editSummaryNomination(second.tableIndex, second.index, second.number);
    assert.equal(vm.editingNominationNumber, 2);
    vm.editingNomination.pageName = "Revised second article";
    vm.applyNominationEdit();
    assert.equal(vm.editingNomination, null);
    assert.deepEqual(
        vm.nominationTables.map((table: any) => titles(table.nominations)),
        [["First article"], ["Revised second article"]],
    );
    vm.backToNewNominations();
    assert.deepEqual(titles(vm.nominations), [
        "First article",
        "Revised second article",
    ]);
    vm.splitNominationTable();
    assert.equal(vm.currentNomination.pageName, "Revised second article");
});

test("review validates every canonical group and preview and save use the selected table layout", async () => {
    const { vm, previews, saves } = harness();
    validArticle(vm.currentNomination, "First article");
    vm.splitNominationTable();
    vm.addNominationTable();
    const invalid = vm.currentNomination;
    vm.nominationTables[0].comment = " First comment ";
    vm.nominationTables[1].comment = " Second comment ";
    vm.switchNominationTable(0);
    vm.reviewNominations();
    assert.equal(vm.view, "main");
    assert.equal(vm.activeTab, invalid.id);
    assert.equal(vm.activeNominationTableIndex, 1);

    vm.splitNominationTable();
    vm.selectNomination(vm.nominations[0].id);
    vm.reviewNominations();
    assert.equal(vm.view, "main");
    assert.equal(vm.splitTableMode, false);
    assert.equal(vm.nominations.length, 2);
    assert.equal(vm.activeTab, invalid.id);
    validArticle(invalid, "Second article");
    vm.setNominationTableComment(0, " Merged comment ");
    vm.reviewNominations();
    assert.equal(vm.view, "nomination-summary");
    await vm.previewNominations();
    assert.equal(previews.length, 1);
    assert.equal(previews[0].length, 1);
    assert.equal(previews[0][0].comment, "Merged comment");
    assert.deepEqual(titles(previews[0][0].nominations), [
        "First article",
        "Second article",
    ]);
    vm.closeNominationPreview();
    await vm.save();
    assert.deepEqual(saves[0], previews[0]);

    vm.backToNewNominations();
    vm.splitNominationTable();
    vm.reviewNominations();
    assert.equal(vm.nominationSummaryTables.length, 2);
    await vm.previewNominations();
    assert.deepEqual(
        previews[1].map((table: any) => ({
            titles: titles(table.nominations),
            comment: table.comment,
        })),
        [
            { titles: ["First article"], comment: "First comment" },
            { titles: ["Second article"], comment: "Second comment" },
        ],
    );
});

test("frozen rows stay visible without numbers and preserve the comments of submitted split groups", async () => {
    const { vm, previews, saves } = harness();
    validArticle(vm.currentNomination, "First group article");
    vm.splitNominationTable();
    vm.addNominationTable();
    validArticle(vm.currentNomination, "Second group first article");
    vm.addNomination();
    validArticle(vm.activeNomination, "Second group second article");
    vm.nominationTables[0].comment = "First group comment";
    vm.nominationTables[1].comment = "Second group comment";
    vm.reviewNominations();
    vm.toggleNominationFrozen(0, 0);
    vm.toggleNominationFrozen(1, 0);
    assert.equal(vm.hasSubmittableNominations, true);
    assert.deepEqual(
        vm.nominationSummaryTables.map((table: any) =>
            table.rows.map((row: any) => ({
                frozen: row.frozen,
                number: row.number,
                position: row.position,
            })),
        ),
        [
            [{ frozen: true, number: "", position: 1 }],
            [
                { frozen: true, number: "", position: 1 },
                { frozen: false, number: 1, position: 2 },
            ],
        ],
    );
    await vm.previewNominations();
    assert.equal(previews[0].length, 1);
    assert.equal(previews[0][0].comment, "Second group comment");
    assert.deepEqual(titles(previews[0][0].nominations), [
        "Second group second article",
    ]);
    vm.toggleNominationFrozen(1, 1);
    assert.equal(vm.nominationSummaryTables[1].rows[1].frozen, false);
    vm.closeNominationPreview();
    await vm.save();
    assert.deepEqual(saves[0], previews[0]);

    vm.toggleNominationFrozen(1, 1);
    assert.equal(vm.hasSubmittableNominations, false);
    assert.deepEqual(vm.nominationSubmissionTables(), []);
    await vm.previewNominations();
    await vm.save();
    assert.equal(vm.previewOpen, false);
    assert.equal(previews.length, 1);
    assert.equal(saves.length, 1);
    vm.toggleNominationFrozen(0, 0);
    assert.equal(vm.hasSubmittableNominations, true);
    assert.equal(vm.nominationSummaryTables[0].rows[0].number, 1);
    assert.equal(
        vm.nominationSubmissionTables()[0].comment,
        "First group comment",
    );

    vm.backToNewNominations();
    vm.splitNominationTable();
    vm.reviewNominations();
    assert.deepEqual(
        vm.nominationSummaryTables[0].rows.map((row: any) => [
            row.frozen,
            row.number,
            row.position,
        ]),
        [
            [false, 1, 1],
            [true, "", 2],
            [true, "", 3],
        ],
    );
    vm.toggleNominationFrozen(1, 1);
    assert.equal(vm.nominationSummaryTables[0].rows[2].number, 2);
    assert.deepEqual(titles(vm.nominationSubmissionTables()[0].nominations), [
        "First group article",
        "Second group second article",
    ]);
});

test("invalid frozen drafts can be reviewed but must be repaired before being included again", () => {
    const { vm } = harness();
    validArticle(vm.currentNomination, "Frozen article");
    const frozen = vm.currentNomination;
    vm.addNomination();
    validArticle(vm.activeNomination, "Submitted article");
    vm.reviewNominations();
    vm.toggleNominationFrozen(0, 0);
    vm.backToNewNominations();
    frozen.pageName = "";
    frozen.ruleStatus["1c"].score = Number.NaN;
    vm.reviewNominations();
    assert.equal(vm.view, "nomination-summary");
    assert.equal(vm.nominationSummaryTables[0].rows.length, 2);
    assert.equal(vm.nominationSummaryTables[0].rows[0].codes, "");
    assert.deepEqual(titles(vm.nominationSubmissionTables()[0].nominations), [
        "Submitted article",
    ]);
    vm.toggleNominationFrozen(0, 0);
    assert.equal(frozen.frozen, true);
    assert.notEqual(vm.error, "");
    assert.deepEqual(titles(vm.nominationSubmissionTables()[0].nominations), [
        "Submitted article",
    ]);

    vm.editSummaryNomination(0, 0, 1);
    vm.editingNomination.pageName = "Repaired article";
    vm.editingNomination.ruleStatus["1c"].score = 0.5;
    vm.toggleNominationFrozen(0, 1);
    assert.equal(vm.nominationSummaryTables[0].rows[1].frozen, false);
    vm.applyNominationEdit();
    assert.equal(vm.nominationTables[0].nominations[0].frozen, true);
    assert.deepEqual(titles(vm.nominationSubmissionTables()[0].nominations), [
        "Submitted article",
    ]);
    vm.busy = true;
    vm.toggleNominationFrozen(0, 0);
    assert.equal(vm.nominationTables[0].nominations[0].frozen, true);
    vm.busy = false;
    vm.toggleNominationFrozen(0, 0);
    assert.equal(vm.nominationTables[0].nominations[0].frozen, false);
    assert.deepEqual(titles(vm.nominationSubmissionTables()[0].nominations), [
        "Repaired article",
        "Submitted article",
    ]);
});
