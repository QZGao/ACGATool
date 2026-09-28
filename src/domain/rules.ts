import {
    RULE_GROUPS,
    canonicalRuleMessage,
    type RuleTranslator,
} from "./rule-metadata.ts";
export type { RuleTranslator } from "./rule-metadata.ts";

export type NominationRule = {
    rule: string;
    label: string;
    score: number;
};

export type NominationRuleGroup = {
    section: "article" | "review" | "other";
    type:
        | "content"
        | "quality"
        | "format"
        | "activity"
        | "review"
        | "media"
        | "recommendation"
        | "other";
    group: string;
    rules: NominationRule[];
    explanation: string;
};

/** Create rule metadata using canonical defaults or an injected catalog translator. */
export function NominationRules(
    msg: RuleTranslator = canonicalRuleMessage,
): NominationRuleGroup[] {
    return RULE_GROUPS.map((group) => ({
        section: group.section,
        type: group.type,
        group: msg(group.groupKey),
        explanation: group.explanationKey ? msg(group.explanationKey) : "",
        rules: group.rules.map((rule) => ({
            rule: rule.rule,
            label: msg(rule.labelKey),
            score: rule.score,
        })),
    }));
}

/**
 * 提名規則別名。
 * @returns 包含別名的對象。
 */
export function NominationRuleAliases(): any {
    return {
        "2a": "2-c",
        c: "2-c",
        "2b": "2-b",
        b: "2-b",
        "2c": "2-ga",
        ga: "2-ga",
        "2d": "2-fa",
        fa: "2-fa",
        "4a": "4-dyk",
        dyk: "4-dyk",
        "4p": "4-req",
        "4p-game": "4-req-game",
        "4p-ac": "4-req-ac",
        fp: "6-fp",
    };
}

/**
 * 提名規則集合。
 * @returns 包含規則名稱和規則對象的對象。
 */
export function NominationRuleSet(translate?: RuleTranslator): {
    ruleNames: string[];
    ruleDict: Record<string, NominationRule>;
} {
    const ruleNames: string[] = [];
    const ruleDict: Record<string, NominationRule> = {};
    for (const ruleGroup of NominationRules(translate)) {
        for (const ruleSet of ruleGroup.rules) {
            ruleNames.push(ruleSet.rule);
            ruleDict[ruleSet.rule] = ruleSet;
        }
    }
    return {
        ruleNames: ruleNames,
        ruleDict: ruleDict,
    };
}

/**
 * 獲取排序後的規則狀態。
 * @param ruleNames 即 NominationRuleSet().ruleNames。
 * @param ruleStatus 規則狀態對象。
 * @returns 排序後的規則實例。
 */
export function getOrderedRuleStatus(
    ruleNames: string[],
    ruleStatus: Record<string, any>,
): Array<{ rule: string; status: object; occurrence: number; key: string }> {
    return getOrderedRuleOccurrences(ruleNames, ruleStatus);
}

/**
 * 生成提名理由。
 * @param ruleStatus
 * @param check
 */
export function generateReason(
    ruleStatus: Record<string, any>,
    check = false,
): any {
    const { ruleNames } = NominationRuleSet();
    const serialized = serializeNominationReason(ruleStatus, ruleNames, {
        includeUnselected: check,
        includePending: !check,
    });
    if (!serialized.ok) {
        return null;
    }
    if (check) {
        return {
            reasonText: serialized.reasonText,
            unselectedReasonText: serialized.unselectedReasonText,
            reasonScore: serialized.reasonScore,
        };
    }
    return serialized.reasonText;
}

const ENCODED_DESCRIPTION_CHARACTERS = new Map([
    ["|", "&#124;"],
    ["(", "&#40;"],
    [")", "&#41;"],
    ["[", "&#91;"],
    ["]", "&#93;"],
]);

/**
 * 尋找從指定位置開始的完整、非巢狀內部連結。
 *
 * @param value 要掃描的文字。
 * @param start 預期指向 `[[` 的位置。
 * @returns 連結結尾後的位置；不是完整連結時回傳 -1。
 */
export function findReasonWikilinkEnd(value: string, start: number): number {
    if (value.slice(start, start + 2) !== "[[") return -1;

    for (let index = start + 2; index < value.length - 1; index++) {
        const pair = value.slice(index, index + 2);
        if (pair === "[[") return -1;
        if (pair === "]]") {
            const target = value
                .slice(start + 2, index)
                .split("|", 1)[0]
                .trim();
            return target === "" ? -1 : index + 2;
        }
    }
    return -1;
}

function findMalformedWikilinkBoundary(value: any, start: number) {
    let depth = 0;
    for (let index = start; index < value.length - 1; index++) {
        const pair = value.slice(index, index + 2);
        if (pair === "[[") {
            depth++;
            index++;
        } else if (pair === "]]") {
            depth--;
            if (depth === 0) return index + 2;
            index++;
        }
    }
    return value.length;
}

function encodePlainDescription(value: any) {
    let encoded = "";
    for (const character of value) {
        encoded += /\s/u.test(character)
            ? "&nbsp;"
            : (ENCODED_DESCRIPTION_CHARACTERS.get(character) ?? character);
    }
    return encoded;
}

/**
 * 將自訂規則描述中的空白與理由語法分隔字元轉為 HTML 實體，
 * 但完整、非巢狀的內部連結會原樣保留。
 * @param value 自訂規則描述。
 * @returns 可安全嵌入理由代碼的描述。
 */
export function encodeReasonDescription(value: any): string {
    const description = String(value ?? "");
    let encoded = "";

    for (let index = 0; index < description.length;) {
        const wikilinkEnd = findReasonWikilinkEnd(description, index);
        if (wikilinkEnd !== -1) {
            encoded += description.slice(index, wikilinkEnd);
            index = wikilinkEnd;
            continue;
        }

        if (description.slice(index, index + 2) === "[[") {
            const malformedEnd = findMalformedWikilinkBoundary(
                description,
                index,
            );
            encoded += encodePlainDescription(
                description.slice(index, malformedEnd),
            );
            index = malformedEnd;
            continue;
        }

        encoded += encodePlainDescription(description[index]);
        index++;
    }
    return encoded;
}

