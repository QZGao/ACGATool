import type { Translator } from "../../i18n/index.ts";
/** Enhance rendered ACG nomination tables without rewriting their content. */
import type { EntrySelection } from "../../app/nomination-service.ts";
import {
    getNominationCheckRestriction,
    isSameNomination,
    type ExistingNomination,
} from "../../domain/existing-nominations.ts";
import type { Feedback } from "../../shared/ports.ts";
import { findPrecedingDiscussionCommentId } from "./identity.ts";
import styles from "./registry.css";

export interface RegistryActions {
    getExistingNominations?(
        pageName?: string,
        expectedRevisionId?: string | number | null,
    ): Promise<ExistingNomination[]>;
    editNomination(selection: EntrySelection): Promise<unknown>;
    checkNomination(selection: EntrySelection): Promise<unknown>;
    checkBatch(selections: EntrySelection[]): Promise<unknown>;
    archiveChapter(
        date: string,
        occurrence: number,
        revision?: string | number | null,
    ): Promise<unknown>;
}
export interface RegistryOptions extends Feedback {
    msg: Translator;
    revisionId: string | number | null;
    addStyles(css: string): () => void;
    getUserName?(): string | null;
}

export function mountRegistry(
    root: HTMLElement,
    actions: RegistryActions,
    options: RegistryOptions,
): () => void {
    const doc = root.ownerDocument;
    const controller = new AbortController();
    const inserted: Element[] = [];
    const selected = new Map<HTMLButtonElement, EntrySelection>();
    const nominationRows: Array<{
        selection: EntrySelection;
        check: HTMLButtonElement;
        select: HTMLButtonElement;
        checked: boolean;
    }> = [];
    const restrictions = new Map<Element, string>();
    const msg = options.msg;
    const removeStyles = options.addStyles(styles);
    let busy = false;
    let disposed = false;

    function restrictCheck(
        row: (typeof nominationRows)[number],
        reason: string | null,
    ) {
        for (const element of [row.check, row.select]) {
            if (reason) {
                restrictions.set(element, reason);
                element.title = reason;
            } else {
                restrictions.delete(element);
                element.removeAttribute("title");
            }
        }
        if (reason) {
            selected.delete(row.select);
        }
    }

    const status = doc.createElement("span");
    status.setAttribute("role", "status");
    status.className = "acga-registry-status";

    function invoke(callback: () => Promise<unknown>) {
        if (busy || disposed) return;
        busy = true;
        sync();
        void callback()
            .catch((cause) => {
                options.reportError(cause, "Registry action");
                options.notify(
                    msg("the_operation_failed_please_try_again_later"),
                    { type: "error" },
                );
            })
            .finally(() => {
                busy = false;
                if (!disposed) sync();
            });
    }
    function button(
        label: string,
        action: () => Promise<unknown> | void,
        classes = "",
    ) {
        const element = doc.createElement("button");
        element.type = "button";
        element.className = classes ? `cdx-button ${classes}` : "cdx-button";
        element.textContent = label;
        element.addEventListener(
            "click",
            () => {
                if (!busy && !element.disabled) void action();
            },
            { signal: controller.signal },
        );
        return element;
    }
    function checkSelection(selection: EntrySelection) {
        invoke(async () => {
            if (!selected.size) {
                await actions.checkNomination(selection);
                return;
            }
            await actions.checkBatch([...selected.values()]);
            selected.clear();
        });
    }
    function sync() {
        for (const element of inserted.flatMap((item) => [
            item,
            ...item.querySelectorAll("button"),
        ])) {
            if (element instanceof doc.defaultView!.HTMLButtonElement)
                element.disabled = busy || restrictions.has(element);
        }
        for (const row of nominationRows) {
            row.check.textContent = msg(
                selected.size
                    ? "batch_checking"
                    : row.checked
                      ? "recheck"
                      : "check",
            );
            const pressed = selected.has(row.select);
            row.select.setAttribute("aria-pressed", String(pressed));
            row.select.classList.toggle(
                "cdx-toggle-button--toggled-on",
                pressed,
            );
            row.select.classList.toggle(
                "cdx-toggle-button--toggled-off",
                !pressed,
            );
        }
        status.textContent = busy
            ? msg("working")
            : selected.size
              ? msg("count_items_selected", { count: selected.size })
              : "";
    }
    const occurrences = new Map<string, number>();
    let section: { date: string; occurrence: number; index: number } | null =
        null;
    for (const node of root.querySelectorAll("h2, h3, table.acgnom-table")) {
        // Nested tables/headings in comments or nomination content are never independent nominations.
        if (node.parentElement?.closest("table.acgnom-table")) continue;
        if (node.tagName === "H2") {
            section = null;
            continue;
        }
        if (node.tagName === "H3") {
            const date = (
                node.querySelector(".mw-headline")?.textContent ??
                node.textContent ??
                ""
            ).trim();
            if (!/^\d{1,2}月\d{1,2}日$/u.test(date)) {
                section = null;
                continue;
            }
            const occurrence = occurrences.get(date) ?? 0;
            occurrences.set(date, occurrence + 1);
            section = { date, occurrence, index: 0 };
            const archive = button(
                msg("archive"),
                () =>
                    invoke(() =>
                        actions.archiveChapter(
                            date,
                            occurrence,
                            options.revisionId,
                        ),
                    ),
                "cdx-button--weight-quiet acga-registry-action",
            );
            const slot = node.closest(".mw-heading") ?? node;
            slot.append(archive);
            inserted.push(archive);
            continue;
        }
        if (!section) continue;
        const table = node as HTMLTableElement;
        const commentId = findPrecedingDiscussionCommentId(table);
        for (const row of Array.from(table.rows)) {
            if (row.closest("table") !== table) continue;
            const heading = Array.from(row.cells).find(
                (cell) =>
                    cell.tagName === "TH" &&
                    (cell.scope === "row" || cell.rowSpan === 2),
            );
            if (!heading) continue;
            section.index++;
            const selection: EntrySelection = {
                date: section.date,
                index: section.index,
                sectionOccurrence: section.occurrence,
                expectedRevisionId: options.revisionId,
                commentId,
            };
            const edit = button(
                msg("edit_nomination"),
                () => invoke(() => actions.editNomination(selection)),
                "acga-registry-edit",
            );
            const editControl = doc.createElement("div");
            editControl.className = "acga-registry-edit-control";
            editControl.append(edit);
            heading.append(editControl);
            inserted.push(editControl);
            const checkRow = row.nextElementSibling;
            if (
                !(checkRow instanceof doc.defaultView!.HTMLTableRowElement) ||
                checkRow.closest("table") !== table
            )
                continue;
            const anchor =
                Array.from(
                    checkRow.querySelectorAll<HTMLElement>(".mw-notalk"),
                ).find((candidate) => candidate.closest("table") === table) ??
                Array.from(checkRow.cells).find(
                    (cell) => cell.tagName === "TD",
                );
            if (!anchor || anchor.closest("table") !== table) continue;
            const controls = doc.createElement("span");
            controls.className = "acga-registry-controls";
            const check = button(
                msg("check"),
                () => checkSelection(selection),
                "cdx-button--action-progressive",
            );
            const select = button(msg("add_to_batch"), () => {
                if (selected.has(select)) selected.delete(select);
                else selected.set(select, selection);
                sync();
            });
            select.className =
                "cdx-toggle-button cdx-toggle-button--framed cdx-toggle-button--size-medium acga-registry-select";
            controls.append(check, select);
            anchor.append(controls);
            nominationRows.push({ selection, check, select, checked: false });
            inserted.push(controls);
        }
    }
    nominationRows[0]?.check.parentElement?.append(status);
    const currentUser = options.getUserName?.() ?? null;
    const readNominations = actions.getExistingNominations;
    if (readNominations && nominationRows.length) {
        for (const row of nominationRows) restrictCheck(row, msg("working"));
        void (async () => {
            const nominations = await readNominations(
                undefined,
                options.revisionId,
            );
            if (disposed) return;
            for (const row of nominationRows) {
                const nomination = nominations.find((item) =>
                    isSameNomination(item, row.selection),
                );
                row.checked = Boolean(nomination?.checked);
                const restriction = nomination
                    ? getNominationCheckRestriction(nomination, currentUser)
                    : "this_nomination_or_the_registry_has_changed_refresh_the_page";
                restrictCheck(row, restriction ? msg(restriction) : null);
            }
            sync();
        })().catch((cause) => {
            if (disposed) return;
            options.reportError(cause, "Checking registry eligibility");
            for (const row of nominationRows)
                restrictCheck(row, msg("existing_nomination_lookup_failed"));
            sync();
        });
    }
    sync();
    return () => {
        if (disposed) return;
        disposed = true;
        controller.abort();
        for (const element of inserted) element.remove();
        selected.clear();
        removeStyles();
    };
}
