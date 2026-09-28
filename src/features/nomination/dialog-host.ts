import type { MessageKey } from "../../i18n/index.ts";
import type { MessageValues } from "../../shared/i18n.ts";
import { nominationRuleGroup } from "../../domain/rules.ts";
import type { ComponentOptions } from "vue";
import {
    getOrderedRuleStatus,
    NominationRules,
    NominationRuleSet,
    REVIEW_TIERS,
    serializeNominationReason,
} from "../../domain/rules.ts";
import { parseEditableItemSource } from "../../domain/wikitext.ts";
import { dialogHostTemplate } from "./templates.ts";
import {
    createNominationModel,
    formatNominationTabLabel,
    getSelectedScoreTotal,
} from "./model.ts";
import { createRuleFormComponents } from "./rule-forms.ts";
import { createScoreInput } from "./score-input.ts";
import { createPreviewDocument } from "./preview-document.ts";
import { CHECK_OUTCOME } from "./check-batch.ts";
import type {
    DialogRuntime,
    DialogOperations,
    DialogServices,
} from "./contracts.ts";
export function createDialogHost(
    runtime: DialogRuntime,
    operations: DialogOperations,
    services: DialogServices,
): ComponentOptions {
    const { Codex } = runtime;
    const msg = services.msg;
    const dialogId = "acga-dialog-" + Math.random().toString(36).slice(2);
    const getQueryRoot = () =>
        services.queryRoot ??
        services.document.querySelector(
            `[data-acga-dialog-instance="${dialogId}"]`,
        ) ??
        services.document;
    const model = createNominationModel(services);
    const { ruleNames, ruleDict } = NominationRuleSet(msg);
    const ruleGroups = NominationRules(msg);
    const { RuleEditor, ActivityEditor, AuthorForm } = createRuleFormComponents(
        Codex,
        model,
    );
    const {
        authorCodePreviewResult,
        checkCodePreviewResult,
        cloneValue,
        editableNumber,
        displayNumber,
        own,
        checkTokenRow,
        authorErrorRuleCategory,
        makeAuthorNomination,
        makeCheckNomination,
        makeCheckReasonDraft,
        editableCheckTokens,
        selectedActiveRuleStatus,
        nominationPayload,
        authorValidation,
        checkValidation,
    } = model;
    return {
        name: "AcgaDialogHost",
        components: {
            AcgaAuthorForm: AuthorForm,
            AcgaActivityEditor: ActivityEditor,
            AcgaRuleEditor: RuleEditor,
            AcgaScoreInput: createScoreInput(Codex),
            CdxButton: Codex.CdxButton,
            CdxCheckbox: Codex.CdxCheckbox,
            CdxDialog: Codex.CdxDialog,
            CdxField: Codex.CdxField,
            CdxIcon: Codex.CdxIcon,
            CdxMessage: Codex.CdxMessage,
            CdxProgressBar: Codex.CdxProgressBar,
            CdxSelect: Codex.CdxSelect,
            CdxTab: Codex.CdxTab,
            CdxTable: Codex.CdxTable,
            CdxTabs: Codex.CdxTabs,
            CdxToggleButtonGroup: Codex.CdxToggleButtonGroup,
            CdxTextArea: Codex.CdxTextArea,
            CdxTextInput: Codex.CdxTextInput,
        },
        data() {
            return {
                dialogId,
                open: false,
                kind: null,
                view: "main",
                busy: false,
                settling: false,
                error: "",
                errorDetails: [],
                nominations: [],
                nominationTables: [],
                splitTableMode: false,
                hasSplitMultipleTables: false,
                mergedAdditionalMessage: "",
                mergedCommentCustomized: false,
                activeNominationTableIndex: 0,
                reviewedNominationTables: [],
                nominationSummaryTables: [],
                editingNomination: null,
                editingNominationIndex: -1,
                editingNominationTableIndex: -1,
                editingNominationNumber: 0,
                nominationEditError: "",
                nominationEditErrorDetails: [],
                previewOpen: false,
                previewLoading: false,
                previewHtml: null,
                previewError: "",
                previewRequestId: 0,
                recipientSuggestionVersion: 0,
                activeTab: "",
                addIcon: '<path d="M9 2h2v7h7v2h-7v7H9v-7H2V9h7z"/>',
                removeIcon:
                    '<path d="M7 1h6v2h4v2H3V3h4zm-3 5h12l-1 13H5zm3 2v9h2V8zm4 0v9h2V8z"/>',
                editIcon:
                    '<path d="m16.77 8 1.94-1.94a1 1 0 0 0 0-1.41l-3.36-3.36a1 1 0 0 0-1.41 0L12 3.23zM11 4.23 1 14.23V19h4.77l10-10z"/>',
                freezeIcon: '<path d="M8 15H5V5h3zm7 0h-3V5h3z"/>',
                unfreezeIcon: '<path d="M16 9.5v1L6.5 16H5V4h1.5z"/>',
                checkSelectedRows: [],
                newCheckRuleCode: null,
                initialCheckNomination: null,
                checkReasonDraft: null,
                checkReasonIdentity: null,
                checkOriginalRequestReasonText: "",
                queriedTarget: null,
                batchStatus: null,
                confirmData: null,
                sessionResolve: null,
                ruleGroups: ruleGroups,
                ruleNames: ruleNames,
                ruleDict: ruleDict,
            };
        },
        computed: {
            visibleNominationTables() {
                return this.splitTableMode
                    ? this.nominationTables
                    : [{ nominations: this.nominations }];
            },
            hasSubmittableNominations() {
                return this.nominationTables.some((table: any) =>
                    table.nominations.some(
                        (nomination: any) => !nomination.frozen,
                    ),
                );
            },
            dialogTitle() {
                if (this.kind === "new")
                    return msg(
                        this.view === "nomination-summary"
                            ? "confirm_nomination_submission"
                            : "new_nomination_acg_award_tool",
                    );
                if (this.kind === "edit")
                    return msg("edit_nomination_acg_award_tool");
                if (this.kind === "check") {
                    const progress = this.batchStatus
                        ? ` (${this.batchStatus.current} / ${this.batchStatus.total})`
                        : "";
                    if (this.view === "reason-builder") {
                        return msg("repair_nomination_dialog_title", {
                            progress,
                        });
                    }
                    return msg("check_scoresprogress_acg_award_tool", {
                        progress,
                    });
                }
                return this.confirmData?.title || "";
            },
            currentNomination() {
                return this.nominations[0] || null;
            },
            activeNomination() {
                if (this.kind !== "new") return this.currentNomination;
                return (
                    this.nominations.find(
                        (nomination: any) => nomination.id === this.activeTab,
                    ) || this.currentNomination
                );
            },
            sourceFallbackActive() {
                const nomination = this.activeNomination;
                return Boolean(
                    nomination?.sourceOnly ||
                    (nomination?.rule5Unresolved &&
                        nomination?.activeRuleCategory === "review"),
                );
            },
            checkReasonBuilderActive() {
                return this.kind === "check" && this.view === "reason-builder";
            },
            checkReasonRepairAvailable() {
                return this.kind === "check" && this.checkReasonDraft !== null;
            },
            sourceFallbackMessage() {
                const detail = this.activeNomination?.sourceError;
                const base = this.activeNomination?.rule5Unresolved
                    ? msg(
                          "the_existing_rule_5_entries_cannot_be_represented_by_these",
                      )
                    : msg(
                          "this_nomination_could_not_be_parsed_edit_its_source_below",
                      );
                return detail ? `${base} (${detail})` : base;
            },
            activeNominationPosition() {
                if (this.kind !== "new") return 1;
                const index = this.nominations.findIndex(
                    (nomination: any) => nomination.id === this.activeTab,
                );
                return index < 0 ? 1 : index + 1;
            },
            qualityLevelLabels() {
                return [
                    msg("unassessed_stub_start"),
                    msg("c"),
                    msg("b"),
                    msg("good_article"),
                    msg("featured"),
                ];
            },
            reviewTierItems() {
                const labels: Record<string, string> = {
                    none: msg("general_review"),
                    bcr: msg("b_class_review"),
                    gan: msg("good_article_review"),
                    acr: msg("a_class_review"),
                    fac: msg("featured_article_review"),
                };
                return REVIEW_TIERS.map((tier) => ({
                    label: labels[tier.value],
                    value: tier.value,
                }));
            },
            checkRules() {
                if (!this.currentNomination) return [];
                if (Array.isArray(this.currentNomination.ruleTokens)) {
                    return this.currentNomination.ruleTokens.map(
                        (status: any, index: number) => ({
                            rule: status.code,
                            status,
                            occurrence: index,
                            key: `token:${index}`,
                            ruleset: this.ruleDict[status.code],
                        }),
                    );
                }
                return getOrderedRuleStatus(
                    this.ruleNames,
                    this.currentNomination.ruleStatus,
                ).map((item) => ({
                    ...item,
                    ruleset: this.ruleDict[item.rule],
                }));
            },
            checkColumns() {
                return [
                    {
                        id: "code",
                        label: msg("code"),
                        minWidth: "11em",
                    },
                    {
                        id: "description",
                        label: msg("description"),
                        minWidth: "16em",
                    },
                    {
                        id: "score",
                        label: msg("score"),
                        width: "10em",
                        textAlign: "number",
                    },
                    {
                        id: "actions",
                        label: msg("actions"),
                        width: "10em",
                    },
                ];
            },
            nominationCategoryButtons() {
                return [
                    { value: "article", label: this.articleCreationLabel },
                    { value: "review", label: this.contentReviewLabel },
                    { value: "media", label: this.mediaContributionLabel },
                    {
                        value: "recommendation",
                        label: this.recommendationContributionLabel,
                    },
                    { value: "other", label: this.otherContributionLabel },
                ];
            },
            checkRuleCategory() {
                return this.currentNomination?.activeRuleCategory || "article";
            },
            checkRuleItems() {
                return this.ruleNames
                    .filter(
                        (code: string) =>
                            this.checkRules.length === 0 ||
                            nominationRuleGroup(code) ===
                                this.checkRuleCategory,
                    )
                    .map((code: string) => ({
                        value: code,
                        label: code,
                        description: this.ruleDict[code].label,
                    }));
            },
            checkedRowsModel: {
                get(this: { checkSelectedRows: number[] }): number[] {
                    return this.checkSelectedRows;
                },
                set(
                    this: { updateCheckSelectedRows(rows: number[]): void },
                    rows: number[],
                ) {
                    this.updateCheckSelectedRows(rows);
                },
            },
            checkTableRows() {
                return this.checkRules.map((item: any, index: number) => ({
                    index,
                    rule: item.rule,
                    code: `${item.rule}${item.status.pending ? "?" : ""}`,
                    description: item.status.desc,
                    score: displayNumber(item.status.score),
                    status: item.status,
                    key: item.key,
                }));
            },
            codePreviewResult() {
                const nomination = this.activeNomination;
                if (!nomination || this.view !== "main")
                    return {
                        text: "",
                        error: "",
                    };
                if (this.sourceFallbackActive) {
                    return { text: nomination.rawSourceText, error: "" };
                }
                if (this.kind === "new" || this.kind === "edit") {
                    return authorCodePreviewResult(
                        nomination,
                        this.activeNominationPosition,
                        this.ruleNames,
                    );
                }
                if (this.kind === "check") {
                    return checkCodePreviewResult(
                        nomination,
                        1,
                        this.ruleNames,
                        this.ruleDict,
                    );
                }
                return { text: "", error: "" };
            },
            checkIsOtherRecommendation() {
                return ["他薦", "他荐"].includes(
                    this.currentNomination?.pageName,
                );
            },
            cancelLabel() {
                return msg("cancel");
            },
            saveLabel() {
                if (this.kind === "new") return msg("submit_nominations");
                if (this.kind === "check" && this.batchStatus) {
                    return this.batchStatus.current === this.batchStatus.total
                        ? msg("save_all")
                        : msg("save_temporarily_and_continue");
                }
                return msg("save");
            },
            nominationSummaryColumns() {
                return [
                    { id: "number", label: "#", width: "3em" },
                    {
                        id: "article",
                        label: msg("awarded_article"),
                        minWidth: "10em",
                    },
                    {
                        id: "recipient",
                        label: msg("recipient"),
                        minWidth: "8em",
                    },
                    {
                        id: "score",
                        label: msg("nomination_summary_score"),
                        width: "7em",
                    },
                    {
                        id: "codes",
                        label: msg("nomination_detailed_codes"),
                        minWidth: "12em",
                    },
                    { id: "actions", label: msg("actions"), width: "6em" },
                ];
            },
            nominationEditorTitle() {
                return msg("edit_summary_nomination", {
                    number: this.editingNominationNumber,
                });
            },
            nominationPreviewDocument() {
                return this.previewHtml === null
                    ? ""
                    : createPreviewDocument(this.previewHtml);
            },
            continueLabel() {
                return msg("continue");
            },
            backLabel() {
                return msg("edit_nomination");
            },
            addLabel() {
                return msg("add_nomination");
            },
            removeLabel() {
                return msg("delete_this_nomination");
            },
            skipLabel() {
                return msg("skip");
            },
            awarderLabel() {
                return msg("recipient");
            },
            pageNameLabel() {
                return msg("awarded_article");
            },
            authorPageNameLabel() {
                return msg("article_title");
            },
            articleCreationLabel() {
                return msg("1_4_article_creation");
            },
            articleLengthLabel() {
                return msg("1_length");
            },
            articleQualityLabel() {
                return msg("2_quality");
            },
            articleFormatLabel() {
                return msg("3_formatting");
            },
            ruleCategoryLabel() {
                return msg("nomination_category");
            },
            contentReviewLabel() {
                return msg("5_content_review");
            },
            mediaContributionLabel() {
                return msg("6_media");
            },
            recommendationContributionLabel() {
                return msg("7_nominating_others");
            },
            otherContributionLabel() {
                return msg("8_other");
            },
            scoringItemsLabel() {
                return msg("scoring_rules");
            },
            codePreviewLabel() {
                return msg("item_source_preview");
            },
            additionalMessageLabel() {
                return msg("additional_comment");
            },
            additionalMessagePlaceholder() {
                return msg("no_signature_needed");
            },
            originalRequestReasonLabel() {
                return msg("original_nomination_reason");
            },
            checkReasonBuilderMessage() {
                return msg("nomination_repair_help");
            },
            contentExpansionLabel() {
                return msg("expansion_type_or_custom_description");
            },
            contentExpansionDescriptions() {
                return ["2 kB", "3 kB", "5 kB"];
            },
            toLabel() {
                return msg("to");
            },
            qualityStartLabel() {
                return msg("quality_before_improvement");
            },
            qualityTargetLabel() {
                return msg("quality_after_improvement");
            },
            qualityScoreLabel() {
                return msg("total_quality_improvement_score");
            },
            pendingReviewLabel() {
                return msg("review_pending");
            },
            activityChoiceLabel() {
                return msg("activity_type_or_custom_description");
            },
            activityScoreLabel() {
                return msg("activity_score");
            },
            ruleDescriptionLabel() {
                return msg("description");
            },
            ruleScoreLabel() {
                return msg("score");
            },
            addActivityLabel() {
                return msg("add_activity");
            },
            removeActivityLabel() {
                return msg("remove");
            },
            writingReviewLabel() {
                return msg("writing");
            },
            coverageReviewLabel() {
                return msg("coverage");
            },
            sourceReviewLabel() {
                return msg("source_formatting");
            },
            quickReviewLabel() {
                return msg("quick_review");
            },
            reviewTierLabel() {
                return msg("review_tier");
            },
            reviewScoreLabel() {
                return msg("review_score");
            },
            mediaPageNameLabel() {
                return msg("page_name");
            },
            mediaPageNameDescription() {
                return msg(
                    "filename_including_file_or_an_article_that_uses_the_file",
                );
            },
            relatedPageLabel() {
                return msg("related_page");
            },
            relatedPagePlaceholder() {
                return msg("enter_a_related_page_or_leave_blank");
            },
            legacyContentExpansionMessage() {
                return msg(
                    "this_nomination_has_multiple_expansion_rules_or_custom_scores_each",
                );
            },
            legacyQualityMessage() {
                return msg(
                    "this_nomination_has_custom_or_nonconsecutive_quality_improvement_rules_each",
                );
            },
            rule5MappingMessage() {
                return msg(
                    "the_existing_rule_5_entries_cannot_be_represented_by_this",
                );
            },
        },
        methods: {
            formatScore(score: string | number | null) {
                const value =
                    score === null || score === "" ? "?" : String(score);
                return msg(
                    Number(score) === 1 ? "point_total" : "points_total",
                    { score: value },
                );
            },
            scoreUnit(score: string | number) {
                return msg(Number(score) === 1 ? "point_singular" : "points_2");
            },
            msg(key: MessageKey, values?: MessageValues) {
                return msg(key, values);
            },
            beginSession(
                kind: string,
                fallback: string | boolean,
                setup: () => void,
            ) {
                if (this.open || this.sessionResolve) {
                    services.notify(msg("close_the_current_dialog_first"), {
                        type: "warning",
                    });
                    return Promise.resolve(fallback);
                }
                return new Promise((resolve) => {
                    this.sessionResolve = resolve;
                    this.kind = kind;
                    this.view = "main";
                    this.busy = false;
                    this.settling = false;
                    this.error = "";
                    this.errorDetails = [];
                    this.nominations = [];
                    this.nominationTables = [];
                    this.splitTableMode = false;
                    this.hasSplitMultipleTables = false;
                    this.mergedAdditionalMessage = "";
                    this.mergedCommentCustomized = false;
                    this.activeNominationTableIndex = 0;
                    this.reviewedNominationTables = [];
                    this.nominationSummaryTables = [];
                    this.editingNomination = null;
                    this.editingNominationIndex = -1;
                    this.editingNominationTableIndex = -1;
                    this.editingNominationNumber = 0;
                    this.nominationEditError = "";
                    this.nominationEditErrorDetails = [];
                    this.previewOpen = false;
                    this.previewLoading = false;
                    this.previewHtml = null;
                    this.previewError = "";
                    this.previewRequestId++;
                    this.recipientSuggestionVersion++;
                    this.checkSelectedRows = [];
                    this.newCheckRuleCode = null;
                    this.initialCheckNomination = null;
                    this.checkReasonDraft = null;
                    this.checkReasonIdentity = null;
                    this.checkOriginalRequestReasonText = "";
                    this.queriedTarget = null;
                    this.batchStatus = null;
                    this.confirmData = null;
                    try {
                        setup();
                        this.open = true;
                    } catch (error) {
                        services.reportError(error, "open-dialog");
                        this.sessionResolve = null;
                        this.kind = null;
                        resolve(fallback);
                    }
                });
            },
            openNew() {
                return this.beginSession("new", "cancel", () => {
                    const nomination = makeAuthorNomination(
                        null,
                        this.ruleNames,
                        this.ruleDict,
                    );
                    this.nominations = [nomination];
                    this.nominationTables = [
                        { nominations: this.nominations, comment: "" },
                    ];
                    this.activeTab = nomination.id;
                    void this.suggestRecipient(nomination.id);
                });
            },
            openEdit(nomData: any, queriedTarget: any) {
                return this.beginSession("edit", "cancel", () => {
                    this.nominations = [
                        makeAuthorNomination(
                            nomData,
                            this.ruleNames,
                            this.ruleDict,
                        ),
                    ];
                    this.queriedTarget = cloneValue(queriedTarget);
                });
            },
            openCheck(nomData: any, queriedTarget: any, batchStatus: any) {
                return this.beginSession("check", CHECK_OUTCOME.CANCEL, () => {
                    const nomination = makeCheckNomination(
                        nomData,
                        this.ruleNames,
                        this.ruleDict,
                    );
                    if (nomination.sourceOnly) {
                        this.checkReasonDraft = makeCheckReasonDraft(
                            nomData,
                            this.ruleNames,
                            this.ruleDict,
                        );
                        this.checkReasonIdentity = {
                            awarder: String(nomData?.awarder ?? ""),
                            pageName: String(nomData?.pageName ?? ""),
                        };
                        this.checkOriginalRequestReasonText = String(
                            nomData?.requestReasonText ??
                                nomData?.reasonParse?.rawReason ??
                                "",
                        );
                        this.nominations = [this.checkReasonDraft];
                        this.view = "reason-builder";
                    } else {
                        const draft = makeAuthorNomination(
                            nomData,
                            this.ruleNames,
                            this.ruleDict,
                        );
                        this.checkReasonDraft =
                            draft.sourceOnly || draft.rule5Unresolved
                                ? makeCheckReasonDraft(
                                      nomData,
                                      this.ruleNames,
                                      this.ruleDict,
                                  )
                                : draft;
                        this.checkReasonIdentity = {
                            awarder: String(nomData.awarder ?? ""),
                            pageName: String(nomData.pageName ?? ""),
                        };
                        this.checkOriginalRequestReasonText = String(
                            nomData.requestReasonText ?? "",
                        );
                        this.nominations = [nomination];
                        this.checkSelectedRows = [
                            ...(Array.isArray(nomination.ruleTokens)
                                ? nomination.ruleTokens
                                : getOrderedRuleStatus(
                                      this.ruleNames,
                                      nomination.ruleStatus,
                                  )
                            ).keys(),
                        ];
                        this.initialCheckNomination = cloneValue(nomination);
                    }
                    this.queriedTarget = cloneValue(queriedTarget);
                    this.batchStatus = batchStatus
                        ? cloneValue(batchStatus)
                        : null;
                });
            },
            openConfirmation(options: any) {
                return this.beginSession("confirm", false, () => {
                    this.confirmData = {
                        title: options?.title || msg("confirm"),
                        message: options?.message || "",
                        primaryLabel: options?.primaryLabel || msg("confirm"),
                    };
                });
            },
            async finishSession(result: unknown) {
                if (this.settling || !this.sessionResolve) return;
                this.settling = true;
                this.busy = false;
                this.open = false;
                this.previewOpen = false;
                this.previewLoading = false;
                this.previewRequestId++;
                const resolve = this.sessionResolve;
                await this.$nextTick();
                this.kind = null;
                this.view = "main";
                this.nominations = [];
                this.nominationTables = [];
                this.splitTableMode = false;
                this.hasSplitMultipleTables = false;
                this.mergedAdditionalMessage = "";
                this.mergedCommentCustomized = false;
                this.reviewedNominationTables = [];
                this.nominationSummaryTables = [];
                this.editingNomination = null;
                this.initialCheckNomination = null;
                this.errorDetails = [];
                this.nominationEditErrorDetails = [];
                this.sessionResolve = null;
                this.settling = false;
                resolve(result);
            },
            onOpenUpdate(value: any) {
                if (!value && this.open) this.requestCancel();
            },
            requestCancel() {
                if (this.busy) return;
                if (this.kind === "check")
                    this.finishSession(CHECK_OUTCOME.CANCEL);
                else if (this.kind === "confirm") this.finishSession(false);
                else this.finishSession("cancel");
            },
            clearError() {
                this.error = "";
                this.errorDetails = [];
            },
            invalidNominationLabel(nomination: any) {
                const tableIndex = this.nominationTables.findIndex(
                    (table: any) =>
                        table.nominations.some(
                            (item: any) => item.id === nomination.id,
                        ),
                );
                if (tableIndex >= 0 && this.splitTableMode) {
                    const index = this.nominationTables[
                        tableIndex
                    ].nominations.findIndex(
                        (item: any) => item.id === nomination.id,
                    );
                    return msg("invalid_nomination_table_position", {
                        table: tableIndex + 1,
                        number: index + 1,
                    });
                }
                const index = this.nominationTables
                    .flatMap((table: any) => table.nominations)
                    .findIndex((item: any) => item.id === nomination.id);
                return msg("invalid_nomination_position", {
                    number: index >= 0 ? index + 1 : 1,
                });
            },
            showAuthorValidationErrors(nominations: any[], editing = false) {
                const labels = nominations.map((nomination: any) =>
                    this.invalidNominationLabel(nomination),
                );
                const error = msg("please_check_invalid_forms_before_preview", {
                    forms: labels.join(msg("nomination_position_separator")),
                });
                const details = nominations.flatMap(
                    (nomination: any, index: number) => {
                        const issues =
                            nomination.validationIssues ??
                            Object.values(nomination.errors ?? {}).filter(
                                Boolean,
                            );
                        return issues.map((issue: string) =>
                            nominations.length > 1
                                ? `${labels[index]}: ${issue}`
                                : issue,
                        );
                    },
                );
                if (editing) {
                    this.nominationEditError = error;
                    this.nominationEditErrorDetails = details;
                } else {
                    this.error = error;
                    this.errorDetails = details;
                }
            },
            nominationCodePreviewResult(nomination: any, index: number) {
                return authorCodePreviewResult(
                    nomination,
                    index + 1,
                    this.ruleNames,
                );
            },
            setRawSourceText(value: any) {
                const nomination = this.activeNomination;
                if (!nomination || !this.sourceFallbackActive) return;
                nomination.rawSourceText = String(value ?? "");
                nomination.sourceDirty = true;
                this.clearError();
            },
            setCheckRuleCategory(value: string) {
                if (
                    this.busy ||
                    this.checkRules.length ||
                    !this.currentNomination
                )
                    return;
                if (
                    !this.nominationCategoryButtons.some(
                        (button: { value: string }) => button.value === value,
                    )
                )
                    return;
                this.currentNomination.activeRuleCategory = value;
                this.newCheckRuleCode = null;
                this.clearError();
            },
            resetCheckItems() {
                if (
                    this.busy ||
                    this.kind !== "check" ||
                    this.view !== "main" ||
                    this.sourceFallbackActive ||
                    !this.initialCheckNomination
                )
                    return;
                const restored = cloneValue(this.initialCheckNomination);
                const nomination = this.currentNomination;
                nomination.ruleStatus = restored.ruleStatus;
                nomination.ruleTokens = restored.ruleTokens;
                nomination.activeRuleCategory = restored.activeRuleCategory;
                this.checkSelectedRows = this.checkRules.flatMap(
                    (item: any, index: number) =>
                        item.status.selected ? [index] : [],
                );
                this.newCheckRuleCode = null;
                this.clearError();
            },
            updateCheckSelectedRows(rows: number[]) {
                this.checkSelectedRows = rows.filter(
                    (index) =>
                        Number.isInteger(index) &&
                        index >= 0 &&
                        index < this.checkRules.length,
                );
                const selected = new Set(this.checkSelectedRows);
                this.checkRules.forEach((item: any, index: number) => {
                    item.status.selected = selected.has(index);
                });
                this.clearError();
            },
            setCheckDescription(row: any, value: any) {
                row.status.desc = value;
                this.clearError();
            },
            setCheckScore(row: any, value: any) {
                row.status.score = editableNumber(value);
                this.clearError();
            },
            setCheckCode(row: any, code: string) {
                if (
                    this.busy ||
                    this.kind !== "check" ||
                    this.view !== "main" ||
                    this.sourceFallbackActive ||
                    !this.currentNomination ||
                    !own(this.ruleDict, code) ||
                    nominationRuleGroup(code) !== this.checkRuleCategory
                )
                    return;
                const index = this.checkRules.findIndex(
                    (item: any) => item.status === row.status,
                );
                if (index < 0 || this.checkRules[index].rule === code) return;
                const status = editableCheckTokens(
                    this.currentNomination,
                    this.ruleNames,
                )[index];
                const previous = this.ruleDict[status.code];
                const next = this.ruleDict[code];
                if (status.desc === previous.label) status.desc = next.label;
                if (editableNumber(status.score) === Number(previous.score))
                    status.score = next.score;
                status.code = code;
                status.ogDesc = next.label;
                status.maxScore = next.score;
                delete status.pending;
                this.clearError();
            },
            addCheckItem(value?: string | null) {
                const code = value ?? this.newCheckRuleCode;
                if (
                    this.busy ||
                    this.kind !== "check" ||
                    this.view !== "main" ||
                    this.sourceFallbackActive ||
                    !this.currentNomination ||
                    !own(this.ruleDict, code) ||
                    (this.checkRules.length > 0 &&
                        nominationRuleGroup(code) !== this.checkRuleCategory)
                )
                    return;
                if (this.checkRules.length === 0)
                    this.currentNomination.activeRuleCategory =
                        nominationRuleGroup(code);
                const tokens = editableCheckTokens(
                    this.currentNomination,
                    this.ruleNames,
                );
                tokens.push(
                    checkTokenRow(
                        {
                            code,
                            pending: false,
                            comment: null,
                            scoreOverride: null,
                        },
                        this.ruleDict,
                    ),
                );
                this.checkSelectedRows = tokens.flatMap(
                    (token: any, index: number) =>
                        token.selected ? [index] : [],
                );
                this.newCheckRuleCode = null;
                this.clearError();
            },
            moveCheckItem(row: any, direction: number) {
                if (
                    this.busy ||
                    this.kind !== "check" ||
                    this.view !== "main" ||
                    this.sourceFallbackActive ||
                    !this.currentNomination ||
                    (direction !== -1 && direction !== 1)
                )
                    return;
                const index = this.checkRules.findIndex(
                    (item: any) => item.status === row.status,
                );
                const destination = index + direction;
                if (
                    index < 0 ||
                    destination < 0 ||
                    destination >= this.checkRules.length
                )
                    return;
                const tokens = editableCheckTokens(
                    this.currentNomination,
                    this.ruleNames,
                );
                const [token] = tokens.splice(index, 1);
                tokens.splice(destination, 0, token);
                this.checkSelectedRows = tokens.flatMap(
                    (item: any, position: number) =>
                        item.selected ? [position] : [],
                );
                this.clearError();
            },
            removeCheckItem(row: any) {
                if (
                    this.busy ||
                    this.kind !== "check" ||
                    this.view !== "main" ||
                    this.sourceFallbackActive ||
                    !this.currentNomination
                )
                    return;
                const index = this.checkRules.findIndex(
                    (item: any) => item.status === row.status,
                );
                if (index < 0) return;
                const tokens = editableCheckTokens(
                    this.currentNomination,
                    this.ruleNames,
                );
                tokens.splice(index, 1);
                this.checkSelectedRows = tokens.flatMap(
                    (item: any, position: number) =>
                        item.selected ? [position] : [],
                );
                this.clearError();
            },
            continueCheckReasonBuilder() {
                if (
                    this.busy ||
                    !this.checkReasonBuilderActive ||
                    !this.checkReasonDraft
                )
                    return;
                this.clearError();
                if (authorValidation([this.checkReasonDraft])) {
                    this.showAuthorValidationErrors([this.checkReasonDraft]);
                    this.focusFirstError(this.checkReasonDraft);
                    return;
                }
                const ruleStatus = selectedActiveRuleStatus(
                    this.checkReasonDraft,
                );
                const serialized: any = serializeNominationReason(
                    ruleStatus,
                    this.ruleNames,
                );
                if (!serialized.ok) {
                    this.error = msg(
                        "correct_scores_that_are_not_multiples_of_0_5",
                    );
                    this.focusFirstError(this.checkReasonDraft);
                    return;
                }
                const edited = nominationPayload(this.checkReasonDraft);
                const identity = {
                    awarder: edited.awarder,
                    pageName: edited.pageName,
                };
                const nomination = makeCheckNomination(
                    {
                        ...identity,
                        requestReasonText: serialized.reasonText,
                        ruleStatus,
                    },
                    this.ruleNames,
                    this.ruleDict,
                );
                nomination.ruleStatus = cloneValue(ruleStatus);
                nomination.replaceRequestReason = true;
                this.nominations = [nomination];
                this.checkSelectedRows = [
                    ...getOrderedRuleStatus(
                        this.ruleNames,
                        nomination.ruleStatus,
                    ).keys(),
                ];
                this.view = "main";
                this.initialCheckNomination = cloneValue(nomination);
            },
            backToCheckReasonBuilder() {
                if (
                    this.busy ||
                    !this.checkReasonRepairAvailable ||
                    !this.checkReasonDraft
                )
                    return;
                this.nominations = [this.checkReasonDraft];
                this.checkSelectedRows = [];
                this.view = "reason-builder";
                this.clearError();
            },
            addNomination() {
                if (
                    this.busy ||
                    this.kind !== "new" ||
                    this.view !== "main" ||
                    !this.validateCurrentNomination()
                )
                    return;
                const nomination = makeAuthorNomination(
                    null,
                    this.ruleNames,
                    this.ruleDict,
                );
                const tableIndex = this.splitTableMode
                    ? this.activeNominationTableIndex
                    : this.nominationTables.length - 1;
                this.nominationTables[tableIndex].nominations.push(nomination);
                this.refreshNominationView(nomination.id);
                this.clearError();
                void this.suggestRecipient(nomination.id);
                this.$nextTick(() => {
                    (
                        getQueryRoot().querySelector(
                            `[data-nomination-id="${nomination.id}"] input`,
                        ) as HTMLElement | null
                    )?.focus();
                });
            },
            async suggestRecipient(id: string) {
                const pageName = services.getPageName?.();
                const lookup = services.getSuggestedRecipient;
                const nomination = this.nominationTables
                    .flatMap((table: any) => table.nominations)
                    .find((item: any) => item.id === id);
                if (
                    !pageName ||
                    !lookup ||
                    !nomination ||
                    nomination.usesRecipientDefault !== true ||
                    String(nomination.originalArticleTitle ?? "").trim() !==
                        pageName.trim()
                )
                    return;
                const session = this.sessionResolve;
                const suggestionVersion = this.recipientSuggestionVersion;
                try {
                    const recipient = await lookup(pageName);
                    if (
                        !recipient ||
                        !this.open ||
                        this.busy ||
                        this.kind !== "new" ||
                        this.view !== "main" ||
                        this.sessionResolve !== session ||
                        this.recipientSuggestionVersion !== suggestionVersion ||
                        !this.nominationTables.some((table: any) =>
                            table.nominations.some(
                                (item: any) => item === nomination,
                            ),
                        ) ||
                        services.getPageName?.()?.trim() !== pageName.trim() ||
                        String(nomination.originalArticleTitle ?? "").trim() !==
                            pageName.trim()
                    )
                        return;
                    nomination.articleRecipientDefault = recipient;
                    nomination.articleRecipientSuggestionResolved = true;
                } catch (error) {
                    if (
                        this.open &&
                        this.view === "main" &&
                        this.sessionResolve === session &&
                        this.recipientSuggestionVersion === suggestionVersion
                    ) {
                        services.reportError(
                            error,
                            "suggest-nomination-recipient",
                        );
                    }
                }
            },
            selectNomination(id: string) {
                if (this.busy) return;
                this.activeTab = id;
                this.$nextTick(() => {
                    const tab = getQueryRoot().querySelector<HTMLElement>(
                        `[id="${id}-tab"]`,
                    );
                    tab?.focus();
                    tab?.scrollIntoView({
                        block: "nearest",
                        inline: "nearest",
                    });
                });
            },
            onNominationTabKeydown(event: KeyboardEvent, index: number) {
                if (this.busy) return;
                const count = this.nominations.length;
                let target: number;
                switch (event.key) {
                    case "ArrowLeft":
                    case "ArrowRight": {
                        const tab = event.currentTarget as HTMLElement;
                        const rtl =
                            services.document.defaultView?.getComputedStyle(tab)
                                .direction === "rtl";
                        const next = (event.key === "ArrowRight") !== rtl;
                        target = (index + (next ? 1 : -1) + count) % count;
                        break;
                    }
                    case "Home":
                        target = 0;
                        break;
                    case "End":
                        target = count - 1;
                        break;
                    case "Delete":
                        event.preventDefault();
                        if (count > 1)
                            this.removeNomination(this.nominations[index].id);
                        return;
                    default:
                        return;
                }
                event.preventDefault();
                this.selectNomination(this.nominations[target].id);
            },
            removeNomination(id: string) {
                if (this.busy) return;
                if (this.nominations.length <= 1) {
                    services.notify(
                        msg("at_least_one_nomination_is_required"),
                        { type: "warning" },
                    );
                    return;
                }
                const removeIndex = this.nominations.findIndex(
                    (item: any) => item.id === id,
                );
                if (removeIndex < 0) return;
                const nextId =
                    id === this.activeTab
                        ? (this.nominations[removeIndex + 1]?.id ??
                          this.nominations[removeIndex - 1]?.id)
                        : this.activeTab;
                const tableIndex = this.nominationTables.findIndex(
                    (table: any) =>
                        table.nominations.some((item: any) => item.id === id),
                );
                const table = this.nominationTables[tableIndex];
                table.nominations.splice(
                    table.nominations.findIndex((item: any) => item.id === id),
                    1,
                );
                if (!table.nominations.length)
                    this.nominationTables.splice(tableIndex, 1);
                this.refreshNominationView(nextId);
                this.selectNomination(this.activeTab);
            },
            tabLabel(index: number) {
                return this.splitTableMode
                    ? msg("nomination_item_tab", { number: index + 1 })
                    : formatNominationTabLabel(index + 1, msg);
            },
            nominationTabTooltip(nomination: any) {
                const payload = nominationPayload(nomination);
                const article =
                    nomination.activeRuleCategory === "recommendation"
                        ? msg("nominating_others")
                        : nomination.activeRuleCategory === "other" &&
                            !model.effectiveOtherPageName(nomination)
                          ? msg("other")
                          : payload.pageName;
                return msg("nomination_tab_tooltip", {
                    article,
                    recipient: payload.awarder,
                    score: this.formatScore(
                        getSelectedScoreTotal(payload.ruleStatus),
                    ),
                });
            },
            userUrl(prefix = "User:") {
                return services.getUrl(prefix + this.currentNomination.awarder);
            },
            pageUrl(
                prefix = "",
                query: Record<string, string | number | boolean>,
            ) {
                return services.getUrl(
                    prefix + this.currentNomination.pageName,
                    query,
                );
            },
            backlinksUrl() {
                return (
                    services.getUrl("Special:WhatLinksHere", {
                        target: this.currentNomination.pageName,
                        namespace: 102,
                    }) +
                    "#:~:text=" +
                    encodeURIComponent("WikiProject:ACG/維基ACG專題獎/存檔/")
                );
            },
            focusFirstError(nomination: { id: string } | null = null) {
                this.$nextTick(() => {
                    const scope =
                        nomination && this.kind !== "check"
                            ? getQueryRoot().querySelector(
                                  `[data-nomination-id="${nomination.id}"]`,
                              )
                            : getQueryRoot().querySelector(".acga-check-form");
                    const visibleRuleInput = [
                        ...(scope?.querySelectorAll(".acga-rule-group input") ||
                            []),
                    ].find(
                        (input) =>
                            !input.closest('.cdx-tab[aria-hidden="true"]'),
                    );
                    const target =
                        scope?.querySelector(".acga-error-field input") ||
                        visibleRuleInput ||
                        scope?.querySelector("input") ||
                        getQueryRoot().querySelector(".acga-dialog-error");
                    (target as HTMLElement | null)?.focus();
                });
            },
            updateNominationSummary() {
                const canonicalGroups = this.nominationTables.map(
                    (table: any, tableIndex: number) => ({
                        index: tableIndex,
                        entries: table.nominations.map(
                            (nomination: any, index: number) => ({
                                nomination,
                                index,
                                tableIndex,
                            }),
                        ),
                    }),
                );
                const groups = this.splitTableMode
                    ? canonicalGroups
                    : [
                          {
                              index: 0,
                              entries: canonicalGroups.flatMap(
                                  (group: any) => group.entries,
                              ),
                          },
                      ];
                const reviewedTables = [];
                const summaryTables = [];
                for (const group of groups) {
                    const payloads = [];
                    const rows = [];
                    let includedNumber = 0;
                    for (const [position, entry] of group.entries.entries()) {
                        const source = entry.nomination;
                        const frozen = Boolean(source.frozen);
                        const payload = nominationPayload(source);
                        const serialized = serializeNominationReason(
                            payload.ruleStatus,
                            this.ruleNames,
                        );
                        const score = getSelectedScoreTotal(payload.ruleStatus);
                        if (!frozen && (!serialized.ok || score === null)) {
                            authorValidation([source]);
                            this.showAuthorValidationErrors([source]);
                            return false;
                        }
                        const recommendation =
                            source.activeRuleCategory === "recommendation";
                        const otherPlaceholder =
                            source.activeRuleCategory === "other" &&
                            !model.effectiveOtherPageName(source);
                        if (!frozen) payloads.push(payload);
                        rows.push({
                            index: entry.index,
                            tableIndex: entry.tableIndex,
                            position: position + 1,
                            number: frozen ? "" : ++includedNumber,
                            frozen,
                            article: recommendation
                                ? msg("nominating_others")
                                : otherPlaceholder
                                  ? msg("other")
                                  : payload.pageName,
                            articleUrl:
                                recommendation ||
                                otherPlaceholder ||
                                !payload.pageName
                                    ? null
                                    : services.getUrl(payload.pageName),
                            recipient: payload.awarder,
                            recipientUrl: payload.awarder
                                ? services.getUrl("User:" + payload.awarder)
                                : null,
                            score: this.formatScore(score),
                            codes: serialized.ok ? serialized.reasonText : "",
                        });
                    }
                    if (payloads.length)
                        reviewedTables.push({
                            index: group.index,
                            nominations: cloneValue(payloads),
                        });
                    summaryTables.push({ index: group.index, rows });
                }
                this.reviewedNominationTables = reviewedTables;
                this.nominationSummaryTables = summaryTables;
                return true;
            },
            nominationTableComment(index: number) {
                return this.splitTableMode
                    ? this.nominationTables[index].comment
                    : this.mergedAdditionalMessage;
            },
            nominationTableTitle(index: number) {
                return this.splitTableMode
                    ? msg("nomination_table_title", { number: index + 1 })
                    : msg("nomination_table_title_single");
            },
            setNominationTableComment(index: number, value: string) {
                if (this.busy) return;
                if (this.splitTableMode)
                    this.nominationTables[index].comment = value;
                else {
                    this.mergedAdditionalMessage = value;
                    this.mergedCommentCustomized = true;
                }
            },
            refreshNominationView(preferredId?: string) {
                preferredId ??= this.activeTab;
                const owner = this.nominationTables.findIndex((table: any) =>
                    table.nominations.some(
                        (item: any) => item.id === preferredId,
                    ),
                );
                this.activeNominationTableIndex =
                    owner >= 0
                        ? owner
                        : Math.max(
                              0,
                              Math.min(
                                  this.activeNominationTableIndex,
                                  this.nominationTables.length - 1,
                              ),
                          );
                const table =
                    this.nominationTables[this.activeNominationTableIndex];
                this.nominations = this.splitTableMode
                    ? (table?.nominations ?? [])
                    : this.nominationTables.flatMap(
                          (group: any) => group.nominations,
                      );
                this.activeTab = this.nominations.some(
                    (item: any) => item.id === preferredId,
                )
                    ? preferredId
                    : (this.nominations[0]?.id ?? "");
                if (
                    table?.nominations.some(
                        (item: any) => item.id === this.activeTab,
                    )
                )
                    table.activeTab = this.activeTab;
            },
            splitNominationTable() {
                if (this.busy || this.kind !== "new" || this.view !== "main")
                    return;
                if (!this.splitTableMode && !this.hasSplitMultipleTables) {
                    this.nominationTables[0].comment =
                        this.mergedAdditionalMessage;
                } else if (
                    this.splitTableMode &&
                    !this.mergedCommentCustomized
                ) {
                    this.mergedAdditionalMessage = this.nominationTables
                        .map((table: any) => table.comment.trim())
                        .filter(Boolean)
                        .join("\n\n");
                }
                this.splitTableMode = !this.splitTableMode;
                this.refreshNominationView();
                this.clearError();
                this.selectNomination(this.activeTab);
            },
            validateCurrentNomination() {
                const nomination = this.activeNomination;
                if (!nomination) return false;
                if (!authorValidation([nomination])) return true;
                nomination.activeRuleCategory =
                    authorErrorRuleCategory(nomination);
                this.showAuthorValidationErrors([nomination]);
                this.focusFirstError(nomination);
                return false;
            },
            addNominationTable() {
                if (
                    this.busy ||
                    this.kind !== "new" ||
                    this.view !== "main" ||
                    !this.splitTableMode ||
                    !this.validateCurrentNomination()
                )
                    return;
                this.nominationTables[
                    this.activeNominationTableIndex
                ].activeTab = this.activeTab;
                const nomination = makeAuthorNomination(
                    null,
                    this.ruleNames,
                    this.ruleDict,
                );
                this.nominationTables.push({
                    nominations: [nomination],
                    comment: "",
                });
                this.hasSplitMultipleTables = true;
                this.refreshNominationView(nomination.id);
                this.clearError();
                void this.suggestRecipient(nomination.id);
                this.selectNomination(nomination.id);
            },
            reviewNominations() {
                if (this.busy || this.kind !== "new" || this.view !== "main")
                    return;
                const included = this.nominationTables.flatMap((table: any) =>
                    table.nominations.filter(
                        (nomination: any) => !nomination.frozen,
                    ),
                );
                const firstInvalid = authorValidation(included);
                if (firstInvalid) {
                    this.refreshNominationView(firstInvalid.id);
                    firstInvalid.activeRuleCategory =
                        authorErrorRuleCategory(firstInvalid);
                    this.showAuthorValidationErrors(
                        included.filter((nomination: any) =>
                            Object.values(nomination.errors).some(Boolean),
                        ),
                    );
                    this.focusFirstError(firstInvalid);
                    return;
                }
                this.clearError();
                if (!this.updateNominationSummary()) return;
                this.recipientSuggestionVersion++;
                this.view = "nomination-summary";
                this.focusNominationSummary();
            },
            switchNominationTable(index: number) {
                if (
                    this.busy ||
                    this.kind !== "new" ||
                    this.view !== "main" ||
                    !this.splitTableMode ||
                    !this.nominationTables[index]
                )
                    return;
                const current =
                    this.nominationTables[this.activeNominationTableIndex];
                if (current) current.activeTab = this.activeTab;
                const table = this.nominationTables[index];
                this.activeNominationTableIndex = index;
                this.refreshNominationView(
                    table.nominations.some(
                        (item: any) => item.id === table.activeTab,
                    )
                        ? table.activeTab
                        : table.nominations[0]?.id,
                );
                this.clearError();
            },
            focusNominationSummary() {
                this.$nextTick(() => {
                    getQueryRoot()
                        .querySelector<HTMLElement>(".acga-nomination-summary")
                        ?.focus();
                });
            },
            backToNewNominations() {
                if (
                    this.busy ||
                    this.kind !== "new" ||
                    this.view !== "nomination-summary" ||
                    this.editingNomination ||
                    this.previewOpen
                )
                    return;
                this.view = "main";
                this.clearError();
                for (const table of this.nominationTables) {
                    for (const nomination of table.nominations) {
                        if (!nomination.articleRecipientSuggestionResolved)
                            void this.suggestRecipient(nomination.id);
                    }
                }
                this.selectNomination(this.activeTab);
            },
            editSummaryNomination(
                tableIndex: number,
                index: number,
                number?: number,
            ) {
                if (
                    this.busy ||
                    this.kind !== "new" ||
                    this.view !== "nomination-summary" ||
                    this.editingNomination ||
                    this.previewOpen ||
                    !this.nominationTables[tableIndex]?.nominations[index]
                )
                    return;
                this.editingNomination = cloneValue(
                    this.nominationTables[tableIndex].nominations[index],
                );
                this.editingNominationIndex = index;
                this.editingNominationTableIndex = tableIndex;
                this.editingNominationNumber =
                    number ??
                    (this.splitTableMode
                        ? index + 1
                        : this.nominationTables
                              .slice(0, tableIndex)
                              .reduce(
                                  (count: number, table: any) =>
                                      count + table.nominations.length,
                                  0,
                              ) +
                          index +
                          1);
                this.nominationEditError = "";
                this.nominationEditErrorDetails = [];
            },
            toggleNominationFrozen(tableIndex: number, index: number) {
                if (
                    this.busy ||
                    this.kind !== "new" ||
                    this.view !== "nomination-summary" ||
                    this.editingNomination ||
                    this.previewOpen
                )
                    return;
                const nomination =
                    this.nominationTables[tableIndex]?.nominations[index];
                if (!nomination) return;
                const previous = Boolean(nomination.frozen);
                if (previous && authorValidation([nomination])) {
                    this.showAuthorValidationErrors([nomination]);
                    return;
                }
                nomination.frozen = !previous;
                if (!this.updateNominationSummary()) {
                    nomination.frozen = previous;
                    return;
                }
                this.clearError();
            },
            cancelNominationEdit() {
                if (this.busy) return;
                this.editingNomination = null;
                this.editingNominationIndex = -1;
                this.editingNominationTableIndex = -1;
                this.editingNominationNumber = 0;
                this.nominationEditError = "";
                this.nominationEditErrorDetails = [];
                this.focusNominationSummary();
            },
            clearNominationEditError() {
                this.nominationEditError = "";
                this.nominationEditErrorDetails = [];
            },
            onNominationEditorOpenUpdate(value: boolean) {
                if (!value && this.editingNomination)
                    this.cancelNominationEdit();
            },
            applyNominationEdit() {
                if (
                    this.busy ||
                    !this.editingNomination ||
                    this.editingNominationIndex < 0
                )
                    return;
                const draft = this.editingNomination;
                if (authorValidation([draft])) {
                    draft.activeRuleCategory = authorErrorRuleCategory(draft);
                    this.showAuthorValidationErrors([draft], true);
                    this.$nextTick(() => {
                        const root =
                            services.queryRoot ??
                            services.document.querySelector(
                                `[data-acga-nomination-editor="${dialogId}"]`,
                            );
                        const target =
                            root?.querySelector(".acga-error-field input") ??
                            root?.querySelector(".acga-rule-group input") ??
                            root?.querySelector(".acga-editor-error");
                        (target as HTMLElement | null)?.focus();
                    });
                    return;
                }
                const nominations =
                    this.nominationTables[this.editingNominationTableIndex]
                        .nominations;
                const previous = nominations[this.editingNominationIndex];
                nominations[this.editingNominationIndex] = cloneValue(draft);
                if (!this.updateNominationSummary()) {
                    nominations[this.editingNominationIndex] = previous;
                    this.nominationEditError = this.error;
                    this.nominationEditErrorDetails = this.errorDetails;
                    this.clearError();
                    return;
                }
                this.refreshNominationView();
                this.cancelNominationEdit();
            },
            nominationSubmissionTables() {
                return this.reviewedNominationTables.map((table: any) => ({
                    nominations: cloneValue(table.nominations),
                    comment: this.nominationTableComment(table.index).trim(),
                }));
            },
            async previewNominations() {
                if (
                    this.busy ||
                    this.kind !== "new" ||
                    this.view !== "nomination-summary" ||
                    this.editingNomination ||
                    this.previewOpen ||
                    !this.hasSubmittableNominations
                )
                    return;
                this.previewOpen = true;
                this.previewHtml = null;
                this.previewError = "";
                const preview = operations.previewNewNomination;
                if (!preview) {
                    this.previewError = msg("nomination_preview_unavailable");
                    return;
                }
                this.previewLoading = true;
                const requestId = ++this.previewRequestId;
                const session = this.sessionResolve;
                const isCurrent = () =>
                    this.open &&
                    this.kind === "new" &&
                    this.view === "nomination-summary" &&
                    this.previewOpen &&
                    this.previewRequestId === requestId &&
                    this.sessionResolve === session;
                try {
                    const result = await preview(
                        this.nominationSubmissionTables(),
                    );
                    if (isCurrent()) this.previewHtml = result.html;
                } catch (error) {
                    if (isCurrent()) {
                        this.previewError = msg("nomination_preview_failed");
                        services.reportError(error, "preview-nominations");
                    }
                } finally {
                    if (isCurrent()) this.previewLoading = false;
                }
            },
            closeNominationPreview() {
                this.previewOpen = false;
                this.previewLoading = false;
                this.previewRequestId++;
                this.focusNominationSummary();
            },
            onNominationPreviewOpenUpdate(value: boolean) {
                if (!value && this.previewOpen) this.closeNominationPreview();
            },
            async save() {
                if (this.busy || this.editingNomination || this.previewOpen)
                    return;
                if (this.kind === "new" && this.view !== "nomination-summary") {
                    this.reviewNominations();
                    return;
                }
                if (this.kind === "new" && !this.hasSubmittableNominations)
                    return;
                if (this.checkReasonBuilderActive) {
                    this.continueCheckReasonBuilder();
                    return;
                }
                this.clearError();
                if (
                    (this.kind === "edit" || this.kind === "check") &&
                    this.sourceFallbackActive
                ) {
                    const parsedSource: any = parseEditableItemSource(
                        this.currentNomination.rawSourceText,
                    );
                    if (!parsedSource.ok) {
                        this.error = msg(
                            "the_source_must_contain_one_line_each_for_the_article",
                        );
                        return;
                    }
                    this.busy = true;
                    try {
                        const keepOpen =
                            await operations.saveRawNominationSource(
                                parsedSource.values,
                                cloneValue(this.queriedTarget),
                                { check: this.kind === "check" },
                            );
                        if (!keepOpen) {
                            await this.finishSession(
                                this.kind === "check"
                                    ? CHECK_OUTCOME.SAVE
                                    : "save",
                            );
                        }
                    } catch (error) {
                        services.reportError(error, "save-raw-source");
                        this.error = msg("the_source_could_not_be_saved");
                    } finally {
                        if (this.open) this.busy = false;
                    }
                    return;
                }
                if (
                    (this.kind === "new" &&
                        this.view !== "nomination-summary") ||
                    this.kind === "edit"
                ) {
                    const firstInvalid = authorValidation(this.nominations);
                    if (firstInvalid) {
                        if (this.kind === "new")
                            this.activeTab = firstInvalid.id;
                        firstInvalid.activeRuleCategory =
                            authorErrorRuleCategory(firstInvalid);
                        this.showAuthorValidationErrors(
                            this.nominations.filter((nomination: any) =>
                                Object.values(nomination.errors).some(Boolean),
                            ),
                        );
                        this.focusFirstError(firstInvalid);
                        return;
                    }
                } else if (this.kind === "check") {
                    const error = checkValidation(this.currentNomination);
                    if (error) {
                        this.error = error;
                        this.focusFirstError(this.currentNomination);
                        return;
                    }
                }
                this.busy = true;
                try {
                    let keepOpen;
                    if (this.kind === "new") {
                        keepOpen = await operations.saveNewNomination(
                            this.nominationSubmissionTables(),
                        );
                    } else if (this.kind === "edit") {
                        keepOpen = await operations.saveModifiedNomination(
                            nominationPayload(this.currentNomination),
                            cloneValue(this.queriedTarget),
                        );
                    } else {
                        keepOpen = await operations.saveNominationCheck(
                            nominationPayload(this.currentNomination, true),
                            cloneValue(this.queriedTarget),
                        );
                    }
                    if (!keepOpen) {
                        await this.finishSession(
                            this.kind === "check" ? CHECK_OUTCOME.SAVE : "save",
                        );
                        return;
                    }
                } catch (error) {
                    services.reportError(error, "save-nomination");
                    this.error = msg(
                        "an_error_occurred_while_saving_please_try_again_later",
                    );
                } finally {
                    if (this.open) this.busy = false;
                }
            },
            skip() {
                if (!this.busy && this.kind === "check" && this.batchStatus) {
                    this.finishSession(CHECK_OUTCOME.SKIP);
                }
            },
            confirmPrimary() {
                if (!this.busy && this.kind === "confirm")
                    this.finishSession(true);
            },
        },
        template: dialogHostTemplate,
    };
}
