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
function fixture(text = registry(), userName: string | null = null) {
    const pages = new Map<string, PageSnapshot>([
        [REGISTRY_PAGE, { exists: true, text, revisionId: 10 }],
    ]);
    const edits: Array<{
        title: string;
        text: string;
        summary: string;
        options: EditPageOptions;
    }> = [];
    const scores: Array<{
        deltas: ScoreDelta[];
        revision: string | number;
        recheck?: boolean;
    }> = [];
    const previews: Array<{ text: string; title: string }> = [];
    const notices: string[] = [];
    const failures: string[] = [];
    let reloads = 0;
    let scoreFails = false;
    let registryFailures = 0;
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
        getUserName: () => userName,
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
            async editPage(title, newText, summary, options = {}) {
                edits.push({ title, text: newText, summary, options });
                if (registryFailures > 0) {
                    registryFailures--;
                    return {
                        success: false,
                        newRevId: null,
                        errorCode: "readonly",
                    };
                }
                pages.set(title, {
                    exists: true,
                    text: newText,
                    revisionId: 11,
                });
                return { success: true, newRevId: 11, errorCode: null };
            },
            async editACGAScoreListBatch(
                deltas,
                revision,
                _commentId,
                recheck,
            ) {
                scores.push({
                    deltas,
                    revision,
                    ...(recheck ? { recheck } : {}),
                });
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
        set registryFailures(value: number) {
            registryFailures = value;
        },
    };
}
const selections = [1, 2].map((index) => ({
    date: DATE,
    index,
    sectionOccurrence: 0,
    expectedRevisionId: 10,
}));

test("existing-nomination lookup reads active registry without editing and rejects a stale rendered revision", async () => {
    const f = fixture(registry("{{ACG提名2/check|ver=1|1a}}--~~~~"));
    const matches = await f.service.getExistingNominations("a", 10);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].checked, true);
    assert.equal(matches[0].date, DATE);
    assert.equal((await f.service.getExistingNominations()).length, 2);
    await assert.rejects(
        f.service.getExistingNominations(undefined, 9),
        /登記處/u,
    );
    assert.equal(f.edits.length, 0);
    assert.equal(f.scores.length, 0);
});

test("new and modified nominations write complete attributed summaries within 255 UTF-8 bytes", async () => {
    const f = fixture();
    await f.service.saveNewNomination([draft("簡短條目")]);
    assert.match(
        f.edits[0].summary,
        /\[\[User:Example\|Example\]\]：\[\[簡短條目\]\]（1a，1分）/u,
    );
    const modified = {
        ...draft("長條目".repeat(100)),
        awarder: "得分者".repeat(100),
    };
    await f.service.saveModifiedNomination(
        modified,
        queryEntry(registry(), DATE, 1),
    );
    assert.match(f.edits[1].summary, /^編輯提名：1人1項：總分1分 /u);
    for (const edit of f.edits) {
        assert.ok(Buffer.byteLength(edit.summary, "utf8") <= 255);
        assert.match(
            edit.summary,
            /\(\[\[User:SuperGrey\/gadgets\/ACGATool\|ACGATool\]\] modified\)$/u,
        );
    }
});

test("batch check summaries use only staged rows and their checked scores", async () => {
    const f = fixture();
    f.dialogs.showCheckNominationDialog = async (data, target) => {
        if (data.pageName === "B") return "skip";
        await f.service.saveNominationCheck(draft("A"), target);
        return "save";
    };
    await f.service.checkBatch(selections);
    assert.equal(f.edits.length, 1);
    assert.match(
        f.edits[0].summary,
        /^批次核對：\[\[User:Example\|Example\]\]：\[\[A\]\]（1a，1分） /u,
    );
    assert.equal(f.edits[0].summary.includes("[[B]]"), false);
    assert.ok(Buffer.byteLength(f.edits[0].summary, "utf8") <= 255);
});

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

test("the grouped batch dialog preserves physical table identity and commits only once", async () => {
    const extra = registry()
        .replace(`Lead\n=== ${DATE} ===\n`, "")
        .replace("條目名稱1=A", "條目名稱1=C")
        .replace("條目名稱2=B", "條目名稱2=D");
    const f = fixture(registry() + extra);
    f.dialogs.showCheckNominationDialog = async () => {
        assert.fail("grouped checking opened a separate item dialog");
    };
    f.dialogs.showCheckBatchDialog = async (entries) => {
        assert.deepEqual(
            entries.map((entry) => [
                entry.nomination.pageName,
                entry.tableIndex,
            ]),
            [
                ["A", 0],
                ["B", 0],
                ["C", 1],
            ],
        );
        assert.equal(entries[0].tableKey, entries[1].tableKey);
        assert.notEqual(entries[1].tableKey, entries[2].tableKey);
        for (const { nomination, target } of entries) {
            await f.service.saveNominationCheck(
                draft(nomination.pageName),
                structuredClone(target),
            );
        }
        assert.equal(f.edits.length, 0);
        assert.equal(await f.service.completeNominationCheckBatch(), false);
        assert.equal(await f.service.completeNominationCheckBatch(), false);
        return "save";
    };
    assert.equal(
        await f.service.checkBatch(
            [3, 2, 1].map((index) => ({ ...selections[0], index })),
        ),
        true,
    );
    assert.equal(f.edits.length, 1);
    assert.equal(f.scores.length, 1);
    assert.equal(
        f.scores[0].deltas.reduce((sum, item) => sum + item.score, 0),
        3,
    );
});

