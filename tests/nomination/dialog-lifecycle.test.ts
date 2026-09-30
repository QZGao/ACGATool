import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentOptions } from "vue";
import { createNominationDialogs } from "../../src/features/nomination/dialog.ts";
import { createDialogHost } from "../../src/features/nomination/dialog-host.ts";
import { createNominationModel } from "../../src/features/nomination/model.ts";
import type {
    DialogOperations,
    DialogRuntime,
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
    const pending = dialogs.showCheckBatchDialog!([
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
    assert.equal(await dialogs.showCheckBatchDialog!([]), "cancel");
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
        vm.reviewedNominationTables[0].nominations[0].awarder,
        "Example",
    );
    assert.equal(writes, 0);
    vm.requestCancel();
    assert.equal(await closed, "cancel");
});
