import { applyScoreDeltas, type ScoreDelta } from "../../domain/score-list.ts";
import { getLargestContributorLastYear } from "./contributor-history.ts";
import { getDykStatus } from "./dyk-status.ts";
import { getPageAssessments } from "./page-assessments.ts";
import {
    getLatestFileUploader,
    getRevisionEditor,
} from "./context-recipient.ts";
import {
    formatScoreListEditSummary,
    withToolAttribution,
} from "../../domain/wikitext.ts";
import {
    createTranslator,
    type Translator,
    type MessageKey,
} from "../../i18n/index.ts";

const REGISTRY_PAGE = "WikiProject:ACG/維基ACG專題獎/登記處";
const SCORE_LIST_PAGE = "Module:ACGaward/list";

export interface PageSnapshot {
    exists: boolean;
    text: string;
    revisionId: number | string | null;
}
export interface EditPageOptions {
    baseRevisionId?: number | string | null;
    createOnly?: boolean;
}
export interface EditPageResult {
    success: boolean;
    newRevId: number | string | null;
    errorCode: string | null;
}
export interface ApiClient {
    get(parameters: Record<string, unknown>): Promise<any>;
    post?(parameters: Record<string, unknown>): Promise<any>;
    postWithToken(
        token: string,
        parameters: Record<string, unknown>,
    ): Promise<any>;
}
export interface MediaWikiApiHost {
    createApi: () => ApiClient;
    now?: () => Date;
    msg?: Translator;
    notify?: (message: string, options?: Record<string, unknown>) => void;
    logError?: (message: string, error: unknown) => void;
}

function editErrorCode(error: any, fallback: string): string {
    if (typeof error === "string" && error.trim()) return error;
    const code = error?.error?.code ?? error?.code ?? error?.edit?.code;
    return typeof code === "string" && code.trim() ? code : fallback;
}

