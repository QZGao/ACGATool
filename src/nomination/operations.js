import {t} from '../i18n.js';
import {parseUserReason} from '../wiki/api.js';
import {NominationRuleSet, ruleValues} from './rules.js';
import {newId, stripComments} from './scoring.js';

export const copy = value => JSON.parse(JSON.stringify(value));
export const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 比較實際發布內容，忽略視窗建立的預設選項、輸入快取及空白。 */
function editable(nomination) {
    const rules = Object.entries(nomination.ruleStatus).filter(([, rule]) => rule.selected)
        .map(([key, rule]) => [key, rule.desc, rule.score]).sort(([a], [b]) => a.localeCompare(b));
    return {pageName: nomination.pageName.trim(), awarder: nomination.awarder.trim(), rules};
}

export function hasChanges(item) {
    if (item.mode !== 'edit') return true;
    const values = item.nomination.source.values;
    return !equal(editable(item.nomination), editable({pageName: values['條目名稱'], awarder: values['用戶名稱'],
        ruleStatus: parseUserReason(values['提名理由']) || {}}));
}

/** 開啟表單本身不算輸入；規則彈窗自動補上的未選選項也不觸發持久保存。 */
export function hasInput(item, defaultAwarder = '') {
    const n = item.nomination;
    if (item.needsReview || n.previousProposal) return true;
    if (item.mode === 'edit') return hasChanges(item);
    const rules = (status, checking) => Object.entries(status || {})
        .filter(([, rule]) => rule.selected || checking && rule.applicable !== false ||
            ['desc', 'score', 'scoreInput'].some(field => Object.hasOwn(rule, field)))
        .map(([key, rule]) => [key, !!rule.selected, rule.desc, rule.score, rule.scoreInput])
        .sort(([a], [b]) => a.localeCompare(b));
    if (item.mode === 'new') return !!(n.pageName.trim() || rules(n.ruleStatus, false).length ||
        n.awarder.trim() && n.awarder.trim() !== defaultAwarder || n.message);
    const values = n.source.values, requested = parseUserReason(values['提名理由']);
    const initialRules = n.original ? {
        ...Object.fromEntries(Object.entries(requested || {}).map(([key, value]) => [key, {...value, selected: false}])),
        ...n.original.ruleStatus,
    } : requested;
    return !!n.reviewed || !!n.message || !!n.invalid !== !!n.original?.invalid ||
        n.pageName.trim() !== stripComments(values['條目名稱']) || n.awarder.trim() !== stripComments(values['用戶名稱']) ||
        !equal(rules(n.ruleStatus, true), rules(initialRules, true));
}

export function createItem(mode, nomination) {
    const data = copy(nomination);
    data.id ||= newId();
    return {id: newId(), mode, nomination: data};
}

/** 一個來源在工作區只保留一份編輯；不同來源與新提名則可以並存。 */
export function sameSource(a, b) {
    if (!a || !b) return false;
    return a.date === b.date && equal(a.values, b.values);
}

/** 純驗證不發通知；欄位提示、進度條與提交前驗證共用相同的完成條件。 */
export function operationStatus(item) {
    const n = item.nomination, errors = [];
    if (!n.pageName?.trim()) errors.push({field: 'pageName', message: t('請填寫條目名稱。', '请填写条目名称。')});
    if (!n.awarder?.trim()) errors.push({field: 'awarder', message: t('請填寫得分者。', '请填写得分者。')});
    if (/[\r\n]/.test(n.awarder || '')) errors.push({field: 'awarder', message: t('得分者名稱不能包含換行。', '得分者名称不能包含换行。')});
    const {ruleDict} = NominationRuleSet();
    const rules = Object.entries(n.ruleStatus).filter(([, rule]) => rule.selected || item.mode === 'check' && rule.applicable !== false);
    if (item.mode !== 'check' && !rules.length) errors.push({field: 'ruleStatus', message: t('請選擇提名規則。', '请选择提名规则。')});
    if (rules.some(([key, rule]) => {
        if (!ruleDict[key]) return true;
        const {score} = ruleValues(rule, ruleDict[key]);
        return !Number.isFinite(score);
    })) {
        errors.push({field: 'ruleStatus', message: t('規則分數必須是有限數字。', '规则分数必须是有限数字。')});
    }
    if (item.mode === 'check') {
        if (!n.reviewed) errors.push({field: 'reviewed', message: n.original ? t('請完成此筆覆核。', '请完成这项复核。') : t('請完成此筆核對。', '请完成这项核对。')});
    }
    if (item.needsReview) errors.push({field: 'source', message: t('來源已變更，請確認標示的差異。', '来源已变更，请确认标示的差异。')});
    return {active: hasChanges(item), ready: errors.length === 0, errors};
}

export function lockedItem(session, id) {
    return session.submissions.some(submission => submission.itemIds.includes(id));
}

/** 覆核由原核分結果判定（含零分）；只細分展示類型，草稿與提交仍沿用 check 模式。 */
export function operationType(item) {
    return item.mode === 'check' && item.nomination.original ? 'recheck' : item.mode;
}

export function sessionProgress(session) {
    const items = session.items.filter(item => !lockedItem(session, item.id) && hasChanges(item));
    const byType = {new: {ready: 0, total: 0}, edit: {ready: 0, total: 0}, check: {ready: 0, total: 0}, recheck: {ready: 0, total: 0}};
    let ready = 0;
    for (const item of items) {
        const counts = byType[operationType(item)];
        counts.total++;
        if (operationStatus(item).ready && !session.conflicts.some(conflict => conflict.itemId === item.id)) {
            counts.ready++; ready++;
        }
    }
    return {items, byType, ready, total: items.length, complete: items.length > 0 && ready === items.length && !session.conflicts.length};
}
