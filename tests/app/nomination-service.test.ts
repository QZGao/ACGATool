import assert from "node:assert/strict";
import test from "node:test";
import {
    createNominationService,
    REGISTRY_PAGE,
} from "../../src/app/nomination-service.ts";
import type {
    NominationService,
    ScoreDelta,
} from "../../src/app/nomination-service.ts";
import type {
    NominationData,
    NominationDialogs,
    NominationTarget,
} from "../../src/features/nomination/contracts.ts";
import type {
    EditPageOptions,
    PageSnapshot,
} from "../../src/platform/mediawiki/api.ts";
import { NominationRuleSet } from "../../src/domain/rules.ts";
import { queryEntry } from "../../src/domain/wikitext.ts";
import { createTranslator } from "../../src/i18n/index.ts";

const DATE = "9月27日";
function registry(check = "") {
    return `Lead\n=== ${DATE} ===\n{{ACG提名2\n|條目名稱1=A\n|用戶名稱1=Example\n|提名理由1={{ACG提名2/request|ver=1|1a}}\n|核對用1=${check}\n|條目名稱2=B\n|用戶名稱2=Example\n|提名理由2={{ACG提名2/request|ver=1|1a}}\n|核對用2=\n}}\n'''提名人：''' Example 2026年9月27日 (日) 12:00 (UTC)\n`;
}
function draft(pageName = "A", code = "1a", selected = true): NominationData {
    const rule = NominationRuleSet().ruleDict[code];
    return {
        pageName,
        awarder: "Example",
        ruleStatus: {
            [code]: {
                selected,
                score: rule.score,
                desc: rule.label,
                ogDesc: rule.label,
                maxScore: rule.score,
            },
        },
    };
}
function fixture(text = registry()) {
    const pages = new Map<string, PageSnapshot>([
        [REGISTRY_PAGE, { exists: true, text, revisionId: 10 }],
    ]);
    const edits: Array<{
        title: string;
        text: string;
        options: EditPageOptions;
    }> = [];
    const scores: Array<{ deltas: ScoreDelta[]; revision: string | number }> =
        [];
    const previews: Array<{ text: string; title: string }> = [];
    const notices: string[] = [];
    const failures: string[] = [];
    let reloads = 0;
    let scoreFails = false;
    const dialogs: NominationDialogs = {
        showNewNominationDialog: async () => "cancel",
        showEditNominationDialog: async () => "cancel",
        showCheckNominationDialog: async (data, target) => {
            assert.equal(
                edits.length,
                0,
                "batch must not write while collecting decisions",
            );
            await service.saveNominationCheck(draft(data.pageName), target);
            return "save";
        },
        showConfirmDialog: async () => true,
        dispose() {},
    };
    const service: NominationService = createNominationService({
        dialogs,
        msg: createTranslator("zh-Hant").msg,
        now: () => new Date("2026-09-27T23:00:00Z"),
        notify: (message) => {
            notices.push(message);
        },
        reportError: (_cause, op) => {
            failures.push(op);
        },
        reload: () => {
            reloads++;
        },
        api: {
            async parseWikitext(text, title) {
                previews.push({ text, title });
                return "<div>Rendered nomination</div>";
            },
            async getPageSnapshot(title = REGISTRY_PAGE) {
                return {
                    ...(pages.get(title) ?? {
                        exists: false,
                        text: "",
                        revisionId: null,
                    }),
                };
            },
            async editPage(title, newText, _summary, options = {}) {
                edits.push({ title, text: newText, options });
                pages.set(title, {
                    exists: true,
                    text: newText,
                    revisionId: 11,
                });
                return { success: true, newRevId: 11, errorCode: null };
            },
            async editACGAScoreListBatch(deltas, revision) {
                scores.push({ deltas, revision });
                return scoreFails;
            },
        },
    });
    return {
        service,
        pages,
        edits,
        scores,
        previews,
        notices,
        failures,
        dialogs,
        get reloads() {
            return reloads;
        },
        set scoreFails(value: boolean) {
            scoreFails = value;
        },
    };
}
const selections = [1, 2].map((index) => ({
    date: DATE,
    index,
    sectionOccurrence: 0,
    expectedRevisionId: 10,
}));

