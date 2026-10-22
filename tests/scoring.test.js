import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCheck, reviewData, previousBooking, prepareScoreText, checkWikitext} from '../src/nomination/scoring.js';
import {parseUserReason} from '../src/wiki/api.js';
import {generateReason} from '../src/nomination/rules.js';

test('review reads approved/rejected rules, custom zero points and rechecking status', () => {
    const check = parseCheck('{{ACG提名2/check|ver=1|1a[0] 2-b|no=3|status=rechecking}}--Reviewer');
    assert.equal(check.score, 3);
    assert.equal(check.ruleStatus['1a'].score, 0);
    assert.equal(check.ruleStatus['3'].selected, false);
    assert.equal(check.status, 'rechecking');
});

test('review reads nested templates without a version restriction and preserves surrounding content', () => {
    const outside = '備註 {{其他模板|text}} <!-- {{ACG提名2/check|1a}} -->';
    const desc = '活動 {{lang|en|Game (2026)|status=keep}} [[Foo|other label]]';
    for (const version of ['', 'ver=9|']) {
        const raw = `${outside}\n{{ACG提名2/check|${version}1=4(${desc})[-1] 1a|no=3|status=rechecking}}--原簽名`;
        const original = parseCheck(raw);
        assert.equal(original.score, 0);
        assert.equal(original.ruleStatus['4'].desc, desc);
        assert.equal(original.ruleStatus['4'].score, -1);
        const saved = checkWikitext({source: {values: {'核對用': raw}}, original, message: ''}, generateReason(parseUserReason('1b'), true));
        assert.ok(saved.startsWith(outside));
        assert.ok(saved.includes(desc));
        assert.match(saved, /status=rescinded}}--原簽名/);
        assert.equal(parseCheck(saved).score, 2);
    }
    assert.equal(parseCheck(outside), null);
    const saved = checkWikitext({source: {values: {'核對用': outside + '{{ACG提名2/check|ver=1|}}'}}, original: null, message: ''}, generateReason(parseUserReason('1a'), true));
    assert.ok(saved.startsWith(outside));
    assert.equal(parseCheck(saved).score, 1);
    assert.equal(parseCheck('{{ACG提名2/check|1a[-1]}}').score, -1);
});

test('review uses the signed original score without an accounting decision', () => {
    const data = reviewData({awarder: 'A'}, {values: {'用戶名稱': 'A', '核對用': '{{ACG提名2/check|ver=1|2-fa}}'}});
    assert.deepEqual(previousBooking(data), {awarder: 'A', score: 10});
});

test('score correction and recipient transfer apply only the delta without adding public receipts', () => {
    const text = 'return {\n    ["A"] = 20,\n    ["B"] = 1,\n}\n';
    const results = [{id: 'entry', before: {awarder: 'A', score: 10}, awarder: 'B', score: 8.5}];
    const updated = prepareScoreText(text, results);
    assert.match(updated, /\["A"\] = 10,/);
    assert.match(updated, /\["B"\] = 9.5,/);
    assert.equal(updated, 'return {\n    ["A"] = 10,\n    ["B"] = 9.5,\n}\n');
});

test('deductions may make totals negative and preserve other accounts and comments', () => {
    const text = '-- manual comment\nreturn {\n ["A"] = 3,\n ["Other"] = -123.5,\n}';
    const updated = prepareScoreText(text, [{id: 'x', before: {awarder: 'A', score: 10}, awarder: 'A', score: 0}]);
    assert.match(updated, /\["A"\] = -7,/);
    assert.match(updated, /\["Other"\] = -123.5,/);
    assert.ok(updated.startsWith('-- manual comment'));
});

test('score updates accept Lua spacing, separators, number forms and arithmetic while retaining comments', () => {
    const result = [{before: {awarder: 'A', score: 0}, awarder: 'A', score: 1}];
    for (const [source, expected] of [
        ['return{["A"]=.5, B=1e3};', 'return{["A"]=1.5, B=1e3};'],
        ['local board = {A=1}; return board', 'local board = {A=2}; return board'],
        ["return { ['A'] = 1.; B = -3 }", "return { ['A'] = 2; B = -3 }"],
        ['return { A = 1e3, B = 0 }', 'return { A = 1001, B = 0 }'],
        ['return { A = 1 + 2, -- 保留行尾註解\n --[[ 保留區塊註解 ]]\n B = -2 }',
            'return { A = 4, -- 保留行尾註解\n --[[ 保留區塊註解 ]]\n B = -2 }'],
        ['return { A = 2 * (1 + 2), B = 0 }', 'return { A = 7, B = 0 }'],
    ]) assert.equal(prepareScoreText(source, result), expected);
});

test('score parsing rejects non-finite inputs and identifies missing original recipients before applying deltas', () => {
    assert.throws(() => prepareScoreText('return { A = 1e999 }', []), /「A」的分數不是有限數字/);
    assert.throws(() => prepareScoreText('return { A = 1 }', [{before: {awarder: 'A', score: 0}, awarder: 'A', score: NaN}]), /增減分數必須是有限數字/);
    // 原核分非零，即使本次差額是增加，也不能把缺少的原得分者當成首次得分。
    assert.throws(() => prepareScoreText('return {}', [{before: {awarder: 'A', score: 10}, awarder: 'A', score: 12}]), /找不到原得分者「A」/);
    assert.match(prepareScoreText('return {}', [{before: {awarder: 'New', score: 0}, awarder: 'New', score: 2}]), /\["New"\] = 2,/);
});

test('review retains the signed previous result as rescinded and can be read again', () => {
    const raw = '{{ACG提名2/check|ver=1|2-fa|status=rechecking}}--Original signature';
    const nomination = {id: 'entry', source: {values: {'核對用': raw, '用戶名稱': 'A'}}, original: parseCheck(raw), message: '已修正'};
    const result = checkWikitext(nomination, generateReason(parseUserReason('1a'), true));
    assert.match(result, /status=rescinded}}--Original signature/);
    assert.equal(parseCheck(result).score, 1);
    const restored = reviewData({awarder: 'A'}, {values: {'核對用': result, '用戶名稱': 'A'}});
    assert.doesNotMatch(result, /ACGATool|entry|operation/);
    assert.deepEqual(previousBooking(restored), {awarder: 'A', score: 1});
});

test('opening all rules does not reject unrequested default rules in the saved check', () => {
    const rules = parseUserReason('1a');
    rules['2-b'] = {...parseUserReason('2-b')['2-b'], selected: false, applicable: false};
    assert.equal(generateReason(rules, true).unselectedReasonText, '');
    rules['2-b'].selected = true;
    assert.equal(generateReason(rules, true).reasonScore, 4);
});
