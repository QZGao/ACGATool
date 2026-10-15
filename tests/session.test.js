import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionStore} from '../src/session-store.js';
import {createDraftStore} from '../src/drafts.js';

function fixture() {
    const values = new Map(), queues = new Map();
    const storage = {get length() { return values.size; }, key: i => [...values.keys()][i],
        getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
    const locks = {request(name, options, callback) {
        const prior = queues.get(name) || Promise.resolve();
        const next = prior.catch(() => {}).then(() => callback({name}));
        queues.set(name, next);
        return next;
    }};
    return {storage, a: createSessionStore(storage, 'test', locks), b: createSessionStore(storage, 'test', locks)};
}
const nomination = {id: 'nom', pageName: '甲', awarder: 'A', ruleStatus: {}};

test('shared edits merge distinct fields and retain both versions of a competing field', async () => {
    const {a, b} = fixture(); await a.init();
    const {result: [id]} = await a.add('new', [nomination]);
    const before = a.read().items[0].nomination;
    await Promise.all([a.patch(id, before, {...before, pageName: '乙'}), b.patch(id, before, {...before, awarder: 'B'})]);
    assert.equal(a.read().items[0].nomination.pageName, '乙');
    assert.equal(a.read().items[0].nomination.awarder, 'B');
    await b.patch(id, before, {...before, pageName: '丙'});
    const conflict = a.read().conflicts[0];
    assert.deepEqual([conflict.current, conflict.proposed], ['乙', '丙']);
    await a.resolve(conflict.id, true);
    assert.equal(b.read().items[0].nomination.pageName, '丙');
    assert.equal(b.read().items[0].nomination.awarder, 'B');
});

test('all operation types move through the draft box without moving submission fields', async () => {
    const {a, b} = fixture(); await a.init();
    await a.fields({message: '', summary: ''}, {message: '整批說明', summary: '摘要'});
    for (const mode of ['new', 'edit', 'check']) {
        const {result: [id]} = await a.add(mode, [nomination]);
        await a.stash(id);
        assert.equal(b.read().items.length, 0);
        assert.equal(b.read().drafts[0].mode, mode);
        assert.ok(!('message' in b.read().drafts[0]));
        await b.restore([id]);
        assert.equal(a.read().drafts.length, 0);
        await a.discard(id);
        assert.equal(b.read().items.length, 0);
    }
    assert.deepEqual(a.read().fields, {message: '整批說明', summary: '摘要'});
});

test('failed local writes leave source and destination intact and stale edits cannot resurrect cancelled work', async () => {
    const {a, b, storage} = fixture(); await a.init();
    const {result: [id]} = await a.add('new', [nomination]);
    const before = a.read();
    const save = storage.setItem;
    storage.setItem = () => { throw new Error('quota'); };
    await assert.rejects(a.stash(id), /quota/);
    assert.deepEqual(a.read(), before);
    storage.setItem = save;
    await b.discard(id);
    await assert.rejects(a.patch(id, nomination, {...nomination, pageName: '乙'}), /取消或暫存/);
    assert.equal(a.read().items.length, 0);
});

test('migration preserves pending requests and separates old stashes from open work', async () => {
    const {a, storage} = fixture();
    const legacy = createDraftStore(storage, 'test');
    legacy.save({id: 'open', mode: 'new', open: true, nominations: [nomination], message: '說明'});
    legacy.save({id: 'stash', mode: 'new', open: false, nominations: [{...nomination, id: 'other'}]});
    const operation = {id: 'request', steps: [{status: 'unknown', attempt: {text: '已發出的原文'}}]};
    legacy.save({id: 'pending', mode: 'check', nominations: [nomination], operation});
    const session = await a.init();
    assert.equal(session.items.length, 2);
    assert.equal(session.drafts.length, 1);
    assert.equal(session.fields.message, '說明');
    assert.deepEqual(session.submissions[0].draft.operation, operation);
    assert.deepEqual(await a.init(), session);
});
