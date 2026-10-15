import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionStore} from '../src/session-store.js';
import {createSubmitController} from '../src/session-submit.js';
import {sessionProgress} from '../src/operations.js';
import {parseUserReason} from '../src/api.js';
import {REGISTER} from '../src/submission.js';

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
    const operation = {id: 'request', steps: [{status: 'unknown', attempt: {text: '已發出的原文'}}]};
    storage.setItem('test:library', JSON.stringify({schema: 2, drafts: [
        {id: 'open', mode: 'new', open: true, nominations: [nomination], message: '說明'},
        {id: 'stash', mode: 'new', open: false, nominations: [{...nomination, id: 'other'}]},
        {id: 'pending', mode: 'check', nominations: [nomination], operation},
    ]}));
    const original = storage.getItem('test:library'), write = storage.setItem;
    storage.setItem = () => { throw new Error('quota'); };
    await assert.rejects(a.init(), /quota/);
    assert.equal(storage.getItem('test:library'), original);
    assert.equal(storage.getItem('test:session'), null);
    storage.setItem = write;
    const session = await a.init();
    assert.equal(session.items.length, 2);
    assert.equal(session.drafts.length, 1);
    assert.equal(session.fields.message, '說明');
    assert.deepEqual(session.submissions[0].draft.operation, operation);
    assert.deepEqual(await a.init(), session);
});


test('successful submission clears only its frozen items and preserves later input from another tab', async () => {
    const {a, b} = fixture(); await a.init();
    await a.add('new', [{...nomination, ruleStatus: parseUserReason('1a')}]);
    await a.fields({message: '', summary: ''}, {message: '已送出的說明', summary: '已送出的摘要'});
    const expected = {items: sessionProgress(a.read()).items, fields: a.read().fields};
    const io = {
        read: async () => ({text: '頁首', revid: 1}), findReceipt: async () => null,
        write: async attempt => {
            assert.equal(attempt.title, REGISTER);
            await b.add('new', [{...nomination, id: 'later', pageName: '稍後新增'}]);
            await b.fields(expected.fields, {message: '下一批說明', summary: '下一批摘要'});
            return {revid: 2};
        },
    };
    await createSubmitController(a, () => {}, io).start(expected);
    assert.deepEqual(a.read().items.map(item => item.nomination.id), ['later']);
    assert.deepEqual(a.read().fields, {message: '下一批說明', summary: '下一批摘要'});
    assert.equal(a.read().submissions[0].finished, true);
});

test('per-type completion counts share submission eligibility and exclude unchanged or submitted work', () => {
    const valid = {...nomination, ruleStatus: parseUserReason('1a')};
    const source = {date: '10月14日', index: 1, values: {'條目名稱': '甲', '用戶名稱': 'A', '提名理由': '{{ACG提名2/request|ver=1|1a}}', '核對用': ''}};
    const check = {...valid, source, booking: 'unbooked', reviewed: true};
    const session = {items: [
        {id: 'new-ready', mode: 'new', nomination: valid},
        {id: 'new-empty', mode: 'new', nomination: {...valid, pageName: ''}},
        {id: 'new-saving', mode: 'new', nomination: valid},
        {id: 'edit-ready', mode: 'edit', nomination: {...valid, source, pageName: '乙'}},
        {id: 'edit-unchanged', mode: 'edit', nomination: {...valid, source}},
        {id: 'check-ready', mode: 'check', nomination: check},
        {id: 'check-pending', mode: 'check', nomination: {...check, reviewed: false}},
        {id: 'check-conflict', mode: 'check', nomination: check},
        {id: 'recheck-zero', mode: 'check', nomination: {...check, original: {score: 0}}},
        {id: 'recheck-pending', mode: 'check', nomination: {...check, original: {score: 1}, reviewed: false}},
        {id: 'recheck-conflict', mode: 'check', nomination: {...check, original: {score: 1}}},
    ], submissions: [{itemIds: ['new-saving']}], conflicts: [{itemId: 'check-conflict'}, {itemId: 'recheck-conflict'}]};
    const progress = sessionProgress(session);
    assert.deepEqual(progress.byType, {new: {ready: 1, total: 2}, edit: {ready: 1, total: 1}, check: {ready: 1, total: 3}, recheck: {ready: 1, total: 3}});
    assert.equal(progress.ready, 4);
    assert.equal(progress.total, 9);
    assert.equal(progress.complete, false);
});
