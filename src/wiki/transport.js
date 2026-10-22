import {t} from '../i18n.js';
/**
 * MediaWiki 實際讀寫邊界；提交狀態機透過 io 介面使用它。
 * 單元測試以記憶體 io 取代此物件，禁止建立真實 mw.Api 或發出網路請求。
 */
import {getWikiApi} from './api.js';

/**
 * 將 jQuery Deferred 的多參數失敗回呼轉為 Error，保留 API 錯誤碼與詳細資訊。
 */
function request(promise) {
    return new Promise((resolve, reject) => promise.then(resolve, (code, detail) => {
        const error = new Error(detail?.error?.info || detail?.exception || String(code));
        error.code = typeof code === 'string' ? code : 'network';
        reject(error);
    }));
}

export const wikiTransport = {
    /** action=query 的只讀 POST，讓批次標題不受 GET 網址長度限制。 */
    query(params) {
        return request(getWikiApi().post({...params, action: 'query'}));
    },
    async render(title) {
        const response = await request(getWikiApi().get({action: 'parse', page: title, prop: 'text|wikitext', formatversion: 2}));
        return {html: response.parse?.text, text: response.parse?.wikitext};
    },
    async read(title, {allowMissing = false} = {}) {
        const response = await request(getWikiApi().get({action: 'query', titles: title, prop: 'revisions', rvslots: 'main', rvprop: 'ids|timestamp|content', curtimestamp: 1, formatversion: 2}));
        const page = response.query.pages[0];
        if (page.missing && allowMissing) return {text: '', revid: 0, missing: true, starttimestamp: response.curtimestamp};
        if (page.missing || !page.revisions?.[0]) throw new Error(t('找不到待修改頁面。', '找不到待修改页面。'));
        const revision = page.revisions[0];
        return {text: revision.slots.main.content, revid: revision.revid,
            timestamp: revision.timestamp, starttimestamp: response.curtimestamp};
    },
    async write(edit) {
        const username = mw.config.get('wgUserName');
        const response = await request(getWikiApi().postWithToken('csrf', {
            action: 'edit', title: edit.title, text: edit.text, summary: edit.summary,
            // 使用產生這份本文時的基底版本，讓伺服器偵測中途編輯，包括同帳號的衝突。
            baserevid: edit.base.revid, starttimestamp: edit.base.starttimestamp,
            ...(edit.create ? {createonly: true} : {nocreate: true}),
            ...(username ? {assert: 'user', assertuser: username} : {}),
        }));
        if (response.edit?.result !== 'Success') {
            const error = new Error(response.edit?.captcha ? t('請在維基頁面完成驗證後重試。', '请在维基页面完成验证后重试。') : t('儲存請求未成功。', '保存请求未成功。'));
            throw error;
        }
        return {revid: response.edit.newrevid};
    },
};

/**
 * 直接以編輯請求回應更新進度；失敗保留錯誤，交由使用者重試該步驟。
 * 寫入前先保存進度，本機保存失敗時不送出編輯請求。
 */
export async function writeStep(step, edit, persist, io) {
    step.status = 'saving';
    await persist();
    try {
        const result = await io.write(edit);
        step.status = 'succeeded';
        step.revid = result.revid;
        step.error = '';
    } catch (error) {
        step.status = 'failed';
        step.error = error.message || String(error);
    }
    await persist();
    return step.status === 'succeeded';
}
