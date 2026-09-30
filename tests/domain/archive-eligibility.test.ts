import assert from "node:assert/strict";
import test from "node:test";
import {
    getArchiveEligibility,
    getLatestUtcSignature,
    getWikitextArchiveEligibility,
} from "../../src/domain/archive-eligibility.ts";
import type { ArchiveEntryState } from "../../src/domain/archive-eligibility.ts";

const NOW = new Date("2026-09-30T12:00:00Z");
const OLD_SIGNATURE = "2026年9月10日 (四) 12:00 (UTC)";
const OLD_CHECK = `{{ACG提名2/check|ver=1|1a}}--Reviewer ${OLD_SIGNATURE}`;
const OLD_ENTRY: ArchiveEntryState = {
    checked: true,
    rechecking: false,
    latestCheckTimestamp: Date.parse("2026-09-10T12:00:00Z"),
};

function section(checks: string[], discussion = OLD_SIGNATURE): string {
    return `=== 9月9日 ===\n{{ACG提名2\n${checks
        .map(
            (check, index) =>
                `|條目名稱${index + 1}=Article ${index + 1}\n|用戶名稱${index + 1}=Recipient\n|提名理由${index + 1}={{ACG提名2/request|ver=1|1a}}\n|核對用${index + 1}=${check}\n`,
        )
        .join(
            "",
        )}}}\n'''提名人：''' Nominator ${OLD_SIGNATURE}\n:Discussion --Editor ${discussion}\n`;
}

test("archives require every result to be final and strictly older than seven days", () => {
    const cases: Array<{
        entries: ArchiveEntryState[];
        reason: string;
    }> = [
        { entries: [], reason: "empty" },
        {
            entries: [OLD_ENTRY, { ...OLD_ENTRY, checked: false }],
            reason: "unreviewed",
        },
        {
            entries: [OLD_ENTRY, { ...OLD_ENTRY, rechecking: true }],
            reason: "rechecking",
        },
        {
            entries: [{ ...OLD_ENTRY, latestCheckTimestamp: null }],
            reason: "unknown",
        },
        {
            entries: [{ ...OLD_ENTRY, latestCheckTimestamp: NaN }],
            reason: "unknown",
        },
        {
            entries: [
                OLD_ENTRY,
                {
                    ...OLD_ENTRY,
                    latestCheckTimestamp: Date.parse("2026-09-23T12:00:00Z"),
                },
            ],
            reason: "recent",
        },
        {
            entries: [
                {
                    ...OLD_ENTRY,
                    latestCheckTimestamp: Date.parse("2026-10-01T12:00:00Z"),
                },
            ],
            reason: "recent",
        },
    ];
    for (const { entries, reason } of cases)
        assert.deepEqual(getArchiveEligibility(entries, null, NOW), {
            available: false,
            emphasized: false,
            reason,
        });
    assert.deepEqual(
        getArchiveEligibility(
            [
                {
                    ...OLD_ENTRY,
                    latestCheckTimestamp: Date.parse("2026-09-23T11:59:59Z"),
                },
            ],
            null,
            NOW,
        ),
        { available: true, emphasized: true, reason: null },
    );
});

test("recent discussion keeps an eligible archive available without emphasis", () => {
    for (const timestamp of [
        "2026-09-23T12:00:00Z",
        "2026-09-29T12:00:00Z",
        "2026-10-01T12:00:00Z",
    ])
        assert.deepEqual(
            getArchiveEligibility([OLD_ENTRY], Date.parse(timestamp), NOW),
            { available: true, emphasized: false, reason: null },
        );
    assert.deepEqual(getArchiveEligibility([OLD_ENTRY], null, NOW), {
        available: true,
        emphasized: true,
        reason: null,
    });
    assert.equal(
        getArchiveEligibility([OLD_ENTRY], null, new Date(NaN)).reason,
        "unknown",
    );
});

