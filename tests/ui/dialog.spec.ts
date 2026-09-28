import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { Page } from "@playwright/test";
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
                export function mount(language = 'zh-Hant', options = {}) {
                    const effects = { saves: [], errors: [], notices: [], outcome: null };
                    const suggestionRequests = [];
                    const existingNominationRequests = [];
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
                        saveNominationCheck: (data, target) => save('check', data, target),
                        saveRawNominationSource: (data, target) => save('source', data, target),
                    }, {
                        document,
                        msg: createTranslator(language).msg,
                        getUserName: () => options.userName === undefined ? 'Example' : options.userName,
                        getPageName: () => options.pageName ?? '',
                        getSuggestedRecipient,
                        getExistingNominations,
                        getUrl: (title) => '/wiki/' + encodeURIComponent(title),
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
                        effects, dialogs, suggestionRequests, existingNominationRequests, previews,
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
        userName?: string | null;
        existingNominations?: Array<{
            pageName: string;
            awarder: string;
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
    await page.setContent(
        '<!doctype html><html lang="zh-Hant"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>Example article</h1><button id="opener">Open ACGATool</button></body></html>',
    );
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
    ).toBeVisible();
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
        dialog.getByRole("tab", { name: `Nomination ${index}`, exact: true });
    const remove = (index: number) =>
        dialog.getByRole("button", {
            name: `Delete this nomination: Nomination ${index}`,
            exact: true,
        });
    const add = dialog.getByRole("button", {
        name: "Add nomination",
        exact: true,
    });
    const article = dialog
        .getByRole("tabpanel")
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
    await expect(dialog.getByRole("tab")).toHaveCount(2);
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
    await expect(dialog.getByRole("tab")).toHaveCount(1);
    await expect(tab(1)).toBeFocused();
    await expect(article).toHaveValue("Second article");
    await expect(remove(1)).toBeDisabled();
    await page.keyboard.press("Delete");
    await expect(dialog.getByRole("tab")).toHaveCount(1);

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
    await dialog
        .getByRole("button", { name: "Split table", exact: true })
        .click();
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
        "Split table",
        "Preview",
    ]);
    const cancel = mainFooter.getByRole("button", {
        name: "Cancel",
        exact: true,
    });
    const split = mainFooter.getByRole("button", {
        name: "Split table",
        exact: true,
    });
    await expect(cancel).toHaveClass(/cdx-button--weight-quiet/u);
    await expect(cancel).toHaveClass(/cdx-button--action-destructive/u);
    await expect(split).toHaveClass(/cdx-button--weight-normal/u);
    await expect(split).toHaveClass(/cdx-button--action-default/u);
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
        name: "Nomination 2",
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
        name: "Nomination table",
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
    ).toHaveAttribute("href", "/wiki/First%20article");
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
        "Preview",
        "Submit",
    ]);
    const back = footer.getByRole("button", { name: "Back", exact: true });
    const preview = footer.getByRole("button", {
        name: "Preview",
        exact: true,
    });
    await expect(back).toHaveClass(/cdx-button--weight-quiet/u);
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
    await dialog
        .getByRole("tab", { name: "Nomination 1", exact: true })
        .click();
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
        name: "Nomination table",
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

