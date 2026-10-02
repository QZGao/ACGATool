/**
 * @file tests/nomination/model.test.ts
 * Purpose: tests / nomination / model.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. nomination
 * 4. Test scenarios
 */

import { createTranslator } from "../../src/i18n/index.ts";
import test from "node:test";
import assert from "node:assert/strict";

import { createNominationModel } from "../../src/features/nomination/model.ts";
const { authorErrorRuleCategory, nominationPayload } = createNominationModel({
    msg: createTranslator("zh-Hant").msg,
    getUserName: () => "Example",
});

function nomination(
    ruleStatus: unknown,
    errors: unknown,
    activeRuleCategory: string,
) {
    return { ruleStatus, errors, activeRuleCategory };
}

test("作者目標錯誤會切換至顯示該欄位的規則類別", () => {
    assert.equal(
        authorErrorRuleCategory(
            nomination(
                { "1a": { selected: true } },
                { pageName: "missing" },
                "article",
            ),
        ),
        "article",
    );
    assert.equal(
        authorErrorRuleCategory(
            nomination(
                { "5": { selected: true } },
                { pageName: "missing" },
                "review",
            ),
        ),
        "review",
    );
    assert.equal(
        authorErrorRuleCategory(
            nomination(
                { "6": { selected: true } },
                { media: "missing" },
                "article",
            ),
        ),
        "media",
    );
    assert.equal(
        authorErrorRuleCategory(
            nomination(
                { "8": { selected: true } },
                { other: "missing" },
                "review",
            ),
        ),
        "other",
    );
    assert.equal(
        authorErrorRuleCategory(
            nomination(
                { "1a": { selected: true }, "5": { selected: true } },
                { pageName: "missing" },
                "review",
            ),
        ),
        "review",
    );
});

test("沒有目標欄位錯誤時保留目前規則類別", () => {
    assert.equal(
        authorErrorRuleCategory(
            nomination(
                { "5": { selected: true } },
                { rules: "invalid" },
                "article",
            ),
        ),
        "article",
    );
});

test("作者儲存資料只包含目前類別，而核對資料保留全部規則", () => {
    const draft = {
        activeRuleCategory: "review",
        awarder: "Example",
        pageName: "Example article",
        ruleStatus: {
            "1c": { selected: true, score: 0.25 },
            "5": { selected: true, score: 1 },
            "6": { selected: true, score: Number.NaN },
        },
    };

    const authorPayload = nominationPayload(draft);
    assert.equal(authorPayload.pageName, "Example article");
    assert.deepEqual(Object.keys(authorPayload.ruleStatus), ["5"]);
    assert.deepEqual(authorPayload.ruleStatus["5"], {
        selected: true,
        score: 1,
    });
    assert.equal(draft.ruleStatus["1c"].selected, true);
    assert.equal(draft.ruleStatus["1c"].score, 0.25);

    const checkPayload = nominationPayload(draft, true);
    assert.deepEqual(Object.keys(checkPayload.ruleStatus).sort(), [
        "1c",
        "5",
        "6",
    ]);
});

test("author nominations require a positive active-category total and accept blank inputs with defaults", async () => {
    const { NominationRuleSet } = await import("../../src/domain/rules.ts");
    const { ruleNames, ruleDict } = NominationRuleSet();
    const translator = createTranslator("zh-Hant");
    const model = createNominationModel({
        msg: translator.msg,
        getUserName: () => "Current user",
        getPageName: () => "Sidebar article",
    });
    for (const [category, code] of [
        ["article", "1a"],
        ["review", "5"],
        ["media", "6"],
        ["recommendation", "7"],
        ["other", "8"],
    ]) {
        const draft = model.makeAuthorNomination(null, ruleNames, ruleDict);
        draft.activeRuleCategory = category;
        draft.awarder = "   ";
        draft.pageName = "   ";
        draft.media.pageName = "   ";
        draft.otherPageName = "   ";
        draft.ruleStatus[code].selected = true;
        draft.ruleStatus[code].score = 0;
        assert.equal(model.authorValidation([draft]), draft, category);
        assert.equal(
            draft.errors.rules,
            translator.msg("nomination_score_must_be_positive"),
            category,
        );
        assert.equal(draft.errors.awarder, "", category);
        assert.equal(draft.errors.pageName, "", category);
        assert.equal(draft.errors.media, "", category);
        draft.ruleStatus[code].score = 0.5;
        assert.equal(model.authorValidation([draft]), null, category);
        assert.equal(
            model.nominationPayload(draft).awarder,
            "Current user",
            category,
        );
    }
});

