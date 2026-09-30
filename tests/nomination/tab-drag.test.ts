import assert from "node:assert/strict";
import test from "node:test";

import { createDialogHost } from "../../src/features/nomination/dialog-host.ts";
import type {
    NewNominationBatch,
    NominationDraftStore,
    SavedNominationDraft,
} from "../../src/features/nomination/contracts.ts";
import { dialogRuntime, dialogServices, instantiateHost } from "./fixture.ts";

function harness(store?: NominationDraftStore, direction = "ltr") {
    const saves: NewNominationBatch[] = [];
    const vm = instantiateHost(
        createDialogHost(
            dialogRuntime,
            {
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
            {
                ...dialogServices,
                nominationDraftStore: store,
                document: {
                    ...dialogServices.document,
                    defaultView: { getComputedStyle: () => ({ direction }) },
                } as unknown as Document,
                notify() {},
            },
        ),
    );
    const closed = vm.openNew();
    return { vm, saves, closed };
}

function validArticle(nomination: any, title: string) {
    nomination.pageName = title;
    nomination.ruleStatus["1c"].selected = true;
}

function addArticles(vm: any, titles: string[]) {
    const articles = [vm.activeNomination];
    validArticle(articles[0], titles[0]!);
    for (const title of titles.slice(1)) {
        vm.addNomination();
        validArticle(vm.activeNomination, title);
        articles.push(vm.activeNomination);
    }
    return articles;
}

function tableTitles(vm: any): string[][] {
    return vm.nominationTables.map((table: any) =>
        table.nominations.map((nomination: any) => nomination.pageName),
    );
}

function dragEvent(data = new Map<string, string>()) {
    const event = {
        dataTransfer: {
            get types() {
                return [...data.keys()];
            },
            effectAllowed: "uninitialized",
            dropEffect: "none",
            getData: (type: string) => data.get(type) ?? "",
            setData: (type: string, value: string) => data.set(type, value),
        },
        defaultPrevented: false,
        preventDefault() {
            this.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return { event: event as unknown as DragEvent, data };
}

function keyEvent(key: string, shiftKey = false) {
    const event = {
        key,
        shiftKey,
        currentTarget: {},
        defaultPrevented: false,
        preventDefault() {
            this.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return event as unknown as KeyboardEvent;
}

test("tab reordering keeps incomplete and frozen drafts, their identities, and the table comment", () => {
    const { vm } = harness();
    const [first, second, third] = addArticles(vm, [
        "First",
        "Second",
        "Third",
    ]);
    const table = vm.nominationTables[0];
    const id = table.id;
    table.comment = "Group comment";
    first.pageName = "";
    first.ruleStatus["1c"].score = Number.NaN;
    first.errors.pageName = "Existing unfinished input";
    second.frozen = true;

    vm.moveNomination(first.id, id, 3);
    assert.deepEqual(vm.nominations, [second, third, first]);
    assert.equal(vm.activeNomination, first);
    assert.equal(vm.activeTab, first.id);
    assert.equal(table.id, id);
    assert.equal(table.comment, "Group comment");
    assert.equal(first.errors.pageName, "Existing unfinished input");
    assert.ok(Number.isNaN(first.ruleStatus["1c"].score));
    assert.equal(second.frozen, true);

    vm.moveNomination(first.id, id, 0);
    assert.deepEqual(vm.nominations, [first, second, third]);
    vm.moveNomination(first.id, id, 1);
    assert.deepEqual(vm.nominations, [first, second, third]);
    assert.equal(vm.error, "");
});

test("moving between tables repairs each selection and removes an emptied source table", () => {
    const { vm } = harness();
    const [first, second, third] = addArticles(vm, [
        "First",
        "Second",
        "Third",
    ]);
    const source = vm.nominationTables[0];
    source.comment = "Source comment";
    vm.selectNomination(second.id);
    vm.addNominationTable();
    const [fourth, fifth] = addArticles(vm, ["Fourth", "Fifth"]);
    const destination = vm.nominationTables[1];
    destination.comment = "Destination comment";

    vm.moveNomination(second.id, destination.id);
    assert.deepEqual(source.nominations, [first, third]);
    assert.deepEqual(destination.nominations, [fourth, fifth, second]);
    assert.equal(source.activeTab, third.id);
    assert.equal(vm.activeNominationTableIndex, 1);
    assert.equal(vm.activeNomination, second);
    assert.equal(destination.activeTab, second.id);
    vm.switchNominationTable(0);
    assert.equal(vm.activeNomination, third);
    vm.moveNomination(first.id, destination.id, 0);
    assert.deepEqual(destination.nominations, [first, fourth, fifth, second]);
    vm.moveNomination(third.id, destination.id, 2);
    assert.equal(vm.nominationTables.length, 1);
    assert.equal(vm.nominationTables[0], destination);
    assert.deepEqual(destination.nominations, [
        first,
        fourth,
        third,
        fifth,
        second,
    ]);
    assert.equal(destination.comment, "Destination comment");
    assert.equal(vm.activeNomination, third);
    assert.equal(vm.activeNominationTableIndex, 0);
    assert.equal(
        new Set(destination.nominations.map((item: any) => item.id)).size,
        5,
    );
});

test("dropping onto a new table splits out one draft without adding a blank item or losing a sole table comment", () => {
    const { vm } = harness();
    const [first, second] = addArticles(vm, ["First", "Second"]);
    const source = vm.nominationTables[0];
    source.comment = "Keep with the source table";
    second.pageName = "";
    second.frozen = true;

    vm.moveNomination(second.id, null);
    const destination = vm.nominationTables[1];
    assert.equal(vm.nominationTables.length, 2);
    assert.deepEqual(source.nominations, [first]);
    assert.deepEqual(destination.nominations, [second]);
    assert.notEqual(destination.id, source.id);
    assert.equal(source.comment, "Keep with the source table");
    assert.equal(destination.comment, "");
    assert.equal(vm.activeNomination, second);
    assert.equal(second.frozen, true);
    assert.equal(vm.error, "");

    vm.moveNomination(first.id, null);
    assert.equal(vm.nominationTables.length, 2);
    assert.equal(vm.nominationTables[0], source);
    assert.deepEqual(source.nominations, [first]);
    assert.equal(source.comment, "Keep with the source table");
    assert.deepEqual(destination.nominations, [second]);
});

test("moves reject missing destinations and changes outside an editable nomination session", () => {
    const { vm } = harness();
    const [first] = addArticles(vm, ["First", "Second"]);
    const target = vm.nominationTables[0].id;
    vm.moveNomination("missing item", target, 2);
    vm.moveNomination(first.id, "missing table", 2);
    assert.deepEqual(tableTitles(vm), [["First", "Second"]]);

    for (const [field, blocked, restored] of [
        ["busy", true, false],
        ["settling", true, false],
        ["open", false, true],
        ["kind", "edit", "new"],
        ["view", "nomination-summary", "main"],
        ["editingNomination", {}, null],
        ["previewOpen", true, false],
    ] as const) {
        vm[field] = blocked;
        vm.moveNomination(first.id, target, 2);
        const drag = dragEvent();
        vm.startNominationDrag(drag.event, first.id);
        vm.acceptNominationDrop(drag.event, target, 2);
        assert.deepEqual(tableTitles(vm), [["First", "Second"]], field);
        vm[field] = restored;
        vm.endNominationDrag();
    }
});

test("only an active internal drag from the same dialog session may move a nomination", async () => {
    const { vm, closed } = harness();
    const [first, second] = addArticles(vm, ["First", "Second"]);
    const target = vm.nominationTables[0].id;
    const foreign = dragEvent(new Map([["text/plain", first.id]]));
    vm.acceptNominationDrop(foreign.event, target, 2);
    assert.deepEqual(vm.nominations, [first, second]);

    const drag = dragEvent();
    vm.startNominationDrag(drag.event, first.id);
    assert.equal(drag.event.dataTransfer!.effectAllowed, "move");
    assert.ok(drag.data.has("application/x-acga-nomination"));
    const token = drag.data.get("application/x-acga-nomination")!;
    drag.data.set("application/x-acga-nomination", "foreign:" + first.id);
    vm.acceptNominationDrop(drag.event, target, 2);
    assert.deepEqual(vm.nominations, [first, second]);
    drag.data.set("application/x-acga-nomination", token);
    const other = harness().vm;
    const [otherFirst, otherSecond] = addArticles(other, [
        "Other first",
        "Other second",
    ]);
    other.acceptNominationDrop(drag.event, other.nominationTables[0].id, 2);
    assert.deepEqual(other.nominations, [otherFirst, otherSecond]);

    vm.endNominationDrag();
    vm.acceptNominationDrop(drag.event, target, 2);
    assert.deepEqual(vm.nominations, [first, second]);
    vm.startNominationDrag(drag.event, first.id);
    vm.acceptNominationDrop(drag.event, target, 2);
    assert.deepEqual(vm.nominations, [second, first]);
    assert.equal(vm.activeNomination, first);
    vm.acceptNominationDrop(drag.event, target, 0);
    assert.deepEqual(vm.nominations, [second, first]);

    vm.startNominationDrag(drag.event, first.id);
    vm.requestCancel();
    await closed;
    void vm.openNew();
    const reopened = vm.activeNomination;
    vm.acceptNominationDrop(drag.event, null);
    assert.equal(vm.nominationTables.length, 1);
    assert.deepEqual(vm.nominations, [reopened]);
});

test("Escape and drag end discard drag feedback and reject the cancelled transfer", () => {
    const { vm } = harness();
    const [first, second] = addArticles(vm, ["First", "Second"]);
    const drag = dragEvent();
    vm.startNominationDrag(drag.event, first.id);
    vm.allowNominationDrop(drag.event, second.id + ":after");
    assert.equal(vm.nominationDropTarget, second.id + ":after");
    assert.equal(drag.event.dataTransfer!.dropEffect, "move");
    const escape = keyEvent("Escape");
    vm.onNominationTabKeydown(escape, 0);
    assert.equal(escape.defaultPrevented, true);
    assert.equal(vm.open, true);
    assert.equal(vm.draggedNominationId, "");
    assert.equal(vm.nominationDropTarget, "");
    vm.acceptNominationDrop(drag.event, null);
    assert.deepEqual(vm.nominations, [first, second]);
    vm.startNominationDrag(drag.event, first.id);
    vm.allowNominationDrop(drag.event, "new-table");
    vm.endNominationDrag();
    assert.equal(vm.draggedNominationId, "");
    assert.equal(vm.nominationDropTarget, "");
});

test("the pointer half selects before or after according to the tab's text direction", () => {
    for (const direction of ["ltr", "rtl"]) {
        const { vm } = harness(undefined, direction);
        const event = {
            currentTarget: {
                getBoundingClientRect: () => ({ left: 100, width: 80 }),
            },
            clientX: 110,
        } as unknown as DragEvent;
        assert.equal(
            vm.nominationDropIndex(event, 2),
            direction === "rtl" ? 3 : 2,
        );
        Object.assign(event, { clientX: 170 });
        assert.equal(
            vm.nominationDropIndex(event, 2),
            direction === "rtl" ? 2 : 3,
        );
    }
});

test("Shift navigation reorders the focused item while ordinary navigation retains order in both directions", () => {
    for (const direction of ["ltr", "rtl"]) {
        const { vm } = harness(undefined, direction);
        const [first, second, third] = addArticles(vm, [
            "First",
            "Second",
            "Third",
        ]);
        vm.selectNomination(second.id);
        const forwardKey = direction === "rtl" ? "ArrowLeft" : "ArrowRight";
        const backwardKey = direction === "rtl" ? "ArrowRight" : "ArrowLeft";
        const forward = keyEvent(forwardKey, true);
        vm.onNominationTabKeydown(forward, 1);
        assert.equal(forward.defaultPrevented, true);
        assert.deepEqual(vm.nominations, [first, third, second]);
        assert.equal(vm.activeNomination, second);
        vm.onNominationTabKeydown(keyEvent("Home", true), 2);
        assert.deepEqual(vm.nominations, [second, first, third]);
        vm.onNominationTabKeydown(keyEvent(backwardKey, true), 0);
        assert.deepEqual(vm.nominations, [second, first, third]);
        vm.onNominationTabKeydown(keyEvent("End", true), 0);
        assert.deepEqual(vm.nominations, [first, third, second]);
        vm.onNominationTabKeydown(keyEvent("Home"), 2);
        assert.equal(vm.activeNomination, first);
        vm.onNominationTabKeydown(keyEvent(backwardKey), 0);
        assert.equal(vm.activeNomination, second);
        assert.deepEqual(vm.nominations, [first, third, second]);
    }
});

test("reordering a saved draft survives synchronization, summary review, submission, and reopening", async () => {
    let saved: SavedNominationDraft | null = null;
    const store: NominationDraftStore = {
        load: () => (saved == null ? null : structuredClone(saved)),
        save: (draft) => {
            saved = structuredClone(draft);
        },
        remove() {},
    };
    const seed = harness(store).vm;
    addArticles(seed, ["First", "Second", "Third"]);
    seed.nominationTables[0].comment = "Saved source comment";
    await seed.saveNominationDraft();

    const { vm, saves } = harness(store);
    const [first, second, third] = vm.nominations;
    const originalTableId = vm.nominationTables[0].id;
    vm.moveNomination(third.id, originalTableId, 0);
    vm.moveNomination(second.id, null);
    vm.nominationTables[1].comment = "Saved destination comment";
    vm.reviewNominations();
    assert.equal(vm.view, "nomination-summary");
    assert.deepEqual(
        vm.nominationSummaryTables.map((table: any) =>
            table.rows.map((row: any) => row.article),
        ),
        [["Third", "First"], ["Second"]],
    );
    assert.deepEqual(vm.nominationTables[0].nominations, [third, first]);
    assert.deepEqual(vm.nominationTables[1].nominations, [second]);
    await vm.save();
    assert.deepEqual(
        (saves[0] as any[]).map((table) => ({
            titles: table.nominations.map((item: any) => item.pageName),
            comment: table.comment,
        })),
        [
            { titles: ["Third", "First"], comment: "Saved source comment" },
            { titles: ["Second"], comment: "Saved destination comment" },
        ],
    );
    vm.backToNewNominations();
    await vm.saveNominationDraft();
    const restored = harness(store).vm;
    assert.deepEqual(tableTitles(restored), [["Third", "First"], ["Second"]]);
    assert.equal(restored.nominationTables[0].id, originalTableId);
    assert.deepEqual(
        restored.nominationTables.map((table: any) => table.comment),
        ["Saved source comment", "Saved destination comment"],
    );
    assert.equal(restored.activeNomination.id, second.id);
});

test("a storage notification waits for an active drag and then merges remote additions into the dropped order", async () => {
    let saved: SavedNominationDraft | null = null;
    const store: NominationDraftStore = {
        load: () => (saved == null ? null : structuredClone(saved)),
        save(draft) {
            saved = structuredClone(draft);
        },
        remove() {},
    };
    const seed = harness(store).vm;
    addArticles(seed, ["First", "Second", "Third"]);
    await seed.saveNominationDraft();
    const local = harness(store).vm;
    const remote = harness(store).vm;
    const [first, second, third] = local.nominations;
    const tableId = local.nominationTables[0].id;
    const before = local.captureNominationBatch();
    const drag = dragEvent();
    local.startNominationDrag(drag.event, third.id);
    remote.addNomination();
    validArticle(remote.activeNomination, "Fourth");
    await remote.saveNominationDraft();
    local.onNominationDraftChanged();
    assert.equal(local.nominationDraftSyncPending, true);
    assert.equal(local.draggedNominationId, third.id);
    assert.deepEqual(local.captureNominationBatch(), before);

    local.acceptNominationDrop(drag.event, tableId, 0);
    assert.equal(local.nominationDraftSyncPending, false);
    assert.equal(local.draggedNominationId, "");
    assert.deepEqual(tableTitles(local), [
        ["Third", "First", "Second", "Fourth"],
    ]);
    assert.equal(local.nominations[0], third);
    assert.equal(local.nominations[1], first);
    assert.equal(local.nominations[2], second);
    assert.equal(local.activeNomination, third);
});
