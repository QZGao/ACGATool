import {t} from '../i18n.js';
import {entryValues, listEntries, queried2NomData} from '../wiki/api.js';
import {reviewData} from './scoring.js';
import {entryOwnership} from './ownership.js';
import {copy, sameSource} from './operations.js';

// changes 是可存入草稿的欄位差異資料，供介面高亮與重新核對使用。
export class ReviewConflict extends Error {
    constructor(changes) {
        super(t('提名或已入帳分數已變更，提交已停止。請查看標示內容並重新核對。', '提名或已入账分数已变更，提交已停止。请查看标示内容并重新核对。'));
        this.changes = changes;
    }
}

/**
 * 在最新本文重新定位提名並比較原始欄位與提名人。
 * 先依日期與序號定位，再比較四欄快照；內容相同的其他提名不能代替原項目。
 * @returns {{entries: Array, changes: Array}} entries 與輸入同序，無法唯一定位的位置為 null；changes 供介面展示。
 */
export function inspectNominations(text, nominations) {
    const all = listEntries(text);
    const entries = [], changes = [];
    for (const nomination of nominations) {
        const source = nomination.source;
        const matches = all.filter(entry => sameSource(entry, source));
        if (matches.length !== 1) {
            changes.push({id: nomination.id, pageName: nomination.pageName, before: source.values, after: null,
                fields: ['無法唯一辨識原提名，可能已移動、刪除或出現重複項目。'], source: null});
            entries.push(null); continue;
        }
        const entry = matches[0];
        const values = entryValues(entry), before = source.values;
        const ownership = entryOwnership(text, entry);
        const fields = Object.keys(before).filter(key => before[key] !== values[key]);
        if (source.ownership && JSON.stringify(source.ownership.nominators) !== JSON.stringify(ownership.nominators)) fields.push('提名人');
        if (fields.length) changes.push({id: nomination.id, pageName: nomination.pageName, before: {...source.values, '提名人': source.ownership?.nominators.join('、') || ''}, after: {...values, '提名人': ownership.nominators.join('、')}, fields,
            source: {date: entry.date, index: entry.index, values, ownership}});
        entries.push(entry);
    }
    return {entries, changes};
}

/**
 * 整批確認來源仍一致；任一項目改變就拋出 ReviewConflict，阻止以舊判斷儲存。
 */
export function validateNominations(text, nominations) {
    const result = inspectNominations(text, nominations);
    if (result.changes.length) throw new ReviewConflict(result.changes);
    return result.entries;
}

/**
 * 根據呼叫端提供的最新原文重建編輯資料，不讀取頁面或修改提交紀錄。
 * 受影響項目撤銷完成標記，舊提案存入 previousProposal；其餘項目保留核對決定。
 * @returns {object[]} 重建的操作；原輸入與未受影響的新提名保持不變。
 */
export function refreshReviewItems(items, text, previousChanges = []) {
    const existing = items.filter(item => item.mode !== 'new');
    const sources = existing.map(item => item.nomination);
    const inspection = inspectNominations(text, sources);
    if (inspection.entries.some(entry => !entry)) throw new Error(t('無法唯一辨識原提名。原輸入仍保留，請核實提名是否已移動或刪除。', '无法唯一辨识原提名。原输入仍保留，请核实提名是否已移动或删除。'));
    const changes = [...previousChanges, ...inspection.changes];
    const refreshed = new Map(existing.map((item, index) => {
        const old = item.nomination, entry = inspection.entries[index];
        const source = {date: entry.date, index: entry.index, values: entryValues(entry), ownership: entryOwnership(text, entry)};
        const data = queried2NomData(entry);
        if (!data) throw new Error(t('目前提名格式無法讀取，原輸入仍保留。', '目前提名格式无法读取，原输入仍保留。'));
        const fresh = item.mode === 'check' ? reviewData(data, source) : {...data, source};
        fresh.id = old.id;
        const diff = changes.filter(change => change.id === old.id);
        if (!diff.length) return [item, {...item, nomination: {...old, source, original: fresh.original}}];
        // 完整保留舊提案（包含條目名稱與無效標記）。一般修改繼續使用本地輸入，
        // 由使用者檢視新來源後確認；核對則先展示最新核分並允許重新套用舊提案。
        const previousProposal = copy(old);
        delete previousProposal.previousProposal;
        const nomination = item.mode === 'edit' ? {...old, source, previousProposal} : {...fresh, reviewed: false, previousProposal};
        return [item, {...item, nomination, reviewDiff: diff, needsReview: item.mode === 'edit'}];
    }));
    return items.map(item => refreshed.get(item) || item);
}
