/**
 * @file tests/ui/dialog.spec.ts
 * Purpose: tests / ui / dialog.spec module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. Test scenarios
 * 4. mount
 * 5. openNewNomination
 * 6. openCheckBatch
 * 7. openDykCheck
 * 8. closeDykCheck
 * 9. expectCompactArticleHints
 */

import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { Locator, Page } from "@playwright/test";
import { createTranslator } from "../../src/i18n/index.ts";
import { capture, expect, test } from "./fixtures.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
let runtime: string;
let codexStyles: string;

test.beforeAll(async () => {
    const result = await build({
        absWorkingDir: root,
        stdin: {
            contents: `
                import * as Vue from 'vue';
                import * as Codex from '@wikimedia/codex';
                import { createNominationDialogs } from './src/features/nomination/dialog.ts';
                import { NominationRuleSet, parseReasonTokens } from './src/domain/rules.ts';
                import { createTranslator } from './src/i18n/index.ts';
                import { createBrowserNominationDraftStore } from './src/platform/browser/nomination-draft-storage.ts';
                export function mount(language = 'zh-Hant', options = {}) {
                    const effects = { saves: [], errors: [], notices: [], outcome: null };
                    const checkBatchEffects = { completions: [], discards: [] };
                    const stagedChecks = new Map();
                    const suggestionRequests = [];
                    const existingNominationRequests = [];
                    const dykRequests = [];
                    const assessmentRequests = [];
                    const previews = [];
                    const getSuggestedRecipient = options.deferredSuggestions ? (pageName) => {
                        let resolve;
                        const promise = new Promise((done) => { resolve = done; });
                        suggestionRequests.push({ pageName, promise, resolve });
                        return promise;
                    } : undefined;
                    const getExistingNominations = options.existingNominations ? (pageName) => {
                        existingNominationRequests.push(pageName);
                        return Promise.resolve(options.existingNominations.filter((entry) => entry.pageName === pageName));
                    } : undefined;
                    const save = (kind, data, target) => {
                        effects.saves.push({ kind, data, target });
                        if (kind === 'new' && options.failNewNomination) {
                            return Promise.reject(new Error('Fixture nomination submission failure'));
                        }
                        return Promise.resolve(false);
                    };
                    const dialogs = createNominationDialogs({
                        Vue: { createMwApp: Vue.createApp }, Codex
                    }, {
                        saveNewNomination: (tables) => save('new', tables),
                        previewNewNomination: (tables) => {
                            previews.push({ tables });
                            return Promise.resolve({
                                wikitext: 'Fixture nomination source',
                                html: '<p>Fixture nomination preview</p>',
                            });
                        },
                        saveModifiedNomination: (data, target) => save('edit', data, target),
                        saveNominationCheck: (data, target) => {
                            stagedChecks.set(JSON.stringify(target), structuredClone({ data, target }));
                            return save('check', data, target);
                        },
                        discardNominationCheck: target => {
                            checkBatchEffects.discards.push(structuredClone(target));
                            stagedChecks.delete(JSON.stringify(target));
                        },
                        completeNominationCheckBatch: () => {
                            checkBatchEffects.completions.push([...stagedChecks.values()]);
                            stagedChecks.clear();
                            return Promise.resolve(false);
                        },
                        saveRawNominationSource: (data, target) => save('source', data, target),
                    }, {
                        document,
                        nominationDraftStore: options.persistentDrafts ? createBrowserNominationDraftStore({
                            window,
                            getStorage: () => ({
                                getItem: key => window.localStorage.getItem(key),
                                setItem: (key, value) => {
                                    if (options.failDraftStorage) throw new Error('Fixture browser storage failure');
                                    window.localStorage.setItem(key, value);
                                },
                                removeItem: key => window.localStorage.removeItem(key),
                            }),
                            getUserName: () => options.userName === undefined ? 'Example' : options.userName,
                        }) : undefined,
                        msg: createTranslator(language).msg,
                        getUserName: () => options.userName === undefined ? 'Example' : options.userName,
                        getPageName: () => options.pageName ?? '',
                        getSuggestedRecipient,
                        getExistingNominations,
                        getDykStatus: options.deferredDyk ? (pageName) => {
                            let resolve, reject;
                            const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
                            dykRequests.push({ pageName, resolve, reject });
                            return promise;
                        } : undefined,
                        getPageAssessments: options.deferredAssessments ? (pageName) => {
                            let resolve, reject;
                            const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
                            assessmentRequests.push({ pageName, resolve, reject });
                            return promise;
                        } : undefined,
                        getUrl: (title) => {
                            const [pageName, fragment] = title.split('#');
                            return '/wiki/' + encodeURIComponent(pageName.replaceAll(' ', '_')) +
                                (fragment === undefined ? '' : '#' + encodeURIComponent(fragment.replaceAll(' ', '_')));
                        },
                        notify: (message) => effects.notices.push(message),
                        reportError: (error) => effects.errors.push(String(error)),
                        addStyles(css) {
                            const style = document.createElement('style');
                            style.dataset.acgaFixture = 'true';
                            style.textContent = css;
                            document.head.append(style);
                            return () => style.remove();
                        }
                    });
                    return {
                        effects, checkBatchEffects, dialogs, suggestionRequests, existingNominationRequests, dykRequests, assessmentRequests, previews, options,
                        async resolveSuggestion(index, recipient) {
                            const request = suggestionRequests[index];
                            request.resolve(recipient);
                            await request.promise;
                            await Vue.nextTick();
                        },
                    };
                }
                export function nomination(reason, pageName = 'Example article') {
                    const { ruleDict } = NominationRuleSet();
                    return { awarder: 'Example', pageName, requestReasonText: reason,
                        reasonParse: parseReasonTokens(reason, ruleDict) };
                }
            `,
            resolveDir: root,
            loader: "ts",
        },
        alias: { vue: "vue/dist/vue.esm-bundler.js" },
        bundle: true,
        format: "iife",
        globalName: "AcgaTestUI",
        loader: { ".vue": "text", ".css": "text" },
        define: {
            "process.env.NODE_ENV": '"production"',
            __VUE_OPTIONS_API__: "true",
            __VUE_PROD_DEVTOOLS__: "false",
            __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
        },
        write: false,
    });
    runtime = result.outputFiles[0]!.text;
    codexStyles = await readFile(
        new URL(
            "../../node_modules/@wikimedia/codex/dist/codex.style.css",
            import.meta.url,
        ),
        "utf8",
    );
});

async function mount(
    page: Page,
    language = "zh-Hant",
    options: {
        pageName?: string;
        deferredSuggestions?: boolean;
        deferredDyk?: boolean;
        deferredAssessments?: boolean;
        userName?: string | null;
        persistentDrafts?: boolean;
        failDraftStorage?: boolean;
        failNewNomination?: boolean;
        existingNominations?: Array<{
            pageName: string;
            awarder: string;
            date?: string;
            index?: number;
            sectionOccurrence?: number;
            dateLabel: string;
            dateAnchor: string;
            reasonText: string;
            checked: boolean;
            url: string;
        }>;
    } = {},
): Promise<string[]> {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const html =
        '<!doctype html><html lang="zh-Hant"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>Example article</h1><button id="opener">Open ACGATool</button></body></html>';
    if (options.persistentDrafts) {
        await page.route("https://acga.test/**", (route) =>
            route.fulfill({ contentType: "text/html", body: html }),
        );
        await page.goto(
            `https://acga.test/wiki/${encodeURIComponent(options.pageName ?? "Example article")}`,
        );
    } else {
        await page.setContent(html);
    }
    await page.addStyleTag({
        content: `body { font-family: sans-serif; } ${codexStyles}`,
    });
    await page.addScriptTag({ content: runtime });
    await page.evaluate(
        ({ language, options }) => {
            const global = window as any;
            global.acgaFixture = global.AcgaTestUI.mount(language, options);
        },
        { language, options },
    );
    return errors;
}

async function openNewNomination(page: Page): Promise<void> {
    await page.evaluate(() => {
        const fixture = (window as any).acgaFixture;
        void fixture.dialogs
            .showNewNominationDialog()
            .then((outcome: unknown) => (fixture.effects.outcome = outcome));
    });
    await expect(page.getByRole("dialog")).toBeVisible();
}

