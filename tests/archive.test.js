import test from 'node:test';
import assert from 'node:assert/strict';
import {hasRecentActivity, prepareArchive, submitArchive} from '../src/wiki/archive.js';
import {REGISTER} from '../src/wiki/submission.js';

// 摘自已有的「WikiProject:ACG/維基ACG專題獎/登記處」頁面快照，保留提名與簽名原文。
const section = `=== 9月28日 ===
{{ACG提名2
|條目名稱1 = 超閾限空間
|用戶名稱1 = 菜國人
|提名理由1 = {{ACG提名2/request|ver=1|1c 3}}
|核對用1 = {{ACG提名2/check|ver=1|}}
}}
'''提名人：'''[[User talk:For Each ... Next|𝙵𝚘𝚛 𝙴𝚊𝚌𝚑 ... 𝙽𝚎𝚡𝚝]] 2026年9月28日 (一) 14:42 (UTC)

`;

function fixture() {
    const source = '頁首\n' + section;
    const pages = new Map([[REGISTER, {text: source, revid: 1}]]), writes = [];
    const io = {read: async title => structuredClone(pages.get(title) || {text: '', revid: 0, missing: true}),
        write: async edit => {
            assert.doesNotMatch(edit.summary, /\[ACGATool:/);
            assert.doesNotMatch(edit.text, /<!--\/?ACGATool/);
            const page = pages.get(edit.title);
            if ((page?.revid || 0) !== edit.base.revid) throw new Error('editconflict');
            writes.push(edit.title);
            pages.set(edit.title, {text: edit.text, revid: (page?.revid || 0) + 1});
            return {revid: (page?.revid || 0) + 1};
        }};
    return {pages, writes, io};
}

test('archive hint uses the latest valid UTC signature and the exact seven-day boundary', () => {
    const latest = Date.UTC(2026, 9, 14, 13), week = 7 * 24 * 60 * 60 * 1000;
    const source = '=== 10月1日 ===\n核對人：2026年10月14日 (三) 13:00 (UTC)\n提名人：2026年10月1日 (四) 09:00 (UTC)';
    assert.equal(hasRecentActivity(source, latest + week - 1), true);
    assert.equal(hasRecentActivity(source, latest + week), false);
    assert.equal(hasRecentActivity('沒有簽名 <!--2026年10月14日 (三) 13:00 (UTC)-->', latest), false);
});

test('partial archive recovery retries only registry removal and never appends twice', async () => {
    const {io, writes, pages} = fixture();
    const draft = await prepareArchive('9月28日', io), write = io.write;
    let fail = true;
    io.write = edit => {
        if (edit.title === REGISTER && fail) { fail = false; throw new Error('denied'); }
        return write(edit);
    };
    assert.equal(await submitArchive(draft, () => {}, io), false);
    assert.equal(draft.operation.steps[0].status, 'succeeded');
    assert.equal(await submitArchive(structuredClone(draft), () => {}, io, 'registry'), true);
    assert.deepEqual(writes, [draft.archive.target, REGISTER]);
    assert.equal(pages.get(draft.archive.target).text.split(section).length, 2);
});

test('changed registry content is retained after the archive request succeeds', async () => {
    const {io, writes, pages} = fixture();
    const draft = await prepareArchive('9月28日', io), write = io.write;
    io.write = async edit => {
        const result = await write(edit);
        if (edit.title === draft.archive.target) pages.get(REGISTER).text += '稍後新增的留言';
        return result;
    };
    assert.equal(await submitArchive(draft, () => {}, io), false);
    assert.equal(draft.operation.steps[0].status, 'succeeded');
    assert.equal(draft.operation.steps[1].status, 'failed');
    assert.match(pages.get(REGISTER).text, /稍後新增的留言/);
    assert.deepEqual(writes, [draft.archive.target]);
});
