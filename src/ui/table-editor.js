/**
 * 沿用 Template:ACG提名2 的表格、列與儲存格 class，讓編輯狀態繼承登記處樣式。
 * 本模組只建立畫面並更新傳入的提名；發布與草稿保存由呼叫端的回呼處理。
 */
import {t} from '../i18n.js';
import {NominationRuleSet, normalizeRuleStatus, ruleValues} from '../nomination/rules.js';
import {parseUserReason} from '../wiki/api.js';
import {cdxIconTrash, cdxIconLogIn} from './icons.js';
import {iconButton} from './icon-button.js';
import {previousBooking, scoreDeltas} from '../nomination/scoring.js';
import {bindTextInput} from './text-input.js';
import {bindTitleStatus} from '../page/title-status.js';


/**
 * 取得原頁面的一對提名列，排除編輯器自己建立的列。
 * 日期與 index 只用來對接這次渲染的 DOM；儲存時仍須重新定位及驗證 wikitext。
 * @returns {jQuery} 原提名與核對列；新提名或找不到來源時為空集合。
 */
export function sourceRows(source) {
    if (!source) return $();
    const $rows = $('[data-acga-date][data-acga-source-index]').filter((_, element) =>
        !$(element).closest('.acga-editor').length && $(element).attr('data-acga-date') === source.date);
    if ($rows.is('[data-acga-source-values]')) {
        // 正文刷新後其他提名可能插入或移除。完整快照唯一對應時才隱藏原列。
        const $matched = $rows.filter((_, element) => $(element).attr('data-acga-source-values') === JSON.stringify(source.values));
        return $matched.length === 2 ? $matched : $();
    }
    return $rows.filter((_, element) => Number($(element).attr('data-acga-source-index')) === source.index);
}

/**
 * 建立與原生模板一致的三欄表頭；每筆資料由 appendNominationRows 補上兩行。
 */
export function createNominationTable() {
    const $table = $('<table>').addClass('wikitable plain-row-headers skin-invert acgnom-table acga-edit-table');
    const $head = $('<tr>').addClass('acgnom-header');
    [[t('條目', '条目'), 'title'], [t('獲提名者', '获提名者'), 'user'], [t('提名內容', '提名内容'), 'reason']].forEach(([label, name]) => {
        $head.append($('<th>').addClass(`acgnom-${name}-heading`).attr('scope', 'col').text(label));
    });
    return $table.append($('<tbody>').append($head));
}

function link(title, label) { return $('<a>').attr('href', mw.util.getUrl(title)).text(label); }
function action(label, handler) {
    return $('<button>').attr('type', 'button').addClass('acga-inline-action').text(label).on('click', async () => {
        try { await handler(); }
        catch (error) { mw.notify(error.message || String(error), {type: 'error'}); }
    });
}

/**
 * 按規則順序產生模板相容的分數片段，selected=false 時呈現本次否決的規則。
 * 只展示尚未使用的規則選項不算否決；無效分數顯示問號，提交驗證仍由計分模組負責。
 */
export function ruleFragments(ruleStatus, selected = true) {
    ruleStatus = normalizeRuleStatus(ruleStatus);
    const {ruleNames, ruleDict} = NominationRuleSet();
    const $result = $('<span>');
    let count = 0, total = 0;
    for (const key of ruleNames) {
        const rule = ruleStatus[key];
        if (!rule || !!rule.selected !== selected || rule.applicable === false && !rule.selected) continue;
        if (count++) $result.append('、');
        const {score, desc: description} = ruleValues(rule, ruleDict[key]);
        const shownScore = Number.isFinite(score) ? score : '?';
        let desc = description;
        if (score !== ruleDict[key].score) desc += ` (${t('得')} ${shownScore} ${t('分')})`;
        $result.append($('<span>').addClass('acgnom-rule').append(
            $('<span>').addClass('acgnom-rule-code').text(key.slice(0, 1)),
            $('<small>').addClass('acgnom-rule-description').attr('title', `${shownScore}${t('分')}`).text(desc)));
        total += Number.isFinite(score) ? score : NaN;
    }
    return {$element: $result, count, total};
}

