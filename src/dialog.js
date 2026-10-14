import state from "./state.js";
import {getOrderedRuleStatus, NominationRules, NominationRuleSet} from "./rules.js";
import {submitWorkspace} from "./submission.js";
import {newId} from "./scoring.js";
import {reloadForReview} from "./conflicts.js";
import {wikiTransport} from "./transport.js";
import {createDraftStore, clearSubmittedDraft} from "./drafts.js";
import {getXToolsInfo} from "./api.js";

let windowManager = null;  // Window manager for OOUI dialogs
let $editor = null;
let messageInput = null;
let draftStore = null;
let $draftList = null;
let $draftStatus = null;
let reviewWidgets = new Map();
const t = (hant, hans = hant) => state.convByVar({hant, hans});
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
    initEditorStyles();
    // Initialize window manager
    initWindowManager();
    initDrafts();
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
            maxScore: this.ruleset.score,
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
        ...nomData, id: nomData?.id || newId(), awarder, pageName, ruleStatus,
    });

    // 得分者
    let userNameInput = new OO.ui.TextInputWidget({value: state.nominations[currentNomidx].awarder});
    userNameInput.on('change', function (newValue) {
        state.nominations[currentNomidx].awarder = newValue;
        touchNomination(currentNomidx);
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
        touchNomination(currentNomidx);
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


    const userNameInput = new OO.ui.TextInputWidget({value: awarder});
    userNameInput.on('change', value => { nomData.awarder = value; touchNomination(nomidx); });
    const userNameField = new OO.ui.FieldLayout(userNameInput, {label: t('得分者'), align: 'top'});
    const originalInfo = new OO.ui.LabelWidget({label: nomData.original
        ? `${t('原核定', '原核定')}：${awarder}，${nomData.original.score} ${t('分')} ${nomData.original.status === 'rechecking' ? t('（覆核中）', '（复核中）') : ''}`
        : t('首次核對', '首次核对')});
    const booking = new OO.ui.DropdownInputWidget({value: nomData.booking, options: nomData.baseline
        ? [{data: 'recorded', label: `${t('已確認入帳', '已确认入账')}：${nomData.baseline.awarder} ${nomData.baseline.score} ${t('分')}`}]
        : [{data: 'unknown', label: t('請確認原核分是否已入帳', '请确认原核分是否已入账')},
            {data: 'booked', label: t('原核分已登記到積分榜', '原核分已登记到积分榜')},
            {data: 'unbooked', label: t('原核分尚未登記到積分榜', '原核分尚未登记到积分榜')}]});
    booking.setDisabled(!!nomData.baseline || !nomData.original?.score);
    booking.on('change', value => { nomData.booking = value; touchNomination(nomidx); });
    const bookingField = new OO.ui.FieldLayout(booking, {label: t('原分數入帳狀態', '原分数入账状态'), align: 'top'});

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
    let invalidToggleSwitchWidget = new OO.ui.ToggleSwitchWidget({value: nomData.invalid});
    invalidToggleSwitchWidget.on('change', function (isChecked) {
        state.nominations[nomidx].invalid = isChecked;
        touchNomination(nomidx);
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
        autosize: true, rows: 1, value: nomData.message || '',
    });
    messageInput.on('change', function (newValue) {
        state.nominations[nomidx].message = newValue;
        touchNomination(nomidx);
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
            userNameField, originalInfo, bookingField, pageNameField, invalidField, reasonField, messageField,
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
        .acga-conflicts { overflow-x: auto; }
        .acga-conflicts:empty { display: none; }
        .acga-conflicts table { width: 100%; border-collapse: collapse; }
        .acga-conflicts th, .acga-conflicts td { text-align: left; vertical-align: baseline; padding: .5em; border: 1px solid var(--border-color-base, #a2a9b1); overflow-wrap: anywhere; white-space: pre-wrap; }
        .acga-conflicts mark { background: var(--background-color-warning-subtle, #fef6e7); color: var(--color-base, #202122); }
        .acga-needs-review > summary { font-weight: bold; color: var(--color-error, #b32424); }
        .acga-save-progress li { margin-block: .75em; }
        .acga-save-progress p { margin-block: .25em; }
        .acga-fields > div > details { padding-block: .75em; border-bottom: 1px solid var(--border-color-base, #a2a9b1); }
        .acga-editor .oo-ui-horizontalLayout { min-width: 0; }
        .acga-actions { display: flex; flex-wrap: wrap; gap: .5em; margin-top: 1em; }
        .acga-rules details { margin: .75em 0; }
        .acga-rules summary { cursor: pointer; font-weight: bold; }
        .acga-rules .oo-ui-horizontalLayout { display: flex; flex-wrap: wrap; gap: .5em; }
        @media (max-width: 600px) { .acga-editor { padding: .75em; } .acga-editor .oo-ui-fieldLayout-align-left { display: block; } .acga-editor .oo-ui-fieldsetLayout-group > .oo-ui-horizontalLayout { display: flex; flex-wrap: wrap; } .acga-editor .oo-ui-horizontalLayout { max-width: 100%; } }
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
    windowManager.addWindows([dialog]);
    await windowManager.openWindow(dialog).closed;
    onClose();
    await windowManager.removeWindows(['ACGARules']);
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
 * 將每個頁面的儲存狀態接到進度介面；已完成項目不再提供重送操作。
 * 回應未明的項目只查證原請求。使用者關閉或重新載入後，仍可由草稿恢復。
 */
function addEditorActions($panel, extras = []) {
    $panel.children().not('h2').wrapAll('<div class="acga-fields"></div>');
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
        const controls = $panel.find(':input').toArray().map(element => [element, element.disabled]);
        $panel.find(':input').prop('disabled', true);
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
            if (completed) $panel.find(':input').not(closeButton.$element.find(':input')).prop('disabled', true);
            else lockPendingForm($panel);
            showProgress();
        }
    };
    state.progress = showProgress;
    forkButton.on('click', () => {
        state.workspace.id = newId(); state.workspace.storageVersion = 0; state.changed();
    });
    closeButton.on('click', () => { if (!completed) state.changed(); $panel.hide(); });
    saveButton.on('click', runSave);
    $panel.append($conflicts, $('<div>').addClass('acga-actions').append(buttons.map(button => button.$element)), $draftStatus, $progress, $status);
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
    $panel.find('.acga-fields').prop('inert', locked);
    if (locked) $panel.find('.acga-fields').attr('inert', '');
    else $panel.find('.acga-fields').removeAttr('inert');
}

/**
 * 綁定目前草稿與畫面使用的共享陣列。
 * state.nominations 與 workspace.nominations 指向同一陣列，不另保留一份可分歧的表單資料。
 */
function activateWorkspace(workspace) {
    state.progress = () => {};
    reviewWidgets = new Map();
    state.workspace = workspace;
    state.nominations = workspace.nominations;
    state.changed = () => {
        try { persistWorkspace(); }
        catch (error) { $draftStatus?.text(t('草稿尚未保存：', '草稿尚未保存：') + error.message); }
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
    $draftList = $('<div>').addClass('acga-drafts');
    $('#mw-content-text').prepend($draftList);
    try {
        const prefix = `ACGATool:v1:${mw.config.get('wgDBname')}:${mw.config.get('wgUserName') || 'anonymous'}`;
        draftStore = createDraftStore(window.localStorage, prefix);
        refreshDraftList();
    } catch (error) {
        $draftList.text(t('無法讀取本機草稿：', '无法读取本机草稿：') + error.message);
    }
}

function refreshDraftList() {
    const drafts = draftStore.list();
    $draftList.empty();
    if (!drafts.length) return;
    $draftList.append($('<strong>').text(t('未完成的草稿：', '未完成的草稿：')));
    for (const draft of drafts) {
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

/**
 * 在頁面內開啟可新增多筆提名的編輯器。
 * @param {object} [workspace] 要恢復的草稿；省略時建立新的草稿識別。
 */
export function showNewNominationDialog(workspace) {
    const $panel = mountEditor(t('新提名'));
    if (!$panel) return;
    workspace ||= {id: newId(), mode: 'new', nominations: [], message: ''};
    const nominations = workspace.nominations.length ? workspace.nominations : [null];
    workspace.nominations = [];
    activateWorkspace(workspace);
    const content = new OO.ui.FieldsetLayout();
    nominations.forEach(nomination => content.addItems([generateNominationFieldset(nomination)]));
    messageInput = new OO.ui.MultilineTextInputWidget({autosize: true, value: workspace.message});
    messageInput.on('change', value => { workspace.message = value; });
    $panel.append(content.$element, new OO.ui.FieldLayout(messageInput, {label: t('附加說明', '附加说明'), align: 'top'}).$element);
    const add = new OO.ui.ButtonWidget({label: t('新增一筆', '新增一项')});
    add.on('click', () => {
        if (workspace.operation || state.nominations.length >= 25) return;
        content.addItems([generateNominationFieldset()]); state.changed();
    });
    const remove = new OO.ui.ButtonWidget({label: t('移除末筆', '移除末项')});
    remove.on('click', () => {
        if (workspace.operation || state.nominations.length <= 1) return;
        content.removeItems([content.items[content.items.length - 1]]);
        state.nominations.pop(); state.changed();
    });
    addEditorActions($panel, [add, remove]);
}

/**
 * 在頁面內開啟單筆提名編輯器。
 * @param {object} nomData 提名內容與來源快照。
 * @param {object} [workspace] 要恢復的草稿，沿用其識別與儲存版本。
 */
export function showEditNominationDialog(nomData, workspace) {
    const $panel = mountEditor(t('編輯提名', '编辑提名'));
    if (!$panel) return;
    workspace ||= {id: newId(), mode: 'edit', nominations: [], message: ''};
    workspace.nominations = [];
    activateWorkspace(workspace);
    $panel.append(generateNominationFieldset(nomData).$element);
    addEditorActions($panel);
}

/**
 * 建立批次核對介面；完成標記只寫入草稿，直到使用者統一提交才發布。
 * @param {object[]} nominations 含來源快照的待核對項目。
 * @param {object} [workspace] 恢復既有草稿及未完成的儲存步驟。
 */
export async function showCheckNominations(nominations, workspace) {
    const $panel = mountEditor(t('核對分數', '核对分数'));
    if (!$panel) return;
    activateWorkspace(workspace || {id: newId(), mode: 'check', nominations, message: ''});
    const $progress = $('<p>').attr('role', 'status');
    const $list = $('<div>');
    $panel.append($progress, $list);
    const updateProgress = () => $progress.text(`${t('已核對', '已核对')} ${state.nominations.filter(n => n.reviewed).length} / ${state.nominations.length}`);
    for (const [index, nomination] of state.nominations.entries()) {
        const $item = $('<details>').attr('data-acga-id', nomination.id).prop('open', index === 0);
        const $summary = $('<summary>').text(`${index + 1}. ${nomination.pageName} · ${nomination.awarder}`);
        $item.append($summary);
        $list.append($item);
        const field = await generateChecklistFieldset(nomination, index);
        $item.append(field.$element);
        if (nomination.previousProposal) {
            const $previous = $('<details>').append($('<summary>').text(t('先前草稿的核對內容', '先前草稿的核对内容')));
            $previous.append($('<p>').text(nomination.previousProposal.awarder + '：' + ruleSummary(nomination.previousProposal.ruleStatus)), $('<p>').text(nomination.previousProposal.message || ''));
            $item.append($previous);
        }
        const done = new OO.ui.CheckboxInputWidget({selected: nomination.reviewed});
        reviewWidgets.set(nomination.id, done);
        done.on('change', value => {
            nomination.reviewed = value;
            updateProgress();
            state.changed();
        });
        // Any edits invalidate the prior acknowledgement for this item.
        field.$element.on('input change', () => done.setSelected(false));
        $item.append(new OO.ui.FieldLayout(done, {label: t('已核對此筆，加入待提交清單', '已核对此项，加入待提交清单'), align: 'inline'}).$element);
    }
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
