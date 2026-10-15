import {t} from './state.js';
import {NominationRules} from './rules.js';
let windowManager;

/** 規則視窗只編輯自己的副本，未按完成的內容永不進入 localStorage。 */
export function initRuleEditor(root) {
    initDynamicWidthTextInputWidget();
    initRuleCheckboxInputWidget();
    initRuleDialog();
    windowManager = new OO.ui.WindowManager();
    windowManager.$element.addClass('acga-dialogs mw-notalk');
    $(root).append(windowManager.$element);
    return windowManager;
}

export async function chooseRules(nomination, checking) {
    const dialog = new RulesDialog({size: 'large'});
    dialog.nomination = {ruleStatus: Object.fromEntries(Object.entries(nomination.ruleStatus).map(([key, rule]) => [key, {...rule}]))};
    dialog.check = checking;
    windowManager.addWindows([dialog]);
    const result = await windowManager.openWindow(dialog).closed;
    const rules = result?.action === 'done' ? dialog.nomination.ruleStatus : null;
    await windowManager.removeWindows(['ACGARules']);
    windowManager.$element.children('.acga-rule-measure').remove();
    return rules;
}

/**
 * 動態寬度文本輸入框。
 * @param config
 * @constructor
 */
function DynamicWidthTextInputWidget(config) {
    DynamicWidthTextInputWidget.parent.call(this, config);
    this.$measure = $('<span>').addClass('acga-rule-measure').css({
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
    this.$element.addClass('acga-rule-option');
    this.checkbox = new OO.ui.CheckboxInputWidget({selected: config.selected || false});
    this.checkbox.$input.attr('aria-label', config.ruleset.rule + ' ' + config.ruleset.desc);
    this.$element.append(this.checkbox.$element);
    this.ruleset = config.ruleset;
    this.nomination = config.nomination;
    this.check = config.check || false;
    if (!this.nomination.ruleStatus[this.ruleset.rule]) {
        this.nomination.ruleStatus[this.ruleset.rule] = {
            selected: this.isSelected(),
            desc: this.ruleset.desc,
            ogDesc: this.ruleset.desc,
            score: this.ruleset.score,
            maxScore: this.ruleset.score, applicable: !this.check,
        };
    } else {
        this.setSelected(this.nomination.ruleStatus[this.ruleset.rule].selected);
        if (!this.nomination.ruleStatus[this.ruleset.rule].desc) {
            this.nomination.ruleStatus[this.ruleset.rule].desc = this.ruleset.desc;
        }
        this.nomination.ruleStatus[this.ruleset.rule].ogDesc = this.ruleset.desc;
        if (!Object.prototype.hasOwnProperty.call(this.nomination.ruleStatus[this.ruleset.rule], 'score')) {
            this.nomination.ruleStatus[this.ruleset.rule].score = this.ruleset.score;
        }
        this.nomination.ruleStatus[this.ruleset.rule].maxScore = this.ruleset.score;
    }
    this.ruleInputWidget = new DynamicWidthTextInputWidget({
        value: this.nomination.ruleStatus[this.ruleset.rule].desc,
        disabled: this.check ? false : (!this.isSelected()),
    });
    this.ruleInputWidget.$input.attr('aria-label', this.ruleset.rule + ' ' + t('規則說明', '规则说明'));
    this.ruleInputWidget.$element.addClass('DynamicWidthTextInputWidget');
    this.ruleInputWidget.adjustWidth();
    this.leftBracketLabelWidget = new OO.ui.LabelWidget({label: '('});
    this.leftBracketLabelWidget.$element.css({
        'vertical-align': 'baseline', 'border-bottom': '2px solid #fff',
    });
    this.scoreInputWidget = new DynamicWidthTextInputWidget({
        value: this.nomination.ruleStatus[this.ruleset.rule].scoreInput ?? this.nomination.ruleStatus[this.ruleset.rule].score,
        disabled: this.check ? false : (!this.isSelected()),
    });
    this.scoreInputWidget.$input.attr('aria-label', this.ruleset.rule + ' ' + t('分數', '分数'));
    this.scoreInputWidget.$element.addClass('DynamicWidthTextInputWidget');
    this.scoreInputWidget.adjustWidth();
    this.rightBracketLabelWidget = new OO.ui.LabelWidget({label: t('分)')});
    this.rightBracketLabelWidget.$element.css({
        'vertical-align': 'baseline', 'border-bottom': '2px solid #fff',
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
        this.nomination.ruleStatus[this.ruleset.rule].selected = isChecked;
        if (isChecked) this.nomination.ruleStatus[this.ruleset.rule].applicable = true;
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
        this.nomination.ruleStatus[this.ruleset.rule].desc = newValue;
    };
    RuleCheckboxInputWidget.prototype.handleScoreInputChange = function (newValue) {
        this.nomination.ruleStatus[this.ruleset.rule].scoreInput = newValue;
        this.nomination.ruleStatus[this.ruleset.rule].score = newValue.trim() === '' ? null : Number(newValue);
    };
}

function RulesDialog(config) { RulesDialog.super.call(this, config); }
/**
 * 建立共用規則彈窗。前四類與已有選項的分類展開，其餘保留為摺疊區。
 * 選項只修改視窗內的副本；完成後才套用，取消或重新整理會捨棄未確認修改。
 */
function initRuleDialog() {
    OO.inheritClass(RulesDialog, OO.ui.ProcessDialog);
    RulesDialog.static.name = 'ACGARules';
    RulesDialog.static.title = t('選擇規則', '选择规则');
    RulesDialog.static.actions = [
        {action: 'cancel', label: t('取消'), flags: 'safe'},
        {action: 'done', label: t('完成'), flags: ['primary', 'progressive']},
    ];
    RulesDialog.prototype.initialize = function () {
        RulesDialog.super.prototype.initialize.call(this);
        this.panel = new OO.ui.PanelLayout({padded: true, expanded: false});
        this.panel.$element.addClass('acga-rules');
        const nomination = this.nomination;
        NominationRules().forEach((group, index) => {
            const rules = group.rules || group.tabs.flatMap(tab => tab.rules);
            const selected = rules.some(rule => nomination.ruleStatus[rule.rule]?.selected);
            const $details = $('<details>').prop('open', index < 4 || selected);
            $details.append($('<summary>').text(group.group));
            $details.append($('<p>').addClass('acga-rule-explanation').text(group.explanation));
            const addRules = items => {
                const widgets = items.map(rule => new RuleCheckboxInputWidget({ruleset: rule, value: rule.rule, nomination, check: this.check}));
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
    RulesDialog.prototype.getEscapeAction = function () { return 'cancel'; };
    RulesDialog.prototype.getActionProcess = function (action) { return new OO.ui.Process(() => { this.close({action}); }); };
}