function titleContents(nomination) {
    const $existing = sourceRows(nomination.source).find('.acgnom-title-cell').first();
    if ($existing.length) {
        const $copy = $existing.clone();
        $copy.find('.acga-control').remove();
        // 保留文字節點，因為「他薦」等特殊項目的標題格不一定有子元素或連結。
        return $copy.contents();
    }
    return $('<b>').append($('<span>').addClass('acgnom-title').append(link(nomination.pageName, nomination.pageName)));
}

function userContents(nomination) {
    const $user = $('<span>').addClass('acgnom-user').append(link('User:' + nomination.awarder, nomination.awarder));
    const $tools = sourceRows(nomination.source).find('.acgnom-user-tools').first().clone();
    return $('<span>').append($user, $tools.length ? $tools : $('<span>').addClass('plainlinks acgnom-user-tools').append('［', link('Special:Contributions/' + nomination.awarder, t('獻', '献')), '］'));
}

/**
 * 在既有表格追加一筆提名的兩行：條目格跨兩行，核對格跨後兩欄。
 * 保留原頁面可用的標題與用戶工具，所有輸入直接更新 nomination。
 * @param {jQuery} $table createNominationTable 建立的表格。
 * @param {object} nomination 可修改的草稿資料，含來源快照與核分狀態。
 * @param {number} index 草稿陣列位置，呈現時使用從 1 起算的行編號。
 * @param {object} callbacks checking 決定模式；touch／onReviewed 通知資料變更；onInputSettled 在組合輸入結束後處理延後的同步。
 * @returns {object} 原始列節點、原地同步與組合輸入介面；核對模式另附 reviewWidget。
 */
