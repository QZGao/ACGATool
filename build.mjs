import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const options = {
    absWorkingDir: fileURLToPath(new URL(".", import.meta.url)),
    entryPoints: ["src/app/browser.ts"],
    outfile: "dist/bundled.js",
    bundle: true,
    format: "iife",
    target: "es2017",
    charset: "utf8",
    loader: { ".vue": "text", ".css": "text" },
    banner: {
        js: `/*! ACGATool by SuperGrey.\n${readFileSync(new URL("LICENSE", import.meta.url), "utf8").trim()}\n*/\n//<nowiki>`,
    },
    footer: { js: "//</nowiki>" },
    logLevel: "info",
};

if (process.argv.includes("--watch")) {
    const watcher = await context(options);
    await watcher.watch();
} else {
    await build(options);
}
