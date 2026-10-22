import test from 'node:test';
import assert from 'node:assert/strict';
import {submitWorkspace, REGISTER, SCORES, getNewNominationPlacement} from '../src/wiki/submission.js';
import {entryValues, queryEntry, queried2NomData, getDateSections, parseUserReason} from '../src/wiki/api.js';
import {reviewData} from '../src/nomination/scoring.js';
import {createItem} from '../src/nomination/operations.js';

const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
    const text = '=== 10月14日 ===\n{{ACG提名2\n|條目名稱1 = Test\n|用戶名稱1 = A\n|提名理由1 = {{ACG提名2/request|ver=1|1a}}\n|核對用1 = {{ACG提名2/check|ver=1|}}\n}}\n提名人：[[User:Nominator]]';
    const scores = 'return {\n ["A"] = 10,\n}';
    const entry = queryEntry(text, '10月14日', 1);
    const nomination = reviewData(queried2NomData(entry), {date: '10月14日', index: 1, values: entryValues(entry)});
    nomination.reviewed = true;
    const pages = new Map([[REGISTER, {text, revid: 1}], [SCORES, {text: scores, revid: 1}]]);
    const writes = [], edits = [];
    const io = {
        read: async title => clone(pages.get(title)),
        write: async edit => {
            assert.doesNotMatch(edit.summary, /\[ACGATool:/);
            assert.doesNotMatch(edit.text, /<!--\/?ACGATool|-- ACGATool /);
            writes.push(edit.title); edits.push(clone(edit));
            const page = pages.get(edit.title);
            if (page.revid !== edit.base.revid) throw new Error('editconflict');
            const text = edit.text.replaceAll('~~~~', '[[User:Reviewer]] 2026年10月18日 (日) 12:00 (UTC)');
            pages.set(edit.title, {text, revid: page.revid + 1});
            return {revid: page.revid + 1};
        },
    };
    return {draft: {mode: 'mixed', items: [createItem('check', nomination)], message: ''}, io, writes, pages, edits};
}

test('new nominations append at the bottom and only add a missing UTC date heading', async () => {
    const {date} = getNewNominationPlacement([]);
    for (const hasToday of [false, true]) {
        const {draft, io, writes, pages, edits} = fixture();
        const original = `頁首\n=== ${hasToday ? date : '舊日期'} ===\n既有提名與說明\n`;
        pages.set(REGISTER, {text: original, revid: 1});
        draft.items = [createItem('new', {...draft.items[0].nomination, source: undefined})];
        assert.equal(await submitWorkspace(draft, () => {}, io), true);
        const saved = pages.get(REGISTER).text;
        assert.ok(saved.startsWith(original));
        assert.equal(getDateSections(saved).filter(section => section.date === date).length, 1);
        assert.equal(entryValues(queryEntry(saved, date, 1))['條目名稱'], 'Test');
        assert.deepEqual(writes, [REGISTER]);
        assert.equal(edits[0].summary,
            '提名[[Test]]（得分者：A；規則：1a） ([[User:SuperGrey/gadgets/ACGATool|ACGATool]])');
    }
});

test('review can correct the article title while preserving the old signed result and the score', async () => {
    const {draft, io, pages, writes, edits} = fixture();
    const page = pages.get(REGISTER);
    page.text = page.text.replace('check|ver=1|}}', 'check|ver=1|1a}}--[[User:Previous reviewer]]');
    const entry = queryEntry(page.text, '10月14日', 1);
    const nomination = reviewData(queried2NomData(entry), {date: '10月14日', index: 1, values: entryValues(entry)});
    draft.items = [createItem('check', {...nomination, pageName: 'Corrected title', reviewed: true})];
    const scores = clone(pages.get(SCORES));
    assert.equal(await submitWorkspace(draft, () => {}, io), true);
    const saved = entryValues(queryEntry(pages.get(REGISTER).text, '10月14日', 1));
    assert.equal(saved['條目名稱'], 'Corrected title');
    assert.match(saved['核對用'], /status=rescinded}}--\[\[User:Previous reviewer\]\]/);
    assert.match(edits[0].summary, /覆核\[\[Test\]\]（條目改為\[\[Corrected title\]\]/);
    assert.deepEqual(pages.get(SCORES), scores);
    assert.deepEqual(writes, [REGISTER]);
});

test('a reviewer may correct the recipient to themselves but cannot check their own original award', async context => {
    const first = fixture();
    first.draft.items[0].nomination.awarder = 'Reviewer';
    assert.equal(await submitWorkspace(first.draft, () => {}, first.io), true);
    assert.equal(entryValues(queryEntry(first.pages.get(REGISTER).text, '10月14日', 1))['用戶名稱'], 'Reviewer');
    assert.match(first.pages.get(SCORES).text, /\["Reviewer"\] = 1,/);
    context.mock.method(mw.config, 'get', () => 'A');
    const own = fixture();
    own.draft.items[0].nomination.awarder = 'B';
    await assert.rejects(submitWorkspace(own.draft, () => {}, own.io), /自己為得分者/);
    assert.deepEqual(own.writes, []);
});

test('a failed request stops without extra reads and retry writes only the selected step', async () => {
    const {draft, io, writes} = fixture();
    const read = io.read, write = io.write;
    let failed = false, readsAfterFailure = 0;
    io.read = async title => { if (failed) readsAfterFailure++; return read(title); };
    io.write = async () => { failed = true; throw new Error('timeout'); };
    assert.equal(await submitWorkspace(draft, () => {}, io), false);
    assert.equal(draft.operation.steps[0].status, 'failed');
    assert.equal(readsAfterFailure, 0);
    assert.deepEqual(writes, []);
    io.write = write;
    assert.equal(await submitWorkspace(draft, () => {}, io, 'registry'), false);
    assert.deepEqual(writes, [REGISTER]);
    assert.equal(draft.operation.steps[1].status, 'pending');
    assert.equal(await submitWorkspace(draft, () => {}, io, 'scores'), true);
    assert.deepEqual(writes, [REGISTER, SCORES]);
});

