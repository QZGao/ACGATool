import state from "./state.js";
import {createDock} from "./dock.js";
import {getArticleRoot, getNominationSections} from "./page-dom.js";
import {NominationRules, NominationRuleSet} from "./rules.js";
import {submitWorkspace, getNewNominationPlacement} from "./submission.js";
import {newId} from "./scoring.js";
import {reloadForReview} from "./conflicts.js";
import {wikiTransport} from "./transport.js";
import {createDraftStore, clearSubmittedDraft} from "./drafts.js";
import {appendNominationRows, createNominationTable, sourceRows} from "./table-editor.js";
import {DraftDialog, initDraftDialog} from "./draft-dialog.js";

let windowManager = null;  // Window manager for OOUI dialogs
let $editor = null;
let messageInput = null;
let draftStore = null;
let $draftList = null;
let $draftStatus = null;
let reviewWidgets = new Map();
let hiddenSources = new Map();
let dock = null;
let previewTimer = null;
const t = (hant, hans = hant) => state.convByVar({hant, hans});
const editorIsOpen = () => !!$editor && $editor.css('display') !== 'none';
/**
 * 任何核對內容的修改都撤銷該筆的完成標記，並觸發草稿保存。
 */
function touchNomination(index) {
    const nomination = state.nominations[index];
    if (state.workspace?.mode === 'check') {
        nomination.reviewed = false;
        reviewWidgets.get(nomination.id)?.setSelected(false);
    }
    state.changed();
}

export function initOOUI() {
    // Initialize OOUI custom widgets
    initDynamicWidthTextInputWidget();
    initRuleCheckboxInputWidget();
    // Initialize dialogs
    initRuleDialog();
    initDraftDialog();
    initEditorStyles();
    // Initialize window manager
    dock = createDock(getArticleRoot());
    dock.jumpButton.on('click', () => { $editor?.[0].scrollIntoView({block: 'start'}); $editor?.trigger('focus'); });
    initWindowManager();
    initDrafts();
    dock.toggles.drafts.on('click', openDraftBox);
}

function initWindowManager() {
    windowManager = new OO.ui.WindowManager();

    // 規則視窗同樣掛在正文容器內，但由 OOUI 以浮層呈現，並排除 CD 的留言解析。
    windowManager.$element.addClass('acga-dialogs mw-notalk');
    $(getArticleRoot()).append(windowManager.$element);
}

/**
 * 動態寬度文本輸入框。
 * @param config
 * @constructor
 */
function DynamicWidthTextInputWidget(config) {
    DynamicWidthTextInputWidget.parent.call(this, config);
    this.$measure = $('<span>').css({
        position: 'absolute', visibility: 'hidden', whiteSpace: 'pre', fontSize: '14px', fontFamily: 'sans-serif',
    }).appendTo(windowManager.$element);  // 量測用節點留在規則浮層內，不混入正文。
    this.$input.on('input', this.adjustWidth.bind(this));  // Bind the adjustWidth function to the 'input' event.
}

/**
 * 初始化動態寬度文本輸入框。在腳本啟動時執行一次。
 */
function initDynamicWidthTextInputWidget() {
    OO.inheritClass(DynamicWidthTextInputWidget, OO.ui.TextInputWidget);
    mw.util.addCSS('.DynamicWidthTextInputWidget { display: inline-block; vertical-align: baseline; width: auto; margin: 0; } .DynamicWidthTextInputWidget input { height: 20px !important; border: none !important; border-bottom: 2px solid #ccc !important; padding: 0 !important; text-align: center; } .DynamicWidthTextInputWidget input:focus { outline: none !important; box-shadow: none !important; border-bottom: 2px solid #36c !important; } .DynamicWidthTextInputWidget input:disabled { background-color: transparent !important; color: var(--color-base, #202122) !important; -webkit-text-fill-color: var(--color-base, #202122) !important; text-shadow: none !important; border-bottom: 2px solid #fff !important; }');
    DynamicWidthTextInputWidget.prototype.adjustWidth = function () {
        let text = this.getValue() || '';  // Get the current value; use placeholder if empty.
        this.$measure.text(text);  // Update the measurement element.
        let newWidth = this.$measure.width() + 5; // Add a bit of padding.
        this.$input.css('width', newWidth + 'px');  // Apply the new width to the input element.
    };
}

/**
 * 規則選框，附帶規則名和分數輸入框。
 * @param config
 * @constructor
 */