test("a zero-valued item is valid with a positive selected sibling and checking still accepts zero totals", async () => {
    const { NominationRuleSet } = await import("../../src/domain/rules.ts");
    const { ruleNames, ruleDict } = NominationRuleSet();
    const model = createNominationModel({
        msg: createTranslator("zh-Hant").msg,
        getUserName: () => "Current user",
        getPageName: () => "Sidebar article",
    });
    const draft = model.makeAuthorNomination(null, ruleNames, ruleDict);
    draft.activeRuleCategory = "media";
    draft.ruleStatus["6"].score = 0;
    draft.ruleStatus["6-fp"].selected = true;
    draft.ruleStatus["6-fp"].score = 0.5;
    assert.equal(model.authorValidation([draft]), null);
    const check = model.makeCheckNomination(
        {
            awarder: "Stored user",
            pageName: "Stored article",
            ruleStatus: { "1a": { selected: true, score: 0 } },
        },
        ruleNames,
        ruleDict,
    );
    assert.equal(model.checkValidation(check), "");

    const withoutDefaults = createNominationModel({
        msg: createTranslator("zh-Hant").msg,
        getUserName: () => null,
    });
    const blank = withoutDefaults.makeAuthorNomination(
        null,
        ruleNames,
        ruleDict,
    );
    blank.ruleStatus["1a"].selected = true;
    assert.equal(withoutDefaults.authorValidation([blank]), blank);
    assert.ok(blank.errors.awarder);
    assert.ok(blank.errors.pageName);
    assert.equal(blank.errors.rules, "");
});

test("author validation collects all identity and scoring errors in field order for every draft", async () => {
    const { NominationRuleSet } = await import("../../src/domain/rules.ts");
    const translator = createTranslator("en");
    const { ruleNames, ruleDict } = NominationRuleSet(translator.msg);
    const model = createNominationModel({
        msg: translator.msg,
        getUserName: () => null,
    });
    const first = model.makeAuthorNomination(null, ruleNames, ruleDict);
    const second = model.makeAuthorNomination(null, ruleNames, ruleDict);
    assert.equal(model.authorValidation([first, second]), first);
    const expected = [
        translator.msg("enter_the_recipient"),
        translator.msg("article_title_missing"),
        translator.msg("select_at_least_one_scoring_rule"),
        translator.msg("nomination_score_must_be_positive"),
    ];
    assert.deepEqual(first.validationIssues, expected);
    assert.deepEqual(second.validationIssues, expected);
    assert.equal(first.errors.rules, expected.slice(2).join("\n"));
    assert.deepEqual(first.errors, {
        awarder: expected[0],
        pageName: expected[1],
        media: "",
        other: "",
        rules: expected.slice(2).join("\n"),
    });

    first.awarder = "Recipient";
    first.pageName = "Article";
    first.ruleStatus["1c"].selected = true;
    first.ruleStatus["1c"].score = 0.25;
    first.ruleStatus["3"].selected = true;
    first.ruleStatus["3"].score = -0.25;
    first.ruleStatus["6"].score = Number.NaN;
    model.authorValidation([first]);
    assert.deepEqual(first.validationIssues, [
        translator.msg("scoring_item_score_not_half_point", {
            item: ruleDict["1c"].label,
        }),
        translator.msg("scoring_item_score_negative", {
            item: ruleDict["3"].label,
        }),
        translator.msg("scoring_item_score_not_half_point", {
            item: ruleDict["3"].label,
        }),
        translator.msg("nomination_score_must_be_positive"),
    ]);
    first.ruleStatus["1c"].score = 0.5;
    first.ruleStatus["3"].score = 0;
    assert.equal(model.authorValidation([first]), null);
    assert.deepEqual(first.validationIssues, []);
});

