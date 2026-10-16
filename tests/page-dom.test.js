import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {getNominationSections} from '../src/page/sections.js';

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
