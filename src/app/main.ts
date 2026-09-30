/** Composition root; importing it does not initialize a MediaWiki page. */
import { createMediaWikiApi } from "../platform/mediawiki/api.ts";
import { createBrowserNominationDraftStore } from "../platform/browser/nomination-draft-storage.ts";
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
import type { NominationPageContext } from "../platform/mediawiki/page-context.ts";

export interface StartupHost extends Feedback {
    document: Document;
    pageName: string;
    namespaceNumber?: number;
    articleTitle?: string;
    getNominationContext?(): NominationPageContext;
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

export function start(host: StartupHost): Promise<() => void> {
    if (
        (host.pageName.replaceAll("_", " ") !== REGISTRY_PAGE &&
            ![0, 1, 6].includes(host.namespaceNumber ?? -1)) ||
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
    const now = () => new Date();
    const readNominationContext = (): NominationPageContext =>
        host.getNominationContext?.() ?? {
            pageName: host.articleTitle ?? "",
            initialCategory: host.namespaceNumber === 6 ? "media" : "article",
            recipientScope: host.namespaceNumber === 6 ? "media" : "article",
        };
    let nominationContext = readNominationContext();
    const api = createMediaWikiApi({
        createApi: host.createApi,
        msg,
        logError: (message, cause) => host.reportError(cause, message),
    });
    const service = createNominationService({
        api,
        msg,
        now,
        getUserName: host.getUserName,
        reload: host.reload,
        notify: host.notify,
        reportError: host.reportError,
        dialogs: {
            showNewNominationDialog: () => dialogs.showNewNominationDialog(),
            showEditNominationDialog: (...args) =>
                dialogs.showEditNominationDialog(...args),
            showCheckNominationDialog: (...args) =>
                dialogs.showCheckNominationDialog(...args),
            showCheckBatchDialog: (entries) =>
                dialogs.showCheckBatchDialog!(entries),
            showConfirmDialog: (options) => dialogs.showConfirmDialog(options),
            dispose: () => dialogs.dispose(),
        },
    });
    const dialogs: NominationDialogs = createNominationDialogs(
        runtime,
        service,
        {
            document: host.document,
            nominationDraftStore: host.document.defaultView
                ? createBrowserNominationDraftStore({
                      window: host.document.defaultView,
                      getStorage: () => {
                          const storage =
                              host.document.defaultView?.localStorage;
                          if (!storage)
                              throw new Error("Browser storage is unavailable");
                          return storage;
                      },
                      getUserName: host.getUserName,
                  })
                : undefined,
            msg,
            getUserName: host.getUserName,
            getPageName: () => nominationContext.pageName,
            getInitialRuleCategory: () => nominationContext.initialCategory,
            getRecipientSuggestionScope: () => nominationContext.recipientScope,
            getSuggestedRecipient: [0, 1, 6].includes(
                host.namespaceNumber ?? -1,
            )
                ? (pageName) => {
                      if (nominationContext.recipientScope === "revision")
                          return api.getRevisionEditor(
                              nominationContext.revisionId!,
                          );
                      if (nominationContext.recipientScope === "media")
                          return api.getLatestFileUploader(pageName);
                      return api.getLargestContributorLastYear(pageName);
                  }
                : undefined,
            getDykStatus: api.getDykStatus,
            getPageAssessments: api.getPageAssessments,
            getExistingNominations: async (pageName, expectedRevisionId) =>
                (
                    await service.getExistingNominations(
                        pageName,
                        expectedRevisionId,
                    )
                ).map((item) => ({
                    ...item,
                    url:
                        host.getUrl(REGISTRY_PAGE) +
                        "#" +
                        encodeURIComponent(item.dateAnchor),
                })),
            getUrl: host.getUrl,
            notify: host.notify,
            addStyles: host.addStyles,
            reportError: host.reportError,
        },
    );
    const removeLink =
        host.addNominationLink?.(msg("nominate_for_acga"), () => {
            nominationContext = readNominationContext();
            void service
                .newNomination()
                .catch((cause) =>
                    host.reportError(cause, "Opening nomination"),
                );
        }) ?? (() => {});
    let disposeRegistry = () => {};
    function mount() {
        disposeRegistry();
        if (host.pageName.replaceAll("_", " ") !== REGISTRY_PAGE) return;
        const root =
            host.document.querySelector<HTMLElement>(
                "#mw-content-text .mw-parser-output",
            ) ?? host.document.querySelector<HTMLElement>("#mw-content-text");
        if (root)
            disposeRegistry = mountRegistry(root, service, {
                msg,
                now,
                getUserName: host.getUserName,
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
