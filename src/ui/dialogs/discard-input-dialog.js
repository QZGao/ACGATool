import {t} from '../../i18n.js';
import {copy, equal} from '../../nomination/operations.js';
import {fieldLabel, fieldText} from '../review-ui.js';

/** 同一欄位連續輸入只列最後的值；取消到原值的欄位不列為將捨棄的輸入。 */
export function collectUnsavedInputs(entries) {
    const combined = [], groups = new Map();
    for (const entry of entries) {
        if (!entry.key) { combined.push(copy(entry)); continue; }
        let group = groups.get(entry.key);
        if (!group) {
            group = {key: entry.key, label: entry.label, before: {}, after: {}};
            groups.set(entry.key, group); combined.push(group);
        }
        group.label = entry.label;
        for (const [field, value] of Object.entries(entry.after)) {
            if (!Object.hasOwn(group.before, field)) group.before[field] = copy(entry.before[field] ?? null);
            group.after[field] = copy(value);
        }
    }
    return combined.map(entry => ({label: entry.label, values: Object.fromEntries(
        Object.entries(entry.after || {}).filter(([field, value]) => !equal(entry.before[field], value)))}))
        .filter((entry, index) => !combined[index].key || Object.keys(entry.values).length);
}

function DiscardInputDialog(config) {
    DiscardInputDialog.super.call(this, config);
    this.entries = config.entries;
}

export function initDiscardInputDialog() {
    OO.inheritClass(DiscardInputDialog, OO.ui.ProcessDialog);
    DiscardInputDialog.static.name = 'ACGADiscardInputs';
    DiscardInputDialog.static.title = t('捨棄未保存輸入', '舍弃未保存输入');
    DiscardInputDialog.static.actions = [
        {action: 'cancel', label: t('取消'), flags: 'safe'},
        {action: 'discard', label: t('捨棄', '舍弃'), flags: ['primary', 'destructive']},
    ];
    DiscardInputDialog.prototype.initialize = function () {
        DiscardInputDialog.super.prototype.initialize.call(this);
        this.panel = new OO.ui.PanelLayout({padded: true, expanded: false});
        this.panel.$element.addClass('acga-unsaved-inputs');
        this.panel.$element.append($('<p>').text(t('以下尚未保存的內容及操作將被捨棄。', '以下尚未保存的内容及操作将被舍弃。')));
        for (const entry of this.entries) {
            const $section = $('<section>').append($('<h4>').text(entry.label));
            const $fields = $('<dl>');
            for (const [field, value] of Object.entries(entry.values)) {
                let text = typeof value === 'string' ? value : fieldText(field, value);
                // 規則摘要以問號顯示無效分數；捨棄前仍須列出使用者原本輸入的文字。
                if (field === 'ruleStatus') for (const [key, rule] of Object.entries(value || {})) {
                    if (rule.scoreInput !== undefined) text += `\n${key} ${t('分數輸入', '分数输入')}：${rule.scoreInput}`;
                }
                $fields.append($('<dt>').text(fieldLabel(field)), $('<dd>').text(text || t('（空白）')));
            }
            this.panel.$element.append($section.append($fields));
        }
        this.$body.append(this.panel.$element);
    };
    DiscardInputDialog.prototype.getBodyHeight = function () { return this.panel.$element.outerHeight(true); };
    DiscardInputDialog.prototype.getEscapeAction = function () { return 'cancel'; };
    DiscardInputDialog.prototype.getActionProcess = function (action) { return new OO.ui.Process(() => this.close({action})); };
}

/** 彈窗只回傳確認結果；呼叫端收到明確的捨棄動作後才清除待保存佇列。 */
export async function confirmDiscardInputs(windows, entries) {
    const dialog = new DiscardInputDialog({size: 'medium', entries});
    windows.addWindows([dialog]);
    const result = await windows.openWindow(dialog).closed;
    await windows.removeWindows(['ACGADiscardInputs']);
    return result?.action === 'discard';
}