test("raw author preview keeps incomplete scores and live activity and quality drafts without making them valid", async () => {
    const { NominationRuleSet, serializeNominationReason } =
        await import("../../src/domain/rules.ts");
    const translator = createTranslator("en");
    const { ruleNames, ruleDict } = NominationRuleSet(translator.msg);
    const model = createNominationModel({
        msg: translator.msg,
        getUserName: () => null,
    });
    const draft = model.makeAuthorNomination(null, ruleNames, ruleDict);
    draft.ruleStatus["1c"].selected = true;
    for (const [score, code] of [
        [0.25, "1c[0.25]"],
        [0, "1c[0]"],
        [Number.NaN, "1c[]"],
    ] as const) {
        draft.ruleStatus["1c"].score = score;
        const preview = model.authorCodePreviewResult(draft, 1, ruleNames);
        assert.equal(preview.error, "");
        assert.ok(
            preview.text.includes(
                `|提名理由1 = {{ACG提名2/request|ver=1|${code}}}`,
            ),
        );
        assert.ok(preview.text.startsWith("|條目名稱1 = \n|用戶名稱1 = \n"));
        assert.equal(preview.text.includes("NaN"), false);
        assert.equal(model.authorValidation([draft]), draft);
        if (score !== 0)
            assert.equal(
                serializeNominationReason(draft.ruleStatus, ruleNames).ok,
                false,
            );
    }

    draft.ruleStatus["1c"].selected = false;
    const activity = draft.activity.rows[0];
    activity.rule = "4";
    activity.selected = true;
    activity.choice = "";
    activity.score = "0.25";
    const activityPreview = model.authorCodePreviewResult(draft, 1, ruleNames);
    assert.ok(activityPreview.text.includes("4()[0.25]"));
    model.authorValidation([draft]);
    assert.equal(
        draft.validationIssues.filter((message: string) =>
            message.includes("Activity 1"),
        ).length,
        2,
    );

    activity.selected = false;
    activity.choice = ruleDict["4"].label;
    activity.score = ruleDict["4"].score;
    Object.assign(draft.quality, {
        enabled: true,
        fromIndex: 0,
        toIndex: 2,
        score: "0.25",
    });
    const qualityPreview = model.authorCodePreviewResult(draft, 1, ruleNames);
    assert.ok(qualityPreview.text.includes("2-c[0.25] 2-b[0]"));
    model.authorValidation([draft]);
    assert.ok(
        draft.validationIssues.includes(
            translator.msg("scoring_item_score_not_half_point", {
                item: translator.msg("total_quality_improvement_score"),
            }),
        ),
    );
});

test("raw check preview preserves original request and invalid accepted and rejected tokens", async () => {
    const {
        NominationRuleSet,
        parseReasonTokens,
        formatNominationCheckWikitext,
    } = await import("../../src/domain/rules.ts");
    const { ruleNames, ruleDict } = NominationRuleSet();
    const model = createNominationModel({
        msg: createTranslator("zh-Hant").msg,
        getUserName: () => "Checker",
    });
    const draft = model.makeCheckNomination(
        {
            awarder: "Recipient",
            pageName: "Article",
            requestReasonText: "1a 3",
            reasonParse: parseReasonTokens("1a 3", ruleDict),
        },
        ruleNames,
        ruleDict,
    );
    assert.ok(draft.ruleTokens);
    draft.ruleTokens[0].score = Number.NaN;
    draft.ruleTokens[0].desc = "自訂|說明";
    draft.ruleTokens[1].selected = false;
    draft.ruleTokens[1].score = 0.25;
    draft.message = "備註";
    const preview = model.checkCodePreviewResult(draft, 2, ruleNames, ruleDict);
    assert.equal(preview.error, "");
    assert.ok(
        preview.text.includes("|提名理由2 = {{ACG提名2/request|ver=1|1a 3}}"),
    );
    assert.ok(
        preview.text.includes(
            "{{ACG提名2/check|ver=1|1a(自訂&#124;說明)[]|no=3[0.25]}}備註--~~~~",
        ),
    );
    assert.equal(preview.text.includes("NaN"), false);
    assert.equal(
        formatNominationCheckWikitext(draft, ruleNames, ruleDict).ok,
        false,
    );
    assert.notEqual(model.checkValidation(draft), "");
});

test("mixed-tier specialist validation follows the visible writing, coverage and source row order", async () => {
    const { NominationRuleSet, parseReasonTokens } =
        await import("../../src/domain/rules.ts");
    const translator = createTranslator("en");
    const { ruleNames, ruleDict } = NominationRuleSet(translator.msg);
    const model = createNominationModel({
        msg: translator.msg,
        getUserName: () => "User",
    });
    const reason = "5a-gan 5b 5c-fac-half";
    const draft = model.makeAuthorNomination(
        {
            awarder: "User",
            pageName: "Article",
            reasonParse: parseReasonTokens(reason, ruleDict),
        },
        ruleNames,
        ruleDict,
    );
    for (const [row, code] of [
        ["writing", "5a-gan"],
        ["coverage", "5b"],
        ["source", "5c-fac-half"],
    ]) {
        draft.review.aspects[row].score = 0.25;
        draft.ruleStatus[code].score = 0.25;
    }
    model.authorValidation([draft]);
    assert.deepEqual(
        draft.validationIssues,
        ["5a-gan", "5b", "5c-fac-half"].map((code) =>
            translator.msg("scoring_item_score_not_half_point", {
                item: ruleDict[code].label,
            }),
        ),
    );
});

