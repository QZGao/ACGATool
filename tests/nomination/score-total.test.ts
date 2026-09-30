import test from "node:test";
import assert from "node:assert/strict";

import { getSelectedScoreTotal } from "../../src/features/nomination/model.ts";

test("selected-score total includes only selected nonnegative scores", () => {
    assert.equal(
        getSelectedScoreTotal({
            first: { selected: true, score: 3 },
            second: { selected: false, score: Number.NaN },
            third: { selected: true, score: "0.5" },
            missing: null,
        }),
        3.5,
    );
    assert.equal(getSelectedScoreTotal(), 0);
});

test("selected-score total includes every repeated Rule 4 occurrence", () => {
    assert.equal(
        getSelectedScoreTotal({
            "4": [
                { selected: true, score: 0.5 },
                { selected: false, score: Number.NaN },
                { selected: true, score: 1.5 },
            ],
            "4-dyk": [
                { selected: true, score: 1 },
                { selected: true, score: 1 },
            ],
        }),
        4,
    );
});

test("selected-score total normalizes floating-point noise", () => {
    assert.equal(
        getSelectedScoreTotal({
            first: { selected: true, score: 0.1 + 0.4 },
            second: { selected: true, score: 0.2 + 0.3 },
        }),
        1,
    );
    assert.equal(
        getSelectedScoreTotal({
            first: { selected: true, score: -0 },
        }),
        0,
    );
});

test("selected-score total rejects invalid selected scores", async (t) => {
    for (const score of [
        "",
        "   ",
        null,
        undefined,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        -0.5,
        0.25,
        "not a score",
    ]) {
        await t.test(String(score), () => {
            assert.equal(
                getSelectedScoreTotal({ rule: { selected: true, score } }),
                null,
            );
        });
    }
});
