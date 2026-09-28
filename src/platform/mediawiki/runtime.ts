/** Adapt ResourceLoader and MediaWiki globals to explicit startup capabilities. */
import type { StartupHost } from "../../app/main.ts";
import type { DialogRuntime } from "../../features/nomination/contracts.ts";

export function createBrowserHost(
    win: Window,
    doc: Document,
    host: typeof mw,
): StartupHost {
    return {
        document: doc,
        pageName: host.config.get("wgPageName"),
        namespaceNumber: host.config.get("wgNamespaceNumber"),
        articleTitle: [0, 1].includes(host.config.get("wgNamespaceNumber"))
            ? host.config.get("wgTitle")
            : "",
        action: host.config.get("wgAction"),
        revisionId: host.config.get("wgRevisionId"),
        language: host.config.get("wgUserLanguage") || "en",
        getUserName: () => host.config.get("wgUserName"),
        getUrl: (title, query) => host.util.getUrl(title, query),
        createApi: () => {
            const api = new host.Api();
            return {
                get: (parameters) =>
                    Promise.resolve(
                        api.get(parameters as Parameters<typeof api.get>[0]),
                    ),
                postWithToken: (token, parameters) =>
                    Promise.resolve(
                        api.postWithToken(
                            token,
                            parameters as Parameters<typeof api.get>[0],
                        ),
                    ),
            };
        },
        async loadRuntime() {
            const require = await host.loader.using([
                "mediawiki.api",
                "mediawiki.util",
                "vue",
                "@wikimedia/codex",
            ]);
            return {
                Vue: require("vue"),
                Codex: require("@wikimedia/codex"),
            } as DialogRuntime;
        },
        addStyles(css) {
            const style = doc.createElement("style");
            style.textContent = css;
            doc.head.append(style);
            return () => style.remove();
        },
        notify: (message, options) => {
            void host.notify(message, {
                ...options,
                type: options?.type === "warning" ? "warn" : options?.type,
            });
        },
        reportError: (cause, operation) =>
            console.error(`[ACGATool] ${operation}`, cause),
        reload: () => {
            win.setTimeout(() => win.location.reload(), 1500);
        },
        onContent(callback) {
            const hook = host.hook("wikipage.content");
            hook.add(callback);
            return () => hook.remove(callback);
        },
        addNominationLink(label, callback) {
            const item = host.util.addPortletLink(
                "p-tb",
                "#",
                label,
                "t-acga-nominate",
            );
            if (!item) return () => {};
            const link = item.querySelector("a") ?? item;
            const activate = (event: Event) => {
                event.preventDefault();
                callback();
            };
            link.addEventListener("click", activate);
            return () => {
                link.removeEventListener("click", activate);
                item.remove();
            };
        },
    };
}
