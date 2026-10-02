/**
 * @file src/features/nomination/draft-batch.ts
 * Purpose: src / features / nomination / draft batch module.
 *
 * Table of contents:
 * 1. Imports
 * 2. DraftTable
 * 3. IdentifiedTable
 * 4. DraftEntry
 * 5. equal
 * 6. tableId
 * 7. tables
 * 8. entries
 * 9. localOrderChanged
 * 10. mergeNominationDrafts
 */

import type { NominationData, SavedNominationDraft } from "./contracts.ts";

type DraftTable = SavedNominationDraft["tables"][number] & { id?: string };
type IdentifiedTable = DraftTable & { id: string };

interface DraftEntry {
    nomination: NominationData;
    tableId: string;
}

/** Object.is keeps incomplete NaN scores distinct from explicit null inputs. */
function equal(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (
        left === null ||
        right === null ||
        typeof left !== "object" ||
        typeof right !== "object" ||
        Array.isArray(left) !== Array.isArray(right)
    )
        return false;
    const leftFields = Object.entries(left);
    const rightFields = Object.entries(right);
    return (
        leftFields.length === rightFields.length &&
        leftFields.every(
            ([key, value]) =>
                Object.hasOwn(right, key) &&
                equal(value, (right as Record<string, unknown>)[key]),
        )
    );
}

function tableId(table: DraftTable | undefined): string | undefined {
    return table?.id ?? table?.nominations[0]?.id;
}

function tables(draft: SavedNominationDraft | null): IdentifiedTable[] {
    return (draft?.tables ?? []).flatMap((table) => {
        const id = tableId(table);
        return id && table.nominations.length ? [{ ...table, id }] : [];
    });
}

function entries(groups: IdentifiedTable[]): Map<string, DraftEntry> {
    return new Map(
        groups.flatMap((table) =>
            table.nominations.map((nomination) => [
                nomination.id as string,
                { nomination, tableId: table.id },
            ]),
        ),
    );
}

/** Appending new drafts keeps the usual remote-first merge; deliberate moves do not. */
function localOrderChanged(
    current: IdentifiedTable,
    previous: IdentifiedTable | undefined,
    baselineEntries: Map<string, DraftEntry>,
): boolean {
    const currentIds = current.nominations.map((nomination) => nomination.id);
    if (
        currentIds.some((id) => {
            const entry = baselineEntries.get(id as string);
            return entry && entry.tableId !== current.id;
        })
    )
        return true;
    const previousIds = new Set(
        previous?.nominations.map((nomination) => nomination.id),
    );
    const currentIdSet = new Set(currentIds);
    const appendedOrder = [
        ...(previous?.nominations ?? [])
            .map((nomination) => nomination.id)
            .filter((id) => currentIdSet.has(id)),
        ...currentIds.filter((id) => !previousIds.has(id)),
    ];
    return currentIds.some((id, index) => id !== appendedOrder[index]);
}

/**
 * Merge another window's saved batch without overwriting this window's edits.
 * Selected nomination objects retain their identity for the dialog controller.
 */
