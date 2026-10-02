/**
 * @file tests/nomination/draft-synchronization.test.ts
 * Purpose: tests / nomination / draft synchronization.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. synchronizedStores
 * 3. harness
 * 4. batchTitles
 * 5. titles
 * 6. validArticle
 * 7. settle
 * 8. Test scenarios
 */

import assert from "node:assert/strict";
import test from "node:test";
import { nextTick, watch } from "vue";

import { createDialogHost } from "../../src/features/nomination/dialog-host.ts";
import { createBrowserNominationDraftStore } from "../../src/platform/browser/nomination-draft-storage.ts";
import type {
    DialogOperations,
    DialogServices,
    NominationDraftStore,
} from "../../src/features/nomination/contracts.ts";
import { dialogRuntime, dialogServices, instantiateHost } from "./fixture.ts";

function synchronizedStores() {
    const values = new Map<string, string>();
    const host = {
        getStorage: () => ({
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
        }),
        getUserName: () => "Example",
    };
    return {
        snapshot: () => createBrowserNominationDraftStore(host).load(),
        create() {
            const browserStore = createBrowserNominationDraftStore(host);
            const listeners = new Set<() => void>();
            const callbacks: Array<() => void> = [];
            const removalSubscriptions: number[] = [];
            let loads = 0;
            const store: NominationDraftStore = {
                load() {
                    loads++;
                    return browserStore.load();
                },
                save: (draft) => browserStore.save(draft),
                remove(ids) {
                    removalSubscriptions.push(listeners.size);
                    browserStore.remove(ids);
                },
                subscribe(listener) {
                    listeners.add(listener);
                    callbacks.push(listener);
                    return () => listeners.delete(listener);
                },
            };
            return {
                store,
                callbacks,
                removalSubscriptions,
                fire: () => [...listeners].forEach((listener) => listener()),
                counts: () => ({ loads, subscriptions: listeners.size }),
            };
        },
    };
}

