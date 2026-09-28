import test from "node:test";
import assert from "node:assert/strict";
import {
    getCheckedScore,
    queryEntry,
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
        updateEntriesParameters(registry, [
            { entry, changes: { 核對用: "First" } },
            { entry, changes: { 條目名稱: "Second" } },
        ]),
    );
});

test("nested legacy main and extra check fields save in one batch without invalidating each other", () => {
    const source = `=== 9月27日 ===
{{ACG提名
|條目名稱 = Main
|用戶名稱 = Example
|提名理由 = 1a
|核對用 =
|額外提名 = {{ACG提名/extra
|條目名稱 = Extra
|用戶名稱 = Example
|提名理由 = 1b
|核對用 =
}}
}}`;
    const main = queryEntry(source, "9月27日", 1);
    const extra = queryEntry(source, "9月27日", 2);
    const updated = updateEntriesParameters(source, [
        { entry: main, changes: { 核對用: "Checked main" } },
        { entry: extra, changes: { 核對用: "Checked extra" } },
    ]);
    assert.equal(
        queryEntry(updated, "9月27日", 1).template.params["核對用"].value,
        "Checked main",
    );
    assert.equal(
        queryEntry(updated, "9月27日", 2).template.params["核對用"].value,
        "Checked extra",
    );
    assert.throws(() =>
        updateEntriesParameters(source, [
            { entry: main, changes: { 額外提名: "replaced" } },
            { entry: extra, changes: { 核對用: "overlap" } },
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
