import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentOptions } from "vue";
import { createNominationDialogs } from "../../src/features/nomination/dialog.ts";
import type {
    DialogOperations,
    DialogRuntime,
} from "../../src/features/nomination/contracts.ts";
import { dialogServices, instantiateHost } from "./fixture.ts";

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
