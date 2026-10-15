import {t} from './state.js';
import {entryValues} from './api.js';

/**
 * 正規化空白、命名空間前綴與首字母；保留其餘字元的大小寫。
 * 不能將整個帳號轉成小寫，否則會把不同的 MediaWiki 帳號視為同一人。
 */
export function normalizeUser(value) {
    const name = value.replace(/_/g, ' ').trim().replace(/^(?:User|用户|用戶|使用者)\s*:/i, '').normalize('NFC');
    return name ? name[0].toUpperCase() + name.slice(1) : '';
}

/**
 * 從得分者欄位及整個提名模板後方的簽名取得身分。
 * 同一模板內的多筆提名或 extra 共用其後方簽名；查找不能跨到下一個模板或日期章節。
 * @returns {{awarder: string, nominators: string[]}} 已正規化的得分者及可辨識提名人。
 */
export function entryOwnership(text, entry) {
    const values = entryValues(entry);
    // One nomination template can contain several items sharing the following signature.
    const tail = text.slice(entry.containerEnd || entry.end).split(/\n\s*(?:===|{{ACG提名)/, 1)[0];
    const line = tail.match(/(?:提名人|提名者)(?:'{2,3})?\s*[：:]([^\n]*)/);
    const nominators = [];
    for (const match of (line?.[1] || '').matchAll(/\[\[\s*(?:User(?:[ _]talk)?|U|UT|用户(?:讨论)?|用戶(?:討論)?|使用者(?:討論)?|Special:Contributions|特殊:用[戶户][貢贡][獻献])\s*[:/]\s*([^\]|#]+)(?:[^\]]*)\]\]/gi)) {
        nominators.push(normalizeUser(match[1]));
    }
    return {awarder: normalizeUser(values['用戶名稱'].replace(/<!--[\s\S]*?-->/g, '')), nominators: [...new Set(nominators)]};
}

export function isOwnNomination(ownership, username) {
    const user = normalizeUser(username || '');
    return !!user && (ownership.awarder === user || ownership.nominators.includes(user));
}

/**
 * 在開啟核對與提交時檢查身分，涵蓋將得分者更正為自己的情況。
 * 隱藏按鈕不足以保護恢復的舊草稿；無法辨識提名人時也不能假定可以核對。
 */
export function assertCanCheck(ownership, username, proposedAwarder) {
    if (!username) throw new Error(t('請先登入後再核對。', '请先登录后再核对。'));
    if (isOwnNomination(ownership, username) || normalizeUser(proposedAwarder) === normalizeUser(username)) throw new Error(t('不能核對自己提名或自己得分的項目。', '不能核对自己提名或自己得分的项目。'));
    if (!ownership.nominators.length) throw new Error(t('無法辨識提名人，請手動核對此筆提名。', '无法辨识提名人，请手动核对这项提名。'));
}