/** Own one lazy API client and all host side effects. Domain code never reads MediaWiki globals. */
export function createMediaWikiApi(host: MediaWikiApiHost) {
    let client: ApiClient | undefined;
    const api = (): ApiClient => (client ??= host.createApi());
    const msg = host.msg ?? createTranslator("en").msg;
    const report = (key: MessageKey, type: string): void => {
        host.notify?.(msg(key), { type, autoHide: type !== "error" });
    };

    async function parseWikitext(text: string, title: string): Promise<string> {
        const parameters = {
            action: "parse",
            formatversion: 2,
            title,
            text,
            contentmodel: "wikitext",
            prop: "text",
            pst: true,
            preview: true,
            disableeditsection: true,
        };
        const client = api();
        const response: unknown = client.post
            ? await client.post(parameters)
            : await client.get(parameters);
        if (
            !response ||
            typeof response !== "object" ||
            "error" in response ||
            !("parse" in response) ||
            !response.parse ||
            typeof response.parse !== "object" ||
            !("text" in response.parse) ||
            typeof response.parse.text !== "string"
        )
            throw new Error("MediaWiki returned no readable wikitext preview");
        return response.parse.text;
    }

    async function getPageSnapshot(
        pageName = REGISTRY_PAGE,
    ): Promise<PageSnapshot> {
        const response = await api().get({
            action: "query",
            titles: pageName,
            prop: "revisions",
            rvslots: "*",
            rvprop: "ids|content",
            indexpageids: 1,
        });
        const pageId = response?.query?.pageids?.[0];
        const page =
            pageId === undefined || pageId === null
                ? null
                : response?.query?.pages?.[pageId];
        if (!page) throw new Error("MediaWiki returned no page snapshot");
        if (Object.prototype.hasOwnProperty.call(page, "missing"))
            return { exists: false, text: "", revisionId: null };
        const revision = page.revisions?.[0];
        const content =
            revision?.slots?.main?.["*"] ?? revision?.slots?.main?.content;
        if (typeof content !== "string")
            throw new Error("MediaWiki returned no readable page content");
        return {
            exists: true,
            text: content,
            revisionId: revision?.revid ?? null,
        };
    }

    async function editPage(
        pageName: string,
        newText: string,
        editSummary: string,
        options: EditPageOptions = {},
    ): Promise<EditPageResult> {
        try {
            const parameters: Record<string, unknown> = {
                action: "edit",
                title: pageName,
                text: newText,
                summary: editSummary,
            };
            if (
                options.baseRevisionId !== undefined &&
                options.baseRevisionId !== null
            )
                parameters.baserevid = options.baseRevisionId;
            if (options.createOnly) parameters.createonly = true;
            const response = await api().postWithToken("csrf", parameters);
            if (response?.edit?.result === "Success")
                return {
                    success: true,
                    newRevId: response.edit.newrevid ?? null,
                    errorCode: null,
                };
            host.logError?.("Edit failed", response);
            return {
                success: false,
                newRevId: null,
                errorCode: editErrorCode(response, "edit-failed"),
            };
        } catch (error) {
            host.logError?.("Edit request failed", error);
            return {
                success: false,
                newRevId: null,
                errorCode: editErrorCode(error, "request-failed"),
            };
        }
    }

    /** Return true on failure, matching the nomination save service's partial-success contract. */
    async function editACGAScoreListBatch(
        deltas: readonly ScoreDelta[],
        registryRevisionId: number | string | null,
        commentId: string | null = null,
        recheck = false,
    ): Promise<boolean> {
        if (deltas.length === 0 || deltas.every((delta) => delta.score === 0))
            return false;
        if (!registryRevisionId) {
            report(
                "the_registry_revision_id_is_missing_the_score_list_was",
                "error",
            );
            return true;
        }
        try {
            for (let attempt = 0; attempt < 2; attempt++) {
                const snapshot = await getPageSnapshot(SCORE_LIST_PAGE);
                if (snapshot.exists && snapshot.revisionId === null)
                    throw new Error(
                        "Score-list snapshot is missing its revision ID",
                    );
                const updated = applyScoreDeltas(
                    snapshot.exists ? snapshot.text : "return {\n}",
                    deltas,
                );
                if (!updated.ok)
                    throw new Error(
                        `Cannot safely update score list: ${updated.error.code}`,
                    );
                if (updated.changes.length === 0) return false;
                const summary =
                    updated.changes.length === 1
                        ? formatScoreListEditSummary(
                              updated.changes[0].userName,
                              updated.changes[0].previousScore,
                              updated.changes[0].score,
                              updated.changes[0].newScore,
                              registryRevisionId,
                              commentId,
                              recheck,
                          )
                        : withToolAttribution(
                              (recheck ? "批次復核積分 [[" : "批次核分 [[") +
                                  "Special:Diff/" +
                                  registryRevisionId +
                                  "]]：" +
                                  updated.changes
                                      .map(
                                          (change) =>
                                              `[[User:${change.userName}|${change.userName}]]: ${change.previousScore} ${change.score < 0 ? "−" : "+"} ${Math.abs(change.score)} = ${change.newScore}`,
                                      )
                                      .join("；"),
                          );
                const result = await editPage(
                    SCORE_LIST_PAGE,
                    updated.text,
                    summary,
                    {
                        baseRevisionId: snapshot.revisionId,
                        createOnly: !snapshot.exists,
                    },
                );
                if (result.success) {
                    report("module_acgaward_list_was_updated", "success");
                    return false;
                }
                if (
                    attempt === 1 ||
                    !["editconflict", "articleexists"].includes(
                        result.errorCode ?? "",
                    )
                )
                    break;
            }
        } catch (error) {
            host.logError?.("Score-list update failed", error);
        }
        report("the_score_list_could_not_be_updated_check_the_scores", "error");
        return true;
    }

    return {
        parseWikitext,
        getDykStatus: (pageName: string) => getDykStatus(api(), pageName),
        getPageAssessments: (pageName: string) =>
            getPageAssessments(api(), pageName),
        getLatestFileUploader: (pageName: string) =>
            getLatestFileUploader(api(), pageName),
        getRevisionEditor: (revisionId: number) =>
            getRevisionEditor(api(), revisionId),
        getLargestContributorLastYear: (pageName: string) =>
            getLargestContributorLastYear(
                api(),
                pageName,
                host.now?.() ?? new Date(),
            ),
        getPageSnapshot,
        editPage,
        editACGAScoreListBatch,
    };
}
