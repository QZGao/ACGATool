import test from "node:test";
import assert from "node:assert/strict";

import {
    CHECK_OUTCOME,
    normalizeCheckOutcome,
    runCheckBatch,
} from "../../src/features/nomination/check-batch.ts";

test("check outcomes are immutable and unknown results fail safe to cancel", () => {
    assert.equal(Object.isFrozen(CHECK_OUTCOME), true);
    assert.equal(normalizeCheckOutcome(CHECK_OUTCOME.SAVE), CHECK_OUTCOME.SAVE);
    assert.equal(normalizeCheckOutcome(CHECK_OUTCOME.SKIP), CHECK_OUTCOME.SKIP);
    assert.equal(
        normalizeCheckOutcome(CHECK_OUTCOME.CANCEL),
        CHECK_OUTCOME.CANCEL,
    );
    assert.equal(normalizeCheckOutcome(CHECK_OUTCOME.QUIT), CHECK_OUTCOME.QUIT);
    assert.equal(normalizeCheckOutcome(undefined), CHECK_OUTCOME.CANCEL);
    assert.equal(normalizeCheckOutcome("unexpected"), CHECK_OUTCOME.CANCEL);
});

test("batch checks run sequentially with stable one-based progress", async () => {
    const calls: unknown[] = [];
    let active = false;

    const completed = await runCheckBatch(
        ["first", "second", "third"],
        async (item, status) => {
            assert.equal(active, false);
            active = true;
            calls.push({ item, status });
            await Promise.resolve();
            active = false;
            return item === "second" ? CHECK_OUTCOME.SKIP : CHECK_OUTCOME.SAVE;
        },
    );

    assert.equal(completed, true);
    assert.deepEqual(calls, [
        { item: "first", status: { current: 1, total: 3 } },
        { item: "second", status: { current: 2, total: 3 } },
        { item: "third", status: { current: 3, total: 3 } },
    ]);
});

test("cancel stops the batch before later items are opened", async () => {
    const calls: unknown[] = [];

    const completed = await runCheckBatch(
        ["first", "second", "third"],
        async (item) => {
            calls.push(item);
            return item === "second"
                ? CHECK_OUTCOME.CANCEL
                : CHECK_OUTCOME.SAVE;
        },
    );

    assert.equal(completed, false);
    assert.deepEqual(calls, ["first", "second"]);
});

test("quitting stops navigation before later items are opened", async () => {
    const calls: string[] = [];
    const completed = await runCheckBatch(["first", "second"], async (item) => {
        calls.push(item);
        return CHECK_OUTCOME.QUIT;
    });
    assert.equal(completed, false);
    assert.deepEqual(calls, ["first"]);
});

test("missing and unknown callback results stop the batch", async (t) => {
    for (const result of [undefined, null, "closed"]) {
        await t.test(String(result), async () => {
            const calls: unknown[] = [];
            const completed = await runCheckBatch([1, 2], async (item) => {
                calls.push(item);
                return result;
            });

            assert.equal(completed, false);
            assert.deepEqual(calls, [1]);
        });
    }
});

test("batch callback errors propagate without opening later items", async () => {
    const expected = new Error("check failed");
    const calls: unknown[] = [];

    await assert.rejects(
        runCheckBatch([1, 2, 3], async (item) => {
            calls.push(item);
            if (item === 2) throw expected;
            return CHECK_OUTCOME.SAVE;
        }),
        expected,
    );

    assert.deepEqual(calls, [1, 2]);
});