test("split tables keep separate comments and submit earlier-table edits in one batch", async ({
    page,
}) => {
    const errors = await mount(page, "en");
    await page.evaluate(() => {
        void (window as any).acgaFixture.dialogs.showNewNominationDialog();
    });
    const dialog = page.getByRole("dialog");
    const split = dialog.getByRole("button", {
        name: "Split table",
        exact: true,
    });
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

    await expect(firstTableTab).toHaveCount(0);
    await expect(secondTableTab).toHaveCount(0);
    await expect(
        dialog.getByRole("tab", { name: "Nomination 1", exact: true }),
    ).toBeVisible();
    await split.click();
    await expect(firstTableTab).toBeVisible();
    await expect(firstTableTab).toHaveAttribute("aria-selected", "true");
    await expect(secondTableTab).toHaveCount(0);
    await expect(
        dialog.getByRole("tab", { name: "Item 1", exact: true }),
    ).toBeVisible();
    await expect(
        dialog.getByRole("button", { name: "Merge tables", exact: true }),
    ).toBeVisible();
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
    ).toBeDisabled();
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

test("merged item tabs retain their table groups and submit one combined table", async ({
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
    const split = dialog.getByRole("button", {
        name: "Split table",
        exact: true,
    });
    const merge = dialog.getByRole("button", {
        name: "Merge tables",
        exact: true,
    });
    await article.fill("Original first table");
    await length.check();
    await split.click();
    await expect(
        dialog.getByRole("tab", { name: "Table 1", exact: true }),
    ).toBeVisible();
    await expect(dialog.getByRole("tab", { name: /^Table /u })).toHaveCount(1);
    await dialog
        .getByRole("button", { name: "Add table", exact: true })
        .click();
    await article.fill("Original second table");
    await length.check();
    await score.fill("4");
    await merge.click();
    await expect(dialog.getByRole("tab", { name: /^Table /u })).toHaveCount(0);
    await expect(dialog.getByRole("tab")).toHaveText([
        "Nomination 1",
        "Nomination 2",
    ]);
    await expect(
        dialog.getByRole("tab", { name: "Nomination 2", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(article).toHaveValue("Original second table");
    await score.fill("4.5");
    await dialog
        .getByRole("button", { name: "Add nomination", exact: true })
        .click();
    await expect(dialog.getByRole("tab")).toHaveText([
        "Nomination 1",
        "Nomination 2",
        "Nomination 3",
    ]);
    await article.fill("Temporary merged item");
    await dialog
        .getByRole("button", {
            name: "Delete this nomination: Nomination 3",
            exact: true,
        })
        .click();
    await expect(dialog.getByRole("tab")).toHaveCount(2);
    await expect(article).toHaveValue("Original second table");
    await split.click();
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
    await expect(article).toHaveValue("Original first table");
    await expect(score).toHaveValue("3");
    await merge.click();
    await expect(
        dialog.getByRole("tab", { name: "Nomination 1", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await capture(page, "nomination-merged-tabs-en");
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    const table = dialog.getByRole("table", {
        name: "Nomination table",
        exact: true,
    });
    await expect(dialog.getByRole("table")).toHaveCount(1);
    await expect(table.getByRole("row").nth(1).getByRole("cell")).toHaveText([
        "1",
        "Original first table",
        "Example",
        "3 points",
        "1c",
        "",
    ]);
    await expect(table.getByRole("row").nth(2).getByRole("cell")).toHaveText([
        "2",
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
                    pageName: "Original first table",
                    ruleStatus: { "1c": { score: 3, selected: true } },
                },
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
    await expect(recipient).toHaveAttribute("placeholder", "Example");
    await expect(article).toHaveValue("");
    await expect(article).toHaveAttribute("placeholder", "Example article");
    await expect(notice).toHaveAttribute("data-level", "notice");
    await expect(notice).toContainText("2026-09-21");
    await expect(notice).toContainText("Leading editor");
    await expect(notice).toContainText("1c 3");
    await expect(notice.locator(`a[href="${registryUrl}"]`)).toHaveCount(1);
    await page.evaluate(() =>
        (window as any).acgaFixture.resolveSuggestion(0, "Leading editor"),
    );
    await expect(recipient).toHaveValue("");
    await expect(recipient).toHaveAttribute("placeholder", "Leading editor");
    await expect(notice).toHaveAttribute("data-level", "warning");
    await expect(notice).toHaveClass(
        /acga-existing-nomination--same-recipient/u,
    );
    await capture(page, "nomination-duplicate-warning-en");
    await recipient.fill("Another editor");
    await expect(notice).toHaveAttribute("data-level", "notice");
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

test("recipient suggestions resolve for stored drafts after splitting and switching tables", async ({
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
    await length.check();
    await dialog
        .getByRole("button", { name: "Split table", exact: true })
        .click();
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
    await page.evaluate(() =>
        (window as any).acgaFixture.resolveSuggestion(1, "Later table editor"),
    );
    await expect(recipient).toHaveValue("");
    await expect(recipient).toHaveAttribute("placeholder", "Example");
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
    await expect(recipient).toHaveAttribute("placeholder", "Example");
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
            .getByRole("table", { name: "Nomination table", exact: true })
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
        dialog.getByRole("tab", { name: "Nomination 2", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
        await page.evaluate(
            () => (window as any).acgaFixture.suggestionRequests.length,
        ),
    ).toBe(0);
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
    await dialog
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
    await reset.click();
    await expect(score).toHaveValue(originalScore);
    await expect(
        dialog.getByRole("spinbutton", { name: "3 得分", exact: true }),
    ).toHaveCount(0);
    await expect(addRow).toBeVisible();
    await addRow.getByRole("combobox").click();
    await dialog
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
    const tiers = dialog.getByRole("group", { name: /^評審層次/u });
    await expect(
        tiers.getByText("預填下方評審項目", { exact: true }),
    ).toBeVisible();
    await expect(tiers.getByRole("radio")).toHaveCount(5);
    await expect(
        tiers.getByRole("radio", { name: "通用評審", exact: true }),
    ).toBeChecked();
    await expect(
        dialog.getByRole("button", { name: "一般評審", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByText("評審模式", { exact: true })).toHaveCount(0);
    const general = dialog.locator('[data-review-row="general"]');
    await expect(general.getByRole("combobox")).toHaveValue("通用評審");
    await expect(
        dialog.getByRole("checkbox", { name: "文筆", exact: true }),
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
    await tiers.getByRole("radio", { name: "甲級評審", exact: true }).check();
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
    await tiers.getByRole("radio", { name: "通用評審", exact: true }).check();
    const writing = dialog.locator('[data-review-row="writing"]');
    const coverage = dialog.locator('[data-review-row="coverage"]');
    const source = dialog.locator('[data-review-row="source"]');
    for (const [row, label] of [
        [writing, "文筆"],
        [coverage, "覆蓋面"],
        [source, "來源格式"],
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
    await tiers.getByRole("radio", { name: "乙級評審", exact: true }).check();
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
    await dialog
        .getByRole("radio", { name: "A-class review", exact: true })
        .check();
    await expect(score).toHaveValue("2");
    await increase.click();
    await expect(score).toHaveValue("2.5");
    await expect(
        dialog.locator(".acga-code-preview-text textarea"),
    ).toHaveValue(/5-acr\[2\.5\]/u);
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(
        dialog.getByRole("table", { name: "Nomination table", exact: true }),
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

test("preview identifies every invalid draft across split and merged tables", async ({
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
    await dialog.getByRole("button", { name: "分表", exact: true }).click();
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
    await expect(globalError).toHaveCSS("padding-top", "0px");
    await expect(globalError).toContainText(
        "请检查错误表单后预览。错误表单：（表格1）提名1、（表格1）提名2、（表格2）提名1。",
    );
    await expect(article).toBeFocused();
    await expect(dialog.getByRole("table")).toHaveCount(0);
    await dialog.getByRole("button", { name: "合表", exact: true }).click();
    await preview.click();
    await expect(globalError).toContainText(
        "请检查错误表单后预览。错误表单：提名1、提名2、提名3。",
    );
    await expect(globalError).not.toContainText("表格");
    await expect(article).toBeFocused();
    await dialog.getByRole("tab", { name: "提名2", exact: true }).click();
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
