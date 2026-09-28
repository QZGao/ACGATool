import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { capture, expect, test } from "./fixtures.ts";

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

for (const namespace of [0, 1]) {
    test(`production bundle opens Tools nomination with article context in namespace ${namespace}`, async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setContent(
            '<!doctype html><html lang="en"><body><nav id="p-tb" aria-label="Tools"><ul></ul></nav><main id="mw-content-text"><div class="mw-parser-output"><h1>Example article</h1><p>Offline article fixture.</p></div></main></body></html>',
        );
        await page.addStyleTag({
            content: `body { font-family: sans-serif; } ${styles}`,
        });
        await page.addScriptTag({ content: runtime });
        await page.evaluate((namespaceNumber) => {
            const global = window as any;
            global.startupEffects = {
                portlets: [],
                modules: [],
                apiCalls: [],
                apiWrites: [],
                notices: [],
            };
            const configuration: Record<string, unknown> = {
                wgPageName:
                    namespaceNumber === 0
                        ? "Example_article"
                        : "Talk:Example_article",
                wgNamespaceNumber: namespaceNumber,
                wgTitle: "Example article",
                wgAction: "view",
                wgRevisionId: 42,
                wgUserLanguage: "en",
                wgUserVariant: "",
                wgUserName: "Example",
            };
            global.mw = {
                config: { get: (key: string) => configuration[key] },
                loader: {
                    async using(modules: string[]) {
                        global.startupEffects.modules.push(...modules);
                        return (name: string) =>
                            name === "vue"
                                ? global.AcgaHostRuntime.vue
                                : global.AcgaHostRuntime.codex;
                    },
                },
                util: {
                    getUrl: (title: string) =>
                        "/wiki/" + encodeURIComponent(title),
                    addPortletLink(
                        portlet: string,
                        href: string,
                        text: string,
                        id: string,
                    ) {
                        global.startupEffects.portlets.push(portlet);
                        const item = document.createElement("li");
                        item.id = id;
                        const anchor = document.createElement("a");
                        anchor.href = href;
                        anchor.textContent = text;
                        item.append(anchor);
                        document.querySelector(`#${portlet} ul`)!.append(item);
                        return item;
                    },
                },
                Api: class {
                    get(parameters: Record<string, unknown>) {
                        global.startupEffects.apiCalls.push(parameters);
                        if (
                            parameters.action !== "query" ||
                            parameters.prop !== "revisions" ||
                            parameters.titles !== "Example article"
                        ) {
                            throw new Error("Unexpected fixture API query");
                        }
                        const timestamp = new Date(
                            Date.now() - 24 * 60 * 60 * 1000,
                        ).toISOString();
                        return Promise.resolve({
                            query: {
                                pages: [
                                    {
                                        pageid: 1,
                                        revisions: [
                                            {
                                                revid: 1,
                                                parentid: 0,
                                                timestamp,
                                                user: "Frequent editor",
                                                size: 500,
                                            },
                                            {
                                                revid: 2,
                                                parentid: 1,
                                                timestamp,
                                                user: "Frequent editor",
                                                size: 600,
                                            },
                                            {
                                                revid: 3,
                                                parentid: 2,
                                                timestamp,
                                                user: "Leading editor",
                                                size: 2600,
                                            },
                                        ],
                                    },
                                ],
                            },
                        });
                    }
                    postWithToken(_token: string, parameters: unknown) {
                        global.startupEffects.apiWrites.push(parameters);
                        throw new Error(
                            "Opening a nomination must not edit API pages",
                        );
                    }
                },
                notify: (message: string) =>
                    global.startupEffects.notices.push(message),
                hook: () => ({ add() {}, remove() {} }),
            };
        }, namespace);
        await page.addScriptTag({ content: bundle });
        const link = page
            .getByRole("navigation", { name: "Tools" })
            .getByRole("link", { name: "Nominate to ACGA", exact: true });
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
        expect(effects.apiCalls).toEqual([
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
            const nominee = dialog.getByRole("textbox", {
                name: "Nominee",
                exact: true,
            });
            const relatedPage = dialog.getByRole("textbox", {
                name: "Related page",
                exact: true,
            });
            await expect(nominee).toHaveValue("");
            await expect(nominee).toHaveAttribute("placeholder", "Example");
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
