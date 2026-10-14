import {editPage, editACGAScoreList, getFullText, findUnchangedEntry, updateEntries} from './api.js';
import {generateReason} from './rules.js';

export const REGISTER = 'WikiProject:ACG/維基ACG專題獎/登記處';
export const SCORES = 'Module:ACGaward/list';

/**
 * 整批驗證後產生登記處修改與按得分者彙總的分數，不執行寫入。
 * @param {string} text 最新登記處本文。
 * @param {object[]} nominations 已逐筆核對、含來源快照的項目。
 * @returns {{text: string, scores: Map}} 待儲存本文與分數。
 */
export function prepareChecks(text, nominations) {
    if (!nominations.length || nominations.some(n => !n.reviewed)) throw new Error('請先逐筆完成核對。');
    const scores = new Map();
    const updates = nominations.map(nomination => {
        const entry = findUnchangedEntry(text, nomination.source);
        const reason = generateReason(nomination.ruleStatus, true);
        if (!reason) throw new Error('請檢查規則分數。');
        const score = nomination.invalid ? 0 : reason.reasonScore;
        const check = nomination.invalid ? '0' : reason.reasonText + (reason.unselectedReasonText ? '|no=' + reason.unselectedReasonText : '');
        scores.set(nomination.awarder, (scores.get(nomination.awarder) || 0) + score);
        return {entry, changes: {'核對用': `{{ACG提名2/check|ver=1|${check}}}${nomination.message}--~~~~`}};
    });
    return {text: updateEntries(text, updates), scores};
}

/**
 * 依序儲存整批核分與積分調整；寫入失敗時拋出錯誤供介面保留內容。
 * @returns {Promise<boolean>} 全部完成時返回 false，沿用編輯器的成功約定。
 */
export async function saveChecks(nominations) {
    const prepared = prepareChecks(await getFullText(REGISTER), nominations);
    if (!await editPage(REGISTER, prepared.text, '[[User:SuperGrey/gadgets/ACGATool|批次核對分數]]')) throw new Error('登記處儲存失敗。');
    for (const [awarder, score] of prepared.scores) {
        if (score && await editACGAScoreList(awarder, score)) throw new Error('積分榜儲存失敗。');
    }
    mw.notify('核對結果已提交。');
    return false;
}
