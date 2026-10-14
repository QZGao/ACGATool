/**
 * MediaWiki 實際讀寫邊界；提交狀態機透過 io 介面使用它。
 * 單元測試以記憶體 io 取代此物件，禁止建立真實 mw.Api 或發出網路請求。
 */
import {getWikiApi} from './api.js';

/**
 * 將 jQuery Deferred 的多參數失敗回呼轉為 Error，保留 API 錯誤碼與詳細資訊。
 * 網路、逾時或中止只能表示未收到結果，不能據此判定寫入失敗。
 */
function request(promise) {
    return new Promise((resolve, reject) => promise.then(resolve, (code, detail) => {
        const error = new Error(detail?.error?.info || detail?.exception || String(code));
        error.code = typeof code === 'string' ? code : 'network';
        error.uncertain = ['http', 'timeout', 'abort', 'network'].includes(error.code);
        reject(error);
    }));
}

export const wikiTransport = {
    async read(title) {
        const response = await request(getWikiApi().get({action: 'query', titles: title, prop: 'revisions', rvslots: 'main', rvprop: 'ids|timestamp|content', curtimestamp: 1, formatversion: 2}));
        const page = response.query.pages[0];
        if (page.missing || !page.revisions?.[0]) throw new Error('找不到待修改頁面。');
        const revision = page.revisions[0];
        return {text: revision.slots.main.content, revid: revision.revid, timestamp: revision.timestamp, starttimestamp: response.curtimestamp};
    },
    async write(attempt) {
        const response = await request(getWikiApi().postWithToken('csrf', {
            action: 'edit', title: attempt.title, text: attempt.text, summary: attempt.summary,
            // 使用產生這份本文時的基底版本，讓伺服器偵測中途編輯，包括同帳號的衝突。
            baserevid: attempt.base.revid, starttimestamp: attempt.base.starttimestamp,
            nocreate: true, assert: 'user', assertuser: mw.config.get('wgUserName'),
        }));
        if (response.edit?.result !== 'Success') {
            const error = new Error(response.edit?.captcha ? '請在維基頁面完成驗證後重試。' : '伺服器未確認儲存成功。');
            error.uncertain = !response.edit?.captcha;
            throw error;
        }
        return {revid: response.edit.newrevid};
    },
    async findReceipt(attempt) {
        let continuation;
        // 查閱上限為 20 頁修訂；查不到仍是結果未明，不能據此重送加分。
        for (let page = 0; page < 20; page++) {
            const response = await request(getWikiApi().get({action: 'query', titles: attempt.title, prop: 'revisions',
                rvprop: 'ids|comment', rvlimit: 50, rvendid: attempt.base.revid, formatversion: 2, ...continuation}));
            const revisions = response.query.pages[0].revisions || [];
            for (const revision of revisions) {
                if (!revision.comment?.includes(attempt.tag)) continue;
                // 摘要僅用來縮小範圍，仍須確認該修訂本文確實包含本次寫入標記。
                const detail = await request(getWikiApi().get({action: 'query', revids: revision.revid, prop: 'revisions', rvprop: 'ids|content', rvslots: 'main', formatversion: 2}));
                const content = detail.query.pages[0].revisions[0].slots.main.content;
                if (content.includes(attempt.marker)) return {revid: revision.revid};
            }
            if (!response.continue) break;
            continuation = response.continue;
        }
        return null;
    },
};

/**
 * 查證原請求是否曾成功寫入，先查最新本文，再查帶有提交標記的歷史修訂。
 * 查到歷史收據不代表後續編輯仍保留相同內容；內容一致性另由提交流程檢查。
 * @returns {Promise<object|null>} 已確認的修訂識別，或尚未找到證據的 null。
 */
export async function confirmAttempt(attempt, io) {
    const current = await io.read(attempt.title);
    if (current.text.includes(attempt.marker)) return {revid: current.revid};
    return io.findReceipt(attempt);
}

/**
 * 推進一個頁面的儲存狀態，並在送出前與取得結果後保存進度。
 * saving／unknown 只查證原 attempt；明確遭拒才標為 failed，交由呼叫端決定重試。
 * @param {object} step 含 status、attempt，會就地更新為 succeeded、failed 或 unknown。
 * @param {Function} persist 同步持久保存回呼，拋錯時停止流程。
 * @param {object} io 實際或 dry-run 的 read、write、findReceipt 介面。
 * @returns {Promise<boolean>} 本步已確認成功為 true，其餘狀態為 false。
 */
export async function writeStep(step, persist, io) {
    // 分頁可能在送出後、記錄成功前關閉；恢復的 saving 不能直接再送一次。
    if (step.status === 'saving' || step.status === 'unknown') {
        try {
            const receipt = await confirmAttempt(step.attempt, io);
            if (receipt) { step.status = 'succeeded'; step.revid = receipt.revid; step.error = ''; }
            else { step.status = 'unknown'; step.error = '尚無法確認上次儲存結果，請稍後重新查詢。'; }
        } catch (error) { step.status = 'unknown'; step.error = '無法查詢上次儲存結果：' + error.message; }
        persist();
        return step.status === 'succeeded';
    }
    // 先保存 attempt 與 saving 狀態；本機保存失敗時不發出寫入請求。
    step.status = 'saving';
    persist();
    try {
        const result = await io.write(step.attempt);
        step.status = 'succeeded';
        step.revid = result.revid;
        step.error = '';
    } catch (error) {
        step.status = error.uncertain === false ? 'failed' : 'unknown';
        step.error = error.message || String(error);
        if (step.status === 'unknown') {
            try {
                const receipt = await confirmAttempt(step.attempt, io);
                if (receipt) { step.status = 'succeeded'; step.revid = receipt.revid; step.error = ''; }
            } catch { /* Keep the uncertain result until it can be queried. */ }
        }
    }
    persist();
    return step.status === 'succeeded';
}
