import { createTranslator, type Translator } from "../../i18n/index.ts";
import {
    nominationRuleGroup,
    validateNominationGroup,
} from "../../domain/rules.ts";
import type { NominationRule } from "../../domain/rules.ts";
import {
    ACTIVITY_RULES,
    allRuleOccurrences,
    classifyRule5Code,
    CONTENT_EXPANSION_RULES,
    decomposeRule5Tokens,
    formatCheckedNominationItemWikitext,
    formatNominationCheckWikitext,
    formatNominationItemWikitext,
    getActivityDraft,
    getContentExpansionDraft,
    getOrderedRuleStatus,
    getQualityDraft,
    getReviewDraft,
    getReviewDefaultScore,
    isRepeatableRule,
    normalizeRepeatableRules,
    NominationRuleSet,
    QUALITY_RULES,
    resolveAuthorTarget,
    resolveMediaPageName,
    REVIEW_ASPECT_ROWS,
    reviewCode,
    serializeNominationReason,
    serializeNominationDraftReason,
    validateActivityDraft,
} from "../../domain/rules.ts";
import { formatEditableItemSource } from "../../domain/wikitext.ts";
import type { DialogModelServices } from "./contracts.ts";
const SCORE_PRECISION = 15;
function normalizeScore(score: number) {
    if (Object.is(score, -0)) return 0;
    return Number(score.toPrecision(SCORE_PRECISION));
}
/**
 * 計算所有已選提名規則的總分。
 *
 * @param ruleStatus 以規則代碼為鍵的提名規則狀態。
 * @returns 正規化後的總分；已選規則的分數無效時回傳 null。
 */
export function getSelectedScoreTotal(ruleStatus: any = {}): number | null {
    let total = 0;
    for (const { status } of allRuleOccurrences(ruleStatus)) {
        if (!status || !status.selected) continue;
        const rawScore = status.score;
        const supportedType =
            typeof rawScore === "number" || typeof rawScore === "string";
        if (
            !supportedType ||
            (typeof rawScore === "string" && rawScore.trim() === "")
        )
            return null;
        const score = Number(rawScore);
        if (!Number.isFinite(score) || score < 0) return null;
        const halfPoints = score * 2;
        if (
            Math.abs(halfPoints - Math.round(halfPoints)) >
            Number.EPSILON * Math.max(1, Math.abs(halfPoints))
        )
            return null;
        total += score;
        if (!Number.isFinite(total)) return null;
    }
    return normalizeScore(total);
}
/**
 * 格式化新提名分頁所顯示的標籤。
 *
 * @param position 從 1 開始的提名位置。
 * @returns 只包含提名位置的穩定分頁標籤。
 */
