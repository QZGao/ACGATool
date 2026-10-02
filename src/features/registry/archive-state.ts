/**
 * @file src/features/registry/archive-state.ts
 * Purpose: Read archive signals from the wiki's rendered nomination tables.
 *
 * Table of contents:
 * 1. Imports
 * 2. getRenderedHeaderState
 * 3. readTimestamp
 * 4. getRenderedReviewTimestamp
 * 5. getRenderedDiscussionTimestamp
 */

import { getLatestUtcSignature } from "../../domain/archive-eligibility.ts";

export function getRenderedHeaderState(
    heading: HTMLTableCellElement,
): "pending" | "rechecking" | null {
    const color = heading.style.backgroundColor.replace(/\s+/gu, "");
    if (/^rgba?\(255,255,185(?:,|\))/u.test(color)) return "pending";
    if (/^rgba?\(255,185,255(?:,|\))/u.test(color)) return "rechecking";
    return null;
}

function readTimestamp(content: Element | DocumentFragment): number | null {
    const copy = content.cloneNode(true) as Element | DocumentFragment;
    for (const ignored of copy.querySelectorAll(
        "table, script, style, pre, code, .acga-registry-controls, .mw-editsection",
    ))
        ignored.remove();
    return getLatestUtcSignature(copy.textContent ?? "");
}

export function getRenderedReviewTimestamp(result: HTMLElement): number | null {
    return readTimestamp(result);
}

export function getRenderedDiscussionTimestamp(
    root: HTMLElement,
    heading: Element,
    nextHeading: Element | null,
): number | null {
    const range = root.ownerDocument.createRange();
    range.setStartAfter(heading);
    if (nextHeading) range.setEndBefore(nextHeading);
    else range.setEnd(root, root.childNodes.length);
    return readTimestamp(range.cloneContents());
}
