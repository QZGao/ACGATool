import type { NominationData } from "./contracts.ts";
import {
    ACTIVITY_RULES,
    CONTENT_EXPANSION_RULES,
    REVIEW_APPLY_MODE,
    REVIEW_TIERS,
} from "../../domain/rules.ts";

const draftKeys = [
    "id",
    "awarder",
    "usesRecipientDefault",
    "recipientDefault",
    "articleRecipientDefault",
    "recipientSuggestionScope",
    "originalArticleTitle",
    "pageName",
    "media",
    "otherPageName",
    "ruleStatus",
    "contentExpansion",
    "quality",
    "activity",
    "review",
    "activeRuleCategory",
    "rawSourceText",
    "sourceDirty",
    "sourceOnly",
    "rule5Unresolved",
] as const;

function clone(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === "object")
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, clone(item)]),
        );
    return value;
}

/** Copy editable state, retaining defaults from the page where it was created. */
export function captureNominationDraft(
    nomination: NominationData,
): NominationData {
    return {
        ...Object.fromEntries(
            draftKeys.map((key) => [key, clone(nomination[key])]),
        ),
        awarder: nomination.awarder,
        pageName: nomination.pageName,
        frozen: Boolean(nomination.frozen),
        recipientSuggestionPending: false,
        articleRecipientSuggestionResolved: true,
    };
}

function hydrate(value: unknown, defaults: unknown, key: string): unknown {
    if (value === undefined) return clone(defaults);
    if (Array.isArray(defaults)) {
        if (!Array.isArray(value)) throw new TypeError("Invalid draft list");
        const itemDefaults = defaults[0] ?? {
            selected: false,
            desc: "",
            ogDesc: "",
            score: 0,
            maxScore: 0,
        };
        return value.map((item) => hydrate(item, itemDefaults, key));
    }
    if (defaults && typeof defaults === "object") {
        if (!value || typeof value !== "object" || Array.isArray(value))
            throw new TypeError("Invalid draft fields");
        const fields = value as Record<string, unknown>;
        const result = Object.fromEntries(
            Object.entries(defaults).map(([field, fallback]) => [
                field,
                hydrate(fields[field], fallback, field),
            ]),
        );
        // Optional custom descriptions and row presets are scalar fields.
        for (const [field, item] of Object.entries(value)) {
            if (Object.hasOwn(defaults, field)) continue;
            if (item !== null && typeof item === "object")
                throw new TypeError("Invalid optional draft field");
            if (["__proto__", "prototype", "constructor"].includes(field))
                throw new TypeError("Unsafe draft field");
            result[field] = item;
        }
        return result;
    }
    if (
        typeof value !== typeof defaults &&
        !(
            typeof defaults === "number" &&
            key === "score" &&
            (typeof value === "string" || value === null)
        )
    )
        throw new TypeError("Invalid draft value");
    return value;
}

/** Rebuild required form structure without restoring errors or pending requests. */
export function restoreNominationDraft(
    saved: NominationData,
    defaults: NominationData,
): NominationData {
    const result = { ...defaults };
    for (const key of draftKeys)
        result[key] = hydrate(saved[key], defaults[key], key);
    const review = result.review;
    const validTier = (tier: unknown) =>
        REVIEW_TIERS.some((item) => item.value === tier);
    if (
        !Object.values(REVIEW_APPLY_MODE).includes(review.mode) ||
        (review.presetTier !== undefined && !validTier(review.presetTier)) ||
        ![
            review.general,
            review.complete,
            ...Object.values(review.aspects),
        ].every((row) => validTier((row as { tier: unknown }).tier)) ||
        !CONTENT_EXPANSION_RULES.includes(result.contentExpansion.rule) ||
        !result.activity.rows.every((row: { rule: string }) =>
            ACTIVITY_RULES.includes(row.rule),
        ) ||
        !["article", "media", "revision"].includes(
            result.recipientSuggestionScope,
        )
    )
        throw new TypeError("Invalid draft option");
    result.frozen = Boolean(saved.frozen);
    result.recipientSuggestionPending = false;
    result.articleRecipientSuggestionResolved = true;
    return result;
}
