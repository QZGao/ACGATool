import {parseUserReason} from '../wiki/api.js';
import {parseCheck} from '../nomination/scoring.js';
import {ruleFragments} from './table-editor.js';
import {t} from '../i18n.js';

/** 差異資料的模板欄位鍵保持原文，只在表頭顯示時轉換名稱。 */
export function fieldLabel(field) {
    return {
        '條目名稱': t('條目名稱', '条目名称'), '用戶名稱': t('用戶名稱', '用户名称'),
        '提名理由': t('提名理由'), '核對用': t('核對用', '核对用'), '提名人': t('提名人'),
        '已入帳結果': t('已入帳結果', '已入账结果'),
        '無法唯一辨識原提名，可能已移動、刪除或出現重複項目。': t('無法唯一辨識原提名，可能已移動、刪除或出現重複項目。', '无法唯一辨识原提名，可能已移动、删除或出现重复项目。'),
        pageName: t('條目', '条目'), awarder: t('得分者'), ruleStatus: t('規則', '规则'),
        message: t('說明', '说明'), summary: t('編輯摘要', '编辑摘要'), reviewed: t('核對完成', '核对完成'),
        invalid: t('提名有效性'), booking: t('入帳狀態', '入账状态'),
    }[field] || field;
}

/** 將模板欄位轉成可讀的規則與分數；解析不了時仍保留原文供人工判斷。 */
export function fieldText(field, value) {
    if (field === 'reviewed') return value ? t('核對完成', '核对完成') : t('尚未核對完成', '尚未核对完成');
    if (field === 'invalid') return value ? t('提名無效', '提名无效') : t('提名有效');
    if (field === 'booking') return {
        unknown: t('尚未確認是否入帳', '尚未确认是否入账'), recorded: t('已有入帳記錄', '已有入账记录'),
        booked: t('原核分已入帳', '原核分已入账'), unbooked: t('原核分尚未入帳', '原核分尚未入账'),
    }[value] || String(value ?? '');
    try {
        const rules = field === 'ruleStatus' ? value : field === '提名理由' ? parseUserReason(value) :
            field === '核對用' ? parseCheck(value)?.ruleStatus : null;
        if (rules) {
            const yes = ruleFragments(rules), no = ruleFragments(rules, false);
            return `${yes.$element.text() || t('無符合規則', '无符合规则')}；${yes.total} ${t('分')}${no.count ? t('；不符合：') + no.$element.text() : ''}`;
        }
    } catch { /* 無法辨識的舊格式保留原文，不隱藏實際差異。 */ }
    return typeof value === 'object' ? JSON.stringify(value) : String(value ?? '').replace(/<!--[\s\S]*?-->/g, '');
}

export function appendDifferences($container, changes) {
    for (const change of changes) {
        const $table = $('<table>').addClass('acga-diff').append($('<caption>').text(change.pageName || t('內容變更', '内容变更')));
        $table.append($('<thead>').append($('<tr>').append([t('欄位', '字段'), t('先前內容', '先前内容'), t('目前內容', '目前内容')].map(label => $('<th>').text(label)))));
        const $body = $('<tbody>');
        for (const field of change.fields) $body.append($('<tr>').append($('<th>').text(fieldLabel(field)),
            $('<td>').text(fieldText(field, change.before?.[field])),
            $('<td>').append($('<mark>').text(change.after ? fieldText(field, change.after[field]) : t('找不到唯一對應的提名', '找不到唯一对应的提名')))));
        $container.append($table.append($body));
    }
}
