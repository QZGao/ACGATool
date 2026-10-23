import test from 'node:test';
import assert from 'node:assert/strict';
import {entryValues, queryEntry, updateEntries} from '../src/wiki/api.js';
import {prepareMixed, getNewNominationPlacement} from '../src/wiki/submission.js';
import {createItem} from '../src/nomination/operations.js';
import {scoreDeltas} from '../src/nomination/scoring.js';
import {ReviewConflict} from '../src/nomination/conflicts.js';

const row = (number, title) => `\n|條目名稱${number} = ${title}\n|用戶名稱${number} = Example\n|提名理由${number} = {{ACG提名2/request|ver=1|1a}}\n|核對用${number} = {{ACG提名2/check|ver=1|}}`;
const text = `=== 10月14日 ===\n{{ACG提名2${row(1, '甲')}${row(2, '乙')}\n}}\n提名人：[[User:Nominator]]`;
const nomination = index => ({
    pageName: index === 1 ? '甲' : '乙', awarder: 'Example', reviewed: true, message: '',
    source: {date: '10月14日', index, values: entryValues(queryEntry(text, '10月14日', index))},
    ruleStatus: {'1a': {selected: true}},
});

test('new nomination placement follows UTC across local midnight and year boundaries', () => {
    const localMidnight = new Date('2026-10-15T00:30:00+08:00');
    assert.deepEqual(getNewNominationPlacement(['10月14日'], localMidnight), {date: '10月14日', newSection: false});
    assert.deepEqual(getNewNominationPlacement(['10月13日'], localMidnight), {date: '10月14日', newSection: true});
    assert.deepEqual(getNewNominationPlacement([], new Date('2027-01-01T01:00:00+08:00')), {date: '12月31日', newSection: true});
});

test('batch updates relocate entries and apply every replacement against the same source', () => {
    const result = prepareMixed('<!-- unrelated addition -->\n' + text, {items: [nomination(1), nomination(2)].map(n => createItem('check', n))});
    assert.match(entryValues(queryEntry(result.text, '10月14日', 1))['核對用'], /check\|ver=1\|1a/);
    assert.match(entryValues(queryEntry(result.text, '10月14日', 2))['核對用'], /check\|ver=1\|1a/);
    assert.equal(scoreDeltas(result.results).get('Example'), 2);
});

test('mixed preparation uses one source snapshot for swaps and edits that temporarily duplicate a checked entry', () => {
    const edit = (index, pageName) => ({id: `edit-${index}`, mode: 'edit', nomination: {...nomination(index), pageName}});
    const swapped = prepareMixed(text, {items: [edit(1, '乙'), edit(2, '甲')]});
    assert.equal(entryValues(queryEntry(swapped.text, '10月14日', 1))['條目名稱'], '乙');
    assert.equal(entryValues(queryEntry(swapped.text, '10月14日', 2))['條目名稱'], '甲');
    const items = [edit(1, '乙'), {id: 'check-2', mode: 'check', nomination: nomination(2)},
        {id: 'new', mode: 'new', nomination: {...nomination(1), source: undefined, pageName: '丙'}}];
    const mixed = prepareMixed(text, {items, message: '整批說明'});
    assert.equal(entryValues(queryEntry(mixed.text, '10月14日', 1))['核對用'], '{{ACG提名2/check|ver=1|}}');
    assert.match(entryValues(queryEntry(mixed.text, '10月14日', 2))['核對用'], /check\|ver=1\|1a/);
    assert.match(mixed.text, /條目名稱1 = 丙/);
    assert.equal(mixed.results.length, 1);
    assert.equal(mixed.results[0].score, 1);
    assert.throws(() => prepareMixed(text.replace('條目名稱2 = 乙', '條目名稱2 = 丁'), {items}), ReviewConflict);
});

test('identical nominations are edited by section index while source changes still stop submission', () => {
    const duplicated = text.replace('條目名稱2 = 乙', '條目名稱2 = 甲');
    const edits = [1, 2].map(index => createItem('edit', {...nomination(1), pageName: `修改${index}`,
        source: {date: '10月14日', index, values: entryValues(queryEntry(duplicated, '10月14日', index))}}));
    for (const selected of [0, 1]) {
        const saved = prepareMixed(duplicated, {items: [edits[selected]]}).text;
        assert.equal(entryValues(queryEntry(saved, '10月14日', selected + 1))['條目名稱'], `修改${selected + 1}`);
        const other = 1 - selected;
        assert.deepEqual(entryValues(queryEntry(saved, '10月14日', other + 1)), edits[other].nomination.source.values);
    }
    const together = prepareMixed(duplicated, {items: edits}).text;
    assert.deepEqual([1, 2].map(index => entryValues(queryEntry(together, '10月14日', index))['條目名稱']), ['修改1', '修改2']);

    // 第二筆改變時仍須重新核對，不能改寫內容仍與舊快照相同的第一筆。
    const changed = duplicated.replace('提名理由2 = {{ACG提名2/request|ver=1|1a}}', '提名理由2 = {{ACG提名2/request|ver=1|1b}}');
    assert.throws(() => prepareMixed(changed, {items: [edits[1]]}), error => {
        assert.ok(error instanceof ReviewConflict);
        assert.deepEqual(error.changes[0].fields, ['提名理由']);
        assert.equal(error.changes[0].source.index, 2);
        return true;
    });
    const removed = duplicated.replace(row(2, '甲'), '');
    assert.throws(() => prepareMixed(removed, {items: [edits[1]]}), ReviewConflict);
});

test('a changed entry or an unreviewed item prevents preparation of the entire batch', () => {
    assert.throws(() => prepareMixed(text.replace('條目名稱2 = 乙', '條目名稱2 = 丙'), {items: [nomination(1), nomination(2)].map(n => createItem('check', n))}));
    assert.throws(() => prepareMixed(text, {items: [createItem('check', {...nomination(1), reviewed: false})]}));
});

test('missing check parameters are inserted with the original grouped suffix', () => {
    const missing = text.replace('\n|核對用2 = {{ACG提名2/check|ver=1|}}', '');
    const result = updateEntries(missing, [{entry: queryEntry(missing, '10月14日', 2), changes: {'核對用': '已核對'}}]);
    assert.equal(entryValues(queryEntry(result, '10月14日', 2))['核對用'], '已核對');
    assert.equal(entryValues(queryEntry(result, '10月14日', 1))['核對用'], '{{ACG提名2/check|ver=1|}}');
});
