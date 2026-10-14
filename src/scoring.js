/**
 * 核對結果與已入帳結果分開處理。
 * 提名 id 跨覆核沿用；operation 識別一次批次提交，供收據查證與重試去重。
 */
import {parseUserReason} from './api.js';
import {generateReason} from './rules.js';

export const newId = () => crypto.randomUUID();
export const stripComments = text => text.replace(/<!--[\s\S]*?-->/g, '').trim();

/**
 * 讀取核對欄中的編碼記錄；before 保存該次提交前的入帳基準。
 * 登記處已寫入、積分榜尚未寫入時，這份基準可供恢復使用。
 * @returns {object|null} 含 id、before、operation 的記錄；沒有標記時為 null。
 */
export function readRecord(text) {
    const match = text.match(/<!--ACGATool:([^>]+)-->/);
    if (!match) return null;
    const record = JSON.parse(decodeURIComponent(match[1]));
    if (!record.id || !record.before || !Number.isFinite(record.before.score)) throw new Error('入帳記錄格式不完整。');
    return record;
}

/**
 * 解析唯一仍有效的核分模板，忽略已撤銷的歷史結果。
 * 保留同意與否決的規則、自訂分數及覆核狀態，不據此推定是否已入帳。
 * @returns {object|null} 含 score、ruleStatus、invalid、status 及原模板位置；未核對為 null。
 * @throws {Error} 規則版本、內容或多個有效結果無法安全解讀。
 */
export function parseCheck(text) {
    const active = [];
    for (const match of text.matchAll(/{{\s*ACG提名2\/check\s*\|([^{}]*)}}/g)) {
        const args = {};
        for (const part of match[1].split('|')) {
            const equal = part.indexOf('=');
            if (equal < 0) args['1'] = part.trim();
            else args[part.slice(0, equal).trim()] = part.slice(equal + 1).trim();
        }
        if (args.status === 'rescinded') continue;
        if (args.ver !== '1') throw new Error('此核對結果的規則版本暫不支援。');
        if (!args['1'] && !args.no) continue;
        const invalid = args['1'] === '0';
        const yes = parseUserReason(invalid ? '' : (args['1'] || ''));
        const no = parseUserReason(args.no || '');
        if (!yes || !no) throw new Error('無法完整讀取原核對結果，請手動覆核。');
        for (const value of Object.values(no)) value.selected = false;
        const ruleStatus = {...no, ...yes};
        active.push({score: invalid ? 0 : generateReason(ruleStatus, true).reasonScore,
            invalid, ruleStatus, status: args.status || 'done', start: match.index, end: match.index + match[0].length, raw: match[0]});
    }
    if (active.length > 1) throw new Error('存在多個未撤銷的核對結果，請先確認有效的結果。');
    if (!active.length && stripComments(text).replace(/{{\s*ACG提名2\/check\s*\|[^{}]*}}/g, '').trim()) {
        throw new Error('原核對內容不是可辨識的核分模板，請手動覆核。');
    }
    return active[0] || null;
}

/**
 * 讀取積分榜註解中的入帳收據。
 * operations 用來判定整批是否已寫入；entries 依註解順序保留每筆提名最後的入帳結果。
 * @returns {{operations: Map, entries: Map}} 提交識別與提名識別的兩組索引。
 */
export function scoreReceipts(text) {
    const operations = new Map(), entries = new Map();
    for (const line of text.split('\n')) {
        if (!line.startsWith('-- ACGATool ')) continue;
        const receipt = JSON.parse(line.slice('-- ACGATool '.length));
        if (!receipt.operation || !Array.isArray(receipt.entries)) throw new Error('積分榜入帳記錄格式錯誤。');
        operations.set(receipt.operation, receipt);
        for (const entry of receipt.entries) {
            if (!entry.id || !entry.awarder || !Number.isFinite(entry.score) || entry.score < 0) throw new Error('積分榜入帳記錄格式錯誤。');
            entries.set(entry.id, entry);
        }
    }
    return {operations, entries};
}

/**
 * 將來源提名、原核對結果與積分榜收據組成覆核草稿。
 * 入帳基準優先採積分榜收據，其次採登記處記錄的 before；舊的正分核分若兩者皆無，
 * 標為 unknown，要求使用者確認，避免把「已核分」直接當成「已入帳」。
 */
export function reviewData(data, source, scoreText) {
    const original = parseCheck(source.values['核對用']);
    const record = readRecord(source.values['核對用']);
    const id = record?.id || newId();
    const receipt = scoreReceipts(scoreText).entries.get(id);
    const baseline = receipt ? {awarder: receipt.awarder, score: receipt.score} : record?.before;
    return {...data, source, id, original, baseline,
        booking: baseline ? 'recorded' : original?.score > 0 ? 'unknown' : 'unbooked',
        ruleStatus: original ? original.ruleStatus : data.ruleStatus,
        invalid: original?.invalid || false, message: '', reviewed: false};
}

/**
 * 取得要扣回的得分者與分數；沒有可追查基準時，只接受使用者明確選定的入帳狀態。
 */
