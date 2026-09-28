import type { Translator } from "../../i18n/index.ts";
/** Enhance rendered ACG nomination tables without rewriting their content. */
import type { EntrySelection } from "../../app/nomination-service.ts";
import type { Feedback } from "../../shared/ports.ts";
import { findPrecedingDiscussionCommentId } from "./identity.ts";
import styles from "./registry.css";

export interface RegistryActions {
    newNomination(): Promise<unknown>;
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
}

export function mountRegistry(
    root: HTMLElement,
    actions: RegistryActions,
    options: RegistryOptions,
): () => void {
    const doc = root.ownerDocument;
    const controller = new AbortController();
    const inserted: Element[] = [];
    const selected = new Map<HTMLInputElement, EntrySelection>();
    const checkboxes: HTMLLabelElement[] = [];
    const msg = options.msg;
    const removeStyles = options.addStyles(styles);
    let choosing = false;
    let busy = false;
    let disposed = false;

    const toolbar = doc.createElement("div");
    toolbar.className = "acga-registry-toolbar";
    toolbar.setAttribute("role", "group");
    toolbar.setAttribute("aria-label", msg("acg_award_tool"));
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
        quiet = false,
    ) {
        const element = doc.createElement("button");
        element.type = "button";
        element.className = quiet
            ? "cdx-button cdx-button--weight-quiet acga-registry-action"
            : "cdx-button";
        element.textContent = label;
        element.addEventListener(
            "click",
            () => {
                if (!busy) void action();
            },
            { signal: controller.signal },
        );
        return element;
    }
    const create = button(msg("register_a_new_nomination"), () =>
        invoke(actions.newNomination),
    );
    create.classList.add(
        "cdx-button--action-progressive",
        "cdx-button--weight-primary",
    );
    const choose = button(msg("batch_checking"), () => {
        choosing = !choosing;
        if (!choosing) {
            selected.clear();
            for (const label of checkboxes)
                label.querySelector("input")!.checked = false;
        }
        sync();
    });
    const begin = button(msg("start_checking"), () =>
        invoke(async () => {
            await actions.checkBatch([...selected.values()]);
            selected.clear();
            for (const label of checkboxes)
                label.querySelector("input")!.checked = false;
        }),
    );
    function sync() {
        for (const element of inserted.flatMap((item) => [
            item,
            ...item.querySelectorAll("button,input"),
        ])) {
            if (
                element instanceof doc.defaultView!.HTMLButtonElement ||
                element instanceof doc.defaultView!.HTMLInputElement
            )
                element.disabled = busy;
        }
        choose.setAttribute("aria-pressed", String(choosing));
        begin.hidden = !choosing;
        begin.disabled = busy || selected.size === 0;
        for (const label of checkboxes) label.hidden = !choosing;
        status.textContent = busy
            ? msg("working")
            : choosing
              ? msg("count_items_selected", { count: selected.size })
              : "";
    }
    toolbar.append(create, choose, begin, status);
    root.prepend(toolbar);
    inserted.push(toolbar);

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
                true,
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
                true,
            );
            heading.append(edit);
            inserted.push(edit);
            const checkRow = row.nextElementSibling;
            const anchor = checkRow?.querySelector<HTMLElement>(".mw-notalk");
            if (!anchor || anchor.closest("table") !== table) continue;
            const controls = doc.createElement("div");
            controls.className = "acga-registry-controls";
            const check = button(
                msg("check"),
                () => invoke(() => actions.checkNomination(selection)),
                true,
            );
            const label = doc.createElement("label");
            label.className = "acga-registry-select";
            const checkbox = doc.createElement("input");
            checkbox.type = "checkbox";
            checkbox.addEventListener(
                "change",
                () => {
                    if (checkbox.checked) selected.set(checkbox, selection);
                    else selected.delete(checkbox);
                    sync();
                },
                { signal: controller.signal },
            );
            label.append(checkbox, doc.createTextNode(msg("add_to_batch")));
            controls.append(check, label);
            anchor.append(controls);
            checkboxes.push(label);
            inserted.push(controls);
        }
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
