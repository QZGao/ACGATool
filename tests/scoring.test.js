import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCheck, reviewData, previousBooking, prepareScoreText, scoreReceipts, checkWikitext} from '../src/scoring.js';
import {parseUserReason} from '../src/api.js';
import {generateReason} from '../src/rules.js';

test('review reads approved/rejected rules, custom zero points and rechecking status', () => {
    const check = parseCheck('{{ACG提名2/check|ver=1|1a[0] 2-b|no=3|status=rechecking}}--Reviewer');
    assert.equal(check.score, 3);
    assert.equal(check.ruleStatus['1a'].score, 0);
    assert.equal(check.ruleStatus['3'].selected, false);
    assert.equal(check.status, 'rechecking');
    assert.throws(() => parseCheck('{{ACG提名2/check|ver=2|1a}}'));
});

test('legacy positive scores require an explicit accounting decision', () => {
    const data = reviewData({awarder: 'A'}, {values: {'用戶名稱': 'A', '核對用': '{{ACG提名2/check|ver=1|2-fa}}'}}, 'return {\n}');
    assert.throws(() => previousBooking(data));
    data.booking = 'booked';
    assert.deepEqual(previousBooking(data), {awarder: 'A', score: 10});
    data.booking = 'unbooked';
    assert.equal(previousBooking(data).score, 0);
});

test('score correction and recipient transfer apply only the delta and one receipt', () => {
    const text = 'return {\n    ["A"] = 20,\n    ["B"] = 1,\n}\n';
    const results = [{id: 'entry', before: {awarder: 'A', score: 10}, awarder: 'B', score: 8.5}];
    const updated = prepareScoreText(text, results, 'operation');
    assert.match(updated, /\["A"\] = 10,/);
    assert.match(updated, /\["B"\] = 9.5,/);
    assert.equal(prepareScoreText(updated, results, 'operation'), updated);
    assert.equal(scoreReceipts(updated).entries.get('entry').score, 8.5);
    assert.throws(() => prepareScoreText(updated, results, 'different-operation'));
});

test('invalidating an award removes its booked points and preserves unrelated module text', () => {
    const text = '-- manual comment\nreturn {\n ["A"] = 10,\n ["Other"] = 123.5,\n}';
    const updated = prepareScoreText(text, [{id: 'x', before: {awarder: 'A', score: 10}, awarder: 'A', score: 0}], 'invalidate');
    assert.match(updated, /\["A"\] = 0,/);
    assert.match(updated, /\["Other"\] = 123.5,/);
    assert.ok(updated.startsWith('-- manual comment'));
    assert.throws(() => prepareScoreText('return unknownFunction()', [], 'x'));
});

test('review retains the signed previous result as rescinded and can be read again', () => {
    const raw = '{{ACG提名2/check|ver=1|2-fa|status=rechecking}}--Original signature';
    const nomination = {id: 'entry', source: {values: {'核對用': raw, '用戶名稱': 'A'}}, original: parseCheck(raw), booking: 'booked', message: '已修正'};
    const result = checkWikitext(nomination, generateReason(parseUserReason('1a'), true), 'operation');
    assert.match(result, /status=rescinded}}--Original signature/);
    assert.equal(parseCheck(result).score, 1);
    const restored = reviewData({awarder: 'A'}, {values: {'核對用': result, '用戶名稱': 'A'}}, 'return {\n}');
    assert.deepEqual(restored.baseline, {awarder: 'A', score: 10});
});
