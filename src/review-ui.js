import {parseUserReason} from './api.js';
import {parseCheck} from './scoring.js';
import {ruleFragments} from './table-editor.js';

/** 將模板欄位轉成可讀的規則與分數；解析不了時仍保留原文供人工判斷。 */
export function fieldText(field, value) {
    try {
        const rules = field === 'ruleStatus' ? value : field === '提名理由' ? parseUserReason(value) :
            field === '核對用' ? parseCheck(value)?.ruleStatus : null;
        if (rules) {
            const yes = ruleFragments(rules), no = ruleFragments(rules, false);
            return `${yes.$element.text() || '無符合規則'}；${yes.total} 分${no.count ? '；不符合：' + no.$element.text() : ''}`;
        }
    } catch { /* 無法辨識的舊格式保留原文，不隱藏實際差異。 */ }
    return typeof value === 'object' ? JSON.stringify(value) : String(value ?? '').replace(/<!--[\s\S]*?-->/g, '');
}

export function appendDifferences($container, changes) {
    for (const change of changes) {
        const $table = $('<table>').addClass('acga-diff').append($('<caption>').text(change.pageName || '內容變更'));
        $table.append($('<thead>').append($('<tr>').append(['欄位', '先前內容', '目前內容'].map(label => $('<th>').text(label)))));
        const $body = $('<tbody>');
        for (const field of change.fields) $body.append($('<tr>').append($('<th>').text(field),
            $('<td>').text(fieldText(field, change.before?.[field])),
            $('<td>').append($('<mark>').text(change.after ? fieldText(field, change.after[field]) : '找不到唯一對應的提名'))));
        $container.append($table.append($body));
    }
}
