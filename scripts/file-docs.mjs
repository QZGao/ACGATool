/**
 * @file scripts/file-docs.mjs
 * Purpose: Maintains file headings and Markdown tables of contents.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. Initialization and execution
 * 4. files
 * 5. markdownLines
 * 6. stripGeneratedContents
 * 7. markdownContents
 * 8. codeHeading
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { format, resolveConfig } from "prettier";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const check = process.argv.includes("--check");
const excluded = new Set([
    "node_modules",
    ".git",
    "dist",
    ".cache",
    ".idea",
    ".vscode",
    "test-results",
    "playwright-report",
    "coverage",
]);
const codeExtensions = new Set([
    ".ts",
    ".js",
    ".mjs",
    ".css",
    ".vue",
    ".yml",
    ".yaml",
    ".sh",
]);
const changed = [];

for (const path of await files(root)) {
    const extension = extname(path);
    if (extension !== ".md" && !codeExtensions.has(extension)) continue;
    const original = await readFile(path, "utf8");
    const name = relative(root, path).replaceAll("\\", "/");
    let updated =
        extension === ".md"
            ? markdownContents(original, name)
            : codeHeading(original, name, extension);
    if (extension !== ".sh")
        updated = await format(updated, {
            ...(await resolveConfig(path)),
            filepath: path,
        });
    if (updated === original) continue;
    changed.push(name);
    if (!check) await writeFile(path, updated);
}
if (changed.length > 0) {
    console.log(
        `${check ? "Outdated documentation" : "Updated documentation"}: ${changed.join(", ")}`,
    );
    if (check) process.exitCode = 1;
}

async function files(directory) {
    const output = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) output.push(...(await files(path)));
        else output.push(path);
    }
    return output;
}

/** Reads top-level lines without treating fenced examples as document markup. */
function markdownLines(source) {
    const lines = [];
    let offset = 0;
    let fence = null;
    for (const text of source.split("\n")) {
        const end = Math.min(offset + text.length + 1, source.length);
        const marker = text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
        let outsideFence = fence === null;
        if (fence !== null) {
            if (
                marker &&
                marker[1][0] === fence.character &&
                marker[1].length >= fence.length &&
                /^\s*$/u.test(marker[2])
            ) {
                fence = null;
            }
        } else if (
            marker &&
            (marker[1][0] !== "`" || !marker[2].includes("`"))
        ) {
            fence = { character: marker[1][0], length: marker[1].length };
            outsideFence = false;
        }
        lines.push({ text, start: offset, end, outsideFence });
        offset = end;
    }
    return lines;
}

/** Removes only complete generated blocks outside literal fenced examples. */
function stripGeneratedContents(source) {
    const ranges = [];
    let start = null;
    for (const line of markdownLines(source)) {
        if (!line.outsideFence) continue;
        if (start === null && line.text.trim() === "<!-- toc:start -->") {
            start = line.start;
        } else if (start !== null && line.text.trim() === "<!-- toc:end -->") {
            ranges.push({ start, end: line.end });
            start = null;
        }
    }
    for (const range of ranges.reverse()) {
        source = `${source.slice(0, range.start)}${source.slice(range.end)}`;
    }
    return source;
}

