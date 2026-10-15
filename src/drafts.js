/**
 * 同一帳號的工作草稿與暫存提名存於單一資料盒，搬移多筆時只需一次 setItem。
 * 每份草稿仍各自檢查 storageVersion；這不構成跨分頁的原子鎖。
 * 初次寫入先完整保存舊版獨立鍵值中的資料，成功後才清理舊鍵。
 */
export function createDraftStore(storage, prefix) {
    const key = `${prefix}:library`;
    const clone = value => JSON.parse(JSON.stringify(value));
    const read = () => {
        const raw = storage.getItem(key);
        const library = raw ? JSON.parse(raw) : {schema: 2, drafts: [], activeId: null};
        if (library.schema !== 2 || !Array.isArray(library.drafts)) throw new Error('草稿版本無法讀取，原資料已保留。');
        const migrated = new Set(library.migratedIds || []), legacyKeys = [];
        for (let index = 0; index < storage.length; index++) {
            const name = storage.key(index);
            if (name === key || !name.startsWith(prefix + ':')) continue;
            const draft = JSON.parse(storage.getItem(name));
            if (draft.schema !== 1 || !Array.isArray(draft.nominations)) throw new Error('草稿版本無法讀取，原資料已保留。');
            // 舊版分頁仍可能建立新草稿；也讀入新鍵，但不復活已搬移或刪除的舊副本。
            if (!migrated.has(draft.id)) {
                if (library.drafts.some(item => item.id === draft.id)) throw new Error('草稿識別重複，原資料已保留。');
                library.drafts.push(draft); migrated.add(draft.id);
            }
            legacyKeys.push(name);
        }
        library.migratedIds = [...migrated];
        return {library, legacyKeys};
    };
    const write = ({library, legacyKeys}) => {
        storage.setItem(key, JSON.stringify(library));
        // 新資料盒已是完整且唯一的讀取來源；舊鍵清理失敗也不重新匯入重複資料。
        for (const name of legacyKeys) {
            try { storage.removeItem(name); } catch { /* 保留舊副本，已提交的資料盒仍完整。 */ }
        }
    };
    const current = (library, draft) => {
        const previous = library.drafts.find(item => item.id === draft.id);
        if ((previous?.storageVersion || 0) !== (draft.storageVersion || 0)) throw new Error('另一個分頁已修改此草稿，請重新開啟後再試，或另存目前內容。');
        return previous;
    };
    const replace = (library, draft) => {
        const index = library.drafts.findIndex(item => item.id === draft.id);
        if (index < 0) library.drafts.push(draft);
        else library.drafts[index] = draft;
        if (draft.open) library.activeId = draft.id;
        else if (library.activeId === draft.id) library.activeId = null;
    };
    const remove = (library, id) => {
        library.drafts = library.drafts.filter(item => item.id !== id);
        if (library.activeId === id) library.activeId = null;
    };
    const nextVersion = draft => ({...clone(draft), schema: 1, storageVersion: (draft.storageVersion || 0) + 1});
    return {
        list() { return read().library.drafts; },
        active() {
            const {library} = read();
            return library.drafts.find(draft => draft.id === library.activeId && draft.open) || null;
        },
        save(draft) {
            const snapshot = read();
            current(snapshot.library, draft);
            const next = nextVersion(draft);
            replace(snapshot.library, next);
            write(snapshot);
            draft.storageVersion = next.storageVersion;
        },
        remove(draft) {
            const snapshot = read();
            current(snapshot.library, draft);
            remove(snapshot.library, draft.id);
            write(snapshot);
        },
        /**
         * 將來源中的指定提名移到目標表單或單筆暫存草稿。
         * 全部來源與容量先驗證；寫入成功後才更新呼叫端物件，失敗時表單與草稿箱皆不變。
         * selections: [{draft, nominationIds}]，順序即恢復後的追加順序。
         */
        transfer(selections, target) {
            const snapshot = read(), {library} = snapshot;
            current(library, target);
            if (target.mode !== 'new' || target.operation) throw new Error('只能恢復到尚未提交的新提名表單。');
            const next = nextVersion(target), sources = [], messages = new Set([target.message || '']);
            const sourceIds = new Set(), nominationIds = new Set(next.nominations.map(item => item.id));
            for (const {draft, nominationIds: selected} of selections) {
                const source = current(library, draft);
                if (!source || source.mode !== 'new' || source.operation || source.id === target.id || sourceIds.has(source.id)) throw new Error('此草稿無法暫存或恢復。');
                sourceIds.add(source.id);
                const ids = new Set(selected);
                if (!ids.size || ids.size !== selected.length) throw new Error('請選擇要恢復的提名。');
                const nominations = source.nominations.filter(item => ids.has(item.id));
                if (nominations.length !== ids.size) throw new Error('草稿內容已變更，請重新開啟草稿箱。');
                for (const nomination of nominations) {
                    if (nominationIds.has(nomination.id)) throw new Error('此提名已在目前表單中。');
                    nominationIds.add(nomination.id);
                    next.nominations.push(clone(nomination));
                }
                if (source.message && !messages.has(source.message) && !(next.message || '').includes(source.message)) {
                    next.message = [next.message, source.message].filter(Boolean).join('\n\n');
                    messages.add(source.message);
                }
                const remaining = {...source, nominations: source.nominations.filter(item => !ids.has(item.id)), storageVersion: source.storageVersion + 1};
                sources.push({draft, remaining});
            }
            if (!sources.length) throw new Error('請選擇要恢復的提名。');
            for (const {remaining} of sources) {
                if (remaining.nominations.length) replace(library, remaining);
                else remove(library, remaining.id);
            }
            replace(library, next);
            write(snapshot);
            // 表單事件綁定到原提名物件；已存在的列必須保留同一參照。
            const targetNominations = [...target.nominations, ...next.nominations.slice(target.nominations.length)];
            Object.assign(target, next, {nominations: targetNominations});
            for (const {draft, remaining} of sources) {
                const kept = new Set(remaining.nominations.map(item => item.id));
                Object.assign(draft, remaining, {nominations: draft.nominations.filter(item => kept.has(item.id))});
            }
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
