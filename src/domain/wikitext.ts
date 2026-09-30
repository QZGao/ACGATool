import { NominationRuleSet, parseReasonTokens } from "./rules.ts";
import { boundedToolSummary } from "./edit-summary.ts";

type SourceLocation = { start: number; end: number };
type SourceToken = SourceLocation & { text: string };
type TemplateParameter = {
    value: string;
    fullLocation: SourceLocation;
    valueLocation: SourceLocation;
};
type ParsedEntry = {
    fullLocation: SourceLocation;
    [key: string]: TemplateParameter | SourceLocation;
};

/** Keep source offsets stable while ignoring comments and literal wikitext examples. */
function structuralWikitext(text: string): string {
    return text.replace(
        /<!--[\s\S]*?(?:-->|$)|<(nowiki|pre|source|syntaxhighlight)\b[^>]*(?<!\/)>[\s\S]*?(?:<\/\1\s*>|$)/giu,
        (ignored) => ignored.replace(/[^\r\n]/g, " "),
    );
}

function trimToken(token: SourceToken): SourceToken {
    const leading = token.text.length - token.text.trimStart().length;
    const trailing = token.text.length - token.text.trimEnd().length;
    return {
        text: token.text.trim(),
        start: token.start + leading,
        end: token.end - trailing,
    };
}

/**
 * 偵測頂層的「\n|」分隔符，將模板內部內容分割為詞元。
 * 掃描內部文字時會追蹤巢狀大括號，僅在換行符後緊接「|」時分割。
 * @param innerContent 外層「{{」與「}}」之間的內容。
 * @param offset innerContent 在維基文字中的絕對起始位置。
 * @returns 詞元陣列；每個詞元都是 { text, start, end } 物件。
 */
function splitParameters(innerContent: string, offset: number): SourceToken[] {
    const structure = structuralWikitext(innerContent);
    const tokens = [];
    let lastIndex = 0;
    let braceCount = 0;
    let i = 0;
    while (i < innerContent.length) {
        if (structure.slice(i, i + 2) === "{{") {
            braceCount++;
            i += 2;
            continue;
        }
        if (structure.slice(i, i + 2) === "}}") {
            braceCount = Math.max(braceCount - 1, 0);
            i += 2;
            continue;
        }
        if (
            braceCount === 0 &&
            structure[i] === "\n" &&
            structure[i + 1] === "|"
        ) {
            tokens.push({
                text: innerContent.slice(lastIndex, i),
                start: offset + lastIndex,
                end: offset + i,
            });
            i += 2;
            lastIndex = i;
            continue;
        }
        i++;
    }
    tokens.push({
        text: innerContent.slice(lastIndex),
        start: offset + lastIndex,
        end: offset + innerContent.length,
    });
    return tokens;
}

/**
 * 尋找從指定索引開始之模板所對應的結尾大括號「}}」。
 * @param text 完整的維基文字。
 * @param start 找到「{{」的起始索引。
 * @returns 包含 endIndex 的物件；endIndex 為結尾「}}」之後的索引。
 */
function findTemplateEnd(text: string, start: number): { endIndex: number } {
    const structure = structuralWikitext(text);
    let braceCount = 0;
    let i = start;
    while (i < text.length) {
        if (structure.slice(i, i + 2) === "{{") {
            braceCount++;
            i += 2;
            continue;
        }
        if (structure.slice(i, i + 2) === "}}") {
            braceCount--;
            i += 2;
            if (braceCount === 0) break;
            continue;
        }
        i++;
    }
    return { endIndex: i };
}

/**
 * 解析維基文字中從指定索引開始的 {{ACG提名2}} 模板。
 * 參數以數字後綴（例如「條目名稱1」、「用戶名稱1」）分組為各筆提名。
 * @param text 完整的維基文字。
 * @param start 模板的起始索引（預期指向「{{」）。
 * @returns 包含 entries 與 endIndex 的物件。
 */
