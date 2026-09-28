/** Composition root; importing it does not initialize a MediaWiki page. */
import { createMediaWikiApi } from "../platform/mediawiki/api.ts";
import { createNominationDialogs } from "../features/nomination/dialog.ts";
import { mountRegistry } from "../features/registry/integration.ts";
import {
    createNominationService,
    REGISTRY_PAGE,
} from "./nomination-service.ts";
import { createTranslator } from "../i18n/index.ts";
import type {
    DialogRuntime,
    DialogServices,
    NominationDialogs,
} from "../features/nomination/contracts.ts";
import type { ApiClient } from "../platform/mediawiki/api.ts";
import type { Feedback } from "../shared/ports.ts";

export interface StartupHost extends Feedback {
    document: Document;
    pageName: string;
    namespaceNumber?: number;
    articleTitle?: string;
    action: string;
    revisionId: string | number | null;
    language: string;
    getUserName(): string | null;
    getUrl: DialogServices["getUrl"];
    createApi(): ApiClient;
    loadRuntime(): Promise<DialogRuntime>;
    addStyles(css: string): () => void;
    reload(): void;
    onContent(callback: () => void): () => void;
    addNominationLink?(label: string, callback: () => void): () => void;
}

const active = new WeakMap<Document, Promise<() => void>>();
const TARGET_PAGES = new Set(["WikiProject:ACG/維基ACG專題獎", REGISTRY_PAGE]);

export function start(host: StartupHost): Promise<() => void> {
    if (
        (!TARGET_PAGES.has(host.pageName.replaceAll("_", " ")) &&
            ![0, 1].includes(host.namespaceNumber ?? -1)) ||
        host.action !== "view"
    )
        return Promise.resolve(() => {});
    const previous = active.get(host.document);
    if (previous) return previous;
    const starting = initialize(host).catch((cause) => {
        active.delete(host.document);
        host.reportError(cause, "Initializing ACGATool");
        host.notify(createTranslator(host.language).msg("startup_failed"), {
            type: "error",
            autoHide: false,
        });
        return () => {};
    });
    active.set(host.document, starting);
    return starting;
}

async function initialize(host: StartupHost): Promise<() => void> {
    const runtime = await host.loadRuntime();
    if (host.document.readyState === "loading") {
        await new Promise<void>((resolve) =>
            host.document.addEventListener(
                "DOMContentLoaded",
                () => resolve(),
                { once: true },
            ),
        );
    }
    const { msg } = createTranslator(host.language);
    const api = createMediaWikiApi({
        createApi: host.createApi,
        msg,
        logError: (message, cause) => host.reportError(cause, message),
    });
    const service = createNominationService({
        api,
        msg,
        now: () => new Date(),
        reload: host.reload,
        notify: host.notify,
        reportError: host.reportError,
        dialogs: {
            showNewNominationDialog: () => dialogs.showNewNominationDialog(),
            showEditNominationDialog: (...args) =>
                dialogs.showEditNominationDialog(...args),
            showCheckNominationDialog: (...args) =>
                dialogs.showCheckNominationDialog(...args),
            showConfirmDialog: (options) => dialogs.showConfirmDialog(options),
            dispose: () => dialogs.dispose(),
        },
    });
    const dialogs: NominationDialogs = createNominationDialogs(
        runtime,
        service,
        {
            document: host.document,
            msg,
            getUserName: host.getUserName,
            getPageName: () => host.articleTitle ?? "",
            getSuggestedRecipient:
                [0, 1].includes(host.namespaceNumber ?? -1) && host.articleTitle
                    ? api.getLargestContributorLastYear
                    : undefined,
            getExistingNominations:
                [0, 1].includes(host.namespaceNumber ?? -1) && host.articleTitle
                    ? async (pageName) => (await service.getExistingNominations(pageName)).map((item) => ({
                        ...item,
                        url: host.getUrl(REGISTRY_PAGE) + "#" + encodeURIComponent(item.dateAnchor),
                    }))
                    : undefined,
            getUrl: host.getUrl,
            notify: host.notify,
            addStyles: host.addStyles,
            reportError: host.reportError,
        },
    );
    const removeLink =
        host.addNominationLink?.(msg("nominate_for_acga"), () => {
            void service
                .newNomination()
                .catch((cause) =>
                    host.reportError(cause, "Opening nomination"),
                );
        }) ?? (() => {});
    let disposeRegistry = () => {};
    function mount() {
        disposeRegistry();
        if (!TARGET_PAGES.has(host.pageName.replaceAll("_", " "))) return;
        const root =
            host.document.querySelector<HTMLElement>(
                "#mw-content-text .mw-parser-output",
            ) ?? host.document.querySelector<HTMLElement>("#mw-content-text");
        if (root)
            disposeRegistry = mountRegistry(root, service, {
                msg,
                revisionId: host.revisionId,
                addStyles: host.addStyles,
                notify: host.notify,
                reportError: host.reportError,
            });
    }
    mount();
    const removeHook = host.onContent(mount);
    return () => {
        removeHook();
        removeLink();
        disposeRegistry();
        dialogs.dispose();
        active.delete(host.document);
    };
}
