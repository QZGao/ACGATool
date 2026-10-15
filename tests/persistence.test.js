import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftStore, clearSubmittedDraft} from '../src/drafts.js';
import {submitWorkspace, REGISTER, SCORES, getNewNominationPlacement} from '../src/submission.js';
import {entryValues, queryEntry, queried2NomData, getDateSections} from '../src/api.js';
import {reviewData} from '../src/scoring.js';

function storage() {
    const items = new Map();
    return {get length() { return items.size; }, key: i => [...items.keys()][i],
        getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key)};
}
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
    const text = '=== 10月14日 ===\n{{ACG提名2\n|條目名稱1 = Test\n|用戶名稱1 = A\n|提名理由1 = {{ACG提名2/request|ver=1|1a}}\n|核對用1 = {{ACG提名2/check|ver=1|}}\n}}\n提名人：[[User:Nominator]]';
    const scores = 'return {\n ["A"] = 10,\n}';
    const entry = queryEntry(text, '10月14日', 1);
    const nomination = reviewData(queried2NomData(entry), {date: '10月14日', index: 1, values: entryValues(entry)}, scores);
    nomination.reviewed = true;
    const pages = new Map([[REGISTER, {text, revid: 1}], [SCORES, {text: scores, revid: 1}]]);
    const writes = [];
    const io = {
        read: async title => clone(pages.get(title)),
        write: async attempt => {
            writes.push(attempt.title);
            const page = pages.get(attempt.title);
            if (page.revid !== attempt.base.revid) throw Object.assign(new Error('editconflict'), {uncertain: false});
            pages.set(attempt.title, {text: attempt.text, revid: page.revid + 1});
            return {revid: page.revid + 1};
        },
        findReceipt: async () => null,
    };
    return {draft: {id: 'draft', mode: 'check', nominations: [nomination], message: ''}, io, writes, pages};
}

test('new nominations append at the bottom and only add a missing UTC date heading', async () => {
    const {date} = getNewNominationPlacement([]);
    for (const hasToday of [false, true]) {
        const {draft, io, writes, pages} = fixture();
        const original = `頁首\n=== ${hasToday ? date : '舊日期'} ===\n既有提名與說明\n`;
        pages.set(REGISTER, {text: original, revid: 1});
        draft.mode = 'new';
        assert.equal(await submitWorkspace(draft, () => {}, io), true);
        const saved = pages.get(REGISTER).text;
        assert.ok(saved.startsWith(original));
        assert.equal(getDateSections(saved).filter(section => section.date === date).length, 1);
        assert.equal(entryValues(queryEntry(saved, date, 1))['條目名稱'], 'Test');
        assert.deepEqual(writes, [REGISTER]);
    }
});

test('clearing a submitted snapshot preserves later edits and other drafts', () => {
    const store = createDraftStore(storage(), 'site:user');
    const draft = {id: 'one', nominations: [{id: 'a', pageName: 'old'}, {id: 'b', pageName: 'same'}], message: ''};
    const other = {id: 'two', nominations: [{id: 'c'}]};
    store.save(draft); store.save(other);
    const submitted = clone(draft);
    draft.nominations[0].pageName = 'new'; store.save(draft);
    clearSubmittedDraft(store, draft, submitted);
    assert.deepEqual(draft.nominations, [{id: 'a', pageName: 'new'}]);
    assert.equal(store.list().length, 2);
    const stale = clone(draft);
    store.save(draft);
    assert.throws(() => store.save(stale));
    assert.throws(() => store.remove(stale));
});

test('an edit that succeeds despite a lost response is confirmed without another write', async () => {
    const {draft, io, writes} = fixture();
    const write = io.write;
    io.write = async attempt => {
        await write(attempt);
        throw Object.assign(new Error('timeout'), {uncertain: true});
    };
    assert.equal(await submitWorkspace(draft, () => {}, io), true);
    assert.deepEqual(writes, [REGISTER, SCORES]);
});

test('partial success survives reload and retries only the missing scoreboard write', async () => {
    const {draft, io, writes} = fixture();
    const write = io.write;
    let fail = true;
    io.write = async attempt => {
        if (attempt.title === SCORES && fail) { fail = false; throw Object.assign(new Error('editconflict'), {uncertain: false}); }
        return write(attempt);
    };
    assert.equal(await submitWorkspace(draft, () => {}, io), false);
    const restored = clone(draft);
    assert.equal(await submitWorkspace(restored, () => {}, io), true);
    assert.deepEqual(writes, [REGISTER, SCORES]);
});

test('unknown outcomes are queried and never blindly posted again', async () => {
    const {draft, io} = fixture();
    let writes = 0;
    io.write = async () => { writes++; throw Object.assign(new Error('timeout'), {uncertain: true}); };
    assert.equal(await submitWorkspace(draft, () => {}, io), false);
    assert.equal(await submitWorkspace(clone(draft), () => {}, io), false);
    assert.equal(writes, 1);
    assert.equal(draft.operation.steps[0].status, 'unknown');
});

test('failure to persist the operation prevents any network write', async () => {
    const {draft, io, writes} = fixture();
    await assert.rejects(submitWorkspace(draft, () => { throw new Error('storage full'); }, io));
    assert.deepEqual(writes, []);
});

test('changed score-bearing fields stop the entire batch before any write', async () => {
    const {draft, io, pages, writes} = fixture();
    pages.get(REGISTER).text = pages.get(REGISTER).text.replace('request|ver=1|1a', 'request|ver=1|1b');
    await assert.rejects(submitWorkspace(draft, () => {}, io), /已變更/);
    assert.deepEqual(writes, []);
    assert.deepEqual(draft.conflicts[0].fields, ['提名理由']);
});

