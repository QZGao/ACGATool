import type { Page } from "@playwright/test";

export interface StartupFixtureOptions {
    namespaceNumber?: number;
    pageName?: string;
    title?: string;
    revisionId?: number;
    currentRevisionId?: number;
    diffNewId?: number;
    mediaHash?: string;
    sharedFile?: boolean;
    deferredRecipient?: boolean;
}

/** Exercise the built entry point with real Vue/Codex and read-only host fixtures. */
export async function mountStartup(
    page: Page,
    assets: { runtime: string; bundle: string; styles: string },
    options: StartupFixtureOptions = {},
): Promise<string[]> {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent(
        '<!doctype html><html lang="en"><body><nav id="p-tb" aria-label="Tools"><ul></ul></nav><main id="mw-content-text"><div class="mw-parser-output"><h1>Example article</h1><p>Offline article fixture.</p></div></main></body></html>',
    );
    await page.addStyleTag({
        content: `body { font-family: sans-serif; } ${assets.styles}`,
    });
    await page.addScriptTag({ content: assets.runtime });
    await page.evaluate((options) => {
        const global = window as any;
        global.startupEffects = {
            portlets: [],
            modules: [],
            apiCalls: [],
            apiWrites: [],
            notices: [],
            errors: [],
        };
        const namespaceNumber = options.namespaceNumber ?? 0;
        const configuration: Record<string, unknown> = {
            wgPageName:
                options.pageName ??
                (namespaceNumber === 0
                    ? "Example_article"
                    : "Talk:Example_article"),
            wgNamespaceNumber: namespaceNumber,
            wgTitle: options.title ?? "Example article",
            wgAction: "view",
            wgRevisionId: options.revisionId ?? 42,
            wgCurRevisionId: options.currentRevisionId ?? 42,
            wgDiffNewId: options.diffNewId,
            wgUserLanguage: "en",
            wgUserVariant: "",
            wgUserName: "Example",
        };
        if (options.mediaHash) window.location.hash = options.mediaHash;
        const readRecipient = (response: unknown) => {
            if (!options.deferredRecipient) return Promise.resolve(response);
            return new Promise((resolve) => {
                global.resolveStartupRecipient = () => resolve(response);
            });
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
                getUrl: (title: string) => "/wiki/" + encodeURIComponent(title),
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
                    if (parameters.action !== "query")
                        throw new Error("Unexpected fixture API query");
                    if (parameters.prop === "imageinfo") {
                        return readRecipient({
                            query: {
                                pages: [
                                    {
                                        ...(options.sharedFile
                                            ? {
                                                  missing: true,
                                                  imagerepository: "shared",
                                              }
                                            : {
                                                  pageid: 1,
                                                  imagerepository: "local",
                                              }),
                                        imageinfo: [
                                            { user: "Latest uploader" },
                                        ],
                                    },
                                ],
                            },
                        });
                    }
                    if (parameters.revids) {
                        return readRecipient({
                            query: {
                                pages: [
                                    {
                                        revisions: [
                                            {
                                                revid: Number(
                                                    parameters.revids,
                                                ),
                                                user: "Viewed revision editor",
                                            },
                                        ],
                                    },
                                ],
                            },
                        });
                    }
                    if (parameters.rvprop === "ids|content") {
                        return Promise.resolve({
                            query: {
                                pageids: ["1"],
                                pages: {
                                    "1": {
                                        pageid: 1,
                                        revisions: [
                                            {
                                                revid: 1,
                                                slots: {
                                                    main: { content: "" },
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        });
                    }
                    if (parameters.rvprop === "content") {
                        return Promise.resolve({
                            query: {
                                pages: [
                                    {
                                        pageid: 1,
                                        revisions: [
                                            {
                                                slots: {
                                                    main: { content: "" },
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                        });
                    }
                    if (
                        parameters.prop !== "revisions" ||
                        parameters.titles !==
                            (options.title ?? "Example article")
                    )
                        throw new Error("Unexpected fixture API query");
                    const timestamp = new Date(
                        Date.now() - 24 * 60 * 60 * 1000,
                    ).toISOString();
                    return readRecipient({
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
    }, options);
    await page.addScriptTag({ content: assets.bundle });
    return errors;
}