function RuleCheckboxInputWidget(config) {
    RuleCheckboxInputWidget.parent.call(this, config);
    this.checkbox = new OO.ui.CheckboxInputWidget({selected: config.selected || false});
    this.checkbox.$input.attr('aria-label', config.ruleset.rule + ' ' + config.ruleset.desc);
    this.$element.append(this.checkbox.$element);
    this.ruleset = config.ruleset;
    this.nomidx = config.nomidx;
    this.check = config.check || false;
    if (!state.nominations[this.nomidx].ruleStatus[this.ruleset.rule]) {
        state.nominations[this.nomidx].ruleStatus[this.ruleset.rule] = {
            selected: this.isSelected(),
            desc: this.ruleset.desc,
            ogDesc: this.ruleset.desc,
            score: this.ruleset.score,
            maxScore: this.ruleset.score, applicable: !this.check,
        };
    } else {
        this.setSelected(state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].selected);
        if (!state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].desc) {
            state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].desc = this.ruleset.desc;
        }
        state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].ogDesc = this.ruleset.desc;
        if (!Object.prototype.hasOwnProperty.call(state.nominations[this.nomidx].ruleStatus[this.ruleset.rule], 'score')) {
            state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].score = this.ruleset.score;
        }
        state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].maxScore = this.ruleset.score;
    }
    this.ruleInputWidget = new DynamicWidthTextInputWidget({
        value: state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].desc,
        disabled: this.check ? false : (!this.isSelected()),
    });
    this.ruleInputWidget.$input.attr('aria-label', this.ruleset.rule + ' ' + t('規則說明', '规则说明'));
    this.ruleInputWidget.$element.addClass('DynamicWidthTextInputWidget');
    this.ruleInputWidget.$element.css({'margin-left': '5px'});
    this.ruleInputWidget.adjustWidth();
    this.leftBracketLabelWidget = new OO.ui.LabelWidget({label: '('});
    this.leftBracketLabelWidget.$element.css({
        'vertical-align': 'baseline', 'border-bottom': '2px solid #fff',
    });
    this.scoreInputWidget = new DynamicWidthTextInputWidget({
        value: state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].scoreInput ?? state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].score,
        disabled: this.check ? false : (!this.isSelected()),
    });
    this.scoreInputWidget.$input.attr('aria-label', this.ruleset.rule + ' ' + t('分數', '分数'));
    this.scoreInputWidget.$element.addClass('DynamicWidthTextInputWidget');
    this.scoreInputWidget.adjustWidth();
    this.rightBracketLabelWidget = new OO.ui.LabelWidget({label: '分)'});
    this.rightBracketLabelWidget.$element.css({
        'vertical-align': 'baseline', 'border-bottom': '2px solid #fff', 'margin-right': '10px',
    });

    this.$element.append(this.ruleInputWidget.$element);
    this.$element.append(this.leftBracketLabelWidget.$element);
    this.$element.append(this.scoreInputWidget.$element);
    this.$element.append(this.rightBracketLabelWidget.$element);
    this.checkbox.on('change', this.handleCheckboxChange.bind(this));
    this.ruleInputWidget.on('change', this.handleRuleInputChange.bind(this));
    this.scoreInputWidget.on('change', this.handleScoreInputChange.bind(this));
}

/**
 * 初始化規則選框。在腳本啟動時執行一次。
 */
function initRuleCheckboxInputWidget() {
    OO.inheritClass(RuleCheckboxInputWidget, OO.ui.HorizontalLayout);
    RuleCheckboxInputWidget.prototype.isSelected = function () { return this.checkbox.isSelected(); };
    RuleCheckboxInputWidget.prototype.setSelected = function (value) { this.checkbox.setSelected(value); };

    RuleCheckboxInputWidget.prototype.handleCheckboxChange = function (isChecked) {
        state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].selected = isChecked;
        if (isChecked) state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].applicable = true;
        touchNomination(this.nomidx);
        let disableCheck = this.check ? false : (!isChecked);
        this.ruleInputWidget.setDisabled(disableCheck);
        this.scoreInputWidget.setDisabled(disableCheck);
        if (disableCheck) {
            // 取消選取時，重設規則名和分數
            this.ruleInputWidget.setValue(this.ruleset.desc);
            this.ruleInputWidget.adjustWidth();
            this.scoreInputWidget.setValue(this.ruleset.score);
            this.scoreInputWidget.adjustWidth();
        }
    };
    RuleCheckboxInputWidget.prototype.handleRuleInputChange = function (newValue) {
        state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].desc = newValue;
        touchNomination(this.nomidx);
    };
    RuleCheckboxInputWidget.prototype.handleScoreInputChange = function (newValue) {
        state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].scoreInput = newValue;
        state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].score = newValue.trim() === '' ? null : Number(newValue);
        touchNomination(this.nomidx);
    };
}

