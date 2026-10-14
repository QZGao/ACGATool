import state from "./state.js";
import {getOrderedRuleStatus, NominationRules, NominationRuleSet} from "./rules.js";
import {saveModifiedNomination, saveNewNomination} from "./dom.js";
import {saveChecks} from "./submission.js";
import {getXToolsInfo} from "./api.js";

let windowManager = null;  // Window manager for OOUI dialogs
let $editor = null;
let messageInput = null;
const t = (hant, hans = hant) => state.convByVar({hant, hans});

export function initOOUI() {
    // Initialize OOUI custom widgets
    initDynamicWidthTextInputWidget();
    initRuleCheckboxInputWidget();
    // Initialize dialogs
    initRuleDialog();
    initEditorStyles();
    // Initialize window manager
    initWindowManager();
}

function initWindowManager() {
    windowManager = new OO.ui.WindowManager();

    // Append the window manager element to the body
    $(document.body).append(windowManager.$element);
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
    }).appendTo(document.body);  // Create a hidden element for measuring text width.
    this.$input.on('input', this.adjustWidth.bind(this));  // Bind the adjustWidth function to the 'input' event.
}

/**
 * 初始化動態寬度文本輸入框。在腳本啟動時執行一次。
 */
function initDynamicWidthTextInputWidget() {
    OO.inheritClass(DynamicWidthTextInputWidget, OO.ui.TextInputWidget);
    mw.util.addCSS('.DynamicWidthTextInputWidget { display: inline-block; vertical-align: baseline; width: auto; margin: 0; } .DynamicWidthTextInputWidget input { height: 20px !important; border: none !important; border-bottom: 2px solid #ccc !important; padding: 0 !important; text-align: center; } .DynamicWidthTextInputWidget input:focus { outline: none !important; box-shadow: none !important; border-bottom: 2px solid #36c !important; } .DynamicWidthTextInputWidget input:disabled { background-color: transparent !important; color: #101418 !important; -webkit-text-fill-color: #101418 !important; text-shadow: none !important; border-bottom: 2px solid #fff !important; }');
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
            maxScore: this.ruleset.score,
        };
    } else {
        this.setSelected(state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].selected);
        if (!state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].desc) {
            state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].desc = this.ruleset.desc;
        }
        state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].ogDesc = this.ruleset.desc;
        if (state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].score == null) {
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
        value: state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].score,
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
    };
    RuleCheckboxInputWidget.prototype.handleScoreInputChange = function (newValue) {
        state.nominations[this.nomidx].ruleStatus[this.ruleset.rule].score = parseFloat(newValue);
    };
}

/**
 * 生成提名表單。
 * @param {object} nomData 提名資料（非必須）。無資料時為新提名。
 * @returns {OO.ui.FieldsetLayout} 提名表單。
 */
function generateNominationFieldset(nomData = null) {
    let awarder, pageName, ruleStatus;
    if (nomData) {
        awarder = nomData.awarder;
        pageName = nomData.pageName;
        ruleStatus = nomData.ruleStatus;
    } else {
        awarder = mw.config.get('wgUserName');
        pageName = '';
        ruleStatus = {};
    }

    const currentNomidx = state.nominations.length;
    state.nominations.push({
        awarder: awarder, pageName: pageName, ruleStatus: ruleStatus,
    });

    // 得分者
    let userNameInput = new OO.ui.TextInputWidget({value: state.nominations[currentNomidx].awarder});
    userNameInput.on('change', function (newValue) {
        state.nominations[currentNomidx].awarder = newValue;
    });
    let userNameField = new OO.ui.FieldLayout(userNameInput, {
        label: state.convByVar({
            hant: '得分者', hans: '得分者',
        }), align: 'left',
    });

    // 條目名稱
    let pageNameInput = new OO.ui.TextInputWidget({value: state.nominations[currentNomidx].pageName});
    pageNameInput.on('change', function (newValue) {
        state.nominations[currentNomidx].pageName = newValue;
    });
    let pageNameField = new OO.ui.FieldLayout(pageNameInput, {
        label: state.convByVar({
            hant: '得分條目', hans: '得分条目',
        }), align: 'left', help: state.convByVar({
            hant: '可填「他薦」', hans: '可填「他荐」',
        }), helpInline: true,
    });

    const reasonFieldsetLayout = new OO.ui.FieldsetLayout();
    const summary = new OO.ui.LabelWidget();
    const updateSummary = () => summary.setLabel(ruleSummary(state.nominations[currentNomidx].ruleStatus));
    const choose = new OO.ui.ButtonWidget({label: t('選擇規則', '选择规则')});
    choose.on('click', () => openRules(currentNomidx, updateSummary));
    updateSummary();
    reasonFieldsetLayout.addItems([summary, choose]);

    let nominationFieldset = new OO.ui.FieldsetLayout({
        items: [
            userNameField, pageNameField, reasonFieldsetLayout,
        ],
    });
    nominationFieldset.$element.css({'margin-top': 0});

    if (!nomData) {
        let hr = $('<hr>').css({
            'margin-top': '15px', 'margin-bottom': '15px',
        });  // 頂部的 <hr>
        nominationFieldset.$element.prepend(hr);
    }

    return nominationFieldset;
}