test.describe("browser nomination drafts", () => {
    // Playwright's service-worker blocker reads a forbidden API in sandboxed
    // HTTPS preview frames. The offline fixture still intercepts every request.
    test.use({ serviceWorkers: "allow" });

    test("暂存 retains eligible nominations, inactive category drafts and original defaults after closing a tab", async ({
        page,
        context,
    }) => {
        const errors = await mount(page, "zh-Hans", {
            persistentDrafts: true,
            pageName: "原始条目",
            deferredSuggestions: true,
        });
        await openNewNomination(page);
        const dialog = page.getByRole("dialog");
        await expect
            .poll(() =>
                page.evaluate(
                    () => (window as any).acgaFixture.suggestionRequests.length,
                ),
            )
            .toBe(1);
        await page.evaluate(() =>
            (window as any).acgaFixture.resolveSuggestion(0, "原始贡献者"),
        );
        await dialog
            .getByRole("checkbox", { name: "得分项目1 — 篇幅", exact: true })
            .check();
        await dialog
            .getByRole("button", { name: "新增提名", exact: true })
            .click();
        await dialog
            .getByRole("textbox", { name: "条目名", exact: true })
            .fill("另一条目");
        await dialog
            .getByRole("textbox", { name: "得分者", exact: true })
            .fill("另一位贡献者");
        await dialog
            .getByRole("checkbox", { name: "得分项目1 — 篇幅", exact: true })
            .check();
        await dialog
            .locator(".acga-content-expansion-row")
            .getByRole("spinbutton")
            .fill("");
        await dialog.getByRole("button", { name: /^\(5\)/u }).click();
        await dialog
            .locator(".acga-review-choice")
            .getByRole("combobox")
            .fill("自订评审说明");
        await dialog
            .getByRole("spinbutton", { name: "评审得分", exact: true })
            .fill("2");
        await dialog.getByRole("button", { name: "暂存", exact: true }).click();
        await expect(dialog).toBeHidden();
        const initialEffects = await page.evaluate(
            () => (window as any).acgaFixture.effects,
        );
        expect(initialEffects.outcome).toBe("draft");
        expect(initialEffects.saves).toEqual([]);
        expect(initialEffects.errors).toEqual([]);
        expect(errors).toEqual([]);

        const anotherPage = await context.newPage();
        await page.close();
        const restoredErrors = await mount(anotherPage, "en", {
            persistentDrafts: true,
            pageName: "原始条目",
            deferredSuggestions: true,
        });
        await anotherPage.reload();
        await mount(anotherPage, "en", {
            persistentDrafts: true,
            pageName: "原始条目",
            deferredSuggestions: true,
        });
        await openNewNomination(anotherPage);
        const restored = anotherPage.getByRole("dialog");
        await expect(
            restored.getByRole("tab", { name: "Item 2", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        await expect(
            restored.getByRole("textbox", {
                name: "Article title",
                exact: true,
            }),
        ).toHaveValue("另一条目");
        await expect(
            restored.getByRole("textbox", { name: "Recipient", exact: true }),
        ).toHaveValue("另一位贡献者");
        await expect(
            restored.getByRole("button", { name: /^\(5\)/u }),
        ).toHaveAttribute("aria-pressed", "true");
        await expect(
            restored.locator(".acga-review-choice").getByRole("combobox"),
        ).toHaveValue("自订评审说明");
        await expect(
            restored.getByRole("spinbutton", {
                name: "Review score",
                exact: true,
            }),
        ).toHaveValue("2");
        await restored.getByRole("button", { name: /^\(1–4\)/u }).click();
        await expect(
            restored
                .locator(".acga-content-expansion-row")
                .getByRole("spinbutton"),
        ).toHaveValue("");
        await restored
            .getByRole("tab", { name: "Item 1", exact: true })
            .click();
        await expect(
            restored.getByRole("textbox", {
                name: "Article title",
                exact: true,
            }),
        ).toHaveAttribute("placeholder", "原始条目");
        await expect(
            restored.getByRole("textbox", { name: "Recipient", exact: true }),
        ).toHaveAttribute("placeholder", "原始贡献者");
        expect(
            await anotherPage.evaluate(
                () => (window as any).acgaFixture.suggestionRequests.length,
            ),
        ).toBe(0);
        await restored
            .getByRole("textbox", { name: "Article title", exact: true })
            .fill("Unsaved replacement");
        await restored
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
        await openNewNomination(anotherPage);
        await expect(
            restored.getByRole("tab", { name: "Item 2", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        await restored
            .getByRole("tab", { name: "Item 1", exact: true })
            .click();
        await expect(
            restored.getByRole("textbox", {
                name: "Article title",
                exact: true,
            }),
        ).toHaveValue("");
        expect(restoredErrors).toEqual([]);
    });

    test("暂存 rejects ineligible nominations with the Preview alert and preserves the saved draft", async ({
        page,
    }) => {
        const errors = await mount(page, "zh-Hans", { persistentDrafts: true });
        await openNewNomination(page);
        const dialog = page.getByRole("dialog");
        const saveDraft = dialog.getByRole("button", {
            name: "暂存",
            exact: true,
        });
        const preview = dialog.getByRole("button", {
            name: "预览",
            exact: true,
        });
        const article = dialog.getByRole("textbox", {
            name: "条目名",
            exact: true,
        });
        const alert = dialog.locator(".acga-dialog-error");
        await saveDraft.click();
        await expect(dialog).toBeVisible();
        await expect(alert).toBeVisible();
        const saveAlert = await alert.innerText();
        await expect(article).toBeFocused();
        await preview.click();
        await expect(alert).toHaveText(saveAlert, { useInnerText: true });
        await expect(dialog.getByRole("table")).toHaveCount(0);
        expect(await page.evaluate(() => window.localStorage.length)).toBe(0);
        expect(
            await page.evaluate(
                () => (window as any).acgaFixture.effects.saves,
            ),
        ).toEqual([]);

        await article.fill("合资格条目");
        await dialog
            .getByRole("checkbox", { name: "得分项目1 — 篇幅", exact: true })
            .check();
        await saveDraft.click();
        await expect(dialog).toBeHidden();
        const saved = await page.evaluate(() =>
            window.localStorage.getItem(window.localStorage.key(0)!),
        );
        expect(saved).not.toBeNull();

        await openNewNomination(page);
        await expect(article).toHaveValue("合资格条目");
        await dialog
            .locator(".acga-content-expansion-row")
            .getByRole("spinbutton")
            .fill("0");
        await saveDraft.click();
        await expect(dialog).toBeVisible();
        await expect(alert).toBeVisible();
        const invalidScoreAlert = await alert.innerText();
        await preview.click();
        await expect(alert).toHaveText(invalidScoreAlert, {
            useInnerText: true,
        });
        expect(
            await page.evaluate(() =>
                window.localStorage.getItem(window.localStorage.key(0)!),
            ),
        ).toBe(saved);
        expect(
            await page.evaluate(
                () => (window as any).acgaFixture.effects.saves,
            ),
        ).toEqual([]);
        expect(errors).toEqual([]);
    });

    test("暫存 from parsed preview retains every table, comments, frozen rows and active tabs", async ({
        page,
    }) => {
        const errors = await mount(page, "zh-Hant", { persistentDrafts: true });
        await openNewNomination(page);
        const dialog = page.getByRole("dialog");
        const article = dialog.getByRole("textbox", {
            name: "條目名",
            exact: true,
        });
        const length = dialog.getByRole("checkbox", {
            name: "得分項目1 — 篇幅",
            exact: true,
        });
        await article.fill("凍結的條目");
        await length.check();
        await dialog
            .getByRole("button", { name: "新增提名", exact: true })
            .click();
        await article.fill("第一表的保留條目");
        await length.check();
        await dialog
            .getByRole("button", { name: "新增表格", exact: true })
            .click();
        await article.fill("第二表的條目");
        await length.check();
        await dialog.getByRole("button", { name: "預覽", exact: true }).click();
        const tables = dialog.getByRole("table");
        await dialog
            .locator(".acga-additional-message textarea")
            .nth(0)
            .fill("第一表的說明");
        await dialog
            .locator(".acga-additional-message textarea")
            .nth(1)
            .fill("第二表的說明");
        await tables
            .nth(0)
            .getByRole("button", { name: "凍結提名1", exact: true })
            .click();
        await expect(
            dialog.getByRole("button", { name: "暫存", exact: true }),
        ).toBeVisible();
        await dialog.getByRole("button", { name: "預覽", exact: true }).click();
        const preview = page.getByRole("dialog", {
            name: "提名預覽",
            exact: true,
        });
        await expect(preview).toBeVisible();
        await expect(
            preview.locator(".acga-dialog-footer").getByRole("button"),
        ).toHaveText(["返回", "暫存"]);
        await preview
            .getByRole("button", { name: "暫存", exact: true })
            .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        const effects = await page.evaluate(
            () => (window as any).acgaFixture.effects,
        );
        expect(effects.outcome).toBe("draft");
        expect(effects.saves).toEqual([]);

        await page.reload();
        await mount(page, "en", {
            persistentDrafts: true,
        });
        await openNewNomination(page);
        const restored = page.getByRole("dialog");
        await expect(restored.getByRole("table")).toHaveCount(2);
        await restored
            .getByRole("button", { name: "Back", exact: true })
            .click();
        await expect(
            restored.getByRole("tab", { name: "Table 2", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        await expect(
            restored.getByRole("textbox", {
                name: "Article title",
                exact: true,
            }),
        ).toHaveValue("第二表的條目");
        await restored
            .getByRole("tab", { name: "Table 1", exact: true })
            .click();
        await expect(
            restored.getByRole("tab", { name: "Item 2", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        await expect(
            restored.getByRole("textbox", {
                name: "Article title",
                exact: true,
            }),
        ).toHaveValue("第一表的保留條目");
        await restored
            .getByRole("button", { name: "Preview", exact: true })
            .click();
        const restoredTables = restored.getByRole("table");
        await expect(restoredTables).toHaveCount(2);
        await expect(
            restored.locator(".acga-additional-message textarea").nth(0),
        ).toHaveValue("第一表的說明");
        await expect(
            restored.locator(".acga-additional-message textarea").nth(1),
        ).toHaveValue("第二表的說明");
        const frozen = restoredTables.nth(0).getByRole("row").nth(1);
        await expect(frozen.locator('[data-frozen="true"]')).toHaveCount(1);
        await expect(frozen.getByRole("cell").nth(1)).toHaveText("凍結的條目");
        await restored
            .getByRole("button", { name: "Save draft", exact: true })
            .click();
        await expect(restored).toBeHidden();
        expect(
            await page.evaluate(
                () => (window as any).acgaFixture.effects.saves,
            ),
        ).toEqual([]);
        expect(errors).toEqual([]);
    });

    test("opening another article after 暂存 starts a second nomination with its own defaults", async ({
        page,
        context,
    }) => {
        const errors = await mount(page, "zh-Hans", {
            persistentDrafts: true,
            pageName: "条目A",
            deferredSuggestions: true,
        });
        await openNewNomination(page);
        await expect
            .poll(() =>
                page.evaluate(
                    () => (window as any).acgaFixture.suggestionRequests.length,
                ),
            )
            .toBe(1);
        await page.evaluate(() =>
            (window as any).acgaFixture.resolveSuggestion(0, "贡献者A"),
        );
        const first = page.getByRole("dialog");
        await first
            .getByRole("checkbox", { name: "得分项目1 — 篇幅", exact: true })
            .check();
        await first.getByRole("button", { name: "暂存", exact: true }).click();
        await expect(first).toBeHidden();

        const anotherPage = await context.newPage();
        const restoredErrors = await mount(anotherPage, "en", {
            persistentDrafts: true,
            pageName: "Article B",
            deferredSuggestions: true,
        });
        await openNewNomination(anotherPage);
        const dialog = anotherPage.getByRole("dialog");
        await expect(
            dialog.getByRole("tab", { name: "Table 1", exact: true }),
        ).toBeVisible();
        await expect(
            dialog.getByRole("tab", { name: "Item 2", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        const article = dialog.getByRole("textbox", {
            name: "Article title",
            exact: true,
        });
        const recipient = dialog.getByRole("textbox", {
            name: "Recipient",
            exact: true,
        });
        const length = dialog.getByRole("checkbox", {
            name: "Scoring item 1 — Length",
            exact: true,
        });
        await expect(article).toHaveValue("");
        await expect(article).toHaveAttribute("placeholder", "Article B");
        await expect(recipient).toHaveValue("");
        await expect(length).not.toBeChecked();
        await expect
            .poll(() =>
                anotherPage.evaluate(
                    () => (window as any).acgaFixture.suggestionRequests.length,
                ),
            )
            .toBe(1);
        await anotherPage.evaluate(() =>
            (window as any).acgaFixture.resolveSuggestion(0, "Contributor B"),
        );
        await expect(recipient).toHaveAttribute("placeholder", "Contributor B");
        await dialog.getByRole("tab", { name: "Item 1", exact: true }).click();
        await expect(article).toHaveAttribute("placeholder", "条目A");
        await expect(recipient).toHaveAttribute("placeholder", "贡献者A");
        await expect(length).toBeChecked();
        await dialog.getByRole("tab", { name: "Item 2", exact: true }).click();
        await length.check();
        await dialog
            .getByRole("button", { name: "Save draft", exact: true })
            .click();
        await expect(dialog).toBeHidden();

        await openNewNomination(anotherPage);
        await expect(dialog.getByRole("tab", { name: /^Item /u })).toHaveCount(
            2,
        );
        await expect(
            dialog.getByRole("tab", { name: "Item 2", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        await dialog
            .getByRole("button", { name: "Preview", exact: true })
            .click();
        const table = dialog.getByRole("table");
        await expect(table).toHaveCount(1);
        await expect(
            table.getByRole("row").nth(1).getByRole("cell"),
        ).toHaveText(["1", "条目A", "贡献者A", "3 points", "1c", ""]);
        await expect(
            table.getByRole("row").nth(2).getByRole("cell"),
        ).toHaveText(["2", "Article B", "Contributor B", "3 points", "1c", ""]);
        await dialog
            .getByRole("button", { name: "Submit", exact: true })
            .click();
        await expect(dialog).toBeHidden();
        expect(
            await anotherPage.evaluate(
                () => (window as any).acgaFixture.effects.saves,
            ),
        ).toEqual([
            expect.objectContaining({
                kind: "new",
                data: [
                    expect.objectContaining({
                        nominations: [
                            expect.objectContaining({
                                pageName: "条目A",
                                awarder: "贡献者A",
                            }),
                            expect.objectContaining({
                                pageName: "Article B",
                                awarder: "Contributor B",
                            }),
                        ],
                    }),
                ],
            }),
        ]);
        expect(
            await anotherPage.evaluate(() => window.localStorage.length),
        ).toBe(0);
        expect(errors).toEqual([]);
        expect(restoredErrors).toEqual([]);
    });

    test("preopened article dialogs synchronize saved items on returning to a tab and retain local inputs", async ({
        page,
        context,
    }) => {
        const secondPage = await context.newPage();
        const thirdPage = await context.newPage();
        const pages = [page, secondPage, thirdPage];
        const errors = await Promise.all(
            pages.map((currentPage, index) =>
                mount(currentPage, "en", {
                    persistentDrafts: true,
                    pageName: `Article ${["A", "B", "C"][index]}`,
                }),
            ),
        );
        await Promise.all(pages.map(openNewNomination));
        for (const [currentPage, title, recipient] of [
            [secondPage, "B local article edit", "Contributor B"],
            [thirdPage, "C local article edit", "Contributor C"],
        ] as const) {
            await currentPage.bringToFront();
            const dialog = currentPage.getByRole("dialog");
            await dialog
                .getByRole("textbox", { name: "Article title", exact: true })
                .fill(title);
            await dialog
                .getByRole("textbox", { name: "Recipient", exact: true })
                .fill(recipient);
            await dialog
                .getByRole("checkbox", {
                    name: "Scoring item 1 — Length",
                    exact: true,
                })
                .check();
        }
        await page.bringToFront();
        const first = page.getByRole("dialog");
        await first
            .getByRole("checkbox", {
                name: "Scoring item 1 — Length",
                exact: true,
            })
            .check();
        await first
            .getByRole("button", { name: "Save draft", exact: true })
            .click();
        await expect(first).toBeHidden();

        await secondPage.bringToFront();
        const second = secondPage.getByRole("dialog");
        await expect(second.getByRole("tab", { name: /^Item /u })).toHaveCount(
            2,
        );
        await expect(
            second.getByRole("tab", { name: "Item 2", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        await expect(
            second.getByRole("textbox", { name: "Article title", exact: true }),
        ).toHaveValue("B local article edit");
        await expect(
            second.getByRole("textbox", { name: "Recipient", exact: true }),
        ).toHaveValue("Contributor B");
        await second.getByRole("tab", { name: "Item 1", exact: true }).click();
        await expect(
            second.getByRole("textbox", { name: "Article title", exact: true }),
        ).toHaveAttribute("placeholder", "Article A");
        await second.getByRole("tab", { name: "Item 2", exact: true }).click();
        for (let index = 0; index < 2; index += 1) {
            await thirdPage.bringToFront();
            await secondPage.bringToFront();
            await secondPage.evaluate(() =>
                window.dispatchEvent(new Event("focus")),
            );
        }
        await expect(second.getByRole("tab", { name: /^Item /u })).toHaveCount(
            2,
        );
        await second
            .getByRole("button", { name: "Save draft", exact: true })
            .click();
        await expect(second).toBeHidden();

        await thirdPage.bringToFront();
        const third = thirdPage.getByRole("dialog");
        await expect(third.getByRole("tab", { name: /^Item /u })).toHaveCount(
            3,
        );
        await expect(
            third.getByRole("tab", { name: "Item 3", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        await expect(
            third.getByRole("textbox", { name: "Article title", exact: true }),
        ).toHaveValue("C local article edit");
        await expect(
            third.getByRole("textbox", { name: "Recipient", exact: true }),
        ).toHaveValue("Contributor C");
        await expect(
            third.getByRole("checkbox", {
                name: "Scoring item 1 — Length",
                exact: true,
            }),
        ).toBeChecked();
        await third
            .getByRole("button", { name: "Preview", exact: true })
            .click();
        const rows = third.getByRole("table").getByRole("row");
        await expect(rows).toHaveCount(4);
        await expect(rows.nth(1).getByRole("cell").nth(1)).toHaveText(
            "Article A",
        );
        await expect(rows.nth(2).getByRole("cell").nth(1)).toHaveText(
            "B local article edit",
        );
        await expect(rows.nth(3).getByRole("cell").nth(1)).toHaveText(
            "C local article edit",
        );
        for (const currentErrors of errors) expect(currentErrors).toEqual([]);
    });

    test("canceling and reopening a synchronized dialog discards unsaved inputs and follows later storage changes", async ({
        page,
        context,
    }) => {
        const anotherPage = await context.newPage();
        const errors = await Promise.all([
            mount(page, "en", {
                persistentDrafts: true,
                pageName: "Article A",
            }),
            mount(anotherPage, "en", {
                persistentDrafts: true,
                pageName: "Article B",
            }),
        ]);
        await Promise.all([
            openNewNomination(page),
            openNewNomination(anotherPage),
        ]);
        const first = page.getByRole("dialog");
        const second = anotherPage.getByRole("dialog");
        await second
            .getByRole("textbox", { name: "Recipient", exact: true })
            .fill("Canceled recipient");
        await second
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
        await first
            .getByRole("checkbox", {
                name: "Scoring item 1 — Length",
                exact: true,
            })
            .check();
        await first
            .getByRole("button", { name: "Save draft", exact: true })
            .click();
        await expect(first).toBeHidden();
        await anotherPage.bringToFront();
        await anotherPage.evaluate(() =>
            window.dispatchEvent(new Event("focus")),
        );
        await expect(anotherPage.getByRole("dialog")).toHaveCount(0);

        await openNewNomination(anotherPage);
        await expect(second.getByRole("tab", { name: /^Item /u })).toHaveCount(
            2,
        );
        await expect(
            second.getByRole("tab", { name: "Item 2", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        await expect(
            second.getByRole("textbox", { name: "Recipient", exact: true }),
        ).toHaveValue("");
        await second
            .getByRole("textbox", { name: "Recipient", exact: true })
            .fill("Reopened recipient B");
        await openNewNomination(page);
        await first
            .getByRole("textbox", { name: "Recipient", exact: true })
            .fill("Changed contributor A");
        await first
            .getByRole("button", { name: "Save draft", exact: true })
            .click();
        await expect(first).toBeHidden();
        await anotherPage.bringToFront();
        await expect(second.getByRole("tab", { name: /^Item /u })).toHaveCount(
            2,
        );
        await expect(
            second.getByRole("textbox", { name: "Recipient", exact: true }),
        ).toHaveValue("Reopened recipient B");
        await second.getByRole("tab", { name: "Item 1", exact: true }).click();
        await expect(
            second.getByRole("textbox", { name: "Recipient", exact: true }),
        ).toHaveValue("Changed contributor A");
        for (const currentErrors of errors) expect(currentErrors).toEqual([]);
    });

    test("an already open article includes another tab's 暂存 in summary, parsed preview and submission", async ({
        page,
        context,
    }) => {
        const firstErrors = await mount(page, "zh-Hans", {
            persistentDrafts: true,
            pageName: "Article A",
        });
        await openNewNomination(page);
        const anotherPage = await context.newPage();
        const secondErrors = await mount(anotherPage, "en", {
            persistentDrafts: true,
            pageName: "Article B",
        });
        await openNewNomination(anotherPage);
        const first = page.getByRole("dialog");
        const second = anotherPage.getByRole("dialog");
        await first
            .getByRole("textbox", { name: "得分者", exact: true })
            .fill("Contributor A");
        await first
            .getByRole("checkbox", { name: "得分项目1 — 篇幅", exact: true })
            .check();
        await second
            .getByRole("textbox", { name: "Recipient", exact: true })
            .fill("Contributor B");
        await second
            .getByRole("checkbox", {
                name: "Scoring item 1 — Length",
                exact: true,
            })
            .check();
        await first.getByRole("button", { name: "暂存", exact: true }).click();
        await expect(first).toBeHidden();
        expect(
            await anotherPage.evaluate(() => window.localStorage.length),
        ).toBe(1);

        await second
            .getByRole("button", { name: "Preview", exact: true })
            .click();
        const table = second.getByRole("table");
        await expect(table).toHaveCount(1);
        await expect(
            table.getByRole("row").nth(1).getByRole("cell"),
        ).toHaveText(["1", "Article A", "Contributor A", "3 points", "1c", ""]);
        await expect(
            table.getByRole("row").nth(2).getByRole("cell"),
        ).toHaveText(["2", "Article B", "Contributor B", "3 points", "1c", ""]);
        await second
            .getByRole("button", { name: "Preview", exact: true })
            .click();
        const preview = anotherPage.getByRole("dialog", {
            name: "Nomination preview",
            exact: true,
        });
        await expect(preview).toBeVisible();
        await expect(
            anotherPage
                .frameLocator('iframe[title="Nomination preview"]')
                .getByText("Fixture nomination preview", { exact: true }),
        ).toBeVisible();
        expect(
            await anotherPage.evaluate(
                () => (window as any).acgaFixture.previews,
            ),
        ).toEqual([
            {
                tables: [
                    expect.objectContaining({
                        comment: "",
                        nominations: [
                            expect.objectContaining({
                                pageName: "Article A",
                                awarder: "Contributor A",
                            }),
                            expect.objectContaining({
                                pageName: "Article B",
                                awarder: "Contributor B",
                            }),
                        ],
                    }),
                ],
            },
        ]);
        await preview
            .getByRole("button", { name: "Back", exact: true })
            .click();
        await second
            .getByRole("button", { name: "Submit", exact: true })
            .click();
        await expect(anotherPage.getByRole("dialog")).toHaveCount(0);
        const saves = await anotherPage.evaluate(
            () => (window as any).acgaFixture.effects.saves,
        );
        expect(saves).toHaveLength(1);
        expect(saves[0].data[0].nominations).toEqual([
            expect.objectContaining({ pageName: "Article A" }),
            expect.objectContaining({ pageName: "Article B" }),
        ]);
        expect(
            await anotherPage.evaluate(() => window.localStorage.length),
        ).toBe(0);
        expect(firstErrors).toEqual([]);
        expect(secondErrors).toEqual([]);
    });

    test("consecutive saves from preopened articles retain both and repeated previews do not duplicate them", async ({
        page,
        context,
    }) => {
        const firstErrors = await mount(page, "en", {
            persistentDrafts: true,
            pageName: "Article A",
        });
        await openNewNomination(page);
        const anotherPage = await context.newPage();
        const secondErrors = await mount(anotherPage, "en", {
            persistentDrafts: true,
            pageName: "Article B",
        });
        await openNewNomination(anotherPage);
        for (const currentPage of [page, anotherPage]) {
            const dialog = currentPage.getByRole("dialog");
            await dialog
                .getByRole("checkbox", {
                    name: "Scoring item 1 — Length",
                    exact: true,
                })
                .check();
            await dialog
                .getByRole("button", { name: "Save draft", exact: true })
                .click();
            await expect(dialog).toBeHidden();
        }
        const saved = await anotherPage.evaluate(() =>
            JSON.parse(
                window.localStorage.getItem(window.localStorage.key(0)!)!,
            ),
        );
        expect(saved.tables).toHaveLength(1);
        expect(saved.tables[0].nominations).toEqual([
            expect.objectContaining({ originalArticleTitle: "Article A" }),
            expect.objectContaining({ originalArticleTitle: "Article B" }),
        ]);
        await openNewNomination(anotherPage);
        const dialog = anotherPage.getByRole("dialog");
        await expect(dialog.getByRole("tab", { name: /^Item /u })).toHaveCount(
            2,
        );
        await dialog
            .getByRole("button", { name: "Preview", exact: true })
            .click();
        for (let index = 0; index < 2; index += 1) {
            const table = dialog.getByRole("table");
            await expect(table).toHaveCount(1);
            await expect(table.getByRole("row")).toHaveCount(3);
            await dialog
                .getByRole("button", { name: "Preview", exact: true })
                .click();
            const preview = anotherPage.getByRole("dialog", {
                name: "Nomination preview",
                exact: true,
            });
            await expect(preview).toBeVisible();
            await preview
                .getByRole("button", { name: "Back", exact: true })
                .click();
        }
        const previews = await anotherPage.evaluate(
            () => (window as any).acgaFixture.previews,
        );
        expect(previews).toHaveLength(2);
        for (const preview of previews) {
            expect(preview.tables).toHaveLength(1);
            expect(preview.tables[0].nominations).toEqual([
                expect.objectContaining({ pageName: "Article A" }),
                expect.objectContaining({ pageName: "Article B" }),
            ]);
        }
        await dialog
            .getByRole("button", { name: "Save draft", exact: true })
            .click();
        await expect(anotherPage.getByRole("dialog")).toHaveCount(0);
        await openNewNomination(anotherPage);
        await expect(dialog.getByRole("table")).toHaveCount(1);
        await dialog.getByRole("button", { name: "Back", exact: true }).click();
        await expect(dialog.getByRole("tab", { name: /^Item /u })).toHaveCount(
            2,
        );
        expect(firstErrors).toEqual([]);
        expect(secondErrors).toEqual([]);
    });

    for (const action of ["Preview", "Submit"] as const) {
        test(`${action} uses the automatically synchronized summary after another article saves a draft`, async ({
            page,
            context,
        }) => {
            const firstErrors = await mount(page, "en", {
                persistentDrafts: true,
                pageName: "Article A",
            });
            await openNewNomination(page);
            const anotherPage = await context.newPage();
            const secondErrors = await mount(anotherPage, "en", {
                persistentDrafts: true,
                pageName: "Article B",
            });
            await openNewNomination(anotherPage);
            for (const currentPage of [page, anotherPage]) {
                await currentPage
                    .getByRole("dialog")
                    .getByRole("checkbox", {
                        name: "Scoring item 1 — Length",
                        exact: true,
                    })
                    .check();
            }
            const dialog = anotherPage.getByRole("dialog");
            await dialog
                .getByRole("button", { name: "Preview", exact: true })
                .click();
            await expect(
                dialog.getByRole("table").getByRole("link", {
                    name: "Article B",
                    exact: true,
                }),
            ).toBeVisible();
            await expect(
                dialog.getByRole("table").getByRole("row"),
            ).toHaveCount(2);
            await page
                .getByRole("dialog")
                .getByRole("button", { name: "Save draft", exact: true })
                .click();
            await expect(page.getByRole("dialog")).toHaveCount(0);
            await expect(dialog.getByRole("table")).toHaveCount(1);
            await expect(
                dialog.getByRole("table").getByRole("row"),
            ).toHaveCount(3);
            for (const title of ["Article A", "Article B"]) {
                await expect(
                    dialog.getByRole("table").getByRole("link", {
                        name: title,
                        exact: true,
                    }),
                ).toBeVisible();
            }
            const effects = await anotherPage.evaluate(
                () => (window as any).acgaFixture.effects,
            );
            expect(effects.saves).toEqual([]);
            expect(effects.notices).toEqual([
                "Saved nominations changed on another page. Review the updated batch before submitting.",
            ]);
            if (action === "Preview") {
                await dialog
                    .getByRole("button", { name: "Preview", exact: true })
                    .click();
                const preview = anotherPage.getByRole("dialog", {
                    name: "Nomination preview",
                    exact: true,
                });
                await expect(preview).toBeVisible();
                const previews = await anotherPage.evaluate(
                    () => (window as any).acgaFixture.previews,
                );
                expect(previews).toHaveLength(1);
                expect(previews[0].tables[0].nominations).toEqual([
                    expect.objectContaining({ pageName: "Article A" }),
                    expect.objectContaining({ pageName: "Article B" }),
                ]);
                await preview
                    .getByRole("button", { name: "Back", exact: true })
                    .click();
            }
            await dialog
                .getByRole("button", { name: "Submit", exact: true })
                .click();
            await expect(anotherPage.getByRole("dialog")).toHaveCount(0);
            const saves = await anotherPage.evaluate(
                () => (window as any).acgaFixture.effects.saves,
            );
            expect(saves).toHaveLength(1);
            expect(saves[0].data[0].nominations).toEqual([
                expect.objectContaining({ pageName: "Article A" }),
                expect.objectContaining({ pageName: "Article B" }),
            ]);
            expect(
                await anotherPage.evaluate(() => window.localStorage.length),
            ).toBe(0);
            expect(firstErrors).toEqual([]);
            expect(secondErrors).toEqual([]);
        });
    }

    test("another tab's saved draft closes a stale parsed preview and shows the synchronized summary", async ({
        page,
        context,
    }) => {
        const anotherPage = await context.newPage();
        const errors = await Promise.all([
            mount(page, "en", {
                persistentDrafts: true,
                pageName: "Article A",
            }),
            mount(anotherPage, "en", {
                persistentDrafts: true,
                pageName: "Article B",
            }),
        ]);
        await Promise.all([
            openNewNomination(page),
            openNewNomination(anotherPage),
        ]);
        for (const currentPage of [page, anotherPage]) {
            await currentPage
                .getByRole("dialog")
                .getByRole("checkbox", {
                    name: "Scoring item 1 — Length",
                    exact: true,
                })
                .check();
        }
        const dialog = anotherPage.getByRole("dialog");
        await dialog
            .getByRole("button", { name: "Preview", exact: true })
            .click();
        await dialog
            .getByRole("button", { name: "Preview", exact: true })
            .click();
        const preview = anotherPage.getByRole("dialog", {
            name: "Nomination preview",
            exact: true,
        });
        await expect(preview).toBeVisible();
        await expect(anotherPage.locator("iframe")).toHaveCount(1);

        await page
            .getByRole("dialog")
            .getByRole("button", { name: "Save draft", exact: true })
            .click();
        await expect(preview).toBeHidden();
        await expect(anotherPage.locator("iframe")).toHaveCount(0);
        const rows = dialog.getByRole("table").getByRole("row");
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(1).getByRole("cell").nth(1)).toHaveText(
            "Article A",
        );
        await expect(rows.nth(2).getByRole("cell").nth(1)).toHaveText(
            "Article B",
        );
        await dialog
            .getByRole("button", { name: "Preview", exact: true })
            .click();
        await expect(preview).toBeVisible();
        const previews = await anotherPage.evaluate(
            () => (window as any).acgaFixture.previews,
        );
        expect(previews).toHaveLength(2);
        expect(previews[0].tables[0].nominations).toEqual([
            expect.objectContaining({ pageName: "Article B" }),
        ]);
        expect(previews[1].tables[0].nominations).toEqual([
            expect.objectContaining({ pageName: "Article A" }),
            expect.objectContaining({ pageName: "Article B" }),
        ]);
        for (const currentErrors of errors) expect(currentErrors).toEqual([]);
    });

    for (const stage of ["form", "summary", "preview"] as const) {
        test(`browser storage failure keeps the nomination ${stage} open for retry`, async ({
            page,
        }) => {
            const errors = await mount(page, "en", {
                persistentDrafts: true,
                failDraftStorage: true,
            });
            await openNewNomination(page);
            const dialog = page.getByRole("dialog");
            await dialog
                .getByRole("textbox", { name: "Article title", exact: true })
                .fill("Retry article");
            await dialog
                .getByRole("checkbox", {
                    name: "Scoring item 1 — Length",
                    exact: true,
                })
                .check();
            if (stage !== "form") {
                await dialog
                    .getByRole("button", { name: "Preview", exact: true })
                    .click();
            }
            if (stage === "preview") {
                await dialog
                    .getByRole("button", { name: "Preview", exact: true })
                    .click();
            }
            const active =
                stage === "preview"
                    ? page.getByRole("dialog", {
                          name: "Nomination preview",
                          exact: true,
                      })
                    : dialog;
            await active
                .getByRole("button", { name: "Save draft", exact: true })
                .click();
            await expect(active).toBeVisible();
            await expect
                .poll(() =>
                    page.evaluate(
                        () =>
                            (window as any).acgaFixture.effects.notices.length,
                    ),
                )
                .toBe(1);
            expect(
                await page.evaluate(
                    () => (window as any).acgaFixture.effects.saves,
                ),
            ).toEqual([]);
            expect(await page.evaluate(() => window.localStorage.length)).toBe(
                0,
            );
            await page.evaluate(() => {
                (window as any).acgaFixture.options.failDraftStorage = false;
            });
            await active
                .getByRole("button", { name: "Save draft", exact: true })
                .click();
            await expect(page.getByRole("dialog")).toHaveCount(0);
            await openNewNomination(page);
            if (stage !== "form") {
                await expect(dialog.getByRole("table")).toHaveCount(1);
                await dialog
                    .getByRole("button", { name: "Back", exact: true })
                    .click();
            }
            await expect(
                dialog.getByRole("textbox", {
                    name: "Article title",
                    exact: true,
                }),
            ).toHaveValue("Retry article");
            expect(errors).toEqual([]);
        });
    }

    test("failed nomination submission keeps the saved draft and success removes it", async ({
        page,
    }) => {
        const errors = await mount(page, "en", {
            persistentDrafts: true,
            failNewNomination: true,
        });
        await openNewNomination(page);
        const dialog = page.getByRole("dialog");
        const article = dialog.getByRole("textbox", {
            name: "Article title",
            exact: true,
        });
        await article.fill("Saved submission article");
        await dialog
            .getByRole("checkbox", {
                name: "Scoring item 1 — Length",
                exact: true,
            })
            .check();
        await dialog
            .getByRole("button", { name: "Save draft", exact: true })
            .click();
        await openNewNomination(page);
        await article.fill("Unsaved submission change");
        await dialog
            .getByRole("button", { name: "Preview", exact: true })
            .click();
        await dialog
            .getByRole("button", { name: "Submit", exact: true })
            .click();
        await expect(dialog).toBeVisible();
        expect(await page.evaluate(() => window.localStorage.length)).toBe(1);
        await dialog
            .getByRole("button", { name: "Close", exact: true })
            .click();
        await openNewNomination(page);
        await expect(article).toHaveValue("Saved submission article");
        await page.evaluate(() => {
            (window as any).acgaFixture.options.failNewNomination = false;
        });
        await dialog
            .getByRole("button", { name: "Preview", exact: true })
            .click();
        await dialog
            .getByRole("button", { name: "Submit", exact: true })
            .click();
        await expect(dialog).toBeHidden();
        expect(await page.evaluate(() => window.localStorage.length)).toBe(0);
        await openNewNomination(page);
        await expect(article).toHaveValue("");
        expect(errors).toEqual([]);
    });
});

test("new nomination uses five exclusive groups and cancel discards the draft", async ({
    page,
}) => {
    const errors = await mount(page);
    await page.evaluate(() => {
        const fixture = (window as any).acgaFixture;
        void fixture.dialogs
            .showNewNominationDialog()
            .then((outcome: unknown) => (fixture.effects.outcome = outcome));
    });
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveAccessibleName("提名維基ACG專題獎");
    await expect(dialog.locator(".cdx-dialog__header__title")).toHaveText(
        "提名維基ACG專題獎",
    );
    await expect(
        dialog.locator(".cdx-dialog__header__close-button"),
    ).toBeVisible();
    const recipient = dialog.getByRole("textbox", {
        name: "得分者",
        exact: true,
    });
    await expect(recipient).toHaveValue("");
    await expect(recipient).toHaveAttribute("placeholder", "Example");
    await expect(
        dialog.getByRole("button", { name: /^\(1–4\)/u }),
    ).toHaveAttribute("aria-pressed", "true");
    for (const name of [
        "得分項目1 — 篇幅",
        "得分項目2 — 品質",
        /^得分項目3 — 格式/u,
        "得分項目4 — 活動",
    ]) {
        await expect(
            dialog.getByRole("group", { name, exact: true }),
        ).toBeVisible();
    }
    await expect(
        dialog.getByText("此項須與得分項目1或2同時選用。", { exact: true }),
    ).toBeHidden();
    const formatControl = dialog
        .getByRole("group", { name: /^得分項目3 — 格式/u })
        .locator(".acga-article-core-control");
    await expect(formatControl.getByRole("checkbox")).toBeDisabled();
    await expect(formatControl).toHaveAttribute(
        "title",
        "此項須與得分項目1或2同時選用。",
    );
    const contentToggle = dialog
        .getByRole("group", { name: "得分項目1 — 篇幅", exact: true })
        .getByRole("checkbox");
    await contentToggle.check();
    await expect(formatControl.getByRole("checkbox")).toBeEnabled();
    await expect(formatControl).not.toHaveAttribute("title");
    await contentToggle.uncheck();
    await expect(formatControl.getByRole("checkbox")).toBeDisabled();
    await expect(formatControl).toHaveAttribute(
        "title",
        "此項須與得分項目1或2同時選用。",
    );
    for (const [name, ruleLabel] of [
        [/^\(5\)/u, null],
        [/^\(6\)/u, null],
        [/^\(7\)/u, "他薦"],
        [/^\(8\)/u, "其他"],
    ] as const) {
        const category = dialog.getByRole("button", { name });
        await expect(category).toBeVisible();
        await category.click();
        await expect(category).toHaveAttribute("aria-pressed", "true");
        await expect(
            dialog.getByRole("group", { name: /^得分項目/u }),
        ).toBeVisible();
        await expect(
            dialog.locator(
                '.acga-rule-category-fieldset button[aria-pressed="true"]',
            ),
        ).toHaveCount(1);
        if (ruleLabel !== null) {
            const selected = dialog.getByRole("checkbox", {
                name: ruleLabel,
                exact: true,
            });
            const score = dialog.getByRole("spinbutton", {
                name: `${ruleLabel} 得分`,
                exact: true,
            });
            await expect(selected).toBeVisible();
            await expect(selected).toBeChecked();
            await expect(score).toBeEnabled();
            await selected.uncheck();
            await expect(score).toBeDisabled();
            await dialog
                .getByRole("button", { name: "預覽", exact: true })
                .click();
            await expect(
                dialog.locator(".acga-rule-category-error"),
            ).toBeVisible();
            await expect(dialog.getByRole("table")).toHaveCount(0);
            await selected.check();
            await expect(score).toBeEnabled();
        }
    }
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects),
    ).toEqual({ saves: [], errors: [], notices: [], outcome: "cancel" });
    expect(errors).toEqual([]);
});

test("nomination tab icons manage drafts and support keyboard navigation", async ({
    page,
}) => {
    const errors = await mount(page, "en");
    await page.evaluate(() => {
        const fixture = (window as any).acgaFixture;
        void fixture.dialogs
            .showNewNominationDialog()
            .then((outcome: unknown) => (fixture.effects.outcome = outcome));
    });
    const dialog = page.getByRole("dialog");
    const tab = (index: number) =>
        dialog.getByRole("tab", { name: `Item ${index}`, exact: true });
    const remove = (index: number) =>
        dialog.getByRole("button", {
            name: `Delete this nomination: Item ${index}`,
            exact: true,
        });
    const add = dialog.getByRole("button", {
        name: "Add nomination",
        exact: true,
    });
    const article = dialog
        .locator(".acga-nomination-panel:visible")
        .getByRole("textbox", { name: "Article title", exact: true });
    const length = dialog.getByRole("checkbox", {
        name: "Scoring item 1 — Length",
        exact: true,
    });

    await expect(tab(1)).toHaveAttribute("aria-selected", "true");
    await expect(remove(1)).toBeDisabled();
    await expect(add).toHaveText("");
    await expect(add.locator("svg")).toHaveCount(1);
    await expect(remove(1)).toHaveText("");
    await expect(remove(1).locator("svg")).toHaveCount(1);
    await expect(remove(1)).toHaveClass(/cdx-button--weight-quiet/u);
    await expect(remove(1)).toHaveClass(/cdx-button--action-destructive/u);
    await expect(
        dialog.locator(".acga-dialog-footer").getByRole("button", {
            name: /Add nomination|Delete this nomination/u,
        }),
    ).toHaveCount(0);

    await article.fill("First article");
    await length.check();
    await add.click();
    await expect(tab(2)).toHaveAttribute("aria-selected", "true");
    await article.fill("Second article");
    await length.check();
    await add.click();
    await expect(tab(3)).toHaveAttribute("aria-selected", "true");
    await article.fill("Third article");
    await expect(remove(1)).toHaveCount(0);
    await expect(remove(2)).toHaveCount(0);
    await expect(dialog.locator(".acga-nomination-tab-remove")).toHaveCount(1);
    await capture(page, "nomination-tabs-en");
    await tab(1).click();
    await expect(article).toHaveValue("First article");
    await tab(2).click();
    await expect(article).toHaveValue("Second article");
    await tab(3).click();
    await expect(article).toHaveValue("Third article");

    for (const [key, index] of [
        ["Home", 1],
        ["End", 3],
        ["ArrowLeft", 2],
        ["ArrowRight", 3],
    ] as const) {
        await page.keyboard.press(key);
        await expect(tab(index)).toBeFocused();
        await expect(tab(index)).toHaveAttribute("aria-selected", "true");
    }

    await tab(1).click();
    await remove(1).click();
    await expect(dialog.getByRole("tab", { name: /^Item /u })).toHaveCount(2);
    await expect(tab(1)).toHaveAttribute("aria-selected", "true");
    await expect(article).toHaveValue("Second article");
    await tab(2).click();
    await expect(tab(2)).toHaveAttribute("aria-selected", "true");
    await expect(article).toHaveValue("Third article");
    await remove(2).click();
    await expect(tab(1)).toHaveAttribute("aria-selected", "true");
    await expect(article).toHaveValue("Second article");
    await add.click();
    await tab(2).focus();
    await page.keyboard.press("Delete");
    await expect(dialog.getByRole("tab", { name: /^Item /u })).toHaveCount(1);
    await expect(tab(1)).toBeFocused();
    await expect(article).toHaveValue("Second article");
    await expect(remove(1)).toBeDisabled();
    await page.keyboard.press("Delete");
    await expect(dialog.getByRole("tab", { name: /^Item /u })).toHaveCount(1);

    await dialog.locator(".cdx-dialog__header__close-button").click();
    await expect(dialog).toBeHidden();
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.saves),
    ).toEqual([]);
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.outcome),
    ).toBe("cancel");
    expect(errors).toEqual([]);
});

test("nomination tabs drag into order, existing tables, and new tables with draft order preserved", async ({
    page,
}) => {
    const errors = await mount(page, "en", { persistentDrafts: true });
    await openNewNomination(page);
    const dialog = page.getByRole("dialog");
    const item = (number: number) =>
        dialog.getByRole("tab", { name: `Item ${number}`, exact: true });
    const table = (number: number) =>
        dialog.getByRole("tab", { name: `Table ${number}`, exact: true });
    const article = dialog.getByRole("textbox", {
        name: "Article title",
        exact: true,
    });
    const length = dialog.getByRole("checkbox", {
        name: "Scoring item 1 — Length",
        exact: true,
    });
    const addItem = dialog.getByRole("button", {
        name: "Add nomination",
        exact: true,
    });
    const addTable = dialog.getByRole("button", {
        name: "Add table",
        exact: true,
    });
    for (const [index, title] of ["First", "Second", "Third"].entries()) {
        if (index) await addItem.click();
        await article.fill(title);
        await length.check();
    }
    await expect(item(3)).toHaveAttribute("draggable", "true");
    await item(3).dragTo(dialog.locator(".acga-nomination-tab").nth(0), {
        targetPosition: { x: 4, y: 12 },
    });
    await expect(article).toHaveValue("Third");
    await expect(item(1)).toHaveAttribute("aria-selected", "true");
    await expect(item(1)).toBeFocused();
    const last = dialog.locator(".acga-nomination-tab").nth(2);
    const bounds = await last.boundingBox();
    await item(1).dragTo(last, {
        targetPosition: { x: bounds!.width - 4, y: 12 },
    });
    await expect(item(3)).toHaveAttribute("aria-selected", "true");
    await expect(article).toHaveValue("Third");
    await item(1).dragTo(addItem);
    await expect(item(3)).toHaveAttribute("aria-selected", "true");
    await expect(article).toHaveValue("First");

    await addTable.click();
    await article.fill("Fourth");
    await length.check();
    await table(1).click();
    await item(1).dragTo(table(2));
    await expect(table(2)).toHaveAttribute("aria-selected", "true");
    await expect(item(2)).toHaveAttribute("aria-selected", "true");
    await expect(article).toHaveValue("Second");
    await item(2).dragTo(addTable);
    await expect(table(3)).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByRole("tab", { name: /^Item /u })).toHaveCount(1);
    await expect(article).toHaveValue("Second");
    await item(1).dragTo(table(1));
    await expect(table(3)).toHaveCount(0);
    await expect(table(1)).toHaveAttribute("aria-selected", "true");
    await expect(item(3)).toHaveAttribute("aria-selected", "true");
    await expect(article).toHaveValue("Second");

    await article.fill("");
    await item(3).dragTo(addTable);
    await expect(table(3)).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByRole("tab", { name: /^Item /u })).toHaveCount(1);
    await expect(article).toHaveValue("");
    await expect(dialog.locator(".acga-dialog-error")).toHaveCount(0);
    await expect(dialog.locator(".acga-nomination-tab-dragging")).toHaveCount(
        0,
    );
    await expect(
        dialog.locator(".acga-nomination-table-drop-target"),
    ).toHaveCount(0);
    await article.fill("Second");
    await capture(page, "nomination-drag-tabs-en");
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    const summaryTitles = () =>
        dialog
            .locator(".acga-nomination-table-summary")
            .evaluateAll((groups) =>
                groups.map((group) =>
                    [...group.querySelectorAll("tbody tr")].map((row) =>
                        row.querySelectorAll("td")[1]!.textContent!.trim(),
                    ),
                ),
            );
    await expect
        .poll(summaryTitles)
        .toEqual([["Third", "First"], ["Fourth"], ["Second"]]);
    const comments = dialog.locator(".acga-additional-message textarea");
    await comments.nth(0).fill("First table comment");
    await comments.nth(1).fill("Second table comment");
    await comments.nth(2).fill("Third table comment");
    await dialog
        .getByRole("button", { name: "Save draft", exact: true })
        .click();
    await expect(dialog).toBeHidden();
    await openNewNomination(page);
    await expect
        .poll(summaryTitles)
        .toEqual([["Third", "First"], ["Fourth"], ["Second"]]);
    await expect(comments.nth(0)).toHaveValue("First table comment");
    await expect(comments.nth(1)).toHaveValue("Second table comment");
    await expect(comments.nth(2)).toHaveValue("Third table comment");
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.saves),
    ).toEqual([]);
    expect(errors).toEqual([]);
});

test("Shift navigation reorders nomination tabs and keeps focus on the moved item", async ({
    page,
}) => {
    const errors = await mount(page, "en");
    await openNewNomination(page);
    const dialog = page.getByRole("dialog");
    const item = (number: number) =>
        dialog.getByRole("tab", { name: `Item ${number}`, exact: true });
    const article = dialog.getByRole("textbox", {
        name: "Article title",
        exact: true,
    });
    for (const [index, title] of ["First", "Second", "Third"].entries()) {
        if (index)
            await dialog
                .getByRole("button", { name: "Add nomination", exact: true })
                .click();
        await article.fill(title);
        await dialog
            .getByRole("checkbox", {
                name: "Scoring item 1 — Length",
                exact: true,
            })
            .check();
    }
    await item(3).click();
    for (const [key, position] of [
        ["Shift+Home", 1],
        ["Shift+ArrowRight", 2],
        ["Shift+End", 3],
        ["Shift+ArrowLeft", 2],
    ] as const) {
        await page.keyboard.press(key);
        await expect(item(position)).toBeFocused();
        await expect(item(position)).toHaveAttribute("aria-selected", "true");
        await expect(article).toHaveValue("Third");
    }
    await page.keyboard.press("Home");
    await expect(item(1)).toBeFocused();
    await expect(article).toHaveValue("First");
    await page.keyboard.press("End");
    await expect(item(3)).toBeFocused();
    await expect(article).toHaveValue("Second");
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(dialog.locator("tbody tr td:nth-child(2)")).toHaveText([
        "First",
        "Third",
        "Second",
    ]);
    expect(errors).toEqual([]);
});

test("adding an item or table requires a recipient, article, and positive scoring items", async ({
    page,
}) => {
    const errors = await mount(page, "en", { userName: null });
    await page.evaluate(() => {
        void (window as any).acgaFixture.dialogs.showNewNominationDialog();
    });
    const dialog = page.getByRole("dialog");
    const recipient = dialog.getByRole("textbox", {
        name: "Recipient",
        exact: true,
    });
    const article = dialog.getByRole("textbox", {
        name: "Article title",
        exact: true,
    });
    const addItem = dialog.getByRole("button", {
        name: "Add nomination",
        exact: true,
    });
    const addTable = dialog.getByRole("button", {
        name: "Add table",
        exact: true,
    });
    const category = dialog.locator(".acga-rule-category-fieldset");
    const selectedCategory = category.getByRole("button", {
        name: /^\(1–4\)/u,
    });
    const initialCategoryColor = await selectedCategory.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
    );
    await expect(dialog.getByRole("tab", { name: /^Table /u })).toHaveCount(1);
    await expect(dialog.getByRole("tab", { name: /^Item /u })).toHaveCount(1);

    await addItem.click();
    await expect(recipient).toBeFocused();
    await expect(
        dialog.locator(".acga-author-fields .acga-field-error"),
    ).toHaveText("Enter the recipient.");
    await expect(
        dialog.locator(".acga-dialog-error-details").getByRole("listitem"),
    ).toHaveText([
        "Enter the recipient.",
        "Article title missing",
        "Select at least one scoring rule.",
        "Select scoring items with a total greater than 0.",
    ]);
    await expect(category.getByRole("listitem")).toHaveText([
        "Select at least one scoring rule.",
        "Select scoring items with a total greater than 0.",
    ]);
    await expect(
        dialog.locator(".acga-code-preview-text textarea"),
    ).toBeVisible();
    await expect(dialog.getByRole("tab", { name: /^Item /u })).toHaveCount(1);
    await recipient.fill("Named editor");
    await addTable.click();
    await expect(article).toBeFocused();
    await expect(dialog.getByRole("tab", { name: /^Table /u })).toHaveCount(1);

    await article.fill("Valid article");
    await addItem.click();
    const noItemsError = category.getByText(
        "Select at least one scoring rule.",
        { exact: true },
    );
    await expect(noItemsError).toBeVisible();
    await expect(category).toHaveClass(/acga-rule-category-error/u);
    await expect(category.locator(".cdx-toggle-button-group")).toHaveAttribute(
        "aria-invalid",
        "true",
    );
    await expect(selectedCategory).not.toHaveCSS(
        "background-color",
        initialCategoryColor,
    );
    const categoryBounds = await selectedCategory.boundingBox();
    const errorBounds = await noItemsError.boundingBox();
    expect(errorBounds!.y).toBeGreaterThanOrEqual(
        categoryBounds!.y + categoryBounds!.height,
    );
    await expect(dialog.getByRole("tab", { name: /^Item /u })).toHaveCount(1);

    await dialog
        .getByRole("checkbox", { name: "Scoring item 1 — Length", exact: true })
        .check();
    const score = dialog
        .locator(".acga-content-expansion-row")
        .getByRole("spinbutton", { name: "Score", exact: true });
    await score.fill("0");
    await addTable.click();
    await expect(
        category.getByText(
            "Select scoring items with a total greater than 0.",
            { exact: true },
        ),
    ).toBeVisible();
    await expect(dialog.getByRole("tab", { name: /^Table /u })).toHaveCount(1);
    const sourcePreview = dialog.locator(".acga-code-preview-text textarea");
    await expect(sourcePreview).toHaveValue(/1c\[0\]/u);
    await score.fill("");
    await expect(sourcePreview).toHaveValue(/1c\[\]/u);
    await score.fill("0.25");
    await expect(sourcePreview).toHaveValue(/1c\[0\.25\]/u);
    await addItem.click();
    await expect(dialog.getByRole("tab", { name: /^Item /u })).toHaveCount(1);
    await score.fill("0.5");
    await addItem.click();
    await expect(dialog.getByRole("tab", { name: /^Item /u })).toHaveCount(2);
    await expect(
        dialog.getByRole("tab", { name: "Item 2", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.saves),
    ).toEqual([]);
    expect(errors).toEqual([]);
});

test("nomination summary preserves comments and edits before submitting the batch once", async ({
    page,
}) => {
    const errors = await mount(page, "en");
    await page.evaluate(() => {
        void (window as any).acgaFixture.dialogs.showNewNominationDialog();
    });
    const dialog = page.getByRole("dialog");
    const article = dialog.getByRole("textbox", {
        name: "Article title",
        exact: true,
    });
    const recipient = dialog.getByRole("textbox", {
        name: "Recipient",
        exact: true,
    });
    const enabled = dialog.getByRole("checkbox", {
        name: "Scoring item 1 — Length",
        exact: true,
    });
    const score = dialog
        .locator(".acga-content-expansion-row")
        .getByRole("spinbutton", { name: "Score", exact: true });
    const submit = dialog.getByRole("button", { name: "Submit", exact: true });
    const openSummary = dialog.getByRole("button", {
        name: "Preview",
        exact: true,
    });
    const mainFooter = dialog.locator(".acga-dialog-footer");
    await expect(mainFooter.getByRole("button")).toHaveText([
        "Cancel",
        "Save draft",
        "Preview",
    ]);
    const cancel = mainFooter.getByRole("button", {
        name: "Cancel",
        exact: true,
    });
    await expect(cancel).toHaveClass(/cdx-button--weight-quiet/u);
    await expect(cancel).toHaveClass(/cdx-button--action-default/u);
    await expect(openSummary).toHaveClass(/cdx-button--weight-primary/u);
    await expect(openSummary).toHaveClass(/cdx-button--action-progressive/u);
    await expect(dialog.locator(".acga-additional-message")).toHaveCount(0);
    await article.fill("First article");
    await expect(recipient).toHaveValue("");
    await expect(recipient).toHaveAttribute("placeholder", "Example");
    await enabled.check();
    await dialog
        .getByRole("button", { name: "Add nomination", exact: true })
        .click();
    await article.fill("Second article");
    await enabled.check();
    const secondTab = dialog.getByRole("tab", {
        name: "Item 2",
        exact: true,
    });
    await expect(secondTab).toHaveAttribute(
        "title",
        /Second article.*Example.*3\s*points/u,
    );
    await recipient.fill("Bob");
    await score.fill("4");
    await expect(secondTab).toHaveAttribute(
        "title",
        /Second article.*Bob.*4\s*points/u,
    );
    await openSummary.click();

    const summary = dialog.getByRole("table", {
        name: "Nomination table 1",
        exact: true,
    });
    await expect(summary).toBeVisible();
    await expect(summary.getByRole("columnheader")).toHaveText([
        "#",
        "Awarded article",
        "Recipient",
        "Score",
        "Detailed codes",
        "Actions",
    ]);
    const first = summary.getByRole("row").nth(1);
    const second = summary.getByRole("row").nth(2);
    await expect(first.getByRole("cell")).toHaveText([
        "1",
        "First article",
        "Example",
        "3 points",
        "1c",
        "",
    ]);
    await expect(second.getByRole("cell")).toHaveText([
        "2",
        "Second article",
        "Bob",
        "4 points",
        "1c[4]",
        "",
    ]);
    await expect(
        first.getByRole("link", { name: "First article", exact: true }),
    ).toHaveAttribute("href", "/wiki/First_article");
    await expect(
        first.getByRole("link", { name: "Example", exact: true }),
    ).toHaveAttribute("href", "/wiki/User%3AExample");
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.saves),
    ).toEqual([]);
    const comment = dialog.locator(".acga-additional-message textarea");
    await comment.fill("Shared batch comment");
    const footer = dialog.locator(".acga-dialog-footer");
    await expect(footer).toHaveCSS("justify-content", "flex-end");
    await expect(footer.getByRole("button")).toHaveText([
        "Back",
        "Save draft",
        "Preview",
        "Submit",
    ]);
    const back = footer.getByRole("button", { name: "Back", exact: true });
    const preview = footer.getByRole("button", {
        name: "Preview",
        exact: true,
    });
    await expect(back).toHaveClass(/cdx-button--weight-normal/u);
    await expect(back).toHaveClass(/cdx-button--action-default/u);
    await expect(preview).toHaveClass(/cdx-button--weight-normal/u);
    await expect(preview).toHaveClass(/cdx-button--action-default/u);
    await expect(submit).toHaveClass(/cdx-button--weight-primary/u);
    await expect(submit).toHaveClass(/cdx-button--action-progressive/u);
    await preview.click();
    const previewDialog = page.getByRole("dialog", {
        name: "Nomination preview",
        exact: true,
    });
    await expect(previewDialog).toBeVisible();
    await expect(previewDialog.locator("iframe")).toHaveAttribute(
        "sandbox",
        "",
    );
    await expect(
        page
            .frameLocator('iframe[title="Nomination preview"]')
            .getByText("Fixture nomination preview", { exact: true }),
    ).toBeVisible();
    await capture(page, "nomination-preview-en");
    expect(
        await page.evaluate(() => (window as any).acgaFixture.previews),
    ).toEqual([
        {
            tables: [
                expect.objectContaining({ comment: "Shared batch comment" }),
            ],
        },
    ]);
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.saves),
    ).toEqual([]);
    await previewDialog
        .getByRole("button", { name: "Back", exact: true })
        .click();
    await expect(previewDialog).toBeHidden();
    await expect(summary).toBeVisible();
    await expect(comment).toHaveValue("Shared batch comment");
    await first
        .getByRole("button", { name: "Edit nomination 1", exact: true })
        .click();
    const firstEditor = page.getByRole("dialog", {
        name: "Edit nomination 1",
        exact: true,
    });
    await expect(firstEditor).toBeVisible();
    await firstEditor
        .getByRole("textbox", { name: "Recipient", exact: true })
        .fill("Discarded editor");
    await firstEditor
        .getByRole("button", { name: "Cancel edits", exact: true })
        .click();
    await expect(page.locator(".acga-nomination-editor-dialog")).toBeHidden();
    await expect(summary).toBeVisible();
    await expect(first.getByRole("cell")).toHaveText([
        "1",
        "First article",
        "Example",
        "3 points",
        "1c",
        "",
    ]);
    await expect(comment).toHaveValue("Shared batch comment");
    await second
        .getByRole("button", { name: "Edit nomination 2", exact: true })
        .click();
    const secondEditor = page.getByRole("dialog", {
        name: "Edit nomination 2",
        exact: true,
    });
    await secondEditor
        .getByRole("textbox", { name: "Article title", exact: true })
        .fill("Revised second article");
    await secondEditor
        .getByRole("textbox", { name: "Recipient", exact: true })
        .fill("Bobby");
    await secondEditor
        .locator(".acga-content-expansion-row")
        .getByRole("spinbutton", { name: "Score", exact: true })
        .fill("4.5");
    await secondEditor
        .getByRole("button", { name: "Apply changes", exact: true })
        .click();
    await expect(page.locator(".acga-nomination-editor-dialog")).toBeHidden();
    await expect(summary).toBeVisible();
    await expect(second.getByRole("cell")).toHaveText([
        "2",
        "Revised second article",
        "Bobby",
        "4.5 points",
        "1c[4.5]",
        "",
    ]);
    await expect(comment).toHaveValue("Shared batch comment");
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.saves),
    ).toEqual([]);
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await expect(summary).toHaveCount(0);
    await expect(dialog.locator(".acga-additional-message")).toHaveCount(0);
    await dialog.getByRole("tab", { name: "Item 1", exact: true }).click();
    await expect(article).toHaveValue("First article");
    await expect(recipient).toHaveValue("");
    await expect(recipient).toHaveAttribute("placeholder", "Example");
    await score.fill("3.5");
    await openSummary.click();
    await expect(first.getByRole("cell")).toHaveText([
        "1",
        "First article",
        "Example",
        "3.5 points",
        "1c[3.5]",
        "",
    ]);
    await expect(second.getByRole("cell")).toHaveText([
        "2",
        "Revised second article",
        "Bobby",
        "4.5 points",
        "1c[4.5]",
        "",
    ]);
    await expect(comment).toHaveValue("Shared batch comment");
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.saves),
    ).toEqual([]);
    await submit.click();
    await expect(dialog).toBeHidden();
    const effects = await page.evaluate(
        () => (window as any).acgaFixture.effects,
    );
    expect(effects.saves).toHaveLength(1);
    expect(effects.saves[0]).toMatchObject({
        kind: "new",
        data: [
            {
                comment: "Shared batch comment",
                nominations: [
                    {
                        pageName: "First article",
                        awarder: "Example",
                        ruleStatus: { "1c": { selected: true, score: 3.5 } },
                    },
                    {
                        pageName: "Revised second article",
                        awarder: "Bobby",
                        ruleStatus: { "1c": { selected: true, score: 4.5 } },
                    },
                ],
            },
        ],
    });
    expect(effects.errors).toEqual([]);
    expect(errors).toEqual([]);
});

test("frozen summary rows keep their draft but are excluded from preview and submission", async ({
    page,
}) => {
    const errors = await mount(page, "en");
    await page.evaluate(() => {
        void (window as any).acgaFixture.dialogs.showNewNominationDialog();
    });
    const dialog = page.getByRole("dialog");
    const article = dialog.getByRole("textbox", {
        name: "Article title",
        exact: true,
    });
    const length = dialog.getByRole("checkbox", {
        name: "Scoring item 1 — Length",
        exact: true,
    });
    await article.fill("Frozen article");
    await length.check();
    await dialog
        .getByRole("button", { name: "Add nomination", exact: true })
        .click();
    await article.fill("Included article");
    await length.check();
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    const summaryDialog = page.getByRole("dialog", {
        name: "Confirm Wiki ACG Award nominations",
        exact: true,
    });
    const table = summaryDialog.getByRole("table", {
        name: "Nomination table 1",
        exact: true,
    });
    const first = table.getByRole("row").nth(1);
    const second = table.getByRole("row").nth(2);
    const preview = summaryDialog.getByRole("button", {
        name: "Preview",
        exact: true,
    });
    const submit = summaryDialog.getByRole("button", {
        name: "Submit",
        exact: true,
    });
    const comment = summaryDialog.locator(
        ".cdx-table__footer .acga-additional-message textarea",
    );
    await comment.fill("Keep this table comment");
    await first
        .getByRole("button", { name: "Freeze nomination 1", exact: true })
        .click();
    await expect(first.locator('[data-frozen="true"]')).toHaveCount(1);
    await expect(first.getByRole("cell").first()).toHaveText("");
    await expect(second.getByRole("cell").first()).toHaveText("1");
    await expect(first.getByRole("cell").nth(1)).toHaveCSS(
        "font-style",
        "italic",
    );
    await expect(first.getByRole("cell").nth(1)).toHaveCSS(
        "text-decoration-line",
        "line-through",
    );
    await second
        .getByRole("button", { name: "Freeze nomination 2", exact: true })
        .click();
    await expect(second.getByRole("cell").first()).toHaveText("");
    await expect(preview).toBeDisabled();
    await expect(submit).toBeDisabled();
    await first
        .getByRole("button", { name: "Unfreeze nomination 1", exact: true })
        .click();
    await expect(first.getByRole("cell").first()).toHaveText("1");
    await expect(first.locator('[data-frozen="true"]')).toHaveCount(0);
    await expect(preview).toBeEnabled();
    await expect(submit).toBeEnabled();
    await second
        .getByRole("button", { name: "Unfreeze nomination 2", exact: true })
        .click();
    await expect(second.getByRole("cell").first()).toHaveText("2");
    await first
        .getByRole("button", { name: "Freeze nomination 1", exact: true })
        .click();
    await expect(comment).toHaveValue("Keep this table comment");
    await capture(page, "nomination-frozen-row-en");
    await preview.click();
    const previewDialog = page.getByRole("dialog", {
        name: "Nomination preview",
        exact: true,
    });
    await expect(previewDialog).toBeVisible();
    const expectedTables = [
        {
            comment: "Keep this table comment",
            nominations: [
                expect.objectContaining({ pageName: "Included article" }),
            ],
        },
    ];
    expect(
        await page.evaluate(() => (window as any).acgaFixture.previews),
    ).toEqual([{ tables: expectedTables }]);
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.saves),
    ).toEqual([]);
    await previewDialog
        .getByRole("button", { name: "Back", exact: true })
        .click();
    await expect(previewDialog).toBeHidden();
    await submit.click();
    await expect(summaryDialog).toBeHidden();
    const effects = await page.evaluate(
        () => (window as any).acgaFixture.effects,
    );
    expect(effects.saves).toHaveLength(1);
    expect(effects.saves[0].data).toEqual(expectedTables);
    expect(effects.errors).toEqual([]);
    expect(errors).toEqual([]);
});

test("table tabs keep separate comments and submit earlier-table edits in one batch", async ({
    page,
}) => {
    const errors = await mount(page, "en");
    await page.evaluate(() => {
        void (window as any).acgaFixture.dialogs.showNewNominationDialog();
    });
    const dialog = page.getByRole("dialog");
    const firstTableTab = dialog.getByRole("tab", {
        name: "Table 1",
        exact: true,
    });
    const secondTableTab = dialog.getByRole("tab", {
        name: "Table 2",
        exact: true,
    });
    const article = dialog.getByRole("textbox", {
        name: "Article title",
        exact: true,
    });
    const length = dialog.getByRole("checkbox", {
        name: "Scoring item 1 — Length",
        exact: true,
    });
    const score = dialog
        .locator(".acga-content-expansion-row")
        .getByRole("spinbutton", { name: "Score", exact: true });

    await expect(firstTableTab).toBeVisible();
    await expect(firstTableTab).toHaveAttribute("aria-selected", "true");
    await expect(secondTableTab).toHaveCount(0);
    await expect(
        dialog.getByRole("tab", { name: "Item 1", exact: true }),
    ).toBeVisible();
    await expect(
        dialog.getByRole("button", {
            name: /^(?:Split table|Merge tables)$/u,
        }),
    ).toHaveCount(0);
    const addTable = dialog.getByRole("button", {
        name: "Add table",
        exact: true,
    });
    await addTable.click();
    await expect(secondTableTab).toHaveCount(0);
    await expect(article).toBeFocused();
    await article.fill("First table article");
    await length.check();
    await addTable.click();
    await expect(secondTableTab).toBeVisible();
    await expect(dialog.getByRole("tab", { name: /^Item /u })).toHaveCount(1);
    await expect(
        dialog.getByRole("tab", { name: "Item 1", exact: true }),
    ).toBeVisible();
    await expect(
        dialog.getByRole("tab", { name: /^Nomination /u }),
    ).toHaveCount(0);
    await expect(
        dialog.getByRole("button", {
            name: "Delete this nomination: Item 1",
            exact: true,
        }),
    ).toBeEnabled();
    await expect(
        dialog.getByRole("button", { name: /^(?:Previous|Next) table$/u }),
    ).toHaveCount(0);
    await expect(article).toHaveValue("");
    await expect(firstTableTab).toBeVisible();
    await expect(secondTableTab).toBeVisible();
    await expect(firstTableTab).toHaveAttribute("aria-selected", "false");
    await expect(secondTableTab).toHaveAttribute("aria-selected", "true");
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.saves),
    ).toEqual([]);

    await article.fill("Second table article");
    await length.check();
    await score.fill("4");
    await firstTableTab.click();
    await expect(firstTableTab).toHaveAttribute("aria-selected", "true");
    await expect(secondTableTab).toHaveAttribute("aria-selected", "false");
    await expect(article).toHaveValue("First table article");
    await expect(score).toHaveValue("3");
    await article.fill("");
    await secondTableTab.click();
    await expect(article).toHaveValue("Second table article");
    await expect(score).toHaveValue("4");
    await capture(page, "nomination-table-tabs-en");
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(dialog.locator(".acga-dialog-error")).toBeVisible();
    await expect(dialog.getByRole("table")).toHaveCount(0);
    await expect(article).toHaveValue("");
    await expect(article).toBeFocused();
    await article.fill("First table article");
    await secondTableTab.click();
    await expect(article).toHaveValue("Second table article");
    await expect(score).toHaveValue("4");
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    const first = dialog.getByRole("table", {
        name: "Nomination table 1",
        exact: true,
    });
    const second = dialog.getByRole("table", {
        name: "Nomination table 2",
        exact: true,
    });
    await expect(dialog.getByRole("table")).toHaveCount(2);
    await expect(first.getByRole("row").nth(1).getByRole("cell")).toHaveText([
        "1",
        "First table article",
        "Example",
        "3 points",
        "1c",
        "",
    ]);
    await expect(second.getByRole("row").nth(1).getByRole("cell")).toHaveText([
        "1",
        "Second table article",
        "Example",
        "4 points",
        "1c[4]",
        "",
    ]);
    const groups = dialog.locator(".acga-nomination-table-summary");
    const firstComment = groups
        .nth(0)
        .locator(".acga-additional-message textarea");
    const secondComment = groups
        .nth(1)
        .locator(".acga-additional-message textarea");
    await firstComment.fill("Comment for the first table");
    await secondComment.fill("Comment for the second table");
    await first
        .getByRole("button", { name: "Edit nomination 1", exact: true })
        .click();
    const editor = page.getByRole("dialog", {
        name: "Edit nomination 1",
        exact: true,
    });
    await editor
        .getByRole("textbox", { name: "Recipient", exact: true })
        .fill("Earlier editor");
    await editor
        .locator(".acga-content-expansion-row")
        .getByRole("spinbutton", { name: "Score", exact: true })
        .fill("3.5");
    await editor
        .getByRole("button", { name: "Apply changes", exact: true })
        .click();
    await expect(page.locator(".acga-nomination-editor-dialog")).toBeHidden();
    await expect(first.getByRole("row").nth(1).getByRole("cell")).toHaveText([
        "1",
        "First table article",
        "Earlier editor",
        "3.5 points",
        "1c[3.5]",
        "",
    ]);
    await expect(firstComment).toHaveValue("Comment for the first table");
    await expect(secondComment).toHaveValue("Comment for the second table");
    await capture(page, "nomination-tables-en");
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.getByRole("dialog", {
        name: "Nomination preview",
        exact: true,
    });
    await expect(preview).toBeVisible();
    await expect(
        page
            .frameLocator('iframe[title="Nomination preview"]')
            .getByText("Fixture nomination preview", { exact: true }),
    ).toBeVisible();
    const expectedTables = [
        {
            comment: "Comment for the first table",
            nominations: [
                {
                    pageName: "First table article",
                    awarder: "Earlier editor",
                    ruleStatus: { "1c": { selected: true, score: 3.5 } },
                },
            ],
        },
        {
            comment: "Comment for the second table",
            nominations: [
                {
                    pageName: "Second table article",
                    awarder: "Example",
                    ruleStatus: { "1c": { selected: true, score: 4 } },
                },
            ],
        },
    ];
    expect(
        await page.evaluate(() => (window as any).acgaFixture.previews),
    ).toMatchObject([{ tables: expectedTables }]);
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.saves),
    ).toEqual([]);
    await preview.getByRole("button", { name: "Back", exact: true }).click();
    await expect(preview).toBeHidden();
    await expect(firstComment).toHaveValue("Comment for the first table");
    await expect(secondComment).toHaveValue("Comment for the second table");
    const summaryDialog = page.getByRole("dialog", {
        name: "Confirm Wiki ACG Award nominations",
        exact: true,
    });
    await summaryDialog
        .getByRole("button", { name: "Submit", exact: true })
        .click();
    await expect(summaryDialog).toBeHidden();
    const effects = await page.evaluate(
        () => (window as any).acgaFixture.effects,
    );
    expect(effects.saves).toHaveLength(1);
    expect(effects.saves[0]).toMatchObject({
        kind: "new",
        data: expectedTables,
    });
    expect(effects.errors).toEqual([]);
    expect(errors).toEqual([]);
});

test("table tabs restore active drafts and removing a group's last item preserves the remaining table", async ({
    page,
}) => {
    const errors = await mount(page, "en");
    await page.evaluate(() => {
        void (window as any).acgaFixture.dialogs.showNewNominationDialog();
    });
    const dialog = page.getByRole("dialog");
    const article = dialog.getByRole("textbox", {
        name: "Article title",
        exact: true,
    });
    const length = dialog.getByRole("checkbox", {
        name: "Scoring item 1 — Length",
        exact: true,
    });
    const score = dialog
        .locator(".acga-content-expansion-row")
        .getByRole("spinbutton", { name: "Score", exact: true });
    const add = dialog.getByRole("button", {
        name: "Add nomination",
        exact: true,
    });
    await article.fill("Original first table");
    await length.check();
    await add.click();
    await article.fill("First table second item");
    await length.check();
    await expect(
        dialog.getByRole("tab", { name: "Table 1", exact: true }),
    ).toBeVisible();
    await expect(dialog.getByRole("tab", { name: /^Table /u })).toHaveCount(1);
    await dialog
        .getByRole("button", { name: "Add table", exact: true })
        .click();
    await article.fill("Original second table");
    await length.check();
    await score.fill("4.5");
    await add.click();
    await expect(dialog.getByRole("tab", { name: /^Item /u })).toHaveText([
        "Item 1",
        "Item 2",
    ]);
    await article.fill("Temporary second table item");
    await dialog
        .getByRole("button", {
            name: "Delete this nomination: Item 2",
            exact: true,
        })
        .click();
    await expect(dialog.getByRole("tab", { name: /^Item /u })).toHaveCount(1);
    await expect(article).toHaveValue("Original second table");
    await expect(dialog.getByRole("tab", { name: /^Table /u })).toHaveText([
        "Table 1",
        "Table 2",
    ]);
    await expect(
        dialog.getByRole("tab", { name: "Table 2", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByRole("tab", { name: /^Item /u })).toHaveText([
        "Item 1",
    ]);
    await expect(article).toHaveValue("Original second table");
    await expect(score).toHaveValue("4.5");
    await dialog.getByRole("tab", { name: "Table 1", exact: true }).click();
    await expect(
        dialog.getByRole("tab", { name: "Item 2", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(article).toHaveValue("First table second item");
    await dialog.getByRole("tab", { name: "Item 1", exact: true }).click();
    await expect(article).toHaveValue("Original first table");
    await expect(score).toHaveValue("3");
    await dialog.getByRole("tab", { name: "Table 2", exact: true }).click();
    await expect(article).toHaveValue("Original second table");
    await dialog.getByRole("tab", { name: "Table 1", exact: true }).click();
    await expect(
        dialog.getByRole("tab", { name: "Item 1", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await dialog
        .getByRole("button", {
            name: "Delete this nomination: Item 1",
            exact: true,
        })
        .click();
    await expect(article).toHaveValue("First table second item");
    await dialog.getByRole("tab", { name: "Item 1", exact: true }).focus();
    await page.keyboard.press("Delete");
    await expect(dialog.getByRole("tab", { name: /^Table /u })).toHaveText([
        "Table 1",
    ]);
    await expect(dialog.getByRole("tab", { name: /^Item /u })).toHaveText([
        "Item 1",
    ]);
    await expect(article).toHaveValue("Original second table");
    await expect(score).toHaveValue("4.5");
    await expect(
        dialog.getByRole("button", {
            name: "Delete this nomination: Item 1",
            exact: true,
        }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    const table = dialog.getByRole("table", {
        name: "Nomination table 1",
        exact: true,
    });
    await expect(dialog.getByRole("table")).toHaveCount(1);
    await expect(table.getByRole("row").nth(1).getByRole("cell")).toHaveText([
        "1",
        "Original second table",
        "Example",
        "4.5 points",
        "1c[4.5]",
        "",
    ]);
    await dialog.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(dialog).toBeHidden();
    const effects = await page.evaluate(
        () => (window as any).acgaFixture.effects,
    );
    expect(effects.saves).toHaveLength(1);
    expect(effects.saves[0].data).toMatchObject([
        {
            comment: "",
            nominations: [
                {
                    pageName: "Original second table",
                    ruleStatus: { "1c": { score: 4.5, selected: true } },
                },
            ],
        },
    ]);
    expect(effects.errors).toEqual([]);
    expect(errors).toEqual([]);
});

test("canceling the nomination summary discards the batch without saving", async ({
    page,
}) => {
    const errors = await mount(page, "zh-Hans");
    await page.evaluate(() => {
        const fixture = (window as any).acgaFixture;
        void fixture.dialogs
            .showNewNominationDialog()
            .then((outcome: unknown) => (fixture.effects.outcome = outcome));
    });
    const dialog = page.getByRole("dialog");
    await dialog.locator(".acga-rule-page-name input").fill("示例条目");
    await dialog
        .getByRole("checkbox", { name: "得分项目1 — 篇幅", exact: true })
        .check();
    await dialog.getByRole("button", { name: "预览", exact: true }).click();
    await expect(dialog.getByRole("table")).toBeVisible();
    await dialog
        .locator(".acga-additional-message textarea")
        .fill("批量提名说明");
    await capture(page, "nomination-summary-zh");
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects),
    ).toEqual({ saves: [], errors: [], notices: [], outcome: "cancel" });
    expect(errors).toEqual([]);
});

test("current-registry duplicate notices follow the effective article and recipient", async ({
    page,
}) => {
    const registryUrl = "/wiki/Current_registry#2026-09-21";
    const errors = await mount(page, "en", {
        pageName: "Example article",
        deferredSuggestions: true,
        existingNominations: [
            {
                pageName: "Example article",
                awarder: "Leading editor",
                dateLabel: "2026-09-21",
                dateAnchor: "2026-09-21",
                reasonText: "1c 3",
                checked: true,
                url: registryUrl,
            },
        ],
    });
    await page.evaluate(() => {
        void (window as any).acgaFixture.dialogs.showNewNominationDialog();
    });
    const dialog = page.getByRole("dialog");
    const recipient = dialog.getByRole("textbox", {
        name: "Recipient",
        exact: true,
    });
    const article = dialog.getByRole("textbox", {
        name: "Article title",
        exact: true,
    });
    const notice = dialog.locator(".acga-existing-nomination");
    await expect(recipient).toHaveValue("");
    await expect(recipient).toHaveAttribute("placeholder", "...");
    await expect(article).toHaveValue("");
    await expect(article).toHaveAttribute("placeholder", "Example article");
    await expect(notice).toHaveCount(0);
    await page.evaluate(() =>
        (window as any).acgaFixture.resolveSuggestion(0, "Leading editor"),
    );
    await expect(recipient).toHaveValue("");
    await expect(recipient).toHaveAttribute("placeholder", "Leading editor");
    await expect(notice).toContainText("2026-09-21");
    await expect(notice).toContainText("Leading editor");
    await expect(notice).toContainText("1c 3");
    await expect(notice.locator(`a[href="${registryUrl}"]`)).toHaveCount(1);
    await expect(notice).toHaveAttribute("data-level", "warning");
    await expect(notice).toHaveClass(
        /acga-existing-nomination--same-recipient/u,
    );
    await capture(page, "nomination-duplicate-warning-en");
    await recipient.fill("Another editor");
    await expect(notice).toHaveCount(0);
    expect(
        await page.evaluate(
            () => (window as any).acgaFixture.existingNominationRequests,
        ),
    ).toEqual(["Example article"]);
    await article.fill("Different article");
    await expect(notice).toHaveCount(0);
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.saves),
    ).toEqual([]);
    expect(errors).toEqual([]);
});

test("checking warns about other registry requests while excluding the opened nomination", async ({
    page,
}) => {
    const base = {
        pageName: "Example article",
        awarder: "Example",
        date: "9月27日",
        dateLabel: "9月27日",
        dateAnchor: "9月27日",
        reasonText: "1c",
        checked: false,
        url: "/wiki/Registry#first",
    };
    const errors = await mount(page, "en", {
        existingNominations: [
            { ...base, index: 1, sectionOccurrence: 0 },
            {
                ...base,
                index: 1,
                sectionOccurrence: 1,
                checked: true,
                reasonText: "1c 3",
                url: "/wiki/Registry#second",
            },
            {
                ...base,
                index: 2,
                sectionOccurrence: 1,
                awarder: "Other",
                reasonText: "5x",
                url: "/wiki/Registry#third",
            },
        ],
    });
    await page.evaluate(() => {
        const global = window as any;
        void global.acgaFixture.dialogs.showCheckNominationDialog(
            global.AcgaTestUI.nomination("1c"),
            {
                type: "acg2",
                position: 1,
                date: "9月27日",
                index: 1,
                sectionOccurrence: 0,
            },
        );
    });
    const dialog = page.getByRole("dialog");
    const notices = dialog.locator(".acga-existing-nomination");
    await expect(notices).toHaveCount(1);
    await expect(notices.nth(0)).toHaveAttribute("data-level", "warning");
    await expect(notices.nth(0)).toContainText("1c 3");
    await expect(notices.nth(0)).toContainText("Reviewed");
    await expect(notices.nth(0).locator("a")).toHaveAttribute(
        "href",
        "/wiki/Registry#second",
    );
    await expect(dialog.locator('a[href="/wiki/Registry#third"]')).toHaveCount(
        0,
    );
    await expect(dialog.locator('a[href="/wiki/Registry#first"]')).toHaveCount(
        0,
    );
    await expect(
        dialog.getByRole("button", { name: "Save", exact: true }),
    ).toBeEnabled();
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.saves),
    ).toEqual([]);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    expect(errors).toEqual([]);
});

test("recipient suggestions stay in placeholders and follow article and category changes", async ({
    page,
}) => {
    const errors = await mount(page, "en", {
        pageName: "Example article",
        deferredSuggestions: true,
    });
    await page.evaluate(() => {
        void (window as any).acgaFixture.dialogs.showNewNominationDialog();
    });
    const dialog = page.getByRole("dialog");
    const recipient = dialog.getByRole("textbox", {
        name: "Recipient",
        exact: true,
    });
    const add = dialog.getByRole("button", {
        name: "Add nomination",
        exact: true,
    });
    await expect(recipient).toHaveValue("");
    await expect(recipient).toHaveAttribute("placeholder", "...");
    await recipient.fill("Chosen editor");
    await page.evaluate(() =>
        (window as any).acgaFixture.resolveSuggestion(0, "Leading editor"),
    );
    await expect(recipient).toHaveValue("Chosen editor");
    await dialog.getByRole("button", { name: /^\(5\)/u }).click();
    await expect(recipient).toHaveValue("Chosen editor");
    await expect(recipient).toHaveAttribute("placeholder", "Example");
    await dialog.getByRole("button", { name: /^\(1–4\)/u }).click();
    await expect(recipient).toHaveValue("Chosen editor");
    await expect(recipient).toHaveAttribute("placeholder", "Leading editor");

    await dialog
        .getByRole("checkbox", { name: "Scoring item 1 — Length", exact: true })
        .check();
    await add.click();
    await dialog
        .getByRole("textbox", { name: "Article title", exact: true })
        .fill("Different article");
    await page.evaluate(() =>
        (window as any).acgaFixture.resolveSuggestion(1, "Leading editor"),
    );
    await expect(recipient).toHaveValue("");
    await expect(recipient).toHaveAttribute("placeholder", "Example");
    await dialog
        .getByRole("textbox", { name: "Article title", exact: true })
        .fill("");
    await expect(
        dialog.getByRole("textbox", { name: "Article title", exact: true }),
    ).toHaveAttribute("placeholder", "Example article");
    await expect(recipient).toHaveAttribute("placeholder", "Leading editor");

    await dialog
        .getByRole("checkbox", { name: "Scoring item 1 — Length", exact: true })
        .check();
    await add.click();
    await dialog.getByRole("button", { name: /^\(5\)/u }).click();
    await page.evaluate(() =>
        (window as any).acgaFixture.resolveSuggestion(2, "Leading editor"),
    );
    await expect(recipient).toHaveValue("");
    await expect(recipient).toHaveAttribute("placeholder", "Example");
    await dialog.getByRole("button", { name: /^\(1–4\)/u }).click();
    await expect(recipient).toHaveValue("");
    await expect(recipient).toHaveAttribute("placeholder", "Leading editor");
    expect(
        await page.evaluate(() =>
            (window as any).acgaFixture.suggestionRequests.map(
                (request: { pageName: string }) => request.pageName,
            ),
        ),
    ).toEqual(["Example article", "Example article", "Example article"]);
    expect(errors).toEqual([]);
});

test("recipient suggestions resolve for stored drafts after switching tables", async ({
    page,
}) => {
    const errors = await mount(page, "en", {
        pageName: "Example article",
        deferredSuggestions: true,
    });
    await page.evaluate(() => {
        void (window as any).acgaFixture.dialogs.showNewNominationDialog();
    });
    const dialog = page.getByRole("dialog");
    const recipient = dialog.getByRole("textbox", {
        name: "Recipient",
        exact: true,
    });
    const length = dialog.getByRole("checkbox", {
        name: "Scoring item 1 — Length",
        exact: true,
    });
    await recipient.fill("Temporary recipient");
    await length.check();
    expect(
        await page.evaluate(
            () => (window as any).acgaFixture.suggestionRequests.length,
        ),
    ).toBe(1);
    await dialog
        .getByRole("button", { name: "Add table", exact: true })
        .click();
    await length.check();
    await dialog.getByRole("tab", { name: "Table 1", exact: true }).click();
    await recipient.fill("");
    await page.evaluate(() =>
        (window as any).acgaFixture.resolveSuggestion(1, "Later table editor"),
    );
    await expect(recipient).toHaveValue("");
    await expect(recipient).toHaveAttribute("placeholder", "...");
    await page.evaluate(() =>
        (window as any).acgaFixture.resolveSuggestion(
            0,
            "Earlier table editor",
        ),
    );
    await expect(recipient).toHaveAttribute(
        "placeholder",
        "Earlier table editor",
    );
    await dialog.getByRole("tab", { name: "Table 2", exact: true }).click();
    await expect(recipient).toHaveValue("");
    await expect(recipient).toHaveAttribute(
        "placeholder",
        "Later table editor",
    );
    expect(
        await page.evaluate(
            () => (window as any).acgaFixture.suggestionRequests.length,
        ),
    ).toBe(2);
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(
        dialog
            .getByRole("table", { name: "Nomination table 1", exact: true })
            .getByRole("cell", { name: "Earlier table editor", exact: true }),
    ).toBeVisible();
    await expect(
        dialog
            .getByRole("table", { name: "Nomination table 2", exact: true })
            .getByRole("cell", { name: "Later table editor", exact: true }),
    ).toBeVisible();
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.saves),
    ).toEqual([]);
    expect(errors).toEqual([]);
});

test("a closed dialog's recipient suggestion cannot change a reopened draft", async ({
    page,
}) => {
    const errors = await mount(page, "en", {
        pageName: "Example article",
        deferredSuggestions: true,
    });
    await page.evaluate(() => {
        void (window as any).acgaFixture.dialogs.showNewNominationDialog();
    });
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.evaluate(() => {
        void (window as any).acgaFixture.dialogs.showNewNominationDialog();
    });
    const recipient = dialog.getByRole("textbox", {
        name: "Recipient",
        exact: true,
    });
    await page.evaluate(() =>
        (window as any).acgaFixture.resolveSuggestion(0, "Stale editor"),
    );
    await expect(recipient).toHaveValue("");
    await expect(recipient).toHaveAttribute("placeholder", "...");
    await page.evaluate(() =>
        (window as any).acgaFixture.resolveSuggestion(1, "Current editor"),
    );
    await expect(recipient).toHaveValue("");
    await expect(recipient).toHaveAttribute("placeholder", "Current editor");
    await recipient.fill("   ");
    await dialog
        .getByRole("checkbox", { name: "Scoring item 1 — Length", exact: true })
        .check();
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(
        dialog
            .getByRole("table", { name: "Nomination table 1", exact: true })
            .getByRole("cell", { name: "Current editor", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(dialog).toBeHidden();
    const effects = await page.evaluate(
        () => (window as any).acgaFixture.effects,
    );
    expect(effects.saves).toHaveLength(1);
    expect(effects.saves[0].data[0].nominations[0].awarder).toBe(
        "Current editor",
    );
    expect(effects.saves[0].data[0].nominations[0].pageName).toBe(
        "Example article",
    );
    expect(errors).toEqual([]);
});

test("nominations without article context do not request recipient suggestions", async ({
    page,
}) => {
    const errors = await mount(page, "en", { deferredSuggestions: true });
    await page.evaluate(() => {
        void (window as any).acgaFixture.dialogs.showNewNominationDialog();
    });
    const dialog = page.getByRole("dialog");
    await dialog
        .getByRole("textbox", { name: "Article title", exact: true })
        .fill("Explicit article");
    await dialog
        .getByRole("checkbox", { name: "Scoring item 1 — Length", exact: true })
        .check();
    await dialog
        .getByRole("button", { name: "Add nomination", exact: true })
        .click();
    const recipient = dialog.getByRole("textbox", {
        name: "Recipient",
        exact: true,
    });
    await expect(recipient).toHaveValue("");
    await expect(recipient).toHaveAttribute("placeholder", "Example");
    await expect(
        dialog.getByRole("tab", { name: "Item 2", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
        await page.evaluate(
            () => (window as any).acgaFixture.suggestionRequests.length,
        ),
    ).toBe(0);
    expect(errors).toEqual([]);
});

test("single checking preselects scoring item boxes and saves a manual rejection", async ({
    page,
}) => {
    const errors = await mount(page, "en");
    await page.evaluate(() => {
        const global = window as any;
        void global.acgaFixture.dialogs.showCheckNominationDialog(
            {
                ...global.AcgaTestUI.nomination("1c 2-c 3 4-dyk"),
                checkWikitext: "{{ACG提名2/check|ver=1|}}",
            },
            { type: "acg2", position: 1 },
        );
    });
    const dialog = page.getByRole("dialog");
    const choices = dialog.locator(
        '.acga-check-table tbody input[type="checkbox"]',
    );
    await expect(choices).toHaveCount(4);
    for (const choice of await choices.all())
        await expect(choice).toBeChecked();
    await expect(
        dialog.getByRole("checkbox", { name: "Select all rows", exact: true }),
    ).toBeChecked();
    await capture(page, "check-default-selected");
    await choices.nth(1).uncheck();
    await expect(choices.nth(0)).toBeChecked();
    await expect(choices.nth(1)).not.toBeChecked();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
    const effects = await page.evaluate(
        () => (window as any).acgaFixture.effects,
    );
    expect(effects.saves).toHaveLength(1);
    expect(
        effects.saves[0].data.ruleTokens.map((token: any) => token.selected),
    ).toEqual([true, false, true, true]);
    expect(effects.errors).toEqual([]);
    expect(errors).toEqual([]);
});

test("batch checking preselects each fresh item's scoring boxes and retains deselection across navigation", async ({
    page,
}) => {
    const errors = await mount(page, "en");
    await page.evaluate(() => {
        const global = window as any;
        void global.acgaFixture.dialogs.showCheckBatchDialog(
            ["First article", "Second article"].map((title, index) => ({
                nomination: {
                    ...global.AcgaTestUI.nomination("1c 2-c 3 4-dyk", title),
                    checkWikitext:
                        index === 0
                            ? "<!-- 尚未核對 -->"
                            : "{{ACG提名2/check|ver=1|}}",
                },
                target: { type: "acg2", position: index + 1 },
                tableKey: `table-${index}`,
                tableIndex: index,
            })),
        );
    });
    const dialog = page.getByRole("dialog");
    const choices = dialog.locator(
        '.acga-check-table tbody input[type="checkbox"]',
    );
    await expect(choices).toHaveCount(4);
    for (const choice of await choices.all())
        await expect(choice).toBeChecked();
    await expect(
        dialog.getByRole("checkbox", { name: "Select all rows", exact: true }),
    ).toBeChecked();
    await capture(page, "check-batch-default-selected");
    await choices.nth(1).uncheck();
    await dialog
        .getByRole("tab", { name: "Item 2 · Pending", exact: true })
        .click();
    for (const choice of await choices.all())
        await expect(choice).toBeChecked();
    await dialog.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(choices.nth(0)).toBeChecked();
    await expect(choices.nth(1)).not.toBeChecked();
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    for (const choice of await choices.all())
        await expect(choice).toBeChecked();
    await dialog.getByRole("button", { name: "Save all", exact: true }).click();
    await expect(dialog).toBeHidden();
    const fixture = await page.evaluate(() => ({
        effects: (window as any).acgaFixture.effects,
        completions: (window as any).acgaFixture.checkBatchEffects.completions,
    }));
    expect(fixture.completions).toHaveLength(1);
    expect(
        fixture.completions[0].map((save: any) =>
            save.data.ruleTokens.map((token: any) => token.selected),
        ),
    ).toEqual([
        [true, false, true, true],
        [true, true, true, true],
    ]);
    expect(fixture.effects.errors).toEqual([]);
    expect(errors).toEqual([]);
});

test("rechecking preserves saved rejected scoring boxes instead of selecting them by default", async ({
    page,
}) => {
    const errors = await mount(page, "en");
    await page.evaluate(() => {
        const global = window as any;
        void global.acgaFixture.dialogs.showCheckNominationDialog(
            {
                ...global.AcgaTestUI.nomination("1a 3"),
                checkWikitext: "{{ACG提名2/check|ver=1|1a|no=3}}Reviewed--~~~~",
            },
            { type: "acg2", position: 1 },
        );
    });
    const dialog = page.getByRole("dialog");
    const choices = dialog.locator(
        '.acga-check-table tbody input[type="checkbox"]',
    );
    await expect(choices).toHaveCount(2);
    await expect(choices.nth(0)).toBeChecked();
    await expect(choices.nth(1)).not.toBeChecked();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.saves),
    ).toEqual([]);
    expect(errors).toEqual([]);
});

test("checking renders source as text and submits edited score once", async ({
    page,
}) => {
    const errors = await mount(page);
    await page.evaluate(() => {
        const global = window as any;
        const data = global.AcgaTestUI.nomination(
            "1a",
            '<img src=x onerror="window.unsafe=true">',
        );
        void global.acgaFixture.dialogs.showCheckNominationDialog(data, {
            type: "acg2",
            position: 1,
        });
    });
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveAccessibleName("核對維基ACG專題獎");
    await expect(dialog.locator(".cdx-dialog__header__title")).toHaveText(
        "核對維基ACG專題獎",
    );
    await expect(dialog).toContainText(
        '<img src=x onerror="window.unsafe=true">',
    );
    await expect(dialog.locator("img")).toHaveCount(0);
    await expect(dialog.locator(".acga-rule-category-fieldset")).toHaveCount(0);
    await expect(dialog.locator(".acga-check-add-item")).toHaveCount(0);
    const addRow = dialog.locator(".acga-check-add-row");
    await expect(addRow).toBeVisible();
    await expect(addRow.getByRole("checkbox")).toHaveCount(0);
    const score = dialog.getByRole("spinbutton", {
        name: "1a 得分",
        exact: true,
    });
    const originalScore = await score.inputValue();
    await addRow.getByRole("combobox").click();
    await addRow
        .locator(".cdx-menu-item__text__label")
        .filter({ hasText: /^3$/u })
        .click();
    await expect(addRow).toBeVisible();
    await expect(addRow.getByRole("combobox")).toHaveText("");
    await expect(addRow.getByRole("combobox")).toHaveAccessibleName(
        "新增項目代碼",
    );
    await dialog
        .getByRole("spinbutton", { name: "3 得分", exact: true })
        .fill("0.5");
    await score.fill("1.5");
    const reset = dialog.locator(".cdx-table__header .acga-check-reset");
    await expect(reset).toBeVisible();
    await expect(reset).toHaveClass(/cdx-button--weight-quiet/u);
    await expect(reset).toHaveClass(/cdx-button--action-default/u);
    await reset.click();
    await expect(score).toHaveValue(originalScore);
    await expect(
        dialog.getByRole("spinbutton", { name: "3 得分", exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: "復原", exact: true }).click();
    await expect(score).toHaveValue("1.5");
    await expect(
        dialog.getByRole("spinbutton", { name: "3 得分", exact: true }),
    ).toHaveValue("0.5");
    await dialog.getByRole("button", { name: "重做", exact: true }).click();
    await expect(score).toHaveValue(originalScore);
    await expect(
        dialog.getByRole("spinbutton", { name: "3 得分", exact: true }),
    ).toHaveCount(0);
    await expect(addRow).toBeVisible();
    await addRow.getByRole("combobox").click();
    await addRow
        .locator(".cdx-menu-item__text__label")
        .filter({ hasText: /^3$/u })
        .click();
    await dialog
        .getByRole("spinbutton", { name: "3 得分", exact: true })
        .fill("0.5");
    await score.fill("1.5");
    await dialog.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(dialog).toBeHidden();
    const effects = await page.evaluate(
        () => (window as any).acgaFixture.effects,
    );
    expect(effects.saves).toHaveLength(1);
    expect(effects.saves[0].kind).toBe("check");
    expect(effects.saves[0].data.ruleTokens[0].score).toBe(1.5);
    expect(effects.saves[0].data.ruleTokens).toHaveLength(2);
    expect(effects.saves[0].data.ruleTokens[1]).toMatchObject({
        code: "3",
        score: 0.5,
    });
    expect(effects.errors).toEqual([]);
    expect(errors).toEqual([]);
});

test("checking row icons and table-footer comments support undo and redo", async ({
    page,
}) => {
    const errors = await mount(page);
    await page.evaluate(() => {
        const global = window as any;
        void global.acgaFixture.dialogs.showCheckNominationDialog(
            global.AcgaTestUI.nomination("1a 3"),
            { type: "acg2", position: 1 },
        );
    });
    const dialog = page.getByRole("dialog");
    const table = dialog.locator(".acga-check-table");
    const header = table.locator(".cdx-table__header");
    const undo = header.getByRole("button", { name: "復原", exact: true });
    const redo = header.getByRole("button", { name: "重做", exact: true });
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
    for (const button of [undo, redo]) {
        await expect(button).toHaveText("");
        await expect(button.locator("svg")).toHaveCount(1);
        await expect(button).toHaveClass(/cdx-button--weight-quiet/u);
    }

    const score = table.getByRole("spinbutton", {
        name: "1a 得分",
        exact: true,
    });
    const description = table.getByRole("textbox", {
        name: "1a 描述",
        exact: true,
    });
    const rowReset = table.getByRole("button", {
        name: "1a 重設項目",
        exact: true,
    });
    const remove = table.getByRole("button", {
        name: "3 刪除項目",
        exact: true,
    });
    const originalScore = await score.inputValue();
    const originalDescription = await description.inputValue();
    for (const button of [rowReset, remove]) {
        await expect(button).toHaveText("");
        await expect(button.locator("svg")).toHaveCount(1);
        await expect(button).toHaveClass(/cdx-button--weight-quiet/u);
    }
    await expect(remove).toHaveClass(/cdx-button--action-default/u);
    await expect(
        rowReset.locator(
            "xpath=following-sibling::button[contains(@class, 'acga-check-item-delete')]",
        ),
    ).toHaveCount(1);

    await score.fill("1.5");
    await undo.click();
    await expect(score).toHaveValue(originalScore);
    await expect(undo).toBeDisabled();
    await redo.click();
    await expect(score).toHaveValue("1.5");
    await expect(redo).toBeDisabled();
    await description.fill("核對後的自訂說明");
    await rowReset.click();
    await expect(score).toHaveValue(originalScore);
    await expect(description).toHaveValue(originalDescription);
    await undo.click();
    await expect(score).toHaveValue("1.5");
    await expect(description).toHaveValue("核對後的自訂說明");
    await redo.click();
    await expect(score).toHaveValue(originalScore);
    await expect(description).toHaveValue(originalDescription);

    const thirdScore = table.getByRole("spinbutton", {
        name: "3 得分",
        exact: true,
    });
    await remove.click();
    await expect(thirdScore).toHaveCount(0);
    await undo.click();
    await expect(thirdScore).toBeVisible();
    await redo.click();
    await expect(thirdScore).toHaveCount(0);
    await undo.click();
    await expect(thirdScore).toBeVisible();

    const footer = table.locator(".cdx-table__footer");
    const comment = footer.locator(".acga-additional-message textarea");
    const preview = dialog.locator(".acga-code-preview-text textarea");
    await expect(footer).toContainText("附加說明");
    await expect(dialog.locator(".acga-additional-message")).toHaveCount(1);
    await comment.fill("表格頁腳的核對說明");
    await expect(preview).toHaveValue(/表格頁腳的核對說明/u);
    await expect(redo).toBeDisabled();
    await undo.click();
    await expect(comment).toHaveValue("");
    await expect(preview).not.toHaveValue(/表格頁腳的核對說明/u);
    await redo.click();
    await expect(comment).toHaveValue("表格頁腳的核對說明");
    await expect(preview).toHaveValue(/表格頁腳的核對說明/u);
    await capture(page, "check-history-and-footer-zh");
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.saves),
    ).toEqual([]);
    await dialog.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(dialog).toBeHidden();
    const effects = await page.evaluate(
        () => (window as any).acgaFixture.effects,
    );
    expect(effects.saves).toHaveLength(1);
    expect(effects.saves[0].data.message).toBe("表格頁腳的核對說明");
    expect(effects.saves[0].data.ruleTokens).toHaveLength(2);
    expect(effects.errors).toEqual([]);
    expect(errors).toEqual([]);
});

async function openCheckBatch(page: Page) {
    await page.evaluate(() => {
        const global = window as any;
        const fixture = global.acgaFixture;
        void fixture.dialogs
            .showCheckBatchDialog([
                {
                    nomination: global.AcgaTestUI.nomination(
                        "1a",
                        "First article",
                    ),
                    target: { type: "acg2", position: 1 },
                    tableKey: "table-one",
                    tableIndex: 0,
                },
                {
                    nomination: global.AcgaTestUI.nomination(
                        "1a",
                        "Second article",
                    ),
                    target: { type: "acg2", position: 2 },
                    tableKey: "table-one",
                    tableIndex: 0,
                },
                {
                    nomination: global.AcgaTestUI.nomination(
                        "1a",
                        "Third article",
                    ),
                    target: { type: "acg2", position: 3 },
                    tableKey: "table-two",
                    tableIndex: 1,
                },
            ])
            .then((outcome: unknown) => (fixture.effects.outcome = outcome));
    });
    await expect(page.getByRole("dialog")).toBeVisible();
}

test("flat batch checking tabs retain drafts and history across tables while staging each accepted item once", async ({
    page,
}) => {
    const errors = await mount(page);
    await openCheckBatch(page);
    const dialog = page.getByRole("dialog");
    const items = dialog.locator(".acga-check-item-tabs");
    const expectActiveTab = async (itemNumber: number) => {
        for (const number of [1, 2, 3]) {
            await expect(
                items.getByRole("tab").filter({
                    hasText: new RegExp(`^項目${number} ·`, "u"),
                }),
            ).toHaveAttribute("aria-selected", String(number === itemNumber));
        }
        await expect(
            items.locator('[role="tab"][aria-selected="true"]'),
        ).toHaveCount(1);
    };
    await expect(dialog.getByRole("tablist")).toHaveCount(1);
    await expect(dialog.locator(".cdx-tabs")).toHaveCount(1);
    await expect(dialog.locator(".acga-check-table-tabs")).toHaveCount(0);
    await expect(items).not.toHaveClass(/cdx-tabs--framed/u);
    await expectActiveTab(1);
    await expect(items.getByRole("tab")).toHaveText([
        "項目1 · 待核對",
        "項目2 · 待核對",
        "項目3 · 待核對",
    ]);
    const footer = dialog.locator(".acga-dialog-footer");
    const previous = footer.getByRole("button", {
        name: "上一項",
        exact: true,
    });
    const next = footer.getByRole("button", { name: "下一項", exact: true });
    const skip = footer.getByRole("button", { name: "暫不核對", exact: true });
    const cancel = footer.getByRole("button", { name: "取消", exact: true });
    await expect(previous).toBeDisabled();
    await expect(previous).toHaveClass(/cdx-button--weight-quiet/u);
    await expect(previous).toHaveClass(/cdx-button--action-default/u);
    await expect(skip).toHaveClass(/cdx-button--weight-normal/u);
    await expect(skip).toHaveClass(/cdx-button--action-default/u);
    await expect(cancel).toHaveClass(/cdx-button--weight-quiet/u);
    await expect(cancel).toHaveClass(/cdx-button--action-default/u);
    await expect(next).toHaveClass(/cdx-button--weight-primary/u);
    await expect(next).toHaveClass(/cdx-button--action-progressive/u);
    await expect(footer.getByRole("button")).toHaveText([
        "取消",
        "上一項",
        "暫不核對",
        "下一項",
    ]);
    const score = dialog.getByRole("spinbutton", {
        name: "1a 得分",
        exact: true,
    });
    const comment = dialog.locator(
        ".cdx-table__footer .acga-additional-message textarea",
    );
    const undo = dialog.getByRole("button", { name: "復原", exact: true });
    const redo = dialog.getByRole("button", { name: "重做", exact: true });
    await score.fill("1.5");
    await comment.fill("第一項的核對說明");
    await items
        .getByRole("tab", { name: "項目3 · 待核對", exact: true })
        .click();
    await expectActiveTab(3);
    await expect(dialog.locator(".acga-check-summary")).toContainText(
        "Third article",
    );
    await expect(comment).toHaveValue("");
    await expect(undo).toBeDisabled();
    await score.fill("2.5");
    await comment.fill("第三項的核對說明");
    await items
        .getByRole("tab", { name: "項目1 · 待核對", exact: true })
        .click();
    await expectActiveTab(1);
    await expect(score).toHaveValue("1.5");
    await expect(comment).toHaveValue("第一項的核對說明");
    await undo.click();
    await expect(comment).toHaveValue("");
    await expect(score).toHaveValue("1.5");
    await redo.click();
    await expect(comment).toHaveValue("第一項的核對說明");
    await items
        .getByRole("tab", { name: "項目2 · 待核對", exact: true })
        .click();
    await expectActiveTab(2);
    await expect(dialog.locator(".acga-check-summary")).toContainText(
        "Second article",
    );
    await expect(comment).toHaveValue("");
    await expect(undo).toBeDisabled();
    await score.fill("0.5");
    await previous.click();
    await expectActiveTab(1);
    await expect(score).toHaveValue("1.5");
    await next.click();
    await expectActiveTab(2);
    await expect(score).toHaveValue("0.5");
    await expect(
        items.getByRole("tab", { name: "項目1 · 已核對", exact: true }),
    ).toBeVisible();
    await previous.click();
    await expectActiveTab(1);
    await next.click();
    await expectActiveTab(2);
    await expect(score).toHaveValue("0.5");
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.saves),
    ).toHaveLength(1);
    await previous.click();
    await expectActiveTab(1);
    await skip.click();
    await expectActiveTab(2);
    await expect(
        items.getByRole("tab", { name: "項目1 · 暫不核對", exact: true }),
    ).toBeVisible();
    await next.click();
    await expectActiveTab(3);
    await expect(dialog.locator(".acga-check-summary")).toContainText(
        "Third article",
    );
    await expect(score).toHaveValue("2.5");
    await expect(comment).toHaveValue("第三項的核對說明");
    await capture(page, "check-batch-navigation-zh");
    await footer.getByRole("button", { name: "儲存全部", exact: true }).click();
    await expect(dialog).toBeHidden();
    const { effects, checkBatchEffects } = await page.evaluate(() => {
        const fixture = (window as any).acgaFixture;
        return {
            effects: fixture.effects,
            checkBatchEffects: fixture.checkBatchEffects,
        };
    });
    expect(effects.outcome).toBe("save");
    expect(effects.saves.map((save: any) => save.target.position)).toEqual([
        1, 2, 3,
    ]);
    expect(checkBatchEffects.discards).toEqual([{ type: "acg2", position: 1 }]);
    expect(checkBatchEffects.completions).toHaveLength(1);
    expect(
        checkBatchEffects.completions[0].map(
            (save: any) => save.target.position,
        ),
    ).toEqual([2, 3]);
    expect(checkBatchEffects.completions[0][0].data.ruleTokens[0].score).toBe(
        0.5,
    );
    expect(checkBatchEffects.completions[0][1].data.message).toBe(
        "第三項的核對說明",
    );
    expect(effects.errors).toEqual([]);
    expect(errors).toEqual([]);
});

test("batch checking cancel closes without submitting staged results", async ({
    page,
}) => {
    const errors = await mount(page);
    await openCheckBatch(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "下一項", exact: true }).click();
    await expect(dialog.locator(".acga-check-summary")).toContainText(
        "Second article",
    );
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toBeHidden();
    const { effects, checkBatchEffects } = await page.evaluate(() => {
        const fixture = (window as any).acgaFixture;
        return {
            effects: fixture.effects,
            checkBatchEffects: fixture.checkBatchEffects,
        };
    });
    expect(effects.saves).toHaveLength(1);
    expect(effects.outcome).toBe("cancel");
    expect(checkBatchEffects.completions).toEqual([]);
    expect(effects.errors).toEqual([]);
    expect(errors).toEqual([]);
});

test("deferring the remaining batch items submits only completed rows", async ({
    page,
}) => {
    const errors = await mount(page);
    await openCheckBatch(page);
    const dialog = page.getByRole("dialog");
    await dialog
        .getByRole("spinbutton", { name: "1a 得分", exact: true })
        .fill("1.5");
    await dialog.getByRole("button", { name: "下一項", exact: true }).click();
    await expect(dialog.locator(".acga-check-summary")).toContainText(
        "Second article",
    );
    await dialog
        .getByRole("spinbutton", { name: "1a 得分", exact: true })
        .fill("0.5");
    await dialog.getByRole("button", { name: "暫不核對", exact: true }).click();
    await expect(dialog.locator(".acga-check-summary")).toContainText(
        "Third article",
    );
    await dialog.getByRole("button", { name: "暫不核對", exact: true }).click();
    await expect(dialog).toBeHidden();
    const { effects, checkBatchEffects } = await page.evaluate(() => {
        const fixture = (window as any).acgaFixture;
        return {
            effects: fixture.effects,
            checkBatchEffects: fixture.checkBatchEffects,
        };
    });
    expect(effects.saves).toHaveLength(1);
    expect(effects.outcome).toBe("save");
    expect(checkBatchEffects.completions).toHaveLength(1);
    expect(checkBatchEffects.completions[0]).toHaveLength(1);
    expect(checkBatchEffects.completions[0][0].target.position).toBe(1);
    expect(checkBatchEffects.completions[0][0].data.ruleTokens[0].score).toBe(
        1.5,
    );
    expect(effects.errors).toEqual([]);
    expect(errors).toEqual([]);
});

test("mobile dialog stays within the viewport and disposal releases its host", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors = await mount(page);
    await page.evaluate(() => {
        const fixture = (window as any).acgaFixture;
        void fixture.dialogs
            .showNewNominationDialog()
            .then((outcome: unknown) => (fixture.effects.outcome = outcome));
    });
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await expect(
        dialog.getByRole("button", { name: "取消", exact: true }),
    ).toBeInViewport();
    await page.evaluate(() => (window as any).acgaFixture.dialogs.dispose());
    await expect(page.locator(".acga-tool-dialog-host")).toHaveCount(0);
    await expect(page.locator("style[data-acga-fixture]")).toHaveCount(0);
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.outcome),
    ).toBe("cancel");
    expect(errors).toEqual([]);
});