test("an ambiguous media target remains visible in raw preview while validation rejects it", async () => {
    const { NominationRuleSet } = await import("../../src/domain/rules.ts");
    const { ruleNames, ruleDict } = NominationRuleSet();
    const model = createNominationModel({
        msg: createTranslator("zh-Hant").msg,
        getUserName: () => "User",
    });
    const draft: any = model.makeAuthorNomination(null, ruleNames, ruleDict);
    draft.activeRuleCategory = "media";
    draft.media = {
        pageName: "",
        fileName: "Artwork.png",
        usagePageName: "Usage article",
    };
    assert.equal(model.authorValidation([draft]), draft);
    assert.notEqual(draft.errors.media, "");
    assert.ok(
        model
            .authorCodePreviewResult(draft, 1, ruleNames)
            .text.includes("|條目名稱1 = File:Artwork.png"),
    );
});

test("article and talk-page entry supplies fresh placeholders while edits retain stored titles", async () => {
    const { NominationRuleSet } = await import("../../src/domain/rules.ts");
    const { ruleNames, ruleDict } = NominationRuleSet();
    const model = createNominationModel({
        msg: createTranslator("zh-Hant").msg,
        getUserName: () => "Article editor",
        getPageName: () => "Current article",
    });
    const nomination = model.makeAuthorNomination(null, ruleNames, ruleDict);
    assert.equal(nomination.pageName, "");
    assert.equal(
        model.articlePageNamePlaceholder(nomination),
        "Current article",
    );
    assert.equal(
        model.nominationPayload(nomination).pageName,
        "Current article",
    );
    assert.equal(nomination.awarder, "");
    assert.equal(model.recipientPlaceholder(nomination), "Article editor");
    assert.equal(model.nominationPayload(nomination).awarder, "Article editor");
    const edited = model.makeAuthorNomination(
        {
            awarder: "Original user",
            pageName: "Stored article",
            ruleStatus: {},
        },
        ruleNames,
        ruleDict,
    );
    assert.equal(edited.pageName, "Stored article");
    assert.equal(model.articlePageNamePlaceholder(edited), "");
    assert.equal(edited.awarder, "Original user");
});

test("new recipient placeholders follow category and article identity without filling the input", async () => {
    const { NominationRuleSet } = await import("../../src/domain/rules.ts");
    const { ruleNames, ruleDict } = NominationRuleSet();
    const model = createNominationModel({
        msg: createTranslator("zh-Hant").msg,
        getUserName: () => "Current user",
        getPageName: () => "Sidebar article",
    });
    const draft = model.makeAuthorNomination(null, ruleNames, ruleDict);
    draft.articleRecipientDefault = "Largest contributor";
    draft.ruleStatus["1a"].selected = true;
    assert.equal(draft.awarder, "");
    assert.equal(model.recipientPlaceholder(draft), "Largest contributor");
    assert.equal(model.authorValidation([draft]), null);
    assert.equal(model.nominationPayload(draft).pageName, "Sidebar article");
    assert.equal(model.nominationPayload(draft).awarder, "Largest contributor");
    assert.ok(
        model
            .authorCodePreviewResult(draft, 1, ruleNames)
            .text.includes("|用戶名稱1 = Largest contributor"),
    );
    assert.ok(
        model
            .authorCodePreviewResult(draft, 1, ruleNames)
            .text.includes("|條目名稱1 = Sidebar article"),
    );
    for (const category of ["review", "media", "recommendation", "other"]) {
        draft.activeRuleCategory = category;
        assert.equal(model.recipientPlaceholder(draft), "Current user");
        assert.equal(model.nominationPayload(draft).awarder, "Current user");
    }
    draft.activeRuleCategory = "article";
    draft.pageName = "Different article";
    assert.equal(model.recipientPlaceholder(draft), "Current user");
    assert.equal(model.nominationPayload(draft).pageName, "Different article");
    draft.pageName = "   ";
    assert.equal(model.recipientPlaceholder(draft), "Largest contributor");
    assert.equal(model.nominationPayload(draft).pageName, "Sidebar article");
    assert.equal(
        model.nominationPayload(model.cloneValue(draft)).pageName,
        "Sidebar article",
    );

    draft.awarder = "  Explicit recipient  ";
    draft.activeRuleCategory = "other";
    assert.equal(model.nominationPayload(draft).awarder, "Explicit recipient");
    draft.activeRuleCategory = "article";
    assert.equal(model.nominationPayload(draft).awarder, "Explicit recipient");
    draft.awarder = "   ";
    assert.equal(model.authorValidation([draft]), null);
    assert.equal(model.nominationPayload(draft).awarder, "Largest contributor");

    const rowDraft = model.cloneValue(draft);
    rowDraft.activeRuleCategory = "other";
    assert.equal(rowDraft.awarder, "   ");
    assert.equal(model.recipientPlaceholder(rowDraft), "Current user");
    assert.equal(model.nominationPayload(rowDraft).awarder, "Current user");
    assert.equal(model.recipientPlaceholder(draft), "Largest contributor");
});

