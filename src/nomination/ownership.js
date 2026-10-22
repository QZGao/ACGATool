import {t} from '../i18n.js';
import {entryValues} from '../wiki/api.js';

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
    const tail = text.slice(entry.containerEnd).split(/\n\s*(?:===|{{ACG提名)/, 1)[0];
    const line = tail.match(/(?:提名人|提名者)(?:'{2,3})?\s*[：:]([^\n]*)/);
    const nominators = [];
    for (const match of (line?.[1] || '').matchAll(/\[\[\s*(?:User(?:[ _]talk)?|U|UT|用户(?:讨论)?|用戶(?:討論)?|使用者(?:討論)?|Special:Contributions|特殊:用[戶户][貢贡][獻献])\s*[:/]\s*([^\]|#]+)(?:[^\]]*)\]\]/gi)) {
        nominators.push(normalizeUser(match[1]));
    }
    return {awarder: normalizeUser(values['用戶名稱'].replace(/<!--[\s\S]*?-->/g, '')), nominators: [...new Set(nominators)]};
}

export function isOwnNomination(ownership, username) {
    const user = normalizeUser(username || '');
    return !!user && ownership.awarder === user;
}

/** 開啟與提交時只檢查原提名的得分者；提名人及更正後的得分者不作為限制。 */
export function assertCanCheck(ownership, username) {
    if (isOwnNomination(ownership, username)) throw new Error(t('不能核對自己為得分者的提名。', '不能核对自己为得分者的提名。'));
}