export function previousBooking(nomination) {
    if (nomination.baseline) return nomination.baseline;
    if (nomination.booking === 'unknown') throw new Error('請確認原核分是否已登記至積分榜。');
    return {awarder: stripComments(nomination.source.values['用戶名稱']),
        score: nomination.booking === 'booked' ? nomination.original.score : 0};
}

/**
 * 按得分者彙總「扣回舊入帳、加入新核分」的差額。
 * 相同得分者只增減差值；更正得分者時，分別扣回舊帳號並計入新帳號。
 */
export function scoreDeltas(results) {
    const deltas = new Map();
    const add = (user, score) => deltas.set(user, (deltas.get(user) || 0) + score);
    for (const result of results) {
        add(result.before.awarder, -result.before.score);
        add(result.awarder, result.score);
    }
    return deltas;
}

/**
 * 保留先前核分與簽名，將舊結果標為 rescinded，再追加本次核分與入帳基準。
 * 回傳值供登記處使用；積分是否完成仍由積分榜收據判定。
 */
export function checkWikitext(nomination, reason, operation) {
    const before = previousBooking(nomination);
    const body = nomination.invalid ? '0' : reason.reasonText + (reason.unselectedReasonText ? '|no=' + reason.unselectedReasonText : '');
    let history = nomination.source.values['核對用'].replace(/<!--ACGATool:[^>]+-->/g, '').trim();
    if (nomination.original) {
        const old = nomination.original.raw;
        const rescinded = old.replace(/\|\s*status\s*=[^|}]*/g, '').replace(/}}$/, '|status=rescinded}}');
        history = history.replace(old, rescinded) + '<br />';
    } else history = '';
    // 額外編碼連字號，避免記錄文字形成 HTML 註解中的 -- 或提前結束註解。
    const metadata = encodeURIComponent(JSON.stringify({id: nomination.id, before, operation})).replace(/-/g, '%2D');
    return `${history}{{ACG提名2/check|ver=1|${body}}}${nomination.message}--~~~~<!--ACGATool:${metadata}-->`;
}

const quoteLua = value => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

/**
 * 套用差額並在同一份 Lua 本文追加收據；保留其他用戶、註解與原有排版。
 * 同一 operation 已入帳且內容相同時原樣返回；內容不同或 Lua 格式不支援時停止，
 * 避免重複加分或因重新輸出模組而丟失無法解析的資料。此函式不執行 Lua，也不寫入頁面。
 * @param {string} text 最新積分榜原始碼。
 * @param {object[]} results 每筆含 id、awarder、score 及 before。
 * @param {string} operation 本批提交識別。
 * @returns {string} 待儲存的積分榜本文。
 */
export function prepareScoreText(text, results, operation) {
    const receipts = scoreReceipts(text);
    const entries = results.map(({id, awarder, score}) => ({id, awarder, score}));
    if (receipts.operations.has(operation)) {
        if (JSON.stringify(receipts.operations.get(operation).entries) !== JSON.stringify(entries)) throw new Error('提交識別與入帳內容不符。');
        return text;
    }
    for (const result of results) {
        const existing = receipts.entries.get(result.id);
        if (existing && (existing.awarder !== result.before.awarder || existing.score !== result.before.score)) throw new Error('此提名的已入帳結果已變更，請重新覆核。');
    }
    const deltas = scoreDeltas(results);
    const seen = new Set();
    let opened = false, closed = false;
    const lines = text.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('--')) return line;
        if (trimmed === 'return {' && !opened) { opened = true; return line; }
        if (trimmed === '}' && opened && !closed) { closed = true; return line; }
        const match = line.match(/^(\s*\[(["'])((?:\\.|[^\\])*?)\2\]\s*=\s*)([+-]?\d+(?:\.\d+)?)(\s*,?\s*)$/);
        if (!opened || closed || !match) throw new Error('積分榜格式無法安全修改。');
        const user = match[3].replace(/\\([\\"'])/g, '$1');
        if (seen.has(user)) throw new Error('積分榜有重複用戶。');
        seen.add(user);
        const score = Number(match[4]) + (deltas.get(user) || 0);
        if (!Number.isFinite(score) || score < 0) throw new Error('調整後總分不合理，請確認原分數是否已入帳。');
        return deltas.has(user) ? match[1] + score + match[5] : line;
    });
    if (!opened || !closed) throw new Error('積分榜格式無法安全修改。');
    const newLines = [];
    for (const [user, score] of deltas) {
        if (seen.has(user) || score === 0) continue;
        if (!Number.isFinite(score) || score < 0 || /[\r\n]/.test(user)) throw new Error('原得分者的積分無法扣回。');
        newLines.push(`    [${quoteLua(user)}] = ${score},`);
    }
    lines.splice(lines.findIndex(line => line.trim() === '}'), 0, ...newLines);
    return lines.join('\n').trimEnd() + '\n-- ACGATool ' + JSON.stringify({operation, entries}) + '\n';
}