test("confirmation Escape resolves cancellation without save operations", async ({
    page,
}) => {
    const errors = await mount(page);
    await page.evaluate(() => {
        const fixture = (window as any).acgaFixture;
        void fixture.dialogs
            .showConfirmDialog({
                title: "移除提名",
                message: "確認移除此提名？",
                primaryLabel: "移除",
            })
            .then((outcome: unknown) => (fixture.effects.outcome = outcome));
    });
    await expect(page.getByRole("dialog")).toHaveAccessibleName("移除提名");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects),
    ).toEqual({ saves: [], errors: [], notices: [], outcome: false });
    expect(errors).toEqual([]);
});

test("review presets and exclusive modes produce specialist and comprehensive summaries", async ({
    page,
}) => {
    const errors = await mount(page);
    await page.evaluate(() => {
        void (window as any).acgaFixture.dialogs.showNewNominationDialog();
    });
    const dialog = page.getByRole("dialog");
    await dialog
        .getByRole("textbox", { name: "條目名", exact: true })
        .fill("評審條目");
    await dialog.getByRole("button", { name: /^\(5\)/u }).click();
    const tiers = dialog.getByRole("group", { name: /^初選評審等級/u });
    await expect(
        tiers.getByText("用於預選下方「得分項目」。", { exact: true }),
    ).toBeVisible();
    await expect(tiers.getByRole("radio")).toHaveCount(5);
    await expect(
        tiers.getByRole("radio", { name: "通用", exact: true }),
    ).toBeChecked();
    await expect(
        dialog.getByRole("button", { name: "一般評審", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByText("評審模式", { exact: true })).toHaveCount(0);
    const general = dialog.locator('[data-review-row="general"]');
    await expect(general.getByRole("combobox")).toHaveValue("通用評審");
    await expect(
        dialog.getByRole("checkbox", { name: "行文", exact: true }),
    ).toHaveCount(0);
    const score = dialog.getByRole("spinbutton", {
        name: "評審得分",
        exact: true,
    });
    await expect(score).toBeVisible();
    for (const [name, title] of [
        ["減少得分：評審得分", "減0.5分"],
        ["增加得分：評審得分", "加0.5分"],
    ] as const) {
        const button = dialog.getByRole("button", { name, exact: true });
        await expect(button).toHaveAttribute("title", title);
        await expect(button).toHaveClass(
            /(?=.*cdx-button--weight-normal)(?=.*cdx-button--action-default)/u,
        );
    }
    await expect(dialog.locator(".acga-review-custom-score")).toHaveCount(0);
    await tiers.getByRole("radio", { name: "甲級", exact: true }).check();
    await expect(general.getByRole("combobox")).toHaveValue("甲級評審");
    await expect(score).toHaveValue("2");
    await dialog.getByRole("checkbox", { name: "快評", exact: true }).check();
    await expect(score).toHaveValue("1");
    await capture(page, "score-steppers-zh");
    await dialog.getByRole("button", { name: "專項評審", exact: true }).click();
    await expect(
        dialog.getByRole("button", { name: "專項評審", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
        dialog.getByRole("button", { name: "一般評審", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(general).toHaveCount(0);
    await tiers.getByRole("radio", { name: "通用", exact: true }).check();
    const writing = dialog.locator('[data-review-row="writing"]');
    const coverage = dialog.locator('[data-review-row="coverage"]');
    const source = dialog.locator('[data-review-row="source"]');
    for (const [row, label] of [
        [writing, "行文"],
        [coverage, "內容"],
        [source, "來源"],
    ] as const) {
        await expect(row.getByRole("combobox")).toBeDisabled();
        await row.getByRole("checkbox", { name: label, exact: true }).check();
        await expect(row.getByRole("combobox")).toBeEnabled();
    }
    await writing.getByRole("combobox").fill("優良級評審");
    await source.getByRole("combobox").fill("典範評審");
    await source.getByRole("checkbox", { name: "快評", exact: true }).check();
    await expect(
        dialog.locator(".acga-code-preview-text textarea"),
    ).toHaveValue(/5b 5a-gan 5c-fac-half/u);
    await capture(page, "review-specialist-zh");
    await dialog.getByRole("button", { name: "預覽", exact: true }).click();
    const table = dialog.getByRole("table");
    await expect(table.getByRole("row").nth(1).getByRole("cell")).toHaveText([
        "1",
        "評審條目",
        "Example",
        "3分",
        "5b 5a-gan 5c-fac-half",
        "",
    ]);
    await dialog.getByRole("button", { name: "返回", exact: true }).click();
    await dialog.getByRole("button", { name: "綜合評審", exact: true }).click();
    await expect(dialog.locator(".acga-review-item-row")).toHaveCount(1);
    await tiers.getByRole("radio", { name: "乙級", exact: true }).check();
    const complete = dialog.locator('[data-review-row="complete"]');
    await expect(complete.getByRole("combobox")).toHaveValue("乙級評審");
    await expect(
        complete.getByRole("checkbox", { name: "快評", exact: true }),
    ).toHaveCount(0);
    await expect(complete.getByRole("spinbutton")).toHaveValue("3");
    await complete.getByRole("combobox").fill("自訂綜合評審");
    await complete.getByRole("spinbutton").fill("2.5");
    await capture(page, "review-comprehensive-zh");
    await dialog.getByRole("button", { name: "預覽", exact: true }).click();
    await expect(table.getByRole("row").nth(1).getByRole("cell")).toHaveText([
        "1",
        "評審條目",
        "Example",
        "2.5分",
        "5x-bcr(自訂綜合評審)[2.5]",
        "",
    ]);
    await dialog.getByRole("button", { name: "關閉", exact: true }).click();
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.saves),
    ).toEqual([]);
    expect(errors).toEqual([]);
});

test("reenabling content expansion restores the score shown in the source preview", async ({
    page,
}) => {
    const errors = await mount(page, "en");
    await page.evaluate(() => {
        void (window as any).acgaFixture.dialogs.showNewNominationDialog();
    });
    const dialog = page.getByRole("dialog");
    await dialog
        .getByRole("textbox", { name: "Article title", exact: true })
        .fill("Expansion article");
    const enabled = dialog.getByRole("checkbox", {
        name: "Scoring item 1 — Length",
        exact: true,
    });
    const score = dialog
        .locator(".acga-content-expansion-row")
        .getByRole("spinbutton", { name: "Score", exact: true });
    await enabled.check();
    await expect(score).toHaveValue("3");
    await score.fill("");
    await expect(score).toHaveValue("");
    await enabled.uncheck();
    await enabled.check();
    await expect(score).toHaveValue("3");
    await expect(
        dialog.locator(".acga-code-preview-text textarea"),
    ).toHaveValue(/\{\{ACG提名2\/request\|ver=1\|1c\}\}/u);
    expect(errors).toEqual([]);
});

test("review score stepper uses half-points, clamps zero, and saves custom scores", async ({
    page,
}) => {
    const errors = await mount(page, "en");
    await page.evaluate(() => {
        void (window as any).acgaFixture.dialogs.showNewNominationDialog();
    });
    const dialog = page.getByRole("dialog");
    await dialog
        .getByRole("textbox", { name: "Article title", exact: true })
        .fill("Review article");
    await dialog.getByRole("button", { name: /^\(5\)/u }).click();
    const score = dialog.getByRole("spinbutton", {
        name: "Review score",
        exact: true,
    });
    const decrease = dialog.getByRole("button", {
        name: "Decrease score: Review score",
        exact: true,
    });
    const increase = dialog.getByRole("button", {
        name: "Increase score: Review score",
        exact: true,
    });
    await expect(score).toBeVisible();
    await expect(dialog.getByText("Custom score", { exact: true })).toHaveCount(
        0,
    );
    await score.fill("");
    await expect(score).toHaveValue("");
    expect(errors).toEqual([]);
    await score.fill("0");
    await expect(decrease).toBeDisabled();
    await increase.click();
    await expect(score).toHaveValue("0.5");
    await decrease.click();
    await expect(score).toHaveValue("0");
    await expect(decrease).toBeDisabled();
    await score.fill("1.5");
    await expect(score).toHaveValue("1.5");
    await dialog.getByRole("radio", { name: "A-class", exact: true }).check();
    await expect(score).toHaveValue("2");
    await increase.click();
    await expect(score).toHaveValue("2.5");
    await expect(
        dialog.locator(".acga-code-preview-text textarea"),
    ).toHaveValue(/5-acr\[2\.5\]/u);
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(
        dialog.getByRole("table", { name: "Nomination table 1", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(dialog).toBeHidden();
    const effects = await page.evaluate(
        () => (window as any).acgaFixture.effects,
    );
    expect(effects.saves).toHaveLength(1);
    expect(
        effects.saves[0].data[0].nominations[0].ruleStatus["5-acr"],
    ).toMatchObject({
        selected: true,
        score: 2.5,
    });
    expect(effects.errors).toEqual([]);
    expect(errors).toEqual([]);
});

test("preview identifies every invalid draft across table tabs", async ({
    page,
}) => {
    const errors = await mount(page, "zh-Hans");
    await page.evaluate(() => {
        void (window as any).acgaFixture.dialogs.showNewNominationDialog();
    });
    const dialog = page.getByRole("dialog");
    const activePanel = dialog.locator(".acga-nomination-panel:visible");
    const article = activePanel.locator(".acga-rule-page-name input");
    const length = dialog.getByRole("checkbox", {
        name: "得分项目1 — 篇幅",
        exact: true,
    });
    const score = activePanel.locator(
        ".acga-content-expansion-row input[type=number]",
    );
    const preview = dialog.getByRole("button", { name: "预览", exact: true });
    const globalError = dialog.locator(".acga-dialog-error");

    await article.fill("第一项条目");
    await length.check();
    await dialog.getByRole("button", { name: "新增提名", exact: true }).click();
    await article.fill("第二项条目");
    await length.check();
    await dialog.getByRole("button", { name: "新增表格", exact: true }).click();
    await article.fill("第二表条目");
    await length.check();
    await score.fill("0");
    await dialog.getByRole("tab", { name: "表格1", exact: true }).click();
    await dialog.getByRole("tab", { name: "项目1", exact: true }).click();
    await article.fill("");
    await length.uncheck();
    await dialog.getByRole("tab", { name: "项目2", exact: true }).click();
    await score.fill("0.25");
    await preview.click();
    await expect(globalError).toBeVisible();
    await expect(globalError).toHaveCSS("padding-top", "12px");
    await expect(globalError).toContainText(
        "请检查错误表单后预览。错误表单：（表格1）提名1、（表格1）提名2、（表格2）提名1。",
    );
    await expect(article).toBeFocused();
    await expect(dialog.getByRole("table")).toHaveCount(0);
    await dialog.getByRole("tab", { name: "项目2", exact: true }).click();
    await expect(
        activePanel.locator(".acga-code-preview-text textarea"),
    ).toHaveValue(/1c\[0\.25\]/u);
    await capture(page, "nomination-validation-zh");
    expect(
        await page.evaluate(() => (window as any).acgaFixture.effects.saves),
    ).toEqual([]);
    expect(errors).toEqual([]);
});

test("English checking and mobile forms use the same accessible dialog", async ({
    page,
}) => {
    const errors = await mount(page, "en");
    await page.evaluate(() => {
        const global = window as any;
        void global.acgaFixture.dialogs.showCheckNominationDialog(
            global.AcgaTestUI.nomination("1a 3"),
            { type: "acg2", position: 1 },
        );
    });
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".acga-check-table-fieldset")).toBeVisible();
    await capture(page, "check-en");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
        void (window as any).acgaFixture.dialogs.showNewNominationDialog();
    });
    await expect(dialog).toBeVisible();
    await expect(
        dialog.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeInViewport();
    const clipped = await dialog
        .locator(
            ".acga-article-core-line input, .acga-article-core-line [role=combobox]",
        )
        .evaluateAll((controls) => {
            return controls.flatMap((control) => {
                if (
                    !(control instanceof HTMLElement) ||
                    control.getClientRects().length === 0
                )
                    return [];
                const bounds = control.getBoundingClientRect();
                const container = control
                    .closest(".acga-rules")!
                    .getBoundingClientRect();
                return bounds.left < container.left - 1 ||
                    bounds.right > container.right + 1
                    ? [
                          {
                              label:
                                  control.getAttribute("aria-label") ||
                                  control.className,
                              left: bounds.left,
                              right: bounds.right,
                              containerLeft: container.left,
                              containerRight: container.right,
                          },
                      ]
                    : [];
            });
        });
    await capture(page, "mobile-en");
    expect(
        clipped,
        "Mobile article controls must fit within their visible form container",
    ).toEqual([]);
    expect(errors).toEqual([]);
});

async function openDykCheck(page: Page, title: string, reason = "4-dyk") {
    await page.evaluate(
        ({ title, reason }) => {
            const global = window as any;
            void global.acgaFixture.dialogs.showCheckNominationDialog(
                global.AcgaTestUI.nomination(reason, title),
                { type: "acg2", position: 1 },
            );
        },
        { title, reason },
    );
    await expect(page.getByRole("dialog")).toBeVisible();
}

async function closeDykCheck(page: Page) {
    await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
    await expect(page.getByRole("dialog")).toBeHidden();
}

async function expectCompactArticleHints(dialog: Locator): Promise<void> {
    const hints = dialog.locator(".acga-article-status:visible");
    await expect(hints).toHaveCount(1);
    await expect(hints.locator(":scope > div")).toHaveCount(2);
    await expect(hints.locator("dt, dd")).toHaveCount(0);
    await expect(hints).toHaveCSS("font-size", "14px");
    await expect(hints).toHaveCSS("color", "rgb(84, 89, 93)");
    const dyk = hints.locator(".acga-dyk-status");
    await expect(dyk.getByRole("link").first()).toHaveCSS(
        "color",
        "rgb(0, 0, 238)",
    );
    const position = await hints.evaluate((element) => {
        const article = element
            .closest(".acga-author-form")!
            .querySelector(".acga-rule-page-name input")!;
        const articleBounds = article.getBoundingClientRect();
        const hintBounds = element.getBoundingClientRect();
        return {
            gap: hintBounds.top - articleBounds.bottom,
            left: hintBounds.left - articleBounds.left,
        };
    });
    expect(position.gap).toBeGreaterThanOrEqual(0);
    expect(position.gap).toBeLessThanOrEqual(16);
    expect(Math.abs(position.left)).toBeLessThanOrEqual(1);
}

test("DYK appearance prose links selection inline and formats the date and day count", async ({
    page,
}) => {
    await page.clock.setFixedTime(new Date("2026-09-30T12:00:00Z"));
    const errors = await mount(page, "zh-Hans", { deferredDyk: true });
    await openDykCheck(page, "Example article");
    await expect
        .poll(() =>
            page.evaluate(() => (window as any).acgaFixture.dykRequests.length),
        )
        .toBe(1);
    await page.evaluate(() =>
        (window as any).acgaFixture.dykRequests[0].resolve({
            passed: true,
            date: "2026-09-29",
        }),
    );
    const status = page.locator(".acga-check-summary .acga-dyk-status");
    await expect(status).toHaveText("条目于2026年9月29日（1天前）入选。");
    await expect(status.getByRole("link")).toHaveText("入选");
    await expect(status.getByRole("link")).toHaveAttribute(
        "href",
        "/wiki/Talk%3AExample_article",
    );
    await expect(status.getByRole("link", { name: "查看讨论页" })).toHaveCount(
        0,
    );
    await capture(page, "dyk-appearance-zh");
    expect(errors).toEqual([]);
});

test("DYK score-check rows show the latest archive author and discard older session replies", async ({
    page,
}) => {
    const errors = await mount(page, "en", { deferredDyk: true });
    await openDykCheck(page, "First article");
    const dialog = page.getByRole("dialog");
    const status = dialog.locator(".acga-check-summary .acga-dyk-status");
    await expect(status).toContainText("Checking the talk page");
    await expect
        .poll(() =>
            page.evaluate(() => (window as any).acgaFixture.dykRequests.length),
        )
        .toBe(1);
    await closeDykCheck(page);
    await openDykCheck(page, "Second article");
    await expect
        .poll(() =>
            page.evaluate(() => (window as any).acgaFixture.dykRequests.length),
        )
        .toBe(2);
    const previewBefore = await dialog
        .locator(".acga-code-preview-text textarea")
        .inputValue();
    await page.evaluate(() =>
        (window as any).acgaFixture.dykRequests[0].resolve({
            passed: false,
            date: "2025-01-01",
            nominated: true,
        }),
    );
    await expect(status).toContainText("Checking the talk page");
    await expect(status.locator(".acga-dyk-nomination")).toHaveCount(0);
    await page.evaluate(() =>
        (window as any).acgaFixture.dykRequests[1].resolve({
            passed: true,
            date: "2025-08-05",
            records: [
                { author: "a2569875", date: "2016-03-28", passed: true },
                { author: "Newbamboo", date: "2025-08-05", passed: true },
            ],
        }),
    );
    await expect(status).toContainText(
        "Newbamboo; selected for DYK on 2025-08-05",
    );
    await expect(status).not.toContainText("a2569875");
    await expect(status.getByRole("link")).toHaveAttribute(
        "href",
        "/wiki/Talk%3ASecond_article",
    );
    await expect(
        dialog.locator(".acga-code-preview-text textarea"),
    ).toHaveValue(previewBefore);
    expect(errors).toEqual([]);
});

test("DYK score checking distinguishes unsuccessful nominations, absent records and lookup failures", async ({
    page,
}) => {
    const errors = await mount(page, "en", { deferredDyk: true });
    const status = page.locator(".acga-check-summary .acga-dyk-status");
    await openDykCheck(page, "No record");
    await expect
        .poll(() =>
            page.evaluate(() => (window as any).acgaFixture.dykRequests.length),
        )
        .toBe(1);
    await page.evaluate(() =>
        (window as any).acgaFixture.dykRequests[0].resolve({
            passed: false,
            date: null,
        }),
    );
    await expect(status).toHaveText("No recent DYK records");
    await expect(status.getByRole("link")).toHaveText("No recent DYK records");
    await expect(status.getByRole("link")).toHaveAttribute(
        "href",
        "/wiki/Talk%3ANo_record",
    );
    await closeDykCheck(page);
    await openDykCheck(page, "地球冒险3");
    await expect
        .poll(() =>
            page.evaluate(() => (window as any).acgaFixture.dykRequests.length),
        )
        .toBe(2);
    await page.evaluate(() =>
        (window as any).acgaFixture.dykRequests[1].resolve({
            passed: false,
            date: "2026-09-27",
            records: [
                { author: "Pathfinbird", date: "2026-09-27", passed: false },
            ],
        }),
    );
    await expect(status).toContainText(
        "Pathfinbird; did not pass on 2026-09-27",
    );
    await closeDykCheck(page);
    await openDykCheck(page, "Unreadable talk page");
    await expect
        .poll(() =>
            page.evaluate(() => (window as any).acgaFixture.dykRequests.length),
        )
        .toBe(3);
    await page.evaluate(() =>
        (window as any).acgaFixture.dykRequests[2].reject(
            new Error("offline fixture failure"),
        ),
    );
    await expect(status).toContainText("DYK record could not be checked");
    await expect
        .poll(() =>
            page.evaluate(
                () => (window as any).acgaFixture.effects.errors.length,
            ),
        )
        .toBe(1);
    expect(errors).toEqual([]);
});

for (const [language, noRecord] of [
    ["zh-Hans", "近期无DYK记录"],
    ["zh-Hant", "近期無DYK記錄"],
])
    test(`${language} nomination hints link the concise no-record status and category 8 uses the recipient label`, async ({
        page,
    }) => {
        const title = "没有 DYK 记录的条目";
        const errors = await mount(page, language, {
            pageName: title,
            deferredDyk: true,
        });
        await openNewNomination(page);
        const dialog = page.getByRole("dialog");
        await expect
            .poll(() =>
                page.evaluate(
                    () => (window as any).acgaFixture.dykRequests.length,
                ),
            )
            .toBe(1);
        await page.evaluate(() =>
            (window as any).acgaFixture.dykRequests[0].resolve({
                passed: false,
                date: null,
            }),
        );
        const status = dialog.locator(".acga-dyk-status:visible");
        await expect(status).toHaveText(noRecord);
        const link = status.getByRole("link", { name: noRecord, exact: true });
        await expect(link).toHaveAttribute(
            "href",
            "/wiki/" + encodeURIComponent("Talk:" + title.replaceAll(" ", "_")),
        );
        await expect(status.getByRole("link")).toHaveCount(1);
        await capture(page, `dyk-no-record-${language}`);
        await dialog.getByRole("button", { name: /^\(8\)/u }).click();
        await expect(
            dialog.getByRole("textbox", { name: "得分者", exact: true }),
        ).toBeVisible();
        expect(errors).toEqual([]);
    });

test("current DYK nomination links coexist with previous outcomes and disappear between sessions", async ({
    page,
}) => {
    const errors = await mount(page, "en", { deferredDyk: true });
    const status = page.locator(".acga-check-summary .acga-dyk-status");
    const tag = status.locator(".acga-dyk-nomination");
    const cases = [
        {
            title: "Let's Go!陰陽師",
            result: { passed: false, date: null, nominated: true },
            history: "",
        },
        {
            title: "Current nomination only",
            result: { passed: false, date: null, nominated: true },
            history: "",
        },
        {
            title: "Previous appearance and new nomination",
            result: { passed: true, date: "2025-08-05", nominated: true },
            history: "selected for DYK on 2025-08-05",
        },
        {
            title: "Archived nomination and new nomination",
            result: {
                passed: false,
                date: "2026-09-27",
                nominated: true,
                records: [
                    {
                        author: "Pathfinbird",
                        date: "2026-09-27",
                        passed: false,
                    },
                ],
            },
            history: "Pathfinbird; did not pass on 2026-09-27",
        },
    ];
    for (const [index, item] of cases.entries()) {
        await openDykCheck(page, item.title);
        await expect(tag).toHaveCount(0);
        await expect
            .poll(() =>
                page.evaluate(
                    () => (window as any).acgaFixture.dykRequests.length,
                ),
            )
            .toBe(index + 1);
        await page.evaluate(
            ({ index, result }) =>
                (window as any).acgaFixture.dykRequests[index].resolve(result),
            { index, result: item.result },
        );
        await expect(tag).toHaveText("Currently nominated for DYK");
        await expect(tag).toHaveAttribute(
            "href",
            "/wiki/Wikipedia%3A%E6%96%B0%E6%9D%A1%E7%9B%AE%E6%8E%A8%E8%8D%90%2F%E5%80%99%E9%80%89#" +
                encodeURIComponent(item.title.replaceAll(" ", "_")),
        );
        await expect(tag).toHaveCSS("color", "rgb(0, 0, 238)");
        await expect(tag).toHaveCSS("border-top-width", "0px");
        await expect(tag).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await expect(status).not.toContainText("No recent DYK records");
        if (item.history) await expect(status).toContainText(item.history);
        await closeDykCheck(page);
    }
    await openDykCheck(page, "No current nomination");
    await expect(tag).toHaveCount(0);
    await expect
        .poll(() =>
            page.evaluate(() => (window as any).acgaFixture.dykRequests.length),
        )
        .toBe(cases.length + 1);
    await page.evaluate(
        (index) =>
            (window as any).acgaFixture.dykRequests[index].resolve({
                passed: false,
                date: null,
            }),
        cases.length,
    );
    await expect(tag).toHaveCount(0);
    await expect(status).toHaveText("No recent DYK records");
    expect(errors).toEqual([]);
});

test("DYK status appears while nominating and checking an article without selecting the DYK scoring item", async ({
    page,
}) => {
    await page.clock.setFixedTime(new Date("2025-08-06T12:00:00Z"));
    const errors = await mount(page, "zh-Hans", {
        pageName: "Example article",
        deferredDyk: true,
    });
    await page.evaluate(() => {
        void (window as any).acgaFixture.dialogs.showNewNominationDialog();
    });
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".acga-dyk-status:visible")).toContainText(
        createTranslator("zh-Hans").msg("dyk_status_loading"),
    );
    await expect
        .poll(() =>
            page.evaluate(() => (window as any).acgaFixture.dykRequests.length),
        )
        .toBe(1);
    await page.evaluate(() =>
        (window as any).acgaFixture.dykRequests[0].resolve({
            passed: false,
            date: null,
        }),
    );
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toBeHidden();
    await openDykCheck(page, "Example article", "1c");
    await expect(dialog.locator(".acga-dyk-status")).toContainText(
        createTranslator("zh-Hans").msg("dyk_status_loading"),
    );
    await expect
        .poll(() =>
            page.evaluate(() => (window as any).acgaFixture.dykRequests.length),
        )
        .toBe(2);
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toBeHidden();
    await openDykCheck(page, "紅石電路");
    await expect
        .poll(() =>
            page.evaluate(() => (window as any).acgaFixture.dykRequests.length),
        )
        .toBe(3);
    await page.evaluate(() =>
        (window as any).acgaFixture.dykRequests[2].resolve({
            passed: true,
            date: "2025-08-05",
            nominated: true,
            records: [
                { author: "Newbamboo", date: "2025-08-05", passed: true },
            ],
        }),
    );
    await expect(dialog.locator(".acga-check-summary dt")).toHaveText([
        "得分者",
        "得分条目",
        "DYK状态",
    ]);
    await expect(dialog.locator(".acga-dyk-status")).toContainText(
        "最近一次提名主编为Newbamboo，条目于2025年8月5日（1天前）入选。",
    );
    await expect(dialog.locator(".acga-dyk-nomination")).toHaveText(
        "正在提名 DYK",
    );
    await capture(page, "dyk-check-zh");
    expect(errors).toEqual([]);
});

test("page assessments rank classes and emphasize preferred projects above the DYK hint", async ({
    page,
}) => {
    const errors = await mount(page, "en", {
        deferredAssessments: true,
        deferredDyk: true,
    });
    await openDykCheck(page, "Assessed article", "1c");
    const dialog = page.getByRole("dialog");
    const assessments = dialog.locator(".acga-page-assessments");
    await expect(assessments).toHaveText(
        createTranslator("en").msg("page_assessments_loading"),
    );
    await expect
        .poll(() =>
            page.evaluate(
                () => (window as any).acgaFixture.assessmentRequests.length,
            ),
        )
        .toBe(1);
    const sourceBefore = await dialog
        .locator(".acga-code-preview-text textarea")
        .inputValue();
    await page.evaluate(() =>
        (window as any).acgaFixture.assessmentRequests[0].resolve([
            { project: "通用评级", class: "丙" },
            { project: "电子游戏/角色", class: "甲" },
            { project: "漫畫", class: "丙" },
            { project: "虚构专题", class: "乙" },
            { project: "<img>", class: "初" },
            { project: "电子游戏", class: "丙" },
            { project: "ACG", class: "丙" },
            { project: "動畫", class: "丙" },
        ]),
    );
    await expect(assessments).toHaveText(
        "乙（虚构专题）·丙（ACG·動畫·漫畫·电子游戏·通用评级）·初（<img>）",
    );
    await expect(assessments.locator("strong")).toHaveText([
        "ACG",
        "動畫",
        "漫畫",
        "电子游戏",
    ]);
    await expect(assessments.locator("img")).toHaveCount(0);
    await expect(assessments).not.toContainText("角色");
    const order = await assessments.evaluate((assessment) => {
        const dyk =
            assessment.parentElement!.querySelector(".acga-dyk-status")!;
        const recipient = assessment.parentElement!.querySelector("dd")!;
        return {
            belowRecipient: Boolean(
                recipient.compareDocumentPosition(assessment) &
                Node.DOCUMENT_POSITION_FOLLOWING,
            ),
            aboveDyk: Boolean(
                assessment.compareDocumentPosition(dyk) &
                Node.DOCUMENT_POSITION_FOLLOWING,
            ),
        };
    });
    expect(order).toEqual({ belowRecipient: true, aboveDyk: true });
    await expect(
        dialog.locator(".acga-code-preview-text textarea"),
    ).toHaveValue(sourceBefore);
    await capture(page, "page-assessments-check-en");
    expect(errors).toEqual([]);
});

test("page assessments distinguish loading, missing data, lookup failures, and old session replies", async ({
    page,
}) => {
    const errors = await mount(page, "en", { deferredAssessments: true });
    const assessments = page.locator(".acga-page-assessments:visible");
    const msg = createTranslator("en").msg;
    await openDykCheck(page, "Old article", "1c");
    await expect(assessments).toHaveText(msg("page_assessments_loading"));
    await expect
        .poll(() =>
            page.evaluate(
                () => (window as any).acgaFixture.assessmentRequests.length,
            ),
        )
        .toBe(1);
    await closeDykCheck(page);
    await openDykCheck(page, "Current article", "1c");
    await expect
        .poll(() =>
            page.evaluate(
                () => (window as any).acgaFixture.assessmentRequests.length,
            ),
        )
        .toBe(2);
    await page.evaluate(() =>
        (window as any).acgaFixture.assessmentRequests[0].resolve([
            { project: "ACG", class: "甲" },
        ]),
    );
    await expect(assessments).toHaveText(msg("page_assessments_loading"));
    await page.evaluate(() =>
        (window as any).acgaFixture.assessmentRequests[1].resolve([]),
    );
    await expect(assessments).toHaveText(msg("page_assessments_missing"));
    await closeDykCheck(page);
    await openDykCheck(page, "Offline article", "1c");
    await expect
        .poll(() =>
            page.evaluate(
                () => (window as any).acgaFixture.assessmentRequests.length,
            ),
        )
        .toBe(3);
    await page.evaluate(() =>
        (window as any).acgaFixture.assessmentRequests[2].reject(
            new Error("offline assessment fixture failure"),
        ),
    );
    await expect(assessments).toHaveText(msg("page_assessments_failed"));
    await expect
        .poll(() =>
            page.evaluate(
                () => (window as any).acgaFixture.effects.errors.length,
            ),
        )
        .toBe(1);
    expect(errors).toEqual([]);
});

test("nomination forms show page assessments and DYK hints for the active article and edit target", async ({
    page,
}) => {
    const errors = await mount(page, "en", {
        pageName: "Context article",
        deferredAssessments: true,
        deferredDyk: true,
    });
    await openNewNomination(page);
    const dialog = page.getByRole("dialog");
    const assessments = dialog.locator(".acga-page-assessments:visible");
    const dyk = dialog.locator(".acga-dyk-status:visible");
    await expect(assessments).toBeVisible();
    await expect(dyk).toBeVisible();
    await expect
        .poll(() =>
            page.evaluate(() => ({
                assessments: (window as any).acgaFixture.assessmentRequests.map(
                    (request: any) => request.pageName,
                ),
                dyk: (window as any).acgaFixture.dykRequests.map(
                    (request: any) => request.pageName,
                ),
            })),
        )
        .toEqual({
            assessments: ["Context article"],
            dyk: ["Context article"],
        });
    await page.evaluate(() => {
        const fixture = (window as any).acgaFixture;
        fixture.assessmentRequests[0].resolve([
            { project: "ACG", class: "乙" },
        ]);
        fixture.dykRequests[0].resolve({ passed: false, date: null });
    });
    await expect(assessments).toHaveText("乙（ACG）");
    await expectCompactArticleHints(dialog);
    await capture(page, "page-assessments-nomination-en");
    await dialog
        .getByRole("textbox", { name: "Article title", exact: true })
        .fill("Different article");
    await expect
        .poll(() =>
            page.evaluate(() => ({
                assessments: (window as any).acgaFixture.assessmentRequests.map(
                    (request: any) => request.pageName,
                ),
                dyk: (window as any).acgaFixture.dykRequests.map(
                    (request: any) => request.pageName,
                ),
            })),
        )
        .toEqual({
            assessments: ["Context article", "Different article"],
            dyk: ["Context article", "Different article"],
        });
    await closeDykCheck(page);
    await page.evaluate(() => {
        const global = window as any;
        void global.acgaFixture.dialogs.showEditNominationDialog(
            global.AcgaTestUI.nomination("1c", "Edited article"),
            { type: "acg2", position: 1 },
        );
    });
    await expect(dialog).toBeVisible();
    await expect(assessments).toBeVisible();
    await expect(dyk).toBeVisible();
    await expectCompactArticleHints(dialog);
    await expect
        .poll(() =>
            page.evaluate(() => ({
                assessment: (window as any).acgaFixture.assessmentRequests.at(
                    -1,
                )?.pageName,
                dyk: (window as any).acgaFixture.dykRequests.at(-1)?.pageName,
            })),
        )
        .toEqual({ assessment: "Edited article", dyk: "Edited article" });
    expect(errors).toEqual([]);
});

test("compact nomination hints show the latest DYK date before its author and stay below the article while editing a summary", async ({
    page,
}) => {
    await page.clock.setFixedTime(new Date("2026-09-30T12:00:00Z"));
    const errors = await mount(page, "zh-Hans", {
        pageName: "美竹兰",
        deferredAssessments: true,
        deferredDyk: true,
    });
    await openNewNomination(page);
    const dialog = page.getByRole("dialog");
    await expect
        .poll(() =>
            page.evaluate(() => ({
                assessments: (window as any).acgaFixture.assessmentRequests
                    .length,
                dyk: (window as any).acgaFixture.dykRequests.length,
            })),
        )
        .toEqual({ assessments: 1, dyk: 1 });
    await page.evaluate(() => {
        const fixture = (window as any).acgaFixture;
        fixture.assessmentRequests[0].resolve([
            { project: "ACG", class: "初" },
            { project: "电子游戏", class: "初" },
            { project: "虚构角色", class: "初" },
        ]);
        fixture.dykRequests[0].resolve({
            passed: true,
            date: "2026-09-27",
            records: [
                { author: "Earlier author", date: "2025-01-01", passed: true },
                { author: "Perimeter Chou", date: "2026-09-27", passed: true },
            ],
        });
    });
    const dyk = dialog.locator(".acga-dyk-status:visible");
    await expect(dyk).toHaveText(
        "于2026年9月27日（3天前）入选DYK，主编为Perimeter Chou。",
    );
    await expect(dyk).not.toContainText("Earlier author");
    await expectCompactArticleHints(dialog);
    await expect(dialog.locator(".acga-article-status")).not.toContainText(
        "DYK状态",
    );
    await expect(dialog.locator(".acga-article-status")).not.toContainText(
        "页面评级",
    );
    await capture(page, "page-assessments-compact-nomination-zh");

    await dialog
        .getByRole("checkbox", { name: "得分项目1 — 篇幅", exact: true })
        .check();
    await dialog.getByRole("button", { name: "预览", exact: true }).click();
    await expect(dialog.getByRole("table")).toHaveCount(1);
    await expect(dialog.locator(".acga-article-status:visible")).toHaveCount(0);
    const editorTitle = createTranslator("zh-Hans").msg(
        "edit_summary_nomination",
        { number: 1 },
    );
    await dialog
        .getByRole("button", { name: editorTitle, exact: true })
        .click();
    const editor = page.getByRole("dialog", { name: editorTitle, exact: true });
    await expect(editor).toBeVisible();
    await expectCompactArticleHints(editor);
    await expect(editor.locator(".acga-dyk-status")).toHaveText(
        "于2026年9月27日（3天前）入选DYK，主编为Perimeter Chou。",
    );
    await editor
        .getByRole("textbox", { name: "条目名", exact: true })
        .fill("另一条目");
    await expect
        .poll(() =>
            page.evaluate(() => ({
                assessments: (window as any).acgaFixture.assessmentRequests
                    .length,
                dyk: (window as any).acgaFixture.dykRequests.length,
            })),
        )
        .toEqual({ assessments: 2, dyk: 2 });
    await page.evaluate(() => {
        const fixture = (window as any).acgaFixture;
        fixture.assessmentRequests[1].resolve([
            { project: "<img>", class: "乙" },
        ]);
        fixture.dykRequests[1].resolve({
            passed: true,
            date: "2026-09-27",
            nominated: true,
            records: [{ author: "<img>", date: "2026-09-27", passed: true }],
        });
    });
    await expect(editor.locator(".acga-page-assessments")).toHaveText(
        "乙（<img>）",
    );
    await expect(editor.locator(".acga-dyk-status")).toContainText(
        "于2026年9月27日（3天前）入选DYK，主编为<img>。",
    );
    await expect(editor.locator(".acga-article-status img")).toHaveCount(0);
    const currentNomination = editor.getByRole("link", {
        name: "正在提名 DYK",
        exact: true,
    });
    await expect(currentNomination).toHaveAttribute(
        "href",
        "/wiki/Wikipedia%3A%E6%96%B0%E6%9D%A1%E7%9B%AE%E6%8E%A8%E8%8D%90%2F%E5%80%99%E9%80%89#%E5%8F%A6%E4%B8%80%E6%9D%A1%E7%9B%AE",
    );
    await expect(currentNomination).toHaveCSS("border-top-width", "0px");
    await expect(currentNomination).toHaveCSS(
        "background-color",
        "rgba(0, 0, 0, 0)",
    );
    await expectCompactArticleHints(editor);
    expect(errors).toEqual([]);
});

test("file, media, activity, and other nominations do not fetch article assessments or DYK hints", async ({
    page,
}) => {
    const errors = await mount(page, "en", {
        deferredAssessments: true,
        deferredDyk: true,
    });
    const cases = [
        { pageName: "File:Example.png", reason: "1c" },
        { pageName: "Example.png", reason: "6" },
        { pageName: "Activity", reason: "7" },
        { pageName: "Other nomination", reason: "8" },
    ];
    for (const item of cases) {
        await openDykCheck(page, item.pageName, item.reason);
        await expect(
            page.locator(".acga-page-assessments:visible"),
        ).toHaveCount(0);
        await expect(page.locator(".acga-dyk-status:visible")).toHaveCount(0);
        await closeDykCheck(page);
    }
    expect(
        await page.evaluate(() => ({
            assessmentRequests: (window as any).acgaFixture.assessmentRequests
                .length,
            dykRequests: (window as any).acgaFixture.dykRequests.length,
        })),
    ).toEqual({ assessmentRequests: 0, dykRequests: 0 });
    expect(errors).toEqual([]);
});

test("dialog actions keep a neutral cancel and primary end or top in either direction", async ({
    page,
}) => {
    const errors = await mount(page, "en", { pageName: "Example game" });
    await openNewNomination(page);
    const dialog = page.getByRole("dialog");
    const actions = dialog.locator(".acga-footer-actions");
    const cancel = actions.getByRole("button", { name: "Cancel", exact: true });
    const draft = actions.getByRole("button", {
        name: "Save draft",
        exact: true,
    });
    const primary = actions.getByRole("button", {
        name: "Preview",
        exact: true,
    });
    await expect(cancel).toHaveClass(/cdx-button--action-default/u);
    await expect(actions.locator(".cdx-button--weight-primary")).toHaveCount(1);
    await expect(actions).toHaveCSS("gap", "12px");
    for (const direction of ["ltr", "rtl"]) {
        await page.evaluate((dir) => {
            document.documentElement.dir = dir;
        }, direction);
        const secondaryBounds = await draft.boundingBox();
        const primaryBounds = await primary.boundingBox();
        expect(secondaryBounds).not.toBeNull();
        expect(primaryBounds).not.toBeNull();
        if (direction === "ltr") {
            expect(primaryBounds!.x).toBeGreaterThan(secondaryBounds!.x);
        } else {
            expect(primaryBounds!.x).toBeLessThan(secondaryBounds!.x);
        }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const direction of ["ltr", "rtl"]) {
        await page.evaluate((dir) => {
            document.documentElement.dir = dir;
        }, direction);
        await expect(actions).toHaveCSS("flex-direction", "column");
        await expect(actions.getByRole("button")).toHaveText([
            "Preview",
            "Save draft",
            "Cancel",
        ]);
        const cancelBounds = await cancel.boundingBox();
        const draftBounds = await draft.boundingBox();
        const primaryBounds = await primary.boundingBox();
        expect(primaryBounds!.y).toBeLessThan(draftBounds!.y);
        expect(draftBounds!.y).toBeLessThan(cancelBounds!.y);
        await expect(primary).toBeInViewport();
        await expect(cancel).toBeInViewport();
        await primary.focus();
        await page.keyboard.press("Tab");
        await expect(draft).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(cancel).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(draft).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(primary).toBeFocused();
    }
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(actions.getByRole("button")).toHaveText([
        "Cancel",
        "Save draft",
        "Preview",
    ]);
    expect(errors).toEqual([]);
});

test.describe("documentation screenshots", () => {
    test.skip(process.env.DOCUMENTATION_SCREENSHOTS !== "1");
    test.use({
        viewport: { width: 1024, height: 768 },
        deviceScaleFactor: 1,
        colorScheme: "light",
        reducedMotion: "reduce",
    });

    test("nomination form and summary", async ({ page }) => {
        const articleSource = await readFile(
            new URL("../fixtures/bang-dream.wikitext", import.meta.url),
            "utf8",
        );
        const sourceInfo = JSON.parse(
            await readFile(
                new URL("../fixtures/bang-dream.source.json", import.meta.url),
                "utf8",
            ),
        );
        const errors = await mount(page, "zh-Hant", {
            pageName: sourceInfo.title,
        });
        await page.evaluate(
            ({ title, excerpt }) => {
                document.querySelector("h1")!.textContent = title;
                const source = document.createElement("pre");
                source.textContent = excerpt;
                source.style.cssText =
                    "white-space:pre-wrap;line-height:1.6;color:#54595d";
                document.body.append(source);
            },
            {
                title: sourceInfo.title,
                excerpt: articleSource.slice(
                    0,
                    articleSource.indexOf("\n== 剧情 =="),
                ),
            },
        );
        const msg = createTranslator("zh-Hant").msg;
        const directory = new URL("../../docs/images/", import.meta.url);
        await mkdir(directory, { recursive: true });
        await openNewNomination(page);
        const dialog = page.getByRole("dialog");
        const recipient = dialog.getByRole("textbox", {
            name: msg("recipient"),
            exact: true,
        });
        const length = dialog.getByRole("checkbox", {
            name: msg("1_length"),
            exact: true,
        });
        await recipient.fill("Example");
        await length.check();
        await expect(
            dialog.getByRole("button", { name: msg("preview"), exact: true }),
        ).toBeVisible();
        await page.screenshot({
            path: fileURLToPath(new URL("screenshot-01.png", directory)),
            animations: "disabled",
        });
        await dialog
            .getByRole("button", { name: msg("add_nomination"), exact: true })
            .click();
        await dialog
            .getByRole("textbox", { name: msg("article_title"), exact: true })
            .fill(sourceInfo.title);
        await recipient.fill("Example2");
        await length.check();
        await dialog
            .getByRole("button", { name: msg("preview"), exact: true })
            .click();
        await expect(dialog.getByRole("table")).toBeVisible();
        await dialog
            .locator(".acga-additional-message textarea")
            .fill(
                "示範提名：請核對 BanG Dream! 條目的實際貢獻紀錄與適用分數。",
            );
        await page.screenshot({
            path: fileURLToPath(new URL("screenshot-02.png", directory)),
            animations: "disabled",
        });
        expect(
            await page.evaluate(
                () => (window as any).acgaFixture.effects.saves,
            ),
        ).toEqual([]);
        expect(errors).toEqual([]);
    });
});