export function formatNominationTabLabel(
    position: number,
    msg: Translator = createTranslator("zh-Hant").msg,
): string {
    const fallbackPosition =
        Number.isInteger(position) && position > 0 ? position : 1;
    return `${msg("nomination")} ${fallbackPosition}`;
}
/** Creates independent drafts and validation rules for a dialog session. */
export function createNominationModel(services: DialogModelServices) {
    const msg = services.msg;
    const { ruleNames: validationRuleNames, ruleDict: validationRuleDict } =
        NominationRuleSet(msg);
    let nominationSequence = 0;
    const instanceId = Math.random().toString(36).slice(2);
    function authorTargetErrorMessage(error: any) {
        if (error?.code === "missing-author-category") {
            return msg("choose_a_nomination_category");
        }
        return msg("article_title_missing");
    }
    function authorCodePreviewResult(
        nomination: any,
        position: number,
        ruleNames: string[],
    ) {
        const activeCategory = nomination?.activeRuleCategory;
        if (
            nomination?.sourceOnly ||
            (nomination?.rule5Unresolved && activeCategory === "review")
        ) {
            return { text: nomination.rawSourceText, error: "" };
        }
        const activeNomination = activeAuthorNomination(nomination);
        const target = resolveAuthorTarget(activeNomination, "他薦");
        const reasonText = serializeNominationDraftReason(
            authorDraftRuleStatus(nomination),
            ruleNames,
        );
        return {
            text: formatNominationItemWikitext(
                {
                    ...activeNomination,
                    pageName: target.ok
                        ? target.pageName
                        : activeCategory === "media"
                          ? resolveMediaPageName(activeNomination.media)
                          : activeNomination.pageName ||
                            activeNomination.otherPageName ||
                            "",
                },
                position,
                reasonText,
            ),
            error: "",
        };
    }
    function checkCodePreviewResult(
        nomination: any,
        position: number,
        ruleNames: string[],
        ruleDict: Record<string, NominationRule>,
    ) {
        const formatted = formatNominationCheckWikitext(
            nomination,
            ruleNames,
            ruleDict,
        );
        let wikitext = formatted.wikitext;
        if (!formatted.ok) {
            const rows = Array.isArray(nomination.ruleTokens)
                ? nomination.ruleTokens.map((status: any) => ({
                      rule: status.code,
                      status,
                  }))
                : getOrderedRuleStatus(ruleNames, nomination.ruleStatus);
            const selected: string[] = [];
            const unselected: string[] = [];
            for (const { rule, status } of rows) {
                const defaults = ruleDict[rule];
                const text = serializeNominationDraftReason(
                    {
                        [rule]: {
                            ...status,
                            selected: true,
                            pending: false,
                            ogDesc:
                                status.desc === defaults?.label
                                    ? status.desc
                                    : status.ogDesc,
                            maxScore: defaults?.score ?? status.maxScore,
                        },
                    },
                    [rule],
                );
                (status.selected ? selected : unselected).push(text);
            }
            wikitext = `{{ACG提名2/check|ver=1|${selected.join(" ")}${unselected.length ? `|no=${unselected.join(" ")}` : ""}}}${String(nomination.message ?? "")}--${"~".repeat(4)}`;
        }
        return {
            text: formatCheckedNominationItemWikitext(
                nomination,
                position,
                nomination.requestReasonText,
                wikitext,
            ),
            error: "",
        };
    }
    function cloneValue(value: any): any {
        if (Array.isArray(value)) return value.map(cloneValue);
        if (value && typeof value === "object") {
            return Object.fromEntries(
                Object.entries(value).map(([key, item]) => [
                    key,
                    cloneValue(item),
                ]),
            );
        }
        return value;
    }
    function editableSourceValues(nomData: any) {
        if (nomData?.rawFields) return cloneValue(nomData.rawFields);
        const requestReasonText = String(nomData?.requestReasonText ?? "");
        return {
            條目名稱: String(nomData?.pageName ?? ""),
            用戶名稱: String(nomData?.awarder ?? ""),
            提名理由: String(
                nomData?.requestReasonWikitext ??
                    `{{ACG提名2/request|ver=1|${requestReasonText}}}`,
            ),
            核對用: String(nomData?.checkWikitext ?? ""),
        };
    }
    function editableSourceState(nomData: any) {
        return {
            rawSourceText: formatEditableItemSource(
                editableSourceValues(nomData),
                1,
            ),
            sourceDirty: false,
            sourceOnly: false,
            sourceError: "",
            rule5Unresolved: false,
        };
    }
    function editableNumber(value: any) {
        if (value == null || (typeof value === "string" && value.trim() === ""))
            return NaN;
        const number = Number(value);
        return Number.isFinite(number) ? number : NaN;
    }
    function displayNumber(value: any) {
        return Number.isFinite(Number(value)) ? String(value) : "";
    }
    function isHalfPointScore(value: any) {
        const score = editableNumber(value);
        if (!Number.isFinite(score) || score < 0) return false;
        const halfPoints = score * 2;
        return (
            Math.abs(halfPoints - Math.round(halfPoints)) <=
            Number.EPSILON * Math.max(1, Math.abs(halfPoints))
        );
    }
    function isEditablePendingRule(rule: string) {
        return QUALITY_RULES.includes(rule) || ACTIVITY_RULES.includes(rule);
    }
    function hydrateRuleStatus(
        source: any,
        ruleNames: string[],
        ruleDict: Record<string, NominationRule>,
        includeMissing: boolean,
    ) {
        const hydrated = normalizeRepeatableRules(cloneValue(source || {}), {
            includeMissing,
        });
        for (const rule of ruleNames) {
            const canonical = ruleDict[rule];
            if (isRepeatableRule(rule)) {
                const occurrences = hydrated[rule] || [];
                for (const status of occurrences) {
                    status.selected = Boolean(status.selected);
                    if (status.desc == null) status.desc = canonical.label;
                    status.ogDesc = canonical.label;
                    status.score =
                        status.score == null
                            ? canonical.score
                            : editableNumber(status.score);
                    status.maxScore = canonical.score;
                    if (status.pending && isEditablePendingRule(rule))
                        status.pending = true;
                    else delete status.pending;
                }
                hydrated[rule] = occurrences;
                continue;
            }
            if (
                !includeMissing &&
                !Object.prototype.hasOwnProperty.call(hydrated, rule)
            )
                continue;
            const status = hydrated[rule] || {};
            status.selected = Boolean(status.selected);
            if (status.desc == null) status.desc = canonical.label;
            status.ogDesc = canonical.label;
            status.score =
                status.score == null
                    ? canonical.score
                    : editableNumber(status.score);
            status.maxScore = canonical.score;
            if (status.pending && isEditablePendingRule(rule))
                status.pending = true;
            else delete status.pending;
            hydrated[rule] = status;
        }
        return hydrated;
    }
    function own(object: any, key: string) {
        return Object.prototype.hasOwnProperty.call(object, key);
    }
    function tokenStatus(token: any, ruleDict: Record<string, NominationRule>) {
        const ruleset = ruleDict[token.code];
        if (!ruleset)
            throw new TypeError(`Rule dictionary is missing ${token.code}`);
        return {
            selected: true,
            desc: token.comment === null ? ruleset.label : token.comment,
            ogDesc: ruleset.label,
            score:
                token.scoreOverride === null
                    ? Number(ruleset.score)
                    : token.scoreOverride,
            maxScore: Number(ruleset.score),
            ...(token.pending ? { pending: true } : {}),
        };
    }
    function replaceRule5Tokens(tokens: any[], decomposition: any) {
        const replacements = new Map();
        for (const token of decomposition.tokens) {
            if (!replacements.has(token.sourceIndex))
                replacements.set(token.sourceIndex, []);
            replacements.get(token.sourceIndex).push(token);
        }
        return tokens.flatMap((token: any) => {
            if (classifyRule5Code(token.code) === null) return [token];
            return replacements.get(token.sourceIndex) || [];
        });
    }
    function validateAuthorTokenShape(tokens: any[]) {
        const rule1 = tokens.filter((token: any) =>
            CONTENT_EXPANSION_RULES.includes(token.code),
        );
        if (rule1.length > 1)
            return { ok: false, error: { code: "multiple-rule-1" } };
        const qualityIndexes = tokens
            .filter((token: any) => QUALITY_RULES.includes(token.code))
            .map((token: any) => QUALITY_RULES.indexOf(token.code));
        if (new Set(qualityIndexes).size !== qualityIndexes.length) {
            return { ok: false, error: { code: "duplicate-rule-2" } };
        }
        if (qualityIndexes.length > 0) {
            const sorted = [...qualityIndexes].sort((a, b) => a - b);
            if (
                sorted.some(
                    (value, index) =>
                        index > 0 && value !== sorted[index - 1] + 1,
                )
            ) {
                return { ok: false, error: { code: "noncontiguous-rule-2" } };
            }
        }
        const seen = new Set();
        for (const token of tokens) {
            if (isRepeatableRule(token.code)) continue;
            if (seen.has(token.code)) {
                return {
                    ok: false,
                    error: { code: "duplicate-rule", rule: token.code },
                };
            }
            seen.add(token.code);
        }
        return { ok: true };
    }
    function ruleStatusFromTokens(
        tokens: any[],
        ruleDict: Record<string, NominationRule>,
    ) {
        const shape = validateAuthorTokenShape(tokens);
        if (!shape.ok) return shape;
        const ruleStatus: Record<string, any> = {};
        for (const token of tokens) {
            if (token.pending && !isEditablePendingRule(token.code)) {
                return {
                    ok: false,
                    error: { code: "pending-not-editable", rule: token.code },
                };
            }
            const status = tokenStatus(token, ruleDict);
            if (isRepeatableRule(token.code)) {
                if (!Array.isArray(ruleStatus[token.code]))
                    ruleStatus[token.code] = [];
                ruleStatus[token.code].push(status);
            } else {
                ruleStatus[token.code] = status;
            }
        }
        return { ok: true, ruleStatus };
    }
    function checkTokenRow(
        token: any,
        ruleDict: Record<string, NominationRule>,
    ) {
        return {
            ...cloneValue(token),
            ...tokenStatus(token, ruleDict),
        };
    }
    function parseErrorLabel(error: any) {
        if (!error) return "";
        const detail = error.rule ? `${error.code}: ${error.rule}` : error.code;
        return String(detail || "unrepresentable-source");
    }
    function authorRuleCategory(rule: string): string | null {
        return nominationRuleGroup(rule);
    }
    function initialRuleCategory(ruleStatus: any): string {
        const selectedCategories = new Set<string>();
        for (const [rule, value] of Object.entries(ruleStatus || {})) {
            const selected = (Array.isArray(value) ? value : [value]).some(
                (status) => status?.selected,
            );
            if (!selected) continue;
            const category = authorRuleCategory(rule);
            if (category !== null) selectedCategories.add(category);
        }
        if (selectedCategories.size === 1) return [...selectedCategories][0];
        return "article";
    }
    const AUTHOR_RULE_CATEGORIES = new Set([
        "article",
        "review",
        "media",
        "recommendation",
        "other",
    ]);
    function activeAuthorRuleStatus(nomination: any) {
        const activeCategory = nomination?.activeRuleCategory;
        const ruleStatus = nomination?.ruleStatus || {};
        if (!AUTHOR_RULE_CATEGORIES.has(activeCategory)) return {};
        return Object.fromEntries(
            Object.entries(ruleStatus).filter(
                ([rule]) => authorRuleCategory(rule) === activeCategory,
            ),
        );
    }
    function activeAuthorNomination(nomination: any) {
        return {
            ...nomination,
            awarder: effectiveRecipient(nomination),
            pageName: effectiveArticlePageName(nomination),
            media: {
                ...nomination.media,
                pageName: effectiveMediaPageName(nomination),
            },
            otherPageName: effectiveOtherPageName(nomination),
            ruleStatus: activeAuthorRuleStatus(nomination),
        };
    }
    function authorDraftRuleStatus(nomination: any) {
        const statuses = cloneValue(activeAuthorRuleStatus(nomination));
        if (nomination.activeRuleCategory !== "article") return statuses;
        const content = nomination.contentExpansion;
        if (
            content?.enabled &&
            !content.legacy &&
            validationRuleDict[content.rule]
        ) {
            for (const code of CONTENT_EXPANSION_RULES) {
                if (statuses[code]) statuses[code].selected = false;
            }
            const rule = validationRuleDict[content.rule];
            statuses[content.rule] = {
                ...statuses[content.rule],
                selected: true,
                desc: String(content.choice ?? ""),
                ogDesc: rule.label,
                maxScore: rule.score,
                score: content.score,
            };
        }
        const quality = nomination.quality;
        if (
            quality?.enabled &&
            !quality.legacy &&
            !isHalfPointScore(quality.score)
        ) {
            QUALITY_RULES.slice(quality.fromIndex, quality.toIndex).forEach(
                (code, index) => {
                    const rule = validationRuleDict[code];
                    statuses[code] = {
                        ...statuses[code],
                        selected: true,
                        desc: rule.label,
                        ogDesc: rule.label,
                        maxScore: rule.score,
                        score: index === 0 ? quality.score : 0,
                    };
                },
            );
        }
        if (Array.isArray(nomination.activity?.rows)) {
            for (const code of ACTIVITY_RULES) statuses[code] = [];
            for (const row of nomination.activity.rows) {
                const rule = validationRuleDict[row?.rule];
                if (!rule || !ACTIVITY_RULES.includes(row.rule)) continue;
                const choice = String(row.choice ?? "");
                const code =
                    ACTIVITY_RULES.find(
                        (candidate) =>
                            candidate === choice.trim() ||
                            validationRuleDict[candidate].label ===
                                choice.trim(),
                    ) ?? row.rule;
                const canonical = validationRuleDict[code];
                statuses[code].push({
                    selected: Boolean(row.selected),
                    desc: choice,
                    ogDesc: canonical.label,
                    maxScore: canonical.score,
                    score: row.score,
                    pending: row.pending,
                });
            }
        }
        return statuses;
    }
    function articlePageNamePlaceholder(nomination: any): string {
        return nomination?.usesRecipientDefault
            ? String(nomination.originalArticleTitle ?? "").trim()
            : "";
    }
    function effectiveArticlePageName(nomination: any): string {
        return (
            String(nomination?.pageName ?? "").trim() ||
            articlePageNamePlaceholder(nomination)
        );
    }
    function mediaPageNamePlaceholder(nomination: any): string {
        return nomination?.usesRecipientDefault
            ? String(nomination.originalArticleTitle ?? "").trim()
            : "";
    }
    function effectiveMediaPageName(nomination: any): string {
        return (
            String(nomination?.media?.pageName ?? "").trim() ||
            mediaPageNamePlaceholder(nomination)
        );
    }
    function relatedPageNamePlaceholder(nomination: any): string {
        if (!nomination?.usesRecipientDefault) return "";
        const pageName = String(nomination.originalArticleTitle ?? "").trim();
        const normalized = pageName.replaceAll("_", " ");
        if (
            /^(?:WikiProject|維基專題|维基专题):ACG\/(?:維基ACG專題獎|维基ACG专题奖)(?:\/|$)/iu.test(
                normalized,
            )
        )
            return "";
        return pageName;
    }
    function effectiveOtherPageName(nomination: any): string {
        return (
            String(nomination?.otherPageName ?? "").trim() ||
            relatedPageNamePlaceholder(nomination)
        );
    }
    function recipientPlaceholder(nomination: any): string {
        if (!nomination?.usesRecipientDefault) return "";
        const currentUser = String(nomination.recipientDefault ?? "").trim();
        const articleTitle = String(
            nomination.originalArticleTitle ?? "",
        ).trim();
        if (
            nomination.activeRuleCategory === "article" &&
            articleTitle &&
            effectiveArticlePageName(nomination) === articleTitle
        )
            return (
                String(nomination.articleRecipientDefault ?? "").trim() ||
                currentUser
            );
        return currentUser;
    }
    function effectiveRecipient(nomination: any): string {
        return (
            String(nomination?.awarder ?? "").trim() ||
            recipientPlaceholder(nomination)
        );
    }
    /**
     * 找出作者表單第一個錯誤所在的規則類別。
     * @param nomination 提名草稿。
     * @returns 規則類別名稱。
     */
    function authorErrorRuleCategory(nomination: any): string {
        if (nomination.errors?.media) return "media";
        if (nomination.errors?.other) return "other";
        if (nomination.errors?.pageName) {
            const selectedCategory = nomination.activeRuleCategory;
            return ["article", "review"].includes(selectedCategory)
                ? selectedCategory
                : "article";
        }
        return AUTHOR_RULE_CATEGORIES.has(nomination.activeRuleCategory)
            ? nomination.activeRuleCategory
            : "article";
    }
    function makeAuthorNomination(
        nomData: any,
        ruleNames: string[],
        ruleDict: Record<string, NominationRule>,
    ) {
        const isNew = nomData == null;
        const sourceState = editableSourceState(nomData);
        let sourceRuleStatus = nomData?.ruleStatus || {};
        if (nomData && own(nomData, "reasonParse")) {
            if (!nomData.reasonParse?.ok) {
                sourceState.sourceOnly = true;
                sourceState.sourceError = parseErrorLabel(
                    nomData.reasonParse?.error,
                );
                sourceRuleStatus = {};
            } else {
                const tokens = nomData.reasonParse.tokens;
                const unsupportedReview = tokens.find(
                    (token: any) =>
                        token.code.startsWith("5") &&
                        (classifyRule5Code(token.code) === null ||
                            token.pending),
                );
                let authorTokens;
                if (unsupportedReview) {
                    sourceState.rule5Unresolved = true;
                    sourceState.sourceError = parseErrorLabel({
                        code: unsupportedReview.pending
                            ? "pending-rule-5-not-editable"
                            : "unrecognized-rule5-code",
                    });
                    authorTokens = tokens.filter(
                        (token: any) => classifyRule5Code(token.code) === null,
                    );
                } else {
                    authorTokens = tokens.map((token: any) => {
                        const variant = classifyRule5Code(token.code);
                        if (variant?.kind !== "complete" || !variant.quick)
                            return token;
                        // Legacy quick-complete aliases use a supported 5x
                        // code with the equivalent explicit total score.
                        return {
                            ...token,
                            code: reviewCode("complete", variant.tier, false),
                            scoreOverride:
                                token.scoreOverride ??
                                getReviewDefaultScore(
                                    "complete",
                                    variant.tier,
                                    false,
                                    ruleDict,
                                ) / 2,
                        };
                    });
                }
                const mapped: any = ruleStatusFromTokens(
                    authorTokens,
                    ruleDict,
                );
                if (!mapped.ok) {
                    sourceState.sourceOnly = true;
                    sourceState.rule5Unresolved = false;
                    sourceState.sourceError = parseErrorLabel(mapped.error);
                    sourceRuleStatus = {};
                } else {
                    sourceRuleStatus = mapped.ruleStatus;
                }
            }
        }
        const grouping = validateNominationGroup({
            ruleStatus: sourceRuleStatus,
        });
        if (!grouping.ok) {
            sourceState.sourceOnly = true;
            sourceState.sourceError = grouping.error.code;
        }
        const ruleStatus = hydrateRuleStatus(
            sourceRuleStatus,
            ruleNames,
            ruleDict,
            true,
        );
        const contentExpansion = getContentExpansionDraft(ruleStatus, ruleDict);
        const quality = getQualityDraft(ruleStatus, ruleDict);
        const activity = getActivityDraft(ruleStatus, ruleDict, {
            seedDefaults: isNew,
        });
        if (contentExpansion.legacy) {
            sourceState.sourceOnly = true;
            sourceState.sourceError ||= "unrepresentable-rule-1";
        }
        if (quality.legacy) {
            sourceState.sourceOnly = true;
            sourceState.sourceError ||= "unrepresentable-rule-2";
        }
        if (!validateActivityDraft(activity).ok) {
            sourceState.sourceOnly = true;
            sourceState.sourceError ||= "unrepresentable-rule-4";
        }
        let review: ReturnType<typeof getReviewDraft>;
        try {
            review = getReviewDraft(ruleStatus, ruleDict);
        } catch (error) {
            if (!nomData || !own(nomData, "reasonParse")) throw error;
            sourceState.rule5Unresolved = true;
            sourceState.sourceError =
                error instanceof Error ? error.message : String(error);
            for (const [rule, stored] of Object.entries(ruleStatus)) {
                if (!rule.startsWith("5")) continue;
                for (const status of Array.isArray(stored)
                    ? stored
                    : [stored]) {
                    if (status) status.selected = false;
                }
            }
            review = getReviewDraft(ruleStatus, ruleDict);
        }
        if (sourceState.sourceOnly) sourceState.rule5Unresolved = false;
        const storedPageName = String(
            nomData?.pageName ?? services.getPageName?.() ?? "",
        );
        const activeRuleCategory = initialRuleCategory(ruleStatus);
        if (isNew) {
            for (const rule of ["6", "7", "8"])
                ruleStatus[rule].selected = true;
            ruleStatus["6-fp"].selected = false;
        }
        const mediaSelected = Boolean(
            ruleStatus["6"]?.selected || ruleStatus["6-fp"]?.selected,
        );
        const recipientDefault = isNew
            ? String(services.getUserName() ?? "").trim()
            : "";
        return {
            id: `nomination-${instanceId}-${++nominationSequence}`,
            awarder: isNew ? "" : (nomData?.awarder ?? ""),
            usesRecipientDefault: isNew,
            recipientDefault,
            articleRecipientDefault: recipientDefault,
            originalArticleTitle: isNew ? storedPageName : "",
            pageName: isNew ? "" : storedPageName,
            media: {
                pageName: !isNew && mediaSelected ? storedPageName : "",
            },
            otherPageName:
                !isNew && ruleStatus["8"]?.selected && storedPageName !== "其他"
                    ? storedPageName
                    : "",
            ruleStatus,
            contentExpansion,
            quality,
            activity,
            review,
            activeRuleCategory,
            errors: {
                awarder: "",
                pageName: "",
                media: "",
                other: "",
                rules: "",
            },
            validationIssues: [] as string[],
            ...sourceState,
        };
    }
    function makeCheckNomination(
        nomData: any,
        ruleNames: string[],
        ruleDict: Record<string, NominationRule>,
    ) {
        const sourceState = editableSourceState(nomData);
        let ruleStatus = {};
        let ruleTokens = null;
        let submittedReason = "";
        if (own(nomData, "reasonParse")) {
            if (!nomData.reasonParse?.ok) {
                sourceState.sourceOnly = true;
                sourceState.sourceError = parseErrorLabel(
                    nomData.reasonParse?.error,
                );
            } else {
                const checkTokens = [];
                for (const token of nomData.reasonParse.tokens) {
                    if (own(ruleDict, token.code)) {
                        checkTokens.push(token);
                        continue;
                    }
                    const reviewMapping: any = decomposeRule5Tokens(
                        [token],
                        ruleDict,
                    );
                    if (
                        !reviewMapping.ok ||
                        reviewMapping.tokens.length === 0
                    ) {
                        sourceState.sourceOnly = true;
                        sourceState.sourceError = parseErrorLabel(
                            reviewMapping.error ?? {
                                code: "unknown-rule",
                                rule: token.code,
                            },
                        );
                        break;
                    }
                    checkTokens.push(...reviewMapping.tokens);
                }
                if (!sourceState.sourceOnly) {
                    ruleTokens = checkTokens.map((token) =>
                        checkTokenRow(token, ruleDict),
                    );
                    submittedReason = nomData.requestReasonText ?? "";
                }
            }
        } else {
            ruleStatus = hydrateRuleStatus(
                nomData.ruleStatus,
                ruleNames,
                ruleDict,
                false,
            );
            const submitted = serializeNominationReason(ruleStatus, ruleNames);
            submittedReason = submitted.ok ? submitted.reasonText : "";
            for (const { status } of allRuleOccurrences(ruleStatus))
                status.selected = true;
        }
        const grouping = validateNominationGroup({ ruleStatus, ruleTokens });
        if (!grouping.ok) {
            sourceState.sourceOnly = true;
            sourceState.sourceError = grouping.error.code;
        }
        return {
            activeRuleCategory: grouping.ok
                ? (grouping.category ?? "article")
                : "article",
            id: `nomination-${instanceId}-${++nominationSequence}`,
            awarder: nomData.awarder ?? "",
            pageName: nomData.pageName ?? "",
            ruleStatus,
            ruleTokens,
            requestReasonText: nomData.requestReasonText ?? submittedReason,
            replaceRequestReason: false,
            message: "",
            ...sourceState,
        };
    }
    function makeCheckReasonDraft(
        nomData: any,
        ruleNames: string[],
        ruleDict: Record<string, NominationRule>,
    ) {
        return makeAuthorNomination(
            {
                awarder: nomData?.awarder ?? "",
                pageName: nomData?.pageName ?? "",
                ruleStatus: {},
            },
            ruleNames,
            ruleDict,
        );
    }
    function editableCheckTokens(nomination: any, ruleNames: string[]) {
        if (!Array.isArray(nomination.ruleTokens)) {
            nomination.ruleTokens = getOrderedRuleStatus(
                ruleNames,
                nomination.ruleStatus,
            ).map(({ rule, status }) => ({
                ...cloneValue(status),
                code: rule,
            }));
        }
        return nomination.ruleTokens;
    }
    function selectedActiveRuleStatus(nomination: any) {
        const selected: Record<string, any> = {};
        for (const [rule, source] of Object.entries(
            activeAuthorRuleStatus(nomination),
        )) {
            const occurrences = (Array.isArray(source) ? source : [source])
                .filter((status) => status?.selected)
                .map(cloneValue);
            if (occurrences.length === 0) continue;
            selected[rule] = Array.isArray(source)
                ? occurrences
                : occurrences[0];
        }
        return selected;
    }
    function nominationPayload(nomination: any, check = false) {
        const sourceRuleStatus = check
            ? nomination.ruleStatus
            : activeAuthorRuleStatus(nomination);
        const ruleStatus: Record<string, any> = {};
        for (const [rule, source] of Object.entries(sourceRuleStatus)) {
            const occurrences = Array.isArray(source) ? source : [source];
            const normalized = occurrences.map((item) => {
                const status = cloneValue(item);
                if (check) delete status.pending;
                status.score = editableNumber(status.score);
                return status;
            });
            ruleStatus[rule] = Array.isArray(source)
                ? normalized
                : normalized[0];
        }
        const payload: any = {
            awarder: check
                ? nomination.awarder
                : effectiveRecipient(nomination),
            pageName: check
                ? nomination.pageName
                : resolveAuthorTarget(
                      activeAuthorNomination(nomination),
                      "他薦",
                  ).pageName,
            ruleStatus,
        };
        if (check) {
            payload.message = nomination.message || "";
            payload.requestReasonText = nomination.requestReasonText || "";
            if (nomination.replaceRequestReason === true)
                payload.replaceRequestReason = true;
            if (Array.isArray(nomination.ruleTokens)) {
                payload.ruleTokens = nomination.ruleTokens.map(
                    (token: any) => ({
                        ...cloneValue(token),
                        selected: Boolean(token.selected),
                        score: editableNumber(token.score),
                    }),
                );
            }
        }
        return payload;
    }
    function scoreValidationIssues(item: string, value: any): string[] {
        const score = editableNumber(value);
        if (!Number.isFinite(score))
            return [msg("scoring_item_score_invalid", { item })];
        const issues = [];
        if (score < 0)
            issues.push(msg("scoring_item_score_negative", { item }));
        if (!isHalfPointScore(Math.abs(score)))
            issues.push(msg("scoring_item_score_not_half_point", { item }));
        return issues;
    }
    function authorRuleIssues(nomination: any): string[] {
        const statuses = authorDraftRuleStatus(nomination);
        const selected = getOrderedRuleStatus(
            validationRuleNames,
            statuses,
        ).filter(({ status }: any) => status?.selected);
        const issues: string[] = [];
        const article = nomination.activeRuleCategory === "article";
        if (selected.length === 0)
            issues.push(msg("select_at_least_one_scoring_rule"));
        const review =
            nomination.activeRuleCategory === "review"
                ? nomination.review
                : null;
        const reviewRows = review
            ? review.mode === "complete"
                ? [["complete", review.complete]]
                : review.mode === "aspects"
                  ? REVIEW_ASPECT_ROWS.map((row) => [row, review.aspects[row]])
                  : [["general", review.general]]
            : [];
        if (reviewRows.length) {
            const order = new Map(
                reviewRows.map(([row, draft], index) => [
                    reviewCode(row, draft.tier, draft.quick),
                    index,
                ]),
            );
            selected.sort(
                (left, right) =>
                    (order.get(left.rule) ?? reviewRows.length) -
                    (order.get(right.rule) ?? reviewRows.length),
            );
        }
        const missingReviewDescriptions = new Set(
            reviewRows
                .filter(
                    ([, row]) =>
                        row?.selected &&
                        row.description !== undefined &&
                        String(row.description).trim() === "",
                )
                .map(([row, draft]) =>
                    reviewCode(row, draft.tier, draft.quick),
                ),
        );
        let qualityHandled = false;
        for (const { rule, status: rawStatus } of selected) {
            const status = rawStatus as any;
            if (
                article &&
                ACTIVITY_RULES.includes(rule) &&
                Array.isArray(nomination.activity?.rows)
            )
                continue;
            const item =
                String(status.desc ?? "").trim() ||
                validationRuleDict[rule]?.label ||
                rule;
            if (
                article &&
                nomination.contentExpansion?.enabled &&
                rule === nomination.contentExpansion.rule &&
                String(nomination.contentExpansion.choice ?? "").trim() === ""
            )
                issues.push(
                    msg("enter_an_expansion_type_or_custom_description"),
                );
            if (missingReviewDescriptions.has(rule))
                issues.push(msg("scoring_item_description_required", { item }));
            if (
                article &&
                rule === "3" &&
                ![...CONTENT_EXPANSION_RULES, ...QUALITY_RULES].some(
                    (code) => statuses[code]?.selected,
                )
            )
                issues.push(
                    msg(
                        "formatting_must_be_selected_with_content_expansion_or_quality_improvement",
                    ),
                );
            if (
                article &&
                QUALITY_RULES.includes(rule) &&
                nomination.quality?.enabled &&
                !nomination.quality.legacy
            ) {
                if (!qualityHandled)
                    issues.push(
                        ...scoreValidationIssues(
                            msg("total_quality_improvement_score"),
                            nomination.quality.score,
                        ),
                    );
                qualityHandled = true;
            } else issues.push(...scoreValidationIssues(item, status.score));
        }
        if (article) {
            const activity = nomination.activity;
            if (Array.isArray(activity?.rows)) {
                for (const [index, row] of activity.rows.entries()) {
                    const label =
                        validationRuleDict[row?.rule]?.label || msg("activity");
                    const item = `${String(row?.choice ?? "").trim() || label} ${index + 1}`;
                    if (String(row?.choice ?? "").trim() === "")
                        issues.push(
                            msg("scoring_item_description_required", { item }),
                        );
                    issues.push(...scoreValidationIssues(item, row?.score));
                }
            }
            const validation = validateActivityDraft(activity);
            if (
                !validation.ok &&
                !["invalid-choice", "invalid-score"].includes(validation.code!)
            )
                issues.push(
                    msg(
                        "activity_descriptions_and_scores_must_be_valid_scores_must_be",
                    ),
                );
        }
        const scores = selected.map(({ status }: any) =>
            editableNumber(status.score),
        );
        if (
            scores.every(Number.isFinite) &&
            scores.reduce((total, score) => total + score, 0) <= 0
        )
            issues.push(msg("nomination_score_must_be_positive"));
        return issues;
    }
    function authorRulesError(nomination: any) {
        return authorRuleIssues(nomination).join("\n");
    }
    type AuthorIssue = {
        field: "awarder" | "pageName" | "media" | "other" | "rules";
        message: string;
    };
    function collectAuthorValidationIssues(nomination: any): AuthorIssue[] {
        const issues: AuthorIssue[] = [];
        if (effectiveRecipient(nomination) === "")
            issues.push({
                field: "awarder",
                message: msg("enter_the_recipient"),
            });
        const target = resolveAuthorTarget(
            activeAuthorNomination(nomination),
            "他薦",
        );
        if (!target.ok) {
            const field = [
                "ambiguous-media-target",
                "missing-media-target",
            ].includes(target.code)
                ? "media"
                : target.code === "missing-author-category"
                  ? "rules"
                  : "pageName";
            issues.push({
                field,
                message:
                    target.code === "ambiguous-media-target"
                        ? msg("enter_only_one_page_name")
                        : authorTargetErrorMessage(target),
            });
        }
        issues.push(
            ...authorRuleIssues(nomination).map((message) => ({
                field: "rules" as const,
                message,
            })),
        );
        return issues;
    }
    function applyAuthorIssues(nomination: any, issues: AuthorIssue[]) {
        nomination.errors = {
            awarder: "",
            pageName: "",
            media: "",
            other: "",
            rules: "",
        };
        for (const { field, message } of issues)
            nomination.errors[field] +=
                `${nomination.errors[field] ? "\n" : ""}${message}`;
        nomination.validationIssues = issues.map(({ message }) => message);
    }
    function authorRulesValidation(nomination: any) {
        const issues = authorRuleIssues(nomination).map((message) => ({
            field: "rules" as const,
            message,
        }));
        applyAuthorIssues(nomination, issues);
        return issues.length === 0;
    }
    function authorValidation(nominations: any[]) {
        let firstInvalid = null;
        for (const nomination of nominations) {
            const issues = collectAuthorValidationIssues(nomination);
            applyAuthorIssues(nomination, issues);
            if (!firstInvalid && issues.length) firstInvalid = nomination;
        }
        return firstInvalid;
    }
    function checkValidation(nomination: any) {
        if (!validateNominationGroup(nomination).ok) {
            return msg(
                "each_nomination_may_use_only_one_rule_category_repair_the",
            );
        }
        const statuses = Array.isArray(nomination.ruleTokens)
            ? nomination.ruleTokens
            : allRuleOccurrences(nomination.ruleStatus).map(
                  ({ status }) => status,
              );
        if (!statuses.some((status: any) => status?.selected)) return "";
        const invalid = statuses.some(
            (status: any) => !isHalfPointScore(status?.score),
        );
        return invalid
            ? msg("all_check_scores_must_be_nonnegative_multiples_of_0_5")
            : "";
    }
    return {
        authorTargetErrorMessage,
        authorCodePreviewResult,
        checkCodePreviewResult,
        cloneValue,
        editableSourceValues,
        editableSourceState,
        editableNumber,
        displayNumber,
        isHalfPointScore,
        isEditablePendingRule,
        hydrateRuleStatus,
        own,
        tokenStatus,
        replaceRule5Tokens,
        validateAuthorTokenShape,
        ruleStatusFromTokens,
        checkTokenRow,
        parseErrorLabel,
        authorRuleCategory,
        initialRuleCategory,
        activeAuthorRuleStatus,
        activeAuthorNomination,
        recipientPlaceholder,
        effectiveRecipient,
        articlePageNamePlaceholder,
        effectiveArticlePageName,
        mediaPageNamePlaceholder,
        effectiveMediaPageName,
        relatedPageNamePlaceholder,
        effectiveOtherPageName,
        authorErrorRuleCategory,
        makeAuthorNomination,
        makeCheckNomination,
        makeCheckReasonDraft,
        editableCheckTokens,
        selectedActiveRuleStatus,
        nominationPayload,
        authorRulesError,
        collectAuthorValidationIssues,
        authorRulesValidation,
        authorValidation,
        checkValidation,
    };
}
export type NominationModel = ReturnType<typeof createNominationModel>;
