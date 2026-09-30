import type { DykStatus } from "../../domain/dyk-status.ts";
import type { MessageKey, Translator } from "../../i18n/index.ts";
import type { MessageValues } from "../../shared/i18n.ts";

/** Keep translated prose and the talk-page link separate from untrusted text. */
export function createDykMessage(
    status: DykStatus | null,
    loading: boolean,
    failed: boolean,
    msg: Translator,
    now: number,
    compact = false,
) {
    const record = status?.records?.at(-1);
    let key: MessageKey | null = null;
    const values: MessageValues = {};
    if (loading) key = "dyk_status_loading";
    else if (failed) key = "dyk_status_failed";
    else if (compact && (record || status?.passed)) {
        const passed = record?.passed ?? status!.passed;
        const dated = Boolean(record ? record.date : status?.date);
        key = passed
            ? dated
                ? "dyk_compact_passed_on"
                : "dyk_compact_passed"
            : dated
              ? "dyk_compact_not_passed_on"
              : "dyk_compact_not_passed";
        values.authorClause = record?.author
            ? msg("dyk_compact_author", { author: record.author })
            : "";
    } else if (record) {
        key = record.passed
            ? record.date
                ? "dyk_latest_passed"
                : "dyk_latest_passed_undated"
            : record.date
              ? "dyk_latest_not_passed"
              : "dyk_latest_not_passed_undated";
        values.author = record.author || msg("dyk_record_author_unknown");
    } else if (status?.passed)
        key = status.date ? "dyk_status_passed_on" : "dyk_status_passed";
    else if (status && !status.nominated) key = "dyk_status_not_found";

    const date = record?.date ?? status?.date;
    if (date) Object.assign(values, formatDate(date, msg, now));
    const template = key ? msg(key) : "";
    const linkPlaceholder =
        key === "dyk_status_not_found" ? "{talk}" : "{selection}";
    const linkPosition = template.indexOf(linkPlaceholder);
    const interpolate = (text: string) =>
        text.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (placeholder, name) =>
            values[name] == null ? placeholder : String(values[name]),
        );
    if (linkPosition < 0)
        return {
            beforeLink: interpolate(template) + (template ? " " : ""),
            linkLabel: msg("dyk_status_talk_link"),
            afterLink: "",
        };
    return {
        beforeLink: interpolate(template.slice(0, linkPosition)),
        linkLabel: msg(
            key === "dyk_status_not_found"
                ? "dyk_status_talk_page"
                : compact
                  ? "dyk_compact_selection_link"
                  : "dyk_status_selection_link",
        ),
        afterLink: interpolate(
            template.slice(linkPosition + linkPlaceholder.length),
        ),
    };
}

function formatDate(
    value: string,
    msg: Translator,
    now: number,
): MessageValues {
    const parts =
        /^(\d{4})(?:年\s*|-)(\d{1,2})(?:月\s*|-)(\d{1,2})(?:日)?$/u.exec(value);
    if (!parts) return { date: value, age: "" };
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    const days = Math.floor(now / 86_400_000) - date.getTime() / 86_400_000;
    const useIsoPadding = msg("dyk_date") === "{year}-{month}-{day}";
    return {
        date: msg("dyk_date", {
            year: parts[1]!,
            month: useIsoPadding ? String(month).padStart(2, "0") : month,
            day: useIsoPadding ? String(day).padStart(2, "0") : day,
        }),
        age: msg(
            days < 0
                ? days === -1
                    ? "dyk_day_from_now"
                    : "dyk_days_from_now"
                : days === 1
                  ? "dyk_day_ago"
                  : "dyk_days_ago",
            { days: Math.abs(days) },
        ),
    };
}