test('changes after registry save halt accounting and require a fresh review', async () => {
    const {draft, io, pages, writes} = fixture();
    const write = io.write;
    let interfere = true;
    io.write = async attempt => {
        const result = await write(attempt);
        if (attempt.title === REGISTER && interfere) {
            interfere = false;
            const page = pages.get(REGISTER);
            page.text = page.text.replace('check|ver=1|1a', 'check|ver=1|1b');
            page.revid++;
        }
        return result;
    };
    assert.equal(await submitWorkspace(draft, () => {}, io), false);
    assert.deepEqual(writes, [REGISTER]);
    assert.equal(draft.operation.steps[1].status, 'conflict');
    const {reloadForReview} = await import('../src/conflicts.js');
    await reloadForReview(draft, io);
    assert.equal(draft.nominations[0].reviewed, false);
    assert.ok(draft.nominations[0].previousProposal);
    await assert.rejects(submitWorkspace(draft, () => {}, io), /逐筆完成核對/);
    draft.nominations[0].reviewed = true;
    assert.equal(await submitWorkspace(draft, () => {}, io), true);
    assert.match(pages.get(SCORES).text, /\["A"\] = 12,/);
    assert.equal(writes.filter(title => title === SCORES).length, 1);
});

test('expanded signatures and unrelated score increases do not invalidate the review', async () => {
    const {draft, io, pages} = fixture();
    const write = io.write;
    io.write = async attempt => {
        const result = await write(attempt);
        if (attempt.title === REGISTER) {
            pages.get(REGISTER).text = pages.get(REGISTER).text.replaceAll('~~~~', '[[User:Reviewer]] 2026年10月14日');
            pages.get(SCORES).text = 'return {\n ["A"] = 60,\n}';
            pages.get(SCORES).revid++;
        }
        return result;
    };
    assert.equal(await submitWorkspace(draft, () => {}, io), true);
    assert.match(pages.get(SCORES).text, /\["A"\] = 61,/);
});

test('one mixed batch edits, reviews and appends more than 25 nominations with shared submission fields', async () => {
    const {draft, io, writes, pages} = fixture();
    const {createItem} = await import('../src/operations.js');
    const page = pages.get(REGISTER);
    page.text += '\n{{ACG提名2\n|條目名稱1=Second\n|用戶名稱1=B\n|提名理由1={{ACG提名2/request|ver=1|1a}}\n|核對用1={{ACG提名2/check|ver=1|}}\n}}\n提名人：[[User:Nominator]]';
    const entry = queryEntry(page.text, '10月14日', 2);
    const edit = queried2NomData(entry);
    edit.source = {date: '10月14日', index: 2, values: entryValues(entry)};
    edit.pageName = 'Edited';
    const added = Array.from({length: 30}, (_, i) => createItem('new', {...draft.nominations[0], id: `added-${i}`, source: undefined, pageName: `New ${i}`}));
    const mixed = {mode: 'mixed', message: '這批新提名的說明', summary: '修正與核對', items: [createItem('check', draft.nominations[0]), createItem('edit', edit), ...added]};
    assert.equal(await submitWorkspace(mixed, async () => {}, io), true);
    assert.deepEqual(writes, [REGISTER, SCORES]);
    assert.match(pages.get(REGISTER).text, /條目名稱1=Edited/);
    assert.match(pages.get(REGISTER).text, /條目名稱30 = New 29/);
    assert.equal(pages.get(REGISTER).text.split('這批新提名的說明').length, 2);
    assert.ok(mixed.operation.steps.every(step => step.attempt.summary.startsWith('修正與核對')));
});

test('querying an uncertain registry write never writes the scoreboard and retries only the named step', async () => {
    const {draft, io, pages, writes} = fixture();
    const write = io.write;
    io.write = async () => { throw Object.assign(new Error('timeout'), {uncertain: true}); };
    assert.equal(await submitWorkspace(draft, () => {}, io), false);
    pages.set(REGISTER, {text: draft.operation.steps[0].attempt.text, revid: 2});
    io.write = write;
    assert.equal(await submitWorkspace(draft, () => {}, io, {stepKey: 'registry', kind: 'query'}), false);
    assert.deepEqual(writes, []);
    assert.equal(draft.operation.steps[1].status, 'pending');
    assert.equal(await submitWorkspace(draft, () => {}, io, {stepKey: 'scores', kind: 'retry'}), true);
    assert.deepEqual(writes, [SCORES]);
});

test('reloading an edit conflict retains the complete local proposal and requires acknowledgement', async () => {
    const {draft, io, pages, writes} = fixture();
    const {createItem} = await import('../src/operations.js');
    const {reloadForReview} = await import('../src/conflicts.js');
    const item = createItem('edit', {...draft.nominations[0], pageName: 'Local title', invalid: true, message: 'Local explanation'});
    const mixed = {mode: 'mixed', items: [item]};
    pages.get(REGISTER).text = pages.get(REGISTER).text.replace('request|ver=1|1a', 'request|ver=1|1b');
    await assert.rejects(submitWorkspace(mixed, () => {}, io), /已變更/);
    await reloadForReview(mixed, io);
    assert.equal(mixed.items[0].nomination.pageName, 'Local title');
    assert.equal(mixed.items[0].nomination.previousProposal.invalid, true);
    assert.equal(mixed.items[0].nomination.previousProposal.message, 'Local explanation');
    assert.equal(mixed.items[0].needsReview, true);
    await assert.rejects(submitWorkspace(mixed, () => {}, io), /差異/);
    assert.deepEqual(writes, []);
});
