/**
 * 沿用 Template:ACG提名2 的表格、列與儲存格 class，讓編輯狀態繼承登記處樣式。
 * 本模組只建立畫面並更新傳入的提名；發布與草稿保存由呼叫端的回呼處理。
 */
import state from './state.js';
import {NominationRuleSet} from './rules.js';
import {parseUserReason} from './api.js';
import {cdxIconTrash} from './icons.js';
import {iconButton} from './icon-button.js';
import {previousBooking, scoreDeltas} from './scoring.js';

const t = (hant, hans = hant) => state.convByVar({hant, hans});

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
    const {ruleNames, ruleDict} = NominationRuleSet();
    const $result = $('<span>');
    let count = 0, total = 0;
    for (const key of ruleNames) {
        const rule = ruleStatus[key];
        if (!rule || !!rule.selected !== selected || rule.applicable === false && !rule.selected) continue;
        if (count++) $result.append('、');
        const score = Object.prototype.hasOwnProperty.call(rule, 'score') ? rule.score : ruleDict[key].score;
        const shownScore = Number.isFinite(score) ? score : '?';
        let desc = rule.desc || ruleDict[key].desc;
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
 * @param {object} callbacks checking 決定模式；openRules 開規則彈窗；touch 撤銷核對並保存；onReviewed 通知完成標記變更；onRemove／onStash 取消或暫存這筆獨立操作。
 * @returns {object} $entry、$check；核對模式另附 reviewWidget 供外部撤銷完成標記。
 */
export function appendNominationRows($table, nomination, index, {checking, openRules, touch, onReviewed, onRemove, onStash}) {
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

    const textInput = (key, label, $cell) => {
        const input = new OO.ui.TextInputWidget({value: nomination[key], placeholder: label});
        input.$element.addClass('acga-cell-input');
        input.$input.attr({'aria-label': label, 'data-acga-field': key});
        input.on('change', value => { nomination[key] = value; touch(); });
        $cell.empty().append(input.$element);
        return input;
    };
    if (checking) {
        $title.append(titleContents(nomination));
        $user.append(userContents(nomination), ' ', action(t('更正得分者'), () => textInput('awarder', t('得分者'), $user).focus()).addClass('acga-change-awarder'));
    } else {
        textInput('pageName', t('條目名稱', '条目名称'), $title);
        textInput('awarder', t('得分者'), $user);
    }

    const $actions = $('<div>').addClass('acga-row-actions');
    if (onRemove) $actions.append(checking || nomination.source ? action(t('取消'), onRemove) :
        iconButton(cdxIconTrash, t('取消此筆提名', '取消此项提名'), onRemove, {destructive: true}).addClass('acga-remove-nomination'));
    if (onStash) $actions.append($('<button>').attr({type: 'button', title: t('暫存此筆操作', '暂存此项操作')}).addClass('acga-icon-button acga-stash-nomination').text(t('暫存', '暂存')).on('click', onStash));
    $title.append($actions);

    // 只重繪衍生的理由與核分預覽，避免重建輸入元件而遺失使用者正在輸入的內容。
    const refresh = () => {
        if (!checking) {
            const fragments = ruleFragments(nomination.ruleStatus);
            $reason.empty().append(fragments.count ? fragments.$element : $('<span>').text(t('尚未選擇規則', '尚未选择规则')));
            if (fragments.count) $reason.append(`，${t('計', '计')}${Number.isFinite(fragments.total) ? fragments.total : '?'}${t('分')}`);
            $reason.append(' ', action(t('選擇規則', '选择规则'), () => openRules(refresh)));
            $result.empty().append($('<span>').addClass('acgnom-wait-icon').attr({role: 'img', 'aria-label': '🕒'}), ' ', t('此提名尚未核對。', '此提名尚未核对。'));
            return;
        }
        const requested = parseUserReason(nomination.source.values['提名理由']);
        const request = ruleFragments(requested || {});
        $reason.empty().append(request.$element, `，${t('計', '计')}${request.total}${t('分')}`);
        const yes = ruleFragments(nomination.ruleStatus), no = ruleFragments(nomination.ruleStatus, false);
        const rejected = nomination.invalid || !yes.count;
        $result.empty().append($('<span>').addClass(`acgnom-check-icon acgnom-check-${rejected ? 'no' : no.count ? 'partly' : 'yes'}`).attr({role: 'img', 'aria-label': rejected ? '✗' : '✓'}), ' ');
        if (rejected) $result.append($('<b>').text(t('不得分')));
        else {
            $result.append(t('符合'), yes.$element, '，', $('<b>').text(`${t('得')}${Number.isFinite(yes.total) ? yes.total : '?'}${t('分')}`));
            if (no.count) $result.append(`；${t('不符合')}`, no.$element);
        }
        $result.append('。 ', action(t('調整核分', '调整核分'), () => openRules(refresh)));
    };
    refresh();
    if (!checking) return {$entry, $check};

    if (nomination.original) {
        const $old = $('<details>').addClass('acga-original-check').append($('<summary>').text(`${t('原核分')}：${nomination.source.values['用戶名稱']} ${nomination.original.score} ${t('分')}`));
        const $rendered = sourceRows(nomination.source).find('.acgnom-check').first().clone();
        $rendered.find('.acga-control, .multi-nomCheck').remove();
        $old.append($rendered.length ? $rendered : $('<p>').text(nomination.source.values['核對用'].replace(/<!--[\s\S]*?-->/g, '')));
        $resultCell.append($old);
    }
    if (nomination.original?.score > 0 && !nomination.baseline) {
        const $booking = $('<select>').attr({'aria-label': t('原分數入帳狀態', '原分数入账状态'), 'data-acga-field': 'booking'});
        [['unknown', t('請確認原核分是否已入帳', '请确认原核分是否已入账')], ['booked', t('原核分已登記到積分榜', '原核分已登记到积分榜')], ['unbooked', t('原核分尚未登記到積分榜', '原核分尚未登记到积分榜')]].forEach(([value, label]) => $booking.append($('<option>').val(value).text(label)));
        $booking.val(nomination.booking).on('change', () => { nomination.booking = $booking.val(); touch(); });
        const $help = $('<span>').append(' ', link('Module:ACGaward/list', t('查看積分資料', '查看积分资料')), ' · ',
            $('<a>').attr({href: mw.util.getUrl('Module:ACGaward/list', {action: 'history'}), target: '_blank', rel: 'noopener'}).text(t('入帳歷史', '入账历史')));
        $resultCell.append($('<p>').addClass('acga-booking').append($booking, $help));
    }
    const $invalid = $('<input>').attr({type: 'checkbox', 'data-acga-field': 'invalid'}).prop('checked', nomination.invalid).on('change', () => {
        nomination.invalid = $invalid.prop('checked'); touch(); refresh();
    });
    $resultCell.append($('<label>').addClass('acga-inline-option').append($invalid, ' ', t('提名無效', '提名无效')));
    const message = new OO.ui.MultilineTextInputWidget({autosize: true, rows: 1, value: nomination.message, placeholder: t('核對說明（選填，無須簽名）', '核对说明（选填，无须签名）')});
    message.$input.attr({'aria-label': t('核對說明', '核对说明'), 'data-acga-field': 'message'});
    message.on('change', value => { nomination.message = value; touch(); });
    message.$element.addClass('acga-check-message');
    $resultCell.append(message.$element);
    const $scorePreview = $('<p>').addClass('acga-score-preview');
    try {
        const before = previousBooking(nomination), score = nomination.invalid ? 0 : ruleFragments(nomination.ruleStatus).total;
        if (Number.isFinite(score) && nomination.awarder.trim()) {
            const changes = [...scoreDeltas([{before, awarder: nomination.awarder.trim(), score}])].filter(([, delta]) => delta !== 0);
            $scorePreview.text(t('積分榜變動：', '积分榜变动：') + (changes.length ? changes.map(([user, delta]) => `${user} ${delta > 0 ? '+' : ''}${delta}`).join('；') : t('不變', '不变')));
        }
    } catch { $scorePreview.text(t('確認原核分是否入帳後，即可預覽積分調整。', '确认原核分是否入账后，即可预览积分调整。')); }
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
    $resultCell.append($('<label>').addClass('acga-inline-option acga-reviewed').append($reviewed, ' ', t('核對完成', '核对完成')));
    return {$entry, $check, reviewWidget};
}
