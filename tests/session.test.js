import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionStore} from '../src/session/session-store.js';
import {createSubmitController} from '../src/session/session-submit.js';
import {sessionProgress} from '../src/nomination/operations.js';
import {ReviewConflict} from '../src/nomination/conflicts.js';
import {parseUserReason} from '../src/wiki/api.js';
import {reviewData} from '../src/nomination/scoring.js';
import {REGISTER, SCORES} from '../src/wiki/submission.js';

function fixture(defaultAwarder = '') {
    const values = new Map(), queues = new Map();
    const storage = {get length() { return values.size; }, key: i => [...values.keys()][i],
        getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
    const locks = {request(name, options, callback) {
        const prior = queues.get(name) || Promise.resolve();
        const next = prior.catch(() => {}).then(() => callback({name}));
        queues.set(name, next);
        return next;
    }};
    const reload = () => createSessionStore(storage, 'test', locks, defaultAwarder);
    return {storage, a: reload(), b: reload(), reload};
}
const nomination = {id: 'nom', pageName: '甲', awarder: 'A', ruleStatus: {}};

// 既有提名的操作須帶來源；同時開啟的修改／核對使用不同條目，遵守工作區的來源去重。
function dataForMode(mode, index = 1, checked = '') {
    const data = {...nomination, id: `nom-${index}`, pageName: `條目${index}`,
        ruleStatus: mode === 'new' ? {} : parseUserReason('1a')};
    if (mode === 'new') return data;
    const source = {date: '10月14日', index, values: {'條目名稱': data.pageName, '用戶名稱': 'A',
        '提名理由': '{{ACG提名2/request|ver=1|1a}}', '核對用': `{{ACG提名2/check|ver=1|${checked}}}`}};
    return mode === 'check' ? reviewData(data, source) : {...data, source};
}

test('blank and unchanged forms stay local until input and keep their order when first saved', async () => {
    const {a, b, storage} = fixture('A'); await a.init();
    const blank = {...nomination, pageName: ''};
    const {result: [first, second]} = await a.add('new', [blank, {...blank, id: 'second'}]);
    const {result: [edit]} = await a.add('edit', [dataForMode('edit', 2)]);
    const {result: [check]} = await a.add('check', [dataForMode('check', 3)]);
    assert.equal(storage.getItem(a.key), null);
    assert.deepEqual((await b.read()).items, []);
    const before = (await a.read()).items.find(item => item.id === second).nomination;
    await a.patch(second, before, {...before, pageName: '第二筆先輸入'});
    assert.deepEqual(JSON.parse(storage.getItem(a.key)).items.map(item => item.id), [second]);
    assert.deepEqual((await a.read()).items.map(item => item.id), [first, second, edit, check]);
    const {result: [other]} = await b.add('new', [{...nomination, id: 'other'}]);
    const stored = storage.getItem(a.key);
    assert.deepEqual((await a.read()).items.map(item => item.id), [first, second, edit, check, other]);
    assert.equal(storage.getItem(a.key), stored, 'local display order does not rewrite shared order');
    await a.patch(second, {...before, pageName: '第二筆先輸入'}, before);
    assert.deepEqual(JSON.parse(storage.getItem(a.key)).items.map(item => item.id), [other]);
    const original = (await a.read()).items.find(item => item.id === edit).nomination;
    await a.patch(edit, original, {...original, pageName: '修改名稱'});
    assert.ok((await b.read()).items.some(item => item.id === edit));
    await a.patch(edit, {...original, pageName: '修改名稱'}, original);
    assert.equal((await b.read()).items.some(item => item.id === edit), false);
    const review = (await a.read()).items.find(item => item.id === check).nomination;
    await a.patch(check, review, {...review, reviewed: true});
    assert.ok((await b.read()).items.some(item => item.id === check));
    await a.patch(first, blank, {...blank, awarder: 'Other'});
    assert.equal((await b.read()).items.find(item => item.id === first).nomination.awarder, 'Other');
});

test('invalid local data logs an error and permits initialization and fresh work', async context => {
    const errors = [];
    context.mock.method(console, 'error', (...args) => errors.push(args));
    for (const invalid of ['{', 'null', '[]', JSON.stringify({schema: 3, revision: 0,
        items: [null], drafts: [], fields: {message: '', summary: ''}, conflicts: [], submissions: []})]) {
        const {a, b, storage} = fixture();
        storage.setItem(a.key, invalid);
        const empty = await a.init();
        assert.deepEqual(empty.items, []);
        assert.deepEqual(empty.drafts, []);
        assert.equal(storage.getItem(a.key), invalid);
        await a.add('new', [nomination]);
        assert.equal((await b.read()).items[0].nomination.pageName, '甲');
    }
    assert.ok(errors.length >= 4);
});

test('shared edits merge distinct fields and retain both versions of a competing field', async () => {
    const {a, b} = fixture(); await a.init();
    const {result: [id]} = await a.add('new', [nomination]);
    const before = (await a.read()).items[0].nomination;
    await Promise.all([a.patch(id, before, {...before, pageName: '乙'}), b.patch(id, before, {...before, awarder: 'B'})]);
    assert.equal((await a.read()).items[0].nomination.pageName, '乙');
    assert.equal((await a.read()).items[0].nomination.awarder, 'B');
    await b.patch(id, before, {...before, pageName: '丙'});
    const conflict = (await a.read()).conflicts[0];
    assert.deepEqual([conflict.current, conflict.proposed], ['乙', '丙']);
    await a.resolve(conflict.id, true);
    assert.equal((await b.read()).items[0].nomination.pageName, '丙');
    assert.equal((await b.read()).items[0].nomination.awarder, 'B');
});

test('adopting a conflicting recipient after review requires a fresh review of the changed content', async () => {
    const {a, b} = fixture(); await a.init();
    const source = {date: '10月14日', index: 1, values: {'條目名稱': '甲', '用戶名稱': 'A', '提名理由': '{{ACG提名2/request|ver=1|1a}}', '核對用': ''}};
    const {result: [id]} = await a.add('check', [{...nomination, source, ruleStatus: parseUserReason('1a'), reviewed: false}]);
    const before = (await a.read()).items[0].nomination;
    await a.patch(id, before, {...before, awarder: 'B'});
    await b.patch(id, before, {...before, awarder: 'C'});
    const current = (await a.read()).items[0].nomination;
    await a.patch(id, current, {...current, reviewed: true});
    assert.equal((await a.read()).items[0].nomination.reviewed, true);
    await b.resolve((await b.read()).conflicts[0].id, true);
    const resolved = (await a.read()).items[0].nomination;
    assert.equal(resolved.awarder, 'C');
    assert.equal(resolved.reviewed, false);
    assert.equal(sessionProgress((await a.read())).complete, false);
    await a.patch(id, resolved, {...resolved, reviewed: true});
    assert.equal(sessionProgress((await b.read())).complete, true);
    const reviewed = (await b.read()).items[0].nomination;
    await b.patch(id, reviewed, {...reviewed, ruleStatus: parseUserReason('1b')});
    assert.equal(sessionProgress((await a.read())).complete, false, 'ordinary content updates enforce the same review boundary');
});

test('identical nominations keep separate edits and can be stashed and restored independently', async () => {
    const {a, b} = fixture(); await a.init();
    const first = dataForMode('edit');
    const second = {...first, id: 'nom-2', source: {...first.source, index: 2}};
    const {result: [firstId, secondId]} = await a.add('edit', [first, second]);
    assert.notEqual(firstId, secondId);
    assert.equal((await a.read()).items.length, 2);
    assert.deepEqual((await a.add('edit', [second])).result, [secondId]);
    await a.patch(firstId, first, {...first, pageName: '第一筆修改'});
    await a.patch(secondId, second, {...second, pageName: '第二筆修改'});
    assert.deepEqual((await b.read()).items.map(item => item.nomination.pageName), ['第一筆修改', '第二筆修改']);
    await a.stash(firstId);
    assert.deepEqual((await b.read()).items.map(item => item.id), [secondId]);
    assert.deepEqual((await b.restore([firstId])).result, {restored: [firstId], failures: []});
    assert.equal((await a.read()).items.length, 2);
    assert.deepEqual((await a.read()).drafts, []);
});

test('all operation types move through the draft box without moving submission fields', async () => {
    const {a, b} = fixture(); await a.init();
    await a.fields({message: '', summary: ''}, {message: '整批說明', summary: '摘要'});
    for (const mode of ['new', 'edit', 'check']) {
        const {result: [id]} = await a.add(mode, [dataForMode(mode)]);
        await a.stash(id);
        assert.equal((await b.read()).items.length, 0);
        assert.equal((await b.read()).drafts[0].mode, mode);
        assert.ok(!('message' in (await b.read()).drafts[0]));
        await b.restore([id]);
        assert.equal((await a.read()).drafts.length, 0);
        await b.discard(id);
        assert.equal((await b.read()).items.length, 0);
    }
    assert.deepEqual((await a.read()).fields, {message: '整批說明', summary: '摘要'});
});

test('restoring drafts leaves blocked entries intact and restores the rest after a missing selection', async () => {
    const {a, b, storage} = fixture(); await a.init();
    const data = {...dataForMode('edit'), pageName: '保留的本地條目名稱', ruleStatus: parseUserReason('1a(自訂說明)[2]')};
    const {result: [blocked]} = await a.add('edit', [data]);
    await a.stash(blocked);
    const original = (await a.read()).drafts[0];
    await a.add('edit', [dataForMode('edit')]);
    const {result: [unavailable]} = await a.add('edit', [{...dataForMode('edit', 2), pageName: '原列不存在的草稿'}]);
    await a.stash(unavailable, true);
    const parked = (await a.read()).drafts.find(item => item.id === unavailable);
    const {result: [missing, valid]} = await a.add('new', [nomination, {...nomination, id: 'another', pageName: '可恢復的條目'}]);
    await a.stash(missing); await a.stash(valid);
    await b.discard(missing, true);
    const before = await a.read(), write = storage.setItem;
    storage.setItem = () => { throw new Error('quota'); };
    const available = item => item.id !== unavailable;
    await assert.rejects(a.restore([blocked, missing, unavailable, valid], available), /quota/);
    assert.deepEqual(await a.read(), before);
    storage.setItem = write;
    const {result} = await a.restore([blocked, missing, unavailable, valid], available);
    assert.deepEqual(result.restored, [valid]);
    assert.deepEqual(result.failures.map(failure => failure.id), [blocked, missing, unavailable]);
    assert.match(result.failures[0].reason, /已在表單/);
    assert.match(result.failures[1].reason, /另一個分頁/);
    const restored = await b.read();
    assert.match(result.failures[2].reason, /找不到原提名/);
    assert.deepEqual(restored.drafts, [original, parked]);
    assert.equal(restored.items.at(-1).id, valid);
});

test('failed local writes leave source and destination intact and stale edits cannot resurrect cancelled work', async () => {
    const {a, b, storage} = fixture(); await a.init();
    const {result: [id]} = await a.add('new', [nomination]);
    const before = (await a.read());
    const save = storage.setItem;
    storage.setItem = () => { throw new Error('quota'); };
    await assert.rejects(a.stash(id), /quota/);
    assert.deepEqual((await a.read()), before);
    storage.setItem = save;
    await b.discard(id);
    await assert.rejects(a.patch(id, nomination, {...nomination, pageName: '乙'}), /取消或暫存/);
    assert.equal((await a.read()).items.length, 0);
});

test('stash all moves current editable work atomically and retains pending saves and submission fields', async () => {
    const {a, b, storage} = fixture(); await a.init();
    await a.fields({message: '', summary: ''}, {message: '整批說明', summary: '摘要'});
    const ids = [];
    for (const [mode, data] of [['new', dataForMode('new', 1)], ['edit', {...dataForMode('edit', 2), pageName: '本地修改'}],
        ['check', {...dataForMode('check', 3), message: '核對中的說明'}], ['check', dataForMode('check', 4, '0')]]) {
        const {result: [id]} = await a.add(mode, [data]); ids.push(id);
    }
    const {result: [pending]} = await a.add('new', [{...nomination, ruleStatus: parseUserReason('1a')}]);
    await a.mutate(session => session.submissions.push({id: 'saving', createdAt: Date.now(), itemIds: [pending],
        draft: {mode: 'mixed', items: [session.items.find(item => item.id === pending)], message: '', summary: ''}}));
    // 另一分頁在暫存前完成的輸入，應直接進入草稿箱，而不是被舊快照蓋回去。
    const beforeEdit = (await b.read()).items[1].nomination;
    await b.patch(ids[1], beforeEdit, {...beforeEdit, pageName: '另一分頁的修改'});
    const before = (await a.read()), write = storage.setItem;
    storage.setItem = () => { throw new Error('quota'); };
    await assert.rejects(a.stashAll(), /quota/);
    assert.deepEqual((await a.read()), before);
    storage.setItem = write;
    await a.mutate(session => session.conflicts.push({id: 'conflict', itemId: ids[2], field: 'pageName', current: '甲', proposed: '乙'}));
    const conflicted = (await a.read());
    await assert.rejects(a.stashAll(), /分頁衝突/);
    assert.deepEqual((await a.read()), conflicted);
    await b.resolve('conflict', false);
    assert.equal((await a.stashAll()).result, 4);
    const after = (await b.read());
    assert.deepEqual(after.items.map(item => item.id), [pending]);
    assert.deepEqual(after.drafts.map(item => item.id), ids);
    assert.equal(after.drafts[1].nomination.pageName, '另一分頁的修改');
    assert.deepEqual(after.fields, before.fields);
    assert.deepEqual(after.submissions, before.submissions);
    await b.restore(ids);
    assert.equal((await b.read()).items.length, 5);
    assert.equal((await a.read()).drafts.length, 0);
});

test('successful submission delivers its result to the page and preserves later input from another tab', async () => {
    const {a, b, storage, reload} = fixture(); await a.init();
    await a.add('new', [{...nomination, ruleStatus: parseUserReason('1a')}]);
    await a.fields({message: '', summary: ''}, {message: '已送出的說明', summary: '已送出的摘要'});
    const expected = {items: sessionProgress((await a.read())).items, fields: (await a.read()).fields};
    const io = {
        read: async () => ({text: '頁首', revid: 1}),
        write: async edit => {
            assert.equal(edit.title, REGISTER);
            await b.add('new', [{...nomination, id: 'later', pageName: '稍後新增'}]);
            await b.fields(expected.fields, {message: '下一批說明', summary: '下一批摘要'});
            return {revid: 2};
        },
    };
    let result;
    await createSubmitController(a, completed => { if (completed) result = completed; }, io).start(expected);
    assert.deepEqual((await a.read()).items.map(item => item.nomination.id), ['later']);
    assert.deepEqual((await a.read()).fields, {message: '下一批說明', summary: '下一批摘要'});
    const saved = JSON.parse(storage.getItem(a.key));
    assert.deepEqual(saved.submissions, []);
    assert.equal(typeof result.id, 'string');
    assert.deepEqual(result, {id: result.id,
        steps: [{key: 'registry', title: REGISTER, status: 'succeeded', revid: 2}]});
    assert.doesNotMatch(storage.getItem(a.key), /已送出的說明|已送出的摘要/);
    assert.deepEqual((await reload().init()).submissions, []);
    assert.deepEqual((await a.read()).submissions, []);
});

test('returning from a failed save permits offline editing without another query or write', async () => {
    const {a, b} = fixture(); await a.init();
    await a.add('new', [{...nomination, ruleStatus: parseUserReason('1a')}]);
    await a.fields({message: '', summary: ''}, {message: '保留說明', summary: '保留摘要'});
    const initial = await a.read();
    let offline = false, calls = 0;
    const io = {
        read: async () => { calls++; if (offline) throw new Error('offline'); return {text: '頁首', revid: 1}; },
        write: async () => { calls++; offline = true; throw new Error('offline'); },
    };
    const controller = createSubmitController(a, () => {}, io);
    assert.equal(await controller.start({items: initial.items, fields: initial.fields}), false);
    const pending = await a.read(), requests = calls;
    assert.equal(pending.submissions[0].draft.operation.steps[0].status, 'failed');
    await controller.returnToEditing(pending.submissions[0].id);
    const editable = await a.read();
    assert.deepEqual(editable.submissions, []);
    assert.deepEqual(editable.items, initial.items);
    assert.deepEqual(editable.fields, initial.fields);
    const item = editable.items[0];
    await a.patch(item.id, item.nomination, {...item.nomination, pageName: '離線修改'});
    const restored = await b.init();
    assert.equal(restored.items[0].nomination.pageName, '離線修改');
    assert.deepEqual(restored.fields, initial.fields);
    assert.equal(calls, requests, 'returning, editing and restoring only use local storage');
});

test('reading collects only orphaned submissions older than six hours and never deletes editing data', async context => {
    const now = Date.UTC(2026, 9, 22, 12), sixHours = 6 * 60 * 60 * 1000;
    context.mock.method(Date, 'now', () => now);
    const {a, b, storage} = fixture(); await a.init();
    const {result: [active]} = await a.add('new', [nomination]);
    const {result: [stashed]} = await a.add('new', [{...nomination, id: 'stashed'}]);
    await a.stash(stashed);
    await a.fields({message: '', summary: ''}, {message: '下一批說明', summary: '摘要'});
    // 直接放入已失去表單引用的殘留紀錄，驗證垃圾清理，不以刪表單來製造過期。
    const before = await a.read();
    before.submissions = [
        {id: 'orphan', itemIds: ['removed'], createdAt: now - sixHours - 1},
        {id: 'boundary', itemIds: ['also-removed'], createdAt: now - sixHours},
        {id: 'active', itemIds: [active], createdAt: now - sixHours - 1},
        {id: 'stashed', itemIds: [stashed], createdAt: now - sixHours - 1},
        {id: 'archive', itemIds: [], createdAt: now - sixHours - 1},
    ].map(submission => ({...submission, draft: {mode: submission.id === 'archive' ? 'archive' : 'mixed'}}));
    storage.setItem(a.key, JSON.stringify(before));
    const after = await b.read();
    assert.deepEqual(after.submissions.map(item => item.id), ['boundary', 'active', 'stashed', 'archive']);
    assert.deepEqual(after.items, before.items);
    assert.deepEqual(after.drafts, before.drafts);
    assert.deepEqual(after.fields, before.fields);
    assert.deepEqual(after.conflicts, before.conflicts);
    assert.deepEqual(JSON.parse(storage.getItem(a.key)), after);
    assert.deepEqual(await a.read(), after, 'subsequent reads do not rewrite the same state');
});

test('a partial submission remains resumable after six hours and clears its content only on full success', async context => {
    let now = Date.UTC(2026, 9, 22, 12);
    context.mock.method(Date, 'now', () => now);
    const {a, storage, reload} = fixture(); await a.init();
    const check = {...dataForMode('check'), reviewed: true};
    await a.add('check', [check]);
    await a.add('new', [{...nomination, id: 'added', pageName: '新增條目', ruleStatus: parseUserReason('1a')}]);
    await a.fields({message: '', summary: ''}, {message: '這批說明', summary: '這批摘要'});
    const initial = await a.read(), writes = [];
    const source = `=== 10月14日 ===\n{{ACG提名2\n${Object.entries(check.source.values).map(([name, value]) => `|${name}1 = ${value}`).join('\n')}\n}}\n'''提名人：'''[[User:Nominator]]`;
    const pages = new Map([[REGISTER, {text: source, revid: 1}], [SCORES, {text: 'return {\n ["A"] = 10,\n}', revid: 1}]]);
    let fail = true;
    const io = {
        read: async title => structuredClone(pages.get(title)),
        write: async edit => {
            if (edit.title === SCORES && fail) throw new Error('editconflict');
            writes.push(edit.title);
            const revid = pages.get(edit.title).revid + 1;
            pages.set(edit.title, {text: edit.text, revid});
            return {revid};
        },
    };
    let result;
    const controller = createSubmitController(a, completed => { if (completed) result = completed; }, io);
    assert.equal(await controller.start({items: sessionProgress(initial).items, fields: initial.fields}), false);
    assert.equal(result, undefined);
    now += 7 * 60 * 60 * 1000;
    const pending = await a.read();
    assert.deepEqual(pending.items, initial.items);
    assert.deepEqual(pending.fields, initial.fields);
    assert.equal(pending.submissions[0].createdAt, now - 7 * 60 * 60 * 1000);
    assert.deepEqual(pending.submissions[0].draft.operation.steps.map(step => step.status), ['succeeded', 'failed']);
    assert.deepEqual((await reload().init()).submissions, pending.submissions);
    await a.stash(initial.items.find(item => item.mode === 'check').id, true);
    assert.equal((await a.read()).drafts.length, 1);
    fail = false;
    assert.equal(await controller.step(pending.submissions[0].id, 'scores'), true);
    const saved = JSON.parse(storage.getItem(a.key));
    assert.deepEqual(writes, [REGISTER, SCORES]);
    assert.deepEqual(saved.items, []);
    assert.deepEqual(saved.drafts, []);
    assert.deepEqual(saved.fields, {message: '', summary: ''});
    assert.deepEqual(saved.submissions, []);
    assert.deepEqual(result, {id: pending.submissions[0].id, steps: [
        {key: 'registry', title: REGISTER, status: 'succeeded', revid: 2},
        {key: 'scores', title: SCORES, status: 'succeeded', revid: 2},
    ]});
    assert.doesNotMatch(storage.getItem(a.key), /這批說明|這批摘要|新增條目|edit|submitted/);
    assert.deepEqual((await reload().init()).submissions, []);
    assert.deepEqual((await a.read()).submissions, []);
});

test('reloading an edit conflict replaces the pending submission with the retained proposal for review', async () => {
    const {a} = fixture(); await a.init();
    const original = dataForMode('edit');
    const proposedRules = parseUserReason('1c(本地自訂規則)[2]');
    await a.add('edit', [{...original, pageName: 'Local title', awarder: 'B', ruleStatus: proposedRules}]);
    const initial = await a.read();
    const text = `=== 10月14日 ===\n{{ACG提名2\n${Object.entries(original.source.values).map(([name, value]) => `|${name}1 = ${value}`).join('\n')}\n}}`
        .replace('request|ver=1|1a', 'request|ver=1|1b');
    let reads = 0, writes = 0;
    const io = {read: async () => { reads++; return {text, revid: 2}; },
        write: async () => { writes++; throw new Error('unexpected write'); }};
    const controller = createSubmitController(a, () => {}, io);
    await assert.rejects(controller.start({items: initial.items, fields: initial.fields}), ReviewConflict);
    const pending = await a.read();
    assert.deepEqual(pending.items, initial.items);
    await controller.rebase(pending.submissions[0].id);
    const refreshed = await a.read(), item = refreshed.items[0];
    assert.deepEqual(refreshed.submissions, []);
    assert.equal(item.nomination.pageName, 'Local title');
    assert.equal(item.nomination.previousProposal.awarder, 'B');
    assert.deepEqual(item.nomination.previousProposal.ruleStatus, proposedRules);
    assert.equal(item.needsReview, true);
    assert.match(item.nomination.source.values['提名理由'], /1b/);
    assert.equal(sessionProgress(refreshed).complete, false);
    assert.equal(reads, 2);
    assert.equal(writes, 0);
});

test('per-type completion counts share submission eligibility and exclude unchanged or submitted work', () => {
    const valid = {...nomination, ruleStatus: parseUserReason('1a')};
    const session = {items: [
        {id: 'new-ready', mode: 'new', nomination: valid},
        {id: 'new-empty', mode: 'new', nomination: {...valid, id: 'empty-nomination', pageName: ''}},
        {id: 'new-saving', mode: 'new', nomination: {...valid, id: 'saving-nomination', pageName: '已提交的新條目'}},
        {id: 'edit-ready', mode: 'edit', nomination: {...dataForMode('edit', 4), pageName: '更名後條目4'}},
        {id: 'edit-unchanged', mode: 'edit', nomination: dataForMode('edit', 5)},
        {id: 'check-ready', mode: 'check', nomination: {...dataForMode('check', 6), reviewed: true}},
        {id: 'check-pending', mode: 'check', nomination: dataForMode('check', 7)},
        {id: 'check-conflict', mode: 'check', nomination: {...dataForMode('check', 8), reviewed: true}},
        {id: 'recheck-zero', mode: 'check', nomination: {...dataForMode('check', 9, '0'), reviewed: true}},
        {id: 'recheck-pending', mode: 'check', nomination: {...dataForMode('check', 10, '1a')}},
        {id: 'recheck-conflict', mode: 'check', nomination: {...dataForMode('check', 11, '1a'), reviewed: true}},
    ], submissions: [{itemIds: ['new-saving']}], conflicts: [{itemId: 'check-conflict'}, {itemId: 'recheck-conflict'}]};
    const progress = sessionProgress(session);
    assert.deepEqual(progress.byType, {new: {ready: 1, total: 2}, edit: {ready: 1, total: 1}, check: {ready: 1, total: 3}, recheck: {ready: 1, total: 3}});
    assert.equal(progress.ready, 4);
    assert.equal(progress.total, 9);
    assert.equal(progress.complete, false);
});
