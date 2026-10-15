import {t} from '../i18n.js';
/**
 * 編排登記處與積分榜的兩次獨立編輯。
 * operation 保留提交快照、入帳差額及各步驟狀態；部分完成時從未完成步驟恢復。
 */
import {updateEntries, entryValues, listEntries, getDateSections} from './api.js';
import {ReviewConflict, validateNominations, validateAccounting} from '../nomination/conflicts.js';
import {entryOwnership, assertCanCheck} from '../nomination/ownership.js';
import {wikiTransport, writeStep} from './transport.js';
import {generateReason} from '../nomination/rules.js';
import {operationStatus, hasChanges} from '../nomination/operations.js';
import {newId, readRecord, parseCheck, previousBooking, checkWikitext, prepareScoreText, scoreDeltas} from '../nomination/scoring.js';

export const REGISTER = 'WikiProject:ACG/維基ACG專題獎/登記處';
export const SCORES = 'Module:ACGaward/list';

/**
 * 新提名的預覽與儲存共用日期判斷，依 UTC 與維基簽名保持一致。
 * 登記處按日期排列；當天小節存在時，頁尾的新提名直接接續該節。
 * @param {string[]} dates 登記處已有的日期標題。
 * @param {Date} [now] 當前時間；測試可注入固定時刻。
 */
export function getNewNominationPlacement(dates, now = new Date()) {
    const date = `${now.getUTCMonth() + 1}月${now.getUTCDate()}日`;
    return {date, newSection: !dates.includes(date)};
}

/**
 * 整批驗證後產生登記處修改與差額入帳資料，不執行寫入。
 * 每筆 result.before 是先前實際入帳的基準，不一定等於登記處顯示的核分。
 * @param {string} text 最新登記處本文。
 * @param {object[]} nominations 已逐筆核對、含來源快照與入帳基準的項目。
 * @param {string} [operation] 整批提交識別，重試時沿用。
 * @returns {object} text、results、按得分者彙總的差額 scores 及 operation。
 */
