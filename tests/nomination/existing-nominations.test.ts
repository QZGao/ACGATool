import assert from "node:assert/strict";
import test from "node:test";
import { createDialogHost } from "../../src/features/nomination/dialog-host.ts";
import type {
    DialogOperations,
    DialogServices,
} from "../../src/features/nomination/contracts.ts";
import type { ExistingNomination } from "../../src/domain/existing-nominations.ts";
import {
    NominationRuleSet,
    parseReasonTokens,
} from "../../src/domain/rules.ts";
import { dialogRuntime, dialogServices, instantiateHost } from "./fixture.ts";

const operations: DialogOperations = {
    async saveNewNomination() {
        return false;
    },
    async saveModifiedNomination() {
        return false;
    },
    async saveNominationCheck() {
        return false;
    },
    async saveRawNominationSource() {
        return false;
    },
};
const entry: ExistingNomination & { url: string } = {
    pageName: "Example article",
    awarder: "Example",
    date: "9月27日",
    index: 1,
    sectionOccurrence: 0,
    dateLabel: "9月27日",
    dateAnchor: "9月27日",
    reasonText: "1c",
    checked: true,
    url: "/wiki/Registry#date",
};
function fixture(
    lookup: NonNullable<DialogServices["getExistingNominations"]>,
) {
    return instantiateHost(
        createDialogHost(dialogRuntime, operations, {
            ...dialogServices,
            getPageName: () => "Example article",
            getExistingNominations: lookup,
        }),
    );
}
async function settle() {
    await Promise.resolve();
    await Promise.resolve();
}

test("checking excludes itself and warns only when both page and recipient match", async () => {
    const vm = fixture(async () => [
        entry,
        { ...entry, index: 2 },
        { ...entry, awarder: "Other", index: 3 },
        { ...entry, pageName: "Different", index: 4 },
    ]);
    vm.openCheck(
        {
            pageName: "Example article",
            awarder: "Example",
            requestReasonText: "1c",
        },
        {
            type: "acg2",
            position: 1,
            date: "9月27日",
            index: 1,
            sectionOccurrence: 0,
        },
    );
    await settle();
    assert.equal(vm.existingNominationNotices.length, 1);
    assert.deepEqual(
        vm.existingNominationNotices.map((item: any) => item.awarder),
        ["Example"],
    );
    assert.equal(vm.existingNominationNotices[0].index, 2);
    assert.equal(vm.existingNominationNotices[0].url, entry.url);
    assert.ok(vm.existingNominationNotices[0].description.includes("1c"));
    await vm.finishSession("cancel");
    assert.equal(vm.existingNominationNotices.length, 0);
});

test("duplicate notices follow explicit recipients and contextual title defaults", async () => {
    const requested: string[] = [];
    const vm = fixture(async (page) => {
        requested.push(page);
        return [entry];
    });
    vm.openNew();
    await settle();
    assert.equal(vm.existingNominationNotices[0].awarder, "Example");
    vm.currentNomination.awarder = "Other";
    assert.equal(vm.existingNominationNotices.length, 0);
    vm.currentNomination.awarder = "User:example";
    assert.equal(vm.existingNominationNotices.length, 1);
    vm.currentNomination.pageName = "example_article#History";
    assert.equal(vm.existingNominationNotices.length, 1);
    vm.currentNomination.pageName = "Different";
    await vm.loadExistingNominations();
    assert.deepEqual(requested, ["Example article", "Different"]);
    assert.equal(vm.existingNominationNotices.length, 0);
});

test("author duplicate notices appear only for article, review, and media categories", async () => {
    const requested: string[] = [];
    const vm = fixture(async (page) => {
        requested.push(page);
        return [entry];
    });
    vm.openNew();
    await settle();
    const nomination = vm.currentNomination;
    nomination.media.pageName = entry.pageName;
    nomination.otherPageName = entry.pageName;
    for (const category of ["article", "review", "media"]) {
        nomination.activeRuleCategory = category;
        assert.equal(vm.existingNominationNotices.length, 1, category);
    }
    for (const category of ["recommendation", "other"]) {
        nomination.activeRuleCategory = category;
        assert.equal(vm.existingNominationNotices.length, 0, category);
        assert.equal(vm.existingNominationLookupFailed, false, category);
        await vm.loadExistingNominations();
    }
    assert.deepEqual(requested, [entry.pageName]);
    nomination.activeRuleCategory = "article";
    assert.equal(vm.existingNominationNotices.length, 1);
});

test("checking duplicate notices use the parsed nomination category", async () => {
    const { ruleDict } = NominationRuleSet();
    for (const [reason, category, expected] of [
        ["1c", "article", 1],
        ["5x", "review", 1],
        ["6", "media", 1],
        ["7", "recommendation", 0],
        ["8", "other", 0],
    ] as const) {
        const vm = fixture(async () => [entry]);
        vm.openCheck(
            {
                pageName: entry.pageName,
                awarder: entry.awarder,
                requestReasonText: reason,
                reasonParse: parseReasonTokens(reason, ruleDict),
            },
            { type: "acg2", position: 1 },
        );
        await settle();
        assert.equal(vm.currentNomination.activeRuleCategory, category);
        assert.equal(vm.existingNominationNotices.length, expected, category);
    }
});

test("a registry result cannot enter a later dialog session or a different target", async () => {
    let resolve!: (items: Array<ExistingNomination & { url: string }>) => void;
    const vm = fixture(
        () =>
            new Promise((done) => {
                resolve = done;
            }),
    );
    vm.openNew();
    const resolveFirst = resolve;
    vm.currentNomination.pageName = "Different";
    resolveFirst([entry]);
    await settle();
    assert.equal(vm.existingNominationNotices.length, 0);
    assert.deepEqual(vm.existingNominationEntries, {});
    await vm.finishSession("cancel");
    vm.openNew();
    const resolveSecond = resolve;
    await vm.finishSession("cancel");
    vm.openNew();
    resolveSecond([entry]);
    await settle();
    assert.equal(vm.existingNominationNotices.length, 0);
    resolve([entry]);
    await settle();
    assert.equal(vm.existingNominationNotices.length, 1);
});

test("lookup failures remain visible without disabling nomination editing", async () => {
    const failures: string[] = [];
    const vm = instantiateHost(
        createDialogHost(dialogRuntime, operations, {
            ...dialogServices,
            getPageName: () => "Example article",
            getExistingNominations: async () => {
                throw new Error("offline");
            },
            reportError: (_cause, operation) => {
                failures.push(operation);
            },
        }),
    );
    vm.openNew();
    await settle();
    assert.equal(vm.existingNominationLookupFailed, true);
    assert.equal(vm.busy, false);
    assert.deepEqual(failures, ["check-existing-nominations"]);
    for (const category of ["recommendation", "other"]) {
        vm.currentNomination.activeRuleCategory = category;
        assert.equal(vm.existingNominationLookupFailed, false, category);
    }
    vm.currentNomination.activeRuleCategory = "article";
    assert.equal(vm.existingNominationLookupFailed, true);
});
