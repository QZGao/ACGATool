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

/** Read only explicit talk-page milestones, ignoring comments and literal examples. */
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
    const milestoneDates: string[] = [];
    let hasPassedBanner = false;
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
        if (name === "dykinvite") hasActiveNomination = true;
        const params = new Map<string, string>();
        let resultIndex = -1;
        let position = 1;
        for (const [index, field] of fields.entries()) {
            const equal = field.indexOf("=");
            if (equal < 0) params.set(String(position++), field.trim());
            else {
                const key = field.slice(0, equal).trim().toLowerCase();
                params.set(key, field.slice(equal + 1).trim());
                if (key === "result") resultIndex = index;
            }
        }
        if (["dyktalk", "didyouknowdate"].includes(name)) {
            hasPassedBanner = true;
            const date =
                readableDate(params.get("date") ?? "") ??
                readableDate((params.get("1") ?? "") + (params.get("2") ?? ""));
            if (date) milestoneDates.push(date);
        }
        if (name === "articlehistory") {
            for (const [key, value] of params) {
                if (!/^dyk\d*date$/u.test(key)) continue;
                const date = readableDate(value);
                if (date) {
                    hasPassedBanner = true;
                    milestoneDates.push(date);
                }
            }
        }
        const result = params.get("result");
        if (name === "dykentry/archive" && ["+", "-"].includes(result ?? "")) {
            const closingTime =
                epochTime(params.get("closets") ?? "") ??
                (resultIndex >= 0 && !fields[resultIndex + 1]?.includes("=")
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
    const newestDate =
        milestoneDates
            .sort((left, right) => dateSortKey(left) - dateSortKey(right))
            .at(-1) ?? null;
    return {
        passed: hasPassedBanner,
        date: newestDate,
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

function dateSortKey(value: string): number {
    const parts = /^(\d{4})(?:年|-)(\d{1,2})(?:月|-)(\d{1,2})/u.exec(
        value.replace(/\s/gu, ""),
    )!;
    return Number(parts[1]) * 10000 + Number(parts[2]) * 100 + Number(parts[3]);
}

function readableDate(value: string): string | null {
    const date = value.trim();
    const compact = /^(\d{4})(\d{2})(\d{2})$/u.exec(date);
    const parts =
        compact ??
        /^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日$/u.exec(date) ??
        /^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(date);
    if (!parts) return null;
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    if (
        year < 1 ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > new Date(Date.UTC(year, month, 0)).getUTCDate()
    )
        return null;
    return compact ? `${parts[1]}-${parts[2]}-${parts[3]}` : date;
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
