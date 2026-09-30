import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentOptions } from "vue";
import { createNominationDialogs } from "../../src/features/nomination/dialog.ts";
import { createDialogHost } from "../../src/features/nomination/dialog-host.ts";
import { createNominationModel } from "../../src/features/nomination/model.ts";
import type { DykStatus } from "../../src/domain/dyk-status.ts";
import type {
    DialogOperations,
    DialogRuntime,
    DialogServices,
} from "../../src/features/nomination/contracts.ts";
import { dialogRuntime, dialogServices, instantiateHost } from "./fixture.ts";

const operations: DialogOperations = {
    saveNewNomination: async () => false,
    saveModifiedNomination: async () => false,
    saveNominationCheck: async () => false,
    saveRawNominationSource: async () => false,
};

function harness(failMount = false) {
    let removed = 0;
    let stylesRemoved = 0;
    let unmounted = 0;
    const controllers: any[] = [];
    const document = {
        createElement: () => ({
            className: "",
            remove() {
                removed++;
            },
        }),
        body: { appendChild() {} },
    } as unknown as Document;
    const runtime = {
        Codex: {},
        Vue: {
            createMwApp(component: ComponentOptions) {
                return {
                    mount() {
                        if (failMount) throw new Error("Mount failed");
                        const vm = instantiateHost(component);
                        controllers.push(vm);
                        return vm;
                    },
                    unmount() {
                        unmounted++;
                    },
                };
            },
        },
    } as unknown as DialogRuntime;
    return {
        create: () =>
            createNominationDialogs(runtime, operations, {
                ...dialogServices,
                document,
                addStyles: () => () => {
                    stylesRemoved++;
                },
            }),
        controllers,
        counts: () => ({ removed, stylesRemoved, unmounted }),
    };
}

test("dialog instances own independent drafts and disposing settles open requests", async () => {
    const fixture = harness();
    const first = fixture.create();
    const second = fixture.create();
    const pendingFirst = first.showNewNominationDialog();
    const pendingSecond = second.showNewNominationDialog();
    fixture.controllers[0].currentNomination.pageName = "First draft";
    assert.equal(fixture.controllers[1].currentNomination.pageName, "");
    first.dispose();
    assert.equal(await pendingFirst, "cancel");
    assert.equal(fixture.controllers[1].open, true);
    first.dispose();
    assert.equal(await first.showNewNominationDialog(), "cancel");
    second.dispose();
    assert.equal(await pendingSecond, "cancel");
    assert.deepEqual(fixture.counts(), {
        removed: 2,
        stylesRemoved: 2,
        unmounted: 2,
    });
});

function dykFixture(lookup: NonNullable<DialogServices["getDykStatus"]>) {
    const errors: Array<{ error: unknown; operation: string }> = [];
    const vm = instantiateHost(
        createDialogHost(dialogRuntime, operations, {
            ...dialogServices,
            getDykStatus: lookup,
            reportError(error, operation) {
                errors.push({ error, operation });
            },
        }),
    );
    const entry = (pageName: string, index = 0) => ({
        nomination: {
            awarder: "Recipient",
            pageName,
            ruleStatus: { "4-dyk": { selected: true, score: 1 } },
        },
        target: { type: "acg2", position: index + 1 },
        tableKey: "table-1",
        tableIndex: 0,
    });
    return { vm, errors, entry };
}

function deferredDyk() {
    let resolve!: (status: DykStatus) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<DykStatus>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}