test("stored edit and check recipients stay explicit and never inherit new-draft defaults", async () => {
    const { NominationRuleSet } = await import("../../src/domain/rules.ts");
    const { ruleNames, ruleDict } = NominationRuleSet();
    const model = createNominationModel({
        msg: createTranslator("zh-Hant").msg,
        getUserName: () => "Current user",
        getPageName: () => "Sidebar article",
    });
    const stored = {
        awarder: "Original recipient",
        pageName: "Stored article",
        ruleStatus: { "1a": { selected: true, score: 1 } },
    };
    const edit = model.makeAuthorNomination(stored, ruleNames, ruleDict);
    assert.equal(model.recipientPlaceholder(edit), "");
    assert.equal(model.nominationPayload(edit).awarder, "Original recipient");
    edit.pageName = "";
    assert.equal(model.authorValidation([edit]), edit);
    assert.ok(edit.errors.pageName);
    edit.pageName = "Stored article";
    edit.awarder = "   ";
    assert.equal(model.authorValidation([edit]), edit);
    assert.ok(edit.errors.awarder);
    assert.equal(model.nominationPayload(edit).awarder, "");
    const check = model.makeCheckNomination(stored, ruleNames, ruleDict);
    assert.equal(model.recipientPlaceholder(check), "");
    assert.equal(
        model.nominationPayload(check, true).pageName,
        "Stored article",
    );
    assert.equal(
        model.nominationPayload(check, true).awarder,
        "Original recipient",
    );
    check.awarder = "";
    assert.equal(model.nominationPayload(check, true).awarder, "");
});

test("pending suggestions display a loading placeholder without validating or saving it as a user", async () => {
    const { NominationRuleSet } = await import("../../src/domain/rules.ts");
    const { ruleNames, ruleDict } = NominationRuleSet();
    const model = createNominationModel({
        msg: createTranslator("en").msg,
        getUserName: () => "Current user",
        getPageName: () => "Example article",
        getSuggestedRecipient: async () => "Leading editor",
    });
    const draft = model.makeAuthorNomination(null, ruleNames, ruleDict);
    draft.ruleStatus["1a"].selected = true;
    assert.equal(model.recipientPlaceholder(draft), "...");
    assert.equal(model.nominationPayload(draft).awarder, "");
    assert.equal(model.authorValidation([draft]), draft);
    assert.ok(draft.errors.awarder);
    assert.equal(model.nominationPayload(draft).awarder, "");
    draft.awarder = "Explicit editor";
    assert.equal(model.authorValidation([draft]), null);
    assert.equal(model.nominationPayload(draft).awarder, "Explicit editor");
    draft.awarder = "";
    draft.articleRecipientDefault = "Leading editor";
    draft.recipientSuggestionPending = false;
    assert.equal(model.recipientPlaceholder(draft), "Leading editor");
    assert.equal(model.authorValidation([draft]), null);
});

test("file drafts select media and use uploaders, while revision editors apply to every category except recommendation", async () => {
    const { NominationRuleSet } = await import("../../src/domain/rules.ts");
    const { ruleNames, ruleDict } = NominationRuleSet();
    for (const scope of ["media", "revision"] as const) {
        const model = createNominationModel({
            msg: createTranslator("en").msg,
            getUserName: () => "Current user",
            getPageName: () => "File:Example.svg",
            getInitialRuleCategory: () => "media",
            getRecipientSuggestionScope: () => scope,
        });
        const draft = model.makeAuthorNomination(null, ruleNames, ruleDict);
        draft.articleRecipientDefault = "Context editor";
        assert.equal(draft.activeRuleCategory, "media");
        assert.equal(model.mediaPageNamePlaceholder(draft), "File:Example.svg");
        assert.equal(model.recipientPlaceholder(draft), "Context editor");
        assert.equal(model.nominationPayload(draft).awarder, "Context editor");
        assert.equal(model.authorValidation([draft]), null);
        for (const category of [
            "article",
            "review",
            "media",
            "recommendation",
            "other",
        ]) {
            draft.activeRuleCategory = category;
            assert.equal(
                model.recipientPlaceholder(draft),
                category === "recommendation" ||
                    (scope === "media" && category !== "media")
                    ? "Current user"
                    : "Context editor",
            );
        }
        draft.activeRuleCategory = "media";
        draft.media.pageName = "File:Different.svg";
        assert.equal(
            model.recipientPlaceholder(draft),
            scope === "media" ? "Current user" : "Context editor",
        );
    }
});

