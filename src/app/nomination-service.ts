/**
 * @file src/app/nomination-service.ts
 * Purpose: src / app / nomination service module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Exports
 * 3. Constants and state
 * 4. NominationApi
 * 5. EntrySelection
 * 6. NominationServices
 * 7. PendingChange
 * 8. editOptions
 * 9. retryable
 * 10. matchesRevision
 * 11. createNominationService
 * 12. NominationService
 */

import type { Translator, MessageKey } from "../i18n/index.ts";
/** Nomination workflows. All network, dialog, clock and feedback effects are injected. */
import {
    getDateSections,
    queryEntry,
    queried2NomData,
    resolveEntryByFingerprint,
    updateEntriesParameters,
    getCheckedScore,
    parseUserReason,
    formatSummaryPageLinks,
    withToolAttribution,
} from "../domain/wikitext.ts";
import {
    formatNominationEditSummary,
    type NominationSummaryItem,
} from "../domain/edit-summary.ts";
import {
    formatNewNominationTablesWikitext,
    formatNominationCheckWikitext,
    serializeNominationReason,
    NominationRuleSet,
    validateNominationGroup,
} from "../domain/rules.ts";
import {
    insertArchiveSection,
    insertNominationIntoRegistry,
} from "../domain/registry.ts";
import { getWikitextArchiveEligibility } from "../domain/archive-eligibility.ts";
import type {
    PageSnapshot,
    EditPageOptions,
    EditPageResult,
} from "../platform/mediawiki/api.ts";
import type {
    CheckBatchEntry,
    NominationDialogs,
    NominationData,
    NewNominationBatch,
    NewNominationTable,
    NominationTarget,
    RawNominationFields,
} from "../features/nomination/contracts.ts";
import {
    CHECK_OUTCOME,
    normalizeCheckOutcome,
} from "../features/nomination/check-batch.ts";
import { normalizeDiscussionCommentId } from "../features/registry/identity.ts";
import type { Feedback } from "../shared/ports.ts";
import type { ScoreDelta } from "../domain/score-list.ts";
export type { ScoreDelta } from "../domain/score-list.ts";
import {
    getExistingNominations,
    getNominationCheckRestriction,
} from "../domain/existing-nominations.ts";

export const REGISTRY_PAGE = "WikiProject:ACG/維基ACG專題獎/登記處";

interface NominationApi {
    parseWikitext?(text: string, title: string): Promise<string>;
    getPageSnapshot(title?: string): Promise<PageSnapshot>;
    editPage(
        title: string,
        text: string,
        summary: string,
        options?: EditPageOptions,
    ): Promise<EditPageResult>;
    editACGAScoreListBatch(
        deltas: ScoreDelta[],
        revision: string | number,
        commentId?: string,
        recheck?: boolean,
    ): Promise<boolean>;
}
export interface EntrySelection {
    date: string;
    index: number;
    sectionOccurrence: number;
    tableIndex?: number;
    itemIndex?: number;
    commentId?: string;
    expectedRevisionId?: string | number | null;
}
export interface NominationServices extends Feedback {
    api: NominationApi;
    dialogs: NominationDialogs;
    msg: Translator;
    getUserName?(): string | null;
    reload(): void;
    now(): Date;
}
interface PendingChange {
    target: NominationTarget;
    fields: Record<string, string>;
    summaryItem: NominationSummaryItem;
    score?: number;
    manualScore?: boolean;
    check?: boolean;
}

function editOptions(snapshot: PageSnapshot): EditPageOptions {
    if (snapshot.exists && snapshot.revisionId == null) {
        throw new Error("The page response did not contain a revision ID.");
    }
    return snapshot.exists
        ? { baseRevisionId: snapshot.revisionId }
        : { createOnly: true };
}
function retryable(result: EditPageResult): boolean {
    return (
        !result.success &&
        ["editconflict", "articleexists"].includes(result.errorCode ?? "")
    );
}
function matchesRevision(
    snapshot: PageSnapshot,
    expected: EntrySelection["expectedRevisionId"],
): boolean {
    return expected == null || String(snapshot.revisionId) === String(expected);
}