test("DYK lookups reuse completed records and missing records across navigation and repair within one opening", async () => {
    const calls: string[] = [];
    const passed = { passed: true, date: "2026-09-29" };
    const missing = { passed: false, date: null };
    const { vm, entry } = dykFixture(async (pageName) => {
        calls.push(pageName);
        return pageName === "Other article" ? missing : passed;
    });
    const closed = vm.openCheckBatch([
        entry(":example   article#Section"),
        entry("Other article", 1),
        entry("Example_article", 2),
    ]);
    await vm.refreshDykStatus();
    assert.deepEqual(vm.dykStatus, passed);
    assert.equal(vm.dykTalkUrl, "/wiki/Talk%3AExample%20article");
    vm.view = "reason-builder";
    await vm.refreshDykStatus();
    assert.equal(vm.dykStatus, null);
    vm.view = "main";
    await vm.refreshDykStatus();
    assert.deepEqual(vm.dykStatus, passed);
    vm.activateCheckBatchItem(1);
    await vm.refreshDykStatus();
    assert.deepEqual(vm.dykStatus, missing);
    vm.activateCheckBatchItem(2);
    await vm.refreshDykStatus();
    assert.deepEqual(vm.dykStatus, passed);
    vm.activateCheckBatchItem(1);
    await vm.refreshDykStatus();
    assert.deepEqual(vm.dykStatus, missing);
    assert.deepEqual(calls, ["Example article", "Other article"]);
    await vm.finishSession("cancel");
    assert.equal(await closed, "cancel");
    assert.equal(vm.dykStatusRequests.size, 0);
    assert.equal(vm.dykStatus, null);
});

test("DYK lookups share in-flight requests and retain offscreen results without changing the active result", async () => {
    const first = deferredDyk();
    const second = deferredDyk();
    const calls: string[] = [];
    const { vm, entry } = dykFixture((pageName) => {
        calls.push(pageName);
        return pageName === "Other article" ? second.promise : first.promise;
    });
    const closed = vm.openCheckBatch([
        entry("Example_article"),
        entry("Other article", 1),
        entry("example article", 2),
    ]);
    const original = vm.refreshDykStatus();
    vm.activateCheckBatchItem(1);
    const offscreen = vm.refreshDykStatus();
    vm.activateCheckBatchItem(2);
    const active = vm.refreshDykStatus();
    await Promise.resolve();
    assert.deepEqual(calls, ["Example article", "Other article"]);
    const missing = { passed: false, date: null };
    second.resolve(missing);
    await offscreen;
    assert.equal(vm.dykStatus, null);
    assert.equal(vm.dykLoading, true);
    const passed = { passed: true, date: "2026-09-29" };
    first.resolve(passed);
    await Promise.all([original, active]);
    assert.deepEqual(vm.dykStatus, passed);
    assert.equal(vm.dykLoading, false);
    vm.activateCheckBatchItem(1);
    await vm.refreshDykStatus();
    assert.deepEqual(vm.dykStatus, missing);
    assert.equal(calls.length, 2);
    await vm.finishSession("cancel");
    assert.equal(await closed, "cancel");
});

test("closing and reopening a check starts a fresh DYK cache and ignores the prior opening's pending response", async () => {
    const oldLookup = deferredDyk();
    const newLookup = deferredDyk();
    let calls = 0;
    const { vm, entry } = dykFixture(() =>
        ++calls === 1 ? oldLookup.promise : newLookup.promise,
    );
    const firstClosed = vm.openCheckBatch([entry("Example article")]);
    const oldRequest = vm.refreshDykStatus();
    await Promise.resolve();
    await vm.finishSession("cancel");
    assert.equal(await firstClosed, "cancel");
    assert.equal(vm.dykStatusRequests.size, 0);
    const secondClosed = vm.openCheckBatch([entry("Example article")]);
    const newRequest = vm.refreshDykStatus();
    await Promise.resolve();
    assert.equal(calls, 2);
    oldLookup.resolve({ passed: true, date: "2026-09-29" });
    await oldRequest;
    assert.equal(vm.dykStatus, null);
    assert.equal(vm.dykLoading, true);
    const current = { passed: false, date: "2026-09-30" };
    newLookup.resolve(current);
    await newRequest;
    assert.deepEqual(vm.dykStatus, current);
    assert.equal(vm.dykLoading, false);
    await vm.finishSession("cancel");
    assert.equal(await secondClosed, "cancel");
});