function initEditorStyles() {
    mw.util.addCSS(`
        .acga-editor { margin: 1.5em 0; }
        .acga-editor { scroll-margin-block: 1em var(--acga-dock-clearance, 100px); }
        .acga-dock { position: fixed; bottom: max(8px, env(safe-area-inset-bottom)); z-index: 100; box-sizing: border-box; color: var(--color-base, #202122); background: var(--background-color-base, #fff); border: 1px solid var(--border-color-base, #a2a9b1); border-radius: 2px; }
        /* OOUI 模態視窗開啟時暫藏底欄，避免底欄遮住視窗或接受提交操作。 */
        .oo-ui-windowManager-modal-active .acga-dock { visibility: hidden; }
        .acga-dock-bar { display: flex; flex-wrap: wrap; align-items: center; gap: .5em 1em; padding: .6em .8em; }
        .acga-dock-heading { display: flex; flex: 1 1 auto; align-items: baseline; flex-wrap: wrap; gap: .5em 1em; }
        .acga-dock-panel { max-height: min(55vh, 32em); overflow: auto; padding: .8em; border-bottom: 1px solid var(--border-color-base, #a2a9b1); }
        .acga-dock-panel > section > :first-child { margin-top: 0; }
        .acga-dock-panel p { margin-block: .4em; }
        .acga-dock-panel .oo-ui-textInputWidget { max-width: none; }
        .acga-dock-panel .acga-actions { margin-top: .6em; }
        .acga-dock .oo-ui-buttonElement { margin: 0; }
        .acga-dock .acga-drafts { display: flex; flex-wrap: wrap; gap: .5em; }
        .acga-dock .acga-drafts > strong { flex-basis: 100%; }
        .acga-dock-archives { display: flex; flex-wrap: wrap; gap: .5em; }
        .acga-dock-options { margin-bottom: .8em; }
        .acga-conflicts { overflow-x: auto; }
        .acga-conflicts:empty { display: none; }
        .acga-conflicts table { width: 100%; border-collapse: collapse; }
        .acga-conflicts th, .acga-conflicts td { text-align: left; vertical-align: baseline; padding: .5em; border: 1px solid var(--border-color-base, #a2a9b1); overflow-wrap: anywhere; white-space: pre-wrap; }
        .acga-conflicts mark { background: var(--background-color-warning-subtle, #fef6e7); color: var(--color-base, #202122); }
        .acga-needs-review > .acgnom-check-cell { outline: 2px solid var(--color-error, #b32424); outline-offset: -2px; }
        .acga-save-progress li { margin-block: .75em; }
        .acga-save-progress p { margin-block: .25em; }
        .acga-edit-table { width: 100%; }
        .acga-edit-table .acgnom-title-heading, .acga-edit-table .acgnom-user-heading { width: 25%; }
        .acga-edit-table .acga-cell-input { width: 100%; max-width: none; }
        .acga-edit-table .acga-cell-input input { min-width: 0; background: transparent; color: inherit; font: inherit; padding: .25em; }
        .acga-inline-action { border: 0; background: transparent; padding: 0; color: var(--color-progressive, #36c); cursor: pointer; font: inherit; font-size: smaller; }
        .acga-inline-action::before { content: '［'; } .acga-inline-action::after { content: '］'; }
        .acga-inline-action:hover { text-decoration: underline; }
        .acga-inline-action:focus-visible { outline: 2px solid var(--color-progressive, #36c); }
        /* 圖標沿用原筆圖標的 12px，加上少量邊距後，純圖標按鈕為 16px。 */
        .acga-icon-button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 16px; min-height: 16px; box-sizing: border-box; padding: 1px; border: 1px solid transparent; border-radius: 2px; background: transparent; color: var(--color-progressive, #36c); font: inherit; line-height: 1; vertical-align: middle; cursor: pointer; }
        .acga-icon-button svg { display: block; flex: none; width: 12px; height: 12px; fill: currentColor; }
        .acga-icon-button:enabled:hover { background: var(--background-color-progressive-subtle, #eaf3ff); }
        .acga-icon-button--destructive { color: var(--color-destructive, #b32424); }
        .acga-icon-button--destructive:enabled:hover { background: var(--background-color-destructive-subtle, #fee7e6); }
        .acga-icon-button:focus-visible { outline: 2px solid var(--color-progressive, #36c); outline-offset: 1px; }
        .acga-icon-button:disabled { opacity: .5; cursor: default; }
        .acga-row-actions { display: flex; justify-content: center; align-items: center; gap: 4px; margin-top: .3em; }
        .acga-stash-nomination { font-size: 12px; }
        .acga-draft-picker .oo-ui-fieldLayout { margin-top: .75em; }
        .acga-draft-picker .oo-ui-fieldLayout:first-child { margin-top: 0; }
        .acga-check-button { margin-left: 5px; font-size: .857em; font-weight: bold; }
        .acga-inline-option { display: inline-flex; align-items: baseline; gap: .25em; margin: .4em .75em .25em 0; }
        .acga-check-message { max-width: none; margin-top: .4em; }
        .acga-original-check { margin-block: .4em; }
        .acga-booking { margin-block: .4em; }
        .acga-booking select { max-width: 100%; font: inherit; }
        .acga-edit-table th, .acga-edit-table td { overflow-wrap: anywhere; }
        .acga-edit-table .acgnom-title-cell { text-align: center; }
        .acga-table-scroll { overflow-x: auto; }
        .acga-drafts .oo-ui-buttonElement { max-width: 100%; }
        .acga-drafts .oo-ui-labelElement-label { white-space: normal; }
        .acga-editor .oo-ui-horizontalLayout { min-width: 0; }
        .acga-actions { display: flex; flex-wrap: wrap; gap: .5em; margin: 0; }
        .acga-rules details { margin: .75em 0; }
        .acga-rules summary { cursor: pointer; font-weight: bold; }
        .acga-rules .oo-ui-horizontalLayout { display: flex; flex-wrap: wrap; gap: .5em; }
        @media (max-width: 600px) { .acga-edit-table { min-width: 340px; } .acga-editor .oo-ui-horizontalLayout { max-width: 100%; } }
    `);
}

function ruleSummary(ruleStatus) {
    const {ruleDict} = NominationRuleSet();
    return Object.entries(ruleStatus).filter(([, value]) => value.selected)
        .map(([key, value]) => {
            const score = Object.prototype.hasOwnProperty.call(value, 'score') ? value.score : ruleDict[key]?.score;
            return `${value.desc || ruleDict[key]?.desc || key} (${Number.isFinite(score) ? score : '?'} ${t('分')})`;
        }).join('、') || t('尚未選擇規則', '尚未选择规则');
}

function RulesDialog(config) { RulesDialog.super.call(this, config); }
/**
 * 建立共用規則彈窗。常用分類與已有選項的分類展開，其餘保留為摺疊區。
 * 選項直接更新目前提名的狀態；主編輯器的摘要在彈窗關閉後刷新。
 */
