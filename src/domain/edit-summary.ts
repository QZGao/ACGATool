/**
 * @file src/domain/edit-summary.ts
 * Purpose: src / domain / edit summary module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. NominationSummaryItem
 * 4. byteLength
 * 5. attributed
 * 6. plainText
 * 7. totalScore
 * 8. boundedToolSummary
 * 9. formatNominationEditSummary
 */

import {
    allRuleOccurrences,
    NominationRuleSet,
    serializeNominationReason,
} from "./rules.ts";

const MAX_SUMMARY_BYTES = 255;
const TOOL_ATTRIBUTION =
    "([[User:SuperGrey/gadgets/ACGATool|ACGATool]] modified)";
const encoder = new TextEncoder();

export interface NominationSummaryItem {
    pageName?: unknown;
    awarder?: unknown;
    ruleStatus?: Record<string, unknown>;
    score?: number;
}

function byteLength(value: string): number {
    return encoder.encode(value).length;
}

function attributed(summary: string): string {
    return `${summary.trim()} ${TOOL_ATTRIBUTION}`;
}

function plainText(value: unknown): string {
    return String(value ?? "")
        .replace(/[[\]{}|]/gu, " ")
        .replace(/\p{Cc}/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();
}

function totalScore(scores: readonly (number | null)[]): number | null {
    let total = 0;
    for (const score of scores) {
        if (score === null) return null;
        total += score;
    }
    return Number.isFinite(total) ? total : null;
}

/** Keep complete Unicode characters and the tool credit within the byte budget. */
export function boundedToolSummary(summary: string): string {
    let body = summary.trim();
    if (byteLength(attributed(body)) <= MAX_SUMMARY_BYTES)
        return attributed(body);
    body = body.replace(/\[\[([^[\]]+)\]\]/gu, (_link, value: string) => {
        const separator = value.indexOf("|");
        return separator < 0
            ? value.replace(/^:/u, "")
            : value.slice(separator + 1);
    });
    if (byteLength(attributed(body)) <= MAX_SUMMARY_BYTES)
        return attributed(body);
    const budget = MAX_SUMMARY_BYTES - byteLength(attributed("…"));
    let shortened = "";
    let used = 0;
    for (const character of body) {
        const bytes = byteLength(character);
        if (used + bytes > budget) break;
        shortened += character;
        used += bytes;
    }
    return attributed(`${shortened.trimEnd()}…`);
}

/** Choose the richest complete summary that fits, including the tool attribution. */
export function formatNominationEditSummary(
    nominations: readonly NominationSummaryItem[],
    action = "新提名",
): string {
    const { ruleNames } = NominationRuleSet();
    const items = nominations.map((nomination) => {
        const recipient = plainText(nomination.awarder).replace(
            /^(?:User|使用者|用户|用戶)\s*:\s*/iu,
            "",
        );
        const occurrences = allRuleOccurrences(
            nomination.ruleStatus ?? {},
        ).filter(({ status }) => status?.selected);
        const reason = serializeNominationReason(
            nomination.ruleStatus,
            ruleNames,
        );
        const score =
            nomination.score ??
            (reason.ok && nomination.ruleStatus ? reason.reasonScore : null);
        const pageName = plainText(nomination.pageName);
        const placeholder = ["他薦", "他荐", "其他"].includes(pageName);
        const descriptions = placeholder
            ? [
                  ...new Set(
                      occurrences
                          .map(({ status }) => plainText(status.desc))
                          .filter(Boolean),
                  ),
              ].join("、")
            : "";
        return {
            recipient,
            target: placeholder ? descriptions || pageName : `[[${pageName}]]`,
            codes: occurrences.map(({ rule }) => rule).join("+"),
            score:
                typeof score === "number" && Number.isFinite(score)
                    ? score
                    : null,
        };
    });
    const recipients = new Map<string, Array<number | null>>();
    for (const item of items) {
        const scores = recipients.get(item.recipient) ?? [];
        scores.push(item.score);
        recipients.set(item.recipient, scores);
    }
    const prefix = `${plainText(action)}：`;
    const counts = `${recipients.size}人${items.length}項`;
    const userLink = (recipient: string) =>
        `[[User:${recipient}|${recipient}]]`;
    const scoreText = (score: number | null) =>
        score === null ? "?" : String(score);
    const grouped = (links: boolean, totals: boolean) =>
        [...recipients]
            .map(([recipient, scores]) => {
                const score = totals
                    ? scoreText(totalScore(scores))
                    : scores.map(scoreText).join("+");
                return `${links ? userLink(recipient) : recipient}（${score}分）`;
            })
            .join("；");
    const overallScore = totalScore(items.map((item) => item.score));
    const candidates = [
        prefix +
            items
                .map(
                    (item) =>
                        `${userLink(item.recipient)}：${item.target}（${item.codes ? `${item.codes}，` : ""}${scoreText(item.score)}分）`,
                )
                .join("；"),
        prefix +
            items
                .map(
                    (item) =>
                        `${userLink(item.recipient)}：${item.target}（${scoreText(item.score)}分）`,
                )
                .join("；"),
        `${prefix}${counts}：${grouped(true, false)}`,
        `${prefix}${counts}：${grouped(false, false)}`,
        `${prefix}${counts}：${grouped(false, true)}`,
        ...(overallScore === null
            ? []
            : [`${prefix}${counts}：總分${overallScore}分`]),
        `${prefix}${counts}`,
    ];
    return attributed(
        candidates.find(
            (candidate) =>
                byteLength(attributed(candidate)) <= MAX_SUMMARY_BYTES,
        ) ?? counts,
    );
}
