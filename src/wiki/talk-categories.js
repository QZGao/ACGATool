import {t} from '../i18n.js';

/**
 * 頁面內的完整分類快取：同一輪新增的標題合併查詢，進行中的同名查詢共用 Promise。
 * 空分類與不存在的討論頁也快取；失敗或尚未讀完 continuation 的結果不寫入快取。
 * query 可注入只讀模擬介面，單元測試無須建立 mw.Api。
 */
export function createTalkCategoryCache(query, {batchSize = () => 50} = {}) {
    const cache = new Map(), pending = new Map(), waiting = new Set();
    let timer = null, running = false;

    async function fetchBatch(titles) {
        const pages = new Map(), aliases = new Map();
        let continuation;
        do {
            // 完整讀取討論頁分類，精確名稱與動員令／亞洲月等通配條件由顯示層篩選。
            const response = await query({action: 'query', formatversion: 2, prop: 'categories',
                titles, cllimit: 'max', redirects: true, converttitles: true,
                ...continuation});
            if (!Array.isArray(response.query?.pages)) throw new Error(t('討論頁分類查詢回應不完整。', '讨论页分类查询响应不完整。'));
            for (const kind of ['normalized', 'converted', 'redirects']) {
                for (const {from, to} of response.query[kind] || []) aliases.set(from, to);
            }
            for (const page of response.query.pages) {
                if (!pages.has(page.title)) pages.set(page.title, new Set());
                for (const category of page.categories || []) {
                    pages.get(page.title).add(category.title);
                }
            }
            continuation = response.continue;
        } while (continuation);

        const resolved = title => {
            const seen = new Set();
            while (aliases.has(title) && !seen.has(title)) {
                seen.add(title); title = aliases.get(title);
            }
            return title;
        };
        const results = new Map([...pages].map(([title, values]) => [title, Object.freeze([...values])]));
        for (const title of [...titles, ...aliases.keys()]) {
            const values = results.get(resolved(title));
            if (!values) throw new Error(t('討論頁分類查詢回應不完整。', '讨论页分类查询响应不完整。'));
            results.set(title, values);
        }
        return results;
    }

    async function flush() {
        timer = null;
        if (running) return;
        running = true;
        try {
            while (waiting.size) {
                // 前一批可能已查到本批標題的重定向目標，送出前再檢查快取。
                for (const title of waiting) if (cache.has(title)) {
                    waiting.delete(title); pending.get(title).resolve(cache.get(title)); pending.delete(title);
                }
                const titles = [...waiting].slice(0, batchSize());
                if (!titles.length) break;
                titles.forEach(title => waiting.delete(title));
                try {
                    const results = await fetchBatch(titles);
                    for (const [title, values] of results) cache.set(title, values);
                    titles.forEach(title => pending.get(title).resolve(cache.get(title)));
                } catch (error) {
                    titles.forEach(title => pending.get(title).reject(error));
                } finally {
                    titles.forEach(title => pending.delete(title));
                }
            }
        } finally { running = false; }
    }

    return {
        get(title) {
            if (cache.has(title)) return Promise.resolve(cache.get(title));
            if (pending.has(title)) return pending.get(title).promise;
            const entry = {};
            entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
            pending.set(title, entry); waiting.add(title);
            // 延到下一輪事件，讓首次掃描與恢復中的多個單元格加入同一批。
            if (!running && timer === null) timer = setTimeout(flush, 0);
            return entry.promise;
        },
    };
}
