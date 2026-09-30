import type { Translator } from "../../i18n/index.ts";
/** Enhance rendered ACG nomination tables without rewriting their content. */
import type { EntrySelection } from "../../app/nomination-service.ts";
import {
    getNominationCheckRestriction,
    isSameNomination,
    type ExistingNomination,
} from "../../domain/existing-nominations.ts";
import type { Feedback } from "../../shared/ports.ts";
import {
    getArchiveEligibility,
    type ArchiveEntryState,
} from "../../domain/archive-eligibility.ts";
import {
    getRenderedDiscussionTimestamp,
    getRenderedHeaderState,
    getRenderedReviewTimestamp,
} from "./archive-state.ts";
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
    now?(): Date;
}

export function mountRegistry(
    root: HTMLElement,
    actions: RegistryActions,
    options: RegistryOptions,
): () => void {
    const doc = root.ownerDocument;
    const controller = new AbortController();
    const inserted: Element[] = [];
    const editButtons: HTMLButtonElement[] = [];
    const selected = new Set<EntrySelection>();
    const nominationRows: Array<{
        selection: EntrySelection;
        check: HTMLButtonElement;
        controls: HTMLSpanElement;
        batchControl: {
            input: HTMLInputElement;
            label: HTMLLabelElement;
        } | null;
        cell: HTMLTableCellElement;
        checked: boolean;
        restriction: string | null;
        archiveEntry: ArchiveEntryState;
    }> = [];
    const archiveSections: Array<{
        heading: Element;
        nextHeading: Element | null;
        button: HTMLButtonElement;
        entries: ArchiveEntryState[];
    }> = [];
    const msg = options.msg;
    const now = options.now ?? (() => new Date());
    const removeStyles = options.addStyles(styles);
    let busy = false;
    let disposed = false;

    function restrictCheck(
        row: (typeof nominationRows)[number],
        reason: string | null,
    ) {
        row.restriction = reason;
        if (reason) selected.delete(row.selection);
    }

    const status = doc.createElement("span");
    status.setAttribute("role", "status");
    status.className = "acga-registry-status";

    function invoke(callback: () => Promise<unknown>) {
        if (busy || disposed) return;
        busy = true;
        sync();
        void Promise.resolve()
            .then(callback)
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
            await actions.checkBatch([...selected]);
            selected.clear();
        });
    }
    function createBatchControl(selection: EntrySelection) {
        const label = doc.createElement("label");
        label.className = "cdx-checkbox cdx-checkbox--inline";
        const wrapper = doc.createElement("span");
        wrapper.className = "cdx-checkbox__wrapper";
        const input = doc.createElement("input");
        input.type = "checkbox";
        input.className = "cdx-checkbox__input acga-registry-select";
        const icon = doc.createElement("span");
        icon.className = "cdx-checkbox__icon";
        icon.setAttribute("aria-hidden", "true");
        const text = doc.createElement("span");
        text.className = "cdx-checkbox__label";
        text.textContent = msg("add_to_batch");
        wrapper.append(input, icon, text);
        label.append(wrapper);
        input.addEventListener(
            "change",
            () => {
                if (!busy && !disposed && !input.disabled) {
                    if (input.checked) selected.add(selection);
                    else selected.delete(selection);
                }
                sync();
            },
            { signal: controller.signal },
        );
        return { input, label };
    }
    function sync() {
        for (const edit of editButtons) edit.disabled = busy;
        for (const row of nominationRows) {
            row.archiveEntry.checked = row.checked;
            if (row.checked) {
                selected.delete(row.selection);
                row.batchControl?.label.remove();
                row.batchControl = null;
            } else if (!row.batchControl) {
                row.batchControl = createBatchControl(row.selection);
                row.controls.append(row.batchControl.label);
            }
            row.check.textContent = msg(
                row.checked
                    ? "recheck"
                    : selected.size
                      ? "batch_checking"
                      : "check",
            );
            row.check.classList.toggle(
                "cdx-button--action-progressive",
                !row.checked,
            );
            const reason =
                row.restriction ??
                (row.checked && selected.size
                    ? msg("recheck_disabled_during_batch")
                    : null);
            row.check.disabled = busy || Boolean(reason);
            if (row.batchControl)
                row.batchControl.input.disabled = row.check.disabled;
            const elements = row.batchControl
                ? [row.check, row.batchControl.input, row.batchControl.label]
                : [row.check];
            for (const element of elements) {
                if (reason) element.title = reason;
                else element.removeAttribute("title");
            }
            const included = selected.has(row.selection);
            if (row.batchControl) row.batchControl.input.checked = included;
            row.cell.classList.toggle("acga-registry-selected", included);
        }
        const currentTime = now();
        const archiveReasons = {
            unreviewed: "archive_disabled_unreviewed",
            rechecking: "archive_disabled_rechecking",
            recent: "archive_disabled_recent_check",
            unknown: "archive_disabled_unknown_time",
            empty: "archive_disabled_empty",
        } as const;
        for (const chapter of archiveSections) {
            const eligibility = getArchiveEligibility(
                chapter.entries,
                getRenderedDiscussionTimestamp(
                    root,
                    chapter.heading,
                    chapter.nextHeading,
                ),
                currentTime,
            );
            chapter.button.disabled = busy || !eligibility.available;
            chapter.button.classList.toggle(
                "cdx-button--action-progressive",
                eligibility.available && eligibility.emphasized,
            );
            chapter.button.title = msg(
                eligibility.reason
                    ? archiveReasons[eligibility.reason]
                    : eligibility.emphasized
                      ? "archive_ready"
                      : "archive_recent_discussion",
            );
        }
        status.textContent = busy
            ? msg("working")
            : selected.size
              ? msg("count_items_selected", { count: selected.size })
              : "";
    }
    const occurrences = new Map<string, number>();
    let section: {
        date: string;
        occurrence: number;
        index: number;
        archive: (typeof archiveSections)[number];
    } | null = null;
    for (const node of root.querySelectorAll("h2, h3, table.acgnom-table")) {
        // Nested tables/headings in comments or nomination content are never independent nominations.
        if (node.parentElement?.closest("table.acgnom-table")) continue;
        const slot = node.closest(".mw-heading") ?? node;
        if (node.tagName === "H2" || node.tagName === "H3") {
            const previous = archiveSections.at(-1);
            if (previous && !previous.nextHeading) previous.nextHeading = slot;
        }
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
                "cdx-button--weight-primary acga-registry-action",
            );
            const chapter = {
                heading: slot,
                nextHeading: null,
                button: archive,
                entries: [],
            };
            archiveSections.push(chapter);
            section = { date, occurrence, index: 0, archive: chapter };
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
            const archiveEntry: ArchiveEntryState = {
                checked: false,
                rechecking: getRenderedHeaderState(heading) === "rechecking",
                latestCheckTimestamp: null,
            };
            section.archive.entries.push(archiveEntry);
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
                "cdx-button--size-small acga-registry-edit",
            );
            const editControl = doc.createElement("div");
            editControl.className = "acga-registry-edit-control";
            editControl.append(edit);
            heading.append(editControl);
            editButtons.push(edit);
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
            const cell = anchor.closest("td");
            if (!cell) continue;
            const checked = getRenderedHeaderState(heading) !== "pending";
            archiveEntry.checked = checked;
            archiveEntry.latestCheckTimestamp =
                getRenderedReviewTimestamp(anchor);
            const controls = doc.createElement("span");
            controls.className = "acga-registry-controls";
            const check = button(
                msg(checked ? "recheck" : "check"),
                () => checkSelection(selection),
                "cdx-button--size-small",
            );
            controls.append(check);
            anchor.append(controls);
            nominationRows.push({
                selection,
                check,
                controls,
                batchControl: null,
                cell,
                checked,
                restriction: null,
                archiveEntry,
            });
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
        for (const row of nominationRows)
            row.cell.classList.remove("acga-registry-selected");
        for (const element of inserted) element.remove();
        selected.clear();
        removeStyles();
    };
}
