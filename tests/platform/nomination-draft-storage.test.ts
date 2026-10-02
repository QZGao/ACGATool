/**
 * @file tests/platform/nomination-draft-storage.test.ts
 * Purpose: tests / platform / nomination draft storage.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. memoryStorage
 * 3. browserEvents
 * 4. draft
 * 5. Test scenarios
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserNominationDraftStore } from "../../src/platform/browser/nomination-draft-storage.ts";
import { getSelectedScoreTotal } from "../../src/features/nomination/model.ts";
import type { SavedNominationDraft } from "../../src/features/nomination/contracts.ts";

function memoryStorage() {
    const values = new Map<string, string>();
    return {
        values,
        getItem(key: string) {
            return values.get(key) ?? null;
        },
        setItem(key: string, value: string) {
            values.set(key, value);
        },
        removeItem(key: string) {
            values.delete(key);
        },
    };
}

function browserEvents() {
    const document = Object.assign(new EventTarget(), {
        visibilityState: "visible" as DocumentVisibilityState,
    });
    const window = Object.assign(new EventTarget(), { document });
    return {
        document,
        window,
        storage(key: string | null) {
            window.dispatchEvent(Object.assign(new Event("storage"), { key }));
        },
    };
}

function draft(): SavedNominationDraft {
    return {
        version: 1,
        tables: [
            {
                nominations: [
                    {
                        id: "first",
                        awarder: "",
                        pageName: "",
                        originalArticleTitle: "Original article",
                        recipientDefault: "Current user",
                        articleRecipientDefault: "Suggested author",
                        activeRuleCategory: "article",
                        ruleStatus: { "1a": { selected: true, score: NaN } },
                        contentExpansion: {
                            enabled: true,
                            choice: "",
                            score: NaN,
                        },
                    },
                    {
                        id: "second",
                        awarder: "File uploader",
                        pageName: "File:Example.png",
                        activeRuleCategory: "media",
                        frozen: true,
                    },
                ],
                comment: "First table comment",
                activeTab: "second",
            },
            {
                nominations: [
                    {
                        id: "third",
                        awarder: "Reviewer",
                        pageName: "Example review",
                        activeRuleCategory: "review",
                        review: {
                            mode: "general",
                            general: { selected: true, score: 2.5 },
                        },
                    },
                ],
                comment: "Second table comment",
                activeTab: "third",
            },
        ],
        activeTableIndex: 1,
        view: "nomination-summary",
    };
}

test("drafts survive a new store instance with incomplete forms, navigation and frozen rows", () => {
    const storage = memoryStorage();
    const host = { getStorage: () => storage, getUserName: () => "User" };
    const store = createBrowserNominationDraftStore(host);
    assert.equal(store.load(), null);
    const original = draft();
    store.save(original);

    const reopened = createBrowserNominationDraftStore(host).load();
    assert.deepEqual(reopened, original);
    original.tables[0].comment = "Unsaved change";
    assert.equal(reopened?.tables[0].comment, "First table comment");
    assert.equal(reopened?.tables[0].nominations[0].awarder, "");
    assert.equal(reopened?.tables[0].nominations[1].frozen, true);
    assert.equal(
        getSelectedScoreTotal(reopened?.tables[0].nominations[0].ruleStatus),
        null,
    );
});

test("draft notifications follow the current user's key and full storage clears", () => {
    const storage = memoryStorage();
    const events = browserEvents();
    let user = "First user";
    const store = createBrowserNominationDraftStore({
        getStorage: () => storage,
        getUserName: () => user,
        window: events.window,
    });
    store.save(draft());
    const [firstKey] = storage.values.keys();
    user = "Second user";
    store.save(draft());
    const [, secondKey] = storage.values.keys();
    user = "First user";
    let notifications = 0;
    const unsubscribe = store.subscribe!(() => notifications++);

    events.storage("unrelated-storage-key");
    events.storage(secondKey);
    assert.equal(notifications, 0);
    events.storage(firstKey);
    assert.equal(notifications, 1);
    events.storage(null);
    assert.equal(notifications, 2);
    user = "Second user";
    events.storage(firstKey);
    assert.equal(notifications, 2);
    events.storage(secondKey);
    assert.equal(notifications, 3);
    unsubscribe();
});

test("focus, pageshow and returning to a visible document notify until unsubscribe", () => {
    const storage = memoryStorage();
    const events = browserEvents();
    const store = createBrowserNominationDraftStore({
        getStorage: () => storage,
        getUserName: () => "User",
        window: events.window,
    });
    let notifications = 0;
    const unsubscribe = store.subscribe!(() => notifications++);
    assert.equal(notifications, 0);
    events.window.dispatchEvent(new Event("focus"));
    events.window.dispatchEvent(new Event("pageshow"));
    assert.equal(notifications, 2);
    events.document.visibilityState = "hidden";
    events.document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(notifications, 2);
    events.document.visibilityState = "visible";
    events.document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(notifications, 3);

    unsubscribe();
    unsubscribe();
    events.storage(null);
    events.window.dispatchEvent(new Event("focus"));
    events.window.dispatchEvent(new Event("pageshow"));
    events.document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(notifications, 3);
});

test("subscriptions clean up independently when they share the same listener", () => {
    const storage = memoryStorage();
    const events = browserEvents();
    const store = createBrowserNominationDraftStore({
        getStorage: () => storage,
        getUserName: () => "User",
        window: events.window,
    });
    let notifications = 0;
    const listener = () => notifications++;
    const unsubscribeFirst = store.subscribe!(listener);
    const unsubscribeSecond = store.subscribe!(listener);
    events.window.dispatchEvent(new Event("focus"));
    assert.equal(notifications, 2);
    unsubscribeFirst();
    events.window.dispatchEvent(new Event("focus"));
    events.window.dispatchEvent(new Event("pageshow"));
    events.storage(null);
    events.document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(notifications, 6);
    unsubscribeSecond();
    events.window.dispatchEvent(new Event("focus"));
    assert.equal(notifications, 6);
});

test("draft notifications do not read storage or advance pending-submission cleanup snapshots", () => {
    const storage = memoryStorage();
    const events = browserEvents();
    let reads = 0;
    const submitting = createBrowserNominationDraftStore({
        getStorage: () => ({
            ...storage,
            getItem(key) {
                reads++;
                return storage.getItem(key);
            },
        }),
        getUserName: () => "User",
        window: events.window,
    });
    const otherTab = createBrowserNominationDraftStore({
        getStorage: () => storage,
        getUserName: () => "User",
    });
    submitting.save(draft());
    submitting.load();
    const [key] = storage.values.keys();
    const changed = otherTab.load()!;
    changed.tables[0].nominations[0].pageName = "Edited while submitting";
    otherTab.save(changed);
    const source = storage.getItem(key);
    let notifications = 0;
    const unsubscribe = submitting.subscribe!(() => notifications++);
    const readsBeforeEvents = reads;
    events.storage(key);
    events.window.dispatchEvent(new Event("focus"));
    events.window.dispatchEvent(new Event("pageshow"));
    events.document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(notifications, 4);
    assert.equal(reads, readsBeforeEvents);
    assert.equal(storage.getItem(key), source);

    submitting.remove(["first", "third"]);
    assert.deepEqual(
        otherTab.load()!.tables[0].nominations.map((item) => item.id),
        ["first", "second"],
    );
    assert.equal(
        otherTab.load()!.tables[0].nominations[0].pageName,
        "Edited while submitting",
    );
    unsubscribe();
});

test("draft subscriptions tolerate unavailable windows without accessing storage", () => {
    for (const window of [undefined, null]) {
        const store = createBrowserNominationDraftStore({
            getStorage: () => {
                throw new Error("Storage access denied");
            },
            getUserName: () => "User",
            window,
        });
        const unsubscribe = store.subscribe!(() => assert.fail("No window"));
        unsubscribe();
        unsubscribe();
    }
});

test("invalid numeric score values remain invalid after a JSON round trip", () => {
    const storage = memoryStorage();
    const store = createBrowserNominationDraftStore({
        getStorage: () => storage,
        getUserName: () => "User",
    });
    const original = draft();
    original.tables[0].nominations[0].scores = [
        NaN,
        Infinity,
        -Infinity,
        "",
        "bad",
    ];
    store.save(original);
    assert.deepEqual(store.load(), original);
    assert.deepEqual(store.load()?.tables[0].nominations[0].scores, [
        NaN,
        Infinity,
        -Infinity,
        "",
        "bad",
    ]);
});

test("the current user owns their own saved draft and removal leaves other users intact", () => {
    const storage = memoryStorage();
    let user: string | null = "First user";
    const store = createBrowserNominationDraftStore({
        getStorage: () => storage,
        getUserName: () => user,
    });
    store.save(draft());
    user = "Other user";
    assert.equal(store.load(), null);
    const otherDraft = draft();
    otherDraft.tables[0].comment = "Other user's comment";
    store.save(otherDraft);
    store.remove();
    assert.equal(store.load(), null);
    user = "First user";
    assert.deepEqual(store.load(), draft());

    user = null;
    assert.equal(store.load(), null);
    store.save(draft());
    user = "null";
    assert.equal(store.load(), null);
});

test("submission removes its own saved snapshot while preserving another tab's newer draft", () => {
    const storage = memoryStorage();
    const host = { getStorage: () => storage, getUserName: () => "User" };
    const first = createBrowserNominationDraftStore(host);
    const second = createBrowserNominationDraftStore(host);
    first.save(draft());
    assert.deepEqual(first.load(), draft());

    const newer = draft();
    newer.tables[0].comment = "Saved in another tab";
    second.save(newer);
    first.remove();
    assert.deepEqual(second.load(), newer);
    second.remove();
    assert.equal(second.load(), null);

    first.save(draft());
    first.remove();
    assert.equal(first.load(), null);
});

test("submitted items are removed from a newer draft while unrelated and frozen rows remain", () => {
    const storage = memoryStorage();
    const host = { getStorage: () => storage, getUserName: () => "User" };
    const submitting = createBrowserNominationDraftStore(host);
    const otherTab = createBrowserNominationDraftStore(host);
    const saved = draft();
    saved.tables[0].id = "first-table";
    saved.tables[1].id = "second-table";
    submitting.save(saved);
    const newer = otherTab.load()!;
    newer.tables.push({
        id: "later-table",
        nominations: [
            {
                id: "later-item",
                awarder: "Later recipient",
                pageName: "Later article",
                activeRuleCategory: "article",
            },
        ],
        comment: "Saved while submission was pending",
        activeTab: "later-item",
    });
    newer.activeTableIndex = 2;
    otherTab.save(newer);

    submitting.remove(["first", "third"]);
    const remaining = otherTab.load()!;
    assert.deepEqual(
        remaining.tables.map((table) =>
            table.nominations.map((item) => item.id),
        ),
        [["second"], ["later-item"]],
    );
    assert.equal(remaining.tables[0].nominations[0].frozen, true);
    assert.deepEqual(
        remaining.tables.map((table) => table.id),
        ["first-table", "later-table"],
    );
    assert.equal(remaining.tables[0].comment, "First table comment");
    assert.equal(remaining.activeTableIndex, 1);
    assert.equal(remaining.tables[1].activeTab, "later-item");
    assert.equal(remaining.view, "nomination-summary");
});

test("a saved table move during submission survives cleanup while unchanged submitted items are removed", () => {
    for (const moveToNewTable of [false, true]) {
        const storage = memoryStorage();
        const host = { getStorage: () => storage, getUserName: () => "User" };
        const submitting = createBrowserNominationDraftStore(host);
        const otherTab = createBrowserNominationDraftStore(host);
        const saved = draft();
        saved.tables[0].id = "first-table";
        saved.tables[1].id = "second-table";
        submitting.save(saved);
        const newer = otherTab.load()!;
        const moved = newer.tables[0].nominations.shift()!;
        if (moveToNewTable) {
            newer.tables.push({
                id: "new-table",
                nominations: [moved],
                comment: "New table comment",
                activeTab: moved.id,
            });
            newer.activeTableIndex = 2;
        } else {
            newer.tables[1].nominations.push(moved);
            newer.tables[1].activeTab = moved.id;
        }
        newer.tables[0].comment = "Unrelated updated comment";
        otherTab.save(newer);

        submitting.remove(["first", "third"]);
        submitting.remove(["first", "third"]);
        const remaining = otherTab.load()!;
        assert.deepEqual(
            remaining.tables.map((table) =>
                table.nominations.map((item) => item.id),
            ),
            [["second"], ["first"]],
        );
        assert.equal(
            remaining.tables[1].id,
            moveToNewTable ? "new-table" : "second-table",
        );
        assert.equal(remaining.tables[1].activeTab, "first");
        assert.equal(remaining.activeTableIndex, 1);
        assert.equal(remaining.tables[0].comment, "Unrelated updated comment");
    }
});

test("unchanged submitted items are cleared after tab reordering and table comment edits", () => {
    const storage = memoryStorage();
    const host = { getStorage: () => storage, getUserName: () => "User" };
    const submitting = createBrowserNominationDraftStore(host);
    const otherTab = createBrowserNominationDraftStore(host);
    const saved = draft();
    saved.tables[0].id = "first-table";
    saved.tables[1].id = "second-table";
    submitting.save(saved);
    const newer = otherTab.load()!;
    newer.tables[0].nominations.reverse();
    newer.tables[0].comment = "Updated first comment";
    newer.tables[1].comment = "Updated second comment";
    otherTab.save(newer);

    submitting.remove(["first", "third"]);

    const remaining = otherTab.load()!;
    assert.equal(remaining.tables.length, 1);
    assert.equal(remaining.tables[0].id, "first-table");
    assert.equal(remaining.tables[0].comment, "Updated first comment");
    assert.deepEqual(
        remaining.tables[0].nominations.map((item) => item.id),
        ["second"],
    );
});

test("legacy snapshots migrating to stable table IDs retain newer moves and clear unchanged rows", () => {
    const storage = memoryStorage();
    const host = { getStorage: () => storage, getUserName: () => "User" };
    const submitting = createBrowserNominationDraftStore(host);
    const otherTab = createBrowserNominationDraftStore(host);
    submitting.save(draft());
    const newer = otherTab.load()!;
    for (const table of newer.tables) table.id = table.nominations[0].id;
    const moved = newer.tables[0].nominations.shift()!;
    newer.tables[1].nominations.push(moved);
    otherTab.save(newer);

    submitting.remove(["first", "third"]);

    const remaining = otherTab.load()!;
    assert.deepEqual(
        remaining.tables.map((table) =>
            table.nominations.map((item) => item.id),
        ),
        [["second"], ["first"]],
    );
    assert.deepEqual(
        remaining.tables.map((table) => table.id),
        ["first", "third"],
    );
});

test("legacy first-row deletion or reordering does not preserve unchanged submitted rows", () => {
    for (const removeFirst of [false, true]) {
        const storage = memoryStorage();
        const host = { getStorage: () => storage, getUserName: () => "User" };
        const submitting = createBrowserNominationDraftStore(host);
        const otherTab = createBrowserNominationDraftStore(host);
        submitting.save(draft());
        const newer = otherTab.load()!;
        if (removeFirst) newer.tables[0].nominations.shift();
        else newer.tables[0].nominations.reverse();
        otherTab.save(newer);

        submitting.remove(["first", "second", "third"]);

        assert.equal(otherTab.load(), null);
    }
});

test("selective cleanup repairs removed active tabs and tables, then clears storage after the final item", () => {
    const storage = memoryStorage();
    const store = createBrowserNominationDraftStore({
        getStorage: () => storage,
        getUserName: () => "User",
    });
    store.save(draft());
    store.remove(["second", "third"]);
    const remaining = store.load()!;
    assert.equal(remaining.tables.length, 1);
    assert.equal(remaining.activeTableIndex, 0);
    assert.equal(remaining.tables[0].activeTab, "first");
    assert.deepEqual(
        remaining.tables[0].nominations.map((item) => item.id),
        ["first"],
    );
    store.remove(["first"]);
    assert.equal(store.load(), null);
    assert.equal(storage.values.size, 0);
});

test("a later edit to a submitted item survives cleanup, including repeated cleanup attempts", () => {
    const storage = memoryStorage();
    const host = { getStorage: () => storage, getUserName: () => "User" };
    const submitting = createBrowserNominationDraftStore(host);
    const otherTab = createBrowserNominationDraftStore(host);
    submitting.save(draft());
    const newer = otherTab.load()!;
    newer.tables[0].nominations[0].pageName = "Edited while submitting";
    otherTab.save(newer);

    submitting.remove(["first", "third"]);
    submitting.remove(["first", "third"]);
    const remaining = otherTab.load()!;
    assert.equal(remaining.tables.length, 1);
    assert.equal(
        remaining.tables[0].nominations[0].pageName,
        "Edited while submitting",
    );
    assert.deepEqual(
        remaining.tables[0].nominations.map((item) => item.id),
        ["first", "second"],
    );
});

test("selective cleanup does not remove items this store has never read", () => {
    const storage = memoryStorage();
    const host = { getStorage: () => storage, getUserName: () => "User" };
    const saved = createBrowserNominationDraftStore(host);
    const unread = createBrowserNominationDraftStore(host);
    saved.save(draft());
    unread.remove(["first", "second", "third"]);
    assert.deepEqual(saved.load(), draft());
    const initiallyEmpty = createBrowserNominationDraftStore(host);
    saved.remove();
    assert.equal(initiallyEmpty.load(), null);
    saved.save(draft());
    initiallyEmpty.remove(["first", "second", "third"]);
    assert.deepEqual(saved.load(), draft());
});

test("optional stable table ids survive storage while unsafe and duplicate ids are rejected", () => {
    const storage = memoryStorage();
    const store = createBrowserNominationDraftStore({
        getStorage: () => storage,
        getUserName: () => "User",
    });
    const saved = draft();
    saved.tables[0].id = "first-table";
    saved.tables[1].id = "second-table";
    store.save(saved);
    assert.deepEqual(store.load(), saved);
    for (const invalid of [null, "", 'invalid"] selector', "first-table"]) {
        const broken = draft();
        broken.tables[0].id = "first-table";
        Object.assign(broken.tables[1], { id: invalid });
        assert.throws(() => store.save(broken), TypeError);
    }
    assert.deepEqual(store.load(), saved);
});

test("explicit table ids cannot collide with legacy first-item table ids in either order", () => {
    const storage = memoryStorage();
    const store = createBrowserNominationDraftStore({
        getStorage: () => storage,
        getUserName: () => "User",
    });
    store.save(draft());
    const [key] = storage.values.keys();
    const original = storage.getItem(key)!;
    for (const [tableIndex, id] of [
        [0, "third"],
        [1, "first"],
    ] as const) {
        const collision = draft();
        collision.tables[tableIndex].id = id;
        assert.throws(() => store.save(collision), TypeError);
        assert.deepEqual(store.load(), draft());
        storage.setItem(key, JSON.stringify(collision));
        assert.throws(() => store.load(), TypeError);
        storage.setItem(key, original);
    }
});

test("a store that has not read a draft never removes it; an empty initial read cannot remove a later save", () => {
    const storage = memoryStorage();
    const host = { getStorage: () => storage, getUserName: () => "User" };
    const first = createBrowserNominationDraftStore(host);
    const second = createBrowserNominationDraftStore(host);
    first.save(draft());
    second.remove();
    assert.deepEqual(first.load(), draft());
    first.remove();
    assert.equal(second.load(), null);
    first.save(draft());
    second.remove();
    assert.deepEqual(first.load(), draft());
    assert.deepEqual(second.load(), draft());
    second.remove();
    assert.equal(first.load(), null);
});

test("unavailable storage and failed writes propagate without losing an earlier draft", () => {
    const unavailable = new Error("Storage access denied");
    const unavailableStore = createBrowserNominationDraftStore({
        getStorage: () => {
            throw unavailable;
        },
        getUserName: () => "User",
    });
    assert.throws(() => unavailableStore.load(), unavailable);
    assert.throws(() => unavailableStore.save(draft()), unavailable);
    assert.throws(() => unavailableStore.remove(), unavailable);

    const storage = memoryStorage();
    let full = false;
    const quotaFailure = new Error("Storage quota exceeded");
    const store = createBrowserNominationDraftStore({
        getStorage: () => ({
            ...storage,
            setItem(key, value) {
                if (full) throw quotaFailure;
                storage.setItem(key, value);
            },
        }),
        getUserName: () => "User",
    });
    store.save(draft());
    const replacement = draft();
    replacement.tables[0].comment = "Replacement";
    full = true;
    assert.throws(() => store.save(replacement), quotaFailure);
    assert.deepEqual(store.load(), draft());
});

test("invalid persisted JSON and structural state are reported instead of restored", () => {
    const storage = memoryStorage();
    const store = createBrowserNominationDraftStore({
        getStorage: () => storage,
        getUserName: () => "User",
    });
    store.save(draft());
    const [key] = storage.values.keys();
    storage.setItem(key, "broken JSON");
    assert.throws(() => store.load(), SyntaxError);
    const cases = [
        { ...draft(), version: 2 },
        { ...draft(), tables: [] },
        { ...draft(), activeTableIndex: -1 },
        { ...draft(), activeTableIndex: 2 },
        { ...draft(), activeTableIndex: 0.5 },
        { ...draft(), view: "preview" },
    ];
    for (const broken of cases) {
        storage.setItem(key, JSON.stringify(broken));
        assert.throws(() => store.load(), TypeError);
    }
    for (const mutate of [
        (broken: SavedNominationDraft) => {
            broken.tables[0].nominations = [];
        },
        (broken: SavedNominationDraft) => {
            broken.tables[0].activeTab = "missing";
        },
        (broken: SavedNominationDraft) => {
            broken.tables[0].nominations[0].activeRuleCategory = "unknown";
        },
        (broken: SavedNominationDraft) => {
            broken.tables[1].nominations[0].id = "first";
        },
        (broken: SavedNominationDraft) => {
            broken.tables[0].nominations[0].id = 'invalid"] selector';
        },
        (broken: SavedNominationDraft) => {
            Object.assign(broken.tables[0].nominations[0], { awarder: null });
        },
    ]) {
        const broken = draft();
        mutate(broken);
        storage.setItem(key, JSON.stringify(broken));
        assert.throws(() => store.load(), TypeError);
    }
});

test("prototype keys and malformed numeric markers are rejected even in nested draft data", () => {
    const storage = memoryStorage();
    const store = createBrowserNominationDraftStore({
        getStorage: () => storage,
        getUserName: () => "User",
    });
    store.save(draft());
    const [key] = storage.values.keys();
    for (const unsafe of ["__proto__", "constructor", "prototype"]) {
        const hostile = draft();
        hostile.tables[0].nominations[0].ruleStatus = JSON.parse(
            `{"${unsafe}":{"polluted":true}}`,
        );
        storage.setItem(key, JSON.stringify(hostile));
        assert.throws(() => store.load(), TypeError);
        assert.throws(() => store.save(hostile), TypeError);
        assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
    }
    for (const marker of [
        { $acgaNumber: "unknown" },
        { $acgaNumber: "NaN", extra: true },
    ]) {
        const hostile = draft();
        hostile.tables[0].nominations[0].ruleStatus = marker;
        storage.setItem(key, JSON.stringify(hostile));
        assert.throws(() => store.load(), TypeError);
    }
});
