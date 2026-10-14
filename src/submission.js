import {editPage, getFullText, findUnchangedEntry, updateEntries} from './api.js';
import {generateReason} from './rules.js';
import {newId, previousBooking, checkWikitext, prepareScoreText, scoreDeltas} from './scoring.js';

export const REGISTER = 'WikiProject:ACG/維基ACG專題獎/登記處';
export const SCORES = 'Module:ACGaward/list';

/**
 * 整批驗證後產生登記處修改與差額入帳資料，不執行寫入。
 * 每筆 result.before 是先前實際入帳的基準，不一定等於登記處顯示的核分。
 * @param {string} text 最新登記處本文。
 * @param {object[]} nominations 已逐筆核對、含來源快照與入帳基準的項目。
 * @param {string} [operation] 整批提交識別，重試時沿用。
 * @returns {object} text、results、按得分者彙總的差額 scores 及 operation。
 */
export function prepareChecks(text, nominations, operation = newId()) {
    if (!nominations.length || nominations.some(n => !n.reviewed)) throw new Error('請先逐筆完成核對。');
    const results = [];
    const updates = nominations.map(nomination => {
        const entry = findUnchangedEntry(text, nomination.source);
        const reason = generateReason(nomination.ruleStatus, true);
        if (!reason) throw new Error('請檢查規則分數。');
        const score = nomination.invalid ? 0 : reason.reasonScore;
        nomination.id ||= newId();
        if (!nomination.awarder.trim()) throw new Error('請填寫得分者。');
        results.push({id: nomination.id, awarder: nomination.awarder.trim(), score, before: previousBooking(nomination)});
        return {entry, changes: {'用戶名稱': nomination.awarder.trim(), '核對用': checkWikitext(nomination, reason, operation)}};
    });
    return {text: updateEntries(text, updates), scores: scoreDeltas(results), results, operation};
}

/**
 * 依序儲存整批核分與積分調整；寫入失敗時拋出錯誤供介面保留內容。
 * @returns {Promise<boolean>} 全部完成時返回 false，沿用編輯器的成功約定。
 */
export async function saveChecks(nominations) {
    const prepared = prepareChecks(await getFullText(REGISTER), nominations);
    const scoreText = await getFullText(SCORES);
    const newScores = prepareScoreText(scoreText, prepared.results, prepared.operation);
    if (!await editPage(REGISTER, prepared.text, '[[User:SuperGrey/gadgets/ACGATool|批次核對分數]]')) throw new Error('登記處儲存失敗。');
    if (!await editPage(SCORES, newScores, '[[User:SuperGrey/gadgets/ACGATool|核分與覆核積分調整]]')) throw new Error('積分榜儲存失敗。');
    mw.notify('核對結果已提交。');
    return false;
}