/**
 * 生成提名檢查單。
 * @param nomData 提名資料。
 * @returns {OO.ui.FieldsetLayout} 提名檢查單。
 */
async function generateChecklistFieldset(nomData, nomidx) {
    let awarder = nomData.awarder;
    let pageName = nomData.pageName;
    let ruleStatus = nomData.ruleStatus;


    // 得分者
    let userNameLinkLabelWidget = new OO.ui.LabelWidget({label: $('<a>').attr('href', mw.util.getUrl('User:' + awarder)).text(awarder)});
    let userTalkLinkLabelWidget = new OO.ui.LabelWidget({
        label: $('<a>').attr('href', mw.util.getUrl('User talk:' + awarder)).text(state.convByVar({
            hant: '討論', hans: '讨论',
        })),
    });
    let userContribsLinkLabelWidget = new OO.ui.LabelWidget({
        label: $('<a>').attr('href', mw.util.getUrl('Special:用户贡献/' + awarder)).text(state.convByVar({
            hant: '貢獻', hans: '贡献',
        })),
    });
    let userNameHorizontalLayout = new OO.ui.HorizontalLayout({
        items: [
            userNameLinkLabelWidget,
            new OO.ui.LabelWidget({label: '（'}),
            userTalkLinkLabelWidget,
            new OO.ui.LabelWidget({label: '·'}),
            userContribsLinkLabelWidget,
            new OO.ui.LabelWidget({label: '）'}),
        ],
    });
    userNameHorizontalLayout.$element.css({
        'gap': '4px', 'width': '80%', 'flex-shrink': '0', 'flex-wrap': 'wrap',
    });
    let userNameLabelWidget = new OO.ui.LabelWidget({
        label: state.convByVar({
            hant: '得分者', hans: '得分者',
        }),
    });
    userNameLabelWidget.$element.css({
        'flex-grow': 1, 'align-self': 'stretch',
    });
    let userNameField = new OO.ui.HorizontalLayout({
        items: [
            userNameLabelWidget, userNameHorizontalLayout,
        ],
    });

    // 條目名稱
    let pageNameHorizontalLayout, pageNameLabelWidget;
    if (pageName === '他薦' || pageName === '他荐') {
        pageNameLabelWidget = new OO.ui.LabelWidget({
            label: state.convByVar({
                hant: '他薦', hans: '他荐',
            }),
        });
        pageNameHorizontalLayout = new OO.ui.HorizontalLayout({items: [pageNameLabelWidget]});
    } else {
        pageNameLabelWidget = new OO.ui.LabelWidget({label: $('<a>').attr('href', mw.util.getUrl(pageName)).text(pageName)});
        let pageTalkLabelWidget = new OO.ui.LabelWidget({
            label: $('<a>').attr('href', mw.util.getUrl('Talk:' + pageName)).text(state.convByVar({
                hant: '討論', hans: '讨论',
            })),
        });
        let pageHistoryLabelWidget = new OO.ui.LabelWidget({
            label: $('<a>').attr('href', mw.util.getUrl(pageName, {action: 'history'})).text(state.convByVar({
                hant: '歷史', hans: '历史',
            })),
        });
        let pagesLinkedToPageLabelWidget = new OO.ui.LabelWidget({
            label: $('<a>').attr('href', mw.util.getUrl('Special:链入页面/' + pageName)).text(state.convByVar({
                hant: '連入', hans: '链入',
            })),
        });
        // 更多頁面資訊 from XTools
        let xtoolsPageInfoLabelWidget = new OO.ui.LabelWidget();
        getXToolsInfo(pageName).then(html => xtoolsPageInfoLabelWidget.setLabel($('<div>').html(html)));
        xtoolsPageInfoLabelWidget.$element.css({'font-size': '0.9em'});
        pageNameHorizontalLayout = new OO.ui.HorizontalLayout({
            items: [
                pageNameLabelWidget,
                new OO.ui.LabelWidget({label: '（'}),
                pageTalkLabelWidget,
                new OO.ui.LabelWidget({label: '·'}),
                pageHistoryLabelWidget,
                new OO.ui.LabelWidget({label: '·'}),
                pagesLinkedToPageLabelWidget,
                new OO.ui.LabelWidget({label: '）'}),
                xtoolsPageInfoLabelWidget,
            ],
        });
    }
    pageNameHorizontalLayout.$element.css({
        'gap': '4px', 'width': '80%', 'flex-shrink': '0', 'flex-wrap': 'wrap',
    });
    let pageLabelLabelWidget = new OO.ui.LabelWidget({
        label: state.convByVar({
            hant: '得分條目', hans: '得分条目',
        }),
    });
    pageLabelLabelWidget.$element.css({
        'flex-grow': 1, 'align-self': 'stretch',
    });
    let pageNameField = new OO.ui.HorizontalLayout({
        items: [
            pageLabelLabelWidget, pageNameHorizontalLayout,
        ],
    });
    pageNameField.$element.css({'margin-top': '15px'});

    // 提名無效
    let invalidToggleSwitchWidget = new OO.ui.ToggleSwitchWidget({value: false});
    invalidToggleSwitchWidget.on('change', function (isChecked) {
        state.nominations[nomidx].invalid = isChecked;
    });
    let invalidField = new OO.ui.FieldLayout(invalidToggleSwitchWidget, {
        label: state.convByVar({
            hant: '提名無效', hans: '提名无效',
        }), align: 'left',
    });
    invalidField.$element.css({'margin-top': '15px'});
    invalidField.$element.addClass('checklist-field');

    // 提名理由
    let reasonField = new OO.ui.HorizontalLayout();
    reasonField.$element.css({'margin-top': '15px'});
    let reasonLabelWidget = new OO.ui.LabelWidget({
        label: state.convByVar({
            hant: '提名理由', hans: '提名理由',
        }),
    });
    reasonLabelWidget.$element.css({
        'flex-grow': 1, 'align-self': 'stretch',
    });

    let ruleItems = [];
    let {
        ruleNames, ruleDict,
    } = NominationRuleSet();
    let orderedRuleStatus = getOrderedRuleStatus(ruleNames, ruleStatus);
    for (const ruleItem of orderedRuleStatus) {
        let ruleSet = ruleDict[ruleItem.rule];
        let ruleCheckbox = new RuleCheckboxInputWidget({
            value: ruleItem.rule, ruleset: ruleSet, nomidx, check: true,
        });
        ruleItems.push(ruleCheckbox);
    }
    let horizontalLayout = new OO.ui.HorizontalLayout({items: ruleItems});
    horizontalLayout.$element.css({
        'width': '80%', 'flex-shrink': '0', 'flex-wrap': 'wrap',
    });
    reasonField.addItems([
        reasonLabelWidget, horizontalLayout,
    ]);

    // 附加說明
    let messageInput = new OO.ui.MultilineTextInputWidget({
        autosize: true, rows: 1,
    });
    messageInput.on('change', function (newValue) {
        state.nominations[nomidx].message = newValue;
    });
    let messageField = new OO.ui.FieldLayout(messageInput, {
        label: state.convByVar({
            hant: '附加說明', hans: '附加说明',
        }), align: 'left', help: state.convByVar({
            hant: '可不填；無須簽名', hans: '可不填；无须签名',
        }), helpInline: true,
    });
    messageField.$element.css({'margin-top': '15px'});
    messageField.$element.addClass('checklist-field');

    let nominationFieldset = new OO.ui.FieldsetLayout({
        items: [
            userNameField, pageNameField, invalidField, reasonField, messageField,
        ],
    });
    nominationFieldset.$element.css({'margin-top': 0});
    return nominationFieldset;
}

