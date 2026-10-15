/**
 * 唯讀匯入前兩版的資料。新的編輯與暫存由 session-store 管理；舊鍵不再寫入，
 * 遷移失敗或使用者需要回復舊版時，原始內容仍完整保留。
 */
export function readLegacyDrafts(storage, prefix) {
    const key = `${prefix}:library`;
    const raw = storage.getItem(key);
    const library = raw ? JSON.parse(raw) : {schema: 2, drafts: []};
    if (library.schema !== 2 || !Array.isArray(library.drafts)) throw new Error('舊草稿版本無法讀取，原資料已保留。');
    const drafts = library.drafts;
    const migrated = new Set(library.migratedIds || []);
    for (let index = 0; index < storage.length; index++) {
        const name = storage.key(index);
        if (name === key || name === `${prefix}:session` || !name.startsWith(prefix + ':')) continue;
        const draft = JSON.parse(storage.getItem(name));
        if (draft.schema !== 1 || !Array.isArray(draft.nominations)) throw new Error('舊草稿版本無法讀取，原資料已保留。');
        if (migrated.has(draft.id)) continue;
        if (drafts.some(item => item.id === draft.id)) throw new Error('舊草稿識別重複，原資料已保留。');
        drafts.push(draft);
    }
    return drafts;
}