test("new article nominations without launch context require an explicit title", async () => {
    const { NominationRuleSet } = await import("../../src/domain/rules.ts");
    const { ruleNames, ruleDict } = NominationRuleSet();
    const model = createNominationModel({
        msg: createTranslator("zh-Hant").msg,
        getUserName: () => "Current user",
    });
    const draft = model.makeAuthorNomination(null, ruleNames, ruleDict);
    draft.ruleStatus["1a"].selected = true;
    assert.equal(model.articlePageNamePlaceholder(draft), "");
    assert.equal(model.authorValidation([draft]), draft);
    assert.ok(draft.errors.pageName);
    draft.pageName = "Explicit article";
    assert.equal(model.authorValidation([draft]), null);
    assert.equal(model.nominationPayload(draft).pageName, "Explicit article");
});

test("new media nominations use an editable sidebar title default and select only the first media rule", async () => {
    const { NominationRuleSet } = await import("../../src/domain/rules.ts");
    const { ruleNames, ruleDict } = NominationRuleSet();
    const model = createNominationModel({
        msg: createTranslator("zh-Hant").msg,
        getUserName: () => "Current user",
        getPageName: () => "Sidebar article",
    });
    const draft = model.makeAuthorNomination(null, ruleNames, ruleDict);
    assert.equal(draft.activeRuleCategory, "article");
    assert.equal(draft.ruleStatus["6"].selected, true);
    assert.equal(draft.ruleStatus["6-fp"].selected, false);
    assert.equal(draft.media.pageName, "");
    draft.activeRuleCategory = "media";
    assert.equal(model.mediaPageNamePlaceholder(draft), "Sidebar article");
    assert.equal(model.authorValidation([draft]), null);
    assert.equal(model.nominationPayload(draft).pageName, "Sidebar article");
    assert.ok(
        model
            .authorCodePreviewResult(draft, 1, ruleNames)
            .text.includes("|條目名稱1 = Sidebar article"),
    );
    draft.media.pageName = "  File:Explicit media.png  ";
    assert.equal(model.authorValidation([draft]), null);
    assert.equal(
        model.nominationPayload(draft).pageName,
        "File:Explicit media.png",
    );
    draft.media.pageName = "   ";
    assert.equal(model.authorValidation([draft]), null);
    assert.equal(model.nominationPayload(draft).pageName, "Sidebar article");
    const rowDraft = model.cloneValue(draft);
    assert.equal(model.nominationPayload(rowDraft).pageName, "Sidebar article");

    const edit = model.makeAuthorNomination(
        {
            awarder: "Stored user",
            pageName: "File:Stored media.png",
            ruleStatus: { "6-fp": { selected: true, score: 1 } },
        },
        ruleNames,
        ruleDict,
    );
    assert.equal(edit.ruleStatus["6"].selected, false);
    assert.equal(edit.ruleStatus["6-fp"].selected, true);
    assert.equal(model.mediaPageNamePlaceholder(edit), "");
    assert.equal(
        model.nominationPayload(edit).pageName,
        "File:Stored media.png",
    );
    edit.media.pageName = "";
    assert.equal(model.authorValidation([edit]), edit);
    assert.ok(edit.errors.media);
});

test("new media nominations without sidebar context still require an explicit title", async () => {
    const { NominationRuleSet } = await import("../../src/domain/rules.ts");
    const { ruleNames, ruleDict } = NominationRuleSet();
    const model = createNominationModel({
        msg: createTranslator("zh-Hant").msg,
        getUserName: () => "Current user",
    });
    const draft = model.makeAuthorNomination(null, ruleNames, ruleDict);
    draft.activeRuleCategory = "media";
    assert.equal(model.mediaPageNamePlaceholder(draft), "");
    assert.equal(model.authorValidation([draft]), draft);
    assert.ok(draft.errors.media);
});

