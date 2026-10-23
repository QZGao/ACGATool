import {t} from '../i18n.js';
import {parseUserReason} from './api.js';
import {generateReason} from '../nomination/rules.js';
import {hasChanges, operationType} from '../nomination/operations.js';
import {previousBooking, scoreDeltas, stripComments} from '../nomination/scoring.js';

/** MediaWiki 的摘要上限為 500 個 Unicode 字元；先縮操作說明，不截斷使用者文字或工具連結。 */
export function formatEditSummary(description, summary = '', brief = description) {
    const custom = summary.trim();
    const suffix = (custom ? `：${custom}` : '') + ' ([[User:SuperGrey/gadgets/ACGATool|ACGATool]])';
    if ([...(description + suffix)].length <= 500) return description + suffix;
    if ([...(brief + suffix)].length <= 500) return brief + suffix;
    throw new Error(t('編輯摘要過長，請縮短自行填寫的摘要。', '编辑摘要过长，请缩短自行填写的摘要。'));
}

const article = title => {
    const name = stripComments(title);
    // 「他薦／他荐」是申報項目，摘要中直接顯示名稱。
    return /^他[薦荐]$/.test(name) ? name : `[[${name}]]`;
};

function describeNomination({mode, nomination: n}) {
    const title = article(n.pageName), awarder = n.awarder.trim();
    const before = n.source?.values;
    if (mode === 'new') {
        const rules = generateReason(n.ruleStatus);
        return t(`提名${title}（得分者：${awarder}；規則：${rules}）`, `提名${title}（得分者：${awarder}；规则：${rules}）`);
    }
    const previousAwarder = stripComments(before['用戶名稱']);
    const recipient = previousAwarder === awarder ? awarder : `${previousAwarder}→${awarder}`;
    if (mode === 'edit') {
        const changes = [];
        if (stripComments(before['條目名稱']) !== stripComments(n.pageName)) changes.push(t(`條目改為${title}`, `条目改为${title}`));
        if (previousAwarder !== awarder) changes.push(t(`得分者：${recipient}`));
        const originalRules = generateReason(parseUserReason(before['提名理由']));
        const rules = generateReason(n.ruleStatus);
        if (originalRules !== rules) changes.push(t(`規則：${originalRules}→${rules}`, `规则：${originalRules}→${rules}`));
        return t(`修改${article(before['條目名稱'])}提名`) +
            (changes.length ? `（${changes.join('；')}）` : '');
    }
    const result = generateReason(n.ruleStatus, true);
    const score = n.invalid ? 0 : result.reasonScore;
    const scoreChange = n.original && n.original.score !== score ? `${n.original.score}→${score}` : `${score}`;
    const details = [t(`得分者：${recipient}`), t(`得分：${scoreChange} 分`)];
    const renamed = stripComments(before['條目名稱']) !== stripComments(n.pageName);
    if (renamed) details.unshift(t(`條目改為${title}`, `条目改为${title}`));
    if (n.invalid) details.push(t('提名無效', '提名无效'));
    else {
        if (result.reasonText) details.push(t(`通過：${result.reasonText}`, `通过：${result.reasonText}`));
        if (result.unselectedReasonText) details.push(t(`否決：${result.unselectedReasonText}`, `否决：${result.unselectedReasonText}`));
    }
    const originalTitle = renamed ? article(before['條目名稱']) : title;
    return (n.original ? t(`覆核${originalTitle}`, `复核${originalTitle}`) : t(`核對${originalTitle}`, `核对${originalTitle}`)) + `（${details.join('；')}）`;
}

function briefDescription(items, scores) {
    const counts = {new: 0, edit: 0, check: 0, recheck: 0};
    for (const item of items) counts[operationType(item)]++;
    const actions = scores ? [
        counts.check && t(`核對 ${counts.check} 筆`, `核对 ${counts.check} 笔`),
        counts.recheck && t(`覆核 ${counts.recheck} 筆`, `复核 ${counts.recheck} 笔`),
    ] : [
        counts.new && t(`新增提名 ${counts.new} 筆`, `新增提名 ${counts.new} 笔`),
        counts.edit && t(`修改提名 ${counts.edit} 筆`, `修改提名 ${counts.edit} 笔`),
        counts.check && t(`核對 ${counts.check} 筆`, `核对 ${counts.check} 笔`),
        counts.recheck && t(`覆核 ${counts.recheck} 筆`, `复核 ${counts.recheck} 笔`),
    ];
    return actions.filter(Boolean).join('、');
}

/** 摘要按本次送出的操作生成；積分榜列實際帳號差額，登記處列條目與內容變更。 */
export function submissionSummary(draft, scores = false) {
    const items = draft.items.filter(hasChanges);
    let description;
    if (scores) {
        const checks = items.filter(item => item.mode === 'check').map(item => item.nomination);
        const deltas = scoreDeltas(checks.map(n => ({awarder: n.awarder.trim(),
            score: n.invalid ? 0 : generateReason(n.ruleStatus, true).reasonScore, before: previousBooking(n)})));
        const changes = [...deltas].filter(([, delta]) => delta !== 0)
            .map(([user, delta]) => t(`${user} ${delta > 0 ? '+' : ''}${delta} 分`));
        const sources = checks.map(n => n.original ? t(`覆核${article(n.pageName)}`, `复核${article(n.pageName)}`) :
            t(`核對${article(n.pageName)}`, `核对${article(n.pageName)}`));
        description = sources.join('、') + `（${changes.join('、') || t('積分不變', '积分不变')}）`;
    } else description = items.map(describeNomination).join('；');
    return formatEditSummary(description, draft.summary, briefDescription(items, scores));
}
