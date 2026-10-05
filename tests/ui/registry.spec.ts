/**
 * @file tests/ui/registry.spec.ts
 * Purpose: tests / ui / registry.spec module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. Test scenarios
 * 4. loadRegistryRuntime
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { build } from "esbuild";
import { capture, expect, test } from "./fixtures.ts";

let runtime: string;
let codexStyles: string;
test.beforeAll(async () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    codexStyles = await readFile(
        new URL(
            "../../node_modules/@wikimedia/codex/dist/codex.style.css",
            import.meta.url,
        ),
        "utf8",
    );
    const result = await build({
        absWorkingDir: root,
        stdin: {
            contents: `
                import { mountRegistry } from './src/features/registry/integration.ts';
                import { createTranslator } from './src/i18n/index.ts';
                export function mount(root, options = {}) {
                    const effects = { edits: [], checks: [], batches: [], archives: [], errors: [], notices: [], eligibilityRequests: [] };
                    let resolveEligibility;
                    let resolveBatch;
                    let rejectBatch;
                    const dispose = mountRegistry(root, {
                        getExistingNominations: options.nominations || options.failLookup || options.deferredLookup ? async (...args) => {
                            effects.eligibilityRequests.push(args);
                            if (options.failLookup) throw new Error('offline');
                            if (options.deferredLookup) return new Promise(resolve => { resolveEligibility = resolve; });
                            return options.nominations;
                        } : undefined,
                        editNomination: value => {
                            effects.edits.push(value);
                            if (options.failEditOnce) {
                                options.failEditOnce = false;
                                throw new Error('edit offline');
                            }
                            return Promise.resolve();
                        },
                        checkNomination: async value => { effects.checks.push(value); },
                        checkBatch: async values => {
                            effects.batches.push(values);
                            if (options.deferredBatch) await new Promise((resolve, reject) => {
                                resolveBatch = resolve;
                                rejectBatch = reject;
                            });
                        },
                        archiveChapter: async (...values) => { effects.archives.push(values); },
                    }, {
                        msg: createTranslator(options.language ?? 'zh-Hant').msg,
                        revisionId: 42,
                        now: () => new Date(options.now ?? '2026-09-30T12:00:00Z'),
                        getUserName: () => options.userName ?? null,
                        notify: message => effects.notices.push(message),
                        reportError: error => effects.errors.push(String(error)),
                        addStyles(css) {
                            const style = document.createElement('style');
                            style.dataset.registryFixture = 'true';
                            style.textContent = css;
                            document.head.append(style);
                            return () => style.remove();
                        }
                    });
                    return {
                        effects,
                        dispose,
                        resolveEligibility: values => resolveEligibility(values),
                        resolveBatch: () => resolveBatch(),
                        rejectBatch: () => rejectBatch(new Error('batch offline')),
                    };
                }
            `,
            resolveDir: root,
            loader: "ts",
        },
        loader: { ".css": "text" },
        bundle: true,
        format: "iife",
        globalName: "AcgaRegistryUI",
        write: false,
    });
    runtime = result.outputFiles[0]!.text;
});

async function loadRegistryRuntime(page: Page): Promise<void> {
    await page.addStyleTag({ content: codexStyles });
    await page.addScriptTag({ content: runtime });
}

test("registry keeps repeated sections distinct and sends a selected batch once", async ({
    page,
}) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent(`<!doctype html><html lang="zh-Hant"><body><main id="registry">
        <h2>2026</h2>
        <div class="mw-heading mw-heading3"><h3><span class="mw-headline">9月27日</span></h3></div>
        <table class="acgnom-table" id="first"><tbody>
            <tr><th scope="row" rowspan="2" style="background: #ffffb999">First</th><td>Request one
                <table class="acgnom-table" id="nested"><tbody>
                    <tr><th scope="row">Nested content</th><td><h3>1月1日</h3></td></tr>
                    <tr><td class="mw-notalk">Not a nomination</td></tr>
                </tbody></table>
            </td></tr>
            <tr><td><span class="mw-notalk">此提名尚未核對。</span></td></tr>
        </tbody></table>
        <div class="mw-heading mw-heading3"><h3><span class="mw-headline">9月27日</span></h3></div>
        <table class="acgnom-table" id="second"><tbody>
            <tr><th scope="row" rowspan="2" style="background: #ffffb999">Second</th><td>Request two</td></tr>
            <tr><td><span class="mw-notalk">此提名尚未核對。</span></td></tr>
        </tbody></table>
        <h2>Other content</h2>
        <table class="acgnom-table" id="unrelated"><tbody><tr><th scope="row">No date</th><td>Unrelated</td></tr></tbody></table>
    </main></body></html>`);
    await loadRegistryRuntime(page);
    await page.evaluate(() => {
        const global = window as any;
        global.registryFixture = global.AcgaRegistryUI.mount(
            document.getElementById("registry"),
        );
    });
    await expect(page.getByRole("group", { name: "ACG 提名工具" })).toHaveCount(
        0,
    );
    await expect(page.getByRole("status")).toHaveCount(1);
    await expect(
        page.getByRole("button", { name: "修改提名", exact: true }),
    ).toHaveCount(2);
    await expect(
        page.getByRole("button", { name: "核對", exact: true }),
    ).toHaveCount(2);
    await expect(
        page.getByRole("button", { name: "批量核對", exact: true }),
    ).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: "開始核對", exact: true }),
    ).toHaveCount(0);
    const choices = page.getByRole("checkbox", {
        name: "加入批量核對",
        exact: true,
    });
    await expect(choices).toHaveCount(2);
    await expect(choices.nth(0)).toBeVisible();
    await expect(choices.nth(1)).toBeVisible();
    await expect(choices.nth(0)).not.toBeChecked();
    await expect(choices.nth(1)).not.toBeChecked();
    await expect(page.locator("#nested button, #unrelated button")).toHaveCount(
        0,
    );
    await expect(
        page.getByRole("button", { name: "歸檔", exact: true }),
    ).toHaveCount(2);

    await page
        .getByRole("button", { name: "修改提名", exact: true })
        .nth(1)
        .click();
    await page
        .getByRole("button", { name: "核對", exact: true })
        .first()
        .click();
    await choices.nth(0).click();
    await expect(
        page.getByRole("button", { name: "核對", exact: true }),
    ).toHaveCount(0);
    const batches = page.getByRole("button", {
        name: "批量核對",
        exact: true,
    });
    await expect(batches).toHaveCount(2);
    await choices.nth(1).click();
    await expect(page.getByRole("status")).toHaveText("已選擇 2 項");
    await capture(page, "registry-batch-selection");
    await choices.nth(1).click();
    await expect(batches).toHaveCount(2);
    await expect(page.getByRole("status")).toHaveText("已選擇 1 項");
    await choices.nth(0).click();
    await expect(batches).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: "核對", exact: true }),
    ).toHaveCount(2);
    await expect(page.getByRole("status")).toBeEmpty();
    await choices.nth(0).click();
    await choices.nth(1).click();
    await batches.nth(1).click();
    await expect(batches).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: "核對", exact: true }),
    ).toHaveCount(2);
    await expect(choices.nth(0)).not.toBeChecked();
    await expect(choices.nth(1)).not.toBeChecked();
    await expect(page.getByRole("status")).toBeEmpty();
    const effects = await page.evaluate(
        () => (window as any).registryFixture.effects,
    );
    expect(effects.edits).toHaveLength(1);
    expect(effects.edits[0]).toMatchObject({
        date: "9月27日",
        index: 1,
        sectionOccurrence: 1,
        expectedRevisionId: 42,
    });
    expect(effects.checks).toHaveLength(1);
    expect(effects.checks[0]).toMatchObject({
        date: "9月27日",
        index: 1,
        sectionOccurrence: 0,
    });
    expect(effects.batches).toHaveLength(1);
    expect(effects.batches[0]).toHaveLength(2);
    expect(
        effects.batches[0].map((selection: any) => selection.sectionOccurrence),
    ).toEqual([0, 1]);
    expect(effects.errors).toEqual([]);
    expect(errors).toEqual([]);

    await page.evaluate(() => (window as any).registryFixture.dispose());
    await expect(page.locator("#registry button, #registry input")).toHaveCount(
        0,
    );
    await expect(page.locator("style[data-registry-fixture]")).toHaveCount(0);
    await expect(page.locator("#registry table")).toHaveCount(4);
    await page.evaluate(() => {
        const global = window as any;
        global.registryFixture = global.AcgaRegistryUI.mount(
            document.getElementById("registry"),
        );
    });
    await expect(page.getByRole("group", { name: "ACG 提名工具" })).toHaveCount(
        0,
    );
    await expect(page.getByRole("status")).toHaveCount(1);
});

test("registry releases controls after a synchronous action failure and permits retry", async ({
    page,
}) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent(`<!doctype html><html><body><main id="registry"><h3>9月27日</h3>
        <table class="acgnom-table"><tbody>
            <tr><th scope="row" rowspan="2" style="background: #ffffb999">One</th><td>Request</td></tr>
            <tr><td><span class="mw-notalk">此提名尚未核對。</span></td></tr>
        </tbody></table>
    </main></body></html>`);
    await loadRegistryRuntime(page);
    await page.evaluate(() => {
        const global = window as any;
        global.registryFixture = global.AcgaRegistryUI.mount(
            document.getElementById("registry"),
            { failEditOnce: true },
        );
    });
    const edit = page.getByRole("button", { name: "修改提名", exact: true });
    await edit.click();
    await expect(edit).toBeEnabled();
    await expect(page.getByRole("checkbox")).toBeEnabled();
    await expect(page.getByRole("status")).toBeEmpty();
    expect(
        await page.evaluate(
            () => (window as any).registryFixture.effects.errors,
        ),
    ).toEqual(["Error: edit offline"]);
    expect(
        await page.evaluate(
            () => (window as any).registryFixture.effects.notices,
        ),
    ).toHaveLength(1);
    await edit.click();
    await expect(edit).toBeEnabled();
    expect(
        await page.evaluate(
            () => (window as any).registryFixture.effects.edits,
        ),
    ).toHaveLength(2);
    expect(errors).toEqual([]);
});

test("registry row batch actions use only selections and preserve them after failure", async ({
    page,
}) => {
    await page.setContent(`<!doctype html><html><body><main id="registry"><h3>9月27日</h3>
        <table class="acgnom-table"><tbody>
            <tr><th scope="row" rowspan="2" style="background: #ffffb999">One</th><td>Request</td></tr><tr><td><span class="mw-notalk">此提名尚未核對。</span></td></tr>
            <tr><th scope="row" rowspan="2" style="background: #ffffb999">Two</th><td>Request</td></tr><tr><td><span class="mw-notalk">此提名尚未核對。</span></td></tr>
        </tbody></table>
    </main></body></html>`);
    await loadRegistryRuntime(page);
    await page.evaluate(() => {
        const global = window as any;
        global.registryFixture = global.AcgaRegistryUI.mount(
            document.getElementById("registry"),
            { deferredBatch: true },
        );
    });
    const choices = page.getByRole("checkbox", {
        name: "加入批量核對",
        exact: true,
    });
    const cells = page.locator(".mw-notalk").locator("xpath=parent::td");
    const originalBackgrounds = await cells.evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).backgroundColor),
    );
    await page.getByText("加入批量核對", { exact: true }).first().click();
    await expect(choices.nth(0)).toBeChecked();
    await expect(choices.nth(1)).not.toBeChecked();
    await expect(cells.nth(0)).not.toHaveCSS(
        "background-color",
        originalBackgrounds[0]!,
    );
    await expect(cells.nth(1)).toHaveCSS(
        "background-color",
        originalBackgrounds[1]!,
    );
    const selectedBackground = await cells
        .nth(0)
        .evaluate((element) => getComputedStyle(element).backgroundColor);
    const batches = page.getByRole("button", {
        name: "批量核對",
        exact: true,
    });
    await expect(batches).toHaveCount(2);
    await batches.nth(1).click();
    await expect(batches.nth(0)).toBeDisabled();
    await expect(batches.nth(1)).toBeDisabled();
    await expect(choices.nth(0)).toBeDisabled();
    await expect(choices.nth(1)).toBeDisabled();
    await choices.nth(0).dispatchEvent("click");
    await expect(choices.nth(0)).toBeChecked();
    await batches.nth(0).dispatchEvent("click");
    expect(
        await page.evaluate(
            () => (window as any).registryFixture.effects.batches,
        ),
    ).toEqual([[expect.objectContaining({ index: 1, sectionOccurrence: 0 })]]);
    expect(
        await page.evaluate(
            () => (window as any).registryFixture.effects.checks,
        ),
    ).toEqual([]);

    await page.evaluate(() => (window as any).registryFixture.rejectBatch());
    await expect(batches.nth(1)).toBeEnabled();
    await expect(choices.nth(0)).toBeEnabled();
    await expect(choices.nth(0)).toBeChecked();
    await expect(choices.nth(1)).not.toBeChecked();
    await expect(cells.nth(0)).toHaveCSS(
        "background-color",
        selectedBackground,
    );
    await expect(page.getByRole("status")).toHaveText("已選擇 1 項");
    expect(
        await page.evaluate(
            () => (window as any).registryFixture.effects.errors,
        ),
    ).toEqual(["Error: batch offline"]);
    expect(
        await page.evaluate(
            () => (window as any).registryFixture.effects.notices,
        ),
    ).toHaveLength(1);

    await batches.nth(1).click();
    await page.evaluate(() => (window as any).registryFixture.resolveBatch());
    await expect(batches).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: "核對", exact: true }),
    ).toHaveCount(2);
    await expect(choices.nth(0)).not.toBeChecked();
    await expect(choices.nth(1)).not.toBeChecked();
    for (const [index, background] of originalBackgrounds.entries()) {
        await expect(cells.nth(index)).toHaveCSS(
            "background-color",
            background,
        );
    }
    await expect(page.getByRole("status")).toBeEmpty();
    expect(
        await page.evaluate(
            () => (window as any).registryFixture.effects.batches,
        ),
    ).toEqual([
        [expect.objectContaining({ index: 1, sectionOccurrence: 0 })],
        [expect.objectContaining({ index: 1, sectionOccurrence: 0 })],
    ]);

    await choices.nth(1).click();
    await batches.nth(0).click();
    await page.evaluate(() => {
        const fixture = (window as any).registryFixture;
        fixture.dispose();
        fixture.resolveBatch();
    });
    await expect(page.locator("#registry button, #registry input")).toHaveCount(
        0,
    );
    await expect(page.locator("style[data-registry-fixture]")).toHaveCount(0);
    for (const [index, background] of originalBackgrounds.entries()) {
        await expect(cells.nth(index)).toHaveCSS(
            "background-color",
            background,
        );
    }
});

test("registry compact buttons and batch checkboxes support keyboard actions and cell highlighting", async ({
    page,
}) => {
    await page.setContent(`<!doctype html><html lang="zh-Hant"><body><main id="registry"><h3>9月27日</h3>
        <table class="acgnom-table"><tbody>
            <tr><th scope="row" rowspan="2" style="background: #ffffb999">One</th><td>Request</td></tr><tr><td style="background-color: rgb(255, 244, 204)"><span class="mw-notalk">此提名尚未核對。</span></td></tr>
        </tbody></table>
    </main></body></html>`);
    await loadRegistryRuntime(page);
    await page.evaluate(() => {
        const global = window as any;
        global.registryFixture = global.AcgaRegistryUI.mount(
            document.getElementById("registry"),
        );
    });
    const edit = page.getByRole("button", { name: "修改提名", exact: true });
    const check = page.getByRole("button", { name: "核對", exact: true });
    const choice = page.getByRole("checkbox", {
        name: "加入批量核對",
        exact: true,
    });
    for (const button of [edit, check]) {
        const box = await button.boundingBox();
        expect(box!.height).toBe(23);
        await expect(button).toHaveCSS("min-height", "23px");
        await expect(button).toHaveCSS("font-size", "12px");
        await expect(button).toHaveAttribute("type", "button");
        expect(
            await button.evaluate(
                (element) => getComputedStyle(element).borderColor,
            ),
        ).not.toBe("rgba(0, 0, 0, 0)");
    }
    await expect(page.locator(".acga-registry-controls")).toHaveCSS(
        "column-gap",
        "12px",
    );
    await expect(page.locator(".acga-registry-controls")).toHaveCSS(
        "display",
        "inline-flex",
    );
    const editControl = page.locator(".acga-registry-edit-control");
    await expect(editControl).toHaveCSS("display", "block");
    await expect(editControl).toHaveCSS("text-align", "center");
    await expect(editControl).toHaveCSS("margin-top", "0px");
    await expect(page.locator('#registry [class*="cdx-"]')).toHaveCount(0);
    for (const fontSize of [null, "14px", "18px", "12px"]) {
        await page.evaluate((fontSize) => {
            const style = document.documentElement.style;
            if (fontSize) style.setProperty("--font-size-medium", fontSize);
            else style.removeProperty("--font-size-medium");
        }, fontSize);
        const [buttonBox, checkboxBox] = await Promise.all([
            check.boundingBox(),
            choice.boundingBox(),
        ]);
        expect(buttonBox!.height).toBe(23);
        expect(buttonBox!.y + buttonBox!.height / 2).toBeCloseTo(
            checkboxBox!.y + checkboxBox!.height / 2,
            1,
        );
    }
    await page.evaluate(() =>
        document.documentElement.style.removeProperty("--font-size-medium"),
    );
    const editPosition = await edit.evaluate((element) => {
        const heading = element.closest("th")!;
        const text = document.createRange();
        text.selectNode(heading.firstChild!);
        const textBounds = text.getBoundingClientRect();
        const headingBounds = heading.getBoundingClientRect();
        const bounds = element.getBoundingClientRect();
        return {
            top: bounds.top,
            textBottom: textBounds.bottom,
            center: bounds.x + bounds.width / 2,
            headingCenter: headingBounds.x + headingBounds.width / 2,
        };
    });
    expect(editPosition.top).toBeGreaterThan(editPosition.textBottom);
    expect(editPosition.center).toBeCloseTo(editPosition.headingCenter, 0);
    const neutralColor = await edit.evaluate(
        (element) => getComputedStyle(element).color,
    );
    expect(
        await check.evaluate((element) => getComputedStyle(element).color),
    ).not.toBe(neutralColor);
    const cell = page.locator(".mw-notalk").locator("xpath=parent::td");
    const unselectedBackground = await cell.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
    );

    await edit.focus();
    await edit.press("Enter");
    await expect(edit).toBeEnabled();
    await choice.focus();
    await choice.press("Space");
    await expect(choice).toBeChecked();
    await expect(page.getByRole("status")).toHaveText("已選擇 1 項");
    await expect(cell).not.toHaveCSS("background-color", unselectedBackground);
    await choice.press("Space");
    await expect(choice).not.toBeChecked();
    await expect(page.getByRole("status")).toBeEmpty();
    await expect(cell).toHaveCSS("background-color", unselectedBackground);
    await choice.press("Space");
    await expect(choice).toBeChecked();
    await page
        .getByRole("button", { name: "批量核對", exact: true })
        .press("Space");
    await expect(choice).not.toBeChecked();
    await expect(cell).toHaveCSS("background-color", unselectedBackground);
    await expect(check).toBeEnabled();
    await check.press("Enter");
    await expect(check).toBeEnabled();

    const effects = await page.evaluate(
        () => (window as any).registryFixture.effects,
    );
    expect(effects.edits).toEqual([
        expect.objectContaining({ index: 1, sectionOccurrence: 0 }),
    ]);
    expect(effects.batches).toEqual([
        [expect.objectContaining({ index: 1, sectionOccurrence: 0 })],
    ]);
    expect(effects.checks).toEqual([
        expect.objectContaining({ index: 1, sectionOccurrence: 0 }),
    ]);
    await choice.check();
    await expect(cell).not.toHaveCSS("background-color", unselectedBackground);
    await page.evaluate(() => (window as any).registryFixture.dispose());
    await expect(cell).toHaveCSS("background-color", unselectedBackground);
    await expect(cell).not.toHaveClass(/acga-registry-selected/u);
    await expect(cell).toHaveAttribute(
        "style",
        "background-color: rgb(255, 244, 204)",
    );
});

test("registry omits repeated recipient-target notices from the page", async ({
    page,
}) => {
    await page.setContent(`<!doctype html><html><body><main id="registry">
        <h3>9月27日</h3>
        <table class="acgnom-table" id="one"><tr><th scope="row" rowspan="2" style="background: #ffffb999">One</th><td>Request</td></tr><tr><td><span class="mw-notalk">此提名尚未核對。</span></td></tr></table>
        <h3>9月27日</h3>
        <table class="acgnom-table" id="two"><tr><th scope="row" rowspan="2">Two</th><td>Request</td></tr><tr><td><span class="mw-notalk">此提名尚未核對。</span></td></tr></table>
        <table class="acgnom-table" id="other"><tr><th scope="row" rowspan="2" style="background: #ffffb999">Other recipient</th><td>Request</td></tr><tr><td><span class="mw-notalk">此提名尚未核對。</span></td></tr></table>
    </main></body></html>`);
    await loadRegistryRuntime(page);
    await page.evaluate(() => {
        const global = window as any;
        const base = {
            pageName: "Example article",
            awarder: "Editor<script>inert</script>",
            date: "9月27日",
            dateLabel: "9月27日",
            dateAnchor: "9月27日",
            reasonText: "1c(plain <img src=x>)",
            checked: false,
        };
        global.registryFixture = global.AcgaRegistryUI.mount(
            document.getElementById("registry"),
            {
                nominations: [
                    { ...base, index: 1, sectionOccurrence: 0 },
                    {
                        ...base,
                        index: 1,
                        sectionOccurrence: 1,
                        dateAnchor: "9月27日_2",
                        checked: true,
                    },
                    {
                        ...base,
                        awarder: "Other",
                        index: 2,
                        sectionOccurrence: 1,
                    },
                ],
            },
        );
    });
    await expect(page.locator(".acga-registry-duplicate")).toHaveCount(0);
    await expect(page.getByRole("note")).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: "核對", exact: true }),
    ).toHaveCount(2);
    await expect(
        page.locator("#two").getByRole("button", {
            name: "複核",
            exact: true,
        }),
    ).toBeEnabled();
    expect(
        await page.evaluate(
            () => (window as any).registryFixture.effects.eligibilityRequests,
        ),
    ).toEqual([[undefined, 42]]);
    await page.evaluate(() => (window as any).registryFixture.dispose());
    await expect(page.locator(".acga-registry-duplicate")).toHaveCount(0);
});

test("registry disables self checks with reason tooltips and excludes them from batches", async ({
    page,
}) => {
    await page.setContent(`<!doctype html><html><body><main id="registry"><h3>9月27日</h3>
        <table class="acgnom-table"><tbody>
            <tr><th scope="row" rowspan="2" style="background: #ffffb999">Own nomination</th><td>Request</td></tr><tr><td><span class="mw-notalk">此提名尚未核對。</span></td></tr>
            <tr><th scope="row" rowspan="2" style="background: #ffffb999">Own score</th><td>Request</td></tr><tr><td><span class="mw-notalk">此提名尚未核對。</span></td></tr>
            <tr><th scope="row" rowspan="2" style="background: #ffffb999">Own nomination and score</th><td>Request</td></tr><tr><td><span class="mw-notalk">此提名尚未核對。</span></td></tr>
            <tr><th scope="row" rowspan="2" style="background: #ffffb999">Other editors</th><td>Request</td></tr><tr><td><span class="mw-notalk">此提名尚未核對。</span></td></tr>
        </tbody></table>
    </main></body></html>`);
    await loadRegistryRuntime(page);
    await page.evaluate(() => {
        const global = window as any;
        const base = {
            pageName: "Example article",
            date: "9月27日",
            sectionOccurrence: 0,
            dateLabel: "9月27日",
            dateAnchor: "9月27日",
            reasonText: "7",
            checked: false,
        };
        global.registryFixture = global.AcgaRegistryUI.mount(
            document.getElementById("registry"),
            {
                userName: "Example_User",
                nominations: [
                    {
                        ...base,
                        index: 1,
                        awarder: "Other",
                        nominator: "User:Example User",
                    },
                    {
                        ...base,
                        index: 2,
                        awarder: "example User",
                        nominator: "Other",
                    },
                    {
                        ...base,
                        index: 3,
                        awarder: "Example User",
                        nominator: "Example_User",
                    },
                    {
                        ...base,
                        index: 4,
                        awarder: "Other",
                        nominator: "Another",
                    },
                ],
            },
        );
    });
    const checks = page.getByRole("button", { name: "核對", exact: true });
    const reasons = [
        "提名者為本人，無法核對",
        "得分者為本人，無法核對",
        "提名者及得分者為本人，無法核對",
    ];
    for (const [index, reason] of reasons.entries()) {
        await expect(checks.nth(index)).toBeDisabled();
        await expect(checks.nth(index)).toHaveAttribute("title", reason);
    }
    await expect(checks.nth(3)).toBeEnabled();
    await expect(page.locator(".acga-registry-duplicate")).toHaveCount(0);
    await checks.nth(0).dispatchEvent("click");
    await checks.nth(1).dispatchEvent("click");
    await checks.nth(2).dispatchEvent("click");
    expect(
        await page.evaluate(
            () => (window as any).registryFixture.effects.checks,
        ),
    ).toEqual([]);

    await checks.nth(3).click();
    await expect(checks.nth(3)).toBeEnabled();
    await expect(checks.nth(0)).toBeDisabled();
    const choices = page.getByRole("checkbox", {
        name: "加入批量核對",
        exact: true,
    });
    for (const [index, reason] of reasons.entries()) {
        await expect(choices.nth(index)).toBeDisabled();
        await expect(choices.nth(index)).toHaveAttribute("title", reason);
        await expect(
            choices.nth(index).locator("xpath=ancestor::label"),
        ).toHaveAttribute("title", reason);
    }
    await choices.nth(0).dispatchEvent("click");
    await expect(choices.nth(0)).not.toBeChecked();
    await expect(page.getByRole("status")).toBeEmpty();
    await choices.nth(3).click();
    const batches = page.getByRole("button", {
        name: "批量核對",
        exact: true,
    });
    await expect(batches).toHaveCount(4);
    for (const [index, reason] of reasons.entries()) {
        await expect(batches.nth(index)).toBeDisabled();
        await expect(batches.nth(index)).toHaveAttribute("title", reason);
    }
    await batches.nth(0).dispatchEvent("click");
    expect(
        await page.evaluate(
            () => (window as any).registryFixture.effects.batches,
        ),
    ).toEqual([]);
    await batches.nth(3).click();
    await expect(page.getByRole("status")).toBeEmpty();
    const effects = await page.evaluate(
        () => (window as any).registryFixture.effects,
    );
    expect(effects.checks).toEqual([
        expect.objectContaining({ index: 4, sectionOccurrence: 0 }),
    ]);
    expect(effects.batches).toEqual([
        [expect.objectContaining({ index: 4, sectionOccurrence: 0 })],
    ]);
    expect(effects.eligibilityRequests).toEqual([[undefined, 42]]);
    expect(effects.errors).toEqual([]);
    await expect(checks.nth(0)).toBeDisabled();
    await expect(
        page.getByRole("button", { name: "修改提名", exact: true }).first(),
    ).toBeEnabled();
});

test("registry uses only yellow headers for pending controls before and after source lookup", async ({
    page,
}) => {
    await page.setContent(`<!doctype html><html lang="zh-Hant"><body><main id="registry"><h3>9月27日</h3>
        <table class="acgnom-table"><tbody>
            <tr><th scope="row" rowspan="2">Reviewed</th><td>Request</td></tr>
            <tr><td><div class="mw-notalk"><img alt="✓">符合要求，<b>得1分</b>。此前顯示「此提名尚未核对。」--Reviewer</div></td></tr>
            <tr><th scope="row" rowspan="2" style="background: #ffffb999">Pending simplified</th><td>Request</td></tr>
            <tr><td><div class="mw-notalk"><img alt="🕒">此提名尚未核对。
                <table class="acgnom-table"><tr><td><div class="mw-notalk"><img alt="✓">Nested review example</div></td></tr></table>
            </div></td></tr>
            <tr><th scope="row" rowspan="2" style="background: #ffffb999">Pending traditional</th><td>Request</td></tr>
            <tr><td><div class="mw-notalk"> 此提名<span>尚未</span> 核對。 </div></td></tr>
            <tr><th scope="row" rowspan="2" style="background: #ffffb999">Pending variant</th><td>Request</td></tr>
            <tr><td><div class="mw-notalk"><img alt="✓">已核對，得4分。--Reviewer</div></td></tr>
            <tr><th scope="row" rowspan="2">Uncolored placeholder</th><td>Request</td></tr>
            <tr><td><div class="mw-notalk"><img alt="🕒">此提名尚未核对。</div></td></tr>
            <tr><th scope="row" rowspan="2" style="background: #ffb9ff99">Rechecking</th><td>Request</td></tr>
            <tr><td>已核對，細節見討論。--Reviewer</td></tr>
            <tr><th scope="row" rowspan="2">Empty</th><td>Request</td></tr>
            <tr><td><div class="mw-notalk"> </div></td></tr>
        </tbody></table>
    </main></body></html>`);
    await loadRegistryRuntime(page);
    const initial = await page.evaluate(() => {
        const global = window as any;
        global.registryFixture = global.AcgaRegistryUI.mount(
            document.getElementById("registry"),
            { deferredLookup: true },
        );
        return Array.from(
            document.querySelectorAll<HTMLButtonElement>(
                ".acga-registry-controls > button",
            ),
            (button) => ({
                label: button.textContent,
                progressive: button.classList.contains(
                    "acga-registry-emphasized",
                ),
                disabled: button.disabled,
                hasCheckbox: Boolean(
                    button.parentElement?.querySelector(
                        'input[type="checkbox"]',
                    ),
                ),
            }),
        );
    });
    expect(initial).toEqual(
        [true, false, false, false, true, true, true].map((checked) => ({
            label: checked ? "複核" : "核對",
            progressive: !checked,
            disabled: true,
            hasCheckbox: !checked,
        })),
    );
    await page
        .getByRole("button", { name: "複核", exact: true })
        .first()
        .dispatchEvent("click");
    expect(
        await page.evaluate(
            () => (window as any).registryFixture.effects.checks,
        ),
    ).toEqual([]);

    // Source eligibility must not replace the rendered header classification.
    await page.evaluate(() => {
        (window as any).registryFixture.resolveEligibility(
            [false, true, true, true, false, false, false].map(
                (checked, index) => ({
                    pageName: "Example",
                    awarder: "Recipient",
                    nominator: "Nominator",
                    date: "9月27日",
                    index: index + 1,
                    sectionOccurrence: 0,
                    checked,
                }),
            ),
        );
    });
    const buttons = page.locator(".acga-registry-controls > button");
    const controls = page.locator(".acga-registry-controls");
    await expect(buttons).toHaveText([
        "複核",
        "核對",
        "核對",
        "核對",
        "複核",
        "複核",
        "複核",
    ]);
    for (const [index, checked] of [
        true,
        false,
        false,
        false,
        true,
        true,
        true,
    ].entries()) {
        await expect(buttons.nth(index)).toBeEnabled();
        const choice = controls.nth(index).locator('input[type="checkbox"]');
        await expect(choice).toHaveCount(checked ? 0 : 1);
        if (checked)
            await expect(buttons.nth(index)).not.toHaveClass(
                /acga-registry-emphasized/u,
            );
        else {
            await expect(buttons.nth(index)).toHaveClass(
                /acga-registry-emphasized/u,
            );
            await expect(choice).toHaveAccessibleName("加入批量核對");
            await expect(choice).toBeEnabled();
        }
    }
    await controls.nth(1).getByRole("checkbox").check();
    await buttons.nth(1).click();
    await expect(buttons.nth(0)).toBeEnabled();
    await buttons.nth(0).click();
    await expect(buttons.nth(0)).toBeEnabled();
    const effects = await page.evaluate(
        () => (window as any).registryFixture.effects,
    );
    expect(effects.batches).toEqual([
        [expect.objectContaining({ index: 2, sectionOccurrence: 0 })],
    ]);
    expect(effects.checks).toEqual([
        expect.objectContaining({ index: 1, sectionOccurrence: 0 }),
    ]);
});

test("registry keeps the live yellow nomination pending when source eligibility says checked", async ({
    page,
}) => {
    await page.setContent(`<!doctype html><html lang="zh-Hans"><body><main id="registry"><h3>9月27日</h3>
        <table class="wikitable plain-row-headers skin-invert acgnom-table" style="font-size: 90%; width: 100%; margin-bottom: 0;"><tbody>
            <tr><th scope="col" style="width: 25%;">條目</th><th scope="col" style="width: 25%;">獲提名者</th><th scope="col">提名內容</th></tr>
            <tr>
                <th rowspan="2" scope="row" style="text-align: center; background: #ffffb999;"><b><a href="/wiki/超閾限空間" title="超閾限空間">超閾限空間</a></b></th>
                <td><a href="/wiki/User:菜國人" title="User:菜國人">菜國人</a><span class="plainlinks" style="font-size: smaller; user-select: none;">［41分］</span></td>
                <td><span style="margin-right: 0.2em; font-weight: bold;">1</span><small title="3分">長新增</small>、<span style="margin-right: 0.2em; font-weight: bold;">3</span><small title="1分">格式</small>，計4分</td>
            </tr>
            <tr><td colspan="2"><div class="mw-notalk"><span typeof="mw:File"><span><img alt="🕒" width="13" height="13" class="mw-file-element"></span></span> 此提名尚未核对。</div></td></tr>
        </tbody></table>
    </main></body></html>`);
    await loadRegistryRuntime(page);
    await page.evaluate(() => {
        const global = window as any;
        global.registryFixture = global.AcgaRegistryUI.mount(
            document.getElementById("registry"),
            { language: "zh-Hans", deferredLookup: true },
        );
    });
    const check = page.getByRole("button", { name: "核对", exact: true });
    const choice = page.getByRole("checkbox", {
        name: "加入批量核对",
        exact: true,
    });
    const archive = page.getByRole("button", { name: "归档", exact: true });
    await expect(check).toHaveCount(1);
    await expect(check).toBeDisabled();
    await expect(choice).toHaveCount(1);
    await expect(choice).toBeDisabled();
    await expect(archive).toBeDisabled();

    await page.evaluate(() => {
        const global = window as any;
        global.registryFixture.resolveEligibility([
            {
                pageName: "超閾限空間",
                awarder: "菜國人",
                date: "9月27日",
                index: 1,
                sectionOccurrence: 0,
                checked: true,
            },
        ]);
    });
    await expect(check).toBeEnabled();
    await expect(check).toHaveClass(/acga-registry-emphasized/u);
    await expect(choice).toBeEnabled();
    await expect(
        page.getByRole("button", { name: "复核", exact: true }),
    ).toHaveCount(0);
    await expect(archive).toBeDisabled();
    await expect(archive).toHaveAttribute("title", "仍有尚未核对的提名。");
    await choice.check();
    await page.getByRole("button", { name: "批量核对", exact: true }).click();
    await expect(check).toBeEnabled();
    await expect(choice).not.toBeChecked();
    await expect(archive).toBeDisabled();
    const effects = await page.evaluate(
        () => (window as any).registryFixture.effects,
    );
    expect(effects.batches).toEqual([
        [
            {
                date: "9月27日",
                index: 1,
                sectionOccurrence: 0,
                expectedRevisionId: 42,
            },
        ],
    ]);
    expect(effects.checks).toEqual([]);
    expect(effects.eligibilityRequests).toEqual([[undefined, 42]]);
    expect(effects.errors).toEqual([]);
});

test("registry labels reviewed entries as rechecks and keeps their eligibility restrictions", async ({
    page,
}) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent(`<!doctype html><html lang="zh-Hant"><body><main id="registry"><h3>9月27日</h3>
        <table class="acgnom-table"><tbody>
            <tr><th scope="row" rowspan="2">Reviewed by another editor</th><td>Request</td></tr><tr><td><span>Previous review and signature</span></td></tr>
            <tr><th scope="row" rowspan="2">Own reviewed nomination</th><td>Request</td></tr><tr><td><span class="mw-notalk">Pending</span></td></tr>
            <tr><th scope="row" rowspan="2">Own reviewed score</th><td>Request</td></tr><tr><td><span class="mw-notalk">Pending</span></td></tr>
            <tr><th scope="row" rowspan="2" style="background: #ffffb999">Pending other editors</th><td>Request</td></tr><tr><td><span class="mw-notalk">Reviewed</span></td></tr>
        </tbody></table>
    </main></body></html>`);
    await loadRegistryRuntime(page);
    await page.evaluate(() => {
        const global = window as any;
        const base = {
            pageName: "Example article",
            awarder: "Recipient",
            nominator: "Nominator",
            date: "9月27日",
            sectionOccurrence: 0,
            dateLabel: "9月27日",
            dateAnchor: "9月27日",
            reasonText: "1c",
            checked: true,
        };
        global.registryFixture = global.AcgaRegistryUI.mount(
            document.getElementById("registry"),
            {
                userName: "Reviewer",
                nominations: [
                    { ...base, index: 1 },
                    { ...base, index: 2, nominator: "Reviewer" },
                    { ...base, index: 3, awarder: "Reviewer" },
                    { ...base, index: 4, checked: false },
                ],
            },
        );
    });
    const rechecks = page.getByRole("button", {
        name: "複核",
        exact: true,
    });
    const check = page.getByRole("button", { name: "核對", exact: true });
    await expect(rechecks).toHaveCount(3);
    await expect(rechecks.nth(0)).toBeEnabled();
    await expect(rechecks.nth(1)).toBeDisabled();
    await expect(rechecks.nth(1)).toHaveAttribute(
        "title",
        "提名者為本人，無法核對",
    );
    await expect(rechecks.nth(2)).toBeDisabled();
    await expect(rechecks.nth(2)).toHaveAttribute(
        "title",
        "得分者為本人，無法核對",
    );
    await expect(check).toBeEnabled();
    const firstControls = page.locator(".acga-registry-controls").first();
    await expect(firstControls).toHaveJSProperty("tagName", "SPAN");
    await expect(firstControls).toHaveCSS("display", "inline-flex");
    await expect(firstControls.locator("xpath=parent::td")).toContainText(
        "Previous review and signature",
    );
    const reviewCell = firstControls.locator("xpath=parent::td");
    const reviewBackground = await reviewCell.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
    );
    const recheckHeight = (await rechecks.nth(0).boundingBox())!.height;
    expect(recheckHeight).toBe(23);
    await expect(rechecks.nth(0)).toHaveCSS("min-height", "23px");
    await expect(rechecks.nth(0)).toHaveCSS("font-size", "12px");
    const neutralColor = await page
        .getByRole("button", { name: "修改提名", exact: true })
        .first()
        .evaluate((element) => getComputedStyle(element).color);
    await expect(rechecks.nth(0)).toHaveCSS("color", neutralColor);
    const controlsPosition = await firstControls.evaluate((element) => {
        const text = document.createRange();
        text.selectNode(element.previousSibling!);
        const textBounds = text.getBoundingClientRect();
        const bounds = element.getBoundingClientRect();
        return {
            left: bounds.left,
            rightOfText: textBounds.right,
            top: bounds.top,
            bottom: bounds.bottom,
            textTop: textBounds.top,
            textBottom: textBounds.bottom,
        };
    });
    expect(controlsPosition.left).toBeGreaterThan(controlsPosition.rightOfText);
    expect(controlsPosition.top).toBeLessThan(controlsPosition.textBottom);
    expect(controlsPosition.bottom).toBeGreaterThan(controlsPosition.textTop);
    const controls = page.locator(".acga-registry-controls");
    for (const index of [0, 1, 2])
        await expect(
            controls.nth(index).locator('input[type="checkbox"], label'),
        ).toHaveCount(0);
    const choice = page.getByRole("checkbox", {
        name: "加入批量核對",
        exact: true,
    });
    await expect(choice).toHaveCount(1);
    await choice.check();
    const batch = page.getByRole("button", {
        name: "批量核對",
        exact: true,
    });
    await expect(batch).toBeEnabled();
    await expect(rechecks.nth(0)).toBeDisabled();
    await expect(rechecks.nth(0)).toHaveAttribute(
        "title",
        "批量核對期間無法複核，請先取消所有勾選。",
    );
    await expect(rechecks.nth(1)).toBeDisabled();
    await expect(rechecks.nth(2)).toBeDisabled();
    await expect(rechecks.nth(0)).not.toHaveClass(/acga-registry-emphasized/u);
    await expect(rechecks.nth(1)).toHaveAttribute(
        "title",
        "提名者為本人，無法核對",
    );
    for (const index of [0, 1, 2])
        await rechecks.nth(index).dispatchEvent("click");
    expect(
        await page.evaluate(
            () => (window as any).registryFixture.effects.checks,
        ),
    ).toEqual([]);
    await choice.uncheck();
    await expect(rechecks.nth(0)).toBeEnabled();
    await expect(rechecks.nth(0)).toHaveCSS("color", neutralColor);
    await expect(rechecks.nth(0)).not.toHaveAttribute("title");
    await expect(rechecks.nth(1)).toBeDisabled();
    await expect(rechecks.nth(1)).toHaveAttribute(
        "title",
        "提名者為本人，無法核對",
    );
    await expect(rechecks.nth(2)).toBeDisabled();
    await expect(rechecks.nth(2)).toHaveAttribute(
        "title",
        "得分者為本人，無法核對",
    );
    await rechecks.nth(0).click();
    await expect(rechecks.nth(0)).toBeEnabled();
    await expect(choice).not.toBeChecked();
    await expect(page.getByRole("status")).toBeEmpty();
    await expect(reviewCell).toHaveCSS("background-color", reviewBackground);
    await capture(page, "registry-recheck-inline");
    await choice.check();
    await batch.click();
    await expect(rechecks).toHaveCount(3);
    await expect(rechecks.nth(0)).toBeEnabled();
    await expect(rechecks.nth(1)).toBeDisabled();
    await expect(rechecks.nth(1)).toHaveAttribute(
        "title",
        "提名者為本人，無法核對",
    );
    await expect(rechecks.nth(2)).toBeDisabled();
    await expect(rechecks.nth(2)).toHaveAttribute(
        "title",
        "得分者為本人，無法核對",
    );
    await expect(rechecks.nth(0)).not.toHaveClass(/acga-registry-emphasized/u);
    await expect(rechecks.nth(0)).toHaveCSS("color", neutralColor);
    await expect(check).toBeEnabled();
    await expect(choice).toBeEnabled();
    await expect(check).not.toHaveAttribute("title");
    await expect(choice).not.toBeChecked();
    await expect(page.getByRole("status")).toBeEmpty();
    await expect(reviewCell).toHaveCSS("background-color", reviewBackground);
    const effects = await page.evaluate(
        () => (window as any).registryFixture.effects,
    );
    expect(effects.checks).toEqual([
        expect.objectContaining({ index: 1, sectionOccurrence: 0 }),
    ]);
    expect(effects.batches).toEqual([
        [expect.objectContaining({ index: 4, sectionOccurrence: 0 })],
    ]);
    expect(effects.errors).toEqual([]);
    expect(errors).toEqual([]);
});

test("registry disables single rechecks during pending batch selection and restores controls", async ({
    page,
}) => {
    await page.setContent(`<!doctype html><html lang="zh-Hans"><body><main id="registry"><h3>9月27日</h3>
        <table class="acgnom-table"><tbody>
            <tr><th scope="row" rowspan="2" style="background: #ffffb999">Pending one</th><td>Request</td></tr><tr><td><div class="mw-notalk"><img alt="🕒">此提名尚未核对。</div></td></tr>
            <tr><th scope="row" rowspan="2" style="background: #ffffb999">Pending two</th><td>Request</td></tr><tr><td><div class="mw-notalk"><img alt="🕒">此提名尚未核对。</div></td></tr>
            <tr><th scope="row" rowspan="2">Reviewed one</th><td>Request</td></tr><tr><td><div class="mw-notalk"><img alt="✓">符合要求，得1分。--Reviewer</div></td></tr>
            <tr><th scope="row" rowspan="2">Reviewed two</th><td>Request</td></tr><tr><td><div class="mw-notalk"><img alt="✗">不得分。--Reviewer</div></td></tr>
        </tbody></table>
    </main></body></html>`);
    await loadRegistryRuntime(page);
    await page.evaluate(() => {
        const global = window as any;
        global.registryFixture = global.AcgaRegistryUI.mount(
            document.getElementById("registry"),
            { language: "zh-Hans", deferredBatch: true },
        );
    });
    const buttons = page.locator(".acga-registry-controls > button");
    const choices = page.locator(".acga-registry-select");
    const controls = page.locator(".acga-registry-controls");
    const status = page.getByRole("status");
    const tooltip = "批量核对期间无法复核，请先取消所有勾选。";
    const neutralColor = await page
        .getByRole("button", { name: "修改提名", exact: true })
        .first()
        .evaluate((element) => getComputedStyle(element).color);
    await expect(buttons).toHaveText(["核对", "核对", "复核", "复核"]);
    await expect(choices).toHaveCount(2);
    for (const index of [0, 1])
        await expect(choices.nth(index)).toHaveAccessibleName("加入批量核对");
    for (const index of [2, 3]) {
        await expect(
            controls.nth(index).locator('input[type="checkbox"], label'),
        ).toHaveCount(0);
        await expect(buttons.nth(index)).toHaveCSS("color", neutralColor);
    }
    await buttons.nth(2).click();
    await expect(buttons.nth(2)).toBeEnabled();

    await choices.nth(0).check();
    await expect(buttons).toHaveText(["批量核对", "批量核对", "复核", "复核"]);
    for (const index of [2, 3]) {
        await expect(buttons.nth(index)).toBeDisabled();
        await expect(buttons.nth(index)).toHaveAttribute("title", tooltip);
        await expect(buttons.nth(index)).not.toHaveClass(
            /acga-registry-emphasized/u,
        );
        await buttons.nth(index).dispatchEvent("click");
    }
    await choices.nth(1).check();
    await expect(status).toHaveText("已选择 2 项");
    await expect(buttons.nth(0)).toHaveClass(/acga-registry-emphasized/u);
    await choices.nth(0).uncheck();
    await expect(buttons.nth(2)).toBeDisabled();
    await choices.nth(1).uncheck();
    for (const index of [0, 1, 2, 3]) {
        await expect(buttons.nth(index)).toBeEnabled();
        await expect(buttons.nth(index)).not.toHaveAttribute("title");
    }
    for (const index of [0, 1]) {
        await expect(choices.nth(index)).toBeEnabled();
        await expect(choices.nth(index)).not.toHaveAttribute("title");
    }

    await choices.nth(0).check();
    await choices.nth(1).check();
    await buttons.nth(0).click();
    await expect(buttons.nth(1)).toBeDisabled();
    await expect(buttons.nth(3)).toBeDisabled();
    for (const index of [0, 1]) await expect(choices.nth(index)).toBeDisabled();
    await page.evaluate(() => (window as any).registryFixture.rejectBatch());
    for (const index of [0, 1]) {
        await expect(buttons.nth(index)).toBeEnabled();
        await expect(choices.nth(index)).toBeEnabled();
        await expect(choices.nth(index)).toBeChecked();
    }
    for (const index of [2, 3]) {
        await expect(buttons.nth(index)).toBeDisabled();
        await expect(buttons.nth(index)).toHaveAttribute("title", tooltip);
        await buttons.nth(index).dispatchEvent("click");
    }
    await expect(status).toHaveText("已选择 2 项");
    await capture(page, "registry-batch-disabled-rechecks");
    await buttons.nth(1).click();
    await page.evaluate(() => (window as any).registryFixture.resolveBatch());
    await expect(buttons).toHaveText(["核对", "核对", "复核", "复核"]);
    for (const index of [0, 1])
        await expect(choices.nth(index)).not.toBeChecked();
    for (const index of [0, 1, 2, 3]) {
        await expect(buttons.nth(index)).toBeEnabled();
        await expect(buttons.nth(index)).not.toHaveAttribute("title");
    }
    await expect(status).toBeEmpty();
    await buttons.nth(3).click();
    await expect(buttons.nth(3)).toBeEnabled();
    const effects = await page.evaluate(
        () => (window as any).registryFixture.effects,
    );
    expect(effects.checks).toEqual([
        expect.objectContaining({ index: 3, sectionOccurrence: 0 }),
        expect.objectContaining({ index: 4, sectionOccurrence: 0 }),
    ]);
    expect(
        effects.batches.map((batch: any[]) =>
            batch.map((item: any) => item.index),
        ),
    ).toEqual([
        [1, 2],
        [1, 2],
    ]);
    expect(effects.errors).toEqual(["Error: batch offline"]);
});

test("registry archive buttons follow header colors, check age and physical discussion sections", async ({
    page,
}) => {
    const oldCheck =
        "符合要求，得1分。--Reviewer 2026年9月20日 (日) 12:00 (UTC)";
    const recentCheck =
        "符合要求，得1分。--Reviewer 2026年9月25日 (五) 12:00 (UTC)";
    const entry = (result: string, color = "inherit") => `
        <tr><th scope="row" rowspan="2" style="background: ${color}">Article</th><td>Request</td></tr>
        <tr><td><div class="mw-notalk">${result}</div></td></tr>`;
    const chapter = (id: string, rows: string, discussion = "") => `
        <section id="${id}"><div class="mw-heading mw-heading3"><h3>9月20日</h3></div>
            <table class="acgnom-table"><tbody>${rows}</tbody></table>${discussion}
        </section>`;
    await page.setContent(`<!doctype html><html lang="zh-Hans"><body><main id="registry">
        ${chapter("ready", entry(oldCheck), "<p>Comment 2026年9月21日 (一) 12:00 (UTC)</p>")}
        ${chapter("recent-discussion", entry(oldCheck), "<dl><dd>Comment 2026年9月29日 (二) 12:00 (UTC)</dd></dl>")}
        ${chapter("recent-check", entry(oldCheck) + entry(recentCheck))}
        ${chapter("boundary", entry("Checked --Reviewer 2026年9月23日 (三) 12:00 (UTC)"))}
        ${chapter("pending", entry(oldCheck, "#ffffb999"))}
        ${chapter("rechecking", entry(oldCheck, "#ffb9ff99"))}
        ${chapter("unknown", entry("Checked with no readable timestamp"))}
        ${chapter("future", entry("Checked --Reviewer 2026年10月1日 (四) 12:00 (UTC)"))}
        ${chapter("replacement", entry(`<b>[已撤销]</b>${oldCheck}<dl><dd>${recentCheck}</dd></dl>`))}
        ${chapter("nested-example", entry(`${oldCheck}<table><tr><td>${recentCheck}</td></tr></table>`), "<pre>Comment 2026年9月29日 (二) 12:00 (UTC)</pre>")}
        ${chapter("empty", "")}
        <h2>Other content</h2><p>Outside comment 2026年9月30日 (三) 12:00 (UTC)</p>
    </main></body></html>`);
    await loadRegistryRuntime(page);
    await page.evaluate(() => {
        const global = window as any;
        global.registryFixture = global.AcgaRegistryUI.mount(
            document.getElementById("registry"),
            { language: "zh-Hans" },
        );
    });
    const archive = (id: string) =>
        page
            .locator(`#${id}`)
            .getByRole("button", { name: "归档", exact: true });
    for (const id of ["ready", "nested-example"]) {
        await expect(archive(id)).toBeEnabled();
        await expect(archive(id)).toHaveClass(/acga-registry-action/u);
        await expect(archive(id)).toHaveClass(/acga-registry-emphasized/u);
    }
    await expect(archive("recent-discussion")).toBeEnabled();
    await expect(archive("recent-discussion")).toHaveClass(
        /acga-registry-action/u,
    );
    await expect(archive("recent-discussion")).not.toHaveClass(
        /acga-registry-emphasized/u,
    );
    await expect(archive("recent-discussion")).toHaveAttribute(
        "title",
        "所有核对结果已超过七天，但此章节仍有近期讨论。",
    );
    const blocked = {
        "recent-check": "所有核对结果须已超过七天。",
        boundary: "所有核对结果须已超过七天。",
        pending: "仍有尚未核对的提名。",
        rechecking: "仍有正在复核的提名。",
        unknown: "无法读取核对时间。",
        future: "所有核对结果须已超过七天。",
        replacement: "所有核对结果须已超过七天。",
        empty: "此章节没有可归档的提名。",
    };
    for (const [id, reason] of Object.entries(blocked)) {
        await expect(archive(id)).toBeDisabled();
        await expect(archive(id)).toHaveAttribute("title", reason);
        await archive(id).dispatchEvent("click");
    }
    await expect(
        page
            .locator("#pending")
            .getByRole("button", { name: "核对", exact: true }),
    ).toBeEnabled();
    await expect(
        page
            .locator("#rechecking")
            .getByRole("button", { name: "复核", exact: true }),
    ).toBeEnabled();
    await capture(page, "registry-archive-eligibility");
    await archive("ready").click();
    await expect(archive("ready")).toBeEnabled();
    await archive("recent-discussion").click();
    await expect(archive("recent-discussion")).toBeEnabled();
    const effects = await page.evaluate(
        () => (window as any).registryFixture.effects,
    );
    expect(effects.archives).toEqual([
        ["9月20日", 0, 42],
        ["9月20日", 1, 42],
    ]);
    expect(effects.errors).toEqual([]);
});

test("registry keeps checks disabled after an eligibility lookup fails", async ({
    page,
}) => {
    await page.setContent(`<!doctype html><html><body><main id="registry"><h3>9月27日</h3>
        <table class="acgnom-table"><tr><th scope="row" rowspan="2" style="background: #ffffb999">One</th><td>Request</td></tr><tr><td><span class="mw-notalk">此提名尚未核對。</span></td></tr></table>
    </main></body></html>`);
    await loadRegistryRuntime(page);
    await page.evaluate(() => {
        const global = window as any;
        global.registryFixture = global.AcgaRegistryUI.mount(
            document.getElementById("registry"),
            { failLookup: true, userName: "Example" },
        );
    });
    await expect(page.locator(".acga-registry-duplicate")).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: "核對", exact: true }),
    ).toBeDisabled();
    expect(
        await page.evaluate(
            () => (window as any).registryFixture.effects.errors,
        ),
    ).toEqual(["Error: offline"]);
    await expect(
        page.getByRole("button", { name: "核對", exact: true }),
    ).toHaveAttribute("title", "未能檢查已有提名。請核對目前登記處後繼續。");
});

test("registry blocks checks during eligibility loading and ignores responses after disposal", async ({
    page,
}) => {
    await page.setContent(`<!doctype html><html><body><main id="registry"><h3>9月27日</h3>
        <table class="acgnom-table"><tr><th scope="row" rowspan="2" style="background: #ffffb999">One</th><td>Request</td></tr><tr><td><span class="mw-notalk">此提名尚未核對。</span></td></tr></table>
    </main></body></html>`);
    await loadRegistryRuntime(page);
    await page.evaluate(() => {
        const global = window as any;
        global.registryFixture = global.AcgaRegistryUI.mount(
            document.getElementById("registry"),
            { deferredLookup: true, userName: "Example" },
        );
    });
    const check = page.getByRole("button", { name: "核對", exact: true });
    await expect(check).toBeDisabled();
    await check.dispatchEvent("click");
    expect(
        await page.evaluate(
            () => (window as any).registryFixture.effects.checks,
        ),
    ).toEqual([]);
    await page.evaluate(() => {
        const global = window as any;
        global.registryFixture.dispose();
        global.registryFixture.resolveEligibility([
            {
                pageName: "Example",
                awarder: "Editor",
                date: "9月27日",
                index: 1,
                sectionOccurrence: 0,
            },
            {
                pageName: "Example",
                awarder: "Editor",
                date: "9月27日",
                index: 2,
                sectionOccurrence: 0,
            },
        ]);
    });
    await expect(page.locator(".acga-registry-duplicate")).toHaveCount(0);
    await expect(page.locator("#registry button, #registry input")).toHaveCount(
        0,
    );
    await expect(page.locator("style[data-registry-fixture]")).toHaveCount(0);
});
