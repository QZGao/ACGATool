/**
 * 建立依站點與帳號分區的草稿儲存介面；每份草稿使用獨立鍵值。
 * storageVersion 檢查可攔截已可見的其他分頁更新，但不是跨分頁的原子鎖。
 * @param {Storage} storage localStorage 或符合相同介面的記憶體測試替身。
 * @param {string} prefix 已包含站點及帳號的鍵值前綴。
 * @returns {object} list、save、remove；儲存或版本檢查失敗會拋出錯誤。
 */
export function createDraftStore(storage, prefix) {
    const key = id => `${prefix}:${id}`;
    return {
        list() {
            const drafts = [];
            for (let index = 0; index < storage.length; index++) {
                const name = storage.key(index);
                if (!name.startsWith(prefix + ':')) continue;
                const draft = JSON.parse(storage.getItem(name));
                if (draft.schema !== 1 || !Array.isArray(draft.nominations)) throw new Error('草稿版本無法讀取，原資料已保留。');
                drafts.push(draft);
            }
            return drafts;
        },
        save(draft) {
            const previous = JSON.parse(storage.getItem(key(draft.id)) || 'null');
            if ((previous?.storageVersion || 0) !== (draft.storageVersion || 0)) throw new Error('另一個分頁已修改此草稿，請另存目前草稿後繼續。');
            const next = {...draft, schema: 1, storageVersion: (draft.storageVersion || 0) + 1};
            storage.setItem(key(draft.id), JSON.stringify(next));
            // setItem 成功後才推進記憶體版本，讓容量或權限錯誤不會造成假成功。
            draft.storageVersion = next.storageVersion;
        },
        remove(draft) {
            const previous = JSON.parse(storage.getItem(key(draft.id)) || 'null');
            if (previous?.storageVersion !== draft.storageVersion) throw new Error('另一個分頁已更新草稿，已保留該分頁的內容。');
            storage.removeItem(key(draft.id));
        },
    };
}

/**
 * 只清除與已成功提交快照完全相同的項目，保留送出後的修改與其他草稿。
 * 共用說明若有變更，整批內容都保留；儲存層的版本檢查仍須通過。
 * @param {object} store createDraftStore 建立的介面。
 * @param {object} draft 目前可能已繼續修改的草稿，會就地更新。
 * @param {object} submitted 該次 operation 保存的 nominations 與 message 快照。
 */
export function clearSubmittedDraft(store, draft, submitted) {
    const saved = new Map(submitted.nominations.map(n => [n.id, JSON.stringify(n)]));
    if (draft.message === submitted.message) {
        draft.nominations = draft.nominations.filter(n => saved.get(n.id) !== JSON.stringify(n));
    }
    draft.operation = null;
    if (draft.nominations.length) store.save(draft);
    else store.remove(draft);
}