function initRuleDialog() {
    OO.inheritClass(RulesDialog, OO.ui.ProcessDialog);
    RulesDialog.static.name = 'ACGARules';
    RulesDialog.static.title = t('選擇規則', '选择规则');
    RulesDialog.static.actions = [{action: 'done', label: t('完成'), flags: ['primary', 'progressive']}];
    RulesDialog.prototype.initialize = function () {
        RulesDialog.super.prototype.initialize.call(this);
        this.panel = new OO.ui.PanelLayout({padded: true, expanded: false});
        this.panel.$element.addClass('acga-rules');
        const nomination = state.nominations[this.nomidx];
        NominationRules().forEach((group, index) => {
            const rules = group.rules || group.tabs.flatMap(tab => tab.rules);
            const selected = rules.some(rule => nomination.ruleStatus[rule.rule]?.selected);
            const $details = $('<details>').prop('open', index < 3 || selected);
            $details.append($('<summary>').text(group.group));
            $details.append($('<p>').text(group.explanation));
            const addRules = items => {
                const widgets = items.map(rule => new RuleCheckboxInputWidget({ruleset: rule, value: rule.rule, nomidx: this.nomidx, check: this.check}));
                $details.append(new OO.ui.HorizontalLayout({items: widgets}).$element);
            };
            if (group.rules) addRules(group.rules);
            else group.tabs.forEach(tab => {
                $details.append($('<h3>').text(tab.tab));
                addRules(tab.rules);
            });
            $details.on('toggle', () => this.updateSize());
            this.panel.$element.append($details);
        });
        this.$body.append(this.panel.$element);
    };
    RulesDialog.prototype.getBodyHeight = function () { return this.panel.$element.outerHeight(true); };
    RulesDialog.prototype.getActionProcess = function () { return new OO.ui.Process(() => { this.close(); }); };
}

/**
 * 開啟某筆提名的規則選擇器，關閉後更新其畫面並釋放視窗。
 * @param {number} nomidx 目前 nominations 陣列中的位置。
 * @param {Function} onClose 更新主編輯器規則摘要的回呼。
 */
async function openRules(nomidx, onClose) {
    const dialog = new RulesDialog({size: 'large'});
    dialog.nomidx = nomidx;
    dialog.check = state.workspace.mode === 'check';
    windowManager.addWindows([dialog]);
    await windowManager.openWindow(dialog).closed;
    onClose();
    await windowManager.removeWindows(['ACGARules']);
}

/**
 * 在原提名表格旁建立編輯區；新提名或找不到原表格時放在登記處內容末尾。
 * 已有開啟的編輯器時只移回該處，避免後續初始化覆寫其共享狀態。
 * @returns {jQuery|null} 新編輯區；已有編輯器時為 null。
 */
function mountEditor(title, source) {
    if (editorIsOpen()) {
        $editor[0].scrollIntoView({block: 'start'});
        mw.notify(t('請先完成或關閉目前的編輯器。', '请先完成或关闭当前编辑器。'));
        return null;
    }
    restoreSourceRows();
    clearTimeout(previewTimer);
    $editor?.remove();
    $editor = $('<section>').addClass('acga-editor').attr({'aria-label': title, tabindex: '-1'});
    dock.$title.text(title);
    dock.$summary.empty();
    dock.panes.details.empty();
    dock.showPanel(null);
    dock.setActive(true);
    const $source = sourceRows(source).closest('table').first();
    if ($source.length) $source.before($editor);
    else $(getArticleRoot()).append($editor);
    $editor[0].scrollIntoView({block: 'start'});
    $editor.trigger('focus');
    return $editor;
}

/**
 * 將每個頁面的儲存狀態接到懸浮面板；操作按鈕固定於底欄，不隨表格插入正文。
 * 已完成項目不再提供重送操作。
 * 回應未明的項目只查證原請求。使用者關閉或重新載入後，仍可由草稿恢復。
 */
