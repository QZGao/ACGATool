import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import en from "../../src/i18n/en.json" with { type: "json" };
import zhHans from "../../src/i18n/zh-Hans.json" with { type: "json" };
import zhHant from "../../src/i18n/zh-Hant.json" with { type: "json" };
import { createTranslator } from "../../src/i18n/index.ts";
import { NominationRules } from "../../src/domain/rules.ts";

function placeholders(value: string): string[] {
    return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)]
        .map((match) => match[1])
        .sort();
}

test("all catalogs have matching keys and placeholders, with complete English messages", () => {
    assert.deepEqual(Object.keys(zhHans).sort(), Object.keys(en).sort());
    assert.deepEqual(Object.keys(zhHant).sort(), Object.keys(en).sort());
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
        assert.ok(en[key].trim(), key);
        assert.ok(zhHans[key].trim(), key);
        assert.ok(zhHant[key].trim(), key);
        assert.deepEqual(placeholders(zhHans[key]), placeholders(en[key]), key);
        assert.deepEqual(placeholders(zhHant[key]), placeholders(en[key]), key);
        assert.doesNotMatch(en[key], /[\p{Script=Han}]/u, key);
    }
});

test("regional Chinese variants select the matching local catalog and other languages fall back to English", () => {
    for (const language of [
        "zh",
        "zh-CN",
        "zh-SG",
        "zh-MY",
        "zh-Hans",
        "zh_hans",
    ]) {
        assert.equal(createTranslator(language).interfaceLocale, "zh-Hans");
        assert.equal(createTranslator(language).msg("save"), "保存");
    }
    for (const language of ["zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh_Hant"]) {
        assert.equal(createTranslator(language).interfaceLocale, "zh-Hant");
        assert.equal(createTranslator(language).msg("save"), "儲存");
    }
    for (const language of ["en", "en-GB", "de", undefined]) {
        assert.equal(createTranslator(language).interfaceLocale, "en");
        assert.equal(createTranslator(language).msg("save"), "Save");
    }
    assert.equal(
        createTranslator("en").msg("nominate_for_acga"),
        "Nominate to ACGA",
    );
});

test("named parameters preserve user-provided plain text without evaluating it", () => {
    const { msg } = createTranslator("en");
    assert.equal(msg("count_items_selected", { count: 3 }), "3 items selected");
    assert.equal(msg("count_items_selected"), "{count} items selected");
    assert.equal(
        msg("archive_the_date_section", { date: "<img src=x>{count}" }),
        "Archive the “<img src=x>{count}” section?",
    );
});

test("all rule labels and explanations translate without changing canonical scoring metadata", () => {
    const canonical = NominationRules();
    const english = NominationRules(createTranslator("en").msg);
    const simplified = NominationRules(createTranslator("zh-Hans").msg);
    assert.deepEqual(
        english.flatMap((group) =>
            group.rules.map(({ rule, score }) => ({ rule, score })),
        ),
        canonical.flatMap((group) =>
            group.rules.map(({ rule, score }) => ({ rule, score })),
        ),
    );
    assert.deepEqual(NominationRules(), canonical);
    assert.equal(simplified[0].group, "内容扩充");
    for (const group of english) {
        assert.doesNotMatch(
            group.group +
                group.explanation +
                group.rules.map((rule) => rule.label).join(""),
            /[\p{Script=Han}]/u,
        );
    }
});

test("all statically referenced interface keys exist and source uses catalog keys instead of variant pairs", () => {
    const root = fileURLToPath(new URL("../../src/", import.meta.url));
    function inspect(directory: string): void {
        for (const item of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, item.name);
            if (item.isDirectory()) {
                inspect(path);
                continue;
            }
            if (!/\.(?:ts|vue)$/u.test(item.name)) continue;
            const source = readFileSync(path, "utf8");
            assert.doesNotMatch(
                source,
                /\blocalize\s*\(|\bcreateLocalizer\s*\(/u,
                path,
            );
            for (const match of source.matchAll(
                /\bmsg\(\s*["']([^"']+)["']/gu,
            )) {
                assert.ok(Object.hasOwn(en, match[1]), `${path}: ${match[1]}`);
            }
        }
    }
    inspect(root);
});

test("translated check defaults serialize as canonical codes instead of custom descriptions", async () => {
    const { formatNominationCheckWikitext, NominationRuleSet } =
        await import("../../src/domain/rules.ts");
    const canonical = NominationRuleSet();
    const english = NominationRuleSet(createTranslator("en").msg);
    const result = formatNominationCheckWikitext(
        {
            ruleTokens: [
                {
                    code: "1c",
                    selected: true,
                    desc: english.ruleDict["1c"].label,
                    ogDesc: english.ruleDict["1c"].label,
                    score: 3,
                },
            ],
        },
        canonical.ruleNames,
        canonical.ruleDict,
    );
    assert.equal(result.ok, true);
    assert.equal(
        result.wikitext,
        "{{ACG提名2/check|ver=1|1c}}--" + "~".repeat(4),
    );
});
