/** Build standalone MediaWiki and userscript installation artifacts. */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { build, transform } from "esbuild";
import { minify } from "terser";

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

async function bundle(compact: boolean): Promise<string> {
    const result = await build({
        absWorkingDir: root,
        entryPoints: ["src/app/browser.ts"],
        bundle: true,
        format: "iife",
        charset: "utf8",
        target: "es2024",
        loader: { ".vue": "text" },
        plugins: [
            {
                name: "text-styles",
                setup(context) {
                    context.onLoad({ filter: /\.css$/ }, async ({ path }) => {
                        const source = await readFile(path, "utf8");
                        const contents = compact
                            ? (
                                  await transform(source, {
                                      loader: "css",
                                      minify: true,
                                  })
                              ).code
                            : source;
                        return { contents, loader: "text" };
                    });
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
        "/*!",
        " * ACGATool by SuperGrey.",
        " * Main page: [[User:SuperGrey/gadgets/ACGATool]]",
        ` * ${manifest.name} ${manifest.version}`,
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
