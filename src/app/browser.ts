/** The sole automatic browser entry point. */
import { start } from "./main.ts";
import { createBrowserHost } from "../platform/mediawiki/runtime.ts";

if (typeof mw !== "undefined" && typeof document !== "undefined") {
    void start(createBrowserHost(window, document, mw));
}
