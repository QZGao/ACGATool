/**
 * @file tests/ui/startup.spec.ts
 * Purpose: tests / ui / startup.spec module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. Test scenarios
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { capture, expect, test } from "./fixtures.ts";
import { mountStartup } from "./startup-fixture.ts";
import zhHans from "../../src/i18n/zh-Hans.json" with { type: "json" };
import zhHant from "../../src/i18n/zh-Hant.json" with { type: "json" };

let runtime: string;
let bundle: string;
let styles: string;

test.beforeAll(async () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const result = await build({
        absWorkingDir: root,
        stdin: {
            contents:
                "import * as Vue from 'vue'; import * as Codex from '@wikimedia/codex'; export const vue = { ...Vue, createMwApp: Vue.createApp }; export const codex = Codex;",
            resolveDir: root,
        },
        alias: { vue: "vue/dist/vue.esm-bundler.js" },
        bundle: true,
        format: "iife",
        globalName: "AcgaHostRuntime",
        define: {
            "process.env.NODE_ENV": '"production"',
            __VUE_OPTIONS_API__: "true",
            __VUE_PROD_DEVTOOLS__: "false",
            __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
        },
        write: false,
    });
    runtime = result.outputFiles[0]!.text;
    [bundle, styles] = await Promise.all([
        readFile(
            new URL("../../dist/acga_tool.min.js", import.meta.url),
            "utf8",
        ),
        readFile(
            new URL(
                "../../node_modules/@wikimedia/codex/dist/codex.style.css",
                import.meta.url,
            ),
            "utf8",
        ),
    ]);
});

for (const [language, catalog] of [
    ["zh-Hans", zhHans],
    ["zh-Hant", zhHant],
] as const) {
    test(`production compact message IDs preserve ${language} labels and rule metadata`, async ({
        page,
    }) => {
        const errors = await mountStartup(
            page,
            { runtime, bundle, styles },
            { language },
        );
        await page
            .getByRole("button", {
                name: catalog.nominate_for_acga,
                exact: true,
            })
            .click();
        const dialog = page.getByRole("dialog", {
            name: catalog.new_nomination_acg_award_tool,
        });
        await expect(dialog).toBeVisible();
        const length = dialog.getByRole("checkbox", {
            name: catalog["1_length"],
            exact: true,
        });
        await length.check();
        await expect(
            dialog.getByRole("button", { name: catalog.preview, exact: true }),
        ).toBeEnabled();
        await expect(
            dialog.locator(".acga-code-preview-text textarea"),
        ).toHaveValue(/\{\{ACG提名2\/request\|ver=1\|1c\}\}/u);
        expect(errors).toEqual([]);
    });
}

for (const fixture of [
    {
        name: "award main page",
        pageName: "WikiProject:ACG/維基ACG專題獎",
        inject: false,
    },
    {
        name: "registration subpage",
        pageName: "WikiProject:ACG/維基ACG專題獎/登記處",
        inject: true,
    },
    {
        name: "other award subpage",
        pageName: "WikiProject:ACG/維基ACG專題獎/存檔/2026年9月",
        inject: false,
    },
]) {
    test(`production bundle ${fixture.inject ? "injects" : "ignores"} rendered nominations on the ${fixture.name}`, async ({
        page,
    }) => {
        const errors = await mountStartup(
            page,
            { runtime, bundle, styles },
            {
                namespaceNumber: 102,
                pageName: fixture.pageName,
                renderedNominations: true,
            },
        );
        await expect(page.locator("table.acgnom-table")).toHaveCount(1);
        const link = page.getByRole("button", {
            name: "Nominate to ACGA",
            exact: true,
        });
        const edit = page.getByRole("button", {
            name: "Edit nomination",
            exact: true,
        });
        const check = page.getByRole("button", {
            name: "Check",
            exact: true,
        });
        const choice = page.getByRole("checkbox", {
            name: "Add to batch",
            exact: true,
        });
        if (fixture.inject) {
            await expect(link).toBeVisible();
            await expect(edit).toBeEnabled();
            await expect(check).toBeEnabled();
            await expect(choice).toBeEnabled();
            await expect(
                page.getByRole("button", { name: "Archive", exact: true }),
            ).toBeVisible();
        } else {
            await expect(link).toHaveCount(0);
            await expect(
                page.locator("#mw-content-text button, #mw-content-text input"),
            ).toHaveCount(0);
            await expect(page.locator(".acga-registry-status")).toHaveCount(0);
        }
        const effects = await page.evaluate(
            () => (window as any).startupEffects,
        );
        expect(effects.portlets).toEqual(fixture.inject ? ["p-tb"] : []);
        expect(effects.modules).toEqual(
            fixture.inject
                ? ["mediawiki.api", "mediawiki.util", "vue", "@wikimedia/codex"]
                : [],
        );
        expect(effects.apiCalls).toEqual(
            fixture.inject
                ? [
                      expect.objectContaining({
                          action: "query",
                          titles: "WikiProject:ACG/維基ACG專題獎/登記處",
                          prop: "revisions",
                          rvprop: "ids|content",
                      }),
                  ]
                : [],
        );
        expect(effects.apiWrites).toEqual([]);
        expect(effects.notices).toEqual([]);
        expect(errors).toEqual([]);
    });
}

for (const namespace of [0, 1]) {
    test(`production bundle opens Tools nomination with article context in namespace ${namespace}`, async ({
        page,
    }) => {
        const errors = await mountStartup(
            page,
            { runtime, bundle, styles },
            { namespaceNumber: namespace },
        );
        const link = page
            .getByRole("navigation", { name: "Tools" })
            .getByRole("button", { name: "Nominate to ACGA", exact: true });
        await expect(link).toBeVisible();
        await expect(page.locator(".acga-registry-toolbar")).toHaveCount(0);
        await link.click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        const article = dialog.locator(".acga-rule-page-name input");
        await expect(article).toHaveValue("");
        await expect(article).toHaveAttribute("placeholder", "Example article");
        const recipient = dialog.getByRole("textbox", {
            name: "Recipient",
            exact: true,
        });
        await expect(recipient).toHaveValue("");
        await expect(recipient).toHaveAttribute(
            "placeholder",
            "Leading editor",
        );
        const effects = await page.evaluate(
            () => (window as any).startupEffects,
        );
        expect(effects.portlets).toEqual(["p-tb"]);
        expect(effects.modules).toEqual([
            "mediawiki.api",
            "mediawiki.util",
            "vue",
            "@wikimedia/codex",
        ]);
        expect(
            effects.apiCalls.filter(
                (parameters: { rvprop: string }) =>
                    parameters.rvprop === "ids|timestamp|user|size",
            ),
        ).toEqual([
            expect.objectContaining({
                action: "query",
                prop: "revisions",
                titles: "Example article",
                rvprop: "ids|timestamp|user|size",
            }),
        ]);
        expect(effects.apiWrites).toEqual([]);
        expect(effects.notices).toEqual([]);
        expect(errors).toEqual([]);
        if (namespace === 0) {
            const qualitySelector = await dialog
                .locator(".acga-quality-row [role=combobox]")
                .first()
                .boundingBox();
            await capture(page, "new-en");
            expect(qualitySelector).not.toBeNull();
            expect(qualitySelector!.width).toBeGreaterThan(200);
            expect(qualitySelector!.height).toBeLessThanOrEqual(40);
            const review = dialog.getByRole("button", { name: /^\(5\)/u });
            await review.click();
            await expect(review).toHaveAttribute("aria-pressed", "true");
            await expect(
                dialog.getByRole("button", { name: /^\(1–4\)/u }),
            ).toHaveAttribute("aria-pressed", "false");
            await expect(recipient).toHaveValue("");
            await expect(recipient).toHaveAttribute("placeholder", "Example");
            await capture(page, "review-en");
            await dialog.getByRole("button", { name: /^\(6\)/u }).click();
            await expect(recipient).toHaveValue("");
            await expect(recipient).toHaveAttribute("placeholder", "Example");
            const mediaPage = dialog.getByRole("textbox", {
                name: "Page name",
                exact: true,
            });
            await expect(mediaPage).toHaveValue("");
            await expect(mediaPage).toHaveAttribute(
                "placeholder",
                "Example article",
            );
            await expect(
                dialog.getByRole("checkbox", { name: "Media", exact: true }),
            ).toBeChecked();
            await expect(
                dialog.getByRole("checkbox", {
                    name: "Featured picture",
                    exact: true,
                }),
            ).not.toBeChecked();
            await expect(
                dialog.locator(".acga-code-preview-text textarea"),
            ).toHaveValue(/\{\{ACG提名2\/request\|ver=1\|6\}\}/u);
            await capture(page, "media-en");
            await dialog.getByRole("button", { name: /^\(8\)/u }).click();
            const relatedPage = dialog.getByRole("textbox", {
                name: "Related page",
                exact: true,
            });
            await expect(recipient).toHaveValue("");
            await expect(recipient).toHaveAttribute("placeholder", "Example");
            await expect(relatedPage).toHaveValue("");
            await expect(relatedPage).toHaveAttribute(
                "placeholder",
                "Example article",
            );
            await capture(page, "other-en");
            await dialog.getByRole("button", { name: /^\(1–4\)/u }).click();
            await expect(article).toHaveValue("");
            await expect(article).toHaveAttribute(
                "placeholder",
                "Example article",
            );
            await expect(recipient).toHaveValue("");
            await expect(recipient).toHaveAttribute(
                "placeholder",
                "Leading editor",
            );
            await dialog
                .getByRole("checkbox", {
                    name: "Scoring item 1 — Length",
                    exact: true,
                })
                .check();
            await expect(
                dialog.locator(".acga-code-preview-text textarea"),
            ).toHaveValue(
                /\|條目名稱1 = Example article\n\|用戶名稱1 = Leading editor\n/u,
            );
        }
    });
}

for (const fixture of [
    {
        name: "local file",
        options: {
            namespaceNumber: 6,
            pageName: "File:Example_image.svg",
            title: "Example image.svg",
        },
        target: "File:Example image.svg",
        recipient: "Latest uploader",
        revision: undefined,
    },
    {
        name: "shared Commons file",
        options: {
            namespaceNumber: 6,
            pageName: "File:Example_image.svg",
            title: "Example image.svg",
            sharedFile: true,
        },
        target: "File:Example image.svg",
        recipient: "Latest uploader",
        revision: undefined,
    },
    {
        name: "Commons MediaViewer preview",
        options: {
            mediaHash: "#/media/File:Commons%20preview.svg",
            sharedFile: true,
        },
        target: "File:Commons preview.svg",
        recipient: "Latest uploader",
        revision: undefined,
    },
    {
        name: "article permalink",
        options: { revisionId: 40, currentRevisionId: 42 },
        target: "Example article",
        recipient: "Viewed revision editor",
        revision: 40,
    },
    {
        name: "diff-only view",
        options: { revisionId: 0, currentRevisionId: 50, diffNewId: 48 },
        target: "Example article",
        recipient: "Viewed revision editor",
        revision: 48,
    },
]) {
    test(`production bundle applies ${fixture.name} category and recipient context`, async ({
        page,
    }) => {
        const errors = await mountStartup(
            page,
            { runtime, bundle, styles },
            fixture.options,
        );
        await page
            .getByRole("button", { name: "Nominate to ACGA", exact: true })
            .click();
        const dialog = page.getByRole("dialog");
        const recipient = () =>
            dialog.getByRole("textbox", { name: "Recipient", exact: true });
        await expect(recipient()).toHaveValue("");
        await expect(recipient()).toHaveAttribute(
            "placeholder",
            fixture.recipient,
        );
        const initialCategory = fixture.revision ? /^\(1–4\)/u : /^\(6\)/u;
        await expect(
            dialog.getByRole("button", { name: initialCategory }),
        ).toHaveAttribute("aria-pressed", "true");
        await expect(
            dialog.getByRole("textbox", {
                name: fixture.revision ? "Article title" : "Page name",
                exact: true,
            }),
        ).toHaveAttribute("placeholder", fixture.target);
        if (fixture.revision) {
            for (const category of [
                /^\(5\)/u,
                /^\(6\)/u,
                /^\(8\)/u,
                /^\(1–4\)/u,
            ]) {
                await dialog.getByRole("button", { name: category }).click();
                await expect(recipient()).toHaveValue("");
                await expect(recipient()).toHaveAttribute(
                    "placeholder",
                    fixture.recipient,
                );
            }
        }
        await dialog.getByRole("button", { name: /^\(7\)/u }).click();
        await expect(recipient()).toHaveAttribute("placeholder", "Example");
        const effects = await page.evaluate(
            () => (window as any).startupEffects,
        );
        expect(effects.apiCalls).toContainEqual(
            expect.objectContaining(
                fixture.revision
                    ? { revids: fixture.revision, rvprop: "ids|user" }
                    : {
                          titles: fixture.target,
                          prop: "imageinfo",
                          iiprop: "user",
                          iilimit: 1,
                      },
            ),
        );
        expect(effects.apiWrites).toEqual([]);
        expect(effects.notices).toEqual([]);
        expect(errors).toEqual([]);
    });
}

test("production bundle shows a stable loading recipient until article history resolves", async ({
    page,
}) => {
    const errors = await mountStartup(
        page,
        { runtime, bundle, styles },
        { deferredRecipient: true },
    );
    await page
        .getByRole("button", { name: "Nominate to ACGA", exact: true })
        .click();
    const dialog = page.getByRole("dialog");
    const recipient = dialog.getByRole("textbox", {
        name: "Recipient",
        exact: true,
    });
    await expect(recipient).toHaveValue("");
    await expect(recipient).toHaveAttribute("placeholder", "...");
    await dialog
        .getByRole("checkbox", { name: "Scoring item 1 — Length", exact: true })
        .check();
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(dialog.getByRole("table")).toHaveCount(0);
    await expect(recipient).toHaveAttribute("placeholder", "...");
    await page.evaluate(() => (window as any).resolveStartupRecipient());
    await expect(recipient).toHaveAttribute("placeholder", "Leading editor");
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(
        dialog.getByRole("table", { name: "Nomination table 1", exact: true }),
    ).toBeVisible();
    await expect(
        dialog.getByRole("cell", { name: "Leading editor", exact: true }),
    ).toBeVisible();
    expect(
        await page.evaluate(() => (window as any).startupEffects.apiWrites),
    ).toEqual([]);
    expect(errors).toEqual([]);
});
