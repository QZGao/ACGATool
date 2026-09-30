import assert from "node:assert/strict";
import test from "node:test";
import { formatNominationEditSummary } from "../../src/domain/edit-summary.ts";
import { withToolAttribution } from "../../src/domain/wikitext.ts";
import { NominationRuleSet } from "../../src/domain/rules.ts";

const attribution = "([[User:SuperGrey/gadgets/ACGATool|ACGATool]] modified)";

function nomination(awarder: string, pageName: string, score = 5) {
    const { ruleDict } = NominationRuleSet();
    return {
        awarder,
        pageName,
        ruleStatus: Object.fromEntries(
            ["1a", "1b", "1c", "2-c", "4-dyk"].map((code) => [
                code,
                {
                    selected: true,
                    score: score / 5,
                    maxScore: ruleDict[code].score,
                    desc: ruleDict[code].label,
                    ogDesc: ruleDict[code].label,
                },
            ]),
        ),
    };
}

function body(summary: string): string {
    assert.ok(Buffer.byteLength(summary, "utf8") <= 255);
    assert.ok(summary.endsWith(` ${attribution}`));
    assert.equal(summary.split(attribution).length, 2);
    assert.equal(summary.isWellFormed(), true);
    return summary.slice(0, -(attribution.length + 1));
}

test("short nomination summaries include linked recipients, articles, selected codes and scores", () => {
    assert.equal(
        body(formatNominationEditSummary([nomination("創作者甲", "條目")])),
        "新提名：[[User:創作者甲|創作者甲]]：[[條目]]（1a+1b+1c+2-c+4-dyk，5分）",
    );
});

test("summaries omit only rule codes before removing article links", () => {
    const title = "條".repeat(10);
    const result = body(
        formatNominationEditSummary([
            nomination("創作者甲", title),
            nomination("創作者乙", title),
        ]),
    );
    assert.ok(result.includes(`[[${title}]]`));
    assert.ok(result.includes("[[User:創作者甲|創作者甲]]"));
    assert.ok(result.includes("（5分）"));
    assert.equal(result.includes("1a"), false);
});

test("larger summaries omit titles and preserve linked recipients and each nomination score", () => {
    const items = [
        nomination("創作者甲", "很長的條目".repeat(20), 5),
        nomination("User:創作者甲", "另一長條目".repeat(20), 10),
        nomination("創作者乙", "第三條目".repeat(20), 15),
    ];
    assert.equal(
        body(formatNominationEditSummary(items)),
        "新提名：2人3項：[[User:創作者甲|創作者甲]]（5+10分）；[[User:創作者乙|創作者乙]]（15分）",
    );
});

test("links are removed before compressing individual scores to recipient totals", () => {
    const items = Array.from({ length: 30 }, (_, index) =>
        nomination(`創作者${index % 3}`, "長條目".repeat(100)),
    );
    const result = body(formatNominationEditSummary(items));
    assert.ok(result.startsWith("新提名：3人30項：創作者0（5+5+5"));
    assert.equal(result.includes("[["), false);
    assert.equal((result.match(/5/gu) ?? []).length, 30);
});

test("recipient totals replace long score sums before compressing to the overall total", () => {
    const items = Array.from({ length: 70 }, (_, index) =>
        nomination(`創作者${index % 3}`, "長條目".repeat(100)),
    );
    assert.equal(
        body(formatNominationEditSummary(items)),
        "新提名：3人70項：創作者0（120分）；創作者1（115分）；創作者2（115分）",
    );
    assert.equal(
        body(
            formatNominationEditSummary([
                nomination("姓名很長".repeat(30), "長條目".repeat(100)),
                nomination("另一姓名".repeat(30), "長條目".repeat(100)),
            ]),
        ),
        "新提名：2人2項：總分10分",
    );
});

test("unknown scores never produce a fabricated overall total", () => {
    assert.equal(
        body(
            formatNominationEditSummary([
                { awarder: "很長姓名".repeat(30), pageName: "條目", score: 5 },
                { awarder: "另一姓名".repeat(30), pageName: "另一條目" },
            ]),
        ),
        "新提名：2人2項",
    );
    assert.equal(
        body(
            formatNominationEditSummary([
                {
                    awarder: "很長姓名".repeat(30),
                    pageName: "條目",
                    score: Number.MAX_VALUE,
                },
                {
                    awarder: "另一姓名".repeat(30),
                    pageName: "另一條目",
                    score: Number.MAX_VALUE,
                },
            ]),
        ),
        "新提名：2人2項",
    );
});

test("the final counts fallback fits when the action consumes the score budget", () => {
    const counts = "：1人1項";
    const action = "a".repeat(
        255 - Buffer.byteLength(` ${attribution}`) - Buffer.byteLength(counts),
    );
    const item = nomination("姓名很長".repeat(30), "長條目".repeat(100));
    assert.equal(
        body(formatNominationEditSummary([item], action)),
        `${action}${counts}`,
    );
    assert.equal(
        body(formatNominationEditSummary([item], "超長操作".repeat(100))),
        "1人1項",
    );
});

test("UTF-8 byte limits include Chinese, emoji and the attribution at the exact boundary", () => {
    const available = 255 - Buffer.byteLength(` ${attribution}`);
    const fits = `${"字".repeat(30)}😀${"a".repeat(available - 94)}`;
    const summary = withToolAttribution(fits);
    assert.equal(Buffer.byteLength(summary), 255);
    assert.equal(body(summary), fits);
    const oversized = withToolAttribution(`${fits}😀`);
    assert.ok(body(oversized).endsWith("…"));
    assert.equal(oversized.isWellFormed(), true);
});

test("other edit summaries drop complete links and retain safe Unicode when shortened", () => {
    const linked = `[[User:${"a".repeat(180)}|創作者]]：[[條目]]`;
    assert.equal(body(withToolAttribution(linked)), "創作者：條目");
    assert.ok(body(withToolAttribution("😀".repeat(100))).endsWith("…"));
});

test("custom contributions are described without linking the placeholder or injecting wikitext", () => {
    const item = nomination("User:Example|[[別人]]", "其他");
    item.ruleStatus = {
        "8": {
            selected: true,
            score: 5,
            maxScore: 5,
            desc: "改善{{專題}}|[[導覽]]\n內容",
            ogDesc: "其他",
        },
    };
    const result = body(formatNominationEditSummary([item]));
    assert.ok(result.includes("改善 專題 導覽 內容"));
    assert.ok(result.includes("（8，5分）"));
    assert.equal(result.includes("[[其他]]"), false);
    assert.equal(result.includes("{{"), false);
    assert.equal(result.includes("|[["), false);
});
