/** Archive readiness from saved nomination results and UTC signatures. */
import { getRegistryEntries, queried2NomData } from "./wikitext.ts";

export interface ArchiveEntryState {
    checked: boolean;
    rechecking: boolean;
    latestCheckTimestamp: number | null;
}

export interface ArchiveEligibility {
    available: boolean;
    emphasized: boolean;
    reason: "unreviewed" | "rechecking" | "recent" | "unknown" | "empty" | null;
}

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export function getArchiveEligibility(
    entries: ArchiveEntryState[],
    latestMessageTimestamp: number | null,
    now: Date,
): ArchiveEligibility {
    const unavailable = (reason: ArchiveEligibility["reason"]) => ({
        available: false,
        emphasized: false,
        reason,
    });
    if (!entries.length) return unavailable("empty");
    if (entries.some((entry) => !entry.checked))
        return unavailable("unreviewed");
    if (entries.some((entry) => entry.rechecking))
        return unavailable("rechecking");
    const currentTime = now.getTime();
    if (
        !Number.isFinite(currentTime) ||
        entries.some(
            (entry) =>
                entry.latestCheckTimestamp === null ||
                !Number.isFinite(entry.latestCheckTimestamp),
        )
    )
        return unavailable("unknown");
    const latestCheck = Math.max(
        ...entries.map((entry) => entry.latestCheckTimestamp!),
    );
    if (currentTime - latestCheck <= SEVEN_DAYS) return unavailable("recent");
    const latestMessage = latestMessageTimestamp ?? latestCheck;
    return {
        available: true,
        emphasized:
            Number.isFinite(latestMessage) &&
            currentTime - latestMessage > SEVEN_DAYS,
        reason: null,
    };
}

/** Preserve offsets while excluding text that MediaWiki does not render. */
function visibleWikitext(text: string): string {
    return text.replace(
        /<!--[\s\S]*?(?:-->|$)|<(nowiki|pre|source|syntaxhighlight)\b[^>]*(?<!\/)>[\s\S]*?(?:<\/\1\s*>|$)/giu,
        (ignored) => ignored.replace(/[^\r\n]/gu, " "),
    );
}

function utcTimestamp(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
): number | null {
    if (year < 1 || year > 9999) return null;
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour, minute, 0, 0);
    return date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day &&
        date.getUTCHours() === hour &&
        date.getUTCMinutes() === minute
        ? date.getTime()
        : null;
}

/** Read the latest full UTC signature, never a quoted example or date alone. */
export function getLatestUtcSignature(text: string): number | null {
    const source = visibleWikitext(text);
    const timestamps: number[] = [];
    for (const match of source.matchAll(
        /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日(?:\s*[（(][^()（）]*[)）])?\s*(\d{1,2}):(\d{2})\s*[（(]UTC[)）]/gu,
    )) {
        const timestamp = utcTimestamp(
            ...(match.slice(1).map(Number) as [
                number,
                number,
                number,
                number,
                number,
            ]),
        );
        if (timestamp !== null) timestamps.push(timestamp);
    }
    const months = [
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
    ];
    for (const match of source.matchAll(
        /(\d{1,2}):(\d{2}),?\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\s*\(UTC\)/giu,
    )) {
        const timestamp = utcTimestamp(
            Number(match[5]),
            months.indexOf(match[4]!.toLowerCase()) + 1,
            Number(match[3]),
            Number(match[1]),
            Number(match[2]),
        );
        if (timestamp !== null) timestamps.push(timestamp);
    }
    return timestamps.length ? Math.max(...timestamps) : null;
}

function splitTemplateFields(source: string): string[] {
    const fields: string[] = [];
    const braces: number[] = [];
    let links = 0;
    let start = 0;
    for (let index = 0; index < source.length; index++) {
        if (source.startsWith("{{", index)) {
            const width = source.startsWith("{{{", index) ? 3 : 2;
            braces.push(width);
            index += width - 1;
        } else if (source.startsWith("}}", index) && braces.length) {
            const width = braces.at(-1)!;
            if (width === 3 && !source.startsWith("}}}", index)) continue;
            braces.pop();
            index += width - 1;
        } else if (source.startsWith("[[", index)) {
            links++;
            index++;
        } else if (source.startsWith("]]", index) && links) {
            links--;
            index++;
        } else if (source[index] === "|" && !braces.length && !links) {
            fields.push(source.slice(start, index).trim());
            start = index + 1;
        }
    }
    fields.push(source.slice(start).trim());
    return fields;
}

function readTemplates(source: string): Array<{
    name: string;
    fields: string[];
    start: number;
    end: number;
}> {
    const templates = [];
    const braces: Array<{ start: number; width: number }> = [];
    for (let index = 0; index < source.length; index++) {
        if (source.startsWith("{{", index)) {
            const width = source.startsWith("{{{", index) ? 3 : 2;
            braces.push({ start: index, width });
            index += width - 1;
        } else if (source.startsWith("}}", index) && braces.length) {
            const opening = braces.at(-1)!;
            if (opening.width === 3 && !source.startsWith("}}}", index))
                continue;
            braces.pop();
            if (opening.width === 2) {
                const fields = splitTemplateFields(
                    source.slice(opening.start + 2, index),
                );
                templates.push({
                    name: (fields.shift() ?? "")
                        .replace(/^(?:template|模板)\s*:/iu, "")
                        .trim(),
                    fields,
                    start: opening.start,
                    end: index + 2,
                });
            }
            index += opening.width - 1;
        }
    }
    return templates;
}

function isRechecking(check: string): boolean {
    return readTemplates(check).some((template) => {
        if (template.name !== "ACG提名2/check") return false;
        let status = "";
        for (const field of template.fields) {
            const parameter = /^status\s*=\s*([\s\S]*)$/u.exec(field);
            if (parameter) status = parameter[1]!.trim();
        }
        return status === "rechecking";
    });
}

/** Enforce the same archive rules against the saved source before a wiki edit. */
export function getWikitextArchiveEligibility(
    sectionText: string,
    now: Date,
): ArchiveEligibility {
    const source = visibleWikitext(sectionText);
    const entries = getRegistryEntries(source).map((entry) => {
        const check = String(
            queried2NomData(entry)?.checkWikitext ?? "",
        ).trim();
        return {
            checked: Boolean(check),
            rechecking: isRechecking(check),
            latestCheckTimestamp: getLatestUtcSignature(check),
        };
    });
    let discussion = source;
    for (const template of readTemplates(source)) {
        if (!/^ACG提名2?(?:\/extra)?$/u.test(template.name)) continue;
        discussion =
            discussion.slice(0, template.start) +
            discussion
                .slice(template.start, template.end)
                .replace(/[^\r\n]/gu, " ") +
            discussion.slice(template.end);
    }
    return getArchiveEligibility(
        entries,
        getLatestUtcSignature(discussion),
        now,
    );
}