function parseTemplate(
    text: string,
    start: number,
): { entries: ParsedEntry[]; endIndex: number } {
    const { endIndex: templateEnd } = findTemplateEnd(text, start);
    const innerStart = start + 2;
    const innerEnd = templateEnd - 2;
    const innerContent = text.slice(innerStart, innerEnd);
    const tokens = splitParameters(innerContent, innerStart);
    const groups: Record<string, Record<string, TemplateParameter>> = {};
    for (let j = 1; j < tokens.length; j++) {
        const token = tokens[j];
        const trimmed = trimToken(token);
        if (trimmed.text === "") continue;
        const equal = trimmed.text.indexOf("=");
        if (equal < 0) continue;
        const rawKey = trimmed.text.slice(0, equal);
        const rawValue = trimmed.text.slice(equal + 1);
        const key = rawKey.trim();
        const value = rawValue.trim();
        const valueLeading = rawValue.length - rawValue.trimStart().length;
        const parameter: TemplateParameter = {
            value,
            valueLocation: {
                start: trimmed.start + equal + 1 + valueLeading,
                end: trimmed.end,
            },
            fullLocation: { start: token.start, end: token.end },
        };
        const suffix = key.match(/^(.+?)(\d+)$/);
        if (!suffix) continue;
        const groupNumber = Number(suffix[2]);
        if (groupNumber === 0) continue;
        const groupKey = suffix[1].trim();
        (groups[groupNumber] ??= {})[groupKey] = parameter;
    }
    const entries = Object.keys(groups)
        .map(Number)
        .sort((left, right) => left - right)
        .map((number) => {
            const group = groups[number];
            const parameters = Object.values(group);
            return {
                ...group,
                fullLocation: {
                    start: Math.min(
                        ...parameters.map((param) => param.fullLocation.start),
                    ),
                    end: Math.max(
                        ...parameters.map((param) => param.fullLocation.end),
                    ),
                },
            };
        });
    return {
        entries,
        endIndex: templateEnd,
    };
}

/**
 * 從完整維基文字中取得日期章節陣列。
 * 每個章節由「=== 日期 ===」格式的 h3 標題界定。
 * @param text 完整的維基文字。
 * @returns 章節陣列：{ date, start, end }。
 */
export function getDateSections(text: string): Array<any> {
    const regex = /^===(?!=)[\t ]*(.+?)[\t ]*(?<!=)===(?!=)[\t \r]*$/gm;
    const structure = structuralWikitext(text);
    const sections = [];
    const matches = [];
    let match;
    while ((match = regex.exec(structure)) !== null) {
        matches.push({
            date: match[1].trim(),
            start: match.index,
            end: regex.lastIndex,
        });
    }
    for (let i = 0; i < matches.length; i++) {
        const sectionStart = matches[i].start;
        const sectionDate = matches[i].date;
        const sectionEnd =
            i < matches.length - 1 ? matches[i + 1].start : text.length;
        sections.push({
            date: sectionDate,
            start: sectionStart,
            end: sectionEnd,
        });
    }
    return sections;
}

