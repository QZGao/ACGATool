import {t} from '../i18n.js';
/**
 * 解析核對結果、保留覆核歷史並計算積分差額。
 * 提名及提交識別只保存在本機。
 */
import {findTemplateEnd, parseUserReason, splitWikitext} from '../wiki/api.js';
import {generateReason} from './rules.js';

export const newId = () => crypto.randomUUID();
export const stripComments = text => text.replace(/<!--[\s\S]*?-->/g, '').trim();

/** 取得核對模板的外層參數；內層模板的管線與等號保留在參數值中。 */
function checkTemplates(text) {
    const visible = text.replace(/<!--[\s\S]*?-->/g, comment => ' '.repeat(comment.length));
    const pattern = /{{\s*ACG提名2\/check\s*(?=[|}])/g;
    const templates = [];
    let match;
    while ((match = pattern.exec(visible))) {
        const {endIndex: end} = findTemplateEnd(text, match.index);
        const raw = text.slice(match.index, end), parts = splitWikitext(raw.slice(2, -2), '|');
        const args = {};
        let positional = 1;
        for (const part of parts.slice(1)) {
            const [key, ...value] = splitWikitext(part, '=');
            if (!value.length) args[positional++] = part.trim();
            else args[stripComments(key)] = value.join('=').trim();
        }
        templates.push({args, raw, start: match.index, end});
        pattern.lastIndex = end;
    }
    return templates;
}

/**
 * 解析唯一仍有效的核分模板，忽略已撤銷的歷史結果。
 * 保留同意與否決的規則、自訂分數及覆核狀態。
 * @returns {object|null} 含 score、ruleStatus、invalid、status 及原模板位置；未核對為 null。
 * @throws {Error} 規則內容無法讀取，或存在多個未撤銷的有效結果。
 */
export function parseCheck(text) {
    const active = [];
    for (const {args, raw, start, end} of checkTemplates(text)) {
        if (args.status === 'rescinded') continue;
        if (!args['1'] && !args.no) continue;
        const invalid = args['1'] === '0';
        const yes = parseUserReason(invalid ? '' : (args['1'] || ''));
        const no = parseUserReason(args.no || '');
        if (!yes || !no) throw new Error(t('無法完整讀取原核對結果，請手動覆核。', '无法完整读取原核对结果，请手动复核。'));
        for (const value of Object.values(no)) value.selected = false;
        const ruleStatus = {...no, ...yes};
        active.push({score: invalid ? 0 : generateReason(ruleStatus, true).reasonScore,
            invalid, ruleStatus, status: args.status || 'done', start, end, raw});
    }
    if (active.length > 1) throw new Error(t('存在多個未撤銷的核對結果，請先確認有效的結果。', '存在多个未撤销的核对结果，请先确认有效的结果。'));
    return active[0] || null;
}

/**
 * 將來源提名與原核對結果組成覆核草稿。
 * 既有核分就是覆核的原分數，不另設入帳狀態。
 */
export function reviewData(data, source) {
    const original = parseCheck(source.values['核對用']);
    return {...data, source, id: newId(), original,
        ruleStatus: original ? {...Object.fromEntries(Object.entries(data.ruleStatus || {}).map(([key, value]) => [key, {...value, selected: false}])), ...original.ruleStatus} : data.ruleStatus,
        invalid: original?.invalid || false, message: '', reviewed: false};
}

/**
 * 以原核對結果取得要扣回的得分者與分數。
 */
export function previousBooking(nomination) {
    return {awarder: stripComments(nomination.source.values['用戶名稱']),
        score: nomination.original?.score || 0};
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
 * 保留先前核分與簽名，將舊結果標為 rescinded，再追加本次核分與簽名。
 */
export function checkWikitext(nomination, reason) {
    const body = nomination.invalid || !reason.reasonText ? '0' : reason.reasonText + (reason.unselectedReasonText ? '|no=' + reason.unselectedReasonText : '');
    let history = nomination.source.values['核對用'];
    if (nomination.original) {
        const {raw, start, end} = nomination.original;
        const parts = splitWikitext(raw.slice(2, -2), '|').filter((part, index) =>
            !index || stripComments(splitWikitext(part, '=')[0]) !== 'status');
        const rescinded = '{{' + parts.join('|') + '|status=rescinded}}';
        history = history.slice(0, start) + rescinded + history.slice(end);
    } else {
        // 移除空的待核對佔位模板；周圍的文字、其他模板及歷史記錄照原樣保留。
        for (const template of checkTemplates(history).reverse()) {
            if (!template.args['1'] && !template.args.no) history = history.slice(0, template.start) + history.slice(template.end);
        }
    }
    history = history.trim();
    if (history) history += '<br />';
    return `${history}{{ACG提名2/check|ver=1|${body}}}${nomination.message}--~~~~`;
}

const quoteLua = value => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

/** 解析分數中的數字運算式；字元只作數字與運算子處理，不執行 Lua 程式。 */
function readScore(expression) {
    const tokens = [], pattern = /\s*(0[xX][\da-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[()+\-*/%^])/gy;
    let offset = 0;
    while (offset < expression.length) {
        pattern.lastIndex = offset;
        const match = pattern.exec(expression);
        if (!match) return NaN;
        tokens.push(match[1]); offset = pattern.lastIndex;
    }
    let index = 0;
    const precedence = {'+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 4};
    const parse = (minimum = 0) => {
        const token = tokens[index++];
        let value;
        if (token === '+' || token === '-') value = (token === '-' ? -1 : 1) * parse(3);
        else if (token === '(') {
            value = parse();
            if (tokens[index++] !== ')') return NaN;
        } else value = Number(token);
        while ((precedence[tokens[index]] || 0) >= Math.max(minimum, 1)) {
            const operator = tokens[index++], priority = precedence[operator];
            const right = parse(priority + (operator === '^' ? 0 : 1));
            if (operator === '+') value += right;
            else if (operator === '-') value -= right;
            else if (operator === '*') value *= right;
            else if (operator === '/') value /= right;
            else if (operator === '%') value -= Math.floor(value / right) * right;
            else value **= right;
        }
        return value;
    };
    const value = parse();
    return index === tokens.length ? value : NaN;
}

/**
 * 用等長空白遮住 Lua 註解，保留原始位置；字串中的 -- 不當成註解。
 * 每筆分數在解析時驗證為有限數字，後續只更新需要調整的數值片段。
 */
function parseScoreList(text) {
    const visible = text.replace(/("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')|--\[(=*)\[[\s\S]*?\]\2\]|--[^\r\n]*/g,
        (part, quoted) => quoted || part.replace(/[^\r\n]/g, ' '));
    const table = /\{([\s\S]*)\}/.exec(visible);
    if (!table) throw new Error(t('找不到積分榜資料表。', '找不到积分榜数据表。'));
    const start = table.index + table[0].indexOf('{') + 1, body = table[1];
    const entries = new Map();
    const pattern = /(?:\[\s*(["'])((?:\\[\s\S]|(?!\1)[^\\])*)\1\s*\]|([A-Za-z_]\w*))\s*=\s*([^,;{}]+)/g;
    for (const match of body.matchAll(pattern)) {
        const user = match[3] || match[2].replace(/\\([\\"'])/g, '$1');
        const value = match[4].trim(), score = readScore(value);
        if (!Number.isFinite(score)) throw new Error(t(`積分榜中「${user}」的分數不是有限數字。`, `积分榜中「${user}」的分数不是有限数字。`));
        const valueStart = start + match.index + match[0].length - match[4].trimStart().length;
        entries.set(user, {score, start: valueStart, end: valueStart + value.length});
    }
    return {entries, end: start + body.length, separator: body.trimEnd() && !/[,;]$/.test(body.trimEnd()) ? ',' : ''};
}

/**
 * 先讀取積分榜與確認原得分者，再套用差額。保留其他用戶、註解及原有排版。
 * 新得分者不存在時新增帳號；原核分非零時，原得分者必須已在榜中。
 * @param {string} text 最新積分榜原始碼。
 * @param {object[]} results 每筆含 awarder、score 及 before。
 * @returns {string} 待儲存的積分榜本文。
 */
export function prepareScoreText(text, results) {
    const {entries, end, separator} = parseScoreList(text);
    for (const {before, score} of results) {
        if (!Number.isFinite(before.score) || !Number.isFinite(score)) throw new Error(t('增減分數必須是有限數字。', '增减分数必须是有限数字。'));
        if (before.score !== 0 && !entries.has(before.awarder)) throw new Error(t(`積分榜找不到原得分者「${before.awarder}」。`, `积分榜找不到原得分者「${before.awarder}」。`));
    }
    const changes = [], added = [];
    for (const [user, delta] of scoreDeltas(results)) {
        if (delta === 0) continue;
        const entry = entries.get(user);
        if (entry) {
            // 運算式內的註解也保留；行尾註解加換行，避免吃掉原本後接的分隔符。
            const comments = text.slice(entry.start, entry.end).match(/--\[(=*)\[[\s\S]*?\]\1\]|--[^\r\n]*/g) || [];
            const replacement = String(entry.score + delta) + comments.map(comment => ' ' + comment + '\n').join('');
            changes.push({...entry, replacement});
        } else added.push(`    [${quoteLua(user)}] = ${delta},`);
    }
    if (added.length) changes.push({start: end, end, replacement: separator + '\n' + added.join('\n') + '\n'});
    // 從尾端替換，讓前面欄位的位置維持解析時的索引。
    for (const change of changes.sort((a, b) => b.start - a.start)) {
        text = text.slice(0, change.start) + change.replacement + text.slice(change.end);
    }
    return text;
}
