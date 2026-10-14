import {entryValues, listEntries} from './api.js';
import {readRecord, scoreReceipts, stripComments} from './scoring.js';
import {entryOwnership} from './ownership.js';

// changes 是可存入草稿的欄位差異資料，供介面高亮與重新核對使用。
export class ReviewConflict extends Error {
    constructor(changes) {
        super('提名或已入帳分數已變更，提交已停止。請查看標示內容並重新核對。');
        this.changes = changes;
    }
}

/**
 * 只消除小工具標記範圍內的簽名展開差異。
 * 不可刪除整段核對文字或所有註解，否則可能漏掉實際結果或識別資訊的變更。
 */
function comparable(values) {
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [key,
        value.replace(/<!--ACGATool-signature:([^>]+)-->[\s\S]*?<!--\/ACGATool-signature:\1-->/g, '<signature>')]));
}

/**
 * 在最新本文重新定位提名並比較原始欄位與提名人。
 * 有持久 id 時依 id 找；舊提名依日期內的完整快照或唯一條目名稱找，歧義時停止猜測。
 * @returns {{entries: Array, changes: Array}} entries 與輸入同序，無法唯一定位的位置為 null；changes 供介面展示。
 */
export function inspectNominations(text, nominations) {
    const all = listEntries(text);
    const entries = [], changes = [];
    for (const nomination of nominations) {
        const source = nomination.source;
        const id = readRecord(source.values['核對用'])?.id;
        let matches;
        if (id) matches = all.filter(entry => readRecord(entryValues(entry)['核對用'])?.id === id);
        else {
            const candidates = all.filter(entry => entry.date === source.date);
            matches = candidates.filter(entry => JSON.stringify(entryValues(entry)) === JSON.stringify(source.values));
            if (!matches.length) matches = candidates.filter(entry => stripComments(entryValues(entry)['條目名稱']) === stripComments(source.values['條目名稱']));
        }
        if (matches.length !== 1) {
            changes.push({id: nomination.id, pageName: nomination.pageName, before: source.values, after: null,
                fields: ['無法唯一辨識原提名，可能已移動、刪除或出現重複項目。'], source: null});
            entries.push(null); continue;
        }
        const entry = matches[0];
        const values = entryValues(entry), before = comparable(source.values), after = comparable(values);
        const ownership = entryOwnership(text, entry);
        const fields = Object.keys(before).filter(key => before[key] !== after[key]);
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
 * 比對每筆提名的入帳基準，不因同一得分者的其他提名改變總分而要求重核。
 * 本批已有收據時交給 prepareScoreText 核對完整內容，避免把自己的入帳當成外部變更。
 */
export function validateAccounting(text, results, operation) {
    const ledger = scoreReceipts(text);
    if (operation && ledger.operations.has(operation)) return;
    const receipts = ledger.entries;
    const changes = [];
    for (const result of results) {
        const receipt = receipts.get(result.id);
        if (receipt && (receipt.awarder !== result.before.awarder || receipt.score !== result.before.score)) {
            changes.push({id: result.id, pageName: result.awarder, before: {'已入帳結果': `${result.before.awarder} ${result.before.score}`},
                after: {'已入帳結果': `${receipt.awarder} ${receipt.score}`}, fields: ['已入帳結果'], accounting: true});
        }
    }
    if (changes.length) throw new ReviewConflict(changes);
}

/**
 * 在使用者要求重新核對後載入最新來源；結果未明的提交須先完成查證。
 * 受影響項目撤銷完成標記，舊提案存入 previousProposal；其餘項目保留核對決定。
 * @param {object} draft 草稿會就地更新，舊 operation 只在成功重建資料後清除。
 * @param {object} io 唯讀查詢使用的實際或 dry-run 介面。
 */
export async function reloadForReview(draft, io) {
    if (draft.operation?.steps.some(step => ['saving', 'unknown'].includes(step.status))) throw new Error('請先確認上次儲存結果。');
    const {REGISTER, SCORES} = await import('./submission.js');
    const {queried2NomData} = await import('./api.js');
    const {reviewData} = await import('./scoring.js');
    const [registry, scoreboard] = await Promise.all([io.read(REGISTER), draft.mode === 'check' ? io.read(SCORES) : null]);
    const registrySaved = draft.operation?.steps.find(step => step.key === 'registry')?.status === 'succeeded';
    // 登記處若已完成，應以本次發布後的快照定位；仍用發布前快照會把自己的修改當成衝突。
    const sources = registrySaved ? draft.operation.expectedNominations : draft.nominations;
    const inspection = inspectNominations(registry.text, sources);
    if (inspection.entries.some(entry => !entry)) throw new Error('無法唯一辨識原提名。草稿已保留，請從頁面重新選取正確項目。');
    const changed = new Set([...(draft.conflicts || []), ...inspection.changes].map(change => change.id));
    draft.nominations = inspection.entries.map((entry, index) => {
        const old = draft.nominations[index];
        const source = {date: entry.date, index: entry.index, values: entryValues(entry), ownership: entryOwnership(registry.text, entry)};
        const data = queried2NomData(entry);
        if (!data) throw new Error('目前提名格式無法讀取，草稿已保留。');
        const fresh = draft.mode === 'check' ? reviewData(data, source, scoreboard.text) : {...data, source, id: old.id};
        if (!readRecord(source.values['核對用'])) fresh.id = old.id;
        if (changed.has(old.id)) return {...fresh, reviewed: false, previousProposal: {awarder: old.awarder, ruleStatus: old.ruleStatus, message: old.message, invalid: old.invalid}};
        return {...old, source, original: fresh.original, baseline: fresh.baseline, booking: fresh.booking};
    });
    draft.operation = null;
    draft.conflicts = [];
}