/** Only the explicitly labelled signature immediately after a table identifies its nominator. */
function tableNominator(sourceAfterTable: string): string | undefined {
    const signature = sourceAfterTable.match(
        /^\s*'''提名人[：:][\t ]*'''[\t ]*([^\r\n]*)/u,
    )?.[1];
    return signature
        ?.match(
            /\[\[\s*(?:User(?:[ _]talk)?|用[户戶](?:讨论|討論)?|使用者(?:討論)?)\s*:\s*([^|#[\]\r\n]+)(?:#[^|\]\r\n]*)?(?:\|[^\]\r\n]*)?\]\]/iu,
        )?.[1]
        .trim();
}

/**
 * 收集指定日期章節（從 h3 標題到下一個 h3 之前）的所有提名項目。
 * 每個項目是 {{ACG提名2}} 中的一筆資料。
 * @param text 完整的維基文字。
 * @param section { date, start, end } 章節物件。
 * @returns 項目物件陣列：{ template, start, end, type }。
 */
function collectEntriesInSection(text: string, section: any): Array<any> {
    const entries = [];
    const structure = structuralWikitext(text);
    const sectionText = structure.slice(section.start, section.end);
    const regex = /{{ACG提名2(?=[\s|}])/g;
    let unsignedEntries: Array<any> = [];
    let previousTableEnd = section.start;
    let tableIndex = 0;
    let match;
    while ((match = regex.exec(sectionText)) !== null) {
        const absolutePos = section.start + match.index;
        const { entries: tableEntries, endIndex } = parseTemplate(
            text,
            absolutePos,
        );
        if (structure.slice(previousTableEnd, absolutePos).trim())
            unsignedEntries = [];
        const firstNewEntry = entries.length;
        for (const entry of tableEntries) {
            entries.push({
                template: entry,
                start: entry.fullLocation.start,
                end: entry.fullLocation.end,
                type: "acg2",
                tableIndex,
            });
        }
        tableIndex++;
        unsignedEntries.push(...entries.slice(firstNewEntry));
        const nominator = tableNominator(
            structure.slice(endIndex, section.end),
        );
        if (nominator) {
            for (const entry of unsignedEntries) entry.nominator = nominator;
            unsignedEntries = [];
        }
        previousTableEnd = endIndex;
        regex.lastIndex = endIndex - section.start;
    }
    entries.sort((a: any, b: any) => a.start - b.start);
    return entries;
}

/** Enumerate registry entries with the same physical identity used for editing. */
export function getRegistryEntries(text: string): Array<any> {
    const occurrences = new Map<string, number>();
    const structure = structuralWikitext(text);
    return getDateSections(text).flatMap((section) => {
        const sectionOccurrence = occurrences.get(section.date) ?? 0;
        occurrences.set(section.date, sectionOccurrence + 1);
        if (!/^\d{1,2}月\d{1,2}日$/u.test(section.date)) return [];
        const nextChapter = structure
            .slice(section.start, section.end)
            .search(/^==(?!=).+?(?<!=)==(?!=)[\t \r]*$/mu);
        const boundedSection =
            nextChapter < 0
                ? section
                : { ...section, end: section.start + nextChapter };
        return collectEntriesInSection(text, boundedSection).map(
            (entry, index) => ({
                ...entry,
                date: section.date,
                index: index + 1,
                sectionOccurrence,
            }),
        );
    });
}

/**
 * 依指定日期（取自 h3 標題）及項目索引，在完整維基文字中查詢項目。
 * 索引從 1 開始，並依所有項目的順序計數；回傳的項目物件包含其位置。
 * @param text 完整的維基文字。
 * @param date 日期字串（例如「2月3日」）。
 * @param index 該日期下從 1 開始的項目索引。
 * @param sectionOccurrence 同名日期標題從 0 開始的出現次序。
 * @returns 包含 template、start、end、type 與定位資訊的項目物件；找不到時回傳 null。
 */
export function queryEntry(
    text: string,
    date: string,
    index: number,
    sectionOccurrence: number = 0,
): any {
    if (!Number.isSafeInteger(sectionOccurrence) || sectionOccurrence < 0)
        return null;
    const sections = getDateSections(text);
    const targetSection = sections.filter((sec: any) => sec.date === date)[
        sectionOccurrence
    ];
    if (!targetSection) return null;
    const entries = collectEntriesInSection(text, targetSection);
    if (index < 1 || index > entries.length) return null;
    const locatedEntry = {
        ...entries[index - 1],
        date,
        index,
        sectionOccurrence,
    };
    Object.defineProperty(locatedEntry, "sourceFingerprint", {
        value: text.slice(locatedEntry.start, locatedEntry.end),
        enumerable: true,
        writable: false,
        configurable: false,
    });
    return locatedEntry;
}

/**
 * 以 queryEntry 當時保存的原始文字指紋重新定位提名。
 * 原定位仍指向相同文字時直接接受；否則僅在同日期中有唯一精確符合時重定位。
 * @param text 最新的完整維基文字。
 * @param queriedTarget 先前由 queryEntry 回傳的項目。
 * @returns 最新的定位項目；找不到或指紋不唯一時回傳 null。
 */
export function resolveEntryByFingerprint(
    text: string,
    queriedTarget: any,
): any | null {
    if (
        !queriedTarget ||
        typeof queriedTarget.date !== "string" ||
        !Number.isSafeInteger(queriedTarget.index) ||
        queriedTarget.index < 1 ||
        !Number.isSafeInteger(queriedTarget.sectionOccurrence) ||
        queriedTarget.sectionOccurrence < 0 ||
        typeof queriedTarget.sourceFingerprint !== "string"
    ) {
        return null;
    }

    const candidate = queryEntry(
        text,
        queriedTarget.date,
        queriedTarget.index,
        queriedTarget.sectionOccurrence,
    );
    if (candidate?.sourceFingerprint === queriedTarget.sourceFingerprint)
        return candidate;

    const matchingSections = getDateSections(text).filter(
        (section: any) => section.date === queriedTarget.date,
    );
    const matches = [];
    for (
        let sectionOccurrence = 0;
        sectionOccurrence < matchingSections.length;
        sectionOccurrence++
    ) {
        const entries = collectEntriesInSection(
            text,
            matchingSections[sectionOccurrence],
        );
        for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
            const entry = entries[entryIndex];
            if (
                text.slice(entry.start, entry.end) !==
                queriedTarget.sourceFingerprint
            )
                continue;
            const match = queryEntry(
                text,
                queriedTarget.date,
                entryIndex + 1,
                sectionOccurrence,
            );
            if (match) matches.push(match);
            if (matches.length > 1) return null;
        }
    }
    return matches[0] ?? null;
}

/**
 * 接收 queryEntry 回傳的項目與一組變更（將參數鍵映射至新值），
 * 使用精確的位置資料，只更新原始維基文字中的指定參數值。
 * 此函式不會替換整段項目文字，只會替換已變更的參數值。
 *
 * changes 使用「條目名稱」、「用戶名稱」、「提名理由」、「核對用」等鍵名。
 *
 * @param original 完整的原始維基文字。
 * @param entry queryEntry 回傳的項目物件。
 * @param changes 將參數鍵映射至新值的物件。
 * @returns 更新後的維基文字。
 */
export function updateEntryParameters(
    original: string,
    entry: any,
    changes: any,
): string {
    const mods = [];
    for (const key in changes) {
        if (entry.template[key]) {
            const token = entry.template[key];
            mods.push({
                start: token.valueLocation.start,
                end: token.valueLocation.end,
                replacement: changes[key],
            });
        }
    }
    mods.sort((a: any, b: any) => b.start - a.start);
    let updated = original;
    for (const mod of mods) {
        updated =
            updated.slice(0, mod.start) +
            mod.replacement +
            updated.slice(mod.end);
    }
    return updated;
}

/**
 * 移除指定文字中的註解。
 * @param text 要移除註解的文字。
 * @returns 移除註解後的文字。
 */
function removeComments(text: string): string {
    text = text.replace(/<!--.*?-->/gs, "");
    return text.trim();
}

/**
 * 根據用戶的提名理由，解析出保留順序和重複項的規則詞元。
 * @param reason 用戶的提名理由。
 */
export function parseUserReason(reason: string): any {
    const { ruleDict } = NominationRuleSet();
    return parseReasonTokens(reason, ruleDict);
}

/**
 * 將queried（查詢結果）轉換為nomData（提名數據）。
 * @param queried 查詢結果。
 * @returns 提名數據。
 */
export function queried2NomData(queried: any): any {
    const requestReasonText = (reasonWikitext: any) => {
        const prefix = "{{ACG提名2/request|ver=1|";
        const value = removeComments(reasonWikitext);
        return value.startsWith(prefix) && value.endsWith("}}")
            ? value.slice(prefix.length, -2)
            : value;
    };

    if (queried.type !== "acg2") return null;

    const params = queried.template;
    const rawFields = {
        條目名稱: params["條目名稱"]?.value ?? "",
        用戶名稱: params["用戶名稱"]?.value ?? "",
        提名理由: params["提名理由"]?.value ?? "",
        核對用: params["核對用"]?.value ?? "",
    };
    const reasonWikitext = rawFields["提名理由"];
    return {
        pageName: removeComments(rawFields["條目名稱"]),
        awarder: removeComments(rawFields["用戶名稱"]),
        ...(queried.nominator ? { nominator: queried.nominator } : {}),
        requestReasonText: requestReasonText(reasonWikitext),
        requestReasonWikitext: reasonWikitext,
        checkWikitext: rawFields["核對用"],
        rawFields,
        reasonParse: parseUserReason(reasonWikitext),
    };
}

/**
 * 在可讀的編輯摘要末尾加上標準的小工具署名。
 */
export function withToolAttribution(summary: string): string {
    return boundedToolSummary(summary);
}

/**
 * 將受影響頁面格式化為編輯摘要用的內部連結；「他薦／他荐」及「其他」以純文字顯示。
 */
export function formatSummaryPageLinks(pageNames: Array<unknown>): string {
    return pageNames
        .map((pageName: any) => String(pageName ?? "").trim())
        .filter(Boolean)
        .map((pageName: any) =>
            ["他薦", "他荐", "其他"].includes(pageName)
                ? pageName
                : `[[${pageName}]]`,
        )
        .join("、");
}

function safeCommentFragment(commentId: any): string | null {
    if (typeof commentId !== "string") return null;
    const fragment = commentId.trim();
    if (
        !fragment ||
        /[\s#|{}<>]/u.test(fragment) ||
        fragment.includes("[") ||
        fragment.includes("]") ||
        Array.from(fragment).some(
            (character) =>
                character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
    )
        return null;
    return fragment;
}

export function formatScoreListEditSummary(
    awarder: any,
    originalScore: any,
    score: any,
    newScore: any,
    registryRevisionId: any,
    commentId: string | null = null,
    recheck = false,
) {
    const fragment = safeCommentFragment(commentId);
    const diffTarget =
        "Special:Diff/" + registryRevisionId + (fragment ? "#" + fragment : "");
    const negative = Number(score) < 0;
    return withToolAttribution(
        (recheck ? "復核積分：" : "") +
            "[[User:" +
            awarder +
            "|" +
            awarder +
            "]]: " +
            originalScore +
            (negative ? " − [[" : " + [[") +
            diffTarget +
            "|" +
            (negative ? Math.abs(Number(score)) : score) +
            "]] = " +
            newScore,
    );
}

export const ITEM_SOURCE_FIELDS = Object.freeze([
    "條目名稱",
    "用戶名稱",
    "提名理由",
    "核對用",
]);

const ITEM_SOURCE_FIELD_SET = new Set(ITEM_SOURCE_FIELDS);
const FIELD_LINE_PATTERN = /^\s*\|\s*(\S+?)\s*(\d*)\s*$/u;

function sourceError(code: any, message: any, details = {}) {
    return {
        ok: false,
        error: { code, message, ...details },
    };
}

function normalizedSuffix(suffix: any) {
    if (suffix == null || suffix === "") return "";
    if (typeof suffix === "number") {
        if (!Number.isSafeInteger(suffix) || suffix < 0) {
            throw new RangeError(
                "Item source suffix must be a nonnegative integer",
            );
        }
        return String(suffix);
    }
    if (typeof suffix === "string" && /^\d+$/u.test(suffix)) return suffix;
    throw new TypeError(
        "Item source suffix must be empty or contain only ASCII digits",
    );
}

/**
 * 格式化一筆 ACG 提名的四個可編輯欄位。
 *
 * 每個值會原樣輸出於第一個等號之後。實體換行會成為延續行，
 * 直到遇到下一個可識別的欄位標頭為止。
 *
 * @param values 以 {@link ITEM_SOURCE_FIELDS} 為鍵的值。
 * @param suffix 可選的共用參數後綴。
 * @returns 四行實體維基文字參數。
 */
export function formatEditableItemSource(
    values: Record<string, any>,
    suffix: string | number = "",
): string {
    if (!values || typeof values !== "object" || Array.isArray(values)) {
        throw new TypeError("Item source values must be an object");
    }
    const normalized = normalizedSuffix(suffix);
    return ITEM_SOURCE_FIELDS.map((field: any) => {
        if (!Object.prototype.hasOwnProperty.call(values, field)) {
            throw new TypeError(`Missing item source field: ${field}`);
        }
        const value = String(values[field] ?? "");
        return `|${field}${normalized} =${value}`;
    }).join("\n");
}

/**
 * 解析一筆包含四個可編輯欄位的 ACG 提名。
 *
 * 欄位行可以重新排序，但每個欄位必須恰好出現一次，且所有欄位名稱
 * 必須使用相同的可選數字後綴。欄位值為第一個等號後的確切子字串，
 * 包括開頭空格、後續等號及非參數延續行。
 *
 * @param source 可編輯的提名項目原始碼。
 */
export function parseEditableItemSource(source: string): any {
    if (typeof source !== "string") {
        throw new TypeError("Editable item source must be a string");
    }

    const lines = source === "" ? [] : source.split(/\r\n|\n|\r/u);
    const values: Record<string, string> = {};
    let sharedSuffix = null;

    let activeField = null;
    for (let index = 0; index < lines.length; index++) {
        const lineNumber = index + 1;
        const line = lines[index];
        const equalsIndex = line.indexOf("=");
        if (equalsIndex < 0) {
            if (activeField !== null) {
                values[activeField] += `\n${line}`;
                continue;
            }
            return sourceError(
                "missing-equals",
                `Line ${lineNumber} is missing an equals sign`,
                { line: lineNumber },
            );
        }

        const left = line.slice(0, equalsIndex);
        const match = left.match(FIELD_LINE_PATTERN);
        if (!match || !ITEM_SOURCE_FIELD_SET.has(match[1])) {
            if (activeField !== null) {
                values[activeField] += `\n${line}`;
                continue;
            }
            return sourceError(
                "extra-line",
                `Line ${lineNumber} is not one of the four editable item fields`,
                { line: lineNumber },
            );
        }

        const [, field, suffix] = match;
        if (Object.prototype.hasOwnProperty.call(values, field)) {
            return sourceError(
                "duplicate-field",
                `Field ${field} occurs more than once`,
                { line: lineNumber, field },
            );
        }
        if (sharedSuffix === null) {
            sharedSuffix = suffix;
        } else if (suffix !== sharedSuffix) {
            return sourceError(
                "mixed-suffix",
                `Field ${field} does not use the shared numeric suffix`,
                {
                    line: lineNumber,
                    field,
                    expected: sharedSuffix,
                    actual: suffix,
                },
            );
        }

        values[field] = line.slice(equalsIndex + 1);
        activeField = field;
    }

    const missing = ITEM_SOURCE_FIELDS.filter(
        (field: any) => !Object.prototype.hasOwnProperty.call(values, field),
    );
    if (missing.length > 0) {
        return sourceError(
            "missing-field",
            `Missing editable item field${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
            { fields: missing },
        );
    }

    return {
        ok: true,
        suffix: sharedSuffix ?? "",
        values,
    };
}

export type CheckedScoreResult =
    { ok: true; score: number } | { ok: false; error: { code: string } };

type CheckSourceResult =
    | { ok: true; accepted: string; rejected: string; suffix: string }
    | { ok: false; error: { code: string } };

function readCheckSource(checkWikitext: string): CheckSourceResult {
    const source = String(checkWikitext ?? "")
        .replace(/<!--[\s\S]*?-->/gu, "")
        .trim();
    if (source === "")
        return { ok: true, accepted: "", rejected: "", suffix: "" };
    if (!source.startsWith("{{"))
        return { ok: false, error: { code: "unsupported-check" } };
    const parts: string[] = [];
    let start = 2;
    let depth = 1;
    let linkDepth = 0;
    let end = -1;
    for (let cursor = 2; cursor < source.length - 1; cursor++) {
        const pair = source.slice(cursor, cursor + 2);
        if (pair === "[[") {
            linkDepth++;
            cursor++;
            continue;
        }
        if (pair === "]]" && linkDepth > 0) {
            linkDepth--;
            cursor++;
            continue;
        }
        if (linkDepth > 0) continue;
        if (pair === "{{") {
            depth++;
            cursor++;
            continue;
        }
        if (pair === "}}") {
            depth--;
            if (depth === 0) {
                parts.push(source.slice(start, cursor).trim());
                end = cursor + 2;
                break;
            }
            cursor++;
            continue;
        }
        if (source[cursor] === "|" && depth === 1) {
            parts.push(source.slice(start, cursor).trim());
            start = cursor + 1;
        }
    }
    if (end < 0 || parts.shift() !== "ACG提名2/check") {
        return { ok: false, error: { code: "unsupported-check" } };
    }
    let expression: string | undefined;
    let rejected = "";
    let versionSeen = false;
    let rejectedSeen = false;
    for (const part of parts) {
        if (/^ver\s*=\s*1$/u.test(part) && !versionSeen) {
            versionSeen = true;
            continue;
        }
        if (/^no\s*=/u.test(part) && !rejectedSeen) {
            rejectedSeen = true;
            rejected = part.replace(/^no\s*=\s*/u, "");
            continue;
        }
        if (expression === undefined) {
            expression = part;
            continue;
        }
        return { ok: false, error: { code: "unsupported-check-parameters" } };
    }
    if (!versionSeen || expression === undefined)
        return { ok: false, error: { code: "unsupported-check-version" } };
    return {
        ok: true,
        accepted: expression,
        rejected,
        suffix: source.slice(end),
    };
}

interface CheckedRuleToken {
    code: string;
    pending: boolean;
    comment: string | null;
    scoreOverride: number | null;
    sourceIndex: number;
    selected: boolean;
}

export type NominationCheckParseResult =
    | { ok: true; tokens: CheckedRuleToken[]; message: string }
    | { ok: false; error: { code: string } };

/** Restore supported saved checks without treating their signatures as editable comments. */
export function parseNominationCheckWikitext(
    checkWikitext: string,
): NominationCheckParseResult {
    const source = readCheckSource(checkWikitext);
    if (!source.ok) return source;
    const { ruleDict } = NominationRuleSet();
    const tokens: CheckedRuleToken[] = [];
    for (const [expression, selected] of [
        [source.accepted, true],
        [source.rejected, false],
    ] as const) {
        if (expression === "" || expression === "0") continue;
        const parsed = parseReasonTokens(expression, ruleDict);
        if (!parsed.ok)
            return { ok: false, error: { code: "unrecognized-check-rules" } };
        for (const token of parsed.tokens) {
            if (selected && token.pending)
                return { ok: false, error: { code: "pending-check-rule" } };
            tokens.push({ ...token, selected, sourceIndex: tokens.length });
        }
    }
    let message = source.suffix;
    const signature = [
        ...message.matchAll(/--(?=~{3,5}\s*$|\[\[|<|\{\{)/gu),
    ].at(-1);
    if (
        signature &&
        (/^--~{3,5}\s*$/u.test(message.slice(signature.index)) ||
            (/\d{1,2}:\d{2}/u.test(message.slice(signature.index)) &&
                /\d{4}/u.test(message.slice(signature.index)) &&
                /\(UTC\)\s*$/u.test(message)))
    )
        message = message.slice(0, signature.index);
    return { ok: true, tokens, message };
}

/** Read only the supported check expression; unknown legacy expressions need manual reconciliation. */
export function getCheckedScore(checkWikitext: string): CheckedScoreResult {
    const source = readCheckSource(checkWikitext);
    if (!source.ok) return source;
    const expression = source.accepted;
    if (expression === "" || expression === "0") return { ok: true, score: 0 };
    const { ruleDict } = NominationRuleSet();
    const parsed = parseReasonTokens(expression, ruleDict);
    if (!parsed.ok)
        return { ok: false, error: { code: "unrecognized-check-rules" } };
    let score = 0;
    for (const token of parsed.tokens) {
        if (token.pending)
            return { ok: false, error: { code: "pending-check-rule" } };
        const normalRule = ruleDict[token.code];
        const completeQuickRule = token.code.endsWith("-half")
            ? ruleDict[token.code.slice(0, -5)]
            : undefined;
        const value =
            token.scoreOverride ??
            normalRule?.score ??
            (completeQuickRule ? completeQuickRule.score / 2 : NaN);
        if (!Number.isFinite(value) || value < 0)
            return { ok: false, error: { code: "invalid-check-score" } };
        score += value;
    }
    return Number.isFinite(score)
        ? { ok: true, score: Number(score.toPrecision(15)) }
        : { ok: false, error: { code: "invalid-check-score" } };
}

export interface EntryParameterUpdate {
    entry: any;
    changes: Record<string, string>;
}

/** Apply all selected entries against one snapshot, refusing missing fields or overlapping edits. */
export function updateEntriesParameters(
    original: string,
    updates: readonly EntryParameterUpdate[],
): string {
    const patches: Array<{ start: number; end: number; replacement: string }> =
        [];
    const targets = new Set<string>();
    for (const update of updates) {
        const entry = resolveEntryByFingerprint(original, update.entry);
        if (!entry)
            throw new Error(
                "The nomination changed or can no longer be identified uniquely",
            );
        const key = `${entry.start}:${entry.end}`;
        if (targets.has(key))
            throw new Error(
                "The same nomination appears more than once in the batch",
            );
        targets.add(key);
        const fields = entry.template;
        for (const [name, replacement] of Object.entries(update.changes)) {
            const location = fields?.[name]?.valueLocation;
            if (
                !location ||
                !Number.isInteger(location.start) ||
                !Number.isInteger(location.end) ||
                location.start < 0 ||
                location.end < location.start ||
                location.end > original.length
            ) {
                throw new Error(
                    `The nomination is missing a safely editable ${name} field`,
                );
            }
            if (typeof replacement !== "string")
                throw new TypeError(
                    "Nomination parameter replacements must be strings",
                );
            patches.push({ ...location, replacement });
        }
    }
    patches.sort(
        (left: any, right: any) =>
            left.start - right.start || left.end - right.end,
    );
    for (let index = 1; index < patches.length; index++) {
        const previous = patches[index - 1];
        const current = patches[index];
        if (current.start < previous.end || current.start === previous.start) {
            throw new Error(
                "Nomination edits overlap; the batch was not applied",
            );
        }
    }
    let updated = original;
    for (let index = patches.length - 1; index >= 0; index--) {
        const patch = patches[index];
        updated =
            updated.slice(0, patch.start) +
            patch.replacement +
            updated.slice(patch.end);
    }
    return updated;
}
