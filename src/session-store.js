import {createDraftStore} from './drafts.js';
import {copy, equal, createItem, sameSource, lockedItem} from './operations.js';
import {newId} from './scoring.js';

const empty = () => ({schema: 3, revision: 0, items: [], drafts: [], fields: {message: '', summary: ''}, conflicts: [], submissions: []});

/**
 * localStorage 是共同工作區的唯一持久來源。Web Locks 將跨分頁的讀取／修改／寫入
 * 串行化；每次只套用受影響欄位，不能用記憶體中的整份舊快照覆寫其他分頁。
 * locks 可注入記憶體實作，測試不需要瀏覽器或網路。
 */
export function createSessionStore(storage, prefix, locks = globalThis.navigator?.locks) {
    const key = `${prefix}:session`;
    const read = () => {
        const raw = storage.getItem(key);
        const session = raw ? JSON.parse(raw) : empty();
        if (session.schema !== 3 || !Array.isArray(session.items) || !Array.isArray(session.drafts)) throw new Error('無法讀取編輯資料，原資料已保留。');
        return session;
    };
    const lock = (name, callback, options = {}) => {
        if (!locks?.request) return Promise.reject(new Error('此瀏覽器無法協調多個分頁的編輯，請更新瀏覽器後重試。'));
        return locks.request(`${prefix}:${name}`, options, callback);
    };
    const mutate = callback => lock('state', () => {
        const session = read();
        const result = callback(session);
        session.revision++;
        storage.setItem(key, JSON.stringify(session));
        return {session, result};
    });
    const editable = (session, id) => {
        const item = session.items.find(item => item.id === id);
        if (!item) throw new Error('此操作已在另一個分頁取消或暫存。');
        if (lockedItem(session, id)) throw new Error('此操作正在儲存，請先處理其儲存結果。');
        return item;
    };
    const merge = (session, target, before, after, itemId) => {
        for (const field of Object.keys(after)) {
            if (equal(before[field], after[field])) continue;
            if (!equal(target[field], before[field]) && !equal(target[field], after[field])) {
                // 衝突的兩份值一起持久保存；重新整理也不會失去尚未採用的輸入。
                session.conflicts.push({id: newId(), itemId, field, current: copy(target[field] ?? null), proposed: copy(after[field] ?? null)});
            } else target[field] = copy(after[field] ?? null);
        }
    };
    return {
        key, read, mutate,
        async init() {
            return lock('state', () => {
                if (storage.getItem(key)) return read();
                const session = empty();
                const legacy = createDraftStore(storage, prefix).list();
                for (const draft of legacy) {
                    const items = draft.nominations.map(n => createItem(draft.mode, n));
                    if (draft.operation || draft.open || draft.mode !== 'new') session.items.push(...items);
                    else session.drafts.push(...items);
                    // 舊版整批說明獨立遷移，不再附在草稿箱項目上；多份文字保留供選擇。
                    if (draft.message) {
                        if (!session.fields.message) session.fields.message = draft.message;
                        else if (session.fields.message !== draft.message) session.conflicts.push({id: newId(), itemId: null,
                            field: 'message', current: session.fields.message, proposed: draft.message});
                    }
                    if (draft.operation || draft.conflicts?.length) session.submissions.push({id: newId(), itemIds: items.map(item => item.id), draft: copy(draft)});
                }
                // 一次成功寫入才算遷移完成；舊鍵保留，供使用者需要時回復。
                storage.setItem(key, JSON.stringify(session));
                return session;
            });
        },
        add(mode, nominations) {
            return mutate(session => nominations.map(nomination => {
                const existing = session.items.find(item => sameSource(item.nomination.source, nomination.source));
                if (existing) {
                    if (existing.mode !== mode) throw new Error('這筆提名已有另一種編輯操作，請先暫存或取消該筆操作。');
                    return existing.id;
                }
                const item = createItem(mode, nomination);
                session.items.push(item);
                return item.id;
            }));
        },
        patch(id, before, after) {
            return mutate(session => {
                const item = editable(session, id);
                // 不能在另一分頁已改動內容後，對過期畫面直接標記核對完成。
                if (after.reviewed && !before.reviewed && !equal({...item.nomination, reviewed: false}, {...before, reviewed: false})) {
                    session.conflicts.push({id: newId(), itemId: id, field: 'reviewed', current: false, proposed: true});
                    return;
                }
                merge(session, item.nomination, before, after, id);
                if (item.mode === 'check' && Object.keys(after).some(field => field !== 'reviewed' && !equal(before[field], after[field]))) item.nomination.reviewed = false;
            });
        },
        fields(before, after) { return mutate(session => merge(session, session.fields, before, after, null)); },
        resolve(id, useProposed) {
            return mutate(session => {
                const conflict = session.conflicts.find(item => item.id === id);
                if (!conflict) return;
                const target = conflict.itemId ? editable(session, conflict.itemId).nomination : session.fields;
                if (useProposed) target[conflict.field] = copy(conflict.proposed);
                session.conflicts = session.conflicts.filter(item => item.id !== id);
            });
        },
        stash(id) {
            return mutate(session => {
                const item = editable(session, id);
                if (session.conflicts.some(conflict => conflict.itemId === id)) throw new Error('請先處理這筆操作的分頁衝突。');
                session.drafts.push(item);
                session.items = session.items.filter(item => item.id !== id);
            });
        },
        restore(ids) {
            return mutate(session => {
                const selected = ids.map(id => session.drafts.find(item => item.id === id));
                if (selected.some(item => !item)) throw new Error('草稿箱已在另一個分頁變更，請重新選取。');
                const sources = [...session.items];
                for (const item of selected) {
                    if (sources.some(other => sameSource(other.nomination.source, item.nomination.source))) throw new Error('此提名已在表單中，請先處理目前的操作。');
                    sources.push(item);
                }
                session.items.push(...selected);
                session.drafts = session.drafts.filter(item => !ids.includes(item.id));
            });
        },
        discard(id, stashed = false) {
            return mutate(session => {
                const list = stashed ? 'drafts' : 'items';
                if (!stashed) editable(session, id);
                const removed = session[list].find(item => item.id === id);
                session[list] = session[list].filter(item => item.id !== id);
                session.conflicts = session.conflicts.filter(conflict => conflict.itemId !== id);
                return removed;
            });
        },
        // 網路寫入另用一把鎖；其他分頁仍可編輯未提交項目，但不會重複發出請求。
        publish(callback) {
            return lock('publish', held => {
                if (!held) throw new Error('另一個分頁正在儲存，進度會自動同步。');
                return callback();
            }, {ifAvailable: true});
        },
    };
}