test('partial success survives reload and retries only the missing scoreboard write', async () => {
    const {draft, io, writes} = fixture();
    const write = io.write;
    let fail = true;
    io.write = async edit => {
        if (edit.title === SCORES && fail) { fail = false; throw new Error('editconflict'); }
        return write(edit);
    };
    assert.equal(await submitWorkspace(draft, () => {}, io), false);
    const restored = clone(draft);
    assert.equal(await submitWorkspace(restored, () => {}, io), true);
    assert.deepEqual(writes, [REGISTER, SCORES]);
});

test('failure to persist the operation prevents any network write', async () => {
    const {draft, io, writes} = fixture();
    await assert.rejects(submitWorkspace(draft, () => { throw new Error('storage full'); }, io));
    assert.deepEqual(writes, []);
});

test('changed score-bearing fields stop the entire batch before any write', async () => {
    const {draft, io, pages, writes, edits} = fixture();
    pages.get(REGISTER).text = pages.get(REGISTER).text.replace('request|ver=1|1a', 'request|ver=1|1b');
    await assert.rejects(submitWorkspace(draft, () => {}, io), /已變更/);
    assert.deepEqual(writes, []);
    assert.deepEqual(draft.conflicts[0].fields, ['提名理由']);
});

test('signatures are submitted for server expansion and score updates use the latest totals', async () => {
    const {draft, io, pages} = fixture();
    const write = io.write;
    io.write = async edit => {
        const result = await write(edit);
        if (edit.title === REGISTER) {
            assert.match(edit.text, /~~~~/);
            assert.doesNotMatch(pages.get(REGISTER).text, /~~~~/);
            pages.get(SCORES).text = 'return {\n ["A"] = 60,\n}';
            pages.get(SCORES).revid++;
        }
        return result;
    };
    assert.equal(await submitWorkspace(draft, () => {}, io), true);
    assert.match(pages.get(SCORES).text, /\["A"\] = 61,/);
});

test('one mixed batch edits, reviews and appends more than 25 nominations with shared submission fields', async () => {
    const {draft, io, writes, pages, edits} = fixture();
    const page = pages.get(REGISTER);
    page.text += '\n{{ACG提名2\n|條目名稱1=Second\n|用戶名稱1=B\n|提名理由1={{ACG提名2/request|ver=1|1a}}\n|核對用1={{ACG提名2/check|ver=1|}}\n}}\n提名人：[[User:Nominator]]';
    const entry = queryEntry(page.text, '10月14日', 2);
    const edit = queried2NomData(entry);
    edit.source = {date: '10月14日', index: 2, values: entryValues(entry)};
    edit.pageName = 'Edited';
    const added = Array.from({length: 30}, (_, i) => createItem('new', {...draft.items[0].nomination, id: `added-${i}`, source: undefined, pageName: `New ${i}`}));
    const mixed = {mode: 'mixed', message: '這批新提名的說明', summary: '修正與核對', items: [createItem('check', draft.items[0].nomination), createItem('edit', edit), ...added]};
    assert.equal(await submitWorkspace(mixed, async () => {}, io), true);
    assert.deepEqual(writes, [REGISTER, SCORES]);
    assert.match(pages.get(REGISTER).text, /條目名稱1=Edited/);
    assert.match(pages.get(REGISTER).text, /條目名稱30 = New 29/);
    assert.equal(pages.get(REGISTER).text.split('這批新提名的說明').length, 2);
    assert.deepEqual(edits.map(edit => edit.summary), [
        '新增提名 30 筆、修改提名 1 筆、核對 1 筆：修正與核對 ([[User:SuperGrey/gadgets/ACGATool|ACGATool]])',
        '核對[[Test]]（A +1 分）：修正與核對 ([[User:SuperGrey/gadgets/ACGATool|ACGATool]])',
    ]);
});

test('reloading an edit conflict retains the complete local proposal and requires acknowledgement', async () => {
    const {draft, io, pages, writes, edits} = fixture();
    const {reloadForReview} = await import('../src/nomination/conflicts.js');
    const entry = queryEntry(pages.get(REGISTER).text, '10月14日', 1);
    const proposedRules = parseUserReason('1c(本地自訂規則)[2]');
    const item = createItem('edit', {...queried2NomData(entry), source: draft.items[0].nomination.source,
        pageName: 'Local title', awarder: 'B', ruleStatus: proposedRules});
    const mixed = {mode: 'mixed', items: [item]};
    pages.get(REGISTER).text = pages.get(REGISTER).text.replace('request|ver=1|1a', 'request|ver=1|1b');
    await assert.rejects(submitWorkspace(mixed, () => {}, io), /已變更/);
    await reloadForReview(mixed, io);
    assert.equal(mixed.items[0].nomination.pageName, 'Local title');
    assert.equal(mixed.items[0].nomination.previousProposal.awarder, 'B');
    assert.deepEqual(mixed.items[0].nomination.previousProposal.ruleStatus, proposedRules);
    assert.equal(mixed.items[0].needsReview, true);
    await assert.rejects(submitWorkspace(mixed, () => {}, io), /差異/);
    assert.deepEqual(writes, []);
});
