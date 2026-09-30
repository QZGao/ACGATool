import type { NominationRule } from "../../domain/rules.ts";
import type { ComponentOptions } from "vue";
import {
    ACTIVITY_RULES,
    addActivityDraftRow,
    applyActivityDraft,
    applyContentExpansionChoice,
    applyQualityDraft,
    applyReviewDraft,
    CONTENT_EXPANSION_RULES,
    getContentExpansionMenuItems,
    getReviewDefaultScore,
    QUALITY_LEVELS,
    QUALITY_RULES,
    qualityTotal,
    reviewCode,
    REVIEW_APPLY_MODE,
    REVIEW_ASPECT_ROWS,
} from "../../domain/rules.ts";
import {
    ruleEditorTemplate,
    contentExpansionEditorTemplate,
    qualityEditorTemplate,
    reviewEditorTemplate,
    activityEditorTemplate,
    ruleGroupsTemplate,
    authorFormTemplate,
} from "./templates.ts";
import { getSelectedScoreTotal, type NominationModel } from "./model.ts";
import type { CodexModule } from "./contracts.ts";
import { createScoreInput } from "./score-input.ts";
export function createRuleFormComponents(
    Codex: CodexModule,
    model: NominationModel,
) {
    const ScoreInput = createScoreInput(Codex);
    const {
        editableNumber,
        displayNumber,
        isHalfPointScore,
        activeAuthorRuleStatus,
        recipientPlaceholder,
        articlePageNamePlaceholder,
        mediaPageNamePlaceholder,
        relatedPageNamePlaceholder,
    } = model;
    const RuleEditor: ComponentOptions = {
        name: "AcgaRuleEditor",
        components: {
            AcgaScoreInput: ScoreInput,
            CdxCheckbox: Codex.CdxCheckbox,
            CdxTextInput: Codex.CdxTextInput,
        },
        props: {
            ruleset: { type: Object, required: true },
            status: { type: Object, required: true },
            disabled: { type: Boolean, default: false },
        },
        emits: ["change"],
        data(this: any) {
            return { scoreText: displayNumber(this.status.score) };
        },
        computed: {
            fieldsDisabled() {
                return this.disabled || !this.status.selected;
            },
        },
        watch: {
            "status.score"(value) {
                const current = editableNumber(this.scoreText);
                if (
                    (Number.isNaN(current) && Number.isNaN(Number(value))) ||
                    current === Number(value)
                )
                    return;
                this.scoreText = displayNumber(value);
            },
        },
        methods: {
            setSelected(value: any) {
                this.status.selected = Boolean(value);
                if (!value) {
                    this.status.desc = this.ruleset.label;
                    this.status.score = this.ruleset.score;
                    this.scoreText = String(this.ruleset.score);
                }
                this.$emit("change");
            },
            setDescription(value: any) {
                this.status.desc = value;
                this.$emit("change");
            },
            setScore(value: any) {
                this.scoreText = value;
                this.status.score = editableNumber(value);
                this.$emit("change");
            },
        },
        template: ruleEditorTemplate,
    };
    const ContentExpansionEditor: ComponentOptions = {
        name: "AcgaContentExpansionEditor",
        components: {
            AcgaScoreInput: ScoreInput,
            CdxCombobox: Codex.CdxCombobox,
        },
        props: {
            nomination: { type: Object, required: true },
            ruleDict: { type: Object, required: true },
            disabled: { type: Boolean, default: false },
        },
        emits: ["change"],
        data(this: any) {
            return {
                lastRule: this.nomination.contentExpansion.rule,
                scoreText: displayNumber(
                    this.nomination.contentExpansion.score,
                ),
            };
        },
        computed: {
            draft() {
                return this.nomination.contentExpansion;
            },
            menuItems() {
                return getContentExpansionMenuItems(this.ruleDict).map(
                    (item, index) => ({
                        ...item,
                        description:
                            this.$root.contentExpansionDescriptions[index],
                    }),
                );
            },
        },
        watch: {
            "draft.score"(value) {
                const current = editableNumber(this.scoreText);
                if (
                    (Number.isNaN(current) && Number.isNaN(Number(value))) ||
                    current === Number(value)
                )
                    return;
                this.scoreText = displayNumber(value);
            },
        },
        methods: {
            setChoice(value: any) {
                const normalized = String(value ?? "").trim();
                if (normalized === "") {
                    if (CONTENT_EXPANSION_RULES.includes(this.draft.rule))
                        this.lastRule = this.draft.rule;
                } else if (
                    !CONTENT_EXPANSION_RULES.includes(this.draft.rule) &&
                    CONTENT_EXPANSION_RULES.includes(this.lastRule)
                ) {
                    this.draft.rule = this.lastRule;
                }
                applyContentExpansionChoice(
                    this.nomination.ruleStatus,
                    this.draft,
                    value,
                    this.ruleDict,
                );
                if (CONTENT_EXPANSION_RULES.includes(this.draft.rule))
                    this.lastRule = this.draft.rule;
                this.scoreText = displayNumber(this.draft.score);
                this.$emit("change");
            },
            setScore(value: any) {
                this.scoreText = value;
                this.draft.score = editableNumber(value);
                const status = this.nomination.ruleStatus[this.draft.rule];
                if (status) status.score = this.draft.score;
                this.$emit("change");
            },
        },
        template: contentExpansionEditorTemplate,
    };
    const QualityEditor: ComponentOptions = {
        name: "AcgaQualityEditor",
        components: {
            AcgaScoreInput: ScoreInput,
            CdxCheckbox: Codex.CdxCheckbox,
            CdxSelect: Codex.CdxSelect,
        },
        props: {
            nomination: { type: Object, required: true },
            ruleDict: { type: Object, required: true },
            disabled: { type: Boolean, default: false },
        },
        emits: ["change"],
        data(this: any) {
            return {
                scoreText: displayNumber(this.nomination.quality.score),
            };
        },
        computed: {
            draft() {
                return this.nomination.quality;
            },
            fromItems() {
                return [...QUALITY_LEVELS.keys()].slice(0, -1).map((index) => ({
                    label: this.$root.qualityLevelLabels[index],
                    value: String(index),
                }));
            },
            toItems() {
                return [...QUALITY_LEVELS.keys()]
                    .map((index) => ({
                        label: this.$root.qualityLevelLabels[index],
                        value: String(index),
                        index,
                    }))
                    .filter((item) => item.index > this.draft.fromIndex);
            },
        },
        methods: {
            commit() {
                applyQualityDraft(
                    this.nomination.ruleStatus,
                    this.draft,
                    this.ruleDict,
                );
                this.$emit("change");
            },
            setFrom(value: any) {
                this.draft.fromIndex = Number(value);
                if (this.draft.toIndex <= this.draft.fromIndex) {
                    this.draft.toIndex = Math.min(
                        this.draft.fromIndex + 1,
                        QUALITY_LEVELS.length - 1,
                    );
                }
                this.resetScore();
            },
            setTo(value: any) {
                this.draft.toIndex = Number(value);
                this.resetScore();
            },
            resetScore() {
                this.draft.score = qualityTotal(
                    this.draft.fromIndex,
                    this.draft.toIndex,
                    this.ruleDict,
                );
                this.scoreText = String(this.draft.score);
                this.commit();
            },
            setScore(value: any) {
                this.scoreText = value;
                this.draft.score = value;
                this.commit();
            },
            setPending(value: any) {
                this.draft.pending = Boolean(value);
                this.commit();
            },
        },
        template: qualityEditorTemplate,
    };
    const ReviewEditor: ComponentOptions = {
        name: "AcgaReviewEditor",
        components: {
            AcgaScoreInput: ScoreInput,
            CdxCheckbox: Codex.CdxCheckbox,
            CdxCombobox: Codex.CdxCombobox,
            CdxField: Codex.CdxField,
            CdxRadio: Codex.CdxRadio,
            CdxToggleButtonGroup: Codex.CdxToggleButtonGroup,
        },
        props: {
            nomination: { type: Object, required: true },
            ruleDict: { type: Object, required: true },
            disabled: { type: Boolean, default: false },
        },
        emits: ["change"],
        data(this: any) {
            const review = this.nomination.review;
            const initial =
                review.mode === "complete"
                    ? review.complete
                    : review.mode === "aspects"
                      ? REVIEW_ASPECT_ROWS.map(
                            (row) => review.aspects[row],
                        ).find((row) => row.selected)
                      : review.general;
            return {
                selectedTier: review.presetTier ?? initial?.tier ?? "none",
                scoreText: Object.fromEntries(
                    ["general", ...REVIEW_ASPECT_ROWS, "complete"].map(
                        (row) => [
                            row,
                            displayNumber(
                                row === "general"
                                    ? review.general.score
                                    : row === "complete"
                                      ? review.complete.score
                                      : review.aspects[row].score,
                            ),
                        ],
                    ),
                ),
            };
        },
        computed: {
            reviewMode() {
                return this.nomination.review.mode;
            },
            modeItems() {
                return [
                    {
                        value: "general",
                        label: this.$root.msg("review_mode_general"),
                    },
                    {
                        value: "aspects",
                        label: this.$root.msg("review_mode_specialist"),
                    },
                    {
                        value: "complete",
                        label: this.$root.msg("review_mode_comprehensive"),
                    },
                ];
            },
            rows() {
                const labels: Record<string, string> = {
                    general: this.$root.msg("review_mode_general"),
                    writing: this.$root.msg("writing"),
                    coverage: this.$root.msg("coverage"),
                    source: this.$root.msg("source_formatting"),
                    complete: this.$root.msg("review_mode_comprehensive"),
                };
                return ["general", ...REVIEW_ASPECT_ROWS, "complete"].map(
                    (row) => ({
                        key: row,
                        label: labels[row],
                        draft:
                            row === "general"
                                ? this.nomination.review.general
                                : row === "complete"
                                  ? this.nomination.review.complete
                                  : this.nomination.review.aspects[row],
                    }),
                );
            },
            generalItem() {
                return this.rows[0];
            },
            aspectItems() {
                return this.rows.slice(1, 4);
            },
            completeItem() {
                return this.rows[4];
            },
            displayedItems() {
                return this.reviewMode === "general"
                    ? [this.generalItem]
                    : this.reviewMode === "complete"
                      ? [this.completeItem]
                      : this.aspectItems;
            },
        },
        methods: {
            choiceText(item: any) {
                return (
                    item.draft.description ??
                    this.$root.reviewTierItems.find(
                        (tier: any) => tier.value === item.draft.tier,
                    )?.label ??
                    ""
                );
            },
            choiceItems() {
                return this.$root.reviewTierItems.map((tier: any) => ({
                    label: tier.label,
                    value: tier.label,
                }));
            },
            choiceInvalid(item: any) {
                return (
                    item.draft.selected &&
                    String(this.choiceText(item)).trim() === ""
                );
            },
            setPresetTier(value: string) {
                if (
                    this.disabled ||
                    !this.$root.reviewTierItems.some(
                        (tier: any) => tier.value === value,
                    )
                )
                    return;
                this.selectedTier = value;
                this.nomination.review.presetTier = value;
                for (const item of this.rows) {
                    item.draft.tier = value;
                    delete item.draft.description;
                    item.draft.score = getReviewDefaultScore(
                        item.key,
                        value,
                        item.draft.quick,
                        this.ruleDict,
                    );
                }
                this.commit();
            },
            setReviewMode(value: string) {
                if (
                    this.disabled ||
                    !this.modeItems.some((mode: any) => mode.value === value)
                )
                    return;
                this.nomination.review.mode = value;
                this.commit();
            },
            commit() {
                if (this.nomination.rule5Unresolved) {
                    this.nomination.rule5Unresolved = false;
                    this.nomination.sourceDirty = false;
                    this.nomination.sourceError = "";
                }
                const review = this.nomination.review;
                if (this.reviewMode === "general")
                    review.general.selected = true;
                if (this.reviewMode === "complete")
                    review.complete.selected = true;
                const invalidRows = this.displayedItems.filter(
                    (item: any) =>
                        item.draft.selected &&
                        (!Number.isFinite(Number(item.draft.score)) ||
                            Number(item.draft.score) < 0),
                );
                const appliedDraft = {
                    ...review,
                    general: { ...review.general },
                    complete: { ...review.complete },
                    aspects: Object.fromEntries(
                        REVIEW_ASPECT_ROWS.map((aspect) => [
                            aspect,
                            { ...review.aspects[aspect] },
                        ]),
                    ),
                };
                // Incomplete input stays editable; strict domain mapping receives
                // temporary valid scores, then validation sees the original values.
                for (const item of invalidRows) {
                    const draft =
                        item.key === "general"
                            ? appliedDraft.general
                            : item.key === "complete"
                              ? appliedDraft.complete
                              : appliedDraft.aspects[item.key];
                    draft.score = 0;
                }
                applyReviewDraft(
                    this.nomination.ruleStatus,
                    appliedDraft,
                    this.ruleDict,
                    this.reviewMode,
                );
                for (const item of invalidRows) {
                    const rule = reviewCode(
                        item.key,
                        item.draft.tier,
                        item.draft.quick,
                    );
                    this.nomination.ruleStatus[rule].score = item.draft.score;
                }
                for (const item of this.rows)
                    this.scoreText[item.key] = displayNumber(item.draft.score);
                this.$emit("change");
            },
            setSelected(item: any, value: any) {
                if (this.disabled) return;
                item.draft.selected = Boolean(value);
                this.commit();
            },
            setChoice(item: any, value: any) {
                if (
                    this.disabled ||
                    (this.reviewMode === "aspects" && !item.draft.selected)
                )
                    return;
                const choice = String(value ?? "");
                const tier = this.$root.reviewTierItems.find(
                    (entry: any) =>
                        entry.label === choice || entry.value === choice,
                );
                if (tier) {
                    item.draft.tier = tier.value;
                    delete item.draft.description;
                    this.resetScore(item);
                } else {
                    item.draft.description = choice;
                    this.commit();
                }
            },
            setQuick(item: any, value: any) {
                if (
                    this.disabled ||
                    (this.reviewMode === "aspects" && !item.draft.selected) ||
                    item.key === "complete"
                )
                    return;
                item.draft.quick = Boolean(value);
                this.resetScore(item);
            },
            resetScore(item: any) {
                item.draft.score = getReviewDefaultScore(
                    item.key,
                    item.draft.tier,
                    item.draft.quick,
                    this.ruleDict,
                );
                this.commit();
            },
            setScore(item: any, value: any) {
                if (
                    this.disabled ||
                    (this.reviewMode === "aspects" && !item.draft.selected)
                )
                    return;
                this.scoreText[item.key] = value;
                item.draft.score = editableNumber(value);
                this.commit();
            },
        },
        template: reviewEditorTemplate,
    };
    const ActivityEditor: ComponentOptions = {
        name: "AcgaActivityEditor",
        components: {
            AcgaScoreInput: ScoreInput,
            CdxButton: Codex.CdxButton,
            CdxCheckbox: Codex.CdxCheckbox,
            CdxCombobox: Codex.CdxCombobox,
        },
        props: {
            nomination: { type: Object, required: true },
            ruleDict: { type: Object, required: true },
            disabled: { type: Boolean, default: false },
        },
        emits: ["change"],
        computed: {
            rows() {
                return this.nomination.activity.rows;
            },
            menuItems() {
                return ACTIVITY_RULES.map((rule) => ({
                    label: this.ruleDict[rule].label,
                    value: this.ruleDict[rule].label,
                }));
            },
        },
        methods: {
            choiceInvalid(row: any) {
                return String(row.choice ?? "").trim() === "";
            },
            scoreInvalid(row: any) {
                return !isHalfPointScore(row.score);
            },
            commit() {
                const result = applyActivityDraft(
                    this.nomination.ruleStatus,
                    this.nomination.activity,
                    this.ruleDict,
                );
                this.$emit("change", result);
            },
            setSelected(row: any, value: any) {
                row.selected = Boolean(value);
                this.commit();
            },
            setChoice(row: any, value: any) {
                row.choice = value;
                this.commit();
            },
            setScore(row: any, value: any) {
                row.score = value;
                this.commit();
            },
            setPending(row: any, value: any) {
                row.pending = Boolean(value);
                this.commit();
            },
            addRow() {
                addActivityDraftRow(this.nomination.activity, this.ruleDict);
                this.commit();
            },
            removeRow(row: any) {
                const index = this.rows.findIndex(
                    (item: any) => item.id === row.id,
                );
                if (index >= 0) this.rows.splice(index, 1);
                this.commit();
            },
        },
        template: activityEditorTemplate,
    };
    const RuleGroups: ComponentOptions = {
        name: "AcgaRuleGroups",
        components: {
            AcgaActivityEditor: ActivityEditor,
            AcgaContentExpansionEditor: ContentExpansionEditor,
            AcgaQualityEditor: QualityEditor,
            AcgaReviewEditor: ReviewEditor,
            AcgaRuleEditor: RuleEditor,
            CdxField: Codex.CdxField,
            CdxMessage: Codex.CdxMessage,
            CdxCheckbox: Codex.CdxCheckbox,
        },
        props: {
            nomination: { type: Object, required: true },
            groups: { type: Array, required: true },
            ruleDict: { type: Object, required: true },
            disabled: { type: Boolean, default: false },
        },
        emits: ["change"],
        methods: {
            groupType(group: any) {
                return group.compactGroups ? "article-core" : group.type;
            },
            groupLabel(group: any) {
                const type = this.groupType(group);
                if (
                    ["review", "media", "recommendation", "other"].includes(
                        type,
                    )
                )
                    return this.$root.msg("scoring_rules");
                return group.group;
            },
            compactLineLabel(group: any) {
                const type = this.groupType(group);
                if (type === "content") return this.$root.msg("1_length");
                if (type === "quality") return this.$root.msg("2_quality");
                if (type === "format") return this.$root.msg("3_formatting");
                return group.group;
            },
            formatRule(group: any) {
                return group.rules.find(
                    (rule: NominationRule) => rule.rule === "3",
                );
            },
            compactLineHasToggle(group: any) {
                const type = this.groupType(group);
                if (type === "content")
                    return !this.nomination.contentExpansion.legacy;
                if (type === "quality") return !this.nomination.quality.legacy;
                return false;
            },
            compactLineSelected(group: any) {
                const type = this.groupType(group);
                if (type === "content")
                    return Boolean(this.nomination.contentExpansion.enabled);
                if (type === "quality")
                    return Boolean(this.nomination.quality.enabled);
                if (type === "format") {
                    return Boolean(
                        this.nomination.ruleStatus[this.formatRule(group).rule]
                            .selected,
                    );
                }
                return false;
            },
            canSelectFormat() {
                return Boolean(
                    this.nomination.contentExpansion.enabled ||
                    this.nomination.quality.enabled ||
                    [...CONTENT_EXPANSION_RULES, ...QUALITY_RULES].some(
                        (rule) => this.nomination.ruleStatus[rule]?.selected,
                    ),
                );
            },
            compactLineDisabled(group: any) {
                return (
                    this.disabled ||
                    (this.groupType(group) === "format" &&
                        !this.canSelectFormat() &&
                        !this.compactLineSelected(group))
                );
            },
            setCompactLineSelected(group: any, value: any) {
                const selected = Boolean(value);
                const type = this.groupType(group);
                if (type === "content") {
                    this.nomination.contentExpansion.enabled = selected;
                    applyContentExpansionChoice(
                        this.nomination.ruleStatus,
                        this.nomination.contentExpansion,
                        this.nomination.contentExpansion.choice,
                        this.ruleDict,
                    );
                } else if (type === "quality") {
                    this.nomination.quality.enabled = selected;
                    applyQualityDraft(
                        this.nomination.ruleStatus,
                        this.nomination.quality,
                        this.ruleDict,
                    );
                }
                if (!this.canSelectFormat()) {
                    const formatStatus = this.nomination.ruleStatus["3"];
                    if (formatStatus) formatStatus.selected = false;
                }
                this.$emit("change");
            },
        },
        template: ruleGroupsTemplate,
    };
    const AuthorForm: ComponentOptions = {
        name: "AcgaAuthorForm",
        components: {
            AcgaRuleGroups: RuleGroups,
            CdxField: Codex.CdxField,
            CdxTextInput: Codex.CdxTextInput,
            CdxToggleButtonGroup: Codex.CdxToggleButtonGroup,
        },
        props: {
            nomination: { type: Object, required: true },
            ruleGroups: { type: Array, required: true },
            ruleDict: { type: Object, required: true },
            disabled: { type: Boolean, default: false },
        },
        emits: ["change"],
        computed: {
            awarderInputId() {
                return `acga-awarder-${this.nomination.id}`;
            },
            awarderPlaceholder() {
                return recipientPlaceholder(this.nomination);
            },
            pageNameInputId() {
                return `acga-page-${this.nomination.id}`;
            },
            articlePlaceholder() {
                return articlePageNamePlaceholder(this.nomination);
            },
            mediaPageNameInputId() {
                return `acga-media-${this.nomination.id}`;
            },
            relatedPageInputId() {
                return `acga-related-page-${this.nomination.id}`;
            },
            relatedPagePlaceholder() {
                return relatedPageNamePlaceholder(this.nomination);
            },
            mediaPlaceholder() {
                return mediaPageNamePlaceholder(this.nomination);
            },
            ruleCategoryButtons() {
                return this.$root.nominationCategoryButtons;
            },
            activeRuleCategoryScoreLabel() {
                const total = getSelectedScoreTotal(
                    activeAuthorRuleStatus(this.nomination),
                );
                return this.$root.formatScore(total);
            },
            articleGroups() {
                const groups = this.ruleGroups.filter(
                    (group: any) => group.section === "article",
                );
                const compactGroups = groups.filter(
                    (group: any) => group.type !== "activity",
                );
                return [
                    {
                        section: "article",
                        group: "article-core",
                        explanation: "",
                        compactGroups,
                    },
                    ...groups.filter((group: any) => group.type === "activity"),
                ];
            },
            activeRuleGroups() {
                const groups = this.ruleGroups.filter(
                    (group: any) =>
                        group.type === this.nomination.activeRuleCategory,
                );
                return groups.length ? groups : this.articleGroups;
            },
        },
        methods: {
            setActiveRuleCategory(value: any) {
                this.nomination.activeRuleCategory = value;
                for (const field of ["pageName", "media", "other", "rules"]) {
                    if (this.nomination.errors)
                        this.nomination.errors[field] = "";
                }
                if (value === "review" && !this.nomination.rule5Unresolved) {
                    const review = this.nomination.review;
                    const mode = review.mode;
                    const row =
                        mode === REVIEW_APPLY_MODE.GENERAL
                            ? review.general
                            : mode === REVIEW_APPLY_MODE.COMPLETE
                              ? review.complete
                              : null;
                    if (row && !row.selected) {
                        row.selected = true;
                        applyReviewDraft(
                            this.nomination.ruleStatus,
                            review,
                            this.ruleDict,
                            mode,
                        );
                    }
                }
                this.$emit("change");
            },
            clearFieldError(field: any) {
                this.nomination.errors[field] = "";
                this.$emit("change");
            },
            handleRuleChange() {
                this.nomination.errors.rules = "";
                this.nomination.errors.media = "";
                this.nomination.errors.other = "";
                this.$emit("change");
            },
        },
        template: authorFormTemplate,
    };
    return {
        RuleEditor,
        ContentExpansionEditor,
        QualityEditor,
        ActivityEditor,
        ReviewEditor,
        AuthorForm,
    };
}
