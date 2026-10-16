import test from 'node:test';
import assert from 'node:assert/strict';
import {hasRecentActivity, prepareArchive, submitArchive} from '../src/wiki/archive.js';
import {REGISTER} from '../src/wiki/submission.js';

function fixture() {
    const source = '頁首\n=== 10月14日 ===\n提名內容\n提名人：[[User:Nominator]] 2026年10月14日 (三) 13:00 (UTC)\n';
    const pages = new Map([[REGISTER, {text: source, revid: 1}]]), writes = [];
    const io = {read: async title => structuredClone(pages.get(title) || {text: '', revid: 0, missing: true}), findReceipt: async () => null,
        write: async attempt => {
            const page = pages.get(attempt.title);
            if ((page?.revid || 0) !== attempt.base.revid) throw Object.assign(new Error('editconflict'), {uncertain: false});
            writes.push(attempt.title);
            pages.set(attempt.title, {text: attempt.text, revid: (page?.revid || 0) + 1});
            return {revid: (page?.revid || 0) + 1};
        }};
    return {pages, writes, io};
}

test('archive hint uses the latest valid UTC signature and the exact seven-day boundary', () => {
    const latest = Date.UTC(2026, 9, 14, 13), week = 7 * 24 * 60 * 60 * 1000;
    const source = '=== 10月1日 ===\n核對人：2026年10月14日 (三) 13:00 (UTC)\n提名人：2026年10月1日 (四) 09:00 (UTC)';
    assert.equal(hasRecentActivity(source, latest + week - 1), true);
    assert.equal(hasRecentActivity(source, latest + week), false);
    assert.equal(hasRecentActivity('2026年10月14日（三）13：00（UTC）', latest), true);
    assert.equal(hasRecentActivity('沒有簽名 <!--2026年10月14日 (三) 13:00 (UTC)-->', latest), false);
    assert.equal(hasRecentActivity('2026年9月44日 (三) 13:00 (UTC)', latest), false);
});

test('partial archive recovery retries only registry removal and never appends twice', async () => {
    const {io, writes, pages} = fixture();
    const draft = await prepareArchive('10月14日', io), write = io.write;
    let fail = true;
    io.write = attempt => {
        if (attempt.title === REGISTER && fail) { fail = false; throw Object.assign(new Error('denied'), {uncertain: false}); }
        return write(attempt);
    };
    assert.equal(await submitArchive(draft, () => {}, io), false);
    assert.equal(draft.operation.steps[0].status, 'succeeded');
    assert.equal(await submitArchive(structuredClone(draft), () => {}, io, {stepKey: 'registry', kind: 'retry'}), true);
    assert.deepEqual(writes, [draft.archive.target, REGISTER]);
    assert.equal(pages.get(draft.archive.target).text.split('提名內容').length, 2);
});

test('changed registry content is retained after archiving and uncertain queries do not remove it', async () => {
    const {io, writes, pages} = fixture();
    const draft = await prepareArchive('10月14日', io), write = io.write;
    io.write = async attempt => { await write(attempt); throw Object.assign(new Error('timeout'), {uncertain: true}); };
    const read = io.read;
    let hide = true;
    io.read = async (title, options) => hide && title === draft.archive.target ? {text: '', revid: 0, missing: true} : read(title, options);
    assert.equal(await submitArchive(draft, () => {}, io), false);
    assert.equal(draft.operation.steps[0].status, 'unknown');
    hide = false; io.write = write;
    assert.equal(await submitArchive(draft, () => {}, io, {stepKey: 'archive', kind: 'query'}), false);
    assert.deepEqual(writes, [draft.archive.target]);
    pages.get(REGISTER).text += '稍後新增的留言';
    assert.equal(await submitArchive(draft, () => {}, io, {stepKey: 'registry', kind: 'retry'}), false);
    assert.match(pages.get(REGISTER).text, /稍後新增的留言/);
    assert.deepEqual(writes, [draft.archive.target]);
});
