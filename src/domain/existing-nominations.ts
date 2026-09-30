/** Current-registry nomination identities and advisory duplicate matching. */
import { getRegistryEntries, queried2NomData } from "./wikitext.ts";

export interface ExistingNomination {
    pageName: string;
    awarder: string;
    nominator?: string;
    date: string;
    index: number;
    sectionOccurrence: number;
    dateLabel: string;
    dateAnchor: string;
    reasonText: string;
    checked: boolean;
}

function normalizeFirstLetter(value: string): string {
    const [first = "", ...rest] = value;
    return first.toLocaleUpperCase("en") + rest.join("");
}

/** Match title spelling variations without collapsing case-sensitive names. */
export function normalizeNominationPageName(value: unknown): string {
    const title = String(value ?? "")
        .replaceAll("_", " ")
        .replace(/\s+/gu, " ")
        .trim()
        .replace(/^:/u, "")
        .replace(/#.*$/u, "")
        .trim()
        .replace(/^(?:file|image|文件|檔案|图像|圖像):/iu, "File:");
    return title.startsWith("File:")
        ? "File:" + normalizeFirstLetter(title.slice(5))
        : normalizeFirstLetter(title);
}

export function normalizeNominationRecipient(value: unknown): string {
    return normalizeFirstLetter(
        String(value ?? "")
            .replaceAll("_", " ")
            .replace(/\s+/gu, " ")
            .trim()
            .replace(/^(?:user|用户|用戶|使用者):/iu, "")
            .trim(),
    );
}

export type NominationCheckRestriction =
    | "check_disabled_own_nomination"
    | "check_disabled_own_score"
    | "check_disabled_own_nomination_and_score";

/** A reviewer must neither nominate the work nor receive its score. */
export function getNominationCheckRestriction(
    nomination: { awarder: unknown; nominator?: unknown },
    userName: string | null,
): NominationCheckRestriction | null {
    const reviewer = normalizeNominationRecipient(userName);
    if (!reviewer) return null;
    const nominated =
        normalizeNominationRecipient(nomination.nominator) === reviewer;
    const scored =
        normalizeNominationRecipient(nomination.awarder) === reviewer;
    if (nominated && scored) return "check_disabled_own_nomination_and_score";
    if (nominated) return "check_disabled_own_nomination";
    return scored ? "check_disabled_own_score" : null;
}

export function getExistingNominations(
    text: string,
    pageName?: string,
): ExistingNomination[] {
    const target =
        pageName === undefined
            ? undefined
            : normalizeNominationPageName(pageName);
    if (target === "") return [];
    return getRegistryEntries(text).flatMap((entry) => {
        const data = queried2NomData(entry);
        const page = normalizeNominationPageName(data?.pageName);
        if (!data || !page || (target !== undefined && page !== target))
            return [];
        return [
            {
                pageName: String(data.pageName).trim(),
                awarder: String(data.awarder).trim(),
                ...(data.nominator ? { nominator: data.nominator } : {}),
                date: entry.date,
                index: entry.index,
                sectionOccurrence: entry.sectionOccurrence,
                dateLabel: entry.date,
                dateAnchor:
                    entry.date +
                    (entry.sectionOccurrence
                        ? `_${entry.sectionOccurrence + 1}`
                        : ""),
                reasonText: String(data.requestReasonText ?? "").trim(),
                checked: Boolean(String(data.checkWikitext ?? "").trim()),
            },
        ];
    });
}

/** Exclude exactly the opened entry, never another otherwise identical request. */
export function isSameNomination(
    nomination: ExistingNomination,
    target: unknown,
): boolean {
    if (typeof target !== "object" || target === null) return false;
    const identity = target as Record<string, unknown>;
    return (
        nomination.date === identity.date &&
        nomination.index === identity.index &&
        nomination.sectionOccurrence === identity.sectionOccurrence
    );
}

export function findDuplicateNominations(
    nominations: ExistingNomination[],
    pageName: unknown,
    awarder: unknown,
    target?: unknown,
): ExistingNomination[] {
    const page = normalizeNominationPageName(pageName);
    const recipient = normalizeNominationRecipient(awarder);
    if (!page || !recipient) return [];
    return nominations.filter(
        (item) =>
            normalizeNominationPageName(item.pageName) === page &&
            normalizeNominationRecipient(item.awarder) === recipient &&
            !isSameNomination(item, target),
    );
}