test("new recommendation and other scoring items default selected but can remain unchecked", async () => {
    const { NominationRuleSet } = await import("../../src/domain/rules.ts");
    const { ruleNames, ruleDict } = NominationRuleSet();
    const model = createNominationModel({
        msg: createTranslator("zh-Hant").msg,
        getUserName: () => "Current user",
        getPageName: () => "Sidebar article",
    });
    for (const [category, code] of [
        ["recommendation", "7"],
        ["other", "8"],
    ]) {
        const draft = model.makeAuthorNomination(null, ruleNames, ruleDict);
        assert.equal(draft.activeRuleCategory, "article");
        assert.equal(draft.otherPageName, "");
        assert.equal(draft.ruleStatus[code].selected, true);
        draft.activeRuleCategory = category;
        draft.ruleStatus[code].score = 0.5;
        assert.equal(model.authorValidation([draft]), null);
        const payload = model.nominationPayload(draft);
        assert.deepEqual(Object.keys(payload.ruleStatus), [code]);
        assert.equal(payload.ruleStatus[code].selected, true);

        draft.ruleStatus[code].selected = false;
        assert.equal(model.authorValidation([draft]), draft);
        assert.ok(draft.errors.rules);
        assert.equal(
            model.nominationPayload(draft).ruleStatus[code].selected,
            false,
        );
        assert.deepEqual(model.selectedActiveRuleStatus(draft), {});

        const stored = model.makeAuthorNomination(
            {
                awarder: "Stored recipient",
                pageName: "Stored article",
                ruleStatus: {
                    [code]: { selected: false, score: ruleDict[code].score },
                },
            },
            ruleNames,
            ruleDict,
        );
        assert.equal(stored.ruleStatus[code].selected, false);
    }
});

test("new other nominations use the launch page as an overridable related-page default", async () => {
    const { NominationRuleSet } = await import("../../src/domain/rules.ts");
    const { ruleNames, ruleDict } = NominationRuleSet();
    for (const pageName of ["Sidebar article", "File:Artwork.png"]) {
        const model = createNominationModel({
            msg: createTranslator("zh-Hant").msg,
            getUserName: () => "Current user",
            getPageName: () => pageName,
        });
        const draft = model.makeAuthorNomination(null, ruleNames, ruleDict);
        draft.activeRuleCategory = "other";
        draft.ruleStatus["8"].selected = true;
        draft.ruleStatus["8"].score = 0.5;
        assert.equal(draft.otherPageName, "");
        assert.equal(model.relatedPageNamePlaceholder(draft), pageName);
        assert.equal(model.authorValidation([draft]), null);
        assert.equal(model.nominationPayload(draft).pageName, pageName);
        assert.ok(
            model
                .authorCodePreviewResult(draft, 1, ruleNames)
                .text.includes(pageName),
        );
        draft.otherPageName = "  Explicit related page  ";
        assert.equal(
            model.nominationPayload(draft).pageName,
            "Explicit related page",
        );
        draft.otherPageName = "  ";
        assert.equal(
            model.nominationPayload(model.cloneValue(draft)).pageName,
            pageName,
        );
    }
});

test("other nominations keep ACGA context and stored optional targets blank", async () => {
    const { NominationRuleSet } = await import("../../src/domain/rules.ts");
    const { ruleNames, ruleDict } = NominationRuleSet();
    for (const pageName of [
        "",
        "WikiProject:ACG/維基ACG專題獎",
        "WikiProject:ACG/維基ACG專題獎/登記處",
        "WikiProject:ACG/维基ACG专题奖/存档/2026",
    ]) {
        const model = createNominationModel({
            msg: createTranslator("zh-Hant").msg,
            getUserName: () => "Current user",
            getPageName: () => pageName,
        });
        const draft = model.makeAuthorNomination(null, ruleNames, ruleDict);
        draft.activeRuleCategory = "other";
        draft.ruleStatus["8"].selected = true;
        assert.equal(model.relatedPageNamePlaceholder(draft), "");
        assert.equal(model.nominationPayload(draft).pageName, "其他");
    }
    const model = createNominationModel({
        msg: createTranslator("zh-Hant").msg,
        getUserName: () => "Current user",
        getPageName: () => "Unrelated launch page",
    });
    const edit = model.makeAuthorNomination(
        {
            awarder: "Stored user",
            pageName: "其他",
            ruleStatus: { "8": { selected: true, score: 1 } },
        },
        ruleNames,
        ruleDict,
    );
    assert.equal(model.relatedPageNamePlaceholder(edit), "");
    assert.equal(model.nominationPayload(edit).pageName, "其他");
});

