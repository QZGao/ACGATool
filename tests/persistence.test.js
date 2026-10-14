import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftStore, clearSubmittedDraft} from '../src/drafts.js';
import {submitWorkspace, REGISTER, SCORES} from '../src/submission.js';
import {entryValues, queryEntry, queried2NomData} from '../src/api.js';
import {reviewData} from '../src/scoring.js';

function storage() {
    const items = new Map();
    return {get length() { return items.size; }, key: i => [...items.keys()][i],
        getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key)};
}
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
    const text = '=== 10月14日 ===\n{{ACG提名2\n|條目名稱1 = Test\n|用戶名稱1 = A\n|提名理由1 = {{ACG提名2/request|ver=1|1a}}\n|核對用1 = {{ACG提名2/check|ver=1|}}\n}}';
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
