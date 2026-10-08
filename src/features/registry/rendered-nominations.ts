/**
 * @file src/features/registry/rendered-nominations.ts
 * Purpose: Resolve template-owned nomination rows, item identities and control anchors.
 *
 * Table of contents:
 * 1. Imports
 * 2. RenderedNomination
 * 3. itemIndex
 * 4. rowState
 * 5. getRenderedNominations
 */

import { getRenderedHeaderState } from "./archive-state.ts";

interface RenderedNomination {
    heading: HTMLTableCellElement | null;
    result: HTMLElement | null;
    cell: HTMLTableCellElement | null;
    itemIndex?: number;
    state: "pending" | "rechecking" | "done" | null;
}

function itemIndex(row: HTMLTableRowElement): number | null {
    const attribute = row.getAttribute("data-acgnom-index");
    const classes = Array.from(row.classList).filter((name) =>
        /^item\d+$/u.test(name),
    );
    const value =
        attribute ?? (classes.length === 1 ? classes[0].slice(4) : "");
    if (!/^(?:[1-9]|1\d|2[0-5])$/u.test(value)) return null;
    return Number(value);
}

function rowState(row: HTMLTableRowElement): RenderedNomination["state"] {
    const attribute = row.getAttribute("data-acgnom-status");
    const states = (["pending", "rechecking", "done"] as const).filter(
        (state) => row.classList.contains(state),
    );
    const value = attribute ?? (states.length === 1 ? states[0] : null);
    return value === "pending" || value === "rechecking" || value === "done"
        ? value
        : null;
}

/** Modern metadata is authoritative; only unmarked tables use the old layout. */
export function getRenderedNominations(
    table: HTMLTableElement,
): RenderedNomination[] {
    const rows = Array.from(table.rows).filter(
        (row) => row.closest("table") === table,
    );
    const modern = rows.some((row) =>
        row.matches(".acgnom-entry, .acgnom-check-row"),
    );
    if (modern) {
        const entries = rows.filter((row) =>
            row.classList.contains("acgnom-entry"),
        );
        const checks = rows.filter((row) =>
            row.classList.contains("acgnom-check-row"),
        );
        return entries.map((row) => {
            const index = itemIndex(row);
            const heading =
                Array.from(row.cells).find((cell) =>
                    cell.matches("th.acgnom-title-cell"),
                ) ?? null;
            const matching = checks.filter(
                (check) => itemIndex(check) === index,
            );
            const unique =
                index !== null &&
                entries.filter((entry) => itemIndex(entry) === index).length ===
                    1 &&
                matching.length === 1;
            const checkRow = unique ? matching[0] : null;
            const cells = checkRow
                ? Array.from(checkRow.cells).filter((cell) =>
                      cell.matches("td.acgnom-check-cell"),
                  )
                : [];
            const cell = cells.length === 1 ? cells[0] : null;
            const results = cell
                ? Array.from(
                      cell.querySelectorAll<HTMLElement>(".acgnom-check"),
                  ).filter((result) => result.closest("table") === table)
                : [];
            const result = results.length === 1 ? results[0] : null;
            const state = rowState(row);
            return {
                heading,
                cell,
                result,
                ...(index !== null ? { itemIndex: index } : {}),
                state:
                    unique && checkRow && rowState(checkRow) === state
                        ? state
                        : null,
            };
        });
    }
    return rows.flatMap((row) => {
        const heading = Array.from(row.cells).find(
            (cell) =>
                cell.tagName === "TH" &&
                (cell.scope === "row" || cell.rowSpan === 2),
        );
        if (!heading) return [];
        const checkRow = row.nextElementSibling;
        const result =
            checkRow?.tagName === "TR" && checkRow.closest("table") === table
                ? (Array.from(
                      checkRow.querySelectorAll<HTMLElement>(".mw-notalk"),
                  ).find((candidate) => candidate.closest("table") === table) ??
                  Array.from((checkRow as HTMLTableRowElement).cells).find(
                      (cell) => cell.tagName === "TD",
                  ) ??
                  null)
                : null;
        return [
            {
                heading,
                result,
                cell: result?.closest("td") ?? null,
                state: getRenderedHeaderState(heading) ?? "done",
            },
        ];
    });
}