test("new nomination preview renders the exact later submission without any edits", async () => {
    const f = fixture();
    const nominations = Array.from({ length: 26 }, (_, index) =>
        draft(`Article ${index + 1}`),
    );
    const preview = await f.service.previewNewNomination(
        nominations,
        " : Extra explanation ",
    );
    assert.deepEqual(f.previews, [
        { title: REGISTRY_PAGE, text: preview.wikitext },
    ]);
    assert.equal(preview.html, "<div>Rendered nomination</div>");
    assert.equal((preview.wikitext.match(/\{\{ACG提名2\n/gu) ?? []).length, 2);
    assert.ok(
        preview.wikitext.endsWith(
            "\n}}\n'''提名人：'''~~~~\n: {{說明}}：Extra explanation--~~~~",
        ),
    );
    assert.equal(f.edits.length, 0);
    assert.equal(f.scores.length, 0);
    assert.equal(f.reloads, 0);
    assert.equal(f.notices.length, 0);
    assert.equal(
        await f.service.saveNewNomination(nominations, " : Extra explanation "),
        false,
    );
    assert.equal(f.edits.length, 1);
    assert.ok(f.edits[0].text.includes(preview.wikitext));
});

test("invalid preview drafts are rejected before requesting a parse or editing pages", async () => {
    const f = fixture();
    const invalid = draft();
    invalid.ruleStatus["1a"].score = 0.25;
    await assert.rejects(f.service.previewNewNomination([invalid]));
    assert.equal(f.previews.length, 0);
    assert.equal(f.edits.length, 0);
    assert.equal(f.scores.length, 0);
    assert.equal(f.reloads, 0);
});

test("zero-total author nominations cannot be previewed, submitted or saved as edits", async () => {
    for (const code of ["1a", "5", "6", "7", "8"]) {
        const f = fixture();
        const zero = draft("A", code);
        zero.ruleStatus[code].score = 0;
        await assert.rejects(f.service.previewNewNomination([zero]));
        assert.equal(await f.service.saveNewNomination([zero]), true);
        assert.equal(
            await f.service.saveModifiedNomination(
                zero,
                queryEntry(registry(), DATE, 1),
            ),
            true,
        );
        assert.equal(f.previews.length, 0);
        assert.equal(f.edits.length, 0);
        assert.equal(f.scores.length, 0);
        assert.equal(f.reloads, 0);
    }
});

test("zero-score checks remain valid and positive nominations may include zero-valued items", async () => {
    const check = fixture();
    const zero = draft();
    zero.ruleStatus["1a"].score = 0;
    assert.equal(
        await check.service.saveNominationCheck(
            zero,
            queryEntry(registry(), DATE, 1),
        ),
        false,
    );
    assert.equal(check.edits.length, 1);
    assert.ok(check.edits[0].text.includes("1a[0]"));

    const author = fixture();
    const positive = draft("A", "6");
    positive.ruleStatus["6"].score = 0;
    Object.assign(positive.ruleStatus, draft("A", "6-fp").ruleStatus);
    const preview = await author.service.previewNewNomination([positive]);
    assert.ok(preview.wikitext.includes("6[0] 6-fp"));
    assert.equal(await author.service.saveNewNomination([positive]), false);
    assert.equal(author.edits.length, 1);
});

test("explicit nomination tables retain separate comments in one combined preview and registration edit", async () => {
    const f = fixture();
    const tables = [
        {
            nominations: Array.from({ length: 26 }, (_, index) =>
                draft(`First group ${index + 1}`),
            ),
            comment: "First table explanation",
        },
        {
            nominations: [draft("Second group")],
            comment: "Second table explanation",
        },
    ];
    const preview = await f.service.previewNewNomination(tables);
    const source = preview.wikitext;
    assert.equal((source.match(/\{\{ACG提名2\n/gu) ?? []).length, 3);
    assert.equal((source.match(/'''提名人：'''/gu) ?? []).length, 2);
    assert.equal(source.includes("|條目名稱26"), false);
    assert.ok(source.includes("|條目名稱1 = First group 26"));
    assert.ok(
        source.includes(
            "\n}}\n'''提名人：'''~~~~\n: {{說明}}：First table explanation--~~~~\n\n{{ACG提名2\n|條目名稱1 = Second group",
        ),
    );
    assert.ok(
        source.endsWith(
            "\n}}\n'''提名人：'''~~~~\n: {{說明}}：Second table explanation--~~~~",
        ),
    );
    assert.deepEqual(f.previews, [{ text: source, title: REGISTRY_PAGE }]);
    assert.equal(f.edits.length, 0);
    assert.equal(f.scores.length, 0);
    assert.equal(await f.service.saveNewNomination(tables), false);
    assert.equal(f.edits.length, 1);
    assert.ok(f.edits[0].text.includes(source));
    assert.equal(f.scores.length, 0);
});

test("an invalid later table prevents preview and the entire batch submission", async () => {
    for (const nominations of [[], [{ ...draft("Invalid"), awarder: "" }]]) {
        const f = fixture();
        const tables = [
            { nominations: [draft("Valid")], comment: "First comment" },
            { nominations, comment: "Invalid table comment" },
        ];
        await assert.rejects(f.service.previewNewNomination(tables));
        assert.equal(await f.service.saveNewNomination(tables), true);
        assert.equal(f.previews.length, 0);
        assert.equal(f.edits.length, 0);
        assert.equal(f.scores.length, 0);
        assert.equal(f.reloads, 0);
    }
});

test("a complete batch writes the registry once and updates all scores in one call", async () => {
    const f = fixture();
    assert.equal(await f.service.checkBatch(selections), true);
    assert.equal(f.edits.length, 1);
    assert.deepEqual(f.edits[0].options, { baseRevisionId: 10 });
    assert.match(f.edits[0].text, /核對用1=\{\{ACG提名2\/check/u);
    assert.match(f.edits[0].text, /核對用2=\{\{ACG提名2\/check/u);
    assert.equal(f.scores.length, 1);
    assert.equal(
        f.scores[0].deltas.reduce((sum, item) => sum + item.score, 0),
        2,
    );
    assert.equal(f.reloads, 1);
});

test("cancelling the second item discards the entire cached batch", async () => {
    const f = fixture();
    let count = 0;
    f.dialogs.showCheckNominationDialog = async (data, target) => {
        if (count++ === 1) return "cancel";
        await f.service.saveNominationCheck(draft(data.pageName), target);
        return "save";
    };
    assert.equal(await f.service.checkBatch(selections), false);
    assert.equal(f.edits.length, 0);
    assert.equal(f.scores.length, 0);
    // A fresh attempt proves the previous cache and lock have both been released.
    await f.service.saveNominationCheck(
        draft(),
        queryEntry(registry(), DATE, 1),
    );
    assert.equal(f.edits.length, 1);
});

test("skipped items are excluded and duplicate selections are deduplicated", async () => {
    const f = fixture();
    f.dialogs.showCheckNominationDialog = async (data, target) => {
        if (data.pageName === "B") return "skip";
        await f.service.saveNominationCheck(draft(), target);
        return "save";
    };
    await f.service.checkBatch([...selections, selections[0]]);
    assert.equal(f.edits.length, 1);
    assert.equal(f.scores[0].deltas.length, 1);
    assert.match(f.edits[0].text, /核對用2=\n/u);
});

test("an edit to a cached nomination aborts the entire batch", async () => {
    const f = fixture();
    f.dialogs.showCheckNominationDialog = async (data, target) => {
        await f.service.saveNominationCheck(draft(data.pageName), target);
        if (data.pageName === "B")
            f.pages.set(REGISTRY_PAGE, {
                exists: true,
                text: registry().replace("條目名稱1=A", "條目名稱1=Changed"),
                revisionId: 12,
            });
        return "save";
    };
    assert.equal(await f.service.checkBatch(selections), false);
    assert.equal(f.edits.length, 0);
    assert.equal(f.scores.length, 0);
});

test("a stale rendered revision is refused before any dialog opens", async () => {
    const f = fixture();
    f.dialogs.showCheckNominationDialog = async () => {
        assert.fail("stale page opened a dialog");
    };
    assert.equal(
        await f.service.checkBatch([
            { ...selections[0], expectedRevisionId: 9 },
        ]),
        false,
    );
    assert.equal(f.edits.length, 0);
});

test("rechecking uses the score difference, including withdrawing a score", async () => {
    const text = registry("{{ACG提名2/check|ver=1|1a}}--signature");
    const f = fixture(text);
    await f.service.saveNominationCheck(
        draft("A", "1a", false),
        queryEntry(text, DATE, 1),
    );
    assert.deepEqual(f.scores[0].deltas, [{ userName: "Example", score: -1 }]);
    const same = fixture(text);
    await same.service.saveNominationCheck(draft(), queryEntry(text, DATE, 1));
    assert.equal(
        same.scores.length,
        0,
        "unchanged totals must not be added twice",
    );
});

test("unrecognized previous checks save with a manual reconciliation notice", async () => {
    const text = registry("Manually checked: three points");
    const f = fixture(text);
    assert.equal(
        await f.service.saveNominationCheck(draft(), queryEntry(text, DATE, 1)),
        false,
    );
    assert.equal(f.edits.length, 1);
    assert.equal(f.scores.length, 0);
    assert.equal(f.reloads, 0);
    assert.ok(f.notices.some((message) => message.includes("手動")));
});

test("a failed score-list update does not retry the committed registry edit", async () => {
    const f = fixture();
    f.scoreFails = true;
    assert.equal(
        await f.service.saveNominationCheck(
            draft(),
            queryEntry(registry(), DATE, 1),
        ),
        false,
    );
    assert.equal(f.edits.length, 1);
    assert.equal(f.scores.length, 1);
    assert.equal(f.reloads, 0);
    assert.ok(f.notices.some((message) => message.includes("勿重複提交")));
});

test("correcting a nomination while checking transfers the recognized score to the corrected recipient", async () => {
    const text = registry("{{ACG提名2/check|ver=1|1a}}--signature");
    const f = fixture(text);
    const corrected = {
        ...draft("Corrected title"),
        awarder: "Corrected user",
        replaceRequestReason: true,
        requestReasonText: "1a",
    };
    assert.equal(
        await f.service.saveNominationCheck(
            corrected,
            queryEntry(text, DATE, 1),
        ),
        false,
    );
    assert.equal(f.edits.length, 1);
    assert.match(f.edits[0].text, /條目名稱1=Corrected title/u);
    assert.match(f.edits[0].text, /用戶名稱1=Corrected user/u);
    assert.deepEqual(f.scores[0].deltas, [
        { userName: "Example", score: -1 },
        { userName: "Corrected user", score: 1 },
    ]);
});

test("new batches beyond the template's 25-item limit are split into visible tables", async () => {
    const f = fixture();
    assert.equal(
        await f.service.saveNewNomination(
            Array.from({ length: 26 }, (_, i) => draft(`Article ${i + 1}`)),
        ),
        false,
    );
    assert.equal(f.edits.length, 1);
    assert.equal((f.edits[0].text.match(/\{\{ACG提名2\n/gu) ?? []).length, 3);
    assert.match(f.edits[0].text, /條目名稱1 = Article 26/u);
    assert.doesNotMatch(f.edits[0].text, /條目名稱26/u);
});

test("write services refuse multiple rule groups in one nomination", async () => {
    const f = fixture();
    const mixed = draft();
    Object.assign(mixed.ruleStatus, draft("A", "7").ruleStatus);
    assert.equal(await f.service.saveNewNomination([mixed]), true);
    assert.equal(
        await f.service.saveModifiedNomination(
            mixed,
            queryEntry(registry(), DATE, 1),
        ),
        true,
    );
    assert.equal(
        await f.service.saveNominationCheck(
            mixed,
            queryEntry(registry(), DATE, 1),
        ),
        true,
    );
    assert.equal(f.edits.length, 0);
});

test("archiving writes the destination before removing the exact source section", async () => {
    const f = fixture();
    await f.service.archiveChapter(DATE, 0, 10);
    assert.equal(f.edits.length, 2);
    assert.match(f.edits[0].title, /存檔\/2026年9月/u);
    assert.match(f.edits[0].text, /\{\{Talk archive/u);
    assert.deepEqual(f.edits[0].options, { createOnly: true });
    assert.equal(f.edits[1].title, REGISTRY_PAGE);
    assert.doesNotMatch(f.edits[1].text, /ACG提名2/u);
});

for (const check of [true, false])
    test(`raw check edits require manual reconciliation in ${check ? "check" : "edit"} mode`, async () => {
        const f = fixture();
        const target = queryEntry(registry(), DATE, 1) as NominationTarget;
        await f.service.saveRawNominationSource(
            {
                條目名稱: "A",
                用戶名稱: "Example",
                提名理由: "{{ACG提名2/request|ver=1|1a}}",
                核對用: "Manual check",
            },
            target,
            { check },
        );
        assert.equal(f.edits.length, 1);
        assert.equal(f.scores.length, 0);
        assert.equal(f.reloads, 0);
        assert.ok(f.notices.some((message) => message.includes("手動")));
    });
