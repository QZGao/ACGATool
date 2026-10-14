import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftStore} from '../src/drafts.js';

const nomination = id => ({id, pageName: id, awarder: 'Example', ruleStatus: {}});
const draft = (id, ids, extra = {}) => ({id, mode: 'new', nominations: ids.map(nomination), message: '', ...extra});
function fixture() {
    const values = new Map();
    const storage = {
        get length() { return values.size; }, key: i => [...values.keys()][i],
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key),
    };
    return {values, storage, store: createDraftStore(storage, 'site:user')};
}

test('stash and multi-restore move individual entries and preserve live form references', () => {
    const {store} = fixture();
    const active = draft('active', ['A', 'B', 'C'], {open: true, message: '共同說明'});
    store.save(active);
    const first = active.nominations[0], last = active.nominations[2];
    const stash = draft('stash', []);
    store.transfer([{draft: active, nominationIds: ['B']}], stash);
    assert.deepEqual(active.nominations.map(n => n.id), ['A', 'C']);
    assert.equal(active.nominations[0], first);
    assert.equal(active.nominations[1], last);
    assert.deepEqual(stash.nominations.map(n => n.id), ['B']);
    assert.equal(stash.message, '共同說明');
    assert.equal(store.active().id, 'active');
    const other = draft('other', ['D', 'E'], {message: '另一段說明'}); store.save(other);
    store.transfer([{draft: stash, nominationIds: ['B']}, {draft: other, nominationIds: ['E']}], active);
    assert.deepEqual(active.nominations.map(n => n.id), ['A', 'C', 'B', 'E']);
    assert.equal(active.nominations[0], first);
    assert.equal(active.message, '共同說明\n\n另一段說明');
    assert.deepEqual(store.list().find(d => d.id === 'other').nominations.map(n => n.id), ['D']);
    assert.ok(!store.list().some(d => d.id === 'stash'));
});

test('stale selections and capacity limits leave every draft unchanged', () => {
    const {store, values} = fixture();
    const source = draft('source', ['A']); store.save(source);
    const stale = structuredClone(source); source.message = '更新'; store.save(source);
    const target = draft('target', []), before = JSON.stringify([...values]);
    assert.throws(() => store.transfer([{draft: stale, nominationIds: ['A']}], target), /另一個分頁/);
    assert.equal(JSON.stringify([...values]), before);
    const full = draft('full', Array.from({length: 25}, (_, i) => `item${i}`)); store.save(full);
    const fullBefore = JSON.stringify([...values]);
    assert.throws(() => store.transfer([{draft: source, nominationIds: ['A']}], full), /25/);
    assert.equal(JSON.stringify([...values]), fullBefore);
    assert.equal(full.nominations.length, 25);
});

test('a failed local write cannot remove rows from either source or target', () => {
    const {store, storage, values} = fixture();
    const source = draft('source', ['A', 'B']), target = draft('target', ['C']);
    store.save(source); store.save(target);
    const before = JSON.stringify([...values]), sourceBefore = structuredClone(source), targetBefore = structuredClone(target);
    storage.setItem = () => { throw new Error('quota'); };
    assert.throws(() => store.transfer([{draft: source, nominationIds: ['A']}], target), /quota/);
    assert.equal(JSON.stringify([...values]), before);
    assert.deepEqual(source, sourceBefore);
    assert.deepEqual(target, targetBefore);
});

test('legacy drafts migrate only after a successful complete write', () => {
    const {store, storage, values} = fixture();
    const legacy = {...draft('old', ['A', 'B']), schema: 1, storageVersion: 3};
    storage.setItem('site:user:old', JSON.stringify(legacy));
    storage.setItem('other:user:keep', 'unrelated');
    assert.deepEqual(store.list(), [legacy]);
    const target = draft('target', []), write = storage.setItem;
    storage.setItem = () => { throw new Error('quota'); };
    assert.throws(() => store.transfer([{draft: legacy, nominationIds: ['B']}], target));
    assert.ok(values.has('site:user:old'));
    assert.equal(values.has('site:user:library'), false);
    storage.setItem = write;
    store.transfer([{draft: legacy, nominationIds: ['B']}], target);
    assert.equal(values.has('site:user:old'), false);
    assert.equal(values.get('other:user:keep'), 'unrelated');
    assert.deepEqual(store.list().map(d => [d.id, d.nominations.map(n => n.id)]), [['old', ['A']], ['target', ['B']]]);
    // 遷移後，尚未重新整理的舊版分頁新增的草稿也應可見。
    storage.setItem('site:user:late', JSON.stringify({...draft('late', ['C']), schema: 1, storageVersion: 1}));
    assert.equal(store.list().find(d => d.id === 'late').nominations[0].id, 'C');
    store.save(target);
    assert.equal(values.has('site:user:late'), false);
});

test('open forms resume independently of stashes and saved operations remain intact', () => {
    const {store} = fixture();
    const workspace = draft('open', ['A'], {open: true}); store.save(workspace);
    const stash = draft('stash', []);
    store.transfer([{draft: workspace, nominationIds: ['A']}], stash);
    assert.equal(store.active(), null);
    const restored = draft('restored', [], {open: true});
    store.transfer([{draft: stash, nominationIds: ['A']}], restored);
    assert.equal(store.active().id, 'restored');
    restored.open = false; store.save(restored);
    assert.equal(store.active(), null);
    restored.operation = {steps: [{status: 'unknown'}]}; store.save(restored);
    assert.throws(() => store.transfer([{draft: restored, nominationIds: ['A']}], draft('new', [])), /無法/);
    assert.deepEqual(store.list()[0].operation, restored.operation);
    store.remove(restored);
    assert.deepEqual(store.list(), []);
});
