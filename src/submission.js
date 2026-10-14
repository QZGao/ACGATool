/**
 * 編排登記處與積分榜的兩次獨立編輯。
 * operation 保留提交快照、入帳差額及各步驟狀態；部分完成時從未完成步驟恢復。
 */
import {findUnchangedEntry, updateEntries} from './api.js';
import {entryOwnership, assertCanCheck} from './ownership.js';
import {wikiTransport, writeStep} from './transport.js';
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
        assertCanCheck(entryOwnership(text, entry), mw.config.get('wgUserName'), nomination.awarder);
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

function registryMarker(id) { return `<!--ACGATool-save:${id}-->`; }
/**
 * 保存一次寫入的完整本文、基底版本與查證標記。
 * 若回應未明，必須以這份原請求查證，不能重算差額後當成新請求送出。
 */
function makeAttempt(title, snapshot, text, operation, label) {
    const tag = `[ACGATool:${operation}]`;
    return {title, text, tag, marker: registryMarker(operation), summary: `${label} ${tag}`,
        base: {revid: snapshot.revid, starttimestamp: snapshot.starttimestamp}};
}

function prepareNew(text, draft) {
    if (!draft.nominations.length || draft.nominations.length > 25) throw new Error('每次請提交 1 至 25 筆提名。');
    let block = '{{ACG提名2';
    draft.nominations.forEach((nomination, index) => {
        const reason = generateReason(nomination.ruleStatus);
        if (!nomination.awarder.trim() || !nomination.pageName.trim() || !reason) throw new Error('請填寫得分者、條目及規則。');
        block += `\n|條目名稱${index + 1} = ${nomination.pageName.trim()}\n|用戶名稱${index + 1} = ${nomination.awarder.trim()}\n|提名理由${index + 1} = {{ACG提名2/request|ver=1|${reason}}}\n|核對用${index + 1} = {{ACG提名2/check|ver=1|}}`;
    });
    block += "\n}}\n'''提名人：'''~~~~";
    if (draft.message) block += '\n: {{說明}}：' + draft.message + '--~~~~';
    const today = new Date();
    const date = `${today.getMonth() + 1}月${today.getDate()}日`;
    if (!new RegExp(`^===\\s*${date}\\s*===`, 'm').test(text)) block = `=== ${date} ===\n` + block;
    return text + '\n' + block;
}

/**
 * 從最新本文重新定位未變更的提名，再產生單筆編輯內容。
 */
function prepareEdit(text, draft) {
    const nomination = draft.nominations[0];
    const reason = generateReason(nomination.ruleStatus);
    if (!nomination.awarder.trim() || !nomination.pageName.trim() || !reason) throw new Error('請填寫得分者、條目及規則。');
    return updateEntries(text, [{entry: findUnchangedEntry(text, nomination.source), changes: {
        '條目名稱': nomination.pageName.trim(), '用戶名稱': nomination.awarder.trim(),
        '提名理由': '{{ACG提名2/request|ver=1|' + reason + '}}',
    }}]);
}

/**
 * 建立提交快照與分步操作，並在任何寫入前驗證所需頁面與積分調整。
 * 此函式只讀取及準備資料；呼叫端須先持久保存 operation 才能開始送出。
 */
async function prepareOperation(draft, io) {
    const operation = {id: newId(), mode: draft.mode, submitted: JSON.parse(JSON.stringify({nominations: draft.nominations, message: draft.message})), steps: []};
    const [registry, scoreboard] = await Promise.all([io.read(REGISTER), draft.mode === 'check' ? io.read(SCORES) : null]);
    let text;
    if (draft.mode === 'new') text = prepareNew(registry.text, draft);
    else if (draft.mode === 'edit') text = prepareEdit(registry.text, draft);
    else {
        const prepared = prepareChecks(registry.text, draft.nominations, operation.id);
        text = prepared.text;
        operation.results = prepared.results;
        prepareScoreText(scoreboard.text, prepared.results, operation.id);
    }
    operation.steps.push({key: 'registry', title: REGISTER, status: 'pending',
        attempt: makeAttempt(REGISTER, registry, text + '\n' + registryMarker(operation.id), operation.id, '[[User:SuperGrey/gadgets/ACGATool|提名與核分]]')});
    if (scoreboard) operation.steps.push({key: 'scores', title: SCORES, status: 'pending'});
    return operation;
}

/**
 * 提交或恢復一份草稿，修改其 operation 以記錄每個頁面的進度。
 * 已成功的步驟跳過；saving／unknown 保留原請求交由 writeStep 查證。
 * @param {object} draft 目前草稿，含提名、說明及可選的未完成 operation。
 * @param {Function} persist 同步保存草稿的回呼；失敗必須拋出錯誤以阻止後續寫入。
 * @param {object} [io] read、write、findReceipt 介面；dry-run 測試注入記憶體實作。
 * @returns {Promise<boolean>} 全部完成為 true；需重試或查證為 false；前置驗證失敗會拋錯。
 */
export async function submitWorkspace(draft, persist, io = wikiTransport) {
    if (!draft.operation) {
        draft.operation = await prepareOperation(draft, io);
        persist();
    }
    const operation = draft.operation;
    for (const step of operation.steps) {
        if (step.status === 'succeeded') continue;
        // 確定尚未寫入的步驟才可依最新版本重建；結果未明時必須沿用原 attempt。
        if (!['saving', 'unknown'].includes(step.status)) {
            try {
                const current = await io.read(step.title);
                if (step.key === 'scores') {
                    const text = prepareScoreText(current.text, operation.results, operation.id);
                    if (text === current.text) { step.status = 'succeeded'; step.revid = current.revid; persist(); continue; }
                    step.attempt = makeAttempt(SCORES, current, text, operation.id, '[[User:SuperGrey/gadgets/ACGATool|積分調整]]');
                    step.attempt.marker = '"operation":' + JSON.stringify(operation.id);
                } else {
                    const submitted = operation.submitted;
                    let text;
                    if (operation.mode === 'new') text = prepareNew(current.text, submitted);
                    else if (operation.mode === 'edit') text = prepareEdit(current.text, submitted);
                    else text = prepareChecks(current.text, submitted.nominations, operation.id).text;
                    step.attempt = makeAttempt(REGISTER, current, text + '\n' + registryMarker(operation.id), operation.id, '[[User:SuperGrey/gadgets/ACGATool|提名與核分]]');
                }
            } catch (error) {
                step.status = 'failed'; step.error = error.message; persist(); return false;
            }
        }
        if (!await writeStep(step, persist, io)) return false;
    }
    return true;
}
