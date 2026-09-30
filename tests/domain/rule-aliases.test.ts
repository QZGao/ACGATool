import assert from "node:assert/strict";
import test from "node:test";

import {
    NominationRuleAliases,
    NominationRuleSet,
    nominationRuleGroup,
    parseReasonTokens,
    serializeReasonTokens,
    validateNominationGroup,
} from "../../src/domain/rules.ts";
import {
    getCheckedScore,
    queried2NomData,
    queryEntry,
} from "../../src/domain/wikitext.ts";

// Offline snapshot of Module:ACGaward/nominee_check_new/1's aliases.
const MODULE_ALIASES = [
    ["c", "2-c", 1, "article"],
    ["2a", "2-c", 1, "article"],
    ["b", "2-b", 3, "article"],
    ["2b", "2-b", 3, "article"],
    ["ga", "2-ga", 5, "article"],
    ["2c", "2-ga", 5, "article"],
    ["fa", "2-fa", 10, "article"],
    ["2d", "2-fa", 10, "article"],
    ["dyk", "4-dyk", 1, "article"],
    ["4a", "4-dyk", 1, "article"],
    ["4p", "4-req", 1, "article"],
    ["4p-game", "4-req-game", 1, "article"],
    ["4p-ac", "4-req-ac", 1, "article"],
    ["fp", "6-fp", 5, "media"],
] as const;

const { ruleDict } = NominationRuleSet();

test("rule aliases match every alias in the nominee-check module", () => {
    assert.deepEqual(
        NominationRuleAliases(),
        Object.fromEntries(
            MODULE_ALIASES.map(([alias, canonical]) => [alias, canonical]),
        ),
    );
});

test("the default parser recognizes all module aliases and preserves their modifiers", () => {
    for (const [alias, canonical, , category] of MODULE_ALIASES) {
        for (const sourceCode of [alias, alias.toUpperCase()]) {
            const parsed = parseReasonTokens(sourceCode, ruleDict);
            assert.deepEqual(
                parsed,
                {
                    ok: true,
                    tokens: [
                        {
                            code: canonical,
                            pending: false,
                            comment: null,
                            scoreOverride: null,
                            sourceIndex: 0,
                        },
                    ],
                },
                sourceCode,
            );
            assert.equal(
                serializeReasonTokens(parsed.tokens, ruleDict),
                canonical,
            );
            assert.equal(nominationRuleGroup(sourceCode), category);
            assert.deepEqual(
                validateNominationGroup({ ruleTokens: parsed.tokens }),
                {
                    ok: true,
                    category,
                },
            );

            for (const modifiers of ["?(自訂)[0.5]", "？[0.5]（自訂）"]) {
                const modified = parseReasonTokens(
                    `{{ACG提名2/request|ver=1|${sourceCode}${modifiers}}}`,
                    ruleDict,
                );
                assert.deepEqual(modified, {
                    ok: true,
                    tokens: [
                        {
                            code: canonical,
                            pending: true,
                            comment: "自訂",
                            scoreOverride: 0.5,
                            sourceIndex: 0,
                        },
                    ],
                });
                const serialized = serializeReasonTokens(
                    modified.tokens,
                    ruleDict,
                );
                assert.equal(serialized, `${canonical}?(自訂)[0.5]`);
                assert.deepEqual(
                    parseReasonTokens(serialized, ruleDict),
                    modified,
                );
            }
        }
    }
});

test("registry aliases retain the submitted source and resolve the canonical checked score", () => {
    for (const [alias, canonical, score] of MODULE_ALIASES) {
        const sourceCode = alias.toUpperCase();
        const reason = `{{ACG提名2/request|ver=1|${sourceCode}}}`;
        const source = `=== 9月30日 ===
{{ACG提名2
|條目名稱1 = Example
|用戶名稱1 = Recipient
|提名理由1 = ${reason}
|核對用1 = {{ACG提名2/check|ver=1|${sourceCode}|no=8}}--~~~~
}}`;
        const data = queried2NomData(queryEntry(source, "9月30日", 1));
        assert.equal(data.reasonParse.ok, true, sourceCode);
        assert.equal(data.reasonParse.tokens[0].code, canonical);
        assert.equal(data.requestReasonText, sourceCode);
        assert.equal(data.requestReasonWikitext, reason);
        assert.deepEqual(getCheckedScore(data.checkWikitext), {
            ok: true,
            score,
        });
        assert.deepEqual(
            getCheckedScore(`{{ACG提名2/check|ver=1|${sourceCode}[0.5]}}`),
            { ok: true, score: 0.5 },
        );
    }
});

test("an explicit alias table overrides the defaults and unknown codes still fail", () => {
    assert.deepEqual(
        parseReasonTokens("custom", ruleDict, { custom: "2-b" }).tokens,
        parseReasonTokens("b", ruleDict).tokens,
    );
    assert.equal(
        parseReasonTokens("b", ruleDict, {}).error.code,
        "unknown-code",
    );
    assert.equal(
        parseReasonTokens("unknown", ruleDict).error.code,
        "unknown-code",
    );
});