test("revisiting a checked draft replaces its staged result and skipping removes a prior result", async () => {
    const f = fixture();
    f.dialogs.showCheckBatchDialog = async (entries) => {
        const first = entries[0];
        const second = entries[1];
        await f.service.saveNominationCheck(draft("A"), first.target);
        await f.service.saveNominationCheck(
            draft("A", "1b"),
            structuredClone(first.target),
        );
        await f.service.saveNominationCheck(draft("B"), second.target);
        f.service.discardNominationCheck(structuredClone(second.target));
        assert.equal(await f.service.completeNominationCheckBatch(), false);
        return "save";
    };
    assert.equal(await f.service.checkBatch(selections), true);
    assert.equal(f.edits.length, 1);
    assert.match(
        f.edits[0].text,
        /核對用1=\{\{ACG提名2\/check\|ver=1\|1b\}\}/u,
    );
    assert.match(f.edits[0].text, /核對用2=\n/u);
    assert.equal(f.scores.length, 1);
    assert.deepEqual(f.scores[0].deltas, [{ userName: "Example", score: 2 }]);
});

test("grouped batch cancellation discards staged decisions", async () => {
    const f = fixture();
    f.dialogs.showCheckBatchDialog = async (entries) => {
        await f.service.saveNominationCheck(draft(), entries[0].target);
        return "cancel";
    };
    assert.equal(await f.service.checkBatch(selections), false);
    assert.equal(f.edits.length, 0);
    assert.equal(f.scores.length, 0);
});

test("quitting submits only the staged checks and leaves pending nominations unchanged", async () => {
    const f = fixture();
    f.dialogs.showCheckBatchDialog = async (entries) => {
        await f.service.saveNominationCheck(draft(), entries[0].target);
        assert.equal(f.edits.length, 0);
        assert.equal(await f.service.completeNominationCheckBatch(), false);
        return "quit";
    };
    assert.equal(await f.service.checkBatch(selections), true);
    assert.equal(f.edits.length, 1);
    assert.match(f.edits[0].text, /核對用2=\n/u);
    assert.deepEqual(f.scores[0].deltas, [{ userName: "Example", score: 1 }]);
});

test("grouped completion retains staged results after a registry failure and retries safely", async () => {
    const f = fixture();
    f.registryFailures = 1;
    f.dialogs.showCheckBatchDialog = async (entries) => {
        for (const { nomination, target } of entries)
            await f.service.saveNominationCheck(
                draft(nomination.pageName),
                target,
            );
        assert.equal(await f.service.completeNominationCheckBatch(), true);
        assert.equal(f.scores.length, 0);
        assert.equal(await f.service.completeNominationCheckBatch(), false);
        return "save";
    };
    assert.equal(await f.service.checkBatch(selections), true);
    assert.equal(f.edits.length, 2);
    assert.equal(f.scores.length, 1);
    assert.equal(
        f.scores[0].deltas.reduce((sum, item) => sum + item.score, 0),
        2,
    );
});

test("grouped partial score failure does not replay the committed registry or scores", async () => {
    const f = fixture();
    f.scoreFails = true;
    f.dialogs.showCheckBatchDialog = async (entries) => {
        await f.service.saveNominationCheck(draft(), entries[0].target);
        assert.equal(await f.service.completeNominationCheckBatch(), false);
        assert.equal(await f.service.completeNominationCheckBatch(), false);
        return "save";
    };
    assert.equal(await f.service.checkBatch(selections), true);
    assert.equal(f.edits.length, 1);
    assert.equal(f.scores.length, 1);
    assert.equal(f.reloads, 0);
    assert.ok(f.notices.some((message) => message.includes("勿重複提交")));
});

