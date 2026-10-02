/**
 * @file scripts/build.ts
 * Purpose: Build standalone MediaWiki and userscript installation artifacts.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. Initialization and execution
 * 4. bundle
 * 5. notice
 * 6. gadget
 * 7. userscript
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { build, transform } from "esbuild";
import { minify } from "terser";
import {
    compactMessageKeys,
    compactTemplate,
    shortenMessageKeys,
} from "./compact-assets.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
) as {
    name: string;
    version: string;
    description: string;
};
const license = (await readFile(join(root, "LICENSE"), "utf8")).trim();
if (!license.startsWith("MIT License") || license.includes("*/")) {
    throw new Error("The MIT license cannot be embedded safely.");
}
const messageKeys = compactMessageKeys(
    Object.keys(
        JSON.parse(await readFile(join(root, "src/i18n/en.json"), "utf8")),
    ),
);

async function bundle(compact: boolean): Promise<string> {
    const result = await build({
        absWorkingDir: root,
        entryPoints: ["src/app/browser.ts"],
        bundle: true,
        format: "iife",
        charset: "utf8",
        target: "es2024",
        plugins: [
            {
                name: "embedded-assets",
                setup(context) {
                    context.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
                        const source = await readFile(path, "utf8");
                        return {
                            contents: compact
                                ? compactTemplate(source, messageKeys)
                                : source,
                            loader: "text",
                        };
                    });
                    context.onLoad({ filter: /\.css$/ }, async ({ path }) => {
                        const source = await readFile(path, "utf8");
                        const contents = compact
                            ? (
                                  await transform(source, {
                                      loader: "css",
                                      minify: true,
                                  })
                              ).code.trim()
                            : source;
                        return { contents, loader: "text" };
                    });
                    if (!compact) return;
                    context.onLoad({ filter: /\.ts$/ }, async ({ path }) => ({
                        contents: shortenMessageKeys(
                            await readFile(path, "utf8"),
                            messageKeys,
                        ),
                        loader: "ts",
                    }));
                    context.onLoad(
                        { filter: /\/i18n\/[^/]+\.json$/ },
                        async ({ path }) => ({
                            contents: JSON.stringify(
                                Object.fromEntries(
                                    Object.entries(
                                        JSON.parse(
                                            await readFile(path, "utf8"),
                                        ),
                                    ).map(([key, value]) => [
                                        messageKeys.get(key) ?? key,
                                        value,
                                    ]),
                                ),
                            ),
                            loader: "json",
                        }),
                    );
                },
            },
        ],
        metafile: true,
        logLevel: "silent",
        write: false,
    });
    const dependencies = Object.keys(result.metafile.inputs).filter((path) =>
        path.includes("node_modules/"),
    );
    if (dependencies.length > 0) {
        throw new Error(
            `Browser dependencies must be supplied by MediaWiki ResourceLoader: ${dependencies.join(", ")}`,
        );
    }
    const source = result.outputFiles[0]?.text;
    if (source == null)
        throw new Error("esbuild did not return a browser bundle.");
    return source;
}

const [readable, compact] = await Promise.all([bundle(false), bundle(true)]);
const minified = await minify(compact, {
    ecma: 2024,
    compress: { ecma: 2024, passes: 2 },
    mangle: true,
    format: { comments: false, ecma: 2024 },
});
if (minified.code == null) throw new Error("Terser did not return JavaScript.");

const mediaWiki = gadget(minified.code);
const artifacts = new Map([
    ["acga_tool.min.js", mediaWiki],
    ["acga_tool.user.js", userscript(readable)],
]);
for (const [filename, source] of artifacts) new Script(source, { filename });

const output = join(root, "dist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(
    Array.from(artifacts, ([filename, source]) =>
        writeFile(join(output, filename), source),
    ),
);
for (const [filename, source] of artifacts) {
    console.log(`Built dist/${filename} (${Buffer.byteLength(source)} bytes)`);
}

function notice(): string {
    return [
        "/**",
        " * ACGATool",
        " *",
        ` * Purpose: ${manifest.description}`,
        " *",
        ` * @name ${manifest.name}`,
        ` * @version ${manifest.version}`,
        " * @license MIT",
        " *",
        " * Table of contents:",
        " * 1. Metadata and license notices",
        " * 2. MediaWiki bootstrap and browser program",
        " */",
        "",
        "/*!",
        " * ACGATool by SuperGrey.",
        " * Main page: [[User:SuperGrey/gadgets/ACGATool]]",
        " * AI-assisted repository edits carry no additional copyright claim.",
        " * Original authorship, credit, and MIT terms remain preserved.",
        " *",
        ...license.split(/\r?\n/u).map((line) => ` * ${line}`),
        " */",
    ].join("\n");
}

function gadget(program: string): string {
    return [notice(), "", "//<nowiki>", program.trim(), "//</nowiki>", ""].join(
        "\n",
    );
}

function userscript(program: string): string {
    const indented = program
        .trim()
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n");
    return [
        "// ==UserScript==",
        "// @name         ACGATool",
        "// @namespace    wp-acga-tool",
        `// @version      ${manifest.version}`,
        `// @description  ${manifest.description}`,
        "// @author       SuperGrey",
        "// @license      MIT",
        "// @match        https://zh.wikipedia.org/*",
        "// @homepageURL  https://github.com/For-Each-Next/wp-acga-tool",
        "// @downloadURL  https://github.com/For-Each-Next/wp-acga-tool/releases/latest/download/acga_tool.user.js",
        "// @updateURL    https://github.com/For-Each-Next/wp-acga-tool/releases/latest/download/acga_tool.user.js",
        "// @grant        none",
        "// @run-at       document-end",
        "// ==/UserScript==",
        "",
        notice(),
        "",
        "(async function () {",
        '    "use strict";',
        "    for (let attempt = 0; attempt < 200; attempt += 1) {",
        '        if (typeof window.mw?.config?.get === "function" && typeof window.mw?.loader?.using === "function") break;',
        "        await new Promise((resolve) => window.setTimeout(resolve, 50));",
        "    }",
        '    if (typeof window.mw?.config?.get !== "function" || typeof window.mw?.loader?.using !== "function") return;',
        indented,
        "})();",
        "",
    ].join("\n");
}