function addEditorActions($panel, extras = []) {
    // 正文保留提名表格與新日期預覽；提交、說明與結果使用固定懸浮區的內容槽。
    $panel.children().wrapAll('<div class="acga-fields"></div>');
    const $details = dock.panes.details;
    const $options = $details.children('.acga-dock-options');
    $draftStatus = $('<p>').attr('role', 'status');
    const $status = $('<p>').attr('role', 'status');
    const $conflicts = $('<div>').attr('role', 'alert').addClass('acga-conflicts');
    const $progress = $('<ol>').addClass('acga-save-progress').attr('aria-label', t('儲存進度', '储存进度'));
    const saveButton = new OO.ui.ButtonWidget({label: t('送出全部', '提交全部'), flags: ['primary', 'progressive']});
    const closeButton = new OO.ui.ButtonWidget({label: t('關閉並保留草稿', '关闭并保留草稿')});
    const forkButton = new OO.ui.ButtonWidget({label: t('另存目前草稿', '另存当前草稿')});
    const buttons = [saveButton, ...extras, closeButton, forkButton];
    let saving = false, completed = false, completedOperation = null;
    const showProgress = () => {
        const operation = state.workspace.operation || completedOperation;
        $progress.empty();
        saveButton.toggle(!operation);
        saveButton.setDisabled(saving || completed || !!state.workspace.conflicts?.length);
        showConflicts($conflicts, $panel);
        if (state.workspace.conflicts?.length) dock.showPanel('details');
        if (!operation) return;
        operation.steps.forEach((step, index) => {
            const labels = {pending: t('等待儲存', '等待储存'), saving: t('正在儲存', '正在储存'), succeeded: t('✓ 已完成'), failed: t('儲存失敗', '储存失败'), unknown: t('結果未明', '结果未明'), conflict: t('內容已變更，需重新核對', '内容已变更，需重新核对')};
            const name = step.key === 'registry' ? t('登記處', '登记处') : t('積分榜', '积分榜');
            const $row = $('<li>').append($('<strong>').text(`${name}：${labels[step.status] || step.status}`));
            if (step.error) $row.append($('<p>').text(step.error));
            if (step.status === 'succeeded' && step.revid) {
                $row.append(' ', $('<a>').attr({href: mw.util.getUrl(step.title, {oldid: step.revid}), target: '_blank', rel: 'noopener'}).text(t('查看已儲存版本', '查看已储存版本')));
            }
            if (['failed', 'unknown', 'saving', 'pending'].includes(step.status)) {
                // 恢復中的 saving 也可能早已寫入；這兩種狀態只能先查詢結果。
                const uncertain = ['unknown', 'saving'].includes(step.status);
                const retry = new OO.ui.ButtonWidget({label: uncertain ? t('重新查詢結果', '重新查询结果') : t('重試', '重试')});
                retry.setDisabled(saving || operation.steps.slice(0, index).some(previous => previous.status !== 'succeeded'));
                retry.on('click', runSave);
                $row.append(' ', retry.$element);
            }
            $progress.append($row);
        });
    };
    const runSave = async () => {
        if (saving || completed) return;
        saving = true;
        const $inputs = $panel.add($options).find(':input');
        const controls = $inputs.toArray().map(element => [element, element.disabled]);
        $inputs.prop('disabled', true);
        $options.prop('inert', true).attr('inert', '');
        dock.toggles.drafts.setDisabled(true);
        dock.toggles.recovery.setDisabled(true);
        dock.showPanel('details');
        // 部分 OOUI 控制項是連結而非 input；inert 同時阻止其滑鼠與鍵盤操作。
        $panel.find('.acga-fields').prop('inert', true).attr('inert', '');
        buttons.forEach(button => button.setDisabled(true));
        $status.text(t('正在儲存或確認上次提交結果…', '正在储存或确认上次提交结果…'));
        try {
            persistWorkspace();
            const success = await submitWorkspace(state.workspace, persistWorkspace);
            if (success) {
                // 草稿完成後會移除 operation，另留畫面快照以繼續顯示完成狀態。
                completedOperation = state.workspace.operation;
                clearSubmittedDraft(draftStore, state.workspace, completedOperation.submitted);
                state.nominations = state.workspace.nominations;
                completed = true;
                clearTimeout(previewTimer);
                refreshDraftList();
                $draftStatus.text(state.nominations.length ? t('尚未提交的修改已保留。', '尚未提交的修改已保留。') : t('已清除本次提交的草稿。', '已清除本次提交的草稿。'));
                $status.text(t('本次提交已全部完成。', '本次提交已全部完成。'));
                closeButton.setLabel(t('關閉', '关闭'));
            } else $status.text(t('儲存尚未完成，草稿和已完成的步驟已保留。', '储存尚未完成，草稿和已完成的步骤已保留。'));
        } catch (error) {
            $status.text(t('儲存未完成：', '储存未完成：') + (error.message || String(error)));
        } finally {
            saving = false;
            controls.forEach(([element, disabled]) => { element.disabled = disabled; });
            buttons.forEach(button => button.setDisabled(completed && button !== closeButton));
            dock.toggles.drafts.setDisabled(false);
            dock.toggles.recovery.setDisabled(false);
            if (completed) $panel.add($options).find(':input').prop('disabled', true);
            else lockPendingForm($panel);
            showProgress();
        }
    };
    state.progress = showProgress;
    forkButton.on('click', () => {
        state.workspace.id = newId(); state.workspace.storageVersion = 0; state.changed();
    });
    closeButton.on('click', () => {
        clearTimeout(previewTimer);
        $panel.hide(); restoreSourceRows(); dock.setActive(false);
        if (!completed) { state.workspace.open = false; state.changed(); }
        if (completed) location.reload();
    });
    saveButton.on('click', runSave);
    dock.$actions.empty().append([saveButton, ...extras, closeButton].map(button => button.$element));
    $details.append($conflicts, $draftStatus, $progress, $status, $('<div>').addClass('acga-actions').append(forkButton.$element));
    $panel.on('input change', () => { if (!completed) state.changed(); });
    state.changed();
    lockPendingForm($panel);
    showProgress();
}

/**
 * 已有未完成的提交時鎖住編輯內容，避免恢復或重試時改變原請求的含義。
 * 使用者仍可透過儲存操作區查詢結果、重試或關閉。
 */
function lockPendingForm($panel) {
    const locked = !!state.workspace.operation;
    const $fields = $panel.find('.acga-fields').add(dock.panes.details.children('.acga-dock-options'));
    $fields.prop('inert', locked);
    if (locked) $fields.attr('inert', '');
    else $fields.removeAttr('inert');
}

/**
 * 綁定目前草稿與畫面使用的共享陣列。
 * state.nominations 與 workspace.nominations 指向同一陣列，不另保留一份可分歧的表單資料。
 */
function activateWorkspace(workspace) {
    state.progress = () => {};
    reviewWidgets = new Map();
    state.workspace = workspace;
    workspace.open = true;
    state.nominations = workspace.nominations;
    state.changed = () => {
        try { persistWorkspace(); }
        catch (error) { $draftStatus?.text(t('草稿尚未保存：', '草稿尚未保存：') + error.message); dock.showPanel('details'); }
    };
}

/**
 * 同步保存草稿，再更新畫面狀態。
 * 錯誤必須往上傳：提交流程需先成功保存請求狀態，才可以開始遠端寫入。
 */
function persistWorkspace() {
    if (!draftStore) throw new Error(t('瀏覽器無法使用本機儲存。', '浏览器无法使用本机储存。'));
    draftStore.save(state.workspace);
    $draftStatus?.text(t('草稿已保存於此瀏覽器。', '草稿已保存于此浏览器。'));
    refreshDraftList();
    state.progress?.();
}

/**
 * 依維基站點及登入帳號隔離本機草稿，讀取失敗時保留原儲存資料並提示。
 */
