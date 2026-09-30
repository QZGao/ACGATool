import assert from "node:assert/strict";
import test from "node:test";

import { createNominationModel } from "../../src/features/nomination/model.ts";
import { createDialogHost } from "../../src/features/nomination/dialog-host.ts";
import { dialogServices, dialogRuntime, instantiateHost } from "./fixture.ts";
const { nominationPayload } = createNominationModel(dialogServices);
import {
    formatNominationCheckWikitext,
    NominationRuleAliases,
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

function checkingState(vm: any) {
    return {
        rows: vm.checkTableRows.map((row: any) => ({
            code: row.code,
            description: row.description,
            score: row.score,
            selected: Boolean(row.status.selected),
        })),
        selected: [...vm.checkedRowsModel],
        category: vm.checkRuleCategory,
        message: vm.currentNomination.message,
    };
}

test.beforeEach(() => {
    savedChecks.length = 0;
});

test("rechecking restores saved check rows, scores, selection and comment while preserving the original request", async () => {
    const request = "1c 4-dyk 4-dyk";
    const vm = openCheck(request, {
        checkWikitext:
            "{{ACG提名2/check|ver=1|1a(更正)[0.5] 4-dyk(重複獎勵)[0.5]|no=4-req(不符合)[0]}}保留說明--~~~~",
    });
    assert.equal(vm.view, "main");
    assert.equal(vm.currentNomination.requestReasonText, request);
    assert.deepEqual(checkingState(vm).rows, [
        { code: "1a", description: "更正", score: "0.5", selected: true },
        {
            code: "4-dyk",
            description: "重複獎勵",
            score: "0.5",
            selected: true,
        },
        { code: "4-req", description: "不符合", score: "0", selected: false },
    ]);
    assert.deepEqual(vm.checkedRowsModel, [0, 1]);
    assert.equal(vm.currentNomination.message, "保留說明");
    assert.equal(
        vm.codePreviewResult.text.includes(
            `|提名理由1 = {{ACG提名2/request|ver=1|${request}}}`,
        ),
        true,
    );
    const before = formattedCheck(vm);
    assert.equal(before.reasonScore, 1);
    await vm.save();
    assert.deepEqual(
        formatNominationCheckWikitext(
            savedChecks[0].payload,
            ruleNames,
            ruleDict,
        ),
        before,
    );
});

test("a previously rejected nomination stays deselected when reopened for rechecking", () => {
    for (const previous of [
        "{{ACG提名2/check|ver=1|0}}不符合--~~~~",
        "{{ACG提名2/check|ver=1|0|no=1c 4-dyk}}不符合--~~~~",
    ]) {
        const vm = openCheck("1c 4-dyk", { checkWikitext: previous });
        assert.equal(vm.view, "main");
        assert.deepEqual(vm.checkedRowsModel, []);
        assert.equal(
            vm.checkTableRows.every((row: any) => !row.status.selected),
            true,
        );
        assert.equal(vm.currentNomination.message, "不符合");
        assert.equal(formattedCheck(vm).reasonScore, 0);
    }
});

test("rechecking hydrates each exclusive nomination category and preserves review quick totals", () => {
    for (const [request, saved, category, score] of [
        ["1c", "1a[0.5]", "article", 0.5],
        ["5x-fac", "5x-fac-half", "review", 3],
        ["6-fp", "6[0.5]", "media", 0.5],
        ["7", "7[0.5]", "recommendation", 0.5],
        ["8(工作)", "8(更正工作)[0.5]", "other", 0.5],
    ] as const) {
        const vm = openCheck(request, {
            checkWikitext: `{{ACG提名2/check|ver=1|${saved}}}--~~~~`,
        });
        assert.equal(vm.view, "main", saved);
        assert.equal(vm.checkRuleCategory, category, saved);
        assert.equal(formattedCheck(vm).reasonScore, score, saved);
    }
});

test("unrecognized saved checks and mixed checked categories open the raw source without replacing the old award", () => {
    for (const previous of [
        "Manually checked: three points",
        "{{ACG提名2/check|ver=1|unknown}}--~~~~",
        "{{ACG提名2/check|ver=1|1a|no=6}}--~~~~",
    ]) {
        const vm = openCheck("1a", { checkWikitext: previous });
        assert.equal(vm.view, "main", previous);
        assert.equal(vm.currentNomination.sourceOnly, true, previous);
        assert.equal(vm.currentNomination.checkSourceOnly, true, previous);
        assert.equal(vm.sourceFallbackActive, true, previous);
        assert.equal(
            vm.currentNomination.rawSourceText.includes(previous),
            true,
            previous,
        );
    }
});

test("checking recognizes every alias and saves canonical rules while preserving the request", async () => {
    for (const [alias, canonical] of Object.entries(NominationRuleAliases())) {
        for (const reason of [alias, alias.toUpperCase()]) {
            const vm = openCheck(reason);
            const defaults = ruleDict[canonical];
            assert.equal(vm.view, "main", reason);
            assert.deepEqual(
                vm.checkTableRows.map(
                    (row: {
                        code: string;
                        rule: string;
                        description: string;
                        score: string;
                    }) => ({
                        code: row.code,
                        rule: row.rule,
                        description: row.description,
                        score: row.score,
                    }),
                ),
                [
                    {
                        code: canonical,
                        rule: canonical,
                        description: defaults.label,
                        score: String(defaults.score),
                    },
                ],
                reason,
            );
            assert.deepEqual(vm.checkedRowsModel, [0], reason);
            const expected = {
                ok: true,
                wikitext: `{{ACG提名2/check|ver=1|${canonical}}}--~~~~`,
                reasonScore: defaults.score,
            };
            assert.deepEqual(formattedCheck(vm), expected, reason);
            assert.ok(
                vm.codePreviewResult.text.includes(
                    `|提名理由1 = {{ACG提名2/request|ver=1|${reason}}}`,
                ),
                reason,
            );
            await vm.save();
            const { payload } = savedChecks.at(-1)!;
            assert.deepEqual(
                payload.ruleTokens.map((row: { code: string }) => row.code),
                [canonical],
                reason,
            );
            assert.equal(payload.requestReasonText, reason);
            assert.equal(payload.replaceRequestReason, undefined);
            assert.deepEqual(
                formatNominationCheckWikitext(payload, ruleNames, ruleDict),
                expected,
                reason,
            );
        }
    }
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
    assert.deepEqual(checkingState(vm).rows, [
        {
            code: "1c",
            description: ruleDict["1c"].label,
            score: String(ruleDict["1c"].score),
            selected: true,
        },
    ]);
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

test("moving rebuilt legacy check rows preserves their status", () => {
    const vm = openCheck("4-dyk(");
    vm.checkReasonDraft.ruleStatus["2-c"].selected = true;
    vm.checkReasonDraft.ruleStatus["2-b"].selected = true;
    vm.continueCheckReasonBuilder();
    assert.deepEqual(
        vm.checkTableRows.map((row: any) => ({
            code: row.code,
            selected: row.status.selected,
        })),
        [
            { code: "2-c", selected: true },
            { code: "2-b", selected: true },
        ],
    );
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
    assert.deepEqual(vm.checkedRowsModel, [0, 1]);
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
    assert.equal(vm.checkRuleCategory, "article");
    assert.deepEqual(
        vm.checkTableRows.map((row: { rule: string }) => row.rule),
        ["1a", "4-dyk"],
    );
    vm.removeCheckItem(vm.checkTableRows[0]);
    vm.removeCheckItem(vm.checkTableRows[0]);
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

test("row reset restores the correct duplicate after edits, reordering, and deletion", () => {
    const vm = openCheck("4-dyk?(首項)[2] 1c 4-dyk(末項)[0.5] 2-b");
    const first = vm.checkTableRows[0];
    const last = vm.checkTableRows[2];
    vm.setCheckCode(first, "4-req");
    vm.setCheckDescription(first, "首項修改");
    vm.setCheckScore(first, "4.5");
    vm.setCheckDescription(last, "末項修改");
    vm.setCheckScore(last, "1.5");
    vm.checkedRowsModel = [1];
    vm.moveCheckItem(first, 1);
    vm.moveCheckItem(first, 1);
    vm.removeCheckItem(vm.checkTableRows[0]);
    vm.moveCheckItem(first, 1);
    vm.setCheckMessage("保留核對說明");
    const otherRows = checkingState(vm).rows.slice(0, 2);

    vm.resetCheckItem(vm.checkTableRows[2]);
    assert.deepEqual(checkingState(vm).rows.slice(0, 2), otherRows);
    assert.deepEqual(checkingState(vm).rows[2], {
        code: "4-dyk?",
        description: "首項",
        score: "2",
        selected: true,
    });
    assert.deepEqual(vm.checkedRowsModel, [2]);
    assert.equal(vm.currentNomination.message, "保留核對說明");
    assert.equal(
        vm.currentNomination.requestReasonText,
        "4-dyk?(首項)[2] 1c 4-dyk(末項)[0.5] 2-b",
    );

    vm.resetCheckItem(vm.checkTableRows[0]);
    assert.deepEqual(checkingState(vm).rows[0], {
        code: "4-dyk",
        description: "末項",
        score: "0.5",
        selected: true,
    });
    assert.deepEqual(vm.checkedRowsModel, [0, 2]);
    vm.setCheckCode(vm.checkTableRows[2], "4-req");
    vm.setCheckScore(vm.checkTableRows[2], "3");
    vm.resetCheckItem(vm.checkTableRows[2]);
    assert.equal(vm.checkTableRows[2].code, "4-dyk?");
    assert.equal(vm.checkTableRows[2].score, "2");
    assert.deepEqual(savedChecks, []);
});

test("added rows reset to their own initial defaults and full reset renews row origins", () => {
    const vm = openCheck("1c");
    vm.addCheckItem("4-req");
    vm.setCheckCode(vm.checkTableRows[1], "4-dyk");
    vm.setCheckDescription(vm.checkTableRows[1], "新增項目修改");
    vm.setCheckScore(vm.checkTableRows[1], "2.5");
    vm.checkedRowsModel = [0];
    vm.resetCheckItem(vm.checkTableRows[1]);
    assert.deepEqual(checkingState(vm).rows[1], {
        code: "4-req",
        description: ruleDict["4-req"].label,
        score: String(ruleDict["4-req"].score),
        selected: true,
    });
    assert.deepEqual(vm.checkedRowsModel, [0, 1]);

    vm.undoCheckEdit();
    assert.equal(vm.checkTableRows[1].rule, "4-dyk");
    assert.equal(vm.checkTableRows[1].score, "2.5");
    assert.deepEqual(vm.checkedRowsModel, [0]);
    vm.redoCheckEdit();
    vm.setCheckCode(vm.checkTableRows[1], "4-dyk");
    vm.resetCheckItem(vm.checkTableRows[1]);
    assert.equal(vm.checkTableRows[1].rule, "4-req");
    assert.equal(vm.checkTableRows[1].description, ruleDict["4-req"].label);

    vm.setCheckMessage("保留核對說明");
    vm.setCheckScore(vm.checkTableRows[0], "4.5");
    vm.resetCheckItems();
    assert.equal(vm.checkTableRows.length, 1);
    assert.equal(vm.currentNomination.message, "保留核對說明");
    vm.setCheckCode(vm.checkTableRows[0], "1a");
    vm.setCheckScore(vm.checkTableRows[0], "0.5");
    vm.resetCheckItem(vm.checkTableRows[0]);
    assert.equal(vm.checkTableRows[0].rule, "1c");
    assert.equal(vm.checkTableRows[0].score, "3");
});

test("checking undo and redo restore every table edit and the checker comment", () => {
    const vm = openCheck("1c 4-dyk?(原始說明)[0.5]");
    const states = [checkingState(vm)];
    assert.equal(vm.canUndoCheckEdit, false);
    assert.equal(vm.canRedoCheckEdit, false);
    const edit = (operation: () => void) => {
        operation();
        states.push(checkingState(vm));
    };
    edit(() => vm.setCheckScore(vm.checkTableRows[0], "4.5"));
    edit(() => vm.setCheckDescription(vm.checkTableRows[1], "修改說明"));
    edit(() => vm.setCheckCode(vm.checkTableRows[1], "4-req"));
    edit(() => {
        vm.checkedRowsModel = [1];
    });
    edit(() => vm.addCheckItem("2-b"));
    edit(() => vm.moveCheckItem(vm.checkTableRows[2], -1));
    edit(() => vm.removeCheckItem(vm.checkTableRows[0]));
    edit(() => vm.setCheckMessage("核對說明"));
    edit(() => vm.resetCheckItem(vm.checkTableRows[1]));
    edit(() => vm.resetCheckItems());
    assert.equal(vm.canUndoCheckEdit, true);
    assert.equal(vm.canRedoCheckEdit, false);

    for (let index = states.length - 2; index >= 0; index--) {
        vm.undoCheckEdit();
        assert.deepEqual(checkingState(vm), states[index], `undo ${index}`);
    }
    assert.equal(vm.canUndoCheckEdit, false);
    assert.equal(vm.canRedoCheckEdit, true);
    for (let index = 1; index < states.length; index++) {
        vm.redoCheckEdit();
        assert.deepEqual(checkingState(vm), states[index], `redo ${index}`);
    }
    assert.equal(vm.canUndoCheckEdit, true);
    assert.equal(vm.canRedoCheckEdit, false);
    assert.deepEqual(savedChecks, []);
});

test("undo and redo retain duplicate row origins when deletion is restored", () => {
    const vm = openCheck("4-dyk?(首項)[2] 4-dyk(末項)[0.5]");
    vm.setCheckCode(vm.checkTableRows[0], "4-req");
    vm.moveCheckItem(vm.checkTableRows[0], 1);
    vm.removeCheckItem(vm.checkTableRows[0]);
    vm.undoCheckEdit();
    assert.deepEqual(
        vm.checkTableRows.map((row: any) => row.description),
        ["末項", "首項"],
    );
    assert.equal(vm.canRedoCheckEdit, true);
    vm.resetCheckItem(vm.checkTableRows[1]);
    assert.equal(vm.canRedoCheckEdit, false);
    assert.equal(vm.checkTableRows[1].code, "4-dyk?");
    assert.equal(vm.checkTableRows[1].score, "2");
    vm.undoCheckEdit();
    assert.equal(vm.checkTableRows[1].code, "4-req");
    vm.redoCheckEdit();
    assert.equal(vm.checkTableRows[1].code, "4-dyk?");
    vm.setCheckDescription(vm.checkTableRows[0], "末項修改");
    vm.resetCheckItem(vm.checkTableRows[0]);
    assert.equal(vm.checkTableRows[0].description, "末項");
    assert.equal(vm.checkTableRows[0].score, "0.5");
});

test("unchanged checking controls do not create history or discard redo", () => {
    const vm = openCheck("1c");
    const unchanged = () => {
        const row = vm.checkTableRows[0];
        vm.setCheckScore(row, "3");
        vm.setCheckDescription(row, row.description);
        vm.setCheckCode(row, "1c");
        vm.checkedRowsModel = [0];
        vm.setCheckMessage(vm.currentNomination.message);
        vm.resetCheckItem(row);
        vm.resetCheckItems();
        vm.moveCheckItem(vm.checkTableRows[0], -1);
        vm.removeCheckItem({ status: {} });
        vm.resetCheckItem({ status: {} });
    };
    unchanged();
    assert.equal(vm.canUndoCheckEdit, false);
    assert.equal(vm.canRedoCheckEdit, false);
    vm.setCheckScore(vm.checkTableRows[0], "4");
    vm.undoCheckEdit();
    unchanged();
    assert.equal(vm.canUndoCheckEdit, false);
    assert.equal(vm.canRedoCheckEdit, true);
    vm.redoCheckEdit();
    assert.equal(vm.checkTableRows[0].score, "4");
    vm.undoCheckEdit();
    vm.setCheckMessage("改用新的核對說明");
    assert.equal(vm.canRedoCheckEdit, false);
    vm.undoCheckEdit();
    assert.equal(vm.currentNomination.message, "");
});

test("row reset and history respect busy state and reject stale session rows", async () => {
    const vm = openCheck("1c");
    const stale = vm.checkTableRows[0];
    vm.setCheckScore(stale, "4");
    const edited = checkingState(vm);
    vm.busy = true;
    vm.resetCheckItem(stale);
    vm.undoCheckEdit();
    assert.deepEqual(checkingState(vm), edited);
    vm.busy = false;
    vm.view = "reason-builder";
    vm.resetCheckItem(stale);
    vm.undoCheckEdit();
    assert.deepEqual(checkingState(vm), edited);
    vm.view = "main";
    vm.undoCheckEdit();
    vm.busy = true;
    vm.redoCheckEdit();
    assert.equal(vm.checkTableRows[0].score, "3");
    vm.busy = false;
    vm.redoCheckEdit();
    vm.resetCheckItem(stale);
    assert.equal(vm.checkTableRows[0].score, "4");
    const removed = vm.checkTableRows[0];
    vm.removeCheckItem(removed);
    vm.resetCheckItem(removed);
    assert.equal(vm.checkTableRows.length, 0);

    await vm.finishSession("cancel");
    vm.resetCheckItem(stale);
    vm.undoCheckEdit();
    vm.redoCheckEdit();
    assert.equal(vm.canUndoCheckEdit, false);
    assert.equal(vm.canRedoCheckEdit, false);
    vm.openCheck(
        {
            awarder: "Example",
            pageName: "Other article",
            requestReasonText: "2-b",
            reasonParse: parseReasonTokens("2-b", ruleDict),
        },
        { type: "acg2", position: 2 },
    );
    assert.equal(vm.canUndoCheckEdit, false);
    assert.equal(vm.canRedoCheckEdit, false);
    const nextSession = checkingState(vm);
    vm.resetCheckItem(stale);
    vm.undoCheckEdit();
    vm.redoCheckEdit();
    assert.deepEqual(checkingState(vm), nextSession);
    vm.kind = "new";
    vm.resetCheckItem(vm.checkTableRows[0]);
    assert.deepEqual(checkingState(vm), nextSession);
});

test("repaired legacy rows establish fresh reset origins and checking history", () => {
    const vm = openCheck("4-dyk(");
    assert.equal(vm.canUndoCheckEdit, false);
    assert.equal(vm.canRedoCheckEdit, false);
    vm.checkReasonDraft.ruleStatus["2-c"].selected = true;
    vm.checkReasonDraft.ruleStatus["2-b"].selected = true;
    vm.continueCheckReasonBuilder();
    const rebuilt = checkingState(vm);
    assert.equal(vm.canUndoCheckEdit, false);
    assert.equal(vm.canRedoCheckEdit, false);
    vm.setCheckScore(vm.checkTableRows[0], "4.5");
    vm.moveCheckItem(vm.checkTableRows[0], 1);
    vm.resetCheckItem(vm.checkTableRows[1]);
    assert.equal(vm.checkTableRows[1].rule, "2-c");
    assert.equal(vm.checkTableRows[1].score, String(ruleDict["2-c"].score));
    vm.undoCheckEdit();
    assert.equal(vm.checkTableRows[1].score, "4.5");
    vm.redoCheckEdit();
    vm.undoCheckEdit();
    vm.undoCheckEdit();
    vm.undoCheckEdit();
    assert.deepEqual(checkingState(vm), rebuilt);
    assert.equal(vm.canUndoCheckEdit, false);
    assert.equal(vm.currentNomination.replaceRequestReason, true);
    assert.equal(vm.currentNomination.requestReasonText, "2-c 2-b");
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

test("single checks use the save action", () => {
    const vm = openCheck("1a");
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
