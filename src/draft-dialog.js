import {t} from './state.js';
import {operationType} from './operations.js';
import {cdxIconUserAdd, cdxIconEdit, cdxIconHighlight, cdxIconSandbox} from './icons.js';


/** 草稿箱列出操作類型、用戶、條目與規則；勾選不修改資料，確認後才交由呼叫端搬移。 */
export function DraftDialog(config) {
    DraftDialog.super.call(this, config);
    this.items = config.items;
    this.restore = config.restore;
    this.discard = config.discard;
}

export function initDraftDialog() {
    OO.inheritClass(DraftDialog, OO.ui.ProcessDialog);
    DraftDialog.static.name = 'ACGADrafts';
    DraftDialog.static.title = t('恢復暫存草稿', '恢复暂存草稿');
    DraftDialog.static.actions = [
        {action: 'cancel', label: t('取消'), flags: 'safe'},
        {action: 'discard', label: t('刪除所選草稿', '删除所选草稿'), flags: 'destructive'},
        {action: 'restore', label: t('確認恢復', '确认恢复'), flags: ['primary', 'progressive']},
    ];
    DraftDialog.prototype.initialize = function () {
        DraftDialog.super.prototype.initialize.call(this);
        this.panel = new OO.ui.PanelLayout({padded: true, expanded: false});
        this.panel.$element.addClass('acga-draft-picker');
        const types = {
            new: {label: t('新提名'), icon: cdxIconUserAdd},
            edit: {label: t('編輯提名', '编辑提名'), icon: cdxIconEdit},
            check: {label: t('核對分數', '核对分数'), icon: cdxIconHighlight},
            recheck: {label: t('分數覆核', '分数复核'), icon: cdxIconSandbox},
        };
        this.choices = this.items.map(item => {
            const checkbox = new OO.ui.CheckboxInputWidget();
            // 與表單共用類型判定，已有的 check 草稿也能依原核分結果辨認為覆核。
            const type = operationType(item), {label, icon} = types[type];
            const $type = $('<span>').addClass(`acga-draft-type acga-type-${type}`).append(
                $('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true" focusable="false">').html(icon),
                $('<span>').text(label));
            const $label = $('<span>').append($type, $('<span>').text(` · ${item.label}`));
            const field = new OO.ui.FieldLayout(checkbox, {label: $label, align: 'inline'});
            checkbox.on('change', () => this.actions.setAbilities({restore: this.choices.some(choice => choice.checkbox.isSelected()), discard: this.choices.some(choice => choice.checkbox.isSelected())}));
            this.panel.$element.append(field.$element);
            return {item, checkbox};
        });
        if (!this.items.length) this.panel.$element.append($('<p>').text(t('沒有暫存的提名。', '没有暂存的提名。')));
        this.$body.append(this.panel.$element);
    };
    DraftDialog.prototype.getSetupProcess = function (data) {
        return DraftDialog.super.prototype.getSetupProcess.call(this, data).next(() => this.actions.setAbilities({restore: false, discard: false}));
    };
    DraftDialog.prototype.getBodyHeight = function () { return this.panel.$element.outerHeight(true); };
    DraftDialog.prototype.getActionProcess = function (action) {
        return new OO.ui.Process(async () => {
            if (action === 'restore' || action === 'discard') {
                try { await this[action](this.choices.filter(choice => choice.checkbox.isSelected()).map(choice => choice.item)); }
                catch (error) { throw new OO.ui.Error(error.message, {recoverable: true}); }
            }
            this.close({action});
        });
    };
}