function initEditorStyles() {
    mw.util.addCSS(`
        .acga-editor { margin: 1.5em 0; padding: 1em; border: 1px solid var(--border-color-base, #a2a9b1); color: var(--color-base, inherit); background: var(--background-color-base, transparent); }
        .acga-editor h2 { margin-top: 0; }
        .acga-editor .oo-ui-fieldsetLayout { margin-bottom: 1em; }
        .acga-actions { display: flex; flex-wrap: wrap; gap: .5em; margin-top: 1em; }
        .acga-rules details { margin: .75em 0; }
        .acga-rules summary { cursor: pointer; font-weight: bold; }
        .acga-rules .oo-ui-horizontalLayout { display: flex; flex-wrap: wrap; gap: .5em; }
        @media (max-width: 600px) { .acga-editor { padding: .75em; } .acga-editor .oo-ui-fieldLayout-align-left { display: block; } }
    `);
}

function ruleSummary(ruleStatus) {
    const {ruleDict} = NominationRuleSet();
    return Object.entries(ruleStatus).filter(([, value]) => value.selected)
        .map(([key, value]) => `${value.desc || ruleDict[key].desc} (${value.score ?? ruleDict[key].score})`).join('、') || t('尚未選擇規則', '尚未选择规则');
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
                const widgets = items.map(rule => new RuleCheckboxInputWidget({ruleset: rule, value: rule.rule, nomidx: this.nomidx}));
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
    RulesDialog.prototype.getActionProcess = function () { return new OO.ui.Process(() => this.close()); };
}

