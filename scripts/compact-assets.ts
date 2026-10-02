/**
 * @file scripts/compact-assets.ts
 * Purpose: Compact embedded assets without changing their readable source files.
 *
 * Table of contents:
 * 1. Imports
 * 2. TemplateNode
 * 3. compactMessageKeys
 * 4. shortenMessageKeys
 * 5. compactTemplate
 */

import { babelParse, MagicString, parse } from "@vue/compiler-sfc";
import { transformSync } from "esbuild";

type TemplateNode = NonNullable<
    NonNullable<ReturnType<typeof parse>["descriptor"]["template"]>["ast"]
>["children"][number];

export function compactMessageKeys(keys: string[]): Map<string, string> {
    // Short plain words can also be public data fields or nomination categories.
    // Only rename the distinct underscore-separated message identifiers.
    const reserved = new Set(keys);
    let index = 0;
    return new Map(
        keys
            .filter((key) => key.includes("_"))
            .map((key) => {
                let compact;
                do {
                    compact =
                        String.fromCharCode(97 + (index % 26)) +
                        (index < 26 ? "" : Math.floor(index / 26).toString(36));
                    index++;
                } while (reserved.has(compact));
                return [key, compact];
            }),
    );
}

export function shortenMessageKeys(
    source: string,
    keys: ReadonlyMap<string, string>,
): string {
    const output = new MagicString(source);
    const ast = babelParse(source, {
        sourceType: "module",
        plugins: ["typescript"],
    });
    function visit(value: unknown): void {
        if (value == null || typeof value !== "object") return;
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        const node = value as Record<string, unknown>;
        if (node.type === "StringLiteral") {
            const key = keys.get(String(node.value));
            if (key != null)
                output.overwrite(
                    Number(node.start),
                    Number(node.end),
                    JSON.stringify(key),
                );
        } else if (node.type === "ObjectProperty" && !node.computed) {
            const key = node.key as Record<string, unknown>;
            const shortened = keys.get(String(key.name));
            if (key.type === "Identifier" && shortened != null) {
                if (node.shorthand)
                    throw new Error("Message keys must have explicit values.");
                output.overwrite(Number(key.start), Number(key.end), shortened);
            }
        }
        for (const [key, child] of Object.entries(node)) {
            if (!["loc", "extra", "comments"].includes(key)) visit(child);
        }
    }
    visit(ast);
    return output.toString();
}

export function compactTemplate(
    source: string,
    keys: ReadonlyMap<string, string> = new Map(),
): string {
    const { descriptor, errors } = parse(source, {
        filename: "dialog.vue",
        sourceMap: false,
    });
    if (errors.length || !descriptor.template?.ast)
        throw new Error(`Invalid dialog template: ${errors.join(", ")}`);

    function javascript(source: string): string {
        return transformSync(shortenMessageKeys(source, keys), {
            target: "es2024",
            minifyWhitespace: true,
        }).code.trim();
    }
    function expression(source: string): string {
        const prefix = "const _=";
        const compact = javascript(`${prefix}(${source});`).slice(
            prefix.length,
            -1,
        );
        // Vue's browser compiler recognizes handlers by their expression shape.
        // Parenthesizing a whole arrow would make it an unevaluated inline handler.
        const ast = babelParse(`${prefix}${compact};`);
        const declaration = ast.program.body[0];
        if (
            declaration.type === "VariableDeclaration" &&
            declaration.declarations[0].init?.type ===
                "ArrowFunctionExpression" &&
            compact.startsWith("(") &&
            compact.endsWith(")")
        )
            return compact.slice(1, -1);
        return compact;
    }
    function parameters(source: string): string {
        return javascript(`function _(${source}){}`).slice(
            "function _(".length,
            -3,
        );
    }
    function directive(name: string, source: string): string {
        if (name === "for") {
            const match = source.match(/^([\s\S]*?)\s+(?:in|of)\s+([\s\S]+)$/u);
            if (!match) throw new Error(`Invalid v-for: ${source}`);
            const aliases = match[1].trim().replace(/^\(([\s\S]*)\)$/u, "$1");
            return `(${parameters(aliases)}) in ${expression(match[2])}`;
        }
        if (name === "slot") return parameters(source);
        if (name === "on") {
            try {
                return expression(source);
            } catch {
                return javascript(source);
            }
        }
        return expression(source);
    }
    function attribute(value: string): string {
        return value
            .replaceAll("&", "&amp;")
            .replaceAll('"', "&quot;")
            .replaceAll("\n", "&#10;")
            .replaceAll("\r", "&#13;");
    }
    function render(node: TemplateNode): string {
        switch (node.type) {
            case 1: {
                // Element.
                // Vue consumes v-pre during parsing; preserve its literal subtree.
                if (/^<[^>]*\sv-pre(?:[\s=>]|\/>)/u.test(node.loc.source))
                    return node.loc.source;
                const props = node.props.map((prop) => {
                    if (prop.type === 6)
                        return (
                            prop.name +
                            (prop.value
                                ? `="${attribute(prop.value.content)}"`
                                : "")
                        );
                    return (
                        prop.rawName +
                        (prop.exp
                            ? `="${attribute(directive(prop.name, prop.exp.loc.source))}"`
                            : "")
                    );
                });
                const opening = `<${node.tag}${props.length ? " " + props.join(" ") : ""}`;
                if (node.isSelfClosing) return `${opening}/>`;
                return `${opening}>${node.children.map(render).join("")}</${node.tag}>`;
            }
            case 2: // Vue has already condensed insignificant text whitespace.
                return node.content
                    .replaceAll("&", "&amp;")
                    .replaceAll("<", "&lt;")
                    .replaceAll("\n", "&#10;")
                    .replaceAll("\r", "&#13;");
            case 3:
                // Component boundaries are needed by the template extractor.
                return /^\/?acga-template:[a-z-]+$/u.test(node.content.trim())
                    ? `<!--${node.content.trim()}-->`
                    : "";
            case 5:
                return `{{${expression(node.content.loc.source)}}}`;
            default:
                throw new Error(`Unsupported template node: ${node.type}`);
        }
    }
    return `<template>${descriptor.template.ast.children.map(render).join("")}</template>`;
}