test("UTC signatures use the newest complete valid date across wiki language formats", () => {
    assert.equal(
        getLatestUtcSignature(
            `${OLD_SIGNATURE}\n12:34, 20 September 2026 (UTC)\n2026年9月25日 (五) 01:02 (UTC)`,
        ),
        Date.parse("2026-09-25T01:02:00Z"),
    );
    assert.equal(
        getLatestUtcSignature("2026年 9月 25日 （五） 01:02 （UTC）"),
        Date.parse("2026-09-25T01:02:00Z"),
    );
    for (const invalid of [
        "2026年2月30日 (一) 12:00 (UTC)",
        "2026年9月10日 (四) 24:00 (UTC)",
        "2026年9月10日 (四) 12:60 (UTC)",
        "2026年9月10日 (UTC)",
        "2026年9月10日 (四) 12:00 (CST)",
    ])
        assert.equal(getLatestUtcSignature(invalid), null);
});

test("comments and literal wikitext cannot provide or replace review timestamps", () => {
    const recent = "2026年9月29日 (二) 12:00 (UTC)";
    const ignored = [
        `<!-- ${recent} -->`,
        `<nowiki>${recent}</nowiki>`,
        `<pre>${recent}</pre>`,
        `<source lang="wikitext">${recent}</source>`,
        `<syntaxhighlight lang="wikitext">${recent}</syntaxhighlight>`,
    ].join("\n");
    assert.equal(getLatestUtcSignature(ignored), null);
    assert.equal(
        getLatestUtcSignature(`${OLD_SIGNATURE}\n${ignored}`),
        OLD_ENTRY.latestCheckTimestamp,
    );
});

test("saved source checks every nomination and uses the latest replacement review", () => {
    assert.deepEqual(getWikitextArchiveEligibility(section([OLD_CHECK]), NOW), {
        available: true,
        emphasized: true,
        reason: null,
    });
    assert.equal(
        getWikitextArchiveEligibility(section([OLD_CHECK, ""]), NOW).reason,
        "unreviewed",
    );
    assert.equal(
        getWikitextArchiveEligibility(
            section([
                `${OLD_CHECK}\n--Replacement 2026年9月29日 (二) 12:00 (UTC)`,
            ]),
            NOW,
        ).reason,
        "recent",
    );
    assert.equal(
        getWikitextArchiveEligibility(section(["<!-- Manual check -->"]), NOW)
            .reason,
        "unreviewed",
    );
    assert.equal(
        getWikitextArchiveEligibility(section(["Manual unsigned result"]), NOW)
            .reason,
        "unknown",
    );
});

test("only actual check templates with an active status prevent archiving", () => {
    const recheck = `{{ACG提名2/check|ver=1|1a|status=rechecking}}--Reviewer ${OLD_SIGNATURE}`;
    assert.equal(
        getWikitextArchiveEligibility(section([recheck]), NOW).reason,
        "rechecking",
    );
    for (const harmless of [
        `${OLD_CHECK} <!-- ${recheck} -->`,
        `${OLD_CHECK} <nowiki>${recheck}</nowiki>`,
        `${OLD_CHECK} {{Other template|status=rechecking}}`,
        `{{ACG提名2/check|ver=1|1a|message={{Other|status=rechecking}}}}--Reviewer ${OLD_SIGNATURE}`,
        `{{ACG提名2/check|ver=1|1a|status=rechecking|status=checked}}--Reviewer ${OLD_SIGNATURE}`,
    ])
        assert.equal(
            getWikitextArchiveEligibility(section([harmless]), NOW).available,
            true,
        );
    assert.equal(
        getWikitextArchiveEligibility(
            section([OLD_CHECK], `Discussion mentions rechecking: ${recheck}`),
            NOW,
        ).available,
        true,
    );
});

test("discussion emphasis reads outside nomination templates and ignores quoted dates", () => {
    const recent = "2026年9月29日 (二) 12:00 (UTC)";
    assert.deepEqual(
        getWikitextArchiveEligibility(section([OLD_CHECK], recent), NOW),
        { available: true, emphasized: false, reason: null },
    );
    assert.equal(
        getWikitextArchiveEligibility(
            section([OLD_CHECK], `${OLD_SIGNATURE}\n<!-- ${recent} -->`),
            NOW,
        ).emphasized,
        true,
    );
    assert.equal(
        getWikitextArchiveEligibility("=== 9月9日 ===\nNo nominations", NOW)
            .reason,
        "empty",
    );
});
