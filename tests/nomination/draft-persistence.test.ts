/**
 * @file tests/nomination/draft-persistence.test.ts
 * Purpose: tests / nomination / draft persistence.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. DraftStore
 * 3. memoryStore
 * 4. browserStores
 * 5. harness
 * 6. validArticle
 * 7. settle
 * 8. submittedTitles
 * 9. Test scenarios
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createDialogHost } from "../../src/features/nomination/dialog-host.ts";
import { createNominationModel } from "../../src/features/nomination/model.ts";
import { createBrowserNominationDraftStore } from "../../src/platform/browser/nomination-draft-storage.ts";
import type {
    DialogOperations,
    DialogServices,
} from "../../src/features/nomination/contracts.ts";
import { dialogRuntime, dialogServices, instantiateHost } from "./fixture.ts";

type DraftStore = NonNullable<DialogServices["nominationDraftStore"]>;

function memoryStore() {
    const shared = browserStores();
    const browserStore = shared.create();
    let writes = 0;
    let removals = 0;
    const store: DraftStore = {
        load: () => browserStore.load(),
        save(draft) {
            browserStore.save(draft);
            writes++;
        },
        remove(ids) {
            browserStore.remove(ids);
            removals++;
        },
    };
    return {
        store,
        snapshot: () => shared.create().load(),
        counts: () => ({ writes, removals }),
    };
}

function browserStores() {
    const values = new Map<string, string>();
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    };
    const host = {
        getStorage: () => storage,
        getUserName: () => "Example",
    };
    return {
        create: () => createBrowserNominationDraftStore(host),
        values,
    };
}

function harness(
    store: DraftStore | null,
    services: Partial<DialogServices> = {},
    operationOverrides: Partial<DialogOperations> = {},
) {
    const notices: Array<Parameters<DialogServices["notify"]>> = [];
    const errors: Array<{ error: unknown; operation: string }> = [];
    let wikiWrites = 0;
    let previews = 0;
    const vm = instantiateHost(
        createDialogHost(
            dialogRuntime,
            {
                async saveNewNomination() {
                    wikiWrites++;
                    return false;
                },
                async previewNewNomination() {
                    previews++;
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
                nominationDraftStore: store ?? undefined,
                notify(message, options) {
                    notices.push([message, options]);
                },
                reportError(error, operation) {
                    errors.push({ error, operation });
                },
                ...services,
            },
        ),
    );
    return { vm, notices, errors, counts: () => ({ wikiWrites, previews }) };
}

function validArticle(nomination: any, title: string) {
    nomination.pageName = title;
    nomination.ruleStatus["1c"].selected = true;
}

async function settle() {
    await new Promise<void>((resolve) => setImmediate(resolve));
}

function submittedTitles(vm: any): string[] {
    return vm
        .nominationSubmissionTables()
        .flatMap((table: any) =>
            table.nominations.map((nomination: any) => nomination.pageName),
        );
}

test("reordered saved tabs retain their order, IDs, and selected draft through saving and reopening", async () => {
    const saved = memoryStore();
    const services = { getPageName: () => "" };
    const seed = harness(saved.store, services);
    const seedClosed = seed.vm.openNew();
    validArticle(seed.vm.activeNomination, "Article A");
    seed.vm.addNomination();
    validArticle(seed.vm.activeNomination, "Article B");
    seed.vm.addNomination();
    validArticle(seed.vm.activeNomination, "Article C");
    await seed.vm.saveNominationDraft();
    assert.equal(await seedClosed, "draft");

    const editing = harness(saved.store, services);
    const editingClosed = editing.vm.openNew();
    const [a, b, c] = editing.vm.nominationTables[0].nominations;
    const tableId = editing.vm.nominationTables[0].id;
    editing.vm.nominationTables[0].nominations = [c, a, b];
    editing.vm.refreshNominationView(c.id);
    editing.vm.synchronizeNominationDraft();
    editing.vm.synchronizeNominationDraft();
    assert.deepEqual(
        editing.vm.nominationTables[0].nominations.map((item: any) => item.id),
        [c.id, a.id, b.id],
    );
    assert.equal(editing.vm.activeNomination, c);
    await editing.vm.saveNominationDraft();
    assert.equal(await editingClosed, "draft");
    assert.deepEqual(
        saved.snapshot()!.tables[0].nominations.map((item) => item.id),
        [c.id, a.id, b.id],
    );

    const reopened = harness(saved.store, services);
    const reopenedClosed = reopened.vm.openNew();
    assert.deepEqual(
        reopened.vm.nominationTables[0].nominations.map((item: any) => item.id),
        [c.id, a.id, b.id],
    );
    assert.equal(reopened.vm.nominationTables[0].id, tableId);
    assert.equal(reopened.vm.activeNomination.id, c.id);
    reopened.vm.reviewNominations();
    assert.deepEqual(submittedTitles(reopened.vm), [
        "Article C",
        "Article A",
        "Article B",
    ]);
    reopened.vm.requestCancel();
    assert.equal(await reopenedClosed, "cancel");
});

test("a saved page A draft opens page B on a second nomination with its own contextual defaults", async () => {
    const shared = browserStores();
    const pageA = harness(shared.create(), {
        getPageName: () => "Page A",
        getUserName: () => "User A",
        getSuggestedRecipient: async () => "Author A",
    });
    const closedA = pageA.vm.openNew();
    pageA.vm.activeNomination.ruleStatus["1c"].selected = true;
    await settle();
    await pageA.vm.saveNominationDraft();
    assert.equal(await closedA, "draft");

    const pageB = harness(shared.create(), {
        getPageName: () => "Page B",
        getUserName: () => "User B",
        getSuggestedRecipient: async () => "Author B",
    });
    const closedB = pageB.vm.openNew();
    await settle();
    assert.equal(pageB.vm.nominationTables.length, 1);
    assert.equal(pageB.vm.nominations.length, 2);
    assert.equal(pageB.vm.activeTab, pageB.vm.nominations[1].id);
    assert.equal(pageB.vm.activeNomination.originalArticleTitle, "Page B");
    assert.equal(pageB.vm.activeNomination.pageName, "");
    assert.equal(pageB.vm.activeNomination.recipientDefault, "User B");
    assert.equal(pageB.vm.activeNomination.articleRecipientDefault, "Author B");
    assert.equal(pageB.vm.nominations[0].originalArticleTitle, "Page A");
    assert.equal(pageB.vm.nominations[0].articleRecipientDefault, "Author A");
    pageB.vm.activeNomination.ruleStatus["1c"].selected = true;
    pageB.vm.reviewNominations();
    assert.equal(pageB.vm.view, "nomination-summary");
    assert.deepEqual(submittedTitles(pageB.vm), ["Page A", "Page B"]);
    assert.deepEqual(
        pageB.vm
            .nominationSubmissionTables()[0]
            .nominations.map((item: any) => item.awarder),
        ["Author A", "Author B"],
    );
    pageB.vm.requestCancel();
    assert.equal(await closedB, "cancel");
});

test("a preopened page B keeps its live pending draft when page A is saved before reviewing and parsing both items", async () => {
    const shared = browserStores();
    const pageA = harness(shared.create(), { getPageName: () => "Page A" });
    let resolveRecipient!: (value: string | null) => void;
    const parsed: string[][] = [];
    const pageB = harness(
        shared.create(),
        {
            getPageName: () => "Page B",
            getSuggestedRecipient: () =>
                new Promise((resolve) => {
                    resolveRecipient = resolve;
                }),
        },
        {
            async previewNewNomination(batch) {
                parsed.push(
                    (batch as any[]).flatMap((table) =>
                        table.nominations.map((item: any) => item.pageName),
                    ),
                );
                return { wikitext: "Both pages", html: "Both pages" };
            },
        },
    );
    const closedA = pageA.vm.openNew();
    const closedB = pageB.vm.openNew();
    const liveB = pageB.vm.activeNomination;
    liveB.ruleStatus["1c"].selected = true;
    liveB.awarder = "Explicit recipient";
    await settle();
    assert.equal(liveB.recipientSuggestionPending, true);
    pageA.vm.activeNomination.ruleStatus["1c"].selected = true;
    await pageA.vm.saveNominationDraft();
    assert.equal(await closedA, "draft");

    pageB.vm.reviewNominations();
    assert.equal(pageB.vm.activeNomination, liveB);
    assert.equal(liveB.recipientSuggestionPending, true);
    assert.equal(
        pageB.vm.nominationTables.flatMap((table: any) => table.nominations)
            .length,
        2,
    );
    assert.deepEqual(submittedTitles(pageB.vm), ["Page A", "Page B"]);
    await pageB.vm.previewNominations();
    assert.deepEqual(parsed, [["Page A", "Page B"]]);
    assert.equal(pageB.vm.activeNomination, liveB);
    resolveRecipient("Late suggested author");
    await settle();
    assert.equal(liveB.articleRecipientDefault, "Example");
    pageB.vm.requestCancel();
    assert.equal(await closedB, "cancel");
});

test("parsed preview refreshes an already reviewed summary when another page saves a nomination", async () => {
    const shared = browserStores();
    const pageA = harness(shared.create(), { getPageName: () => "Page A" });
    const parsed: string[][] = [];
    const pageB = harness(
        shared.create(),
        { getPageName: () => "Page B" },
        {
            async previewNewNomination(batch) {
                parsed.push(
                    (batch as any[]).flatMap((table) =>
                        table.nominations.map((item: any) => item.pageName),
                    ),
                );
                return { wikitext: "Updated source", html: "Updated HTML" };
            },
        },
    );
    const closedA = pageA.vm.openNew();
    const closedB = pageB.vm.openNew();
    pageB.vm.activeNomination.ruleStatus["1c"].selected = true;
    pageB.vm.reviewNominations();
    assert.deepEqual(submittedTitles(pageB.vm), ["Page B"]);
    pageA.vm.activeNomination.ruleStatus["1c"].selected = true;
    await pageA.vm.saveNominationDraft();
    assert.equal(await closedA, "draft");

    await pageB.vm.previewNominations();
    assert.deepEqual(parsed, [["Page A", "Page B"]]);
    assert.deepEqual(submittedTitles(pageB.vm), ["Page A", "Page B"]);
    assert.equal(pageB.vm.previewHtml, "Updated HTML");
    pageB.vm.requestCancel();
    assert.equal(await closedB, "cancel");
});

test("saving merges another page's additions without resurrecting a locally deleted saved nomination", async () => {
    const shared = browserStores();
    const seed = harness(shared.create(), { getPageName: () => "Page A" });
    const seedClosed = seed.vm.openNew();
    validArticle(seed.vm.activeNomination, "Deleted item");
    seed.vm.addNomination();
    validArticle(seed.vm.activeNomination, "Retained item");
    await seed.vm.saveNominationDraft();
    assert.equal(await seedClosed, "draft");

    const local = harness(shared.create(), { getPageName: () => "Page A" });
    const external = harness(shared.create(), { getPageName: () => "Page C" });
    const localClosed = local.vm.openNew();
    const externalClosed = external.vm.openNew();
    local.vm.removeNomination(local.vm.nominations[0].id);
    external.vm.activeNomination.ruleStatus["1c"].selected = true;
    await external.vm.saveNominationDraft();
    assert.equal(await externalClosed, "draft");
    await local.vm.saveNominationDraft();
    assert.equal(await localClosed, "draft");
    const remaining = shared.create().load()!;
    const payloads = remaining.tables.flatMap((table) => table.nominations);
    assert.equal(payloads.length, 2);
    assert.deepEqual(
        payloads.map((item) => item.pageName || item.originalArticleTitle),
        ["Retained item", "Page C"],
    );
});

test("submission refreshes changed reviewed content for inspection before the next submit click", async () => {
    const shared = browserStores();
    const pageA = harness(shared.create(), { getPageName: () => "Page A" });
    const pageB = harness(shared.create(), { getPageName: () => "Page B" });
    const closedA = pageA.vm.openNew();
    const closedB = pageB.vm.openNew();
    pageB.vm.activeNomination.ruleStatus["1c"].selected = true;
    pageB.vm.reviewNominations();
    pageA.vm.activeNomination.ruleStatus["1c"].selected = true;
    await pageA.vm.saveNominationDraft();
    assert.equal(await closedA, "draft");

    await pageB.vm.save();
    assert.equal(pageB.vm.open, true);
    assert.equal(pageB.counts().wikiWrites, 0);
    assert.deepEqual(submittedTitles(pageB.vm), ["Page A", "Page B"]);
    assert.equal(pageB.notices.at(-1)?.[1].type, "warning");
    await pageB.vm.save();
    assert.equal(await closedB, "save");
    assert.equal(pageB.counts().wikiWrites, 1);
    assert.equal(shared.create().load(), null);
});

test("a successful submission removes A and B while retaining page C saved during the wiki request", async () => {
    const shared = browserStores();
    const pageA = harness(shared.create(), { getPageName: () => "Page A" });
    const closedA = pageA.vm.openNew();
    pageA.vm.activeNomination.ruleStatus["1c"].selected = true;
    await pageA.vm.saveNominationDraft();
    assert.equal(await closedA, "draft");

    const pageB = harness(shared.create(), { getPageName: () => "Page B" });
    const closedB = pageB.vm.openNew();
    pageB.vm.activeNomination.ruleStatus["1c"].selected = true;
    pageB.vm.reviewNominations();
    await pageB.vm.saveNominationDraft();
    assert.equal(await closedB, "draft");
    let commit!: (keepOpen: boolean) => void;
    const submitted: string[][] = [];
    const submitting = harness(
        shared.create(),
        { getPageName: () => "Page B" },
        {
            saveNewNomination(batch) {
                submitted.push(
                    (batch as any[]).flatMap((table) =>
                        table.nominations.map((item: any) => item.pageName),
                    ),
                );
                return new Promise((resolve) => {
                    commit = resolve;
                });
            },
        },
    );
    const submittedClosed = submitting.vm.openNew();
    const pendingSubmit = submitting.vm.save();
    assert.deepEqual(submitted, [["Page A", "Page B"]]);
    const pageC = harness(shared.create(), { getPageName: () => "Page C" });
    const closedC = pageC.vm.openNew();
    pageC.vm.activeNomination.ruleStatus["1c"].selected = true;
    await pageC.vm.saveNominationDraft();
    assert.equal(await closedC, "draft");
    commit(false);
    await pendingSubmit;
    assert.equal(await submittedClosed, "save");
    const remaining = shared.create().load()!;
    assert.equal(remaining.tables.length, 1);
    assert.deepEqual(
        remaining.tables[0].nominations.map(
            (item) => item.originalArticleTitle,
        ),
        ["Page C"],
    );
    assert.equal(
        remaining.tables[0].activeTab,
        remaining.tables[0].nominations[0].id,
    );
});

test("successful submission retains saved frozen nominations for a later batch", async () => {
    const saved = memoryStore();
    const first = harness(saved.store);
    const firstClosed = first.vm.openNew();
    validArticle(first.vm.activeNomination, "Submitted article");
    first.vm.addNomination();
    validArticle(first.vm.activeNomination, "Frozen article");
    first.vm.reviewNominations();
    first.vm.toggleNominationFrozen(0, 1);
    await first.vm.saveNominationDraft();
    assert.equal(await firstClosed, "draft");
    const submitting = harness(saved.store);
    const closed = submitting.vm.openNew();
    assert.deepEqual(submittedTitles(submitting.vm), ["Submitted article"]);
    await submitting.vm.save();
    assert.equal(await closed, "save");
    assert.equal(saved.snapshot()!.tables[0].nominations.length, 1);
    assert.equal(
        saved.snapshot()!.tables[0].nominations[0].pageName,
        "Frozen article",
    );
    assert.equal(saved.snapshot()!.tables[0].nominations[0].frozen, true);
});

test("failed draft synchronization keeps the local dialog open and prevents parsing and wiki submission", async () => {
    for (const action of ["review", "preview", "submit", "draft"] as const) {
        let unavailable = false;
        const cause = new Error("Storage became unavailable");
        let storageWrites = 0;
        const store: DraftStore = {
            load() {
                if (unavailable) throw cause;
                return null;
            },
            save() {
                storageWrites++;
            },
            remove() {
                assert.fail("failed synchronization must not remove a draft");
            },
        };
        const fixture = harness(store);
        const closed = fixture.vm.openNew();
        const live = fixture.vm.activeNomination;
        validArticle(live, "Local article");
        if (action === "preview" || action === "submit")
            fixture.vm.reviewNominations();
        unavailable = true;
        if (action === "review") fixture.vm.reviewNominations();
        else if (action === "preview") await fixture.vm.previewNominations();
        else if (action === "submit") await fixture.vm.save();
        else await fixture.vm.saveNominationDraft();
        assert.equal(fixture.vm.open, true);
        assert.equal(fixture.vm.activeNomination, live);
        assert.deepEqual(fixture.counts(), { wikiWrites: 0, previews: 0 });
        assert.equal(storageWrites, 0);
        assert.equal(fixture.notices.at(-1)?.[1].type, "error");
        assert.ok(
            fixture.errors.some(
                ({ error, operation }) =>
                    error === cause &&
                    operation === "synchronize-nomination-draft",
            ),
        );
        fixture.vm.requestCancel();
        assert.equal(await closed, "cancel");
    }
});

test("saving an invalid nomination shows the same errors as Preview and keeps the unsaved form open", async () => {
    const saved = memoryStore();
    const first = harness(saved.store);
    const closed = first.vm.openNew();
    const draft = first.vm.currentNomination;
    draft.ruleStatus["1c"].selected = true;
    draft.ruleStatus["1c"].score = Number.NaN;
    first.vm.reviewNominations();
    assert.ok(draft.errors.pageName);
    assert.ok(draft.errors.rules);
    const originalErrors = { ...draft.errors };
    const previewError = first.vm.error;
    const previewErrorDetails = [...first.vm.errorDetails];
    let focused: any = null;
    first.vm.focusFirstError = (nomination: any) => {
        focused = nomination;
    };

    await first.vm.saveNominationDraft();
    assert.equal(first.vm.open, true);
    assert.equal(first.vm.view, "main");
    assert.equal(first.vm.error, previewError);
    assert.deepEqual(first.vm.errorDetails, previewErrorDetails);
    assert.deepEqual(draft.errors, originalErrors);
    assert.equal(focused, draft);
    assert.deepEqual(first.counts(), { wikiWrites: 0, previews: 0 });
    assert.deepEqual(saved.counts(), { writes: 0, removals: 0 });
    assert.equal(saved.snapshot(), null);
    assert.equal(first.notices.length, 0);
    first.vm.requestCancel();
    assert.equal(await closed, "cancel");
});

test("invalid rows across inactive tables cannot overwrite the prior saved snapshot", async () => {
    const saved = memoryStore();
    const seeded = harness(saved.store);
    const seededClosed = seeded.vm.openNew();
    validArticle(seeded.vm.activeNomination, "First saved article");
    seeded.vm.addNominationTable();
    validArticle(seeded.vm.activeNomination, "Second saved article");
    await seeded.vm.saveNominationDraft();
    assert.equal(await seededClosed, "draft");
    const snapshot = JSON.stringify(saved.snapshot());

    const editing = harness(saved.store);
    const closed = editing.vm.openNew();
    const first = editing.vm.nominationTables[0].nominations[0];
    const second = editing.vm.nominationTables[1].nominations[0];
    first.pageName = "";
    first.ruleStatus["1c"].score = 0;
    second.ruleStatus["1c"].score = Number.NaN;
    editing.vm.reviewNominations();
    const previewError = editing.vm.error;
    const previewErrorDetails = [...editing.vm.errorDetails];
    assert.ok(previewErrorDetails.length > 2);
    editing.vm.switchNominationTable(1);
    let focused: any = null;
    editing.vm.focusFirstError = (nomination: any) => {
        focused = nomination;
    };

    await editing.vm.saveNominationDraft();
    assert.equal(editing.vm.open, true);
    assert.equal(editing.vm.view, "main");
    assert.equal(editing.vm.activeNominationTableIndex, 0);
    assert.equal(editing.vm.activeTab, first.id);
    assert.equal(focused, first);
    assert.equal(editing.vm.error, previewError);
    assert.deepEqual(editing.vm.errorDetails, previewErrorDetails);
    assert.equal(JSON.stringify(saved.snapshot()), snapshot);
    assert.deepEqual(saved.counts(), { writes: 1, removals: 0 });
    assert.deepEqual(editing.counts(), { wikiWrites: 0, previews: 0 });
    editing.vm.requestCancel();
    assert.equal(await closed, "cancel");
});

test("summary and pending preview saves revalidate the latest stored rows before writing", async () => {
    for (const fromPreview of [false, true]) {
        const saved = memoryStore();
        let resolvePreview!: (value: {
            wikitext: string;
            html: string;
        }) => void;
        const first = harness(
            saved.store,
            {},
            {
                previewNewNomination: () =>
                    new Promise((resolve) => {
                        resolvePreview = resolve;
                    }),
            },
        );
        const closed = first.vm.openNew();
        validArticle(first.vm.activeNomination, "Included article");
        first.vm.reviewNominations();
        saved.store.save(first.vm.captureNominationBatch());
        first.vm.synchronizeNominationDraft();
        const preview = fromPreview ? first.vm.previewNominations() : null;
        if (fromPreview) assert.equal(first.vm.previewOpen, true);
        const changed = saved.snapshot()!;
        changed.tables[0].nominations[0].ruleStatus["1c"].score = 0;
        saved.store.save(changed);
        const snapshot = JSON.stringify(saved.snapshot());

        await first.vm.saveNominationDraft();
        assert.equal(first.vm.open, true);
        assert.equal(first.vm.view, "main");
        assert.equal(first.vm.previewOpen, false);
        assert.equal(first.vm.previewLoading, false);
        assert.ok(first.vm.activeNomination.errors.rules);
        assert.equal(
            first.vm.error,
            dialogServices.msg("please_check_invalid_forms_before_preview", {
                forms: dialogServices.msg("invalid_nomination_table_position", {
                    table: 1,
                    number: 1,
                }),
            }),
        );
        assert.equal(JSON.stringify(saved.snapshot()), snapshot);
        assert.deepEqual(saved.counts(), { writes: 2, removals: 0 });
        assert.equal(first.counts().wikiWrites, 0);
        if (preview) {
            resolvePreview({ wikitext: "Late source", html: "Late output" });
            await preview;
            assert.equal(first.vm.previewHtml, null);
        }
        first.vm.requestCancel();
        assert.equal(await closed, "cancel");
    }
});

test("draft saving preserves invalid frozen rows but requires a valid included nomination", async () => {
    const saved = memoryStore();
    const first = harness(saved.store);
    const closed = first.vm.openNew();
    validArticle(first.vm.activeNomination, "Included article");
    first.vm.addNomination();
    const frozen = first.vm.activeNomination;
    frozen.frozen = true;
    frozen.ruleStatus["1c"].selected = true;
    frozen.ruleStatus["1c"].score = Number.NaN;
    await first.vm.saveNominationDraft();
    assert.equal(await closed, "draft");
    assert.equal(saved.snapshot()!.tables[0].nominations[1].frozen, true);
    const snapshot = JSON.stringify(saved.snapshot());

    const reopened = harness(saved.store);
    const reopenedClosed = reopened.vm.openNew();
    reopened.vm.nominationTables[0].nominations[0].frozen = true;
    await reopened.vm.saveNominationDraft();
    assert.equal(reopened.vm.open, true);
    assert.equal(
        reopened.vm.error,
        dialogServices.msg("at_least_one_nomination_is_required"),
    );
    assert.equal(JSON.stringify(saved.snapshot()), snapshot);
    assert.deepEqual(saved.counts(), { writes: 1, removals: 0 });
    assert.deepEqual(reopened.counts(), { wikiWrites: 0, previews: 0 });
    reopened.vm.requestCancel();
    assert.equal(await reopenedClosed, "cancel");
});

test("historical incomplete stored drafts still restore their inputs without stale errors", async () => {
    const saved = memoryStore();
    const first = harness(saved.store);
    const closed = first.vm.openNew();
    const draft = first.vm.currentNomination;
    draft.ruleStatus["1c"].selected = true;
    draft.ruleStatus["1c"].score = Number.NaN;
    first.vm.reviewNominations();
    saved.store.save(first.vm.captureNominationBatch());
    first.vm.requestCancel();
    assert.equal(await closed, "cancel");
    const snapshot = saved.snapshot()!;
    assert.equal(snapshot.version, 1);
    assert.equal(snapshot.view, "main");
    assert.equal(snapshot.tables[0].nominations[0].pageName, "");
    assert.equal(
        Object.values(snapshot.tables[0].nominations[0].errors ?? {}).some(
            Boolean,
        ),
        false,
    );

    const reopened = harness(saved.store);
    const reopenedClosed = reopened.vm.openNew();
    const restored = reopened.vm.currentNomination;
    assert.equal(restored.pageName, "");
    assert.equal(restored.ruleStatus["1c"].selected, true);
    assert.equal(Object.values(restored.errors).some(Boolean), false);
    assert.equal(reopened.vm.error, "");
    assert.deepEqual(reopened.vm.errorDetails, []);
    reopened.vm.reviewNominations();
    assert.equal(reopened.vm.view, "main");
    assert.ok(restored.errors.pageName);
    assert.ok(restored.errors.rules);
    reopened.vm.requestCancel();
    assert.equal(await reopenedClosed, "cancel");
});

test("restoring on the original page retains table navigation, frozen rows, contextual defaults, and inactive form edits", async () => {
    const saved = memoryStore();
    const first = harness(saved.store, {
        getPageName: () => "Original article",
        getUserName: () => "Original user",
    });
    const closed = first.vm.openNew();
    const original = first.vm.currentNomination;
    original.ruleStatus["1c"].selected = true;
    original.articleRecipientDefault = "Suggested author";
    original.articleRecipientSuggestionResolved = true;
    first.vm.addNomination();
    const second = first.vm.activeNomination;
    validArticle(second, "Second article");
    first.vm.addNominationTable();
    validArticle(first.vm.activeNomination, "Third article");
    first.vm.nominationTables[0].comment = " First table comment ";
    first.vm.nominationTables[1].comment = "Second table comment";
    first.vm.switchNominationTable(0);
    first.vm.selectNomination(second.id);
    first.vm.switchNominationTable(1);
    original.frozen = true;
    original.media.pageName = "File:Inactive media.png";
    original.otherPageName = "Inactive other target";
    original.contentExpansion.choice = "Custom inactive expansion";
    original.contentExpansion.score = 3.5;
    original.quality.score = 4.5;
    original.review.general.description = "General review notes";
    original.review.general.score = 2.5;
    original.review.complete.description = "Comprehensive review notes";
    original.review.complete.score = 5.5;
    const aspect = Object.values<any>(original.review.aspects)[0];
    aspect.description = "Specialist review notes";
    aspect.score = 1.5;
    original.activity.rows[0].choice = "First custom activity";
    original.activity.rows[0].score = 1.5;
    original.activity.rows.push({
        ...original.activity.rows[0],
        id: "additional-activity",
        choice: "Second custom activity",
        score: 2.5,
    });
    const inactiveFields = JSON.parse(
        JSON.stringify({
            contentExpansion: original.contentExpansion,
            quality: original.quality,
            activity: original.activity,
            review: original.review,
        }),
    );

    await first.vm.saveNominationDraft();
    assert.equal(await closed, "draft");
    const reopened = harness(saved.store, {
        getPageName: () => "Original article",
        getUserName: () => "Different user",
        getSuggestedRecipient() {
            assert.fail("restored drafts must retain their original context");
        },
    });
    const reopenedClosed = reopened.vm.openNew();
    assert.equal(reopened.vm.nominationTables.length, 2);
    assert.equal(reopened.vm.activeNominationTableIndex, 1);
    assert.equal(reopened.vm.currentNomination.pageName, "Third article");
    assert.deepEqual(
        reopened.vm.nominationTables.map((table: any) => table.comment),
        [" First table comment ", "Second table comment"],
    );
    reopened.vm.switchNominationTable(0);
    assert.equal(reopened.vm.activeNomination.pageName, "Second article");
    const restored = reopened.vm.nominationTables[0].nominations[0];
    assert.equal(restored.frozen, true);
    assert.equal(restored.originalArticleTitle, "Original article");
    assert.equal(restored.pageName, "");
    assert.equal(restored.awarder, "");
    assert.equal(restored.recipientDefault, "Original user");
    assert.equal(restored.articleRecipientDefault, "Suggested author");
    assert.equal(restored.media.pageName, "File:Inactive media.png");
    assert.equal(restored.otherPageName, "Inactive other target");
    assert.deepEqual(
        JSON.parse(
            JSON.stringify({
                contentExpansion: restored.contentExpansion,
                quality: restored.quality,
                activity: restored.activity,
                review: restored.review,
            }),
        ),
        inactiveFields,
    );
    const model = createNominationModel(dialogServices);
    assert.equal(
        model.nominationPayload(restored).pageName,
        "Original article",
    );
    assert.equal(model.nominationPayload(restored).awarder, "Suggested author");
    restored.pageName = "Unsaved replacement";
    assert.equal(saved.snapshot()!.tables[0].nominations[0].pageName, "");
    reopened.vm.requestCancel();
    assert.equal(await reopenedClosed, "cancel");
});

test("saving from summary or parsed preview restores the same reviewed batch and invalidates pending preview output", async () => {
    for (const fromPreview of [false, true]) {
        const saved = memoryStore();
        let resolvePreview!: (value: {
            wikitext: string;
            html: string;
        }) => void;
        const first = harness(
            saved.store,
            {},
            {
                previewNewNomination: () =>
                    new Promise((resolve) => {
                        resolvePreview = resolve;
                    }),
            },
        );
        const closed = first.vm.openNew();
        validArticle(first.vm.currentNomination, "Included article");
        first.vm.addNomination();
        validArticle(first.vm.activeNomination, "Frozen article");
        first.vm.reviewNominations();
        first.vm.toggleNominationFrozen(0, 1);
        first.vm.setNominationTableComment(0, "Reviewed comment");
        const submitted = JSON.parse(
            JSON.stringify(first.vm.nominationSubmissionTables()),
        );
        const preview = fromPreview ? first.vm.previewNominations() : null;
        if (fromPreview) {
            assert.equal(first.vm.previewOpen, true);
            assert.equal(first.vm.previewLoading, true);
        }
        await first.vm.saveNominationDraft();
        assert.equal(await closed, "draft");
        assert.equal(saved.snapshot()!.view, "nomination-summary");
        if (preview) {
            resolvePreview({ wikitext: "Late source", html: "Late output" });
            await preview;
            assert.equal(first.vm.previewOpen, false);
            assert.equal(first.vm.previewHtml, null);
        }

        const reopened = harness(saved.store);
        const reopenedClosed = reopened.vm.openNew();
        assert.equal(reopened.vm.view, "nomination-summary");
        assert.equal(reopened.vm.previewOpen, false);
        assert.equal(reopened.vm.previewHtml, null);
        assert.equal(reopened.vm.nominationSummaryTables[0].rows.length, 2);
        assert.equal(
            reopened.vm.nominationSummaryTables[0].rows[1].frozen,
            true,
        );
        assert.deepEqual(
            JSON.parse(
                JSON.stringify(reopened.vm.nominationSubmissionTables()),
            ),
            submitted,
        );
        reopened.vm.requestCancel();
        assert.equal(await reopenedClosed, "cancel");
    }
});

test("cancel and failed wiki submission retain the saved snapshot; committed submission removes it", async () => {
    const saved = memoryStore();
    const first = harness(saved.store);
    const closed = first.vm.openNew();
    validArticle(first.vm.currentNomination, "Saved article");
    first.vm.reviewNominations();
    await first.vm.saveNominationDraft();
    assert.equal(await closed, "draft");
    const snapshot = JSON.stringify(saved.snapshot());

    const canceled = harness(saved.store);
    const canceledClosed = canceled.vm.openNew();
    canceled.vm.backToNewNominations();
    canceled.vm.currentNomination.pageName = "Unsaved changes";
    canceled.vm.requestCancel();
    assert.equal(await canceledClosed, "cancel");
    assert.equal(JSON.stringify(saved.snapshot()), snapshot);

    for (const failure of ["keep-open", "throw"] as const) {
        const retry = harness(
            saved.store,
            {},
            {
                async saveNewNomination() {
                    if (failure === "throw")
                        throw new Error("Wiki unavailable");
                    return true;
                },
            },
        );
        const retryClosed = retry.vm.openNew();
        await retry.vm.save();
        assert.equal(retry.vm.open, true);
        assert.equal(JSON.stringify(saved.snapshot()), snapshot);
        assert.equal(saved.counts().removals, 0);
        retry.vm.requestCancel();
        assert.equal(await retryClosed, "cancel");
    }

    const successful = harness(saved.store);
    const successfulClosed = successful.vm.openNew();
    await successful.vm.save();
    assert.equal(await successfulClosed, "save");
    assert.equal(saved.snapshot(), null);
    assert.deepEqual(saved.counts(), { writes: 1, removals: 1 });
    assert.deepEqual(successful.counts(), { wikiWrites: 1, previews: 0 });
});

test("unavailable or full browser storage leaves main and preview drafts open and reports an error", async () => {
    for (const fromPreview of [false, true]) {
        for (const unavailable of [false, true]) {
            const saved = memoryStore();
            const cause = new Error("Storage quota exceeded");
            const store = unavailable
                ? null
                : {
                      ...saved.store,
                      save() {
                          throw cause;
                      },
                  };
            const fixture = harness(store);
            const closed = fixture.vm.openNew();
            const draft = fixture.vm.currentNomination;
            validArticle(draft, "Draft article");
            if (fromPreview) {
                validArticle(draft, "Previewed article");
                fixture.vm.reviewNominations();
                await fixture.vm.previewNominations();
                assert.equal(fixture.vm.previewOpen, true);
            }
            await fixture.vm.saveNominationDraft();
            assert.equal(fixture.vm.open, true);
            assert.equal(fixture.vm.currentNomination, draft);
            assert.equal(fixture.vm.previewOpen, fromPreview);
            assert.equal(fixture.notices.at(-1)?.[1].type, "error");
            assert.equal(saved.snapshot(), null);
            assert.equal(saved.counts().writes, 0);
            assert.equal(fixture.counts().wikiWrites, 0);
            fixture.vm.requestCancel();
            assert.equal(await closed, "cancel");
        }
    }
});

test("an old recipient suggestion cannot alter a saved snapshot or its restored contextual recipient", async () => {
    const saved = memoryStore();
    let resolveSuggestion!: (recipient: string | null) => void;
    const first = harness(saved.store, {
        getPageName: () => "Original revision article",
        getRecipientSuggestionScope: () => "revision",
        getSuggestedRecipient: () =>
            new Promise((resolve) => {
                resolveSuggestion = resolve;
            }),
    });
    const closed = first.vm.openNew();
    await settle();
    assert.equal(first.vm.currentNomination.recipientSuggestionPending, true);
    first.vm.currentNomination.ruleStatus["1c"].selected = true;
    first.vm.currentNomination.awarder = "Example";
    await first.vm.saveNominationDraft();
    assert.equal(await closed, "draft");
    assert.equal(
        Boolean(
            saved.snapshot()!.tables[0].nominations[0]
                .recipientSuggestionPending,
        ),
        false,
    );
    const stored = JSON.stringify(saved.snapshot());
    const reopened = harness(saved.store, {
        getPageName: () => "Original revision article",
        getRecipientSuggestionScope: () => "revision",
        getSuggestedRecipient() {
            assert.fail(
                "another displayed revision must not replace saved defaults",
            );
        },
    });
    const reopenedClosed = reopened.vm.openNew();
    await settle();
    const restored = reopened.vm.currentNomination;
    assert.equal(restored.recipientSuggestionPending, false);
    assert.equal(restored.articleRecipientDefault, "Example");
    resolveSuggestion("Old revision author");
    await settle();
    assert.equal(restored.articleRecipientDefault, "Example");
    assert.equal(JSON.stringify(saved.snapshot()), stored);
    reopened.vm.requestCancel();
    assert.equal(await reopenedClosed, "cancel");
});

test("a storage removal failure after a committed wiki write still closes to prevent duplicate submissions", async () => {
    const saved = memoryStore();
    const cause = new Error("Storage disabled after submission");
    const store = {
        ...saved.store,
        remove() {
            throw cause;
        },
    };
    const fixture = harness(store);
    const closed = fixture.vm.openNew();
    validArticle(fixture.vm.currentNomination, "Submitted article");
    fixture.vm.reviewNominations();
    await fixture.vm.save();
    assert.equal(await closed, "save");
    assert.equal(fixture.vm.open, false);
    assert.equal(fixture.counts().wikiWrites, 1);
    assert.ok(
        fixture.notices.some(([, options]) => options.type === "warning"),
    );
    assert.ok(fixture.errors.some(({ error }) => error === cause));
});

test("malformed nested stored fields fall back to a fresh dialog without partially restoring later tables", async () => {
    const saved = memoryStore();
    const original = harness(saved.store, {
        getPageName: () => "Original article",
    });
    const originalClosed = original.vm.openNew();
    validArticle(original.vm.currentNomination, "First saved article");
    original.vm.addNominationTable();
    validArticle(original.vm.currentNomination, "Second saved article");
    await original.vm.saveNominationDraft();
    assert.equal(await originalClosed, "draft");

    const corruptions: Array<(draft: any) => void> = [
        (draft) => {
            draft.media = null;
        },
        (draft) => {
            draft.ruleStatus["1c"] = [];
        },
        (draft) => {
            draft.activity.rows = [null];
        },
        (draft) => {
            draft.review.aspects = "invalid aspects";
        },
        (draft) => {
            draft.review.general.description = { text: "invalid" };
        },
        (draft) => {
            draft.recipientDefault = { user: "invalid" };
        },
        (draft) => {
            draft.review.mode = "invalid-mode";
        },
        (draft) => {
            draft.review.presetTier = "invalid-preset";
        },
        (draft) => {
            draft.review.general.tier = "invalid-tier";
        },
        (draft) => {
            draft.review.complete.tier = "invalid-inactive-tier";
        },
        (draft) => {
            Object.values<any>(draft.review.aspects)[0].tier = "invalid-tier";
        },
        (draft) => {
            draft.contentExpansion.rule = "invalid-rule";
        },
        (draft) => {
            draft.activity.rows[0].rule = "invalid-rule";
        },
        (draft) => {
            draft.recipientSuggestionScope = "invalid-scope";
        },
    ];
    for (const corrupt of corruptions) {
        const broken = JSON.parse(JSON.stringify(saved.snapshot()));
        corrupt(broken.tables[1].nominations[0]);
        const stored = JSON.stringify(broken);
        let removals = 0;
        const reopened = harness(
            {
                load: () => broken,
                save() {
                    assert.fail("restoration must not overwrite saved data");
                },
                remove() {
                    removals++;
                },
            },
            { getPageName: () => "New page context" },
        );
        const reopenedClosed = reopened.vm.openNew();
        assert.equal(reopened.vm.open, true);
        assert.equal(reopened.vm.view, "main");
        assert.equal(reopened.vm.nominationTables.length, 1);
        assert.equal(reopened.vm.activeNominationTableIndex, 0);
        assert.equal(reopened.vm.currentNomination.pageName, "");
        assert.equal(
            reopened.vm.currentNomination.originalArticleTitle,
            "New page context",
        );
        assert.equal(reopened.vm.nominationTables[0].comment, "");
        assert.equal(reopened.notices.at(-1)?.[1].type, "error");
        assert.equal(reopened.errors[0].operation, "restore-nomination-draft");
        assert.equal(JSON.stringify(broken), stored);
        assert.equal(removals, 0);
        reopened.vm.requestCancel();
        assert.equal(await reopenedClosed, "cancel");
    }
});