export function prepareChecks(text, nominations, operation = newId()) {
    if (!nominations.length || nominations.some(n => !n.reviewed)) throw new Error(t('請先逐筆完成核對。', '请先逐项完成核对。'));
    const results = [];
    const entries = validateNominations(text, nominations);
    const updates = nominations.map((nomination, index) => {
        const entry = entries[index];
        assertCanCheck(entryOwnership(text, entry), mw.config.get('wgUserName'), nomination.awarder);
        const reason = generateReason(nomination.ruleStatus, true);
        if (!reason) throw new Error(t('請檢查規則分數。', '请检查规则分数。'));
        const score = nomination.invalid ? 0 : reason.reasonScore;
        nomination.id ||= newId();
        if (!nomination.awarder.trim()) throw new Error(t('請填寫得分者。', '请填写得分者。'));
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

export function prepareNew(text, draft) {
    if (!draft.nominations.length) throw new Error(t('請至少填寫一筆提名。', '请至少填写一项提名。'));
    let block = '{{ACG提名2';
    draft.nominations.forEach((nomination, index) => {
        const reason = generateReason(nomination.ruleStatus);
        if (!nomination.awarder.trim() || !nomination.pageName.trim() || !reason) throw new Error(t('請填寫得分者、條目及規則。', '请填写得分者、条目及规则。'));
        block += `\n|條目名稱${index + 1} = ${nomination.pageName.trim()}\n|用戶名稱${index + 1} = ${nomination.awarder.trim()}\n|提名理由${index + 1} = {{ACG提名2/request|ver=1|${reason}}}\n|核對用${index + 1} = {{ACG提名2/check|ver=1|}}`;
    });
    block += "\n}}\n'''提名人：'''~~~~";
    if (draft.message) block += '\n: {{說明}}：' + draft.message + '--~~~~';
    const {date, newSection} = getNewNominationPlacement(getDateSections(text).map(section => section.date));
    if (newSection) block = `=== ${date} ===\n` + block;
    return text + '\n' + block;
}

/**
 * 修改尚未核分的提名；已有核分的項目必須走覆核流程以同步處理積分。
 */
function prepareEdit(text, draft) {
    const nomination = draft.nominations[0];
    const reason = generateReason(nomination.ruleStatus);
    if (!nomination.awarder.trim() || !nomination.pageName.trim() || !reason) throw new Error(t('請填寫得分者、條目及規則。', '请填写得分者、条目及规则。'));
    if (parseCheck(nomination.source.values['核對用'])) throw new Error(t('此提名已有核分，請使用覆核／更正得分。', '此提名已有核分，请使用复核／更正得分。'));
    return updateEntries(text, [{entry: validateNominations(text, [nomination])[0], changes: {
        '條目名稱': nomination.pageName.trim(), '用戶名稱': nomination.awarder.trim(),
        '提名理由': '{{ACG提名2/request|ver=1|' + reason + '}}',
    }}]);
}

/** 混合操作共用同一份登記處版本；所有來源先驗證，新提名最後追加。 */
export function prepareMixed(text, draft, operation) {
    const items = draft.items.filter(hasChanges);
    if (!items.length) throw new Error(t('沒有待提交的操作。', '没有待提交的操作。'));
    for (const item of items) {
        const status = operationStatus(item);
        if (!status.ready) throw new Error(`${item.nomination.pageName || t('未填條目', '未填条目')}：${status.errors[0].message}`);
    }
    const existing = items.filter(item => item.mode !== 'new');
    const entries = validateNominations(text, existing.map(item => item.nomination));
    const identities = entries.map(entry => `${entry.date}:${entry.index}`);
    if (new Set(identities).size !== identities.length) throw new Error(t('同一筆提名不能在同一批重複提交。', '同一项提名不能在同一批重复提交。'));
    for (const item of items.filter(item => item.mode === 'edit')) text = prepareEdit(text, {nominations: [item.nomination]});
    const checks = items.filter(item => item.mode === 'check').map(item => item.nomination);
    const checked = checks.length ? prepareChecks(text, checks, operation) : {text, results: []};
    const added = items.filter(item => item.mode === 'new').map(item => item.nomination);
    return {text: added.length ? prepareNew(checked.text, {nominations: added, message: draft.message}) : checked.text, results: checked.results};
}

/**
 * 建立提交快照與分步操作，並在任何寫入前驗證所需頁面與積分調整。
 * 此函式只讀取及準備資料；呼叫端須先持久保存 operation 才能開始送出。
 */
async function prepareOperation(draft, io) {
    const operation = {id: newId(), mode: draft.mode, submitted: JSON.parse(JSON.stringify({nominations: draft.nominations, items: draft.items, message: draft.message, summary: draft.summary})), steps: []};
    const checking = draft.mode === 'check' || draft.items?.some(item => item.mode === 'check');
    const [registry, scoreboard] = await Promise.all([io.read(REGISTER), checking ? io.read(SCORES) : null]);
    let text;
    if (draft.mode === 'mixed') {
        const prepared = prepareMixed(registry.text, draft, operation.id);
        text = prepared.text;
        operation.results = prepared.results;
        if (scoreboard) {
            validateAccounting(scoreboard.text, prepared.results, operation.id);
            prepareScoreText(scoreboard.text, prepared.results, operation.id);
        }
    } else if (draft.mode === 'new') text = prepareNew(registry.text, draft);
    else if (draft.mode === 'edit') text = prepareEdit(registry.text, draft);
    else {
        const prepared = prepareChecks(registry.text, draft.nominations, operation.id);
        text = prepared.text;
        operation.results = prepared.results;
        validateAccounting(scoreboard.text, prepared.results, operation.id);
        prepareScoreText(scoreboard.text, prepared.results, operation.id);
    }
    operation.steps.push({key: 'registry', title: REGISTER, status: 'pending',
        attempt: makeAttempt(REGISTER, registry, text + '\n' + registryMarker(operation.id), operation.id, draft.summary || '[[User:SuperGrey/gadgets/ACGATool|' + t('提名與核分', '提名与核分') + ']]')});
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
export async function submitWorkspace(draft, persist, io = wikiTransport, action = null) {
    if (draft.conflicts?.length) throw new ReviewConflict(draft.conflicts);
    if (action && !draft.operation) throw new Error(t('沒有可查詢或重試的儲存步驟。', '没有可查询或重试的保存步骤。'));
    if (!draft.operation) {
        try { draft.operation = await prepareOperation(draft, io); }
        catch (error) {
            if (error instanceof ReviewConflict) { draft.conflicts = error.changes; await persist(); }
            throw error;
        }
        await persist();
    }
    const operation = draft.operation;
    const selected = action ? operation.steps.filter(step => step.key === action.stepKey) : operation.steps;
    if (!selected.length) throw new Error(t('找不到指定的儲存步驟。', '找不到指定的保存步骤。'));
    for (const step of selected) {
        const index = operation.steps.indexOf(step);
        if (operation.steps.slice(0, index).some(previous => previous.status !== 'succeeded')) throw new Error(t('請先完成前一個儲存步驟。', '请先完成前一个保存步骤。'));
        if (action?.kind === 'query' && !['unknown', 'saving', 'succeeded'].includes(step.status)) throw new Error(t('此步驟沒有結果未明的請求。', '此步骤没有结果未明的请求。'));
        if (action?.kind === 'retry' && ['unknown', 'saving'].includes(step.status)) throw new Error(t('請先查詢上次儲存結果。', '请先查询上次保存结果。'));
        if (step.status === 'succeeded') continue;
        // 確定尚未寫入的步驟才可依最新版本重建；結果未明時必須沿用原 attempt。
        if (!['saving', 'unknown'].includes(step.status)) {
            try {
                const current = await io.read(step.title);
                if (step.key === 'scores') {
                    // 兩頁不能原子提交；入帳前再次檢查登記處仍是本次已發布的核分內容。
                    const registered = await io.read(REGISTER);
                    validateNominations(registered.text, operation.expectedNominations);
                    validateAccounting(current.text, operation.results, operation.id);
                    const text = prepareScoreText(current.text, operation.results, operation.id);
                    if (text === current.text) { step.status = 'succeeded'; step.revid = current.revid; await persist(); continue; }
                    step.attempt = makeAttempt(SCORES, current, text, operation.id, operation.submitted.summary || '[[User:SuperGrey/gadgets/ACGATool|' + t('積分調整', '积分调整') + ']]');
                    step.attempt.marker = '"operation":' + JSON.stringify(operation.id);
                } else {
                    const submitted = operation.submitted;
                    let text;
                    if (operation.mode === 'mixed') text = prepareMixed(current.text, submitted, operation.id).text;
                    else if (operation.mode === 'new') text = prepareNew(current.text, submitted);
                    else if (operation.mode === 'edit') text = prepareEdit(current.text, submitted);
                    else text = prepareChecks(current.text, submitted.nominations, operation.id).text;
                    if (operation.results?.length) {
                        validateAccounting((await io.read(SCORES)).text, operation.results, operation.id);
                        // 第一步成功後，用發布後的快照檢查第二步；不能再拿發布前的核分作比較。
                        operation.expectedNominations = operation.results.map(result => {
                            const entry = listEntries(text).find(entry => readRecord(entryValues(entry)['核對用'])?.id === result.id);
                            return {id: result.id, pageName: entryValues(entry)['條目名稱'], source: {
                                date: entry.date, index: entry.index, values: entryValues(entry), ownership: entryOwnership(text, entry),
                            }};
                        });
                    }
                    step.attempt = makeAttempt(REGISTER, current, text + '\n' + registryMarker(operation.id), operation.id, submitted.summary || '[[User:SuperGrey/gadgets/ACGATool|' + t('提名與核分', '提名与核分') + ']]');
                }
            } catch (error) {
                step.status = error instanceof ReviewConflict ? 'conflict' : 'failed';
                if (error instanceof ReviewConflict) draft.conflicts = error.changes;
                step.error = error.message; await persist(); return false;
            }
        }
        if (!await writeStep(step, persist, io)) return false;
    }
    return operation.steps.every(step => step.status === 'succeeded');
}
