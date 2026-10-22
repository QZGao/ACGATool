import test from 'node:test';
import assert from 'node:assert/strict';
import state from '../src/i18n.js';
import {parseUserReason} from '../src/wiki/api.js';
import {generateReason, NominationRuleSet, ruleValues} from '../src/nomination/rules.js';
import {hasChanges, operationStatus} from '../src/nomination/operations.js';

const edit = ruleStatus => ({mode: 'edit', nomination: {pageName: '甲', awarder: 'A', ruleStatus,
    source: {values: {'條目名稱': '甲', '用戶名稱': 'A', '提名理由': '{{ACG提名2/request|ver=1|1c}}'}}}});

test('reloaded default rules do not become edits when the interface language changes', () => {
    try {
        state.init(({hant}) => hant);
        const rules = parseUserReason('1c');
        assert.deepEqual(rules, {'1c': {selected: true}});
        const saved = JSON.stringify(edit(rules));
        state.init(({hans}) => hans);
        const restored = JSON.parse(saved);
        assert.equal(hasChanges(restored), false);
        assert.equal(operationStatus(restored).ready, true);
        assert.equal(generateReason(restored.nomination.ruleStatus), '1c');
        assert.equal(ruleValues(rules['1c'], NominationRuleSet().ruleDict['1c']).desc, '长新增');
        restored.nomination.ruleStatus['1c'].score = 0;
        assert.equal(hasChanges(restored), true);
        assert.equal(operationStatus(restored).ready, true);
        assert.equal(generateReason(restored.nomination.ruleStatus), '1c[0]');
    } finally { state.init(({hant}) => hant); }
});

test('explicit descriptions and scores round-trip even when they equal a localized default', () => {
    try {
        const text = '1c(長新增)[3] 4(自訂活動)[0]';
        const saved = JSON.stringify(parseUserReason(text));
        for (const variant of ['hant', 'hans']) {
            state.init(values => values[variant]);
            const rules = JSON.parse(saved);
            assert.equal(generateReason(rules), text);
            assert.equal(generateReason(rules, true).reasonScore, 3);
        }
    } finally { state.init(({hant}) => hant); }
});

test('rule scores accept negatives but reject invalid input, and recipient line breaks are reported', () => {
    const item = edit(parseUserReason('1c[-2]'));
    assert.equal(operationStatus(item).ready, true);
    assert.equal(generateReason(item.nomination.ruleStatus, true).reasonScore, -2);
    item.nomination.awarder = 'A\nB';
    const status = operationStatus(item);
    assert.equal(status.ready, false);
    assert.deepEqual(status.errors.map(error => error.field), ['awarder']);
    assert.match(status.errors[0].message, /不能包含換行/);
    const invalid = edit({'1c': {selected: true, score: null, scoreInput: 'abc'}});
    assert.deepEqual(operationStatus(invalid).errors.map(error => error.field), ['ruleStatus']);
});
