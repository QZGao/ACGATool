import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {bindTitleStatus} from '../src/page/title-status.js';
import {wikiTransport} from '../src/wiki/transport.js';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const response = (params, category) => ({query: {pages: params.titles.map(title => ({title,
    categories: [{title: category}],
}))}});

function cells(context) {
    const original = mw.Title;
    mw.Title = {newFromText: name => name ? {getTalkPage: () => ({getPrefixedText: () => `Talk:${name}`})} : null};
    context.after(() => { mw.Title = original; });
    const {document} = parseHTML('<table><tr><td><input value="保留輸入框"></td><td></td></tr></table>');
    return [...document.querySelectorAll('td')];
}

test('failed cells retry the same title and can repaint from another cell’s successful cache', async context => {
    const [first, second] = cells(context), input = first.firstElementChild;
    let calls = 0, fail = true;
    context.mock.method(wikiTransport, 'query', async params => {
        calls++;
        if (fail) throw new Error('offline');
        return response(params, 'Category:推薦的新條目');
    });
    const binding = bindTitleStatus(first, 'Retry'); await settle();
    assert.equal(calls, 1); assert.equal(first.querySelectorAll('img').length, 0);
    fail = false;
    assert.equal(bindTitleStatus(first, 'Retry'), binding); await settle();
    assert.equal(calls, 2); assert.equal(first.querySelectorAll('img').length, 1);
    binding.update('Retry'); await settle();
    assert.equal(calls, 2, 'successful same-title updates are reused');

    fail = true; binding.update('CachedRetry'); await settle();
    assert.equal(calls, 3); assert.equal(first.querySelectorAll('img').length, 0);
    assert.equal(first.style.getPropertyValue('--acga-title-status-space'), '0px');
    fail = false; const other = bindTitleStatus(second, 'CachedRetry'); await settle();
    assert.equal(calls, 4); assert.equal(second.querySelectorAll('img').length, 1);
    binding.update('CachedRetry'); await settle();
    assert.equal(calls, 4); assert.equal(first.querySelectorAll('img').length, 1);
    assert.equal(first.querySelector('input'), input, 'retrying only changes the icon container');
    binding.destroy(); other.destroy();
});

test('stale and destroyed bindings cannot paint late results, while pending titles share their query', async context => {
    const [first, second] = cells(context);
    const requests = [];
    context.mock.method(wikiTransport, 'query', params => new Promise(resolve => requests.push({params, resolve})));
    const binding = bindTitleStatus(first, 'Slow');
    const other = bindTitleStatus(second, 'Slow');
    binding.update('Slow'); await settle();
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].params.titles, ['Talk:Slow']);
    binding.update('Current'); other.destroy();
    requests[0].resolve(response(requests[0].params, 'Category:推薦的新條目')); await settle();
    assert.equal(first.querySelectorAll('img').length, 0);
    assert.equal(second.querySelectorAll('img').length, 0);
    assert.equal(requests.length, 2);
    // 正文刷新會暫時拆下編輯列，這不代表綁定已銷毀。
    first.remove();
    requests[1].resolve(response(requests[1].params, 'Category:新條目推薦候選')); await settle();
    assert.equal(first.querySelector('img').getAttribute('title'), '新條目推薦候選');
    assert.equal(first.querySelectorAll('img').length, 1);
    binding.destroy();
});
