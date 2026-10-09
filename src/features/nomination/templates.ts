import dialogTemplateSource from "./dialog.vue";

const DIALOG_TEMPLATE_NAMES = [
    "dialog-host",
    "article-status",
    "author-form",
    "rule-groups",
    "rule-editor",
    "content-expansion-editor",
    "quality-editor",
    "review-editor",
    "activity-editor",
    "score-input",
];

export function extractDialogTemplates(source: string): Record<string, string> {
    const templates: Record<string, string> = {};
    const blockPattern =
        /<!--\s*acga-template:([a-z-]+)\s*-->([\s\S]*?)<!--\s*\/acga-template:\1\s*-->/gu;
    let match;
    while ((match = blockPattern.exec(source)) !== null) {
        const name = match[1];
        if (Object.prototype.hasOwnProperty.call(templates, name)) {
            throw new Error(`Duplicate dialog template: ${name}`);
        }
        templates[name] = match[2].trim();
    }
    for (const name of DIALOG_TEMPLATE_NAMES) {
        if (!templates[name])
            throw new Error(`Missing dialog template: ${name}`);
    }
    return templates;
}

export const {
    "activity-editor": activityEditorTemplate,
    "article-status": articleStatusTemplate,
    "author-form": authorFormTemplate,
    "content-expansion-editor": contentExpansionEditorTemplate,
    "dialog-host": dialogHostTemplate,
    "quality-editor": qualityEditorTemplate,
    "review-editor": reviewEditorTemplate,
    "rule-editor": ruleEditorTemplate,
    "rule-groups": ruleGroupsTemplate,
    "score-input": scoreInputTemplate,
} = extractDialogTemplates(dialogTemplateSource);