/**
 * 開啟某筆提名的規則選擇器，關閉後更新其畫面並釋放視窗。
 * @param {number} nomidx 目前 nominations 陣列中的位置。
 * @param {Function} onClose 更新主編輯器規則摘要的回呼。
 */
async function openRules(nomidx, onClose) {
    const dialog = new RulesDialog({size: 'large'});
    dialog.nomidx = nomidx;
    windowManager.addWindows([dialog]);
    await windowManager.openWindow(dialog).closed;
    onClose();
    windowManager.removeWindows([dialog]);
}

/**
 * 在頁面內建立編輯區。
 * 已有開啟的編輯器時只移回該處，避免後續初始化覆寫其共享狀態。
 * @returns {jQuery|null} 新編輯區；已有編輯器時為 null。
 */
function mountEditor(title) {
    if ($editor?.is(':visible')) {
        $editor[0].scrollIntoView({block: 'start'});
        mw.notify(t('請先完成或關閉目前的編輯器。', '请先完成或关闭当前编辑器。'));
        return null;
    }
    $editor?.remove();
    $editor = $('<section>').addClass('acga-editor').attr({'aria-label': title, tabindex: '-1'});
    $editor.append($('<h2>').text(title));
    $('#mw-content-text').prepend($editor);
    $editor[0].scrollIntoView({block: 'start'});
    $editor.trigger('focus');
    return $editor;
}

/**
 * 管理提交、關閉與附加操作，並在請求期間鎖定操作按鈕。
 */
