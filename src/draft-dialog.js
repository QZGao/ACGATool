import state from './state.js';

const t = (hant, hans = hant) => state.convByVar({hant, hans});

/** 草稿箱只列出用戶、條目與規則；勾選不修改資料，確認後才交由呼叫端搬移。 */
export function DraftDialog(config) {
    DraftDialog.super.call(this, config);
    this.items = config.items;
    this.restore = config.restore;
}

export function initDraftDialog() {
    OO.inheritClass(DraftDialog, OO.ui.ProcessDialog);
    DraftDialog.static.name = 'ACGADrafts';
    DraftDialog.static.title = t('恢復暫存草稿', '恢复暂存草稿');
    DraftDialog.static.actions = [
        {action: 'cancel', label: t('取消'), flags: 'safe'},
        {action: 'restore', label: t('確認恢復', '确认恢复'), flags: ['primary', 'progressive']},
    ];
    DraftDialog.prototype.initialize = function () {
        DraftDialog.super.prototype.initialize.call(this);
        this.panel = new OO.ui.PanelLayout({padded: true, expanded: false});
        this.panel.$element.addClass('acga-draft-picker');
        this.choices = this.items.map(item => {
            const checkbox = new OO.ui.CheckboxInputWidget();
            const field = new OO.ui.FieldLayout(checkbox, {label: item.label, align: 'inline'});
            checkbox.on('change', () => this.actions.setAbilities({restore: this.choices.some(choice => choice.checkbox.isSelected())}));
            this.panel.$element.append(field.$element);
            return {item, checkbox};
        });
        if (!this.items.length) this.panel.$element.append($('<p>').text(t('沒有暫存的提名。', '没有暂存的提名。')));
        this.$body.append(this.panel.$element);
    };
    DraftDialog.prototype.getSetupProcess = function (data) {
        return DraftDialog.super.prototype.getSetupProcess.call(this, data).next(() => this.actions.setAbilities({restore: false}));
    };
    DraftDialog.prototype.getBodyHeight = function () { return this.panel.$element.outerHeight(true); };
    DraftDialog.prototype.getActionProcess = function (action) {
        return new OO.ui.Process(() => {
            if (action === 'restore') {
                try { this.restore(this.choices.filter(choice => choice.checkbox.isSelected()).map(choice => choice.item)); }
                catch (error) { throw new OO.ui.Error(error.message, {recoverable: true}); }
            }
            this.close({action});
        });
    };
}