function initDrafts() {
    $draftList = dock.panes.recovery.addClass('acga-drafts');
    if (mw.config.get('wgPageName') !== 'WikiProject:ACG/維基ACG專題獎/登記處') { dock.toggles.drafts.toggle(false); return; }
    try {
        const prefix = `ACGATool:v1:${mw.config.get('wgDBname')}:${mw.config.get('wgUserName') || 'anonymous'}`;
        draftStore = createDraftStore(window.localStorage, prefix);
        refreshDraftList();
    } catch (error) {
        $draftList.text(t('無法讀取本機草稿：', '无法读取本机草稿：') + error.message);
        dock.toggles.recovery.toggle(true);
        dock.showPanel('recovery');
    }
}

function refreshDraftList() {
    const drafts = draftStore.list();
    const inactive = drafts.filter(draft => !editorIsOpen() || draft.id !== state.workspace?.id);
    const count = inactive.filter(draft => draft.mode === 'new' && !draft.operation).reduce((sum, draft) => sum + draft.nominations.length, 0);
    dock.toggles.drafts.setLabel(`${t('草稿箱')} (${count})`);
    $draftList.empty();
    const recovery = inactive.filter(draft => draft.mode !== 'new' || draft.operation);
    dock.toggles.recovery.toggle(recovery.length > 0);
    for (const draft of recovery) {
        const label = `${draft.mode === 'check' ? t('核對', '核对') : draft.mode === 'new' ? t('新提名') : t('編輯', '编辑')}：${draft.nominations.map(n => n.pageName || t('未填條目', '未填条目')).join('、')}`;
        const button = new OO.ui.ButtonWidget({label});
        button.on('click', () => {
            if (draft.mode === 'check') showCheckNominations(draft.nominations, draft);
            else if (draft.mode === 'new') showNewNominationDialog(draft);
            else showEditNominationDialog(draft.nominations[0], draft);
        });
        $draftList.append(button.$element);
    }
}

/** 開啟 checkbox 草稿箱；未完成的核對／儲存使用獨立的繼續編輯入口。 */
async function openDraftBox() {
    if (editorIsOpen() && (state.workspace.mode !== 'new' || state.workspace.operation)) {
        mw.notify(t('請先關閉目前的編輯器，再恢復新提名。', '请先关闭当前编辑器，再恢复新提名。'));
        return;
    }
    try {
        const items = draftStore.list().filter(draft => draft.mode === 'new' && !draft.operation && (!editorIsOpen() || draft.id !== state.workspace.id))
            .flatMap(draft => draft.nominations.map(nomination => ({draft, nomination,
                label: `${nomination.awarder || t('未填用戶', '未填用户')} · ${nomination.pageName || t('未填條目', '未填条目')} · ${ruleSummary(nomination.ruleStatus || {})}`})));
        const dialog = new DraftDialog({size: 'medium', items, restore: restoreStashedNominations});
        windowManager.addWindows([dialog]);
        await windowManager.openWindow(dialog).closed;
        await windowManager.removeWindows(['ACGADrafts']);
    } catch (error) { mw.notify(error.message || String(error), {type: 'error'}); }
}

/** 一次搬移全部選中提名，再把新列追加到目前表單尾部。 */
function restoreStashedNominations(items) {
    const selections = new Map();
    for (const {draft, nomination} of items) {
        if (!selections.has(draft.id)) selections.set(draft.id, {draft, nominationIds: []});
        selections.get(draft.id).nominationIds.push(nomination.id);
    }
    const append = editorIsOpen();
    if (append) persistWorkspace();
    const workspace = append ? state.workspace : {id: newId(), mode: 'new', open: true, nominations: [], message: ''};
    const previousCount = workspace.nominations.length;
    draftStore.transfer([...selections.values()], workspace);
    if (!append) showNewNominationDialog(workspace);
    else {
        state.nominations = workspace.nominations;
        const $table = $editor.find('.acga-edit-table');
        workspace.nominations.slice(previousCount).forEach((nomination, index) => renderEditableNomination($table, nomination, previousCount + index));
        messageInput.setValue(workspace.message);
        refreshDraftList(); state.progress?.();
    }
}

/** 頁面資料與原列定位完成後，恢復重新整理前仍開啟的表單。 */
export function resumeOpenWorkspace() {
    // 頁面資料載入期間，使用者可能已自行開啟表單；此時沿用目前表單。
    if (editorIsOpen()) return true;
    let draft;
    try { draft = draftStore?.active(); }
    catch (error) { mw.notify(error.message || String(error), {type: 'error'}); return false; }
    if (!draft) return false;
    if (draft.mode === 'check') showCheckNominations(draft.nominations, draft);
    else if (draft.mode === 'new') showNewNominationDialog(draft);
    else showEditNominationDialog(draft.nominations[0], draft);
    return true;
}

/**
 * 恢復開啟編輯器前的 display 值，避免把原本隱藏的頁面內容一併顯示。
 */
function restoreSourceRows() {
    for (const [element, display] of hiddenSources) element.style.display = display;
    hiddenSources.clear();
}

/**
 * 暫時隱藏被編輯的原提名列；整張表都已搬入編輯器時也隱藏原表頭。
 * 保留原 DOM 與 display 值，關閉未提交草稿時可以原樣恢復。
 */
function hideSourceRows(source) {
    const $rows = sourceRows(source);
    const hide = element => {
        if (!hiddenSources.has(element)) hiddenSources.set(element, element.style.display);
        element.style.display = 'none';
    };
    $rows.each((_, element) => hide(element));
    $rows.closest('table').each((_, table) => {
        if ($(table).find('tr').slice(1).toArray().every(row => row.style.display === 'none')) hide(table);
    });
}

/**
 * 將新提名或恢復的資料加入共享草稿。事件依提名物件定位，避免刪除中間一筆後沿用舊索引。
 */