test("rechecking a saved score applies only its negative difference and identifies the recheck", async () => {
    const f = fixture(registry("{{ACG提名2/check|ver=1|1b}}--signature"));
    assert.equal(
        await f.service.saveNominationCheck(
            draft(),
            queryEntry(f.pages.get(REGISTRY_PAGE)!.text, DATE, 1),
        ),
        false,
    );
    assert.deepEqual(f.scores[0].deltas, [{ userName: "Example", score: -1 }]);
    assert.equal(f.scores[0].recheck, true);
    assert.match(f.edits[0].summary, /^復核分數：/u);
});

test("mixed initial checks and rechecks use one combined score update and summary", async () => {
    const f = fixture(registry("{{ACG提名2/check|ver=1|1b}}--signature"));
    assert.equal(await f.service.checkBatch(selections), true);
    assert.equal(f.edits.length, 1);
    assert.equal(f.scores.length, 1);
    assert.deepEqual(f.scores[0].deltas, [
        { userName: "Example", score: -1 },
        { userName: "Example", score: 1 },
    ]);
    assert.match(f.edits[0].summary, /^批次核對與復核：/u);
    assert.equal(f.scores[0].recheck, true);
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

function archivableRegistry(
    firstCheck = "{{ACG提名2/check|ver=1|1a}}--Reviewer 2026年9月10日 (四) 12:00 (UTC)",
    secondCheck = firstCheck,
) {
    return registry(firstCheck)
        .replace("|核對用2=\n", `|核對用2=${secondCheck}\n`)
        .replace("Example 2026年9月27日", "Example 2026年9月9日");
}

test("archiving writes the destination before removing the exact source section", async () => {
    const f = fixture(archivableRegistry());
    await f.service.archiveChapter(DATE, 0, 10);
    assert.equal(f.edits.length, 2);
    assert.match(f.edits[0].title, /存檔\/2026年9月/u);
    assert.match(f.edits[0].text, /\{\{Talk archive/u);
    assert.deepEqual(f.edits[0].options, { createOnly: true });
    assert.equal(f.edits[1].title, REGISTRY_PAGE);
    assert.doesNotMatch(f.edits[1].text, /ACG提名2/u);
});

for (const [label, text] of [
    ["pending nomination", archivableRegistry(undefined, "")],
    [
        "review exactly seven days old",
        archivableRegistry(
            "{{ACG提名2/check|ver=1|1a}}--Reviewer 2026年9月20日 (日) 23:00 (UTC)",
        ),
    ],
    [
        "future review",
        archivableRegistry(
            "{{ACG提名2/check|ver=1|1a}}--Reviewer 2026年9月28日 (一) 12:00 (UTC)",
        ),
    ],
    [
        "active recheck",
        archivableRegistry(
            "{{ACG提名2/check|ver=1|1a|status=rechecking}}--Reviewer 2026年9月10日 (四) 12:00 (UTC)",
        ),
    ],
    ["unsigned review", archivableRegistry("Manual result")],
] as const)
    test(`archiving refuses ${label} before any wiki write`, async () => {
        const f = fixture(text);
        await f.service.archiveChapter(DATE, 0, 10);
        assert.equal(f.edits.length, 0);
        assert.equal(f.reloads, 0);
        assert.equal(f.notices.length, 1);
        assert.equal(f.failures.length, 0);
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

function signedRegistry(
    entries: Array<{ pageName: string; awarder: string; nominator: string }>,
) {
    return `=== ${DATE} ===\n${entries
        .map(
            ({ pageName, awarder, nominator }) =>
                `{{ACG提名2\n|條目名稱1=${pageName}\n|用戶名稱1=${awarder}\n|提名理由1={{ACG提名2/request|ver=1|1a}}\n|核對用1=\n}}\n'''提名人：''' [[User:${nominator}|${nominator}]] 2026年9月27日 (UTC)\n`,
        )
        .join("\n")}`;
}

for (const ownership of ["nomination", "score", "both"] as const)
    test(`own ${ownership} prevents opening or directly saving a check`, async () => {
        const text = signedRegistry([
            {
                pageName: "A",
                awarder: ownership === "nomination" ? "Example" : "Reviewer",
                nominator: ownership === "score" ? "Other" : "Reviewer",
            },
        ]);
        const f = fixture(text, "Reviewer");
        f.dialogs.showCheckNominationDialog = async () => {
            assert.fail("a restricted nomination opened a check dialog");
        };
        assert.equal(await f.service.checkNomination(selections[0]), "cancel");
        assert.equal(
            await f.service.saveNominationCheck(
                draft(),
                queryEntry(text, DATE, 1),
            ),
            true,
        );
        assert.equal(f.edits.length, 0);
        assert.equal(f.scores.length, 0);
        assert.equal(f.notices.length, 2);
    });

test("mixed batches skip self nominations and self scores while numbering only eligible checks", async () => {
    const text = signedRegistry([
        {
            pageName: "Own nomination",
            awarder: "Example",
            nominator: "Reviewer",
        },
        { pageName: "Own score", awarder: "Reviewer", nominator: "Other" },
        { pageName: "Eligible", awarder: "Example", nominator: "Other" },
    ]);
    const f = fixture(text, "Reviewer");
    const opened: Array<unknown> = [];
    f.dialogs.showCheckNominationDialog = async (data, target, progress) => {
        opened.push([data.pageName, progress]);
        assert.equal(
            await f.service.saveNominationCheck(draft(data.pageName), target),
            false,
        );
        return "save";
    };
    assert.equal(
        await f.service.checkBatch(
            [1, 2, 3].map((index) => ({ ...selections[0], index })),
        ),
        true,
    );
    assert.deepEqual(opened, [["Eligible", { current: 1, total: 1 }]]);
    assert.equal(f.edits.length, 1);
    assert.equal((f.edits[0].text.match(/ACG提名2\/check/gu) ?? []).length, 1);
    assert.deepEqual(f.scores[0].deltas, [{ userName: "Example", score: 1 }]);
});

test("a batch containing only restricted nominations opens no dialogs and writes nothing", async () => {
    const text = signedRegistry([
        { pageName: "A", awarder: "Reviewer", nominator: "Other" },
    ]);
    const f = fixture(text, "Reviewer");
    f.dialogs.showCheckNominationDialog = async () => {
        assert.fail("a restricted nomination opened a batch check dialog");
    };
    assert.equal(await f.service.checkBatch([selections[0]]), false);
    assert.equal(f.edits.length, 0);
    assert.equal(f.scores.length, 0);
});

test("correcting the score recipient to the reviewer cannot bypass the check restriction", async () => {
    const text = signedRegistry([
        { pageName: "A", awarder: "Example", nominator: "Other" },
    ]);
    const f = fixture(text, "Reviewer");
    assert.equal(
        await f.service.saveNominationCheck(
            {
                ...draft(),
                awarder: "Reviewer",
                replaceRequestReason: true,
                requestReasonText: "1a",
            },
            queryEntry(text, DATE, 1),
        ),
        true,
    );
    assert.equal(f.edits.length, 0);
    assert.equal(f.scores.length, 0);
});

test("the latest registry signature is revalidated before a check is committed", async () => {
    const text = signedRegistry([
        { pageName: "A", awarder: "Example", nominator: "Other" },
    ]);
    const f = fixture(text, "Reviewer");
    const target = queryEntry(text, DATE, 1);
    f.pages.set(REGISTRY_PAGE, {
        exists: true,
        text: text.replace(
            "[[User:Other|Other]]",
            "[[User:Reviewer|Reviewer]]",
        ),
        revisionId: 12,
    });
    assert.equal(await f.service.saveNominationCheck(draft(), target), true);
    assert.equal(f.edits.length, 0);
    assert.equal(f.scores.length, 0);
});

for (const check of [true, false])
    test(`raw check changes cannot bypass ownership restrictions in ${check ? "check" : "edit"} mode`, async () => {
        const text = signedRegistry([
            { pageName: "A", awarder: "Example", nominator: "Reviewer" },
        ]);
        const f = fixture(text, "Reviewer");
        assert.equal(
            await f.service.saveRawNominationSource(
                {
                    條目名稱: "A",
                    用戶名稱: "Example",
                    提名理由: "{{ACG提名2/request|ver=1|1a}}",
                    核對用: "Manual check",
                },
                queryEntry(text, DATE, 1),
                { check },
            ),
            true,
        );
        assert.equal(f.edits.length, 0);
        assert.equal(f.scores.length, 0);
    });

test("ownership restrictions preserve ordinary structured and raw nomination editing", async () => {
    const text = signedRegistry([
        { pageName: "A", awarder: "Reviewer", nominator: "Reviewer" },
    ]);
    const structured = fixture(text, "Reviewer");
    assert.equal(
        await structured.service.saveModifiedNomination(
            { ...draft("Edited"), awarder: "Reviewer" },
            queryEntry(text, DATE, 1),
        ),
        false,
    );
    assert.equal(structured.edits.length, 1);
    assert.equal(structured.scores.length, 0);
    const raw = fixture(text, "Reviewer");
    assert.equal(
        await raw.service.saveRawNominationSource(
            {
                條目名稱: "Edited",
                用戶名稱: "Reviewer",
                提名理由: "{{ACG提名2/request|ver=1|1a}}",
                核對用: "",
            },
            queryEntry(text, DATE, 1),
            { check: false },
        ),
        false,
    );
    assert.equal(raw.edits.length, 1);
    assert.equal(raw.scores.length, 0);
});
