import assert from "node:assert/strict";
import test from "node:test";
import {
    findDuplicateNominations,
    getExistingNominations,
    getNominationCheckRestriction,
    normalizeNominationPageName,
    normalizeNominationRecipient,
} from "../../src/domain/existing-nominations.ts";

function nomination(
    page: string,
    recipient: string,
    reason = "1c",
    check = "",
) {
    return `{{ACG提名2\n|條目名稱1=${page}\n|用戶名稱1=${recipient}\n|提名理由1={{ACG提名2/request|ver=1|${reason}}}\n|核對用1=${check}\n}}`;
}

test("current-registry indexing preserves repeated dates, reviews and raw reason text", () => {
    const text = `=== 9月27日 ===\n${nomination("Example_article", "Editor", "1c 4-dyk", "{{ACG提名2/check|ver=1|1c}}--~~~~")}\n=== 9月27日 ===\n${nomination("Example article", "Other", "5x")}\n${nomination("Example article", "Editor", "6(Custom)[0.5]")}\n`;
    const entries = getExistingNominations(text, "example article#History");
    assert.equal(entries.length, 3);
    assert.deepEqual(
        entries.map((item) => [
            item.date,
            item.index,
            item.sectionOccurrence,
            item.dateAnchor,
        ]),
        [
            ["9月27日", 1, 0, "9月27日"],
            ["9月27日", 1, 1, "9月27日_2"],
            ["9月27日", 2, 1, "9月27日_2"],
        ],
    );
    assert.deepEqual(
        entries.map((item) => [item.reasonText, item.checked]),
        [
            ["1c 4-dyk", true],
            ["5x", false],
            ["6(Custom)[0.5]", false],
        ],
    );
    assert.equal(getExistingNominations(text, "Different").length, 0);
    assert.equal(getExistingNominations(text, "").length, 0);
});

test("duplicates exclude the current physical entry and retain identical requests elsewhere", () => {
    const text = `=== 9月27日 ===\n${nomination("Example article", "Editor")}\n${nomination("Example article", "Editor")}\n${nomination("Example article", "Other")}\n=== 9月27日 ===\n${nomination("Example article", "Editor")}\n`;
    const entries = getExistingNominations(text);
    const matches = findDuplicateNominations(
        entries,
        "Example_article",
        "User:editor",
        { date: "9月27日", index: 1, sectionOccurrence: 0 },
    );
    assert.deepEqual(
        matches.map((item) => [item.index, item.sectionOccurrence]),
        [
            [2, 0],
            [1, 1],
        ],
    );
    assert.equal(findDuplicateNominations(entries, "", "Editor").length, 0);
    assert.equal(
        findDuplicateNominations(entries, "Example article", "").length,
        0,
    );
});

test("indexing ignores literal examples and nominations outside a date chapter", () => {
    const text = `${nomination("Lead", "Editor")}\n<!--\n=== 9月26日 ===\n${nomination("Comment", "Editor")}\n-->\n<nowiki>\n=== 9月26日 ===\n${nomination("Literal", "Editor")}\n</nowiki>\n=== 9月27日 ===\n${nomination("Valid", "Editor")}\n== Other content ==\n${nomination("Unrelated", "Editor")}\n=== Discussion ===\n${nomination("Discussion", "Editor")}\n`;
    assert.deepEqual(
        getExistingNominations(text).map((item) => item.pageName),
        ["Valid"],
    );
});

test("identity comparison recognizes spaces and file aliases without ignoring full-name case", () => {
    assert.equal(
        normalizeNominationPageName(":檔案:Example_image.png"),
        "File:Example image.png",
    );
    assert.equal(
        normalizeNominationPageName("File:example_image.png"),
        "File:Example image.png",
    );
    assert.equal(
        normalizeNominationRecipient(" 使用者:example_editor "),
        "Example editor",
    );
    assert.notEqual(
        normalizeNominationRecipient("ExampleEditor"),
        normalizeNominationRecipient("Exampleeditor"),
    );
});

test("check restrictions distinguish nomination ownership and score ownership", () => {
    const currentUser = "Current editor";
    assert.equal(
        getNominationCheckRestriction(
            { awarder: "Other", nominator: "User:current_editor" },
            currentUser,
        ),
        "check_disabled_own_nomination",
    );
    assert.equal(
        getNominationCheckRestriction(
            { awarder: "使用者:Current_editor" },
            currentUser,
        ),
        "check_disabled_own_score",
    );
    assert.equal(
        getNominationCheckRestriction(
            { awarder: currentUser, nominator: currentUser },
            currentUser,
        ),
        "check_disabled_own_nomination_and_score",
    );
    assert.equal(
        getNominationCheckRestriction(
            { awarder: "Current Editor", nominator: "Other" },
            currentUser,
        ),
        null,
    );
    assert.equal(
        getNominationCheckRestriction(
            { awarder: currentUser, nominator: currentUser },
            null,
        ),
        null,
    );
});

test("explicit table signatures identify nominators and contiguous split tables share their signature", () => {
    const text = `=== 9月27日 ===\n${nomination("First split", "Recipient")}\n\n${nomination("Second split", "Recipient")}\n'''提名人：''' [[User:Current_editor|Display name]] ([[User talk:Current editor|talk]]) 2026年9月27日 (UTC)\n: {{說明}}：Comment by [[User:Other|Other]]--~~~~\n${nomination("Next group", "Recipient")}\n'''提名人:''' [[使用者討論:Other|talk]] 2026年9月27日 (UTC)\n`;
    assert.deepEqual(
        getExistingNominations(text).map((entry) => [
            entry.pageName,
            entry.nominator,
        ]),
        [
            ["First split", "Current_editor"],
            ["Second split", "Current_editor"],
            ["Next group", "Other"],
        ],
    );
});

test("signature detection ignores examples and never infers a nominator from discussion text", () => {
    const text = `=== 9月27日 ===\n${nomination("Commented signature", "Recipient")}\n<!-- '''提名人：''' [[User:Current editor|Current editor]] -->\n${nomination("Literal signature", "Recipient")}\n<nowiki>'''提名人：''' [[User:Current editor|Current editor]]</nowiki>\n: Discussion by [[User:Current editor|Current editor]]\n${nomination("Unattached signature", "Recipient")}\n: Arbitrary discussion text\n'''提名人：''' [[User:Current editor|Current editor]]\n${nomination("Signed group", "Recipient")}\n<!-- '''提名人：''' [[User:Current editor|Current editor]] -->\n'''提名人：''' [[User:Other|Other]]\n`;
    assert.deepEqual(
        getExistingNominations(text).map((entry) => entry.nominator),
        [undefined, undefined, undefined, "Other"],
    );
});

test("a table's attached nominator applies to all numbered nominations", () => {
    const text = `=== 9月27日 ===\n{{ACG提名2\n|條目名稱1=First\n|用戶名稱1=Recipient\n|提名理由1={{ACG提名2/request|ver=1|1c}}\n|核對用1=\n|條目名稱2=Second\n|用戶名稱2=Other\n|提名理由2={{ACG提名2/request|ver=1|3}}\n|核對用2=\n}}\n'''提名人：''' [[User:Current editor|Current editor]]\n`;
    assert.deepEqual(
        getExistingNominations(text).map((entry) => [
            entry.pageName,
            entry.nominator,
        ]),
        [
            ["First", "Current editor"],
            ["Second", "Current editor"],
        ],
    );
});
