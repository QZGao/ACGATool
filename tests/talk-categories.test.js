import test from 'node:test';
import assert from 'node:assert/strict';
import {createTalkCategoryCache} from '../src/wiki/talk-categories.js';
import {getTitleStatuses} from '../src/page/title-status.js';

const categories = ['Category:推薦的新條目', 'Category:新條目推薦候選', 'Category:其他討論頁分類'];
const page = (title, values = []) => ({title, categories: values.map(title => ({title}))});

test('category lookups batch at the permitted title limit and reuse positive, empty and missing results', async () => {
    for (const limit of [50, 500]) {
        const calls = [];
        const cache = createTalkCategoryCache(async params => {
            calls.push(params);
            return {query: {pages: params.titles.map((title, index) => index === 0 ? page(title, categories) : {title, missing: true})}};
        }, {batchSize: () => limit});
        const titles = Array.from({length: limit + 1}, (_, index) => `Talk:Article ${index}`);
        const first = cache.get(titles[0]);
        assert.equal(cache.get(titles[0]), first, 'in-flight requests share one promise');
        await Promise.all(titles.map(title => cache.get(title)));
        assert.deepEqual(calls.map(call => call.titles.length), [limit, 1]);
        for (const call of calls) {
            assert.equal(call.action, 'query'); assert.equal(call.prop, 'categories');
            assert.ok(!('clcategories' in call)); assert.equal(call.cllimit, 'max');
        }
        assert.deepEqual(await cache.get(titles[0]), categories);
        assert.deepEqual(await cache.get(titles[1]), []);
        await Promise.all(titles.map(title => cache.get(title)));
        assert.equal(calls.length, 2, 'empty results must not trigger another request');
    }
});

test('Chinese title conversion, redirects and continuation resolve to one cached result', async () => {
    const calls = [];
    const cache = createTalkCategoryCache(async params => {
        calls.push(params);
        if (!params.clcontinue) return {query: {
            converted: [{from: 'Talk:別名', to: 'Talk:别名'}],
            redirects: [{from: 'Talk:别名', to: 'Talk:Target'}],
            pages: [page('Talk:Target', [categories[0]])],
        }, continue: {continue: '||', clcontinue: 'next'}};
        return {query: {pages: [page('Talk:Target', categories.slice(1))]}};
    });
    assert.deepEqual(await cache.get('Talk:別名'), categories);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].clcontinue, 'next');
    for (const title of ['Talk:別名', 'Talk:别名', 'Talk:Target']) assert.deepEqual(await cache.get(title), categories);
    assert.equal(calls.length, 2);
});

test('a redirect discovered in flight satisfies a queued target without a second query', async () => {
    let resolve, started;
    const entered = new Promise(done => { started = done; });
    let calls = 0;
    const cache = createTalkCategoryCache(() => {
        calls++; started(); return new Promise(done => { resolve = done; });
    }, {batchSize: () => 1});
    const alias = cache.get('Talk:Alias');
    await entered;
    const target = cache.get('Talk:Target');
    resolve({query: {redirects: [{from: 'Talk:Alias', to: 'Talk:Target'}], pages: [page('Talk:Target', categories)]}});
    assert.deepEqual(await alias, categories); assert.deepEqual(await target, categories);
    assert.equal(calls, 1);
});

test('failed continuation does not cache partial categories or block a later retry', async () => {
    let calls = 0;
    const cache = createTalkCategoryCache(async () => {
        calls++;
        if (calls === 1) return {query: {pages: [page('Talk:Article', [categories[0]])]}, continue: {clcontinue: 'next'}};
        if (calls === 2) throw new Error('offline');
        return {query: {pages: [page('Talk:Article', [])]}};
    });
    await assert.rejects(cache.get('Talk:Article'), /offline/);
    assert.deepEqual(await cache.get('Talk:Article'), []);
    assert.deepEqual(await cache.get('Talk:Article'), []);
    assert.equal(calls, 3);
});

test('local category matching selects the latest event edition/year and excludes similar category names', () => {
    const campaigns = ['Category:第九次動員令貢獻一覽', 'Category:第十一次動員令貢獻一覽', 'Category:第12次动员令贡献一览', 'Category:第二十一次動員令貢獻一覽'];
    const months = ['Category:2024年维基百科亚洲月贡献', 'Category:2025年維基百科亞洲月貢獻'];
    const unrelated = ['Category:優良條目', 'Category:維基百科亞洲月', 'Category:第十一次動員令貢獻一覽/說明', 'Category:2025年维基百科亚洲月贡献者'];
    const matched = getTitleStatuses([...categories, 'Category:優良條目落選', 'Category:典範條目落選', 'Category:维基百科同行评审', ...campaigns, ...months, ...unrelated]);
    assert.deepEqual(matched.map(status => status.image.split('/').at(-1)), [
        'Symbol_question.svg', 'DYK_candidate.svg', 'Symbol_unsupport_vote-green.svg', 'Symbol_unsupport_star_blue.svg',
        'Nuvola_apps_kedit.svg', 'Wikipedia_zh_dc_logo.svg', 'WAM_logo_without_text.svg',
    ]);
    assert.deepEqual(matched[5].matchedCategories, [campaigns[3]]);
    assert.deepEqual(matched[6].matchedCategories, [months[1]]);
    assert.deepEqual(getTitleStatuses(unrelated), []);
});