function markdownContents(source, name) {
    source = stripGeneratedContents(source);
    const title = name.includes("zh-Hant")
        ? "目錄"
        : name.includes("zh-Hans")
          ? "目录"
          : "Contents";
    const headings = [];
    const slugs = new Set();
    let firstSection = null;
    function headingSlug(text) {
        const base = text
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, "")
            .replaceAll(" ", "-");
        let slug = base;
        let index = 0;
        while (slugs.has(slug)) slug = `${base}-${++index}`;
        slugs.add(slug);
        return slug;
    }
    for (const line of markdownLines(source)) {
        if (!line.outsideFence) continue;
        const match = line.text.match(/^(#{1,6})\s+(.+)$/u);
        if (!match) continue;
        const level = match[1].length;
        const listed = level === 2 || level === 3;
        if (listed && firstSection === null) {
            firstSection = line.start;
            // This generated heading occurs before every section listed below.
            headingSlug(title);
        }
        const text = match[2]
            .replace(/\s+#+\s*$/u, "")
            .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
            .replace(/[*`]/gu, "")
            .trim();
        const slug = headingSlug(text);
        if (listed) {
            const label = text.replaceAll("[", "\\[").replaceAll("]", "\\]");
            headings.push(`${level === 3 ? "  " : ""}- [${label}](#${slug})`);
        }
    }
    if (firstSection === null) return source;
    const toc = `\n<!-- toc:start -->\n## ${title}\n\n${headings.join("\n")}\n<!-- toc:end -->\n`;
    return `${source.slice(0, firstSection).trimEnd()}\n${toc}\n${source.slice(firstSection)}`;
}

function codeHeading(source, name, extension) {
    const hashStyle = [".yml", ".yaml", ".sh"].includes(extension);
    const vue = extension === ".vue";
    let shebang = "";
    if (source.startsWith("#!")) {
        const newline = source.indexOf("\n");
        shebang = source.slice(0, newline + 1);
        source = source.slice(newline + 1);
    }
    const headerPattern = hashStyle
        ? /^# @file [\s\S]*?# End file heading\n\n/u
        : vue
          ? /^<!--\n@file [\s\S]*?-->\n\n/u
          : /^\/\*\*\n \* @file [\s\S]*?\*\/\n\n/u;
    const oldHeader = source.match(headerPattern)?.[0];
    let purpose = oldHeader?.match(/Purpose: (.+)/u)?.[1];
    if (oldHeader) source = source.slice(oldHeader.length);
    if (!purpose) {
        const originalComment = source.match(/^\/\*\*\s+([^\n]*?)\s*\*\/\n*/u);
        if (originalComment && !originalComment[1].includes("@")) {
            purpose = originalComment[1];
            source = source.slice(originalComment[0].length);
        }
    }
    purpose = purpose?.replace(/^\*\s*/u, "");
    purpose ??= `${name
        .replace(/\.[^.]+$/u, "")
        .split("/")
        .join(" / ")
        .replaceAll("-", " ")} ${extension === ".md" ? "guide" : "module"}.`;
    let sections;
    if (vue) sections = ["Template"];
    else if (extension === ".css") sections = ["Styles and responsive rules"];
    else if (hashStyle)
        sections =
            extension === ".sh"
                ? ["Shell operations"]
                : ["Workflow or configuration"];
    else {
        const file = ts.createSourceFile(
            name,
            source,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS,
        );
        sections = [];
        const seen = new Set();
        const addSection = (section) => {
            if (seen.has(section)) return;
            seen.add(section);
            sections.push(section);
        };
        for (const node of file.statements) {
            if (
                ts.isImportDeclaration(node) ||
                ts.isImportEqualsDeclaration(node)
            ) {
                addSection("Imports");
            } else if (
                ts.isFunctionDeclaration(node) ||
                ts.isClassDeclaration(node) ||
                ts.isInterfaceDeclaration(node) ||
                ts.isTypeAliasDeclaration(node) ||
                ts.isEnumDeclaration(node)
            ) {
                if (node.name) addSection(node.name.text);
            } else if (ts.isVariableStatement(node)) {
                addSection("Constants and state");
            } else if (ts.isModuleDeclaration(node)) {
                addSection("Ambient declarations");
            } else if (
                ts.isExportAssignment(node) ||
                ts.isExportDeclaration(node)
            ) {
                addSection("Exports");
            } else if (!ts.isEmptyStatement(node)) {
                addSection(
                    name.startsWith("tests/")
                        ? "Test scenarios"
                        : "Initialization and execution",
                );
            }
        }
        if (!sections.length) sections = ["Module declarations"];
    }
    const lines = [
        `@file ${name}`,
        `Purpose: ${purpose}`,
        "",
        "Table of contents:",
        ...sections.map((value, index) => `${index + 1}. ${value}`),
    ];
    const header = hashStyle
        ? `${lines.map((line) => (line ? `# ${line}` : "#")).join("\n")}\n# End file heading`
        : vue
          ? `<!--\n${lines.join("\n")}\n-->`
          : `/**\n${lines.map((line) => (line ? ` * ${line}` : " *")).join("\n")}\n */`;
    return `${shebang}${header}\n\n${source}`;
}
