import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, test } from "./fixtures.ts";

let runtime: string;
test.beforeAll(async () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const result = await build({
        absWorkingDir: root,
        stdin: {
            contents: `
                import { mountRegistry } from './src/features/registry/integration.ts';
                import { createTranslator } from './src/i18n/index.ts';
                export function mount(root) {
                    const effects = { edits: [], checks: [], batches: [], archives: [], errors: [], notices: [] };
                    const dispose = mountRegistry(root, {
                        newNomination: async () => {},
                        editNomination: async value => { effects.edits.push(value); },
                        checkNomination: async value => { effects.checks.push(value); },
                        checkBatch: async values => { effects.batches.push(values); },
                        archiveChapter: async (...values) => { effects.archives.push(values); },
                    }, {
                        msg: createTranslator('zh-Hant').msg,
                        revisionId: 42,
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
                    return { effects, dispose };
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
    await page.addScriptTag({ content: runtime });
    await page.evaluate(() => {
        const global = window as any;
        global.registryFixture = global.AcgaRegistryUI.mount(
            document.getElementById("registry"),
        );
    });
    await expect(page.getByRole("group", { name: "ACG 提名工具" })).toHaveCount(
        1,
    );
    await expect(
        page.getByRole("button", { name: "修改提名", exact: true }),
    ).toHaveCount(2);
    await expect(
        page.getByRole("button", { name: "核對", exact: true }),
    ).toHaveCount(2);
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
    await page.getByRole("button", { name: "批次核對", exact: true }).click();
    const begin = page.getByRole("button", { name: "開始核對", exact: true });
    await expect(begin).toBeDisabled();
    const choices = page.getByRole("checkbox", {
        name: "加入批次核對",
        exact: true,
    });
    await choices.nth(0).check();
    await choices.nth(1).check();
    await expect(page.getByRole("status")).toHaveText("已選擇 2 項");
    await begin.click();
    await expect(begin).toBeDisabled();
    await expect(page.getByRole("status")).toHaveText("已選擇 0 項");
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
        1,
    );
});
