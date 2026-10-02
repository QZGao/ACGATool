/**
 * @file tests/nomination/draft-batch.test.ts
 * Purpose: tests / nomination / draft batch.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. DraftTable
 * 3. nomination
 * 4. table
 * 5. batch
 * 6. ids
 * 7. Test scenarios
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
    NominationData,
    SavedNominationDraft,
} from "../../src/features/nomination/contracts.ts";
import { mergeNominationDrafts } from "../../src/features/nomination/draft-batch.ts";

type DraftTable = SavedNominationDraft["tables"][number] & { id?: string };

function nomination(
    id: string,
    fields: Record<string, unknown> = {},
): NominationData {
    return { id, awarder: "Recipient", pageName: id, ...fields };
}

function table(
    id: string | undefined,
    nominations: NominationData[],
    comment = "",
    activeTab = nominations[0]?.id ?? "",
): DraftTable {
    return {
        ...(id ? { id } : {}),
        nominations,
        comment,
        activeTab,
    };
}

function batch(
    tables: DraftTable[],
    activeTableIndex = 0,
    view: SavedNominationDraft["view"] = "main",
): SavedNominationDraft {
    return { version: 1, tables, activeTableIndex, view };
}

function ids(draft: SavedNominationDraft) {
    return draft.tables.map((group) =>
        group.nominations.map((item) => item.id),
    );
}

test("an independently opened article joins the saved active group without losing local navigation", () => {
    const a = nomination("a");
    const b = nomination("b");
    const c = nomination("c");
    const remote = batch([table("saved", [a], "Saved group comment")]);
    const local = batch(
        [table("local", [b, c], "", "c")],
        0,
        "nomination-summary",
    );

    const merged = mergeNominationDrafts(local, remote, null);

    assert.deepEqual(ids(merged), [["a", "b", "c"]]);
    assert.equal(merged.tables[0].id, "saved");
    assert.equal(merged.tables[0].comment, "Saved group comment");
    assert.equal(merged.tables[0].activeTab, "c");
    assert.equal(merged.activeTableIndex, 0);
    assert.equal(merged.view, "nomination-summary");
    assert.equal(merged.tables[0].nominations[0], a);
    assert.equal(merged.tables[0].nominations[1], b);
    assert.equal(merged.tables[0].nominations[2], c);
    assert.deepEqual(ids(local), [["b", "c"]]);
    assert.deepEqual(ids(remote), [["a"]]);
});

test("independent local items append to the remote active group while extra tables remain separate", () => {
    const remote = batch(
        [
            table("remote-first", [nomination("a")], "First comment"),
            table("remote-active", [nomination("b")], "Active comment"),
        ],
        1,
    );
    const local = batch(
        [
            table("initial-local", [nomination("c")]),
            table("extra-local", [nomination("d")], "Extra comment"),
        ],
        1,
    );

    const merged = mergeNominationDrafts(local, remote, null);

    assert.deepEqual(ids(merged), [["a"], ["b", "c"], ["d"]]);
    assert.equal(merged.activeTableIndex, 2);
    assert.deepEqual(
        merged.tables.map((group) => group.comment),
        ["First comment", "Active comment", "Extra comment"],
    );
});

test("a deliberate comment keeps an independently created first table separate", () => {
    const merged = mergeNominationDrafts(
        batch([table("local", [nomination("b")], "Local group comment")]),
        batch([table("remote", [nomination("a")], "Remote group comment")]),
        null,
    );

    assert.deepEqual(ids(merged), [["a"], ["b"]]);
    assert.equal(merged.activeTableIndex, 1);
    assert.equal(merged.tables[1].comment, "Local group comment");
});

test("local edited drafts win conflicts while untouched drafts adopt external edits and new items", () => {
    const baseline = batch([
        table("group", [nomination("a"), nomination("b")], "Old comment"),
    ]);
    const locallyEdited = nomination("a", {
        pageName: "Local target",
        frozen: true,
        rules: { score: NaN, selected: true },
    });
    const externallyEdited = nomination("b", { pageName: "External target" });
    const externalNew = nomination("c");
    const local = batch([
        table("group", [locallyEdited, nomination("b")], "Old comment", "a"),
    ]);
    const remote = batch([
        table(
            "group",
            [
                nomination("a", { pageName: "Conflicting target" }),
                externallyEdited,
                externalNew,
            ],
            "External comment",
            "c",
        ),
    ]);

    const merged = mergeNominationDrafts(local, remote, baseline);

    assert.deepEqual(ids(merged), [["a", "b", "c"]]);
    assert.equal(merged.tables[0].nominations[0], locallyEdited);
    assert.equal(merged.tables[0].nominations[1], externallyEdited);
    assert.equal(merged.tables[0].nominations[2], externalNew);
    assert.equal(merged.tables[0].nominations[0].frozen, true);
    assert.equal(merged.tables[0].activeTab, "a");
    assert.equal(merged.tables[0].comment, "External comment");
});

test("NaN scores compare equal to NaN and remain distinct from null", () => {
    const baseline = batch([
        table("group", [
            nomination("a", { score: NaN }),
            nomination("b", { score: null }),
        ]),
    ]);
    const localA = nomination("a", { score: NaN });
    const localB = nomination("b", { score: NaN });
    const remoteA = nomination("a", { score: 3 });
    const remoteB = nomination("b", { score: 4 });

    const merged = mergeNominationDrafts(
        batch([table("group", [localA, localB])]),
        batch([table("group", [remoteA, remoteB])]),
        baseline,
    );

    assert.equal(merged.tables[0].nominations[0], remoteA);
    assert.equal(merged.tables[0].nominations[1], localB);
    assert.ok(Number.isNaN(merged.tables[0].nominations[1].score));
});

test("unchanged saved items keep the current local objects across repeated refreshes", () => {
    const current = nomination("a", {
        frozen: true,
        rules: [{ selected: true, score: NaN }],
    });
    const baseline = batch([
        table("group", [
            nomination("a", {
                frozen: true,
                rules: [{ selected: true, score: NaN }],
            }),
        ]),
    ]);
    const local = batch([table("group", [current])]);
    const remote = batch([
        table("group", [
            nomination("a", {
                rules: [{ score: NaN, selected: true }],
                frozen: true,
            }),
        ]),
    ]);

    const merged = mergeNominationDrafts(local, remote, baseline);
    const refreshed = mergeNominationDrafts(merged, remote, remote);

    assert.equal(merged.tables[0].nominations[0], current);
    assert.equal(refreshed.tables[0].nominations[0], current);
});

test("local deletion removes baseline items while remote deletion removes only untouched local items", () => {
    const baseline = batch([
        table("group", [nomination("a"), nomination("b"), nomination("c")]),
    ]);
    const locallyEdited = nomination("c", { frozen: true });
    const local = batch([
        table(
            "group",
            [nomination("b"), locallyEdited, nomination("d")],
            "",
            "c",
        ),
    ]);
    const remote = batch([
        table("group", [
            nomination("a", { pageName: "External edit" }),
            nomination("e"),
        ]),
    ]);

    const merged = mergeNominationDrafts(local, remote, baseline);

    assert.deepEqual(ids(merged), [["e", "c", "d"]]);
    assert.equal(merged.tables[0].nominations[1], locallyEdited);
    assert.equal(merged.tables[0].activeTab, "c");
});

test("removing storage clears unchanged baseline rows while retaining unsaved edits and new groups", () => {
    const baseline = batch([
        table("old-first", [nomination("a")]),
        table("old-second", [nomination("b"), nomination("c")], "Old comment"),
    ]);
    const edited = nomination("c", { pageName: "Edited locally" });
    const local = batch(
        [
            table("old-first", [nomination("a")]),
            table(
                "old-second",
                [nomination("b"), edited, nomination("d")],
                "New local comment",
                "c",
            ),
            table("new-group", [nomination("e")], "New group comment"),
        ],
        1,
    );

    const merged = mergeNominationDrafts(local, null, baseline);

    assert.deepEqual(ids(merged), [["c", "d"], ["e"]]);
    assert.equal(merged.activeTableIndex, 0);
    assert.equal(merged.tables[0].activeTab, "c");
    assert.equal(merged.tables[0].comment, "New local comment");
    assert.equal(merged.tables[0].nominations[0], edited);
    assert.deepEqual(
        mergeNominationDrafts(baseline, null, baseline),
        batch([]),
    );
});

test("group comments use local changes and remote changes independently", () => {
    const baseline = batch([
        table("first", [nomination("a")], "Old first"),
        table("second", [nomination("b")], "Old second"),
    ]);
    const local = batch(
        [
            table("first", [nomination("a")], "Local first"),
            table("second", [nomination("b")], "Old second"),
        ],
        1,
    );
    const remote = batch([
        table("first", [nomination("a")], "Conflicting first"),
        table("second", [nomination("b")], "External second"),
        table("third", [nomination("c")], "External third"),
    ]);

    const merged = mergeNominationDrafts(local, remote, baseline);

    assert.deepEqual(ids(merged), [["a"], ["b"], ["c"]]);
    assert.deepEqual(
        merged.tables.map((group) => group.comment),
        ["Local first", "External second", "External third"],
    );
    assert.equal(merged.activeTableIndex, 1);
});

test("stable table identity survives deletion of its original first nomination", () => {
    const baseline = batch([
        table(
            "stable-group",
            [nomination("a"), nomination("b")],
            "Comment",
            "b",
        ),
    ]);
    const local = batch([
        table(
            "stable-group",
            [nomination("b"), nomination("c")],
            "Comment",
            "c",
        ),
    ]);
    const remote = batch([
        table(
            "stable-group",
            [nomination("a"), nomination("b"), nomination("d")],
            "Updated comment",
            "d",
        ),
    ]);

    const merged = mergeNominationDrafts(local, remote, baseline);

    assert.deepEqual(ids(merged), [["b", "d", "c"]]);
    assert.equal(merged.tables[0].id, "stable-group");
    assert.equal(merged.tables[0].comment, "Updated comment");
    assert.equal(merged.tables[0].activeTab, "c");
});

test("legacy tables derive identity from the first nomination and repeated merges do not duplicate ids", () => {
    const original = nomination("a");
    const baseline = batch([table(undefined, [original])]);
    const local = batch([
        table(undefined, [nomination("a"), nomination("b")], "", "b"),
    ]);
    const remote = batch([
        table(undefined, [nomination("a"), nomination("c")]),
    ]);
    const once = mergeNominationDrafts(local, remote, baseline);
    const twice = mergeNominationDrafts(once, remote, remote);

    assert.deepEqual(ids(once), [["a", "c", "b"]]);
    assert.equal(once.tables[0].id, "a");
    assert.deepEqual(ids(twice), ids(once));
    assert.equal(twice.tables[0].activeTab, "b");
});

test("local group moves survive conflicts while untouched active nominations follow remote moves", () => {
    const baseline = batch([
        table("first", [nomination("a"), nomination("b")], "", "b"),
        table("second", [nomination("c")]),
    ]);
    const local = batch([
        table("first", [nomination("b")], "", "b"),
        table("second", [nomination("c"), nomination("a")]),
    ]);
    const remote = batch([
        table("first", [nomination("a")]),
        table("second", [nomination("c"), nomination("b")]),
    ]);

    const merged = mergeNominationDrafts(local, remote, baseline);

    assert.deepEqual(ids(merged), [["c", "a", "b"]]);
    assert.equal(merged.tables[0].id, "second");
    assert.equal(merged.tables[0].activeTab, "b");
    assert.equal(merged.activeTableIndex, 0);
});

test("local tab order survives repeated merges while untouched fields adopt remote edits", () => {
    const baseline = batch([
        table("group", [nomination("a"), nomination("b"), nomination("c")]),
    ]);
    const localA = nomination("a");
    const remoteB = nomination("b", { pageName: "Updated remotely" });
    const local = batch([
        table("group", [nomination("c"), localA, nomination("b")], "", "a"),
    ]);
    const remote = batch([
        table("group", [nomination("a"), remoteB, nomination("c")]),
    ]);

    const merged = mergeNominationDrafts(local, remote, baseline);
    const refreshed = mergeNominationDrafts(merged, remote, remote);

    assert.deepEqual(ids(merged), [["c", "a", "b"]]);
    assert.deepEqual(ids(refreshed), ids(merged));
    assert.equal(merged.tables[0].nominations[1], localA);
    assert.equal(merged.tables[0].nominations[2], remoteB);
    assert.equal(refreshed.tables[0].activeTab, "a");
    assert.equal(refreshed.activeTableIndex, 0);
});

test("remote tab order is adopted when local ordering is untouched", () => {
    const baseline = batch([
        table("group", [nomination("a"), nomination("b"), nomination("c")]),
    ]);
    const editedB = nomination("b", { frozen: true });
    const local = batch([
        table("group", [nomination("a"), editedB, nomination("c")], "", "b"),
    ]);
    const remote = batch([
        table("group", [nomination("c"), nomination("b"), nomination("a")]),
    ]);

    const merged = mergeNominationDrafts(local, remote, baseline);

    assert.deepEqual(ids(merged), [["c", "b", "a"]]);
    assert.equal(merged.tables[0].nominations[1], editedB);
    assert.equal(merged.tables[0].activeTab, "b");
});

test("local ordering wins concurrent reorders and retains remote additions exactly once", () => {
    const baseline = batch([
        table("group", [nomination("a"), nomination("b"), nomination("c")]),
    ]);
    const local = batch([
        table("group", [nomination("b"), nomination("c"), nomination("a")]),
    ]);
    const remote = batch([
        table("group", [
            nomination("c"),
            nomination("d"),
            nomination("b"),
            nomination("a"),
        ]),
    ]);

    const merged = mergeNominationDrafts(local, remote, baseline);
    const refreshed = mergeNominationDrafts(merged, remote, remote);

    assert.deepEqual(ids(merged), [["b", "c", "a", "d"]]);
    assert.deepEqual(ids(refreshed), ids(merged));
});

test("new drafts inserted before saved tabs retain their local position", () => {
    const baseline = batch([
        table("group", [nomination("a"), nomination("b")]),
    ]);
    const local = batch([
        table("group", [nomination("a"), nomination("c"), nomination("b")]),
    ]);
    const remote = batch([
        table("group", [nomination("a"), nomination("b"), nomination("d")]),
    ]);

    const merged = mergeNominationDrafts(local, remote, baseline);

    assert.deepEqual(ids(merged), [["a", "c", "b", "d"]]);
});

test("moving a tab into an existing group preserves its destination index and group comments", () => {
    const baseline = batch([
        table("first", [nomination("a"), nomination("b")], "First comment"),
        table("second", [nomination("c"), nomination("d")], "Second comment"),
    ]);
    const moved = nomination("a");
    const local = batch(
        [
            table("first", [nomination("b")], "First comment"),
            table(
                "second",
                [nomination("c"), moved, nomination("d")],
                "Second comment",
                "a",
            ),
        ],
        1,
    );
    const remote = batch([
        table("first", [nomination("a"), nomination("b")], "First comment"),
        table(
            "second",
            [nomination("c"), nomination("d"), nomination("e")],
            "Second comment",
        ),
    ]);

    const merged = mergeNominationDrafts(local, remote, baseline);

    assert.deepEqual(ids(merged), [["b"], ["c", "a", "d", "e"]]);
    assert.equal(merged.tables[1].nominations[1], moved);
    assert.deepEqual(
        merged.tables.map((group) => group.comment),
        ["First comment", "Second comment"],
    );
    assert.equal(merged.tables[1].activeTab, "a");
    assert.equal(merged.activeTableIndex, 1);
});

test("moving tabs into a new group removes an emptied source and retains their chosen order", () => {
    const baseline = batch([
        table("first", [nomination("a"), nomination("b")], "First comment"),
        table("second", [nomination("c")], "Second comment"),
    ]);
    const local = batch(
        [
            table("second", [nomination("c")], "Second comment"),
            table(
                "new-group",
                [nomination("b"), nomination("a")],
                "New comment",
                "a",
            ),
        ],
        1,
    );

    const merged = mergeNominationDrafts(local, baseline, baseline);
    const refreshed = mergeNominationDrafts(merged, baseline, baseline);

    assert.deepEqual(ids(merged), [["c"], ["b", "a"]]);
    assert.deepEqual(ids(refreshed), ids(merged));
    assert.deepEqual(
        merged.tables.map((group) => group.id),
        ["second", "new-group"],
    );
    assert.equal(merged.tables[1].comment, "New comment");
    assert.equal(merged.tables[1].activeTab, "a");
    assert.equal(merged.activeTableIndex, 1);
});

test("a remote move appends to locally reordered destination tabs using its remote position", () => {
    const baseline = batch([
        table("first", [nomination("a")]),
        table("second", [nomination("b"), nomination("c")]),
    ]);
    const local = batch([
        table("first", [nomination("a")]),
        table("second", [nomination("c"), nomination("b")]),
    ]);
    const remote = batch([
        table("second", [nomination("b"), nomination("c"), nomination("a")]),
    ]);

    const merged = mergeNominationDrafts(local, remote, baseline);

    assert.deepEqual(ids(merged), [["c", "b", "a"]]);
    assert.equal(merged.tables[0].id, "second");
});
