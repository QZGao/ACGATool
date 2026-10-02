/**
 * @file tests/tooling/compact-assets.test.ts
 * Purpose: tests / tooling / compact assets.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. Test scenarios
 * 4. render
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compileTemplate, parse } from "@vue/compiler-sfc";
import * as Vue from "vue";
import en from "../../src/i18n/en.json" with { type: "json" };
import { extractDialogTemplates } from "../../src/features/nomination/templates.ts";
import {
    compactMessageKeys,
    compactTemplate,
    shortenMessageKeys,
} from "../../scripts/compact-assets.ts";

const keys = compactMessageKeys(Object.keys(en));

test("compact message IDs preserve public data fields and rewrite catalog metadata consistently", () => {
    assert.equal(keys.has("media"), false);
    assert.equal(keys.has("score"), false);
    assert.equal(new Set(keys.values()).size, keys.size);
    assert.ok(Array.from(keys.values()).every((key) => !(key in en)));
    const key = keys.get("nomination_additional_comment_help")!;
    assert.ok(key.length < 4);
    const source = `
        const catalog = { nomination_additional_comment_help: 'Helpful text' };
        const metadata = { labelKey: 'nomination_additional_comment_help' };
        const msg = key => catalog[key];
        return [msg(metadata.labelKey), 'Contains nomination_additional_comment_help', { media: 'media', score: 3 }];
    `;
    // A function body is wrapped so the parser can check it as a module.
    const shortened = shortenMessageKeys(
        `function fixture() { ${source} }`,
        keys,
    );
    const result = new Function(`${shortened}; return fixture();`)();
    assert.deepEqual(result, [
        "Helpful text",
        "Contains nomination_additional_comment_help",
        { media: "media", score: 3 },
    ]);
    assert.ok(shortened.includes(`labelKey: "${key}"`));
});

test("compact message IDs avoid existing plain IDs", () => {
    const keys = compactMessageKeys([
        "a",
        "b",
        "c",
        "first_message",
        "next_message",
    ]);
    assert.equal(keys.get("first_message"), "d");
    assert.equal(keys.get("next_message"), "e");
    const source = shortenMessageKeys(
        `function fixture() { const catalog = { first_message: "First", next_message: "Next", b: "B", c: "C" }; return [catalog["first_message"], catalog["next_message"], catalog.b, catalog.c]; }`,
        keys,
    );
    assert.deepEqual(new Function(`${source}; return fixture();`)(), [
        "First",
        "Next",
        "B",
        "C",
    ]);
});

function render(source: string, context: Record<string, unknown>): any {
    const { descriptor, errors } = parse(source, { sourceMap: false });
    assert.deepEqual(errors, []);
    const compiled = compileTemplate({
        source: descriptor.template!.content,
        filename: "fixture.vue",
        id: "fixture",
        transformAssetUrls: false,
        compilerOptions: {
            mode: "function",
            prefixIdentifiers: false,
            cacheHandlers: false,
            hoistStatic: false,
            comments: false,
        },
    });
    assert.deepEqual(compiled.errors, []);
    return new Function("Vue", compiled.code)(Vue)(context, []);
}

test("single-line templates preserve text, entities, loops, translated expressions, and event statements", () => {
    const source = `<template>
        <section title="a &quot;b&quot; &amp; c" :data-note="note">
            <p>{{ msg('nomination_additional_comment_help') + ' ' + label }}</p>
            <ul>
                <li v-for="(item, index) in items" :key="index" @click="select(item); ping()">
                    {{ index }}: {{ item }}
                </li>
            </ul>
            <p>Before <b>bold</b> after &amp; &lt;</p>
            <pre>  a\n  b</pre>
            <code v-pre>{{  unparsed }}</code>
        </section>
    </template>`;
    const calls: unknown[] = [];
    const context = {
        note: '<untrusted "text">',
        label: "Recipient",
        items: ["Alpha", "Beta"],
        msg: (key: string) =>
            key === "nomination_additional_comment_help" ||
            key === keys.get("nomination_additional_comment_help")
                ? "Comment help"
                : key,
        select: (item: string) => calls.push(item),
        ping: () => calls.push("ping"),
    };
    const compact = compactTemplate(source, keys);
    assert.doesNotMatch(compact, /[\r\n]/u);
    assert.doesNotMatch(compact, /nomination_additional_comment_help/u);
    const original = render(source, context);
    const reduced = render(compact, context);
    assert.equal(JSON.stringify(reduced), JSON.stringify(original));
    original.children[1].children[0].children[0].props.onClick();
    reduced.children[1].children[0].children[0].props.onClick();
    assert.deepEqual(calls, ["Alpha", "ping", "Alpha", "ping"]);
});

test("all compact production dialog templates retain boundaries and compile", () => {
    const source = readFileSync(
        new URL("../../src/features/nomination/dialog.vue", import.meta.url),
        "utf8",
    );
    const compact = compactTemplate(source, keys);
    assert.doesNotMatch(compact, /[\r\n]/u);
    assert.ok(compact.length < source.length / 2);
    const templates = extractDialogTemplates(compact);
    assert.deepEqual(
        Object.keys(templates),
        Object.keys(extractDialogTemplates(source)),
    );
    for (const [name, template] of Object.entries(templates)) {
        assert.deepEqual(
            compileTemplate({
                source: template,
                filename: name + ".vue",
                id: name,
            }).errors,
            [],
            name,
        );
    }
});
