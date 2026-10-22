import {t} from '../i18n.js';
/**
 * 編排登記處與積分榜的兩次獨立編輯。
 * draft 是唯一的提交內容快照；operation 只保留入帳差額及各步驟狀態。
 */
import {updateEntries, entryValues, getDateSections} from './api.js';
import {ReviewConflict, validateNominations} from '../nomination/conflicts.js';
import {entryOwnership, assertCanCheck} from '../nomination/ownership.js';
import {wikiTransport, writeStep} from './transport.js';
import {generateReason} from '../nomination/rules.js';
import {operationStatus, hasChanges} from '../nomination/operations.js';
import {newId, parseCheck, previousBooking, checkWikitext, prepareScoreText, stripComments} from '../nomination/scoring.js';
import {submissionSummary} from './edit-summary.js';

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

/** 以已驗證的來源產生單筆修改與入帳資料，不重查修改中的本文。 */
function checkUpdate(text, entry, nomination) {
    if (!nomination.reviewed) throw new Error(t('請先逐筆完成核對。', '请先逐项完成核对。'));
    assertCanCheck(entryOwnership(text, entry), mw.config.get('wgUserName'));
    const reason = generateReason(nomination.ruleStatus, true);
    if (!reason) throw new Error(t('請檢查規則分數。', '请检查规则分数。'));
    const score = nomination.invalid ? 0 : reason.reasonScore;
    nomination.id ||= newId();
    if (!nomination.awarder.trim()) throw new Error(t('請填寫得分者。', '请填写得分者。'));
    const changes = {'用戶名稱': nomination.awarder.trim(), '核對用': checkWikitext(nomination, reason)};
    // 只在更正名稱時改寫條目欄；一般核分保留原欄位的註解與格式。
    if (nomination.pageName.trim() !== stripComments(entryValues(entry)['條目名稱'])) changes['條目名稱'] = nomination.pageName.trim();
    return {
        result: {id: nomination.id, source: {date: entry.date, index: entry.index}, awarder: nomination.awarder.trim(), score, before: previousBooking(nomination)},
        update: {entry, changes},
    };
}

/** 以目前頁面版本組成這次編輯請求，交由 MediaWiki 檢查編輯衝突。 */
function editRequest(title, snapshot, text, summary) {
    return {title, text, summary,
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
function editUpdate(entry, nomination) {
    const reason = generateReason(nomination.ruleStatus);
    if (!nomination.awarder.trim() || !nomination.pageName.trim() || !reason) throw new Error(t('請填寫得分者、條目及規則。', '请填写得分者、条目及规则。'));
    if (parseCheck(nomination.source.values['核對用'])) throw new Error(t('此提名已有核分，請使用覆核／更正得分。', '此提名已有核分，请使用复核／更正得分。'));
    return {entry, changes: {
        '條目名稱': nomination.pageName.trim(), '用戶名稱': nomination.awarder.trim(),
        '提名理由': '{{ACG提名2/request|ver=1|' + reason + '}}',
    }};
}

/**
 * 混合操作共用同一份登記處版本；所有來源先驗證，新提名最後追加，不執行寫入。
 * results 的 before 是先前實際入帳的基準，供積分榜計算差額。
 */
export function prepareMixed(text, draft) {
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
    // 每筆的定位與所有替換位置都來自同一份原文，避免前一筆改名後誤判後一筆衝突。
    const updates = [], results = [];
    existing.forEach((item, index) => {
        if (item.mode === 'edit') updates.push(editUpdate(entries[index], item.nomination));
        else {
            const prepared = checkUpdate(text, entries[index], item.nomination);
            updates.push(prepared.update); results.push(prepared.result);
        }
    });
    text = updateEntries(text, updates);
    const added = items.filter(item => item.mode === 'new').map(item => item.nomination);
    return {text: added.length ? prepareNew(text, {nominations: added, message: draft.message}) : text, results};
}

/**
 * 從最新頁面準備登記處編輯，並在寫入前驗證積分調整。
 * 初次提交及登記處重試共用；準備出的本文直接用於該次編輯請求。
 */
async function prepareRegistry(draft, io) {
    const checking = draft.items.some(item => item.mode === 'check');
    const [registry, scoreboard] = await Promise.all([io.read(REGISTER), checking ? io.read(SCORES) : null]);
    const prepared = prepareMixed(registry.text, draft);
    if (scoreboard) prepareScoreText(scoreboard.text, prepared.results);
    return {...prepared, snapshot: registry};
}

/**
 * 提交草稿並保存各頁面的進度；重試只執行指定步驟，已成功的步驟跳過。
 * io 提供 read、write，dry-run 測試注入記憶體實作。
 */
export async function submitWorkspace(draft, persist, io = wikiTransport, stepKey = null) {
    if (draft.conflicts?.length) throw new ReviewConflict(draft.conflicts);
    if (stepKey && !draft.operation) throw new Error(t('沒有可重試的儲存步驟。', '没有可重试的保存步骤。'));
    let preparedRegistry;
    if (!draft.operation) {
        try { preparedRegistry = await prepareRegistry(draft, io); }
        catch (error) {
            if (error instanceof ReviewConflict) { draft.conflicts = error.changes; await persist(); }
            throw error;
        }
        const steps = [{key: 'registry', title: REGISTER, status: 'pending'}];
        if (preparedRegistry.results.length) steps.push({key: 'scores', title: SCORES, status: 'pending'});
        draft.operation = {results: preparedRegistry.results, steps};
        await persist();
    }
    const operation = draft.operation;
    const selected = stepKey ? operation.steps.filter(step => step.key === stepKey) : operation.steps;
    if (!selected.length) throw new Error(t('找不到指定的儲存步驟。', '找不到指定的保存步骤。'));
    for (const step of selected) {
        const index = operation.steps.indexOf(step);
        if (operation.steps.slice(0, index).some(previous => previous.status !== 'succeeded')) throw new Error(t('請先完成前一個儲存步驟。', '请先完成前一个保存步骤。'));
        if (step.status === 'succeeded') continue;
        let edit;
        try {
            if (step.key === 'scores') {
                // 積分榜寫入前讀取最新總分，保留登記處儲存期間的其他加減分。
                const current = await io.read(SCORES);
                const text = prepareScoreText(current.text, operation.results);
                if (text === current.text) { step.status = 'succeeded'; step.revid = current.revid; await persist(); continue; }
                edit = editRequest(SCORES, current, text, submissionSummary(draft, true));
            } else {
                // 首次沿用本輪準備結果；重試則重新讀取及比對來源，不保存本文副本。
                const prepared = preparedRegistry || await prepareRegistry(draft, io);
                operation.results = prepared.results;
                edit = editRequest(REGISTER, prepared.snapshot, prepared.text, submissionSummary(draft));
            }
        } catch (error) {
            step.status = error instanceof ReviewConflict ? 'conflict' : 'failed';
            if (error instanceof ReviewConflict) draft.conflicts = error.changes;
            step.error = error.message; await persist(); return false;
        }
        if (!await writeStep(step, edit, persist, io)) return false;
    }
    return operation.steps.every(step => step.status === 'succeeded');
}
