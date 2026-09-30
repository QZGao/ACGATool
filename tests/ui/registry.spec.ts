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
                        newNomination: async () => {},
                        editNomination: async value => { effects.edits.push(value); },
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
                        msg: createTranslator('zh-Hant').msg,
                        revisionId: 42,
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
            <tr><th scope="row" rowspan="2">First</th><td>Request one
                <table class="acgnom-table" id="nested"><tbody>
                    <tr><th scope="row">Nested content</th><td><h3>1月1日</h3></td></tr>
                    <tr><td class="mw-notalk">Not a nomination</td></tr>
                </tbody></table>
            </td></tr>
            <tr><td><span class="mw-notalk">Unchecked</span></td></tr>
        </tbody></table>
        <div class="mw-heading mw-heading3"><h3><span class="mw-headline">9月27日</span></h3></div>
        <table class="acgnom-table" id="second"><tbody>
            <tr><th scope="row" rowspan="2">Second</th><td>Request two</td></tr>
            <tr><td><span class="mw-notalk">Unchecked</span></td></tr>
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
        page.getByRole("button", { name: "批次核對", exact: true }),
    ).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: "開始核對", exact: true }),
    ).toHaveCount(0);
    const choices = page.getByRole("button", {
        name: "加入批次核對",
        exact: true,
    });
    await expect(choices).toHaveCount(2);
    await expect(choices.nth(0)).toBeVisible();
    await expect(choices.nth(1)).toBeVisible();
    await expect(choices.nth(0)).toHaveAttribute("aria-pressed", "false");
    await expect(choices.nth(1)).toHaveAttribute("aria-pressed", "false");
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
        name: "批次核對",
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
    await expect(choices.nth(0)).toHaveAttribute("aria-pressed", "false");
    await expect(choices.nth(1)).toHaveAttribute("aria-pressed", "false");
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

test("registry row batch actions use only selections and preserve them after failure", async ({
    page,
}) => {
    await page.setContent(`<!doctype html><html><body><main id="registry"><h3>9月27日</h3>
        <table class="acgnom-table"><tbody>
            <tr><th scope="row" rowspan="2">One</th><td>Request</td></tr><tr><td><span class="mw-notalk">Unchecked</span></td></tr>
            <tr><th scope="row" rowspan="2">Two</th><td>Request</td></tr><tr><td><span class="mw-notalk">Unchecked</span></td></tr>
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
    const choices = page.getByRole("button", {
        name: "加入批次核對",
        exact: true,
    });
    await page.getByText("加入批次核對", { exact: true }).first().click();
    await expect(choices.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(choices.nth(1)).toHaveAttribute("aria-pressed", "false");
    const batches = page.getByRole("button", {
        name: "批次核對",
        exact: true,
    });
    await expect(batches).toHaveCount(2);
    await batches.nth(1).click();
    await expect(batches.nth(0)).toBeDisabled();
    await expect(batches.nth(1)).toBeDisabled();
    await expect(choices.nth(0)).toBeDisabled();
    await expect(choices.nth(1)).toBeDisabled();
    await choices.nth(0).dispatchEvent("click");
    await expect(choices.nth(0)).toHaveAttribute("aria-pressed", "true");
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
    await expect(choices.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(choices.nth(1)).toHaveAttribute("aria-pressed", "false");
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
    await expect(choices.nth(0)).toHaveAttribute("aria-pressed", "false");
    await expect(choices.nth(1)).toHaveAttribute("aria-pressed", "false");
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
});

test("registry buttons expose batch state and support keyboard actions with Codex sizing", async ({
    page,
}) => {
    await page.setContent(`<!doctype html><html lang="zh-Hant"><body><main id="registry"><h3>9月27日</h3>
        <table class="acgnom-table"><tbody>
            <tr><th scope="row" rowspan="2">One</th><td>Request</td></tr><tr><td><span class="mw-notalk">Unchecked</span></td></tr>
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
    const choice = page.getByRole("button", {
        name: "加入批次核對",
        exact: true,
    });
    for (const button of [edit, check, choice]) {
        const box = await button.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(32);
        await expect(button).toHaveCSS("font-size", "16px");
        await expect(button).toHaveCSS("border-style", "solid");
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
    const unselectedBackground = await choice.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
    );

    await edit.focus();
    await edit.press("Enter");
    await expect(edit).toBeEnabled();
    await choice.focus();
    await choice.press("Space");
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status")).toHaveText("已選擇 1 項");
    await expect(choice).not.toHaveCSS(
        "background-color",
        unselectedBackground,
    );
    await choice.press("Enter");
    await expect(choice).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("status")).toBeEmpty();
    await choice.press("Enter");
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    await page
        .getByRole("button", { name: "批次核對", exact: true })
        .press("Space");
    await expect(choice).toHaveAttribute("aria-pressed", "false");
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
});