export function appendNominationRows($table, nomination, index, {checking, openRules, touch, onReviewed, onRemove, onStash, onInputSettled}) {
    const status = nomination.original ? 'rechecking' : 'pending';
    const attributes = {'data-acgnom-index': index + 1, 'data-acgnom-status': status, 'data-acga-id': nomination.id};
    const $entry = $('<tr>').addClass(`acgnom-entry item${index + 1} ${status}`).attr(attributes);
    const $check = $('<tr>').addClass(`acgnom-check-row item${index + 1} ${status}`).attr(attributes);
    const $title = $('<th>').addClass('acgnom-title-cell').attr({rowspan: 2, scope: 'row'});
    const $user = $('<td>').addClass('acgnom-user-cell');
    const $reason = $('<td>').addClass('acgnom-reason-cell');
    const $resultCell = $('<td>').addClass('acgnom-check-cell').attr('colspan', 2);
    const $result = $('<div>').addClass('mw-notalk acgnom-check');
    $entry.append($title, $user, $reason);
    $check.append($resultCell.append($result));
    $table.children('tbody').append($entry, $check);

    const inputs = new Map();
    const textInput = (key, label, $cell) => {
        const input = new OO.ui.TextInputWidget({value: nomination[key], placeholder: label});
        input.$element.addClass('acga-cell-input');
        input.$input.attr({'aria-label': label, 'data-acga-field': key});
        inputs.set(key, bindTextInput(input, value => {
            if (nomination[key] === value) return;
            nomination[key] = value; touch();
        }, onInputSettled));
        $cell.empty().append(input.$element);
        return input;
    };
    const $userDisplay = checking ? $('<span>').append(userContents(nomination)) : $();
    let displayedAwarder = nomination.awarder;
    // 覆核與一般編輯共用條目輸入框，也沿用原地同步、自動保存及輸入法處理。
    if (checking && !nomination.original) $title.append(titleContents(nomination));
    else textInput('pageName', t('條目名稱', '条目名称'), $title);
    if (checking) {
        $user.append($userDisplay, ' ', action(t('更正得分者'), () => textInput('awarder', t('得分者'), $user).focus()).addClass('acga-change-awarder'));
    } else {
        textInput('awarder', t('得分者'), $user);
    }

    const $actions = $('<div>').addClass('acga-row-actions');
    if (onRemove) $actions.append(checking || nomination.source ? action(t('取消'), onRemove) :
        iconButton(cdxIconTrash, t('刪除', '删除'), onRemove, {showLabel: true, destructive: true})
            .attr('title', t('刪除此筆未發布提名', '删除此项未发布提名')).addClass('acga-remove-nomination'));
    if (onStash) $actions.append(iconButton(cdxIconLogIn, t('暫存', '暂存'), onStash, {showLabel: true})
        .attr('title', t('暫存此筆操作', '暂存此项操作')).addClass('acga-stash-nomination'));
    if (!checking) $title.append($actions);
    const titleStatus = bindTitleStatus($title[0], nomination.pageName);

    // 派生內容另外更新；輸入框和規則按鈕維持同一個節點。
    const $reasonText = $('<span>').appendTo($reason);
    const $resultText = $('<span>').appendTo($result);
    let reasonSignature;
    const refresh = () => {
        const signature = JSON.stringify([nomination.ruleStatus, nomination.invalid, nomination.source?.values]);
        if (signature === reasonSignature) return;
        reasonSignature = signature;
        if (!checking) {
            const fragments = ruleFragments(nomination.ruleStatus);
            $reasonText.empty().append(fragments.count ? fragments.$element : $('<span>').text(t('尚未選擇規則', '尚未选择规则')));
            if (fragments.count) $reasonText.append(`，${t('計', '计')}${Number.isFinite(fragments.total) ? fragments.total : '?'}${t('分')}`);
            $resultText.empty().append($('<span>').addClass('acgnom-wait-icon').attr({role: 'img', 'aria-label': '🕒'}), ' ', t('此提名尚未核對。', '此提名尚未核对。'));
            return;
        }
        const requested = parseUserReason(nomination.source.values['提名理由']);
        const request = ruleFragments(requested || {});
        $reasonText.empty().append(request.$element, `，${t('計', '计')}${request.total}${t('分')}`);
        const yes = ruleFragments(nomination.ruleStatus), no = ruleFragments(nomination.ruleStatus, false);
        const rejected = nomination.invalid || !yes.count;
        $resultText.empty().append($('<span>').addClass(`acgnom-check-icon acgnom-check-${rejected ? 'no' : no.count ? 'partly' : 'yes'}`).attr({role: 'img', 'aria-label': rejected ? '✗' : '✓'}), ' ');
        if (rejected) $resultText.append($('<b>').text(t('不得分')));
        else {
            $resultText.append(t('符合'), yes.$element, '，', $('<b>').text(`${t('得')}${Number.isFinite(yes.total) ? yes.total : '?'}${t('分')}`));
            if (no.count) $resultText.append(`；${t('不符合')}`, no.$element);
        }
        $resultText.append('。 ');
    };
    if (checking) $result.append(' ', action(t('調整核分', '调整核分'), () => openRules(refresh)));
    else $reason.append(' ', action(t('選擇規則', '选择规则'), () => openRules(refresh)));
    const controls = {
        $entry, $check,
        isComposing: () => [...inputs.values()].some(input => input.isComposing()),
        settled: () => Promise.all([...inputs.values()].map(input => input.settled())),
        destroy: () => { titleStatus.destroy(); inputs.forEach(input => input.destroy()); },
        sync: () => {
            for (const [key, input] of inputs) input.sync(nomination[key]);
            // 連續輸入先合併，IME 未確認文字不會進入 nomination，也不會觸發查詢。
            titleStatus.update(nomination.pageName, 350);
            if (checking && !inputs.has('awarder') && displayedAwarder !== nomination.awarder) {
                $userDisplay.empty().append(userContents(nomination));
                displayedAwarder = nomination.awarder;
            }
            refresh();
        },
    };
    refresh();
    if (!checking) return controls;

    if (nomination.original) {
        const $old = $('<details>').addClass('acga-original-check').append($('<summary>').text(`${t('原核分')}：${nomination.source.values['用戶名稱']} ${nomination.original.score} ${t('分')}`));
        const $rendered = sourceRows(nomination.source).find('.acgnom-check').first().clone();
        $rendered.find('.acga-control, .multi-nomCheck').remove();
        $old.append($rendered.length ? $rendered : $('<p>').text(nomination.source.values['核對用'].replace(/<!--[\s\S]*?-->/g, '')));
        $resultCell.append($old);
    }
    const $invalid = $('<input>').attr({type: 'checkbox', 'data-acga-field': 'invalid'}).prop('checked', nomination.invalid).on('change', () => {
        nomination.invalid = $invalid.prop('checked'); touch(); refresh();
    });
    $resultCell.append($('<label>').addClass('acga-inline-option').append($invalid, ' ', t('提名無效', '提名无效')));
    const messageLabel = nomination.original ? t('覆核說明', '复核说明') : t('核對說明', '核对说明');
    const message = new OO.ui.MultilineTextInputWidget({autosize: true, rows: 1, value: nomination.message, placeholder: messageLabel + t('（選填，無須簽名）', '（选填，无须签名）')});
    message.$input.attr({'aria-label': messageLabel, 'data-acga-field': 'message'});
    inputs.set('message', bindTextInput(message, value => {
        if (nomination.message === value) return;
        nomination.message = value; touch();
    }, onInputSettled));
    message.$element.addClass('acga-check-message');
    $resultCell.append(message.$element);
    const $scorePreview = $('<p>').addClass('acga-score-preview');
    const refreshScore = () => {
        $scorePreview.empty();
        const before = previousBooking(nomination), score = nomination.invalid ? 0 : ruleFragments(nomination.ruleStatus).total;
        if (Number.isFinite(score) && nomination.awarder.trim()) {
            const changes = [...scoreDeltas([{before, awarder: nomination.awarder.trim(), score}])].filter(([, delta]) => delta !== 0);
            $scorePreview.text(t('積分榜變動：', '积分榜变动：') + (changes.length ? changes.map(([user, delta]) => `${user} ${delta > 0 ? '+' : ''}${delta}`).join('；') : t('不變', '不变')));
        }
    };
    refreshScore();
    $resultCell.append($scorePreview);
    if (nomination.previousProposal) $resultCell.append($('<details>').append($('<summary>').text(t('先前草稿的核對內容', '先前草稿的核对内容')), $('<p>').text(nomination.previousProposal.awarder), ruleFragments(nomination.previousProposal.ruleStatus).$element, $('<p>').text(nomination.previousProposal.message || '')));
    const $reviewed = $('<input>').attr({type: 'checkbox', 'data-acga-field': 'reviewed'}).prop('checked', nomination.reviewed);
    // 提供與編輯器相同的選取介面，讓欄位變更或遠端衝突能撤銷這筆的完成標記。
    const reviewWidget = {
        isSelected: () => $reviewed.prop('checked'),
        setSelected: value => {
            if (value === $reviewed.prop('checked') && value === nomination.reviewed) return;
            $reviewed.prop('checked', value); nomination.reviewed = value; onReviewed();
        },
    };
    $reviewed.on('change', () => { nomination.reviewed = $reviewed.prop('checked'); onReviewed(); });
    $resultCell.append($('<label>').addClass('acga-inline-option acga-reviewed').append($reviewed, ' ', nomination.original ? t('覆核完成', '复核完成') : t('核對完成', '核对完成')));
    // 核對操作跟在完成標記後；按鈕放在 label 外，避免點擊時切換 checkbox。
    $resultCell.append($actions.addClass('acga-review-actions'));
    const syncInputs = controls.sync;
    controls.sync = () => {
        syncInputs();
        $invalid.prop('checked', !!nomination.invalid);
        $reviewed.prop('checked', !!nomination.reviewed);
        refreshScore();
    };
    return {...controls, reviewWidget};
}
