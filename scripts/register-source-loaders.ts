/**
 * @file scripts/register-source-loaders.ts
 * Purpose: Let offline Node tests import the same text assets as the browser build.
 *
 * Table of contents:
 * 1. Imports
 * 2. Initialization and execution
 */

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
    load(url, context, nextLoad) {
        if (!url.startsWith("file:") || !/\.(?:css|vue)$/u.test(url)) {
            return nextLoad(url, context);
        }
        return {
            format: "module",
            shortCircuit: true,
            source: `export default ${JSON.stringify(readFileSync(fileURLToPath(url), "utf8"))};\n`,
        };
    },
});