function addEditorActions($panel, save, extras = []) {
    const $status = $('<p>').attr('role', 'status');
    const saveButton = new OO.ui.ButtonWidget({label: t('儲存', '储存'), flags: ['primary', 'progressive']});
    const closeButton = new OO.ui.ButtonWidget({label: t('關閉', '关闭')});
    const buttons = [saveButton, ...extras, closeButton];
    closeButton.on('click', () => $panel.hide());
    saveButton.on('click', async () => {
        buttons.forEach(button => button.setDisabled(true));
        $status.text(t('正在儲存…', '正在储存…'));
        try {
            if (!await save()) $panel.hide();
            else $status.text(t('尚未儲存，請檢查填寫內容。', '尚未储存，请检查填写内容。'));
        } catch (error) {
            $status.text(t('儲存未完成：', '储存未完成：') + (error.message || String(error)));
        } finally {
            buttons.forEach(button => button.setDisabled(false));
        }
    });
    $panel.append($('<div>').addClass('acga-actions').append(buttons.map(button => button.$element)), $status);
}

/**
 * 在頁面內開啟可新增多筆提名的編輯器。
 */
export function showNewNominationDialog() {
    const $panel = mountEditor(t('新提名'));
    if (!$panel) return;
    state.nominations = [];
    const content = new OO.ui.FieldsetLayout();
    content.addItems([generateNominationFieldset()]);
    messageInput = new OO.ui.MultilineTextInputWidget({autosize: true});
    $panel.append(content.$element, new OO.ui.FieldLayout(messageInput, {label: t('附加說明', '附加说明'), align: 'top'}).$element);
    const add = new OO.ui.ButtonWidget({label: t('新增一筆', '新增一项')});
    add.on('click', () => content.addItems([generateNominationFieldset()]));
    const remove = new OO.ui.ButtonWidget({label: t('移除末筆', '移除末项')});
    remove.on('click', () => {
        if (state.nominations.length <= 1) return;
        content.removeItems([content.items[content.items.length - 1]]);
        state.nominations.pop();
    });
    addEditorActions($panel, saveNewNomination, [add, remove]);
}

export function getNewNominationDialogAdditionalMessage() {
    return messageInput?.getValue().trim() || '';
}

/**
 * 在頁面內開啟單筆提名編輯器。
 * @param {object} nomData 從頁面解析的提名內容。
 */
export function showEditNominationDialog(nomData, queried) {
    const $panel = mountEditor(t('編輯提名', '编辑提名'));
    if (!$panel) return;
    state.queried = queried;
    state.nominations = [];
    $panel.append(generateNominationFieldset(nomData).$element);
    addEditorActions($panel, saveModifiedNomination);
}

/**
 * 建立批次核對介面；完成標記只寫入草稿，直到使用者統一提交才發布。
 * @param {object[]} nominations 含來源快照的待核對項目。
 */
export async function showCheckNominations(nominations) {
    const $panel = mountEditor(t('核對分數', '核对分数'));
    if (!$panel) return;
    state.nominations = nominations.map(nomination => ({...nomination, invalid: false, message: '', reviewed: false}));
    const $progress = $('<p>').attr('role', 'status');
    const $list = $('<div>');
    $panel.append($progress, $list);
    const updateProgress = () => $progress.text(`${t('已核對', '已核对')} ${state.nominations.filter(n => n.reviewed).length} / ${state.nominations.length}`);
    for (const [index, nomination] of state.nominations.entries()) {
        const $item = $('<details>').prop('open', index === 0);
        const $summary = $('<summary>').text(`${index + 1}. ${nomination.pageName} · ${nomination.awarder}`);
        $item.append($summary);
        $list.append($item);
        const field = await generateChecklistFieldset(nomination, index);
        $item.append(field.$element);
        const done = new OO.ui.CheckboxInputWidget();
        done.on('change', value => {
            nomination.reviewed = value;
            updateProgress();
        });
        // Any edits invalidate the prior acknowledgement for this item.
        field.$element.on('input change', () => done.setSelected(false));
        $item.append(new OO.ui.FieldLayout(done, {label: t('已核對此筆，加入待提交清單', '已核对此项，加入待提交清单'), align: 'inline'}).$element);
    }
    updateProgress();
    addEditorActions($panel, () => saveChecks(state.nominations));
}
