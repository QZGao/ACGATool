/**
 * @file tests/domain/write-safety.test.ts
 * Purpose: tests / domain / write safety.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. Test scenarios
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
    getCheckedScore,
    getRegistryEntries,
    parseNominationCheckWikitext,
    queryEntry,
    updateEntryParameters,
    updateEntriesParameters,
} from "../../src/domain/wikitext.ts";
import { applyScoreDeltas } from "../../src/domain/score-list.ts";
import {
    NominationRuleSet,
    nominationRuleGroup,
    validateNominationGroup,
    serializeReasonToken,
} from "../../src/domain/rules.ts";

const registry = `=== 9月27日 ===
{{ACG提名2
|條目名稱1 = Alpha
|用戶名稱1 = Example
|提名理由1 = {{ACG提名2/request|ver=1|1a}}
|核對用1 = {{ACG提名2/check|ver=1|}}
|條目名稱2 = Beta
|用戶名稱2 = Example
|提名理由2 = {{ACG提名2/request|ver=1|2-b}}
|核對用2 = {{ACG提名2/check|ver=1|}}
}}`;

test("batched parameters use the original snapshot even when earlier replacements change lengths", () => {
    const first = queryEntry(registry, "9月27日", 1);
    const second = queryEntry(registry, "9月27日", 2);
    const updated = updateEntriesParameters(registry, [
        {
            entry: first,
            changes: { 核對用: "{{ACG提名2/check|ver=1|1a}}long signature" },
        },
        {
            entry: second,
            changes: { 核對用: "{{ACG提名2/check|ver=1|2-b}}signature" },
        },
    ]);
    assert.equal(
        queryEntry(updated, "9月27日", 1).template["核對用"].value,
        "{{ACG提名2/check|ver=1|1a}}long signature",
    );
    assert.equal(
        queryEntry(updated, "9月27日", 2).template["核對用"].value,
        "{{ACG提名2/check|ver=1|2-b}}signature",
    );
    assert.ok(updated.includes("|提名理由1 = {{ACG提名2/request|ver=1|1a}}"));
});

test("registry entries share physical table groups while repeated date sections remain independent", () => {
    const secondTable = registry.slice(registry.indexOf("{{ACG提名2"));
    const source = registry + "\n" + secondTable + "\n" + registry;
    assert.deepEqual(
        getRegistryEntries(source).map((entry) => [
            entry.sectionOccurrence,
            entry.index,
            entry.tableIndex,
        ]),
        [
            [0, 1, 0],
            [0, 2, 0],
            [0, 3, 1],
            [0, 4, 1],
            [1, 1, 0],
            [1, 2, 0],
        ],
    );
    assert.equal(queryEntry(source, "9月27日", 4).tableIndex, 1);
    assert.equal(queryEntry(source, "9月27日", 2, 1).tableIndex, 0);
});

test("rendered identities follow numeric slots, omit blank titles and reset in each table", () => {
    const source = `=== 9月27日 ===
{{ACG提名2
|條目名稱7=Seventh
|用戶名稱7=Seven
|提名理由7={{ACG提名2/request|ver=1|1a}}
|核對用7=
|條目名稱3= <!-- omitted -->
|用戶名稱3=Hidden
|條目名稱1=First
|用戶名稱1=One
|提名理由1={{ACG提名2/request|ver=1|1a}}
|核對用1=
|條目名稱26=Outside template capacity
|條目名稱01=Not a numbered slot
}}
{{ACG提名2
|條目名稱7=Next table
|用戶名稱7=Other
|提名理由7={{ACG提名2/request|ver=1|1a}}
|核對用7=
}}`;
    assert.deepEqual(
        getRegistryEntries(source).map((entry) => [
            entry.index,
            entry.tableIndex,
            entry.itemIndex,
            entry.template.條目名稱.value,
        ]),
        [
            [1, 0, 1, "First"],
            [2, 0, 7, "Seventh"],
            [3, 1, 7, "Next table"],
        ],
    );
    const target = queryEntry(source, "9月27日", 7, 0, {
        tableIndex: 1,
        itemIndex: 7,
    });
    assert.equal(target.index, 3);
    const updated = updateEntriesParameters(source, [
        { entry: target, changes: { 核對用: "{{ACG提名2/check|ver=1|1a}}" } },
    ]);
    assert.equal(queryEntry(updated, "9月27日", 2).template.核對用.value, "");
    assert.equal(
        queryEntry(updated, "9月27日", 3).template.核對用.value,
        "{{ACG提名2/check|ver=1|1a}}",
    );
    for (const identity of [
        { tableIndex: 0 },
        { itemIndex: 7 },
        { tableIndex: 0, itemIndex: 3 },
        { tableIndex: 0, itemIndex: 26 },
        { tableIndex: 2, itemIndex: 7 },
        { tableIndex: -1, itemIndex: 1 },
    ])
        assert.equal(queryEntry(source, "9月27日", 1, 0, identity), null);
});

test("interleaved source fields remain independently editable by numbered identity", () => {
    const source = `=== 9月27日 ===
{{ACG提名2
|條目名稱7=Seventh
|條目名稱1=First
|用戶名稱7=Seven
|用戶名稱1=One
|提名理由7={{ACG提名2/request|ver=1|1a}}
|提名理由1={{ACG提名2/request|ver=1|1a}}
|核對用7=
|核對用1=
}}`;
    const updated = updateEntriesParameters(
        source,
        [1, 7].map((itemIndex) => ({
            entry: queryEntry(source, "9月27日", 1, 0, {
                tableIndex: 0,
                itemIndex,
            }),
            changes: { 核對用: `Checked slot ${itemIndex}` },
        })),
    );
    assert.equal(
        queryEntry(updated, "9月27日", 1).template.核對用.value,
        "Checked slot 1",
    );
    assert.equal(
        queryEntry(updated, "9月27日", 2).template.核對用.value,
        "Checked slot 7",
    );
});

test("whitespace before a numeric suffix cannot override exact title, recipient or check fields", () => {
    const source = `=== 9月27日 ===
{{ACG提名2
|條目名稱1=Exact title
|用戶名稱1=Recipient
|提名理由1={{ACG提名2/request|ver=1|1a}}
|核對用1={{ACG提名2/check|ver=1|1a}}
|條目名稱 1=Wrong title
|用戶名稱 1=Other
|提名理由 1={{ACG提名2/request|ver=1|1b}}
|核對用 1={{ACG提名2/check|ver=1|1b}}
}}`;
    const entry = queryEntry(source, "9月27日", 1);
    assert.equal(entry.template.條目名稱.value, "Exact title");
    assert.equal(entry.template.用戶名稱.value, "Recipient");
    assert.equal(
        entry.template.提名理由.value,
        "{{ACG提名2/request|ver=1|1a}}",
    );
    assert.equal(entry.template.核對用.value, "{{ACG提名2/check|ver=1|1a}}");
    const updated = updateEntriesParameters(source, [
        { entry, changes: { 核對用: "{{ACG提名2/check|ver=1|0}}" } },
    ]);
    assert.match(updated, /\|核對用1=\{\{ACG提名2\/check\|ver=1\|0\}\}/u);
    assert.match(updated, /\|核對用 1=\{\{ACG提名2\/check\|ver=1\|1b\}\}/u);
    assert.equal(
        getRegistryEntries(source.replace("|條目名稱1=Exact title\n", ""))
            .length,
        0,
    );
});

test("batch validation rejects stale entries, duplicate targets and missing parameters", () => {
    const entry = queryEntry(registry, "9月27日", 1);
    assert.throws(() =>
        updateEntriesParameters(registry.replace("Alpha", "Changed"), [
            { entry, changes: { 條目名稱: "Lost" } },
        ]),
    );
    assert.throws(() =>
        updateEntriesParameters(registry, [
            { entry, changes: { 不存在: "Lost" } },
        ]),
    );
    assert.throws(() =>
        updateEntryParameters(registry, entry, { 不存在: "Lost" }),
    );
    assert.throws(() =>
        updateEntriesParameters(registry, [
            { entry, changes: { 核對用: "First" } },
            { entry, changes: { 條目名稱: "Second" } },
        ]),
    );
});

test("previous check totals recognize empty and invalid checks while excluding rejected rules", () => {
    assert.deepEqual(getCheckedScore(""), { ok: true, score: 0 });
    assert.deepEqual(getCheckedScore("{{ACG提名2/check|ver=1|}}"), {
        ok: true,
        score: 0,
    });
    assert.deepEqual(getCheckedScore("{{ACG提名2/check|ver=1|0}}--signature"), {
        ok: true,
        score: 0,
    });
    assert.deepEqual(
        getCheckedScore(
            "{{ACG提名2/check|ver=1|1a 4[0.5] 4([[Page|a b]])|no=1b}}--signature",
        ),
        { ok: true, score: 2.5 },
    );
    assert.deepEqual(getCheckedScore("{{ACG提名2/check|ver=1|5x-fac-half}}"), {
        ok: true,
        score: 3,
    });
    for (const source of [
        "arbitrary old check",
        "{{ACG提名2/check|ver=2|1a}}",
        "{{ACG提名2/check|ver=1|1a?|no=1b}}",
        "{{ACG提名2/check|ver=1|1a|status=rescinded}}",
        "{{ACG提名2/check|ver=1|unknown}}",
    ]) {
        assert.equal(getCheckedScore(source).ok, false, source);
    }
});

test("check parsing distinguishes unfilled templates from explicit scoring results", () => {
    for (const [source, hasResult] of [
        ["", false],
        ["<!-- 尚未核對 -->", false],
        ["{{ACG提名2/check|ver=1|}}", false],
        ["{{ACG提名2/check|ver=1| \n<!-- placeholder --> |no= }}", false],
        ["{{ACG提名2/check|ver=1|0}}", true],
        ["{{ACG提名2/check|ver=1|1c}}", true],
        ["{{ACG提名2/check|ver=1||no=1c}}", true],
    ] as const) {
        const parsed = parseNominationCheckWikitext(source);
        assert.equal(parsed.ok, true, source);
        if (parsed.ok) assert.equal(parsed.hasResult, hasResult, source);
    }
});

test("saved checks retain canonical rows, rejected selections, scores and comments without the signature", () => {
    const parsed = parseNominationCheckWikitext(
        "<!-- example -->{{ACG提名2/check|ver=1|DYK([[Article|a b]])[0.5] 4(活動)[1.5]|no=4-dyk(末項)[0.5]}}原有說明--~~~~",
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.message, "原有說明");
    assert.deepEqual(
        parsed.tokens.map((token) => [
            token.code,
            token.selected,
            token.comment,
            token.scoreOverride,
            token.sourceIndex,
        ]),
        [
            ["4-dyk", true, "[[Article|a b]]", 0.5, 0],
            ["4", true, "活動", 1.5, 1],
            ["4-dyk", false, "末項", 0.5, 2],
        ],
    );
});

test("active rechecking metadata preserves the previous score and editable saved result", () => {
    const source =
        "{{ACG提名2/check|status=rechecking|ver=1|1b|no=1c}}Pending review--~~~~";
    assert.deepEqual(getCheckedScore(source), { ok: true, score: 2 });
    const parsed = parseNominationCheckWikitext(source);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
        assert.deepEqual(
            parsed.tokens.map((token) => [token.code, token.selected]),
            [
                ["1b", true],
                ["1c", false],
            ],
        );
        assert.equal(parsed.message, "Pending review");
    }
    for (const status of [
        "rescinded",
        "unknown",
        "rechecking|status=rechecking",
    ])
        assert.equal(
            getCheckedScore(`{{ACG提名2/check|ver=1|1b|status=${status}}}`).ok,
            false,
        );
});

test("saved check parsing preserves comment dashes and strips a recognizable expanded UTC signature", () => {
    const parsed = parseNominationCheckWikitext(
        "{{ACG提名2/check|ver=1|1a}}說明--[[引用]]\n第二行--[[User:Reviewer|Reviewer]] 2026年9月30日 (三) 12:34 (UTC)",
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.message, "說明--[[引用]]\n第二行");
});

test("saved checks reject unsupported parameters, accepted pending codes and unrecognized rejected rules", () => {
    for (const source of [
        "Manually checked: three points",
        "{{ACG提名2/check|ver=2|1a}}--~~~~",
        "{{ACG提名2/check|ver=1|1a?|no=1b}}--~~~~",
        "{{ACG提名2/check|ver=1|1a|no=unknown}}--~~~~",
        "{{ACG提名2/check|ver=1|1a|status=rescinded}}--~~~~",
        "{{ACG提名2/check|ver=1|1a|no=1b|no=1c}}--~~~~",
    ])
        assert.equal(parseNominationCheckWikitext(source).ok, false, source);
    // Score reconciliation reads accepted rules even when legacy rejected source is unreadable.
    assert.deepEqual(
        getCheckedScore("{{ACG提名2/check|ver=1|1a|no=unknown}}"),
        {
            ok: true,
            score: 1,
        },
    );
});

test("score deltas combine users once and preserve comments, ordering, quoting and whitespace", () => {
    const source = `return {\r\n    -- retained note\r\n    ['Other'] = 6, -- retained score\r\n    ["Example"] = 10 -- missing final comma is legal\r\n}`;
    const updated = applyScoreDeltas(source, [
        { userName: "Example", score: -2 },
        { userName: "Example", score: 0.5 },
        { userName: 'New"\\name', score: 3 },
    ]);
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.ok(
        updated.text.includes("    ['Other'] = 6, -- retained score\r\n"),
    );
    assert.ok(
        updated.text.includes(
            '["Example"] = 8.5, -- missing final comma is legal',
        ),
    );
    assert.ok(updated.text.includes('["New\\"\\\\name"] = 3,'));
    assert.deepEqual(updated.changes, [
        { userName: "Example", score: -1.5, previousScore: 10, newScore: 8.5 },
        { userName: 'New"\\name', score: 3, previousScore: 0, newScore: 3 },
    ]);
});

test("unsupported Lua, duplicate keys, invalid deltas and negative totals fail without partial output", () => {
    for (const source of [
        'return {\n ["Example"] = compute(),\n}',
        'return {\n ["Example"] = 1,\n ["Example"] = 2,\n}',
        'return {\n --[[\n ["Example"] = 3,\n --]]\n}',
    ]) {
        assert.equal(
            applyScoreDeltas(source, [{ userName: "Example", score: 1 }]).ok,
            false,
        );
    }
    const source = 'return {\n ["Example"] = 1,\n}';
    assert.equal(
        applyScoreDeltas(source, [{ userName: "Example", score: -2 }]).ok,
        false,
    );
    assert.equal(
        applyScoreDeltas(source, [{ userName: "Example", score: NaN }]).ok,
        false,
    );
    assert.deepEqual(
        applyScoreDeltas(source, [
            { userName: "Example", score: 2 },
            { userName: "Example", score: -2 },
        ]),
        { ok: true, text: source, changes: [] },
    );
});

test("five nomination groups include all subrules but reject mixed submitted groups", () => {
    assert.equal(nominationRuleGroup("4p-game"), "article");
    assert.equal(nominationRuleGroup("5x-fac-half"), "review");
    assert.equal(nominationRuleGroup("fp"), "media");
    assert.equal(nominationRuleGroup("7"), "recommendation");
    assert.equal(nominationRuleGroup("8"), "other");
    assert.equal(nominationRuleGroup("9"), null);
    assert.deepEqual(
        validateNominationGroup({
            ruleStatus: {
                "1a": { selected: true },
                "4": [{ selected: true }],
                "5": { selected: false },
            },
        }),
        { ok: true, category: "article" },
    );
    assert.equal(
        validateNominationGroup({
            ruleStatus: { "1a": { selected: true }, "5": { selected: true } },
        }).ok,
        false,
    );
    assert.equal(
        validateNominationGroup({
            ruleTokens: [
                { code: "1a", selected: true },
                { code: "5", selected: false },
            ],
        }).ok,
        false,
    );
    assert.deepEqual(validateNominationGroup({ ruleTokens: [] }), {
        ok: true,
        category: null,
    });
});

test("complete quick-review serialization omits its inherited default description", () => {
    const { ruleDict } = NominationRuleSet();
    assert.equal(
        serializeReasonToken(
            {
                code: "5x-half",
                pending: false,
                comment: ruleDict["5x"].label,
                scoreOverride: null,
                sourceIndex: 0,
            },
            ruleDict,
        ),
        "5x-half",
    );
});

test("rendered nomination indexes ignore comments, literal examples and level-four headings", () => {
    const example = registry.slice(registry.indexOf("{{"));
    const source = `<!-- === Fake date ===\n${example} -->\n<nowiki>=== Another fake date ===\n${example}</nowiki>\n=== 9月27日 ===\n<!-- ${example} -->\n<syntaxhighlight lang="wikitext">${example}</syntaxhighlight>\n==== Details ====\n${example}`;
    const entry = queryEntry(source, "9月27日", 1);
    assert.equal(entry.template["條目名稱"].value, "Alpha");
    assert.equal(entry.start, source.lastIndexOf("|條目名稱1") + 1);
    assert.equal(queryEntry(source, "Fake date", 1), null);
    assert.equal(queryEntry(source, "9月27日", 3), null);
});

test("literal unmatched braces in comments and nowiki do not change outer template boundaries", () => {
    const source = registry
        .replace("|用戶名稱1 = Example", "|用戶名稱1 = Example<!-- }} -->")
        .replace("|核對用2 =", "|核對用2 = <nowiki>{{</nowiki>");
    assert.equal(
        queryEntry(source, "9月27日", 1).template["條目名稱"].value,
        "Alpha",
    );
    assert.equal(
        queryEntry(source, "9月27日", 2).template["條目名稱"].value,
        "Beta",
    );
});

test("masked emoji preserve UTF-16 offsets and self-closing nowiki does not hide later nominations", () => {
    const source = `<!-- 🎮 -->\n<nowiki />\n${registry}`;
    const entry = queryEntry(source, "9月27日", 1);
    assert.equal(entry.start, source.indexOf("|條目名稱1") + 1);
    assert.equal(entry.template["條目名稱"].value, "Alpha");
    assert.equal(
        queryEntry(source, "9月27日", 2).template["條目名稱"].value,
        "Beta",
    );
});
