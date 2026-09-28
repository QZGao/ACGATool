export const CHECK_OUTCOME = Object.freeze({
    SAVE: "save" as const,
    SKIP: "skip" as const,
    CANCEL: "cancel" as const,
});

const VALID_CHECK_OUTCOMES: ReadonlySet<unknown> = new Set(
    Object.values(CHECK_OUTCOME),
);

/**
 * 正規化對話框結果。未知結果一律視為取消，避免批次流程在對話框意外關閉後繼續。
 * @param outcome 對話框回傳的結果。
 * @returns 正規化後的核對結果。
 */
export function normalizeCheckOutcome(
    outcome: unknown,
): "save" | "skip" | "cancel" {
    return VALID_CHECK_OUTCOMES.has(outcome)
        ? (outcome as CheckOutcome)
        : CHECK_OUTCOME.CANCEL;
}

/**
 * 依序執行提名核對快照。
 * @param items 待核對的提名。
 * @param checkItem 單項核對操作。
 * @returns 是否已處理佇列中的所有項目。
 */
export async function runCheckBatch<Item>(
    items: Iterable<Item>,
    checkItem: (
        arg0: Item,
        arg1: {
            current: number;
            total: number;
        },
    ) => Promise<unknown>,
): Promise<boolean> {
    const queue = Array.from(items);
    const total = queue.length;

    for (let index = 0; index < total; index++) {
        const outcome = normalizeCheckOutcome(
            await checkItem(queue[index], {
                current: index + 1,
                total,
            }),
        );
        if (outcome === CHECK_OUTCOME.CANCEL) {
            return false;
        }
    }

    return true;
}

export type CheckOutcome = (typeof CHECK_OUTCOME)[keyof typeof CHECK_OUTCOME];
export interface BatchStatus {
    current: number;
    total: number;
}