test("a failed DYK request is shared, reported once, and can be retried during the same opening", async () => {
    const pending = deferredDyk();
    const failure = new Error("DYK lookup unavailable");
    const status = { passed: true, date: "2026-09-29" };
    let calls = 0;
    const { vm, entry, errors } = dykFixture(() =>
        ++calls === 1 ? pending.promise : Promise.resolve(status),
    );
    const closed = vm.openCheckBatch([entry("Example article")]);
    const first = vm.refreshDykStatus();
    const repeated = vm.refreshDykStatus();
    await Promise.resolve();
    assert.equal(calls, 1);
    pending.reject(failure);
    await Promise.all([first, repeated]);
    assert.equal(vm.dykError, true);
    assert.equal(vm.dykLoading, false);
    assert.equal(vm.dykStatusRequests.size, 0);
    assert.deepEqual(errors, [
        { error: failure, operation: "lookup-dyk-status" },
    ]);
    await vm.refreshDykStatus();
    assert.equal(calls, 2);
    assert.equal(vm.dykError, false);
    assert.deepEqual(vm.dykStatus, status);
    await vm.refreshDykStatus();
    assert.equal(calls, 2);
    await vm.finishSession("cancel");
    assert.equal(await closed, "cancel");
});

test("disposing a confirmation resolves false and failed mounts release owned DOM and styles", async () => {
    const fixture = harness();
    const dialogs = fixture.create();
    const pending = dialogs.showConfirmDialog({ message: "Confirm?" });
    dialogs.dispose();
    assert.equal(await pending, false);
    const failed = harness(true);
    assert.throws(() => failed.create(), /Mount failed/);
    assert.deepEqual(failed.counts(), {
        removed: 1,
        stylesRemoved: 1,
        unmounted: 0,
    });
});

test("the grouped check dialog wrapper opens its controller and disposal cancels the batch", async () => {
    const fixture = harness();
    const dialogs = fixture.create();
    const pending = dialogs.showCheckBatchDialog([
        {
            nomination: {
                awarder: "Recipient",
                pageName: "Article",
                ruleStatus: { "1a": { selected: true, score: 1 } },
            },
            target: { type: "acg2", position: 1 },
            tableKey: "table-1",
            tableIndex: 0,
        },
    ]);
    assert.equal(fixture.controllers[0].checkBatchEntries.length, 1);
    assert.equal(fixture.controllers[0].currentNomination.pageName, "Article");
    dialogs.dispose();
    assert.equal(await pending, "cancel");
    assert.equal(await dialogs.showCheckBatchDialog([]), "cancel");
    assert.deepEqual(fixture.counts(), {
        removed: 1,
        stylesRemoved: 1,
        unmounted: 1,
    });
});

test("a synchronous initial recipient lookup failure clears loading after the dialog opens", async () => {
    const failure = new Error("Recipient lookup unavailable");
    const errors: Array<{ error: unknown; operation: string }> = [];
    let lookups = 0;
    let writes = 0;
    const services = {
        ...dialogServices,
        getPageName: () => "Example article",
        getSuggestedRecipient() {
            lookups++;
            assert.equal(vm.open, true);
            throw failure;
        },
        reportError(error: unknown, operation: string) {
            errors.push({ error, operation });
        },
    };
    const save = async () => {
        writes++;
        return false;
    };
    const vm = instantiateHost(
        createDialogHost(
            dialogRuntime,
            {
                saveNewNomination: save,
                saveModifiedNomination: save,
                saveNominationCheck: save,
                saveRawNominationSource: save,
            },
            services,
        ),
    );
    const closed = vm.openNew();
    const draft = vm.currentNomination;
    const model = createNominationModel(services);
    assert.equal(model.recipientPlaceholder(draft), "...");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(lookups, 1);
    assert.equal(draft.recipientSuggestionPending, false);
    assert.equal(draft.articleRecipientSuggestionResolved, true);
    assert.equal(draft.awarder, "");
    assert.equal(model.recipientPlaceholder(draft), "Example");
    assert.deepEqual(errors, [
        { error: failure, operation: "suggest-nomination-recipient" },
    ]);
    draft.ruleStatus["1a"].selected = true;
    vm.reviewNominations();
    assert.equal(vm.view, "nomination-summary");
    assert.equal(
        vm.nominationSubmissionTables()[0].nominations[0].awarder,
        "Example",
    );
    assert.equal(writes, 0);
    vm.requestCancel();
    assert.equal(await closed, "cancel");
});
