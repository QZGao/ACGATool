/**
 * @file src/domain/dyk-status.ts
 * Purpose: src / domain / dyk status module.
 *
 * Table of contents:
 * 1. DykStatus
 * 2. parseDykStatus
 * 3. epochTime
 * 4. plainAuthor
 * 5. splitFields
 */

export interface DykStatus {
    passed: boolean;
    date: string | null;
    nominated?: boolean;
    records?: Array<{
        author: string | null;
        date: string | null;
        passed: boolean;
    }>;
}

/** Read finalized DYK archive results and active invitations, ignoring literal examples. */
export function parseDykStatus(source: string): DykStatus {
    const text = source
        .replace(/<!--[\s\S]*?(?:-->|$)/gu, "")
        .replace(
            /<(nowiki|pre|source|syntaxhighlight)\b[^>]*(?<!\/)>[\s\S]*?(?:<\/\1\s*>|$)/giu,
            "\u0000",
        );
    const stack: Array<{ start: number; width: number }> = [];
    const templates: string[] = [];
    for (let index = 0; index < text.length; index++) {
        if (text.startsWith("{{", index)) {
            const width = text.startsWith("{{{", index) ? 3 : 2;
            stack.push({ start: index + width, width });
            index += width - 1;
        } else if (text.startsWith("}}", index) && stack.length) {
            const opening = stack[stack.length - 1]!;
            if (opening.width === 3 && !text.startsWith("}}}", index)) continue;
            stack.pop();
            if (opening.width === 2)
                templates.push(text.slice(opening.start, index));
            index += opening.width - 1;
        }
    }
    let hasActiveNomination = false;
    const archiveRecords: Array<{
        author: string | null;
        date: string | null;
        passed: boolean;
        orderingTime: number | null;
    }> = [];
    for (const template of templates) {
        const fields = splitFields(template);
        const name = (fields.shift() ?? "")
            .trim()
            .replace(/^(?:template|模板)\s*:/iu, "")
            .replace(/[ _]/gu, "")
            .toLowerCase();
        if (name === "dykinvite") {
            hasActiveNomination = true;
            continue;
        }
        if (name !== "dykentry/archive") continue;
        const params = new Map<string, string>();
        let resultIndex = -1;
        for (const [index, field] of fields.entries()) {
            const equal = field.indexOf("=");
            if (equal < 0) continue;
            const key = field.slice(0, equal).trim().toLowerCase();
            params.set(key, field.slice(equal + 1).trim());
            if (key === "result") resultIndex = index;
        }
        const result = params.get("result");
        if (result === "+" || result === "-") {
            const closingTime =
                epochTime(params.get("closets") ?? "") ??
                (!fields[resultIndex + 1]?.includes("=")
                    ? epochTime(fields[resultIndex + 2] ?? "")
                    : null);
            archiveRecords.push({
                author: plainAuthor(params.get("author") ?? ""),
                date:
                    closingTime === null
                        ? null
                        : new Date(closingTime).toISOString().slice(0, 10),
                passed: result === "+",
                // Nomination chronology identifies the latest nomination; only the
                // closing timestamp supplies the displayed outcome date above.
                orderingTime:
                    epochTime(params.get("timestamp") ?? "") ?? closingTime,
            });
        }
    }
    if (archiveRecords.length) {
        archiveRecords.sort((left, right) => {
            if (left.orderingTime === null)
                return right.orderingTime === null ? 0 : -1;
            if (right.orderingTime === null) return 1;
            return left.orderingTime - right.orderingTime;
        });
        const latest = archiveRecords[archiveRecords.length - 1]!;
        return {
            passed: latest.passed,
            date: latest.date,
            ...(hasActiveNomination ? { nominated: true } : {}),
            records: archiveRecords.map(({ author, date, passed }) => ({
                author,
                date,
                passed,
            })),
        };
    }
    return {
        passed: false,
        date: null,
        ...(hasActiveNomination ? { nominated: true } : {}),
    };
}

function epochTime(value: string): number | null {
    const seconds = value.trim();
    if (!/^\d+$/u.test(seconds)) return null;
    const time = Number(seconds) * 1000;
    if (!Number.isSafeInteger(time) || time <= 0) return null;
    const date = new Date(time);
    return Number.isFinite(date.getTime()) && date.getUTCFullYear() <= 9999
        ? time
        : null;
}

function plainAuthor(value: string): string | null {
    const link =
        /^\[\[\s*(?:User|使用者|用户|用戶)\s*:\s*([^|[\]]+)(?:\|[^\]]*)?\]\]$/iu.exec(
            value.trim(),
        );
    const author = (link?.[1] ?? value)
        .replace(/<[^>]*>/gu, " ")
        .replace(/[[\]{}|]/gu, " ")
        .replace(/\p{Cc}/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();
    return author || null;
}

function splitFields(template: string): string[] {
    const fields: string[] = [];
    let start = 0;
    let braces = 0;
    let links = 0;
    for (let index = 0; index < template.length; index++) {
        const pair = template.slice(index, index + 2);
        if (pair === "{{") {
            braces++;
            index++;
        } else if (pair === "}}") {
            braces--;
            index++;
        } else if (pair === "[[") {
            links++;
            index++;
        } else if (pair === "]]") {
            links--;
            index++;
        } else if (template[index] === "|" && braces === 0 && links === 0) {
            fields.push(template.slice(start, index));
            start = index + 1;
        }
    }
    fields.push(template.slice(start));
    return fields;
}