function appendEditableNomination($table, data = null) {
    const nomination = {...data, id: data?.id || newId(), awarder: data?.awarder ?? mw.config.get('wgUserName') ?? '', pageName: data?.pageName || '', ruleStatus: data?.ruleStatus || {}};
    const index = state.nominations.push(nomination) - 1;
    renderEditableNomination($table, nomination, index);
}

function renderEditableNomination($table, nomination, index) {
    appendNominationRows($table, nomination, index, {
        checking: false,
        touch: () => touchNomination(state.nominations.indexOf(nomination)),
        openRules: refresh => openRules(state.nominations.indexOf(nomination), refresh),
        onRemove: state.workspace.mode === 'new' ? () => removeEditableNomination($table, nomination) : null,
        onStash: state.workspace.mode === 'new' ? () => stashEditableNomination($table, nomination) : null,
    });
    hideSourceRows(nomination.source);
}

/** 一筆暫存包含完整規則值及共用說明；寫入成功後才移走表單中的列。 */
function stashEditableNomination($table, nomination) {
    if (state.workspace.operation) return;
    const index = state.nominations.indexOf(nomination);
    if (index < 0) return;
    try {
        persistWorkspace();
        draftStore.transfer([{draft: state.workspace, nominationIds: [nomination.id]}], {id: newId(), mode: 'new', open: false, nominations: [], message: ''});
        state.nominations = state.workspace.nominations;
        if (!state.nominations.length) closeEmptyEditor();
        else { removeEditableRows($table, nomination, index); refreshDraftList(); state.progress?.(); }
    } catch (error) {
        $draftStatus?.text(t('暫存未完成：', '暂存未完成：') + error.message);
        dock.showPanel('details');
    }
}

/** 草稿已移走或刪除後解除回呼，防止延遲輸入事件再次自動保存。 */
function closeEmptyEditor() {
    state.changed = () => {};
    state.progress = () => {};
    state.nominations = [];
    state.workspace = null;
    clearTimeout(previewTimer);
    $editor.remove(); $editor = null;
    $draftStatus = null; messageInput = null;
    restoreSourceRows();
    dock.$actions.empty(); dock.panes.details.empty();
    dock.setActive(false);
    refreshDraftList();
    dock.toggles.drafts.$button.trigger('focus');
}

/** 移除新提名的兩列並重排編號，保留其餘輸入元件與內容，再將焦點移至相鄰提名。 */
function removeEditableNomination($table, nomination) {
    if (state.workspace.operation) return;
    const index = state.nominations.indexOf(nomination);
    if (index < 0) return;
    if (state.nominations.length === 1) {
        // 最後一筆代表整份新提名草稿。先完成版本檢查與刪除，再清理畫面，
        // 並解除自動保存回呼，避免移除輸入元件時的延遲 change 事件重建草稿。
        try { draftStore?.remove(state.workspace); }
        catch (error) {
            $draftStatus?.text(t('草稿未能刪除：', '草稿未能删除：') + error.message);
            dock.showPanel('details');
            return;
        }
        closeEmptyEditor();
        return;
    }
    state.nominations.splice(index, 1);
    removeEditableRows($table, nomination, index);
    state.changed();
}

function removeEditableRows($table, nomination, index) {
    $table.find('[data-acga-id]').filter((_, element) => element.getAttribute('data-acga-id') === nomination.id).remove();
    const $entries = $table.find('.acgnom-entry');
    $entries.each((rowIndex, entry) => {
        const $rows = $(entry).add($(entry).next('.acgnom-check-row'));
        $rows.removeClass(`item${$(entry).attr('data-acgnom-index')}`).addClass(`item${rowIndex + 1}`).attr('data-acgnom-index', rowIndex + 1);
    });
    $entries.eq(Math.min(index, state.nominations.length - 1)).find('.acgnom-title-cell input').trigger('focus');
}

/**
 * 在登記處建立原生提名表格，供新增多筆提名。
 * @param {object} [workspace] 要恢復的草稿；省略時建立新的草稿識別。
 */
export function showNewNominationDialog(workspace) {
    const $panel = mountEditor(t('新提名'));
    if (!$panel) return;
    workspace ||= {id: newId(), mode: 'new', nominations: [], message: ''};
    const nominations = workspace.nominations.length ? workspace.nominations : [null];
    workspace.nominations = [];
    activateWorkspace(workspace);
    const $dateHeading = $('<div>').addClass('mw-heading mw-heading3').append($('<h3>'));
    $panel.append($dateHeading);
    const refreshPlacement = () => {
        const now = new Date();
        const dates = getNominationSections(getArticleRoot()).map(section => section.heading.textContent.trim());
        const {date, newSection} = getNewNominationPlacement(dates, now);
        $dateHeading.toggle(newSection).find('h3').text(date);
        dock.$summary.text(newSection ? t(`新增「${date}」小節`, `新增「${date}」小节`) : t(`接在「${date}」小節末尾`, `接在「${date}」小节末尾`));
        // 草稿跨 UTC 午夜仍保持日期預覽正確；關閉或切換編輯器時取消計時。
        previewTimer = setTimeout(refreshPlacement, Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime() + 50);
    };
    refreshPlacement();
    const $table = createNominationTable();
    $panel.append($('<div>').addClass('acga-table-scroll').append($table));
    nominations.forEach(nomination => appendEditableNomination($table, nomination));
    messageInput = new OO.ui.MultilineTextInputWidget({autosize: true, rows: 1, value: workspace.message, placeholder: t('提名說明（選填，無須簽名）', '提名说明（选填，无须签名）')});
    messageInput.$input.attr('aria-label', t('提名說明', '提名说明'));
    messageInput.on('change', value => { workspace.message = value; state.changed(); });
    dock.panes.details.append($('<div>').addClass('acga-dock-options').append($('<label>').attr('for', messageInput.getInputId()).text(t('提名說明', '提名说明')), messageInput.$element));
    const add = new OO.ui.ButtonWidget({label: t('新增一筆', '新增一项')});
    add.on('click', () => {
        if (workspace.operation || state.nominations.length >= 25) return;
        appendEditableNomination($table); state.changed();
    });
    addEditorActions($panel, [add]);
    // 建好日期標題與表格後再捲動，避免空編輯區的頁尾位置把新內容留在視窗下方。
    $panel[0].scrollIntoView({block: 'start'});
}

