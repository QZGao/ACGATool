import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {getNominationSections} from '../src/page/sections.js';
import {sourceRows} from '../src/ui/table-editor.js';

const table = id => `<table id="${id}" class="acgnom-table"><tbody><tr><td>提名</td></tr></tbody></table>`;
const heading = date => `<div class="mw-heading mw-heading3"><span><h3>${date}</h3></span><span class="cd-section-actions"></span></div>`;
function scan(html) {
    const {document} = parseHTML(`<div id="content">${html}</div>`);
    return getNominationSections(document.getElementById('content')).map(section => ({
        date: section.heading.textContent,
        tables: section.tables.map(element => element.id),
    }));
}

test('native and CD-wrapped nomination tables keep the same section and page order', () => {
    const expected = [{date: '10月1日', tables: ['a', 'b']}, {date: '10月2日', tables: ['c']}];
    const native = heading('10月1日') + table('a') + table('b') + heading('10月2日') + table('c');
    // CD inserts a comment header and wraps the table rather than leaving it beside the heading.
    const wrapped = heading('10月1日') +
        `<div class="cd-comment-replacedPart cd-comment-part cd-comment-part-first"><div class="cd-comment-header-wrapper"></div>${table('a')}</div>` +
        `<div class="other-gadget-wrapper"><div>${table('b')}</div></div>` +
        `<section>${heading('10月2日')}<div class="cd-comment-replacedPart">${table('c')}</div></section>`;
    assert.deepEqual(scan(native), expected);
    assert.deepEqual(scan(wrapped), expected);
});

test('editor previews and nested tables do not alter section boundaries or duplicate table discovery', () => {
    const html = table('before-any-date') + heading('10月1日') +
        `<div class="acga-editor"><h2>編輯器</h2><h3>草稿</h3>${table('preview')}</div>` +
        `<aside class="acga-dock"><h2>儲存進度</h2><h3>草稿</h3>${table('dock-preview')}</aside>` +
        `<div><table id="outer" class="acgnom-table"><tr><td><h3>表格內標題</h3>${table('nested')}</td></tr></table></div>` +
        `<h2>其他內容</h2>${table('outside-section')}` + heading('10月2日') + table('next-date');
    assert.deepEqual(scan(html), [
        {date: '10月1日', tables: ['outer']},
        {date: '10月2日', tables: ['next-date']},
    ]);
});

test('source rows distinguish identical nominations by date and index and still validate their content', context => {
    const {document} = parseHTML('<div><table><tbody></tbody></table></div>');
    const source = {date: '10月14日', index: 1,
        values: {'條目名稱': '甲', '用戶名稱': 'A', '提名理由': '1a', '核對用': ''}};
    for (const [date, index] of [['10月14日', 1], ['10月14日', 2], ['10月15日', 1]]) {
        for (const type of ['entry', 'check']) {
            const row = document.createElement('tr');
            row.id = `${date}-${index}-${type}`;
            row.setAttribute('data-acga-date', date);
            row.setAttribute('data-acga-source-index', index);
            row.setAttribute('data-acga-source-values', JSON.stringify(source.values));
            document.querySelector('tbody').append(row);
        }
    }
    // sourceRows 只使用這三個 jQuery 方法；DOM 比對仍在實際文件節點上執行。
    const selection = nodes => ({...nodes, length: nodes.length,
        filter: predicate => selection(nodes.filter((node, index) => predicate(index, node))),
        closest: selector => selection(nodes.map(node => node.closest(selector)).filter(Boolean)),
        attr: name => nodes[0]?.getAttribute(name),
    });
    const previous = globalThis.$;
    globalThis.$ = value => selection(value === undefined ? [] : typeof value === 'string' ? [...document.querySelectorAll(value)] : [value]);
    context.after(() => { globalThis.$ = previous; });
    for (const [date, index] of [['10月14日', 1], ['10月14日', 2], ['10月15日', 1]]) {
        const rows = sourceRows({...source, date, index});
        assert.equal(rows.length, 2);
        assert.deepEqual([rows[0].id, rows[1].id], [`${date}-${index}-entry`, `${date}-${index}-check`]);
    }
    assert.equal(sourceRows({...source, values: {...source.values, '提名理由': '1b'}}).length, 0);
});
