import test from 'node:test';
import assert from 'node:assert/strict';
import {entryValues, queryEntry, updateEntries} from '../src/api.js';
import {prepareChecks} from '../src/submission.js';

const row = (number, title) => `\n|條目名稱${number} = ${title}\n|用戶名稱${number} = Example\n|提名理由${number} = {{ACG提名2/request|ver=1|1a}}\n|核對用${number} = {{ACG提名2/check|ver=1|}}`;
const text = `=== 10月14日 ===\n{{ACG提名2${row(1, '甲')}${row(2, '乙')}\n}}\n提名人：[[User:Nominator]]`;
const nomination = index => ({
    pageName: index === 1 ? '甲' : '乙', awarder: 'Example', reviewed: true, message: '',
    source: {date: '10月14日', index, values: entryValues(queryEntry(text, '10月14日', index))},
    ruleStatus: {'1a': {selected: true, desc: '短新增', ogDesc: '短新增', score: 1, maxScore: 1}},
});

test('batch updates relocate entries and apply every replacement against the same source', () => {
    const result = prepareChecks('<!-- unrelated addition -->\n' + text, [nomination(1), nomination(2)]);
    assert.match(entryValues(queryEntry(result.text, '10月14日', 1))['核對用'], /check\|ver=1\|1a/);
    assert.match(entryValues(queryEntry(result.text, '10月14日', 2))['核對用'], /check\|ver=1\|1a/);
    assert.equal(result.scores.get('Example'), 2);
});

test('a changed entry or an unreviewed item prevents preparation of the entire batch', () => {
    assert.throws(() => prepareChecks(text.replace('條目名稱2 = 乙', '條目名稱2 = 丙'), [nomination(1), nomination(2)]));
    assert.throws(() => prepareChecks(text, [{...nomination(1), reviewed: false}]));
});

test('missing check parameters are inserted with the original grouped suffix', () => {
    const missing = text.replace('\n|核對用2 = {{ACG提名2/check|ver=1|}}', '');
    const result = updateEntries(missing, [{entry: queryEntry(missing, '10月14日', 2), changes: {'核對用': '已核對'}}]);
    assert.equal(entryValues(queryEntry(result, '10月14日', 2))['核對用'], '已核對');
    assert.equal(entryValues(queryEntry(result, '10月14日', 1))['核對用'], '{{ACG提名2/check|ver=1|}}');
});
