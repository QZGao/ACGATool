import test from 'node:test';
import assert from 'node:assert/strict';
import state from '../src/i18n.js';
import {operationStatus} from '../src/nomination/operations.js';
import {ReviewConflict} from '../src/nomination/conflicts.js';
import {assertCanCheck} from '../src/nomination/ownership.js';
import {fieldLabel, fieldText} from '../src/ui/review-ui.js';
import {parseUserReason} from '../src/wiki/api.js';
import {submitWorkspace} from '../src/wiki/submission.js';
import {writeStep} from '../src/wiki/transport.js';

test('validation, source conflicts and query failures use the active converter without translating external details', async () => {
    const previous = state.conv;
    try {
        for (const variant of ['hant', 'hans']) {
            state.init(messages => messages[variant]);
            const hans = variant === 'hans';
            const status = operationStatus({mode: 'new', nomination: {pageName: '', awarder: '', ruleStatus: {}}});
            assert.equal(status.errors[0].message, hans ? '请填写条目名称。' : '請填寫條目名稱。');
            assert.throws(() => assertCanCheck({}, '', ''), {message: hans ? '请先登录后再核对。' : '請先登入後再核對。'});
            assert.match(new ReviewConflict([]).message, hans ? /已入账分数已变更/ : /已入帳分數已變更/);
            assert.equal(fieldLabel('用戶名稱'), hans ? '用户名称' : '用戶名稱');
            assert.equal(fieldText('reviewed', false), hans ? '尚未核对完成' : '尚未核對完成');
            const step = {status: 'unknown', attempt: {title: 'Test', marker: 'marker'}};
            const rawError = '伺服器原始訊息 $1';
            await writeStep(step, () => {}, {read: async () => { throw new Error(rawError); }});
            assert.equal(step.error, (hans ? '无法查询上次保存结果：' : '無法查詢上次儲存結果：') + rawError);
        }
    } finally { state.init(previous); }
});

test('localized default summaries preserve template field names and user-authored content', async () => {
    const previous = state.conv;
    try {
        for (const variant of ['hant', 'hans']) {
            state.init(messages => messages[variant]);
            const draft = {mode: 'new', message: '使用者自訂說明', nominations: [{pageName: '臺灣動畫', awarder: '維基編者', ruleStatus: parseUserReason('1a(自訂規則)')}]};
            const writes = [];
            const io = {read: async () => ({text: '頁首', revid: 1}), write: async attempt => { writes.push(attempt); return {revid: 2}; }};
            assert.equal(await submitWorkspace(draft, () => {}, io), true);
            assert.equal(writes.length, 1);
            assert.ok(writes[0].summary.includes(variant === 'hans' ? '提名与核分' : '提名與核分'));
            for (const value of ['|條目名稱1 = 臺灣動畫', '|用戶名稱1 = 維基編者', '1a(自訂規則)', '使用者自訂說明']) assert.ok(writes[0].text.includes(value), value);
        }
    } finally { state.init(previous); }
});