function harness(
    store: NominationDraftStore,
    services: Partial<DialogServices> = {},
    operationOverrides: Partial<DialogOperations> = {},
) {
    const notices: Array<Parameters<DialogServices["notify"]>> = [];
    const errors: Array<{ error: unknown; operation: string }> = [];
    const submitted: string[][] = [];
    const component = createDialogHost(
        dialogRuntime,
        {
            async saveNewNomination(batch) {
                submitted.push(batchTitles(batch));
                return false;
            },
            async previewNewNomination() {
                return { wikitext: "Preview source", html: "Preview" };
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
            ...operationOverrides,
        },
        {
            ...dialogServices,
            nominationDraftStore: store,
            notify: (message, options) => notices.push([message, options]),
            reportError: (error, operation) =>
                errors.push({ error, operation }),
            ...services,
        },
    );
    const vm = instantiateHost(component);
    // The shared controller fixture omits Vue mounting. Install the two
    // production watchers which release deferred synchronization work.
    const stopped = ["busy", "editingNomination"].flatMap((property) => {
        const definition = (component.watch as any)?.[property];
        const handler =
            typeof definition === "function" ? definition : definition?.handler;
        return typeof handler === "function"
            ? [
                  watch(
                      () => vm[property],
                      (value) => handler.call(vm, value),
                  ),
              ]
            : [];
    });
    return {
        vm,
        notices,
        errors,
        submitted,
        unmount() {
            (component.beforeUnmount as any)?.call(vm);
            stopped.forEach((stop) => stop());
        },
    };
}

function batchTitles(batch: any): string[] {
    return batch.flatMap((table: any) =>
        table.nominations.map((nomination: any) => nomination.pageName),
    );
}

function titles(vm: any): string[] {
    return vm.nominationTables.flatMap((table: any) =>
        table.nominations.map(
            (nomination: any) =>
                nomination.pageName || nomination.originalArticleTitle,
        ),
    );
}

function validArticle(vm: any, title?: string) {
    if (title) vm.activeNomination.pageName = title;
    vm.activeNomination.ruleStatus["1c"].selected = true;
}

async function settle() {
    await nextTick();
    await new Promise<void>((resolve) => setImmediate(resolve));
}

test("a remote save preserves unsaved tab order while importing added nominations exactly once", async () => {
    const shared = synchronizedStores();
    const services = { getPageName: () => "" };
    const seed = harness(shared.create().store, services);
    const seedClosed = seed.vm.openNew();
    validArticle(seed.vm, "Article A");
    seed.vm.addNomination();
    validArticle(seed.vm, "Article B");
    seed.vm.addNomination();
    validArticle(seed.vm, "Article C");
    await seed.vm.saveNominationDraft();
    assert.equal(await seedClosed, "draft");

    const localStore = shared.create();
    const local = harness(localStore.store, services);
    const localClosed = local.vm.openNew();
    const [a, b, c] = local.vm.nominationTables[0].nominations;
    local.vm.nominationTables[0].nominations = [c, a, b];
    local.vm.refreshNominationView(c.id);

    const external = harness(shared.create().store, services);
    const externalClosed = external.vm.openNew();
    external.vm.addNomination();
    validArticle(external.vm, "Article D");
    await external.vm.saveNominationDraft();
    assert.equal(await externalClosed, "draft");

    localStore.fire();
    await settle();
    localStore.fire();
    await settle();
    assert.deepEqual(titles(local.vm), [
        "Article C",
        "Article A",
        "Article B",
        "Article D",
    ]);
    assert.equal(local.vm.activeNomination, c);
    assert.equal(local.vm.nominationTables[0].nominations[1], a);
    assert.equal(local.vm.nominationTables[0].nominations[2], b);
    const ids = local.vm.nominationTables[0].nominations.map(
        (item: any) => item.id,
    );
    assert.equal(new Set(ids).size, 4);
    await local.vm.saveNominationDraft();
    assert.equal(await localClosed, "draft");
    assert.deepEqual(
        shared.snapshot()!.tables[0].nominations.map((item) => item.id),
        ids,
    );
    seed.unmount();
    external.unmount();
    local.unmount();
});

test("saved nominations automatically precede a preopened page's live draft without validation or duplicate imports", async () => {
    for (const typed of [false, true]) {
        const shared = synchronizedStores();
        const aStore = shared.create();
        const bStore = shared.create();
        const pageA = harness(aStore.store, { getPageName: () => "Page A" });
        let resolveRecipient!: (value: string | null) => void;
        const pageB = harness(bStore.store, {
            getPageName: () => "Page B",
            getSuggestedRecipient: () =>
                new Promise((resolve) => {
                    resolveRecipient = resolve;
                }),
        });
        const closedA = pageA.vm.openNew();
        const closedB = pageB.vm.openNew();
        const liveB = pageB.vm.activeNomination;
        if (typed) {
            liveB.awarder = "Typed recipient";
            liveB.pageName = "Typed page B";
            liveB.ruleStatus["1c"].score = Number.NaN;
        }
        let focused = 0;
        pageB.vm.focusFirstError = () => focused++;
        pageB.vm.focusNominationSummary = () => focused++;
        await settle();
        assert.equal(liveB.recipientSuggestionPending, true);
        validArticle(pageA.vm);
        await pageA.vm.saveNominationDraft();
        assert.equal(await closedA, "draft");

        bStore.fire();
        await settle();
        assert.deepEqual(titles(pageB.vm), [
            "Page A",
            typed ? "Typed page B" : "Page B",
        ]);
        assert.equal(pageB.vm.activeNomination, liveB);
        assert.equal(pageB.vm.activeTab, liveB.id);
        assert.equal(pageB.vm.activeNominationPosition, 2);
        assert.equal(liveB.recipientSuggestionPending, true);
        assert.equal(liveB.awarder, typed ? "Typed recipient" : "");
        if (typed) assert.ok(Number.isNaN(liveB.ruleStatus["1c"].score));
        assert.equal(pageB.vm.view, "main");
        assert.equal(pageB.vm.error, "");
        assert.equal(focused, 0);
        assert.equal(pageB.notices.length, 0);
        assert.ok(Object.values(liveB.errors).every((error) => !error));
        const importedA = pageB.vm.nominations[0];
        bStore.fire();
        bStore.fire();
        await settle();
        assert.equal(pageB.vm.nominations.length, 2);
        assert.equal(pageB.vm.nominations[0], importedA);
        assert.equal(pageB.vm.activeNomination, liveB);

        resolveRecipient("Suggested author B");
        await settle();
        assert.equal(liveB.articleRecipientDefault, "Suggested author B");
        pageB.vm.requestCancel();
        assert.equal(await closedB, "cancel");
        assert.equal(bStore.counts().subscriptions, 0);
        pageA.unmount();
        pageB.unmount();
    }
});

test("an automatically updated summary can submit both pages on its first Submit click", async () => {
    const shared = synchronizedStores();
    const aStore = shared.create();
    const bStore = shared.create();
    const pageA = harness(aStore.store, { getPageName: () => "Page A" });
    const pageB = harness(bStore.store, { getPageName: () => "Page B" });
    const closedA = pageA.vm.openNew();
    const closedB = pageB.vm.openNew();
    validArticle(pageB.vm);
    pageB.vm.reviewNominations();
    validArticle(pageA.vm);
    await pageA.vm.saveNominationDraft();
    assert.equal(await closedA, "draft");
    bStore.fire();
    await settle();
    assert.equal(pageB.vm.view, "nomination-summary");
    assert.deepEqual(batchTitles(pageB.vm.nominationSubmissionTables()), [
        "Page A",
        "Page B",
    ]);
    assert.equal(pageB.notices.length, 1);
    assert.deepEqual(pageB.notices[0], [
        dialogServices.msg("nomination_draft_review_updated"),
        { type: "warning" },
    ]);
    bStore.fire();
    await settle();
    assert.equal(pageB.notices.length, 1);
    await pageB.vm.save();
    assert.equal(await closedB, "save");
    assert.deepEqual(pageB.submitted, [["Page A", "Page B"]]);
    assert.equal(shared.snapshot(), null);
    assert.deepEqual(bStore.removalSubscriptions, [0]);
    pageA.unmount();
    pageB.unmount();
});

test("synchronization waits for a summary editor to close and preserves its accepted row", async () => {
    const shared = synchronizedStores();
    const aStore = shared.create();
    const bStore = shared.create();
    const pageA = harness(aStore.store, { getPageName: () => "Page A" });
    const pageB = harness(bStore.store, { getPageName: () => "Page B" });
    const closedA = pageA.vm.openNew();
    const closedB = pageB.vm.openNew();
    validArticle(pageB.vm);
    pageB.vm.reviewNominations();
    pageB.vm.editSummaryNomination(0, 0);
    const editor = pageB.vm.editingNomination;
    editor.pageName = "Revised page B";
    validArticle(pageA.vm);
    await pageA.vm.saveNominationDraft();
    assert.equal(await closedA, "draft");
    const before = bStore.counts().loads;
    bStore.fire();
    await settle();
    assert.equal(bStore.counts().loads, before);
    assert.equal(pageB.vm.nominationDraftSyncPending, true);
    assert.equal(pageB.vm.editingNomination, editor);
    assert.deepEqual(titles(pageB.vm), ["Page B"]);
    pageB.vm.applyNominationEdit();
    await settle();
    assert.equal(pageB.vm.nominationDraftSyncPending, false);
    assert.deepEqual(batchTitles(pageB.vm.nominationSubmissionTables()), [
        "Page A",
        "Revised page B",
    ]);
    pageB.vm.requestCancel();
    assert.equal(await closedB, "cancel");
    pageA.unmount();
    pageB.unmount();
});

test("successful pending submission cleans only its unchanged saved versions before deferred synchronization", async () => {
    const shared = synchronizedStores();
    const seed = harness(shared.create().store, {
        getPageName: () => "Page A",
    });
    const seedClosed = seed.vm.openNew();
    validArticle(seed.vm);
    seed.vm.addNomination();
    validArticle(seed.vm, "Page B");
    seed.vm.reviewNominations();
    await seed.vm.saveNominationDraft();
    assert.equal(await seedClosed, "draft");
    const submittingStore = shared.create();
    let commit!: (keepOpen: boolean) => void;
    const submitted: string[][] = [];
    const submitting = harness(
        submittingStore.store,
        { getPageName: () => "Page A" },
        {
            saveNewNomination(batch) {
                submitted.push(batchTitles(batch));
                return new Promise((resolve) => {
                    commit = resolve;
                });
            },
        },
    );
    const submittedClosed = submitting.vm.openNew();
    const pending = submitting.vm.save();
    assert.equal(submitting.vm.busy, true);
    assert.deepEqual(submitted, [["Page A", "Page B"]]);

    const external = harness(shared.create().store, {
        getPageName: () => "Page C",
    });
    const externalClosed = external.vm.openNew();
    external.vm.nominationTables[0].nominations[0].pageName = "Changed page A";
    validArticle(external.vm);
    await external.vm.saveNominationDraft();
    assert.equal(await externalClosed, "draft");
    const loadsBefore = submittingStore.counts().loads;
    submittingStore.fire();
    await settle();
    assert.equal(submittingStore.counts().loads, loadsBefore);
    assert.equal(submitting.vm.nominationDraftSyncPending, true);
    assert.deepEqual(titles(submitting.vm), ["Page A", "Page B"]);
    commit(false);
    await pending;
    assert.equal(await submittedClosed, "save");
    await settle();
    assert.deepEqual(
        shared
            .snapshot()!
            .tables.flatMap((table) =>
                table.nominations.map(
                    (nomination) =>
                        nomination.pageName || nomination.originalArticleTitle,
                ),
            ),
        ["Changed page A", "Page C"],
    );
    assert.equal(submitting.vm.nominationDraftSyncPending, false);
    assert.deepEqual(submittingStore.removalSubscriptions, [0]);
    seed.unmount();
    external.unmount();
    submitting.unmount();
});

test("a failed submission resumes pending synchronization and its refreshed summary is ready to retry", async () => {
    const shared = synchronizedStores();
    const aStore = shared.create();
    const bStore = shared.create();
    const pageA = harness(aStore.store, { getPageName: () => "Page A" });
    let reject!: (error: unknown) => void;
    let attempts = 0;
    const submitted: string[][] = [];
    const pageB = harness(
        bStore.store,
        { getPageName: () => "Page B" },
        {
            saveNewNomination(batch) {
                submitted.push(batchTitles(batch));
                if (++attempts === 1)
                    return new Promise((_resolve, fail) => {
                        reject = fail;
                    });
                return Promise.resolve(false);
            },
        },
    );
    const closedA = pageA.vm.openNew();
    const closedB = pageB.vm.openNew();
    validArticle(pageB.vm);
    pageB.vm.reviewNominations();
    const pending = pageB.vm.save();
    validArticle(pageA.vm);
    await pageA.vm.saveNominationDraft();
    assert.equal(await closedA, "draft");
    bStore.fire();
    await settle();
    assert.deepEqual(titles(pageB.vm), ["Page B"]);
    assert.equal(pageB.vm.nominationDraftSyncPending, true);
    const failure = new Error("Wiki request failed");
    reject(failure);
    await pending;
    await settle();
    assert.equal(pageB.vm.open, true);
    assert.equal(pageB.vm.busy, false);
    assert.equal(pageB.vm.nominationDraftSyncPending, false);
    assert.deepEqual(batchTitles(pageB.vm.nominationSubmissionTables()), [
        "Page A",
        "Page B",
    ]);
    assert.deepEqual(pageB.errors, [
        { error: failure, operation: "save-nomination" },
    ]);
    assert.equal(
        pageB.vm.error,
        dialogServices.msg(
            "an_error_occurred_while_saving_please_try_again_later",
        ),
    );
    assert.ok(shared.snapshot());
    await pageB.vm.save();
    assert.equal(await closedB, "save");
    assert.deepEqual(submitted, [["Page B"], ["Page A", "Page B"]]);
    assert.equal(shared.snapshot(), null);
    pageA.unmount();
    pageB.unmount();
});

test("a saved batch closes an obsolete preview and ignores its late parsed HTML", async () => {
    const shared = synchronizedStores();
    const aStore = shared.create();
    const bStore = shared.create();
    const pageA = harness(aStore.store, { getPageName: () => "Page A" });
    let resolvePreview!: (result: { wikitext: string; html: string }) => void;
    const parsed: string[][] = [];
    const pageB = harness(
        bStore.store,
        { getPageName: () => "Page B" },
        {
            previewNewNomination(batch) {
                parsed.push(batchTitles(batch));
                if (parsed.length === 1)
                    return new Promise((resolve) => {
                        resolvePreview = resolve;
                    });
                return Promise.resolve({
                    wikitext: "Both pages",
                    html: "Current parsed HTML",
                });
            },
        },
    );
    const closedA = pageA.vm.openNew();
    const closedB = pageB.vm.openNew();
    validArticle(pageB.vm);
    pageB.vm.reviewNominations();
    const pendingPreview = pageB.vm.previewNominations();
    assert.equal(pageB.vm.previewOpen, true);
    assert.equal(pageB.vm.previewLoading, true);
    validArticle(pageA.vm);
    await pageA.vm.saveNominationDraft();
    assert.equal(await closedA, "draft");
    bStore.fire();
    await settle();
    assert.equal(pageB.vm.previewOpen, false);
    assert.equal(pageB.vm.previewLoading, false);
    assert.equal(pageB.vm.view, "nomination-summary");
    assert.deepEqual(batchTitles(pageB.vm.nominationSubmissionTables()), [
        "Page A",
        "Page B",
    ]);
    await pageB.vm.previewNominations();
    assert.equal(pageB.vm.previewHtml, "Current parsed HTML");
    resolvePreview({ wikitext: "Old page B", html: "Obsolete parsed HTML" });
    await pendingPreview;
    assert.equal(pageB.vm.previewHtml, "Current parsed HTML");
    assert.deepEqual(parsed, [["Page B"], ["Page A", "Page B"]]);
    pageB.vm.closeNominationPreview();
    pageB.vm.requestCancel();
    assert.equal(await closedB, "cancel");
    pageA.unmount();
    pageB.unmount();
});

test("callbacks from a closed session cannot mutate reopened, edit, or check dialogs", async () => {
    const shared = synchronizedStores();
    const store = shared.create();
    const fixture = harness(store.store, { getPageName: () => "Page B" });
    const firstClosed = fixture.vm.openNew();
    const previousCallback = store.callbacks.at(-1)!;
    assert.equal(typeof previousCallback, "function");
    fixture.vm.requestCancel();
    assert.equal(await firstClosed, "cancel");
    assert.equal(store.counts().subscriptions, 0);
    const nomination = {
        awarder: "Recipient",
        pageName: "Existing nomination",
        ruleStatus: { "1c": { selected: true, score: 1 } },
    };
    for (const kind of ["new", "edit", "check"] as const) {
        const closed =
            kind === "new"
                ? fixture.vm.openNew()
                : kind === "edit"
                  ? fixture.vm.openEdit(nomination, {
                        type: "acg2",
                        position: 1,
                    })
                  : fixture.vm.openCheck(
                        nomination,
                        { type: "acg2", position: 1 },
                        null,
                    );
        const before = store.counts().loads;
        const live = fixture.vm.currentNomination;
        previousCallback();
        await settle();
        assert.equal(store.counts().loads, before);
        assert.equal(fixture.vm.currentNomination, live);
        assert.equal(fixture.vm.nominationDraftSyncPending, false);
        assert.equal(fixture.vm.kind, kind);
        fixture.vm.requestCancel();
        assert.equal(await closed, "cancel");
        assert.equal(store.counts().subscriptions, 0);
    }
    fixture.unmount();
});

test("unmount releases the active synchronization subscription", async () => {
    const shared = synchronizedStores();
    const store = shared.create();
    const fixture = harness(store.store);
    const closed = fixture.vm.openNew();
    const callback = store.callbacks.at(-1)!;
    assert.equal(store.counts().subscriptions, 1);
    fixture.unmount();
    assert.equal(store.counts().subscriptions, 0);
    const before = store.counts().loads;
    callback();
    await settle();
    assert.equal(store.counts().loads, before);
    fixture.vm.requestCancel();
    assert.equal(await closed, "cancel");
});