test("registry omits repeated recipient-target notices from the page", async ({
    page,
}) => {
    await page.setContent(`<!doctype html><html><body><main id="registry">
        <h3>9月27日</h3>
        <table class="acgnom-table" id="one"><tr><th scope="row" rowspan="2">One</th><td>Request</td></tr><tr><td><span class="mw-notalk">Unchecked</span></td></tr></table>
        <h3>9月27日</h3>
        <table class="acgnom-table" id="two"><tr><th scope="row" rowspan="2">Two</th><td>Request</td></tr><tr><td><span class="mw-notalk">Unchecked</span></td></tr></table>
        <table class="acgnom-table" id="other"><tr><th scope="row" rowspan="2">Other recipient</th><td>Request</td></tr><tr><td><span class="mw-notalk">Unchecked</span></td></tr></table>
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
            <tr><th scope="row" rowspan="2">Own nomination</th><td>Request</td></tr><tr><td><span class="mw-notalk">Unchecked</span></td></tr>
            <tr><th scope="row" rowspan="2">Own score</th><td>Request</td></tr><tr><td><span class="mw-notalk">Unchecked</span></td></tr>
            <tr><th scope="row" rowspan="2">Own nomination and score</th><td>Request</td></tr><tr><td><span class="mw-notalk">Unchecked</span></td></tr>
            <tr><th scope="row" rowspan="2">Other editors</th><td>Request</td></tr><tr><td><span class="mw-notalk">Unchecked</span></td></tr>
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
    const choices = page.getByRole("button", {
        name: "加入批次核對",
        exact: true,
    });
    for (const [index, reason] of reasons.entries()) {
        await expect(choices.nth(index)).toBeDisabled();
        await expect(choices.nth(index)).toHaveAttribute("title", reason);
    }
    await choices.nth(0).dispatchEvent("click");
    await expect(choices.nth(0)).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("status")).toBeEmpty();
    await choices.nth(3).click();
    const batches = page.getByRole("button", {
        name: "批次核對",
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
            <tr><th scope="row" rowspan="2">Pending other editors</th><td>Request</td></tr><tr><td><span class="mw-notalk">Reviewed</span></td></tr>
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
    await rechecks.nth(0).click();
    const choices = page.getByRole("button", {
        name: "加入批次核對",
        exact: true,
    });
    await expect(choices.nth(0)).toBeEnabled();
    await expect(choices.nth(1)).toBeDisabled();
    await expect(choices.nth(2)).toBeDisabled();
    await choices.nth(0).click();
    await choices.nth(3).click();
    await expect(page.getByRole("status")).toHaveText("已選擇 2 項");
    const batches = page.getByRole("button", {
        name: "批次核對",
        exact: true,
    });
    await expect(batches.nth(1)).toBeDisabled();
    await expect(batches.nth(2)).toBeDisabled();
    await capture(page, "registry-recheck-inline");
    await batches.nth(0).click();
    await expect(rechecks).toHaveCount(3);
    await expect(check).toBeEnabled();
    await expect(choices.nth(0)).toHaveAttribute("aria-pressed", "false");
    const effects = await page.evaluate(
        () => (window as any).registryFixture.effects,
    );
    expect(effects.checks).toEqual([
        expect.objectContaining({ index: 1, sectionOccurrence: 0 }),
    ]);
    expect(effects.batches).toEqual([
        [
            expect.objectContaining({ index: 1, sectionOccurrence: 0 }),
            expect.objectContaining({ index: 4, sectionOccurrence: 0 }),
        ],
    ]);
    expect(effects.errors).toEqual([]);
    expect(errors).toEqual([]);
});

test("registry keeps checks disabled after an eligibility lookup fails", async ({
    page,
}) => {
    await page.setContent(`<!doctype html><html><body><main id="registry"><h3>9月27日</h3>
        <table class="acgnom-table"><tr><th scope="row" rowspan="2">One</th><td>Request</td></tr><tr><td><span class="mw-notalk">Unchecked</span></td></tr></table>
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
        <table class="acgnom-table"><tr><th scope="row" rowspan="2">One</th><td>Request</td></tr><tr><td><span class="mw-notalk">Unchecked</span></td></tr></table>
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
