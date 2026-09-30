import test from "node:test";
import assert from "node:assert/strict";

import {
    CHECK_OUTCOME,
    normalizeCheckOutcome,
} from "../../src/features/nomination/check-batch.ts";

test("check outcomes are immutable and unknown results fail safe to cancel", () => {
    assert.equal(Object.isFrozen(CHECK_OUTCOME), true);
    assert.equal(normalizeCheckOutcome(CHECK_OUTCOME.SAVE), CHECK_OUTCOME.SAVE);
    assert.equal(
        normalizeCheckOutcome(CHECK_OUTCOME.CANCEL),
        CHECK_OUTCOME.CANCEL,
    );
    assert.equal(normalizeCheckOutcome(CHECK_OUTCOME.QUIT), CHECK_OUTCOME.QUIT);
    assert.equal(normalizeCheckOutcome(undefined), CHECK_OUTCOME.CANCEL);
    assert.equal(normalizeCheckOutcome("unexpected"), CHECK_OUTCOME.CANCEL);
});
