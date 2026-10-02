/**
 * @file src/app/browser.ts
 * Purpose: The sole automatic browser entry point.
 *
 * Table of contents:
 * 1. Imports
 * 2. Initialization and execution
 */

import { start } from "./main.ts";
import { createBrowserHost } from "../platform/mediawiki/runtime.ts";

if (typeof mw !== "undefined" && typeof document !== "undefined") {
    void start(createBrowserHost(window, document, mw));
}
