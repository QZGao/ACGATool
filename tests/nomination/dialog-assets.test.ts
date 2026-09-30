import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse, compileTemplate } from "@vue/compiler-sfc";
import { extractDialogTemplates } from "../../src/features/nomination/templates.ts";

const source = readFileSync(
    new URL("../../src/features/nomination/dialog.vue", import.meta.url),
    "utf8",
);

test("nomination templates remain template-only and compile as Vue markup", () => {
    const { descriptor, errors } = parse(source, {
        filename: "dialog.vue",
        sourceMap: false,
    });
    assert.deepEqual(errors, []);
    assert.ok(descriptor.template);
    assert.equal(descriptor.script, null);
    assert.equal(descriptor.scriptSetup, null);
    assert.deepEqual(descriptor.styles, []);
    const templates = extractDialogTemplates(source);
    assert.equal(Object.keys(templates).length, 10);
    for (const [name, template] of Object.entries(templates)) {
        assert.ok(template.trim(), name);
        const compiled = compileTemplate({
            source: template,
            filename: name + ".vue",
            id: name,
        });
        assert.deepEqual(compiled.errors, [], name);
    }
});

test("template extraction rejects missing or duplicated components", () => {
    assert.throws(() => extractDialogTemplates(""), /Missing dialog template/);
    assert.throws(
        () => extractDialogTemplates(source + source),
        /Duplicate dialog template/,
    );
});

test("source loaders preserve template and stylesheet source", async () => {
    const [{ default: template }, { default: styles }] = await Promise.all([
        import("../../src/features/nomination/dialog.vue"),
        import("../../src/features/nomination/dialog.css"),
    ]);
    assert.equal(template, source);
    assert.equal(
        styles,
        readFileSync(
            new URL(
                "../../src/features/nomination/dialog.css",
                import.meta.url,
            ),
            "utf8",
        ),
    );
});
