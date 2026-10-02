/**
 * @file tests/ui/fixtures.ts
 * Purpose: tests / ui / fixtures module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. Exports
 * 4. capture
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { expect, test as base } from "@playwright/test";
import type { Page } from "@playwright/test";

/** An offline browser test must never contact a live wiki or other network host. */
export const test = base.extend({
    context: async ({ context }, use) => {
        const requests: string[] = [];
        await context.route("**/*", async (route) => {
            requests.push(route.request().url());
            await route.abort("blockedbyclient");
        });
        await use(context);
        expect(
            requests,
            "Unexpected requests in the offline browser suite",
        ).toEqual([]);
    },
});

export { expect };

/** Optional local visual-QA artifacts; normal test runs leave no screenshots. */
export async function capture(page: Page, name: string): Promise<void> {
    const directory = process.env.ACGA_CAPTURE_DIR;
    if (directory == null) return;
    await mkdir(directory, { recursive: true });
    await page.screenshot({
        path: join(directory, `acga-${name}.png`),
        fullPage: true,
        animations: "disabled",
    });
}