export function createNominationService(services: NominationServices) {
    const { api, dialogs, msg, notify, reportError, reload, now } = services;
    let batch: PendingChange[] | null = null;
    let batchCommitted = false;
    let writing = false;

    function error(key: MessageKey) {
        notify(msg(key), { type: "error", autoHide: false });
    }
    function stale() {
        error("this_nomination_or_the_registry_has_changed_refresh_the_page");
    }
    function checkAllowed(
        nomination: { awarder: unknown; nominator?: unknown },
        proposedRecipient?: unknown,
    ): boolean {
        const reviewer = services.getUserName?.() ?? null;
        const original = getNominationCheckRestriction(nomination, reviewer);
        const proposed =
            proposedRecipient === undefined
                ? null
                : getNominationCheckRestriction(
                      { ...nomination, awarder: proposedRecipient },
                      reviewer,
                  );
        const restriction =
            proposed === "check_disabled_own_nomination_and_score"
                ? proposed
                : (original ?? proposed);
        if (!restriction) return true;
        error(restriction);
        return false;
    }
    function validGroup(nomination: NominationData): boolean {
        if (
            validateNominationGroup({
                ruleStatus: nomination.ruleStatus,
                ruleTokens: nomination.ruleTokens,
            }).ok
        )
            return true;
        error("each_nomination_must_use_one_rule_group_1_4_5");
        return false;
    }
    async function guarded(
        operation: () => Promise<boolean>,
    ): Promise<boolean> {
        if (writing) return true;
        writing = true;
        try {
            return await operation();
        } catch (cause) {
            reportError(cause, "Saving nomination");
            error("saving_failed_please_try_again_later");
            return true;
        } finally {
            writing = false;
        }
    }

    async function readTarget(selection: EntrySelection) {
        const snapshot = await api.getPageSnapshot(REGISTRY_PAGE);
        if (!matchesRevision(snapshot, selection.expectedRevisionId)) {
            stale();
            return null;
        }
        return targetInSnapshot(snapshot, selection);
    }
    function targetInSnapshot(
        snapshot: PageSnapshot,
        selection: EntrySelection,
    ): NominationTarget | null {
        const target = queryEntry(
            snapshot.text,
            selection.date,
            selection.index,
            selection.sectionOccurrence,
            selection,
        );
        if (!target) {
            stale();
            return null;
        }
        const commentId = normalizeDiscussionCommentId(selection.commentId);
        if (commentId) target.commentId = commentId;
        target.registryRevisionId = snapshot.revisionId;
        return target;
    }

    /** All replacements are resolved against the same immutable snapshot. */
    async function commitChanges(
        changes: PendingChange[],
        summary: string,
    ): Promise<boolean> {
        if (!changes.length) return false;
        let result: EditPageResult | null = null;
        let deltas: ScoreDelta[] = [];
        let manualScore = changes.some((change) => change.manualScore);
        for (let attempt = 0; attempt < 2; attempt++) {
            const snapshot = await api.getPageSnapshot(REGISTRY_PAGE);
            const resolved = changes.map((change) => ({
                change,
                entry: resolveEntryByFingerprint(snapshot.text, change.target),
            }));
            if (resolved.some((item) => !item.entry)) {
                stale();
                return true;
            }
            deltas = [];
            for (const { change, entry } of resolved) {
                const original = queried2NomData(entry);
                if (
                    change.check &&
                    !checkAllowed(original, change.fields.用戶名稱)
                )
                    return true;
                if (change.score === undefined) {
                    if (
                        change.fields.核對用 !== undefined &&
                        change.fields.核對用.trim() !==
                            String(original?.checkWikitext ?? "").trim()
                    )
                        manualScore = true;
                    if (
                        original?.checkWikitext?.trim() &&
                        change.fields.用戶名稱 !== undefined &&
                        change.fields.用戶名稱 !== original.awarder
                    )
                        manualScore = true;
                    continue;
                }
                const previous = getCheckedScore(original?.checkWikitext ?? "");
                if (!previous.ok || !original?.awarder) {
                    manualScore = true;
                    continue;
                }
                const recipient = change.fields.用戶名稱 ?? original.awarder;
                if (recipient !== original.awarder) {
                    if (previous.score !== 0)
                        deltas.push({
                            userName: original.awarder,
                            score: -previous.score,
                        });
                    if (change.score !== 0)
                        deltas.push({
                            userName: recipient,
                            score: change.score,
                        });
                } else {
                    const delta = change.score - previous.score;
                    if (delta !== 0)
                        deltas.push({ userName: recipient, score: delta });
                }
            }
            const updated = updateEntriesParameters(
                snapshot.text,
                resolved.map(({ change, entry }) => ({
                    entry,
                    changes: change.fields,
                })),
            );
            if (updated === snapshot.text) {
                notify(msg("the_nomination_has_not_changed"), {
                    type: "warning",
                });
                return true;
            }
            result = await api.editPage(
                REGISTRY_PAGE,
                updated,
                summary,
                editOptions(snapshot),
            );
            if (result.success || !retryable(result)) break;
        }
        if (!result?.success) {
            error("the_registry_could_not_be_saved");
            return true;
        }

        let scoreFailed = false;
        if (deltas.length) {
            if (result.newRevId == null) scoreFailed = true;
            else {
                try {
                    const scoreArguments = [
                        deltas,
                        result.newRevId,
                        changes.length === 1
                            ? normalizeDiscussionCommentId(
                                  changes[0].target.commentId,
                              )
                            : undefined,
                    ] as const;
                    const recheck = changes.some(
                        (change) => change.check && wasChecked(change.target),
                    );
                    scoreFailed = recheck
                        ? await api.editACGAScoreListBatch(
                              ...scoreArguments,
                              true,
                          )
                        : await api.editACGAScoreListBatch(...scoreArguments);
                } catch (cause) {
                    reportError(cause, "Updating score list");
                    scoreFailed = true;
                }
            }
        }
        if (scoreFailed || manualScore) {
            notify(msg("the_checks_were_saved_but_some_scores_could_not_be"), {
                type: "warning",
                autoHide: false,
            });
            // Keep the recovery notice and committed page available; no automatic reload.
        } else {
            notify(msg("the_nomination_was_saved"), { type: "success" });
            reload();
        }
        return false;
    }

    function sameTarget(left: NominationTarget, right: NominationTarget) {
        return (
            left.type === right.type &&
            left.date === right.date &&
            left.sectionOccurrence === right.sectionOccurrence &&
            left.index === right.index &&
            left.sourceFingerprint === right.sourceFingerprint
        );
    }

    function queueOrCommit(change: PendingChange, summary: string) {
        if (batch) {
            if (writing || batchCommitted) return Promise.resolve(true);
            // A selection can only contribute one decision, even if a callback is repeated.
            const index = batch.findIndex((item) =>
                sameTarget(item.target, change.target),
            );
            if (index >= 0) batch[index] = change;
            else batch.push(change);
            return Promise.resolve(false);
        }
        return guarded(() => commitChanges([change], summary));
    }

    function discardNominationCheck(target: NominationTarget) {
        if (!batch || writing || batchCommitted) return;
        batch = batch.filter((item) => !sameTarget(item.target, target));
    }

    function wasChecked(target: NominationTarget) {
        return Boolean(
            String(queried2NomData(target)?.checkWikitext ?? "").trim(),
        );
    }

    async function completeNominationCheckBatch(): Promise<boolean> {
        if (!batch) return true;
        if (batchCommitted) return false;
        const changes = [...batch];
        const rechecks = changes.filter((change) => wasChecked(change.target));
        const action = rechecks.length
            ? rechecks.length === changes.length
                ? "批次復核"
                : "批次核對與復核"
            : "批次核對";
        const keepOpen = await guarded(() =>
            commitChanges(
                changes,
                formatNominationEditSummary(
                    changes.map((item) => item.summaryItem),
                    action,
                ),
            ),
        );
        if (!keepOpen) batchCommitted = true;
        return keepOpen;
    }

    function newNominationTables(
        input: NewNominationBatch,
        additionalMessage: string,
    ): NewNominationTable[] {
        if (
            input.every((item): item is NewNominationTable =>
                Array.isArray(item.nominations),
            )
        )
            return input;
        return [
            {
                nominations: input as NominationData[],
                comment: additionalMessage,
            },
        ];
    }

    async function saveNewNomination(
        input: NewNominationBatch,
        additionalMessage = "",
    ): Promise<boolean> {
        return guarded(async () => {
            const tables = newNominationTables(input, additionalMessage);
            const source = formatNewNominationTablesWikitext(tables);
            if (!source.ok) {
                if (source.error !== "empty")
                    error(newNominationErrorKey(source.error));
                return true;
            }
            const text = source.wikitext;
            const today = now();
            const date = `${today.getUTCMonth() + 1}月${today.getUTCDate()}日`;
            for (let attempt = 0; attempt < 2; attempt++) {
                const snapshot = await api.getPageSnapshot(REGISTRY_PAGE);
                const result = await api.editPage(
                    REGISTRY_PAGE,
                    insertNominationIntoRegistry(snapshot.text, date, text),
                    formatNominationEditSummary(
                        tables.flatMap((table) => table.nominations),
                    ),
                    editOptions(snapshot),
                );
                if (result.success) {
                    notify(msg("the_new_nominations_were_submitted"), {
                        type: "success",
                    });
                    reload();
                    return false;
                }
                if (!retryable(result)) break;
            }
            error("the_new_nominations_could_not_be_submitted");
            return true;
        });
    }

    function newNominationErrorKey(
        reason: "invalid-group" | "missing-identity" | "invalid-reason",
    ): MessageKey {
        if (reason === "invalid-group")
            return "each_nomination_must_use_one_rule_group_1_4_5";
        if (reason === "missing-identity")
            return "enter_the_recipient_and_article_title";
        return "choose_valid_nomination_rules_and_scores";
    }

    async function previewNewNomination(
        input: NewNominationBatch,
        additionalMessage = "",
    ): Promise<{ wikitext: string; html: string }> {
        const source = formatNewNominationTablesWikitext(
            newNominationTables(input, additionalMessage),
        );
        if (!source.ok)
            throw new Error(
                msg(
                    newNominationErrorKey(
                        source.error === "empty"
                            ? "invalid-reason"
                            : source.error,
                    ),
                ),
            );
        if (!api.parseWikitext)
            throw new Error("Wikitext preview is unavailable");
        return {
            wikitext: source.wikitext,
            html: await api.parseWikitext(source.wikitext, REGISTRY_PAGE),
        };
    }

    async function saveModifiedNomination(
        nomination: NominationData,
        target: NominationTarget,
    ): Promise<boolean> {
        if (!validGroup(nomination)) return true;
        const { ruleNames } = NominationRuleSet();
        const reason = serializeNominationReason(
            nomination.ruleStatus,
            ruleNames,
        );
        if (
            !nomination.awarder.trim() ||
            !nomination.pageName.trim() ||
            !reason.ok ||
            !reason.reasonText ||
            reason.reasonScore <= 0
        ) {
            error("check_the_article_recipient_rules_and_scores");
            return true;
        }
        return queueOrCommit(
            {
                target,
                summaryItem: nomination,
                fields: {
                    條目名稱: nomination.pageName.trim(),
                    用戶名稱: nomination.awarder.trim(),
                    提名理由: `{{ACG提名2/request|ver=1|${reason.reasonText}}}`,
                },
            },
            formatNominationEditSummary([nomination], "編輯提名"),
        );
    }

    async function saveNominationCheck(
        nomination: NominationData,
        target: NominationTarget,
    ): Promise<boolean> {
        if (!checkAllowed(queried2NomData(target), nomination.awarder))
            return true;
        if (!validGroup(nomination)) return true;
        const { ruleNames, ruleDict } = NominationRuleSet();
        const formatted = formatNominationCheckWikitext(
            nomination,
            ruleNames,
            ruleDict,
        );
        if (!formatted.ok) {
            error("check_the_rule_descriptions_and_scores");
            return true;
        }
        const fields: Record<string, string> = { 核對用: formatted.wikitext };
        if (nomination.replaceRequestReason === true) {
            if (!nomination.pageName.trim() || !nomination.awarder.trim()) {
                error("enter_the_recipient_and_article_title");
                return true;
            }
            const reason = String(nomination.requestReasonText ?? "").trim();
            if (!reason) {
                error("the_nomination_reason_cannot_be_empty");
                return true;
            }
            const parsed = parseUserReason(reason);
            if (
                !parsed.ok ||
                !validGroup({ ...nomination, ruleTokens: parsed.tokens })
            )
                return true;
            fields.提名理由 = `{{ACG提名2/request|ver=1|${reason}}}`;
            fields.條目名稱 = nomination.pageName.trim();
            fields.用戶名稱 = nomination.awarder.trim();
        }
        return queueOrCommit(
            {
                target,
                fields,
                score: formatted.reasonScore,
                check: true,
                summaryItem: { ...nomination, score: formatted.reasonScore },
            },
            formatNominationEditSummary(
                [{ ...nomination, score: formatted.reasonScore }],
                wasChecked(target) ? "復核分數" : "核對分數",
            ),
        );
    }

    async function saveRawNominationSource(
        fields: RawNominationFields,
        target: NominationTarget,
        { check = false } = {},
    ): Promise<boolean> {
        const names = ["條目名稱", "用戶名稱", "提名理由", "核對用"] as const;
        if (names.some((name) => typeof fields[name] !== "string"))
            throw new TypeError("Four source fields are required.");
        const original = queried2NomData(target);
        const checking =
            check ||
            fields.核對用.trim() !==
                String(original.checkWikitext ?? "").trim();
        if (checking && !checkAllowed(original, fields.用戶名稱)) return true;
        const parsed = parseUserReason(fields.提名理由);
        if (
            parsed.ok &&
            !validGroup({
                awarder: fields.用戶名稱,
                pageName: fields.條目名稱,
                ruleTokens: parsed.tokens,
            })
        )
            return true;
        return queueOrCommit(
            {
                target,
                fields,
                summaryItem: {
                    pageName: fields.條目名稱,
                    awarder: fields.用戶名稱,
                },
                manualScore: check,
                check: checking,
            },
            withToolAttribution(
                (check && wasChecked(target)
                    ? "以原始碼復核提名："
                    : "以原始碼編輯提名：") +
                    formatSummaryPageLinks([fields.條目名稱]),
            ),
        );
    }

    /** Cache decisions locally and publish at most one edit per affected wiki page. */
    async function checkBatch(selections: EntrySelection[]): Promise<boolean> {
        if (batch || writing || !selections.length) return false;
        batch = [];
        batchCommitted = false;
        try {
            const snapshot = await api.getPageSnapshot(REGISTRY_PAGE);
            if (
                selections.some(
                    (item) =>
                        !matchesRevision(snapshot, item.expectedRevisionId),
                )
            ) {
                stale();
                return false;
            }
            const targets = selections.map((item) =>
                targetInSnapshot(snapshot, item),
            );
            if (targets.some((target) => !target)) return false;
            const unique = Array.from(
                new Map(
                    targets.map((target) => [
                        `${target!.date}:${target!.sectionOccurrence}:${target!.index}`,
                        target!,
                    ]),
                ).values(),
            );
            const eligible: Array<{
                target: NominationTarget;
                data: NominationData;
            }> = [];
            for (const target of unique) {
                const data = queried2NomData(target);
                if (!data) {
                    stale();
                    return false;
                }
                if (
                    !getNominationCheckRestriction(
                        data,
                        services.getUserName?.() ?? null,
                    )
                )
                    eligible.push({ target: target!, data });
            }
            if (!eligible.length) return false;
            eligible.sort((left, right) =>
                left.target.date === right.target.date &&
                left.target.sectionOccurrence === right.target.sectionOccurrence
                    ? Number(left.target.index) - Number(right.target.index)
                    : Number(left.target.start) - Number(right.target.start),
            );
            const tableKeys = new Map<string, number>();
            const entries: CheckBatchEntry[] = eligible.map(
                ({ target, data }) => {
                    const tableKey = `${target.date}:${target.sectionOccurrence}:${target.tableIndex}`;
                    if (!tableKeys.has(tableKey))
                        tableKeys.set(tableKey, tableKeys.size);
                    return {
                        nomination: data,
                        target,
                        tableKey,
                        tableIndex: tableKeys.get(tableKey)!,
                    };
                },
            );
            const outcome = normalizeCheckOutcome(
                await dialogs.showCheckBatchDialog(entries),
            );
            if (outcome === CHECK_OUTCOME.SAVE) {
                return !(await completeNominationCheckBatch());
            }
            if (!batchCommitted)
                notify(
                    msg(
                        "the_temporary_results_of_this_batch_have_been_discarded",
                    ),
                    { type: "info" },
                );
            return batchCommitted;
        } catch (cause) {
            reportError(cause, "Batch checking");
            error(
                "batch_checking_stopped_temporary_results_were_not_submitted",
            );
            return false;
        } finally {
            batch = null;
            batchCommitted = false;
        }
    }

    async function archiveChapter(
        date: string,
        sectionOccurrence = 0,
        expectedRevisionId?: string | number | null,
    ) {
        if (batch || writing) return;
        if (
            !(await dialogs.showConfirmDialog({
                title: msg("confirm_archive"),
                message: msg("archive_the_date_section", { date }),
                primaryLabel: msg("archive"),
            }))
        )
            return;
        await guarded(async () => {
            let source = await api.getPageSnapshot(REGISTRY_PAGE);
            if (!matchesRevision(source, expectedRevisionId)) {
                stale();
                return true;
            }
            const section = getDateSections(source.text).filter(
                (item) => item.date === date,
            )[sectionOccurrence];
            if (!section) {
                stale();
                return true;
            }
            const body = source.text.slice(section.start, section.end);
            if (!getWikitextArchiveEligibility(body, now()).available) {
                error("archive_not_ready");
                return true;
            }
            const stamp = body.match(
                /提名人：[\s\S]*?(\d{4})年(\d{1,2})月(\d{1,2})日[^\n]*?\(UTC\)/u,
            );
            if (!stamp) {
                error("the_section_s_utc_date_could_not_be_read_archive");
                return true;
            }
            const destination = `WikiProject:ACG/維基ACG專題獎/存檔/${stamp[1]}年${Number(stamp[2])}月`;
            let archived = false;
            for (let attempt = 0; attempt < 2; attempt++) {
                const snapshot = await api.getPageSnapshot(destination);
                const text = insertArchiveSection(snapshot.text, body, date, {
                    addHeader: !snapshot.exists || snapshot.text.trim() === "",
                    fallbackMonth: Number(stamp[2]),
                    fallbackDay: Number(stamp[3]),
                });
                if (text === snapshot.text) {
                    archived = true;
                    break;
                }
                const result = await api.editPage(
                    destination,
                    text,
                    withToolAttribution(`歸檔「${date}」章節`),
                    editOptions(snapshot),
                );
                if (result.success) {
                    archived = true;
                    break;
                }
                if (!retryable(result)) break;
            }
            if (!archived) {
                error("the_archive_could_not_be_saved_the_registry_has_not");
                return true;
            }
            for (let attempt = 0; attempt < 2; attempt++) {
                const sections = getDateSections(source.text).filter(
                    (item) => item.date === date,
                );
                const matching = sections.filter(
                    (item) => source.text.slice(item.start, item.end) === body,
                );
                const current =
                    attempt === 0
                        ? sections[sectionOccurrence]
                        : matching.length === 1
                          ? matching[0]
                          : null;
                if (
                    !current ||
                    source.text.slice(current.start, current.end) !== body
                )
                    break;
                const result = await api.editPage(
                    REGISTRY_PAGE,
                    source.text.slice(0, current.start) +
                        source.text.slice(current.end),
                    withToolAttribution(
                        `歸檔「${date}」章節至[[${destination}]]`,
                    ),
                    editOptions(source),
                );
                if (result.success) {
                    notify(msg("the_section_was_archived"), {
                        type: "success",
                    });
                    reload();
                    return false;
                }
                if (!retryable(result)) break;
                source = await api.getPageSnapshot(REGISTRY_PAGE);
            }
            error("the_archive_was_saved_but_the_registry_changed_or_could");
            return true;
        });
    }

    return {
        async getExistingNominations(
            pageName?: string,
            expectedRevisionId?: string | number | null,
        ) {
            const snapshot = await api.getPageSnapshot(REGISTRY_PAGE);
            if (!matchesRevision(snapshot, expectedRevisionId)) {
                throw new Error(
                    msg(
                        "this_nomination_or_the_registry_has_changed_refresh_the_page",
                    ),
                );
            }
            return getExistingNominations(snapshot.text, pageName);
        },
        previewNewNomination,
        saveNewNomination,
        saveModifiedNomination,
        saveNominationCheck,
        discardNominationCheck,
        completeNominationCheckBatch,
        saveRawNominationSource,
        checkBatch,
        archiveChapter,
        newNomination: () => dialogs.showNewNominationDialog(),
        async editNomination(selection: EntrySelection) {
            if (batch || writing) return;
            const target = await readTarget(selection);
            if (target)
                await dialogs.showEditNominationDialog(
                    queried2NomData(target),
                    target,
                );
        },
        async checkNomination(selection: EntrySelection) {
            if (batch || writing) return;
            const target = await readTarget(selection);
            if (target) {
                const data = queried2NomData(target);
                if (!checkAllowed(data)) return "cancel" as const;
                return dialogs.showCheckNominationDialog(data, target);
            }
            return "cancel" as const;
        },
    };
}

export type NominationService = ReturnType<typeof createNominationService>;
