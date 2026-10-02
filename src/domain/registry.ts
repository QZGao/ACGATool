/**
 * @file src/domain/registry.ts
 * Purpose: Deterministic insertion and deduplication of registration and archive sections.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. insertBlock
 * 4. insertNominationIntoRegistry
 * 5. parseNumericDateHeading
 * 6. dateOrdinal
 * 7. withoutHeading
 * 8. normalizedArchiveBody
 * 9. sectionContainsArchiveBody
 * 10. insertArchiveSection
 */

import { getDateSections } from "./wikitext.ts";
const ARCHIVE_HEADER = "{{Talk archive|WikiProject:ACG/維基ACG專題獎/登記處}}";
function insertBlock(text: string, index: number, block: string): string {
    const left = text.slice(0, index);
    const right = text.slice(index);
    const cleanBlock = block.replace(/^\n+|\n+$/g, "");
    const before =
        left === "" || left.endsWith("\n\n")
            ? ""
            : left.endsWith("\n")
              ? "\n"
              : "\n\n";
    const after =
        right === "" || right.startsWith("\n\n")
            ? ""
            : right.startsWith("\n")
              ? "\n"
              : "\n\n";
    return left + before + cleanBlock + after + right;
}

/** Insert a nomination beneath the last physical matching date heading. */
export function insertNominationIntoRegistry(
    text: string,
    date: string,
    nominationText: string,
): string {
    const matchingSections = getDateSections(text).filter(
        (section) => section.date === date,
    );
    if (matchingSections.length > 0) {
        return insertBlock(text, matchingSections.at(-1).end, nominationText);
    }
    return insertBlock(text, text.length, `=== ${date} ===\n${nominationText}`);
}

function parseNumericDateHeading(
    date: string,
): { month: number; day: number } | null {
    const match = String(date)
        .trim()
        .match(/^(\d{1,2})月(\d{1,2})日$/u);
    if (!match) return null;
    const month = Number(match[1]);
    const day = Number(match[2]);
    return month >= 1 && month <= 12 && day >= 1 && day <= 31
        ? { month, day }
        : null;
}

function dateOrdinal(date: { month: number; day: number }): number {
    return date.month * 100 + date.day;
}

function withoutHeading(sectionText: string): string {
    return sectionText.replace(/^===\s*.+?\s*===\s*(?:\r?\n|$)/u, "");
}

function normalizedArchiveBody(sectionText: string): string {
    return withoutHeading(sectionText).replace(/\r\n?/g, "\n").trim();
}

function sectionContainsArchiveBody(
    sectionText: string,
    archivedBody: string,
): boolean {
    if (archivedBody === "") return false;
    const body = normalizedArchiveBody(sectionText);
    let offset = body.indexOf(archivedBody);
    while (offset !== -1) {
        const end = offset + archivedBody.length;
        const startsAtBoundary =
            offset === 0 || body.slice(0, offset).endsWith("\n\n");
        const endsAtBoundary =
            end === body.length || body.slice(end).startsWith("\n\n");
        if (startsAtBoundary && endsAtBoundary) return true;
        offset = body.indexOf(archivedBody, offset + 1);
    }
    return false;
}

/**
 * Insert an archived section by numeric month/day. A matching date reuses the
 * last existing physical heading; unrelated archive content is left in place.
 */
export function insertArchiveSection(
    archiveText: string,
    sectionText: string,
    date: string,
    {
        addHeader = false,
        fallbackMonth,
        fallbackDay,
    }: {
        addHeader?: boolean;
        fallbackMonth?: number;
        fallbackDay?: number;
    } = {},
): string {
    let text = archiveText;
    if (addHeader && text.trim() === "") text = ARCHIVE_HEADER;

    const targetDate =
        parseNumericDateHeading(date) ??
        (Number.isInteger(fallbackMonth) && Number.isInteger(fallbackDay)
            ? { month: Number(fallbackMonth), day: Number(fallbackDay) }
            : null);
    const sections = getDateSections(text);
    if (targetDate) {
        const datedSections = sections
            .map((section) => ({
                section,
                parsed: parseNumericDateHeading(section.date),
            }))
            .filter((item) => item.parsed !== null) as Array<{
            section: { date: string; start: number; end: number };
            parsed: { month: number; day: number };
        }>;
        const sameDate = datedSections.filter(
            (item) => dateOrdinal(item.parsed) === dateOrdinal(targetDate),
        );
        if (sameDate.length > 0) {
            const archivedBody = normalizedArchiveBody(sectionText);
            if (
                sameDate.some((item) =>
                    sectionContainsArchiveBody(
                        text.slice(item.section.start, item.section.end),
                        archivedBody,
                    ),
                )
            ) {
                return text;
            }
            return insertBlock(
                text,
                sameDate.at(-1)!.section.end,
                withoutHeading(sectionText),
            );
        }
        const laterDate = datedSections.find(
            (item) => dateOrdinal(item.parsed) > dateOrdinal(targetDate),
        );
        if (laterDate)
            return insertBlock(text, laterDate.section.start, sectionText);
        if (datedSections.length > 0) {
            return insertBlock(
                text,
                datedSections.at(-1)!.section.end,
                sectionText,
            );
        }
    }
    return insertBlock(text, text.length, sectionText);
}
