import assert from "node:assert/strict";
import test from "node:test";
import { nominationPageContext } from "../../src/platform/mediawiki/page-context.ts";

const article = {
    pageName: "Example_article",
    title: "Example article",
    namespaceNumber: 0,
    revisionId: 42,
    currentRevisionId: 42,
    diffNewId: undefined,
};
const location = { hash: "", search: "" };

test("article and talk views suggest article contributors; files suggest uploaders", () => {
    assert.deepEqual(nominationPageContext(article, location), {
        pageName: "Example article",
        initialCategory: "article",
        recipientScope: "article",
    });
    assert.equal(
        nominationPageContext({ ...article, namespaceNumber: 1 }, location)
            .pageName,
        "Example article",
    );
    assert.deepEqual(
        nominationPageContext(
            {
                ...article,
                namespaceNumber: 6,
                pageName: "File:Example_image.svg",
                title: "Example image.svg",
            },
            location,
        ),
        {
            pageName: "File:Example image.svg",
            initialCategory: "media",
            recipientScope: "media",
        },
    );
});

test("the exact viewed revision takes priority for permalink and diff launches", () => {
    for (const search of ["?oldid=42", "?diff=42&oldid=40"]) {
        assert.deepEqual(
            nominationPageContext(article, { ...location, search }),
            {
                pageName: "Example article",
                initialCategory: "article",
                recipientScope: "revision",
                revisionId: 42,
            },
        );
    }
    assert.equal(
        nominationPageContext({ ...article, currentRevisionId: 50 }, location)
            .recipientScope,
        "revision",
    );
    assert.deepEqual(
        nominationPageContext(
            {
                ...article,
                revisionId: 0,
                diffNewId: 48,
                currentRevisionId: 50,
            },
            { ...location, search: "?diff=prev&oldid=48&diffonly=yes" },
        ),
        {
            pageName: "Example article",
            initialCategory: "article",
            recipientScope: "revision",
            revisionId: 48,
        },
    );
    assert.equal(
        nominationPageContext(
            {
                ...article,
                namespaceNumber: 6,
            },
            { ...location, search: "?oldid=42" },
        ).recipientScope,
        "revision",
    );
});

test("MediaViewer file context overrides an article permalink and malformed hashes are ignored", () => {
    assert.deepEqual(
        nominationPageContext(article, {
            hash: "#/media/File:Example%20Commons_image.svg",
            search: "?oldid=42",
        }),
        {
            pageName: "File:Example Commons image.svg",
            initialCategory: "media",
            recipientScope: "media",
        },
    );
    assert.equal(
        nominationPageContext(article, { ...location, hash: "#/media/File:%" })
            .recipientScope,
        "article",
    );
});