const DESCRIPTION_ENTITY_DECODERS: Array<[RegExp, string]> = [
    [/&nbsp;/giu, " "],
    [/&(?:vert|VerticalLine);/giu, "|"],
    [/&#(?:0*124|x0*7c);/giu, "|"],
    [/&#(?:0*40|x0*28);/giu, "("],
    [/&#(?:0*41|x0*29);/giu, ")"],
    [/&#(?:0*91|x0*5b);/giu, "["],
    [/&#(?:0*93|x0*5d);/giu, "]"],
];

/**
 * 將本工具產生的 HTML 實體還原為可編輯的自訂規則描述。
 * 同時接受既有資料可能使用的 `&vert;` 與十六進位數字實體。
 * @param value 已解析的描述修飾符。
 * @returns 還原後的描述。
 */
function decodeReasonDescription(value: any): string {
    let decoded = String(value ?? "");
    for (const [pattern, replacement] of DESCRIPTION_ENTITY_DECODERS) {
        decoded = decoded.replace(pattern, replacement);
    }
    return decoded;
}

const REQUEST_PREFIX = "{{ACG提名2/request|ver=1|";
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/gu;
const RULE_CODE_PATTERN = /^([0-9a-z]+(?:-[0-9a-z]+)*)([?？]?)(.*)$/iu;
const SCORE_PATTERN = /^\d+(?:\.\d+)?$/u;
const COMPLETE_REVIEW_PATTERN = /^5x(?:-(?:bcr|gan|acr|fac))?(?:-half)?$/u;

const REVIEW_ASPECTS: Readonly<Record<string, string>> = Object.freeze({
    a: "writing",
    b: "coverage",
    c: "source",
});

function parseFailure(rawReason: string, code: string, details = {}) {
    return {
        ok: false,
        error: { code, ...details },
        rawReason,
    };
}

function own(object: any, key: PropertyKey) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function strippedReason(reason: any) {
    if (typeof reason !== "string") {
        throw new TypeError("Nomination reason must be a string");
    }

    const stripped = reason.replace(HTML_COMMENT_PATTERN, "").trim();
    if (!stripped.startsWith(REQUEST_PREFIX))
        return { ok: true, rawReason: stripped };
    if (!stripped.endsWith("}}")) {
        return parseFailure(stripped, "invalid-wrapper");
    }
    return {
        ok: true,
        rawReason: stripped.slice(REQUEST_PREFIX.length, -2).trim(),
    };
}

function canonicalRuleCode(
    rawCode: string,
    ruleDict: Record<string, NominationRule>,
    aliases: Record<string, string>,
) {
    const lowerCode = rawCode.toLowerCase();
    const alias = own(aliases, lowerCode)
        ? String(aliases[lowerCode]).toLowerCase()
        : lowerCode;
    if (own(ruleDict, alias)) return alias;

    if (COMPLETE_REVIEW_PATTERN.test(alias) && alias.endsWith("-half")) {
        const completeCode = alias.slice(0, -"-half".length);
        if (own(ruleDict, completeCode)) return alias;
    }
    return null;
}

function parseScore(rawScore: any) {
    if (!SCORE_PATTERN.test(rawScore)) return null;
    const score = Number(rawScore);
    return Number.isFinite(score) && score >= 0 ? score : null;
}

function splitReasonTokenText(rawReason: string) {
    const tokens = [];
    let tokenStart = -1;

    for (let index = 0; index < rawReason.length;) {
        const wikilinkEnd = findReasonWikilinkEnd(rawReason, index);
        if (wikilinkEnd !== -1) {
            if (tokenStart === -1) tokenStart = index;
            index = wikilinkEnd;
            continue;
        }

        if (/\s/u.test(rawReason[index])) {
            if (tokenStart !== -1) {
                tokens.push(rawReason.slice(tokenStart, index));
                tokenStart = -1;
            }
        } else if (tokenStart === -1) {
            tokenStart = index;
        }
        index++;
    }

    if (tokenStart !== -1) tokens.push(rawReason.slice(tokenStart));
    return tokens;
}

function findModifierClosing(
    modifiers: string,
    start: number,
    closing: string,
) {
    for (let index = start + 1; index < modifiers.length;) {
        const wikilinkEnd = findReasonWikilinkEnd(modifiers, index);
        if (wikilinkEnd !== -1) {
            index = wikilinkEnd;
            continue;
        }
        if (modifiers[index] === closing) return index;
        index++;
    }
    return -1;
}

function parseRuleToken(
    rawToken: string,
    sourceIndex: number,
    ruleDict: Record<string, NominationRule>,
    aliases: Record<string, string>,
    rawReason: string,
) {
    const match = rawToken.match(RULE_CODE_PATTERN);
    if (!match) {
        return parseFailure(rawReason, "invalid-token", {
            sourceIndex,
            token: rawToken,
        });
    }

    const code = canonicalRuleCode(match[1], ruleDict, aliases);
    if (code === null) {
        return parseFailure(rawReason, "unknown-code", {
            sourceIndex,
            token: rawToken,
            rule: match[1].toLowerCase(),
        });
    }

    let cursor = 0;
    const modifiers = match[3];
    let comment = null;
    let scoreOverride = null;
    let sawComment = false;
    let sawScore = false;

    while (cursor < modifiers.length) {
        const opening = modifiers[cursor];
        if (opening === "(" || opening === "（") {
            if (sawComment) {
                return parseFailure(rawReason, "duplicate-comment", {
                    sourceIndex,
                    token: rawToken,
                });
            }
            const closing = opening === "(" ? ")" : "）";
            const closingIndex = findModifierClosing(
                modifiers,
                cursor,
                closing,
            );
            if (closingIndex === -1) {
                return parseFailure(rawReason, "invalid-comment", {
                    sourceIndex,
                    token: rawToken,
                });
            }
            comment = decodeReasonDescription(
                modifiers.slice(cursor + 1, closingIndex),
            );
            if (comment === "") {
                return parseFailure(rawReason, "empty-comment", {
                    sourceIndex,
                    token: rawToken,
                });
            }
            sawComment = true;
            cursor = closingIndex + 1;
            continue;
        }

        if (opening === "[") {
            if (sawScore) {
                return parseFailure(rawReason, "duplicate-score", {
                    sourceIndex,
                    token: rawToken,
                });
            }
            const closingIndex = findModifierClosing(modifiers, cursor, "]");
            if (closingIndex === -1) {
                return parseFailure(rawReason, "invalid-score", {
                    sourceIndex,
                    token: rawToken,
                });
            }
            const rawScore = modifiers.slice(cursor + 1, closingIndex);
            scoreOverride = parseScore(rawScore);
            if (scoreOverride === null) {
                return parseFailure(rawReason, "invalid-score", {
                    sourceIndex,
                    token: rawToken,
                    score: rawScore,
                });
            }
            sawScore = true;
            cursor = closingIndex + 1;
            continue;
        }

        return parseFailure(rawReason, "invalid-modifier", {
            sourceIndex,
            token: rawToken,
        });
    }

    return {
        ok: true,
        token: {
            code,
            pending: match[2] !== "",
            comment,
            scoreOverride,
            sourceIndex,
        },
    };
}

/**
 * 將提名理由解析為保持順序及重複實例的規則詞元。
 * 除完整且非巢狀的內部連結外，空白均視為詞元分隔符。
 * 語法錯誤會與正規化後的內層理由一併回傳。
 *
 * @param reason 原始代碼或完整的 ACG提名2/request 模板。
 * @param ruleDict 標準規則字典。
 * @param aliases 小寫別名至標準代碼的對照表。
 */
export function parseReasonTokens(
    reason: string,
    ruleDict: Record<string, any>,
    aliases: Record<string, string> = {},
): any {
    if (!ruleDict || typeof ruleDict !== "object" || Array.isArray(ruleDict)) {
        throw new TypeError("Rule dictionary must be an object");
    }
    if (!aliases || typeof aliases !== "object" || Array.isArray(aliases)) {
        throw new TypeError("Rule aliases must be an object");
    }

    const normalized = strippedReason(reason);
    if (!normalized.ok) return normalized;
    const { rawReason } = normalized;
    if (rawReason === "") return { ok: true, tokens: [] };

    const rawTokens = splitReasonTokenText(rawReason);
    const tokens = [];
    for (let sourceIndex = 0; sourceIndex < rawTokens.length; sourceIndex++) {
        const parsed: any = parseRuleToken(
            rawTokens[sourceIndex],
            sourceIndex,
            ruleDict,
            aliases,
            rawReason,
        );
        if (!parsed.ok) return parsed;
        tokens.push(parsed.token);
    }
    return { ok: true, tokens };
}

function reviewSpecialistCode(
    aspectLetter: string,
    tier: string,
    quick: boolean,
) {
    return `5${aspectLetter}${tier === "none" ? "" : `-${tier}`}${quick ? "-half" : ""}`;
}

/**
 * 為精簡編輯器分類一個標準規則五代碼。
 *
 * @param code 標準規則代碼。
 */
export function classifyRule5Code(code: string): {
    kind: "general" | "specialist" | "complete";
    aspect: string | null;
    tier: string;
    quick: boolean;
} | null {
    if (typeof code !== "string")
        throw new TypeError("Rule code must be a string");
    const match = code
        .toLowerCase()
        .match(/^5([abcx]?)(?:-(bcr|gan|acr|fac))?(-half)?$/u);
    if (!match) return null;

    const discriminator = match[1];
    return {
        kind:
            discriminator === "x"
                ? "complete"
                : discriminator === ""
                  ? "general"
                  : "specialist",
        aspect: REVIEW_ASPECTS[discriminator] ?? null,
        tier: match[2] ?? "none",
        quick: match[3] !== undefined,
    };
}

function mappingFailure(code: string, token: any, details = {}) {
    return {
        ok: false,
        error: {
            code,
            sourceIndex: token?.sourceIndex,
            rule: token?.code,
            ...details,
        },
    };
}

function expandCompleteReviewToken(
    token: any,
    variant: any,
    ruleDict: Record<string, NominationRule>,
) {
    const completeDefaults =
        ruleDict[token.code] ??
        (variant.quick ? ruleDict[token.code.slice(0, -"-half".length)] : null);
    const expandedComment =
        token.comment !== null &&
        token.comment === String(completeDefaults?.label)
            ? null
            : token.comment;
    const aspectEntries = Object.entries(REVIEW_ASPECTS);
    const expanded = aspectEntries.map(([letter, aspect]) => {
        const code = reviewSpecialistCode(letter, variant.tier, variant.quick);
        const defaults = ruleDict[code];
        if (!defaults) {
            throw new TypeError(`Rule dictionary is missing ${code}`);
        }
        const defaultScore = Number(defaults.score);
        if (!Number.isFinite(defaultScore) || defaultScore < 0) {
            throw new TypeError(`Rule ${code} has an invalid default score`);
        }
        return {
            aspect,
            defaultScore,
            token: {
                code,
                pending: token.pending,
                comment: expandedComment,
                scoreOverride: null as number | null,
                sourceIndex: token.sourceIndex,
            },
        };
    });

    if (token.scoreOverride !== null) {
        const scorePerAspect = token.scoreOverride / expanded.length;
        if (
            !Number.isFinite(scorePerAspect) ||
            scorePerAspect < 0 ||
            !Number.isInteger(scorePerAspect * 2)
        ) {
            return mappingFailure(
                "unrepresentable-explicit-total-score",
                token,
                {
                    score: token.scoreOverride,
                    scorePerAspect,
                },
            );
        }
        for (const item of expanded) {
            item.token.scoreOverride =
                scorePerAspect === item.defaultScore ? null : scorePerAspect;
        }
    }
    return { ok: true, expanded };
}

/**
 * 將規則五詞元映射至精簡編輯器的一般／分項格式。完整的 `5x` 變體
 * 是僅供解析器使用的簡寫，會轉換成等級、快速標記、註解及待定標記
 * 均相同的文筆、覆蓋及來源變體。若轉換後每個分項分數都是非負的
 * 0.5 倍數，明確指定的完整評審總分會平均分配；其他總分無法表示。
 *
 * @param tokens 依序排列的 RuleToken 值（忽略其他規則）。
 * @param ruleDict 標準規則字典。
 */
export function decomposeRule5Tokens(
    tokens: Array<any>,
    ruleDict: Record<string, any>,
): any {
    if (!Array.isArray(tokens))
        throw new TypeError("Rule tokens must be an array");
    if (!ruleDict || typeof ruleDict !== "object" || Array.isArray(ruleDict)) {
        throw new TypeError("Rule dictionary must be an object");
    }

    let general: any = null;
    const aspects: Record<string, any> = {};
    const mappedTokens: any[] = [];

    const addGeneral = (token: any) => {
        if (general !== null) return mappingFailure("duplicate-general", token);
        if (Object.keys(aspects).length !== 0) {
            return mappingFailure("mixed-general-specialist", token);
        }
        general = { ...token };
        mappedTokens.push(general);
        return { ok: true };
    };

    const addSpecialist = (aspect: any, token: any) => {
        if (general !== null)
            return mappingFailure("mixed-general-specialist", token);
        if (own(aspects, aspect)) {
            return mappingFailure("duplicate-specialist", token, { aspect });
        }
        aspects[aspect] = { ...token };
        mappedTokens.push(aspects[aspect]);
        return { ok: true };
    };

    for (const token of tokens) {
        if (!token || typeof token.code !== "string") {
            throw new TypeError("Every rule token must have a code");
        }
        const variant = classifyRule5Code(token.code);
        if (variant === null) {
            if (token.code.startsWith("5")) {
                return mappingFailure("unrecognized-rule5-code", token);
            }
            continue;
        }

        if (variant.kind === "general") {
            const added = addGeneral(token);
            if (!added.ok) return added;
            continue;
        }
        if (variant.kind === "specialist") {
            const added = addSpecialist(variant.aspect, token);
            if (!added.ok) return added;
            continue;
        }

        const expansion: any = expandCompleteReviewToken(
            token,
            variant,
            ruleDict,
        );
        if (!expansion.ok) return expansion;
        for (const item of expansion.expanded) {
            const added = addSpecialist(item.aspect, item.token);
            if (!added.ok) return added;
        }
    }

    return {
        ok: true,
        mode:
            general !== null
                ? "general"
                : mappedTokens.length === 0
                  ? "none"
                  : "aspects",
        general,
        aspects,
        tokens: mappedTokens,
    };
}

function decimalScore(score: any) {
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0) {
        throw new TypeError(
            "Score override must be a finite nonnegative number or null",
        );
    }
    if (Object.is(score, -0)) return "0";

    const serialized = String(score);
    if (!/[eE]/u.test(serialized)) return serialized;

    const [coefficient, rawExponent] = serialized.toLowerCase().split("e");
    const exponent = Number(rawExponent);
    const digits = coefficient.replace(".", "");
    const decimalIndex =
        coefficient.indexOf(".") === -1
            ? coefficient.length + exponent
            : coefficient.indexOf(".") + exponent;
    if (decimalIndex <= 0) return `0.${"0".repeat(-decimalIndex)}${digits}`;
    if (decimalIndex >= digits.length)
        return `${digits}${"0".repeat(decimalIndex - digits.length)}`;
    return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function defaultsForCode(
    code: string,
    ruleDict: Record<string, NominationRule>,
) {
    if (own(ruleDict, code)) return ruleDict[code];
    const variant = classifyRule5Code(code);
    if (variant?.kind !== "complete" || !variant.quick) return null;

    const scores = Object.keys(REVIEW_ASPECTS).map((letter: any) => {
        const aspectCode = reviewSpecialistCode(letter, variant.tier, true);
        return Number(ruleDict[aspectCode]?.score);
    });
    if (scores.some((score: any) => !Number.isFinite(score) || score < 0))
        return null;
    return {
        label: ruleDict[code.slice(0, -"-half".length)]?.label,
        score: scores.reduce((total: any, score: any) => total + score, 0),
    };
}

/**
 * 序列化一個標準 RuleToken。描述及分數覆寫值與字典預設值相同時，
 * 會省略這些多餘內容。
 *
 * @param token 待序列化的 RuleToken。
 * @param ruleDict 標準規則字典。
 * @returns 標準理由詞元。
 */
export function serializeReasonToken(
    token: any,
    ruleDict: Record<string, any>,
): string {
    if (!token || typeof token !== "object" || typeof token.code !== "string") {
        throw new TypeError("Rule token must have a code");
    }
    const code = token.code.toLowerCase();
    const defaults = defaultsForCode(code, ruleDict);
    if (defaults === null)
        throw new TypeError(`Unknown canonical rule code: ${code}`);
    if (typeof token.pending !== "boolean") {
        throw new TypeError("Rule token pending state must be boolean");
    }

    let result = `${code}${token.pending ? "?" : ""}`;
    if (token.comment !== null) {
        if (typeof token.comment !== "string" || token.comment === "") {
            throw new TypeError(
                "Rule token comment must be a nonempty string or null",
            );
        }
        if (token.comment !== String(defaults.label)) {
            result += `(${encodeReasonDescription(token.comment)})`;
        }
    }

    if (token.scoreOverride !== null) {
        const score = decimalScore(token.scoreOverride);
        if (token.scoreOverride !== Number(defaults.score))
            result += `[${score}]`;
    }
    return result;
}

/**
 * 使用一個 ASCII 空格分隔並序列化依序排列的 RuleToken 值。
 *
 * @param tokens 依序排列的 RuleToken 值。
 * @param ruleDict 標準規則字典。
 * @returns 標準提名理由。
 */
export function serializeReasonTokens(
    tokens: Array<any>,
    ruleDict: Record<string, any>,
): string {
    if (!Array.isArray(tokens))
        throw new TypeError("Rule tokens must be an array");
    return tokens
        .map((token: any) => serializeReasonToken(token, ruleDict))
        .join(" ");
}

/**
 * 狀態以有序實例陣列表示的規則代碼。
 * 其他規則仍使用以代碼為鍵的單一狀態物件。
 */
export const REPEATABLE_RULES = Object.freeze([
    "4",
    "4-req",
    "4-dyk",
    "4-req-game",
    "4-req-ac",
]);

const REPEATABLE_RULE_SET = new Set(REPEATABLE_RULES);

export function isRepeatableRule(rule: string) {
    return REPEATABLE_RULE_SET.has(rule);
}

/**
 * 回傳規則的所有實例，且不修改其儲存形式。
 * 為相容舊有呼叫端及規則四支援重複項目之前建立的草稿，仍接受單一值。
 */
export function getRuleOccurrences(
    ruleStatus: Record<string, any>,
    rule: string,
) {
    const stored = ruleStatus?.[rule];
    if (stored == null) return [];
    return Array.isArray(stored) ? stored : [stored];
}

/**
 * 逐一取得所有已儲存狀態，包括驗證時不得靜默忽略的未知鍵。
 * 陣列項目會保留插入順序。
 */
export function allRuleOccurrences(ruleStatus: Record<string, any>) {
    const occurrences: Array<{
        rule: string;
        status: any;
        occurrence: number;
        key: string;
    }> = [];
    if (
        !ruleStatus ||
        typeof ruleStatus !== "object" ||
        Array.isArray(ruleStatus)
    )
        return occurrences;

    for (const [rule, stored] of Object.entries(ruleStatus)) {
        const statuses = Array.isArray(stored)
            ? stored
            : stored == null
              ? []
              : [stored];
        statuses.forEach((status: any, occurrence: number) => {
            occurrences.push({
                rule,
                status,
                occurrence,
                key: `${rule}:${occurrence}`,
            });
        });
    }
    return occurrences;
}

/**
 * 依標準規則代碼順序攤平狀態。同一代碼的重複實例會保留輸入或介面中的插入順序。
 */
export function getOrderedRuleOccurrences(
    ruleNames: string[],
    ruleStatus: Record<string, any>,
) {
    const occurrences: Array<{
        rule: string;
        status: any;
        occurrence: number;
        key: string;
    }> = [];
    for (const rule of ruleNames || []) {
        getRuleOccurrences(ruleStatus, rule).forEach(
            (status: any, occurrence: number) => {
                occurrences.push({
                    rule,
                    status,
                    occurrence,
                    key: `${rule}:${occurrence}`,
                });
            },
        );
    }
    return occurrences;
}

/**
 * 回傳淺層副本，其中規則四的值使用標準陣列形式。
 * 狀態物件本身會刻意保留，以維持 Vue 的響應性。
 */
export function normalizeRepeatableRules(
    ruleStatus: Record<string, any>,
    { includeMissing = false } = {},
) {
    const normalized =
        ruleStatus &&
        typeof ruleStatus === "object" &&
        !Array.isArray(ruleStatus)
            ? { ...ruleStatus }
            : {};

    for (const rule of REPEATABLE_RULES) {
        if (Object.prototype.hasOwnProperty.call(normalized, rule)) {
            const stored = normalized[rule];
            normalized[rule] =
                stored == null ? [] : Array.isArray(stored) ? stored : [stored];
        } else if (includeMissing) {
            normalized[rule] = [];
        }
    }
    return normalized;
}

export const CONTENT_EXPANSION_RULES = ["1a", "1b", "1c"];

export const QUALITY_LEVELS = [
    { value: "base", labelKey: "base" },
    { value: "c", labelKey: "c" },
    { value: "b", labelKey: "b" },
    { value: "ga", labelKey: "ga" },
    { value: "fa", labelKey: "fa" },
];

export const QUALITY_RULES = ["2-c", "2-b", "2-ga", "2-fa"];

export const ACTIVITY_RULES = ["4", "4-req", "4-dyk", "4-req-game", "4-req-ac"];
export const ACTIVITY_DEFAULT_RULES = ["4-dyk"];
export const ACTIVITY_ADDABLE_RULES = [...ACTIVITY_RULES];

export const REVIEW_TIERS = [
    { value: "none", suffix: "" },
    { value: "bcr", suffix: "-bcr" },
    { value: "gan", suffix: "-gan" },
    { value: "acr", suffix: "-acr" },
    { value: "fac", suffix: "-fac" },
];

export const REVIEW_ASPECT_ROWS = ["writing", "coverage", "source"];
export const REVIEW_ROWS = ["general", ...REVIEW_ASPECT_ROWS];
export const REVIEW_APPLY_MODE = Object.freeze({
    GENERAL: "general",
    ASPECTS: "aspects",
    COMPLETE: "complete",
});

const SCORE_SCALE = 2;
let activityRowSequence = 0;

/**
 * 建立內容擴充組合方塊的選項。
 * @param ruleDict 規則代碼對照表。
 * @returns Codex 組合方塊選項。
 */
export function getContentExpansionMenuItems(
    ruleDict: any,
): Array<{ label: string; value: string }> {
    return CONTENT_EXPANSION_RULES.map((rule: string) => ({
        label: String(ruleDict[rule].label),
        value: String(ruleDict[rule].label),
    }));
}

/**
 * 將既有規則一資料轉為單列內容擴充草稿。
 * 同時選取多個級別時無法由單列編輯器無損表示，因而保留給舊式規則
 * 編輯器處理。自訂分數則由單列中的分數輸入框表示。
 * @param ruleStatus 規則狀態。
 * @param ruleDict 規則代碼對照表。
 * @returns 內容擴充草稿。
 */
export function getContentExpansionDraft(ruleStatus: any, ruleDict: any): any {
    const selected = CONTENT_EXPANSION_RULES.map((rule: string) => ({
        rule,
        status: ruleStatus?.[rule],
    })).filter((item: any) => item.status?.selected);

    if (selected.length === 0) {
        const rule =
            CONTENT_EXPANSION_RULES[CONTENT_EXPANSION_RULES.length - 1];
        return {
            legacy: false,
            enabled: false,
            rule,
            choice: String(ruleDict[rule].label),
            score: Number(ruleDict[rule].score),
        };
    }
    if (selected.length !== 1) return { legacy: true };

    const { rule, status } = selected[0];
    const choice = status.desc == null ? "" : String(status.desc).trim();
    const score = Number(status.score);
    if (choice === "" || !Number.isFinite(score)) {
        return { legacy: true };
    }

    return { legacy: false, enabled: true, rule, choice, score };
}

function contentExpansionPresetRule(
    choice: any,
    ruleDict: Record<string, NominationRule>,
) {
    return (
        CONTENT_EXPANSION_RULES.find(
            (rule: string) =>
                choice === rule ||
                choice === String(ruleDict[rule].label).trim(),
        ) || null
    );
}

/**
 * 套用內容擴充組合方塊的目前文字。
 * 選擇不同的預設項目會切換標準規則並回復其預設分數；輸入自訂文字
 * 或重新套用同一級別時則沿用目前分數。尚未選擇級別時輸入自訂文字
 * 會以長擴充計分。
 * @param ruleStatus 規則狀態。
 * @param draft 由 {@link getContentExpansionDraft} 建立的草稿。
 * @param choice 組合方塊的目前文字。
 * @param ruleDict 規則代碼對照表。
 * @returns 已更新的草稿。
 */
export function applyContentExpansionChoice(
    ruleStatus: any,
    draft: any,
    choice: any,
    ruleDict: any,
): any {
    const normalizedChoice = String(choice ?? "").trim();
    const empty = normalizedChoice === "";
    const enabled = draft?.enabled !== false;
    const presetRule = contentExpansionPresetRule(normalizedChoice, ruleDict);
    const previousRule = CONTENT_EXPANSION_RULES.includes(draft?.rule)
        ? draft.rule
        : null;
    const selectedRule =
        presetRule ||
        previousRule ||
        CONTENT_EXPANSION_RULES[CONTENT_EXPANSION_RULES.length - 1];
    const description = presetRule
        ? String(ruleDict[presetRule].label)
        : normalizedChoice;
    const currentScore = Number(draft?.score);
    const selectedScore =
        selectedRule === previousRule && Number.isFinite(currentScore)
            ? currentScore
            : Number(ruleDict[selectedRule].score);

    for (const rule of CONTENT_EXPANSION_RULES) {
        const status = ensureRuleStatus(ruleStatus, rule, ruleDict);
        status.selected = enabled && !empty && rule === selectedRule;
        status.desc = status.selected ? description : ruleDict[rule].label;
        status.ogDesc = ruleDict[rule].label;
        status.score = status.selected ? selectedScore : ruleDict[rule].score;
        status.maxScore = ruleDict[rule].score;
    }

    Object.assign(draft, {
        legacy: false,
        enabled,
        rule: selectedRule,
        choice: empty ? "" : description,
        score: selectedScore,
    });
    return draft;
}

function isDefaultDescription(status: any, ruleSet: any) {
    return status.desc == null || status.desc === ruleSet.label;
}

function ensureRuleStatus(
    ruleStatus: Record<string, any>,
    rule: string,
    ruleDict: Record<string, NominationRule>,
) {
    const ruleSet = ruleDict[rule];
    if (!ruleStatus[rule]) {
        ruleStatus[rule] = {};
    }
    const status = ruleStatus[rule];
    status.selected = Boolean(status.selected);
    if (status.desc == null) status.desc = ruleSet.label;
    status.ogDesc = ruleSet.label;
    if (status.score == null) status.score = ruleSet.score;
    status.maxScore = ruleSet.score;
    delete status.pending;
    return status;
}

function activityChoiceRule(
    choice: any,
    ruleDict: Record<string, NominationRule>,
) {
    const normalized = String(choice ?? "").trim();
    return (
        ACTIVITY_RULES.find(
            (rule: string) =>
                normalized === rule || normalized === ruleDict[rule].label,
        ) || null
    );
}

function nextActivityRowId(usedIds: Set<string>) {
    let id;
    do {
        id = `activity-row-${++activityRowSequence}`;
    } while (usedIds.has(id));
    usedIds.add(id);
    return id;
}

function activityRowId(status: any, usedIds: Set<string>) {
    const existing = typeof status?.id === "string" ? status.id.trim() : "";
    if (existing !== "") {
        usedIds.add(existing);
        return existing;
    }
    return nextActivityRowId(usedIds);
}

function activityOccurrences(ruleStatus: Record<string, any>, rule: string) {
    const value = ruleStatus?.[rule];
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return [];

    return value.selected ? [value] : [];
}

function activityDraftRow(
    rule: string,
    status: any,
    ruleDict: Record<string, NominationRule>,
    usedIds: Set<string>,
) {
    const defaultDescription = ruleDict[rule].label;
    const choice = status?.choice ?? status?.desc ?? defaultDescription;
    return {
        id: activityRowId(status, usedIds),
        rule,
        selected: Boolean(status?.selected),
        choice: String(choice),
        score: status?.score == null ? ruleDict[rule].score : status.score,
        pending: Boolean(status?.pending),
    };
}

export function getActivityDraft(
    ruleStatus: Record<string, any>,
    ruleDict: Record<string, NominationRule>,
    { seedDefaults = false } = {},
) {
    const existingIds = new Set<string>();
    for (const rule of ACTIVITY_RULES) {
        for (const status of activityOccurrences(ruleStatus, rule)) {
            if (typeof status?.id === "string" && status.id.trim() !== "") {
                existingIds.add(status.id.trim());
            }
        }
    }

    const rows = [];
    const assignedIds = new Set(existingIds);
    const draftRuleOrder = [
        ...ACTIVITY_DEFAULT_RULES,
        ...ACTIVITY_RULES.filter(
            (rule: string) => !ACTIVITY_DEFAULT_RULES.includes(rule),
        ),
    ];
    for (const rule of draftRuleOrder) {
        const occurrences = activityOccurrences(ruleStatus, rule);
        if (
            seedDefaults &&
            occurrences.length === 0 &&
            ACTIVITY_DEFAULT_RULES.includes(rule)
        ) {
            rows.push(activityDraftRow(rule, null, ruleDict, assignedIds));
        } else {
            for (const status of occurrences) {
                rows.push(
                    activityDraftRow(rule, status, ruleDict, assignedIds),
                );
            }
        }
    }

    return { rows };
}

export function validateActivityDraft(draft: any) {
    if (!draft || !Array.isArray(draft.rows)) {
        return { ok: false, code: "invalid-rows", row: -1 };
    }

    const rowIds = new Set();

    for (let index = 0; index < draft.rows.length; index++) {
        const row = draft.rows[index];
        if (!row || typeof row !== "object") {
            return { ok: false, code: "invalid-row", row: index };
        }
        const id = typeof row.id === "string" ? row.id.trim() : "";
        if (id === "") return { ok: false, code: "invalid-id", row: index };
        if (rowIds.has(id))
            return { ok: false, code: "duplicate-id", row: index };
        rowIds.add(id);

        if (!ACTIVITY_RULES.includes(row.rule)) {
            return { ok: false, code: "invalid-rule", row: index };
        }

        const choice = String(row.choice ?? "").trim();
        if (choice === "") {
            return { ok: false, code: "invalid-choice", row: index };
        }

        const score = normalizeQualityScore(row.score);
        if (
            !Number.isFinite(score) ||
            score < 0 ||
            Number(row.score) !== score
        ) {
            return { ok: false, code: "invalid-score", row: index };
        }
    }

    return { ok: true };
}

export function addActivityDraftRow(
    draft: any,
    ruleDict: Record<string, NominationRule>,
) {
    if (!draft || !Array.isArray(draft.rows)) return null;
    const usedIds = new Set<string>(
        draft.rows
            .map((row: any) => row?.id)
            .filter((id: any) => typeof id === "string"),
    );
    const rule = "4";
    const row = {
        id: nextActivityRowId(usedIds),
        rule,
        selected: true,
        choice: ruleDict[rule].label,
        score: ruleDict[rule].score,
        pending: false,
    };
    draft.rows.push(row);
    return row;
}

export function applyActivityDraft(
    ruleStatus: Record<string, any>,
    draft: any,
    ruleDict: Record<string, NominationRule>,
) {
    const validation = validateActivityDraft(draft);
    if (!validation.ok) return validation;

    const grouped: Record<string, any[]> = Object.fromEntries(
        ACTIVITY_RULES.map((rule: string) => [rule, []]),
    );

    for (const row of draft.rows) {
        const choice = String(row.choice).trim();
        const selectedRule = activityChoiceRule(choice, ruleDict);
        const rule = selectedRule || row.rule;
        const description = selectedRule ? ruleDict[rule].label : choice;
        const score = normalizeQualityScore(row.score);
        grouped[rule].push({
            id: row.id.trim(),
            selected: Boolean(row.selected),
            desc: description,
            ogDesc: ruleDict[rule].label,
            score,
            maxScore: ruleDict[rule].score,
            ...(row.pending ? { pending: true } : {}),
        });
        row.rule = rule;
        row.selected = Boolean(row.selected);
        row.choice = description;
        row.score = score;
        row.pending = Boolean(row.pending);
    }
    for (const rule of ACTIVITY_RULES) ruleStatus[rule] = grouped[rule];
    return { ok: true };
}

export function normalizeQualityScore(score: any) {
    if (score == null || (typeof score === "string" && score.trim() === ""))
        return NaN;
    if (typeof score !== "number" && typeof score !== "string") return NaN;
    const numericScore = Number(score);
    if (!Number.isFinite(numericScore)) return NaN;
    const scaledScore = numericScore * SCORE_SCALE;
    if (!Number.isFinite(scaledScore)) return NaN;
    const roundingTolerance =
        Math.sign(scaledScore) * Number.EPSILON * Math.abs(scaledScore);
    const normalized =
        Math.round(scaledScore + roundingTolerance) / SCORE_SCALE;
    return Object.is(normalized, -0) ? 0 : normalized;
}

export function qualityTotal(
    fromIndex: number,
    toIndex: number,
    ruleDict: Record<string, NominationRule>,
) {
    let total = 0;
    for (let i = fromIndex; i < toIndex; i++) {
        total += ruleDict[QUALITY_RULES[i]].score;
    }
    return total;
}

/**
 * 依比例將品質提升的總分分配至跨越的各項規則。
 * 前段規則四捨五入至最接近的 0.5 分，剩餘半分單位分配給目標規則，
 * 使回傳值加總後等於正規化的總分。
 */
export function allocateQualityScore(
    fromIndex: number,
    toIndex: number,
    score: any,
    ruleDict: Record<string, NominationRule>,
) {
    const defaults = QUALITY_RULES.slice(fromIndex, toIndex).map(
        (rule: string) => ruleDict[rule].score,
    );
    if (defaults.length === 0) return [];

    const normalizedScore = normalizeQualityScore(score);
    if (!Number.isFinite(normalizedScore) || normalizedScore < 0) {
        return defaults
            .slice(0, -1)
            .map(() => 0)
            .concat(NaN);
    }

    const defaultTotal = defaults.reduce(
        (total: any, value: any) => total + value,
        0,
    );
    if (normalizedScore === defaultTotal) return defaults;

    const totalUnits = Math.round(normalizedScore * SCORE_SCALE);
    let allocatedUnits = 0;
    return defaults.map((defaultScore: any, index: any) => {
        if (index === defaults.length - 1) {
            return (totalUnits - allocatedUnits) / SCORE_SCALE;
        }
        const shareUnits =
            defaultTotal === 0
                ? 0
                : Math.round((totalUnits * defaultScore) / defaultTotal);
        allocatedUnits += shareUnits;
        return shareUnits / SCORE_SCALE;
    });
}

/**
 * 將既有規則二資料轉為品質提升草稿。
 * 未選取任何規則時以停用狀態表示；連續選取的規則則表示為啟用狀態。
 */
export function getQualityDraft(
    ruleStatus: Record<string, any>,
    ruleDict: Record<string, NominationRule>,
) {
    const selectedIndexes = QUALITY_RULES.map((rule: string, index: any) => ({
        rule,
        index,
        status: ruleStatus[rule],
    })).filter((item: any) => item.status && item.status.selected);

    if (selectedIndexes.length === 0) {
        return {
            legacy: false,
            enabled: false,
            fromIndex: 0,
            toIndex: 1,
            score: qualityTotal(0, 1, ruleDict),
        };
    }

    const first = selectedIndexes[0].index;
    const last = selectedIndexes[selectedIndexes.length - 1].index;
    const contiguous = selectedIndexes.length === last - first + 1;
    const actualScores = selectedIndexes.map((item: any) => {
        const score =
            item.status.score == null
                ? ruleDict[item.rule].score
                : Number(item.status.score);
        return score;
    });
    const validScores = actualScores.every(
        (score: any) =>
            Number.isFinite(score) &&
            score >= 0 &&
            normalizeQualityScore(score) === score,
    );
    const defaultDescriptions = selectedIndexes.every((item: any) =>
        isDefaultDescription(item.status, ruleDict[item.rule]),
    );
    const pendingStates = new Set(
        selectedIndexes.map((item: any) => Boolean(item.status.pending)),
    );

    if (
        !contiguous ||
        !validScores ||
        !defaultDescriptions ||
        pendingStates.size > 1
    ) {
        return { legacy: true };
    }

    const score = normalizeQualityScore(
        actualScores.reduce((total: any, value: any) => total + value, 0),
    );
    const expectedScores = allocateQualityScore(
        first,
        last + 1,
        score,
        ruleDict,
    );
    const proportional = actualScores.every(
        (value: any, index: any) => value === expectedScores[index],
    );
    if (!proportional) return { legacy: true };

    return {
        legacy: false,
        enabled: true,
        fromIndex: first,
        toIndex: last + 1,
        score,
        ...(pendingStates.has(true) ? { pending: true } : {}),
    };
}

/**
 * 套用品質提升草稿。
 * `enabled: false` 會清除所有規則二；舊草稿未提供 enabled 時仍視為啟用。
 */
export function applyQualityDraft(
    ruleStatus: Record<string, any>,
    draft: any,
    ruleDict: Record<string, NominationRule>,
) {
    const enabled = draft.enabled !== false;
    const fromIndex = enabled ? draft.fromIndex : 0;
    const toIndex = enabled ? draft.toIndex : 0;
    const score = !enabled
        ? 0
        : draft.score == null
          ? qualityTotal(fromIndex, toIndex, ruleDict)
          : normalizeQualityScore(draft.score);
    const allocatedScores = allocateQualityScore(
        fromIndex,
        toIndex,
        score,
        ruleDict,
    );
    QUALITY_RULES.forEach((rule: string, index: any) => {
        const status = ensureRuleStatus(ruleStatus, rule, ruleDict);
        const selected = enabled && index >= fromIndex && index < toIndex;
        status.selected = selected;
        status.desc = ruleDict[rule].label;
        status.ogDesc = ruleDict[rule].label;
        status.score = selected
            ? allocatedScores[index - fromIndex]
            : ruleDict[rule].score;
        status.maxScore = ruleDict[rule].score;
        if (selected && draft.pending) status.pending = true;
        else delete status.pending;
    });
}

const REVIEW_PREFIXES: Readonly<Record<string, string>> = Object.freeze({
    general: "5",
    writing: "5a",
    coverage: "5b",
    source: "5c",
    complete: "5x",
});

function reviewTier(tierValue: any) {
    const tier = REVIEW_TIERS.find((item: any) => item.value === tierValue);
    if (!tier) throw new TypeError(`Unknown review tier: ${String(tierValue)}`);
    return tier;
}

export function reviewCode(row: any, tierValue: any, quick: boolean) {
    const prefix = REVIEW_PREFIXES[row];
    if (!prefix) throw new TypeError(`Unknown review row: ${String(row)}`);
    const tier = reviewTier(tierValue);
    if (typeof quick !== "boolean")
        throw new TypeError("Review quick flag must be a boolean");
    return `${prefix}${tier.suffix}${quick && row !== "complete" ? "-half" : ""}`;
}

function completeReviewCode(tierValue: any) {
    return `5x${reviewTier(tierValue).suffix}`;
}

function reviewRuleSet(rule: string, ruleDict: Record<string, NominationRule>) {
    const ruleSet = ruleDict?.[rule] ?? defaultsForCode(rule, ruleDict);
    if (!ruleSet)
        throw new SyntaxError(`Missing canonical review rule: ${rule}`);
    return ruleSet;
}

export function getReviewDefaultScore(
    row: any,
    tierValue: any,
    quick: boolean,
    ruleDict: Record<string, NominationRule>,
) {
    const rule = reviewCode(row, tierValue, quick);
    return Number(reviewRuleSet(rule, ruleDict).score);
}

function reviewVariantLookup() {
    const lookup: Record<
        string,
        { row: string; tier: string; quick: boolean }
    > = {};
    for (const row of REVIEW_ROWS) {
        for (const tier of REVIEW_TIERS) {
            for (const quick of [false, true]) {
                lookup[reviewCode(row, tier.value, quick)] = {
                    row,
                    tier: tier.value,
                    quick,
                };
            }
        }
    }
    for (const tier of REVIEW_TIERS) {
        const rule = completeReviewCode(tier.value);
        lookup[rule] = {
            row: "complete",
            tier: tier.value,
            quick: false,
        };
        lookup[`${rule}-half`] = {
            row: "complete",
            tier: tier.value,
            quick: true,
        };
    }
    return lookup;
}

const REVIEW_VARIANTS = reviewVariantLookup();

interface ReviewRowDraft {
    selected: boolean;
    tier: string;
    quick: boolean;
    score: number;
    description?: string;
}

function emptyReviewRow(
    row: any,
    ruleDict: Record<string, NominationRule>,
): ReviewRowDraft {
    return {
        selected: false,
        tier: "none",
        quick: false,
        score: getReviewDefaultScore(row, "none", false, ruleDict),
    };
}

export function getReviewDraft(
    ruleStatus: Record<string, any>,
    ruleDict: Record<string, NominationRule>,
) {
    const general = emptyReviewRow("general", ruleDict);
    const complete = emptyReviewRow("complete", ruleDict);
    const aspects = Object.fromEntries(
        REVIEW_ASPECT_ROWS.map((row: any) => [
            row,
            emptyReviewRow(row, ruleDict),
        ]),
    );

    if (
        !ruleStatus ||
        typeof ruleStatus !== "object" ||
        Array.isArray(ruleStatus)
    ) {
        throw new TypeError("Review rule status must be an object");
    }

    const selected = Object.entries(ruleStatus).flatMap(([rule, stored]) => {
        if (!rule.startsWith("5")) return [];
        const occurrences = Array.isArray(stored) ? stored : [stored];
        return occurrences
            .filter((status: any) => status?.selected)
            .map((status: any) => [rule, status]);
    });
    const seenRows = new Set();

    for (const [rule, status] of selected) {
        const variant = REVIEW_VARIANTS[rule];
        const ruleSet = reviewRuleSet(rule, ruleDict);
        if (!variant) throw new SyntaxError(`Unknown review rule: ${rule}`);
        if (seenRows.has(variant.row)) {
            throw new SyntaxError(`Duplicate review row: ${variant.row}`);
        }
        seenRows.add(variant.row);
        const score =
            status.score == null ? Number(ruleSet.score) : Number(status.score);
        if (!Number.isFinite(score) || score < 0) {
            throw new TypeError(`Invalid review score: ${rule}`);
        }

        if (variant.row === "complete") {
            if (selected.length !== 1) {
                throw new SyntaxError(
                    "A complete review cannot be combined with other Rule 5 codes",
                );
            }
        }

        const rowDraft = {
            selected: true,
            tier: variant.tier,
            quick: variant.row !== "complete" && variant.quick,
            score,
            ...(!isDefaultDescription(status, ruleSet)
                ? { description: String(status.desc) }
                : {}),
        };
        if (variant.row === "general") {
            Object.assign(general, rowDraft);
        } else if (variant.row === "complete") {
            Object.assign(complete, rowDraft);
        } else {
            aspects[variant.row] = rowDraft;
        }
    }

    if (
        general.selected &&
        REVIEW_ASPECT_ROWS.some((row: any) => aspects[row].selected)
    ) {
        throw new SyntaxError(
            "A general review cannot be combined with specialized reviews",
        );
    }

    return {
        mode: complete.selected
            ? REVIEW_APPLY_MODE.COMPLETE
            : REVIEW_ASPECT_ROWS.some((row) => aspects[row].selected)
              ? REVIEW_APPLY_MODE.ASPECTS
              : REVIEW_APPLY_MODE.GENERAL,
        general,
        aspects,
        complete,
    };
}

/**
 * 套用使用者最後選擇的規則五表單部分。
 * 一般、分項與完整評審互相取代；每個分項最多產生一個標準代碼。
 */
export function applyReviewDraft(
    ruleStatus: Record<string, any>,
    draft: any,
    ruleDict: Record<string, NominationRule>,
    mode: any = undefined,
) {
    if (!Object.values(REVIEW_APPLY_MODE).includes(mode)) {
        throw new TypeError(
            "Review mode must be 'general', 'aspects', or 'complete'",
        );
    }

    for (const [rule, stored] of Object.entries(ruleStatus)) {
        if (!rule.startsWith("5")) continue;
        const occurrences = Array.isArray(stored) ? stored : [stored];
        for (const status of occurrences) {
            if (!status) continue;
            delete status.pending;
            status.selected = false;
        }
    }

    const candidates =
        mode === REVIEW_APPLY_MODE.GENERAL
            ? [["general", draft.general]]
            : mode === REVIEW_APPLY_MODE.COMPLETE
              ? [["complete", draft.complete]]
              : REVIEW_ASPECT_ROWS.map((row: any) => [row, draft.aspects[row]]);
    for (const [row, rowDraft] of candidates) {
        if (!rowDraft || typeof rowDraft !== "object") {
            throw new TypeError(`Missing review draft row: ${row}`);
        }
        if (!rowDraft.selected) continue;
        const rule = reviewCode(row, rowDraft.tier, rowDraft.quick);
        const ruleSet = reviewRuleSet(rule, ruleDict);
        const score = Number(rowDraft.score);
        if (!Number.isFinite(score) || score < 0) {
            throw new TypeError(`Invalid review score: ${rule}`);
        }
        const status = ensureRuleStatus(ruleStatus, rule, ruleDict);
        status.selected = true;
        status.desc = rowDraft.description ?? ruleSet.label;
        status.ogDesc = ruleSet.label;
        status.score = score;
        status.maxScore = ruleSet.score;
    }
}

function normalizedScore(value: any) {
    if (value == null || (typeof value === "string" && value.trim() === ""))
        return null;
    if (typeof value !== "number" && typeof value !== "string") return null;
    const score = Number(value);
    if (!Number.isFinite(score) || score < 0) return null;
    const halfPoints = score * 2;
    return Math.abs(halfPoints - Math.round(halfPoints)) <=
        Number.EPSILON * Math.max(1, Math.abs(halfPoints))
        ? score
        : null;
}

/**
 * 序列化提名規則，且不顯示介面通知或修改草稿。
 * @param ruleStatus 以標準規則代碼為鍵的規則狀態；可重複的規則四可使用陣列。
 * @param ruleNames 標準規則順序。
 * @param options 序列化選項。
 */
export function serializeNominationReason(
    ruleStatus: any,
    ruleNames: string[],
    {
        includeUnselected = false,
        includePending = true,
    }: { includeUnselected?: boolean; includePending?: boolean } = {},
): any {
    const selected = [];
    const unselected = [];
    let reasonScore = 0;

    for (const { rule, status, occurrence } of getOrderedRuleOccurrences(
        ruleNames,
        ruleStatus,
    )) {
        if (!status || (!includeUnselected && !status.selected)) continue;

        const score = normalizedScore(status.score);
        if (score == null) {
            return {
                ok: false,
                error: { code: "invalid-score", rule, occurrence },
            };
        }

        let serialized = `${rule}${includePending && status.pending ? "?" : ""}`;
        if (status.desc !== status.ogDesc)
            serialized += `(${encodeReasonDescription(status.desc)})`;
        const maxScore = normalizedScore(status.maxScore);
        if (maxScore == null || score !== maxScore) serialized += `[${score}]`;

        if (status.selected) {
            selected.push(serialized);
            reasonScore += score;
        } else {
            unselected.push(serialized);
        }
    }

    return {
        ok: true,
        reasonText: selected.join(" "),
        unselectedReasonText: unselected.join(" "),
        reasonScore,
    };
}

/** Format editable draft text, including incomplete scores; never use for writes. */
export function serializeNominationDraftReason(
    ruleStatus: Record<string, any>,
    ruleNames: string[],
): string {
    return getOrderedRuleOccurrences(ruleNames, ruleStatus)
        .filter(({ status }) => status?.selected)
        .map(({ rule, status }) => {
            let text = `${rule}${status.pending ? "?" : ""}`;
            if (status.desc !== status.ogDesc)
                text += `(${encodeReasonDescription(status.desc)})`;
            const score = normalizedScore(status.score);
            const maxScore = normalizedScore(status.maxScore);
            if (score === null || maxScore === null || score !== maxScore) {
                const rawScore =
                    typeof status.score === "string"
                        ? status.score.trim()
                        : typeof status.score === "number" &&
                            Number.isFinite(status.score)
                          ? String(status.score)
                          : "";
                text += `[${rawScore}]`;
            }
            return text;
        })
        .join(" ");
}

function tokenRowFailure(code: string, row: any, occurrence: number) {
    return {
        ok: false,
        error: {
            code,
            rule: typeof row?.code === "string" ? row.code : "",
            occurrence,
        },
    };
}

/**
 * 序列化核對編輯器使用且保留重複實例的資料列。
 *
 * 可編輯的描述及分數是最終依據。解析器欄位（`comment`、
 * `scoreOverride` 及 `pending`）僅描述來源詞元，不得覆寫核對者的變更；
 * 完成核對後，也不會將僅供提名使用的待定標記帶入通過或不通過的
 * 代碼清單。
 *
 * @param rows 依序排列的核對編輯器詞元資料列。
 * @param ruleDict 標準規則字典。
 */
function serializeCheckTokenRows(
    rows: Array<any>,
    ruleDict: Record<string, any>,
): any {
    const selected = [];
    const unselected = [];
    let reasonScore = 0;

    for (let occurrence = 0; occurrence < rows.length; occurrence++) {
        const row = rows[occurrence];
        if (!row || typeof row !== "object" || typeof row.code !== "string") {
            return tokenRowFailure("invalid-token-row", row, occurrence);
        }

        const rule = row.code.toLowerCase();
        const defaults = ruleDict?.[rule];
        if (!defaults) return tokenRowFailure("unknown-rule", row, occurrence);

        const score = normalizedScore(row.score);
        const maxScore = normalizedScore(defaults.score);
        if (score == null || maxScore == null) {
            return tokenRowFailure("invalid-score", row, occurrence);
        }
        if (typeof row.desc !== "string" || row.desc === "") {
            return tokenRowFailure("invalid-description", row, occurrence);
        }

        let serialized;
        try {
            serialized = serializeReasonToken(
                {
                    code: rule,
                    pending: false,
                    comment:
                        row.desc === String(defaults.label) ||
                        row.desc === row.ogDesc
                            ? null
                            : row.desc,
                    scoreOverride: score === maxScore ? null : score,
                },
                ruleDict,
            );
        } catch (_error) {
            return tokenRowFailure("invalid-description", row, occurrence);
        }

        if (row.selected) {
            selected.push(serialized);
            reasonScore += score;
        } else {
            unselected.push(serialized);
        }
    }

    return {
        ok: true,
        reasonText: selected.join(" "),
        unselectedReasonText: unselected.join(" "),
        reasonScore,
    };
}

function trimmedText(value: any) {
    return value == null ? "" : String(value).trim();
}

const MEDIA_FILE_PREFIX_PATTERN =
    /^\s*:?\s*(?:File|Image|檔案|文件|圖像|图像)\s*:\s*/iu;

/**
 * 判斷頁面名稱是否明確帶有可辨識的媒體檔案命名空間前綴。
 * @param value 待判斷的頁面名稱。
 * @returns 是否帶有檔案命名空間前綴。
 */
export function hasMediaFilePrefix(value: any): boolean {
    return MEDIA_FILE_PREFIX_PATTERN.test(trimmedText(value));
}

/**
 * 將使用者輸入的媒體檔案名稱正規化為帶有 File: 前綴的頁面名稱。
 * @param value 媒體檔案名稱。
 * @returns 正規化後的檔案頁面名稱；空白輸入則回傳空字串。
 */
export function normalizeMediaFileName(value: any): string {
    const title = trimmedText(value)
        .replace(MEDIA_FILE_PREFIX_PATTERN, "")
        .trim();
    return title === "" ? "" : `File:${title}`;
}

/**
 * 從媒體草稿的單一頁面名稱取得核對用目標；舊式雙欄資料仍受支援。
 * 明確帶有檔案命名空間前綴的值會正規化為 File:，其餘值視為使用條目名。
 * @param media 媒體草稿。
 * @returns 核對用頁面名稱。
 */
export function resolveMediaPageName(
    media:
        | { pageName?: any; fileName?: any; usagePageName?: any }
        | null
        | undefined,
): string {
    const pageName = trimmedText(media?.pageName);
    if (pageName !== "") {
        return hasMediaFilePrefix(pageName)
            ? normalizeMediaFileName(pageName)
            : pageName;
    }
    return (
        normalizeMediaFileName(media?.fileName) ||
        trimmedText(media?.usagePageName)
    );
}

const AUTHOR_TARGET_FAMILIES = Object.freeze([
    "article",
    "review",
    "media",
    "recommendation",
    "other",
]);

function targetError(code: string, details = {}) {
    return {
        ok: false,
        code,
        pageName: "",
        ...details,
    };
}

/**
 * 依作者目前選取的提名類別解析外層提名模板唯一的「條目名稱」。
 *
 * 規則一至五共用一般條目名稱；規則六使用單一頁面名稱；
 * 規則七固定使用本地化的「他薦」；規則八使用選填的相關頁面名稱。
 * 其他類別殘留的規則不影響目標。
 *
 * @param nomination 提名草稿。
 * @param otherRecommendationName 本地化的規則七固定名稱。
 * @returns 解析結果。
 */
export function resolveAuthorTarget(
    nomination: any,
    otherRecommendationName: any = "他薦",
): any {
    const family = AUTHOR_TARGET_FAMILIES.includes(
        nomination?.activeRuleCategory,
    )
        ? nomination.activeRuleCategory
        : null;
    if (family === null) return targetError("missing-author-category");
    if (family === "media") {
        if (trimmedText(nomination?.media?.pageName) !== "") {
            return {
                ok: true,
                pageName: resolveMediaPageName(nomination.media),
                family,
            };
        }
        const fileName = normalizeMediaFileName(nomination?.media?.fileName);
        const usagePageName = trimmedText(nomination?.media?.usagePageName);
        if (fileName !== "" && usagePageName !== "") {
            return targetError("ambiguous-media-target");
        }
        const pageName = fileName || usagePageName;
        return pageName === ""
            ? targetError("missing-media-target")
            : { ok: true, pageName, family };
    }

    if (family === "recommendation") {
        const pageName = trimmedText(otherRecommendationName) || "他薦";
        return { ok: true, pageName, family };
    }

    if (family === "other") {
        const pageName = trimmedText(nomination?.otherPageName) || "其他";
        return { ok: true, pageName, family };
    }

    const pageName = trimmedText(nomination?.pageName);
    return pageName === ""
        ? targetError("missing-page-name")
        : { ok: true, pageName, family };
}

/**
 * 格式化單筆提名的四個標準 ACG 提名模板參數。
 * @param nomination 提名草稿。
 * @param position 外層模板中從 1 開始的項目位置。
 * @param reasonText 已序列化的提名理由。
 * @returns 不含開頭或結尾換行符的維基文字片段。
 */
export function formatNominationItemWikitext(
    nomination: { pageName?: any; awarder?: any },
    position: number,
    reasonText: string,
): string {
    if (!Number.isInteger(position) || position < 1) {
        throw new RangeError("Nomination position must be a positive integer");
    }
    return [
        `|條目名稱${position} = ${trimmedText(nomination?.pageName)}`,
        `|用戶名稱${position} = ${trimmedText(nomination?.awarder)}`,
        `|提名理由${position} = {{ACG提名2/request|ver=1|${String(reasonText ?? "")}}}`,
        `|核對用${position} = {{ACG提名2/check|ver=1|}}`,
    ].join("\n");
}

interface NominationBatchEntry {
    pageName?: string;
    awarder?: string;
    ruleStatus?: any;
    ruleTokens?: any;
}

/** Format one explicit table group, splitting at the template's item limit. */
export function formatNewNominationBatchWikitext(
    nominations: readonly NominationBatchEntry[],
    additionalMessage = "",
):
    | { ok: true; wikitext: string }
    | {
          ok: false;
          error:
              "empty" | "invalid-group" | "missing-identity" | "invalid-reason";
      } {
    if (!nominations.length) return { ok: false, error: "empty" };
    const { ruleNames } = NominationRuleSet();
    const tables: string[] = [];
    for (let start = 0; start < nominations.length; start += 25) {
        const items: string[] = [];
        for (const [index, nomination] of nominations
            .slice(start, start + 25)
            .entries()) {
            if (!validateNominationGroup(nomination).ok)
                return { ok: false, error: "invalid-group" };
            if (!nomination.awarder?.trim() || !nomination.pageName?.trim())
                return { ok: false, error: "missing-identity" };
            const reason = serializeNominationReason(
                nomination.ruleStatus,
                ruleNames,
            );
            if (!reason.ok || !reason.reasonText || reason.reasonScore <= 0)
                return { ok: false, error: "invalid-reason" };
            items.push(
                formatNominationItemWikitext(
                    nomination,
                    index + 1,
                    reason.reasonText,
                ),
            );
        }
        tables.push("{{ACG提名2\n" + items.join("\n") + "\n}}");
    }
    let wikitext = tables.join("\n") + "\n'''提名人：'''" + "~".repeat(4);
    const message = additionalMessage.trim().replace(/^[：:]+\s*/u, "");
    if (message) wikitext += "\n: {{說明}}：" + message + "--" + "~".repeat(4);
    return { ok: true, wikitext };
}

/** Keep each explicit table's signature and comment with that table's entries. */
export function formatNewNominationTablesWikitext(
    tables: readonly {
        nominations: readonly NominationBatchEntry[];
        comment: string;
    }[],
): ReturnType<typeof formatNewNominationBatchWikitext> {
    if (!tables.length) return { ok: false, error: "empty" };
    const groups: string[] = [];
    for (const table of tables) {
        const source = formatNewNominationBatchWikitext(
            table.nominations,
            table.comment,
        );
        if (!source.ok) return source;
        groups.push(source.wikitext);
    }
    return { ok: true, wikitext: groups.join("\n\n") };
}

/**
 * 格式化提名之「核對用」參數的完整內容。
 *
 * 結果會保留共用理由序列化器計算出的分數，讓儲存流程無須重新解析輸出即可更新分數列表。
 * 未選取任何規則時會略過規則序列化，並固定以「0」表示無效提名，
 * 即使已放棄的規則草稿尚未完整填寫亦然。
 *
 * @param nomination 核對草稿。
 * @param ruleNames 標準規則順序。
 * @param [ruleDict] 標準規則資料；使用 ruleTokens 時必須提供。
 */
export function formatNominationCheckWikitext(
    nomination: any,
    ruleNames: string[],
    ruleDict: Record<string, any> = NominationRuleSet().ruleDict,
): any {
    const message = String(nomination?.message ?? "");
    const signature = "~" + "~" + "~" + "~";

    if (Array.isArray(nomination?.ruleTokens)) {
        if (!nomination.ruleTokens.some((row: any) => row?.selected)) {
            return {
                ok: true,
                wikitext: `{{ACG提名2/check|ver=1|0}}${message}--${signature}`,
                reasonScore: 0,
            };
        }

        const serialized: any = serializeCheckTokenRows(
            nomination.ruleTokens,
            ruleDict,
        );
        if (!serialized.ok) return serialized;

        const rejected =
            serialized.unselectedReasonText === ""
                ? ""
                : `|no=${serialized.unselectedReasonText}`;
        return {
            ok: true,
            wikitext: `{{ACG提名2/check|ver=1|${serialized.reasonText}${rejected}}}${message}--${signature}`,
            reasonScore: serialized.reasonScore,
        };
    }

    const hasSelectedRule = getOrderedRuleOccurrences(
        ruleNames,
        nomination?.ruleStatus,
    ).some(({ status }) => status?.selected);
    if (!hasSelectedRule) {
        return {
            ok: true,
            wikitext: `{{ACG提名2/check|ver=1|0}}${message}--${signature}`,
            reasonScore: 0,
        };
    }

    const serialized = serializeNominationReason(
        nomination?.ruleStatus,
        ruleNames,
        { includeUnselected: true, includePending: false },
    );
    if (!serialized.ok) return serialized;

    const rejected =
        serialized.unselectedReasonText === ""
            ? ""
            : `|no=${serialized.unselectedReasonText}`;
    return {
        ok: true,
        wikitext: `{{ACG提名2/check|ver=1|${serialized.reasonText}${rejected}}}${message}--${signature}`,
        reasonScore: serialized.reasonScore,
    };
}

/**
 * 格式化已核對提名的四個標準 ACG 提名模板參數。
 * requestReasonText 是不可變更的原始提名理由；checkWikitext 是
 * {@link formatNominationCheckWikitext} 即時回傳的內容。
 *
 * @param nomination 提名草稿。
 * @param position 外層模板中從 1 開始的項目位置。
 * @param requestReasonText 不含模板外框的原始提名理由。
 * @param checkWikitext 完整的核對模板、留言與簽名。
 * @returns 不含開頭或結尾換行符的維基文字片段。
 */
export function formatCheckedNominationItemWikitext(
    nomination: { pageName?: any; awarder?: any },
    position: number,
    requestReasonText: string,
    checkWikitext: string,
): string {
    if (!Number.isInteger(position) || position < 1) {
        throw new RangeError("Nomination position must be a positive integer");
    }
    return [
        `|條目名稱${position} = ${trimmedText(nomination?.pageName)}`,
        `|用戶名稱${position} = ${trimmedText(nomination?.awarder)}`,
        `|提名理由${position} = {{ACG提名2/request|ver=1|${String(requestReasonText ?? "")}}}`,
        `|核對用${position} = ${String(checkWikitext ?? "")}`,
    ].join("\n");
}

export type NominationGroup =
    "article" | "review" | "media" | "recommendation" | "other";
export type NominationGroupResult =
    | { ok: true; category: NominationGroup | null }
    | {
          ok: false;
          error: {
              code: "mixed-rule-groups" | "unknown-rule-group";
              groups: NominationGroup[];
          };
      };

/** Every nomination belongs to exactly one family: rules 1–4, 5, 6, 7, or 8. */
export function nominationRuleGroup(code: string): NominationGroup | null {
    const canonical =
        NominationRuleAliases()[String(code).toLowerCase()] ??
        String(code).toLowerCase();
    if (
        !NominationRuleSet().ruleDict[canonical] &&
        !/^5x(?:-(?:bcr|gan|acr|fac))?-half$/u.test(canonical)
    )
        return null;
    if (/^[1-4]/u.test(canonical)) return "article";
    if (canonical.startsWith("5")) return "review";
    if (canonical.startsWith("6")) return "media";
    if (canonical === "7") return "recommendation";
    if (canonical === "8") return "other";
    return null;
}

/** Validate writes while allowing parsers to retain mixed historical source for repair. */
export function validateNominationGroup(nomination: {
    ruleStatus?: Record<string, any>;
    ruleTokens?: Array<{ code: string; selected?: boolean }> | null;
}): NominationGroupResult {
    const codes = Array.isArray(nomination.ruleTokens)
        ? nomination.ruleTokens.map((token) => token.code)
        : allRuleOccurrences(nomination.ruleStatus ?? {})
              .filter(({ status }) => status?.selected)
              .map(({ rule }) => rule);
    const groups = new Set<NominationGroup>();
    for (const code of codes) {
        const group = nominationRuleGroup(code);
        if (group === null)
            return {
                ok: false,
                error: { code: "unknown-rule-group", groups: [...groups] },
            };
        groups.add(group);
    }
    if (groups.size > 1)
        return {
            ok: false,
            error: { code: "mixed-rule-groups", groups: [...groups] },
        };
    return { ok: true, category: [...groups][0] ?? null };
}