test("malformed and mixed requests preserve raw source for explicit repair", async () => {
    const { NominationRuleSet, parseReasonTokens } =
        await import("../../src/domain/rules.ts");
    const { ruleNames, ruleDict } = NominationRuleSet();
    const model = createNominationModel({
        msg: createTranslator("zh-Hant").msg,
        getUserName: () => "Example",
    });
    for (const reason of ["4-dyk(", "1a 5x"]) {
        const nomination = model.makeAuthorNomination(
            {
                awarder: "Example",
                pageName: "Example article",
                requestReasonText: reason,
                reasonParse: parseReasonTokens(reason, ruleDict),
            },
            ruleNames,
            ruleDict,
        );
        assert.equal(nomination.sourceOnly, true);
        assert.ok(nomination.rawSourceText.includes(reason));
        assert.ok(nomination.sourceError);
    }
});

test("all three review modes preserve stored custom descriptions and totals without decomposing complete reviews", async () => {
    const {
        NominationRuleSet,
        parseReasonTokens,
        serializeNominationReason,
        applyReviewDraft,
    } = await import("../../src/domain/rules.ts");
    const { ruleNames, ruleDict } = NominationRuleSet();
    const model = createNominationModel({
        msg: createTranslator("zh-Hant").msg,
        getUserName: () => "Current user",
    });
    for (const [reason, mode] of [
        ["5-bcr(自訂說明)[2.5]", "general"],
        ["5a-gan(自訂說明)[2.5]", "aspects"],
        ["5x-fac(自訂說明)[4]", "complete"],
        ["5x-bcr[1.5]", "complete"],
    ]) {
        const draft = model.makeAuthorNomination(
            {
                awarder: "Stored recipient",
                pageName: "Stored article",
                requestReasonText: reason,
                reasonParse: parseReasonTokens(reason, ruleDict),
            },
            ruleNames,
            ruleDict,
        );
        assert.equal(draft.sourceOnly, false);
        assert.equal(draft.rule5Unresolved, false);
        assert.equal(draft.review.mode, mode);
        assert.equal(model.authorValidation([draft]), null);
        applyReviewDraft(draft.ruleStatus, draft.review, ruleDict, mode);
        assert.equal(
            serializeNominationReason(
                model.nominationPayload(draft).ruleStatus,
                ruleNames,
            ).reasonText,
            reason,
        );
        const row =
            mode === "general"
                ? draft.review.general
                : mode === "complete"
                  ? draft.review.complete
                  : draft.review.aspects.writing;
        row.description = "  ";
        assert.equal(model.authorValidation([draft]), draft);
        assert.ok(draft.errors.rules);
    }
});

test("legacy quick complete reviews normalize to supported 5x score overrides and ambiguous modes retain source fallback", async () => {
    const { NominationRuleSet, parseReasonTokens, serializeNominationReason } =
        await import("../../src/domain/rules.ts");
    const { ruleNames, ruleDict } = NominationRuleSet();
    const model = createNominationModel({
        msg: createTranslator("zh-Hant").msg,
        getUserName: () => "Current user",
    });
    const make = (reason: string) =>
        model.makeAuthorNomination(
            {
                awarder: "Stored recipient",
                pageName: "Stored article",
                requestReasonText: reason,
                reasonParse: parseReasonTokens(reason, ruleDict),
            },
            ruleNames,
            ruleDict,
        );
    const quick = make("5x-fac-half");
    assert.equal(quick.rule5Unresolved, false);
    assert.equal(quick.review.mode, "complete");
    assert.equal(quick.review.complete.quick, false);
    assert.equal(
        serializeNominationReason(
            model.nominationPayload(quick).ruleStatus,
            ruleNames,
        ).reasonText,
        "5x-fac[3]",
    );
    for (const reason of ["5-bcr 5a-gan", "5x 5b", "5a 5a-fac", "5x-fac?"]) {
        const draft = make(reason);
        assert.equal(draft.sourceOnly || draft.rule5Unresolved, true);
        assert.ok(draft.rawSourceText.includes(reason));
    }
});

test("English interface translates presentation while nomination targets retain canonical wikitext", async () => {
    const { NominationRuleSet } = await import("../../src/domain/rules.ts");
    const { msg } = createTranslator("en");
    const model = createNominationModel({ msg, getUserName: () => "Example" });
    const { ruleNames, ruleDict } = NominationRuleSet(msg);
    const nomination = model.makeAuthorNomination(null, ruleNames, ruleDict);
    nomination.activeRuleCategory = "recommendation";
    nomination.ruleStatus["7"].selected = true;
    assert.equal(model.nominationPayload(nomination).pageName, "他薦");
    assert.equal(/[\u3400-\u9fff]/u.test(ruleDict["7"].label), false);
});