export function mergeNominationDrafts(
    local: SavedNominationDraft,
    remote: SavedNominationDraft | null,
    baseline: SavedNominationDraft | null,
): SavedNominationDraft {
    const localTables = tables(local);
    const remoteTables = tables(remote);
    const baselineTables = tables(baseline);
    const localEntries = entries(localTables);
    const remoteEntries = entries(remoteTables);
    const baselineEntries = entries(baselineTables);
    const localGroups = new Map(localTables.map((table) => [table.id, table]));
    const remoteGroups = new Map(
        remoteTables.map((table) => [table.id, table]),
    );
    const baselineGroups = new Map(
        baselineTables.map((table) => [table.id, table]),
    );

    // Two independently opened article dialogs start one shared default group.
    // Explicit extra tables and a group's deliberate comment retain their group.
    const initialLocal = localTables[0];
    const activeRemoteId = tableId(remote?.tables[remote.activeTableIndex]);
    const combinedInitialId =
        !baseline &&
        initialLocal?.comment === "" &&
        !remoteGroups.has(initialLocal.id) &&
        activeRemoteId &&
        remoteGroups.has(activeRemoteId)
            ? activeRemoteId
            : null;
    const localGroupId = (id: string) =>
        combinedInitialId && id === initialLocal.id ? combinedInitialId : id;

    const mergedEntries = new Map<string, DraftEntry>();
    const ids = new Set([
        ...remoteEntries.keys(),
        ...localEntries.keys(),
        ...baselineEntries.keys(),
    ]);
    for (const id of ids) {
        const previous = baselineEntries.get(id);
        const current = localEntries.get(id);
        const saved = remoteEntries.get(id);
        let chosen: DraftEntry | undefined;
        if (!previous) chosen = current ?? saved;
        else if (current) {
            chosen =
                current.tableId !== previous.tableId ||
                !equal(current.nomination, previous.nomination)
                    ? current
                    : saved;
        }
        if (
            chosen === saved &&
            current &&
            saved &&
            current.tableId === saved.tableId &&
            equal(current.nomination, saved.nomination)
        )
            chosen = current;
        // A missing local baseline item is a local deletion, even if saved anew.
        if (chosen)
            mergedEntries.set(id, {
                nomination: chosen.nomination,
                tableId:
                    chosen === current
                        ? localGroupId(chosen.tableId)
                        : chosen.tableId,
            });
    }

    const localActiveTable = local.tables[local.activeTableIndex];
    const localActiveId = localActiveTable?.activeTab;
    const order = new Set([
        ...remoteTables.map((table) => table.id),
        ...localTables.map((table) => localGroupId(table.id)),
    ]);
    const mergedTables = [...order].flatMap((id) => {
        const current = localGroups.get(id);
        const localTable =
            current ?? (combinedInitialId === id ? initialLocal : undefined);
        const saved = remoteGroups.get(id);
        const previous = baselineGroups.get(id);
        const localFirst =
            localTable &&
            localOrderChanged(localTable, previous, baselineEntries);
        const sourceTables = localFirst
            ? [localTable, saved]
            : [saved, localTable];
        const included = new Set<string>();
        const nominations = sourceTables.flatMap((table) =>
            (table?.nominations ?? []).flatMap((nomination) => {
                const nominationId = nomination.id as string;
                const merged = mergedEntries.get(nominationId);
                if (
                    !merged ||
                    merged.tableId !== id ||
                    included.has(nominationId)
                )
                    return [];
                included.add(nominationId);
                return [merged.nomination];
            }),
        );
        if (!nominations.length) return [];
        const comment =
            current && (!previous || current.comment !== previous.comment)
                ? current.comment
                : (saved?.comment ?? current?.comment ?? "");
        const activeCandidates = [
            localActiveId,
            current?.activeTab,
            combinedInitialId === id ? initialLocal.activeTab : undefined,
            saved?.activeTab,
        ];
        const activeTab =
            activeCandidates.find((candidate) =>
                nominations.some((nomination) => nomination.id === candidate),
            ) ?? nominations[0].id;
        return [{ id, nominations, comment, activeTab }];
    });
    const activeNominationIndex = mergedTables.findIndex((table) =>
        table.nominations.some((nomination) => nomination.id === localActiveId),
    );
    const preferredTableId = tableId(localActiveTable);
    const activeGroupIndex = mergedTables.findIndex(
        (table) =>
            table.id ===
            (preferredTableId
                ? localGroupId(preferredTableId)
                : activeRemoteId),
    );
    const remoteActiveIndex = mergedTables.findIndex(
        (table) => table.id === activeRemoteId,
    );
    return {
        version: 1,
        tables: mergedTables,
        activeTableIndex:
            activeNominationIndex >= 0
                ? activeNominationIndex
                : activeGroupIndex >= 0
                  ? activeGroupIndex
                  : remoteActiveIndex >= 0
                    ? remoteActiveIndex
                    : 0,
        view: local.view,
    };
}