/**
 * 在原表格位置編輯一筆提名，關閉時恢復原頁面列。
 * @param {object} nomData 提名內容與來源快照。
 * @param {object} [workspace] 要恢復的草稿，沿用其識別與儲存版本。
 */
export function showEditNominationDialog(nomData, workspace) {
    const $panel = mountEditor(t('編輯提名', '编辑提名'), nomData.source);
    if (!$panel) return;
    workspace ||= {id: newId(), mode: 'edit', nominations: [], message: ''};
    workspace.nominations = [];
    activateWorkspace(workspace);
    const $table = createNominationTable();
    $panel.append($('<div>').addClass('acga-table-scroll').append($table));
    appendEditableNomination($table, nomData);
    addEditorActions($panel);
}

/**
 * 將選中的提名組成原生表格；逐筆完成標記只寫入草稿，統一提交時才發布。
 * @param {object[]} nominations 含來源快照的待核對項目。
 * @param {object} [workspace] 恢復既有草稿及未完成的儲存步驟。
 */
export async function showCheckNominations(nominations, workspace) {
    const $panel = mountEditor(t('核對分數', '核对分数'), nominations[0]?.source);
    if (!$panel) return;
    activateWorkspace(workspace || {id: newId(), mode: 'check', nominations, message: ''});
    const $progress = dock.$summary;
    const $table = createNominationTable();
    $panel.append($('<div>').addClass('acga-table-scroll').append($table));
    const updateProgress = () => $progress.text(`${t('已核對', '已核对')} ${state.nominations.filter(n => n.reviewed).length} / ${state.nominations.length}`);
    state.nominations.forEach((nomination, index) => {
        const rows = appendNominationRows($table, nomination, index, {
            checking: true, touch: () => touchNomination(index), openRules: refresh => openRules(index, refresh),
            onReviewed: () => { updateProgress(); state.changed(); },
        });
        reviewWidgets.set(nomination.id, rows.reviewWidget);
        hideSourceRows(nomination.source);
    });
    updateProgress();
    addEditorActions($panel);
}

/**
 * 標示受影響的項目，並列原快照與最新內容，撤銷其核對完成標記。
 * 使用者選擇重新載入後才更新比對基準，先前提案仍保留供參考。
 */
function showConflicts($container, $panel) {
    $container.empty();
    const conflicts = state.workspace.conflicts || [];
    if (!conflicts.length) return;
    $container.append($('<h3>').text(t('內容已變更，請重新核對', '内容已变更，请重新核对')));
    for (const conflict of conflicts) {
        const $item = $panel.find('[data-acga-id]').filter((_, element) => element.getAttribute('data-acga-id') === conflict.id);
        $item.addClass('acga-needs-review').prop('open', true);
        // 完成標記真的改變時才觸發回呼，避免重繪與保存互相遞迴。
        const widget = reviewWidgets.get(conflict.id);
        if (widget?.isSelected()) { widget.setSelected(false); }
        const $table = $('<table>').append($('<caption>').text(conflict.pageName));
        const $head = $('<tr>');
        [t('變更欄位', '变更字段'), t('核對時的內容', '核对时的内容'), t('目前內容', '当前内容')].forEach(label => $head.append($('<th>').attr('scope', 'col').text(label)));
        $table.append($('<thead>').append($head));
        const $body = $('<tbody>');
        for (const field of conflict.fields) {
            const clean = value => (value || '').replace(/<!--[\s\S]*?-->/g, '');
            $body.append($('<tr>').append($('<th>').attr('scope', 'row').text(field),
                $('<td>').text(clean(conflict.before?.[field])),
                $('<td>').append($('<mark>').text(conflict.after ? clean(conflict.after[field]) : t('找不到唯一對應項目', '找不到唯一对应项目')))));
        }
        $container.append($table.append($body));
    }
    const reload = new OO.ui.ButtonWidget({label: t('載入最新內容並重新核對', '载入最新内容并重新核对')});
    const $error = $('<p>');
    reload.on('click', async () => {
        reload.setDisabled(true);
        try {
            await reloadForReview(state.workspace, wikiTransport);
            persistWorkspace();
            const workspace = state.workspace;
            $panel.hide();
            if (workspace.mode === 'check') await showCheckNominations(workspace.nominations, workspace);
            else showEditNominationDialog(workspace.nominations[0], workspace);
        } catch (error) { $error.text(error.message); reload.setDisabled(false); }
    });
    $container.append(reload.$element, $error);
}

/** 按日期歸檔的入口集中於懸浮條，不向正文標題附加操作連結。 */
export function setArchiveActions(archives = []) {
    dock.panes.archives.empty().addClass('acga-dock-archives');
    for (const {date, action} of archives) {
        const button = new OO.ui.ButtonWidget({label: `${date} · ${t('歸檔', '归档')}`});
        button.on('click', action);
        dock.panes.archives.append(button.$element);
    }
    dock.setActive(editorIsOpen());
}
