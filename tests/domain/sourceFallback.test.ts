import assert from "node:assert/strict";
import test from "node:test";

import {
    formatEditableItemSource,
    ITEM_SOURCE_FIELDS,
    parseEditableItemSource,
} from "../../src/domain/wikitext.ts";

const VALUES = {
    條目名稱: " 條目=with=equals",
    用戶名稱: " Example",
    提名理由: " {{ACG提名2/request|ver=1|5c-fac-half}}",
    核對用: " {{ACG提名2/check|ver=1|}}",
};

test("item source formatter emits four canonical lines with an optional shared suffix", () => {
    assert.deepEqual(ITEM_SOURCE_FIELDS, [
        "條目名稱",
        "用戶名稱",
        "提名理由",
        "核對用",
    ]);
    assert.equal(
        formatEditableItemSource(VALUES, 12),
        [
            "|條目名稱12 = 條目=with=equals",
            "|用戶名稱12 = Example",
            "|提名理由12 = {{ACG提名2/request|ver=1|5c-fac-half}}",
            "|核對用12 = {{ACG提名2/check|ver=1|}}",
        ].join("\n"),
    );
});

test("item source formatter and parser round-trip exact values after the first equals sign", () => {
    const source = formatEditableItemSource(VALUES, "007");
    assert.deepEqual(parseEditableItemSource(source), {
        ok: true,
        suffix: "007",
        values: VALUES,
    });
});

test("item source formatter and parser preserve multiline field continuations", () => {
    const values = {
        ...VALUES,
        提名理由: " {{ACG提名2/request\n|ver=1\n|1c 4}}",
        核對用: " first line\nsecond=line",
    };
    assert.deepEqual(
        parseEditableItemSource(formatEditableItemSource(values, 3)),
        {
            ok: true,
            suffix: "3",
            values,
        },
    );
});

test("item source parser accepts reordered unsuffixed fields and CRLF lines", () => {
    const source = [
        "|核對用=check=tail",
        "|提名理由 =reason",
        "|條目名稱=title",
        "|用戶名稱 = user",
    ].join("\r\n");
    assert.deepEqual(parseEditableItemSource(source), {
        ok: true,
        suffix: "",
        values: {
            核對用: "check=tail",
            提名理由: "reason",
            條目名稱: "title",
            用戶名稱: " user",
        },
    });
});

test("item source parser rejects missing, duplicate, extra, and mixed-suffix lines precisely", async (t: any) => {
    const cases = [
        {
            name: "missing field",
            source: "|條目名稱=x\n|用戶名稱=y\n|提名理由=z",
            code: "missing-field",
        },
        {
            name: "duplicate field",
            source: "|條目名稱=x\n|用戶名稱=y\n|提名理由=z\n|核對用=c\n|條目名稱=again",
            code: "duplicate-field",
        },
        {
            name: "extra line",
            source: "|extra=no\n|條目名稱=x\n|用戶名稱=y\n|提名理由=z\n|核對用=c",
            code: "extra-line",
        },
        {
            name: "mixed suffix",
            source: "|條目名稱1=x\n|用戶名稱1=y\n|提名理由2=z\n|核對用1=c",
            code: "mixed-suffix",
        },
        {
            name: "missing equals",
            source: "|條目名稱\n|用戶名稱=y\n|提名理由=z\n|核對用=c",
            code: "missing-equals",
        },
    ];

    for (const item of cases) {
        await t.test(item.name, () => {
            const result = parseEditableItemSource(item.source);
            assert.equal(result.ok, false);
            assert.equal(result.error.code, item.code);
            assert.match(result.error.message, /\S/u);
        });
    }
});

test("item source formatter rejects invalid suffixes and omitted fields", () => {
    assert.throws(() => formatEditableItemSource(VALUES, "-1"), /suffix/u);
    assert.throws(
        () => formatEditableItemSource({ 條目名稱: "x" }),
        /Missing item source field/u,
    );
    // @ts-expect-error Exercise the public parser runtime type guard.
    assert.throws(() => parseEditableItemSource(null), TypeError);
});
