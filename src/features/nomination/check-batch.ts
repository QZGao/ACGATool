/**
 * @file src/features/nomination/check-batch.ts
 * Purpose: src / features / nomination / check batch module.
 *
 * Table of contents:
 * 1. Constants and state
 * 2. normalizeCheckOutcome
 * 3. CheckOutcome
 */

export const CHECK_OUTCOME = Object.freeze({
    SAVE: "save" as const,
    CANCEL: "cancel" as const,
    QUIT: "quit" as const,
});

const VALID_CHECK_OUTCOMES: ReadonlySet<unknown> = new Set(
    Object.values(CHECK_OUTCOME),
);

/**
 * 正規化對話框結果。未知結果一律視為取消，避免批次流程在對話框意外關閉後繼續。
 * @param outcome 對話框回傳的結果。
 * @returns 正規化後的核對結果。
 */
export function normalizeCheckOutcome(outcome: unknown): CheckOutcome {
    return VALID_CHECK_OUTCOMES.has(outcome)
        ? (outcome as CheckOutcome)
        : CHECK_OUTCOME.CANCEL;
}

export type CheckOutcome = (typeof CHECK_OUTCOME)[keyof typeof CHECK_OUTCOME];
