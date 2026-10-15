import {parseUserReason} from './api.js';
import {NominationRuleSet} from './rules.js';
import {previousBooking, newId, readRecord} from './scoring.js';

export const copy = value => JSON.parse(JSON.stringify(value));
export const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 比較實際發布內容，忽略視窗建立的預設選項、輸入快取及空白。 */
function editable(nomination) {
    const rules = Object.entries(nomination.ruleStatus || {}).filter(([, rule]) => rule.selected)
        .map(([key, rule]) => [key, rule.desc, rule.score]).sort(([a], [b]) => a.localeCompare(b));
    return {pageName: nomination.pageName.trim(), awarder: nomination.awarder.trim(), rules};
}

export function hasChanges(item) {
    if (item.mode !== 'edit') return true;
    const values = item.nomination.source.values;
    return !equal(editable(item.nomination), editable({pageName: values['條目名稱'], awarder: values['用戶名稱'],
        ruleStatus: parseUserReason(values['提名理由']) || {}}));
}

export function createItem(mode, nomination) {
    const data = copy(nomination);
    data.id ||= newId();
    return {id: newId(), mode, nomination: data};
}

/** 一個來源在工作區只保留一份編輯；不同來源與新提名則可以並存。 */
export function sameSource(a, b) {
    if (!a || !b) return false;
    const first = readRecord(a.values['核對用'])?.id, second = readRecord(b.values['核對用'])?.id;
    return first && second ? first === second : a.date === b.date && equal(a.values, b.values);
}

/** 純驗證不發通知；欄位提示、進度條與提交前驗證共用相同的完成條件。 */
export function operationStatus(item) {
    const n = item.nomination, errors = [];
    if (!n.pageName?.trim()) errors.push({field: 'pageName', message: '請填寫條目名稱。'});
    if (!n.awarder?.trim()) errors.push({field: 'awarder', message: '請填寫得分者。'});
    const {ruleDict} = NominationRuleSet();
    const rules = Object.entries(n.ruleStatus || {}).filter(([, rule]) => rule.selected || item.mode === 'check' && rule.applicable !== false);
    if (item.mode !== 'check' && !rules.length) errors.push({field: 'ruleStatus', message: '請選擇提名規則。'});
    if (rules.some(([key, rule]) => !ruleDict[key] || !Number.isFinite(rule.score) || rule.score < 0)) {
        errors.push({field: 'ruleStatus', message: '請檢查規則分數，須為零或正數。'});
    }
    if (item.mode === 'check') {
        try { previousBooking(n); } catch (error) { errors.push({field: 'booking', message: error.message}); }
        if (!n.reviewed) errors.push({field: 'reviewed', message: '請完成此筆核對。'});
    }
    if (item.needsReview) errors.push({field: 'source', message: '來源已變更，請確認標示的差異。'});
    return {active: hasChanges(item), ready: errors.length === 0, errors};
}

export function lockedItem(session, id) {
    return session.submissions.some(submission => !submission.finished && submission.itemIds.includes(id));
}

export function sessionProgress(session) {
    const items = session.items.filter(item => !lockedItem(session, item.id) && hasChanges(item));
    const ready = items.filter(item => operationStatus(item).ready && !session.conflicts.some(conflict => conflict.itemId === item.id)).length;
    return {items, ready, total: items.length, complete: items.length > 0 && ready === items.length && !session.conflicts.length};
}
