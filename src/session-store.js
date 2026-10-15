import {t} from './state.js';
import {readLegacyDrafts} from './drafts.js';
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
        if (session.schema !== 3 || !['items', 'drafts', 'conflicts', 'submissions'].every(name => Array.isArray(session[name])) || !session.fields) throw new Error(t('無法讀取編輯資料，原資料已保留。', '无法读取编辑资料，原资料已保留。'));
        return session;
    };
    const lock = (name, callback, options = {}) => {
        if (!locks?.request) return Promise.reject(new Error(t('此瀏覽器無法協調多個分頁的編輯，請更新瀏覽器後重試。', '此浏览器无法协调多个分页的编辑，请更新浏览器后重试。')));
        return locks.request(`${prefix}:${name}`, options, callback);
    };
    const mutate = callback => lock('state', () => {
        const session = read();
        const result = callback(session);
        session.revision++;
        try { storage.setItem(key, JSON.stringify(session)); }
        catch (error) { error.code = 'local-storage'; throw error; }
        return {session, result};
    });
    const editable = (session, id) => {
        const item = session.items.find(item => item.id === id);
        if (!item) throw new Error(t('此操作已在另一個分頁取消或暫存。', '此操作已在另一个分页取消或暂存。'));
        if (lockedItem(session, id)) throw new Error(t('此操作正在儲存，請先處理其儲存結果。', '此操作正在保存，请先处理其保存结果。'));
        return item;
    };
    const merge = (session, target, before, after, itemId) => {
        for (const field of Object.keys(after)) {
            if (equal(before[field], after[field])) continue;
            if (!equal(target[field], before[field]) && !equal(target[field], after[field])) {
                // 衝突的兩份值一起持久保存；重新整理也不會失去尚未採用的輸入。
                const conflict = session.conflicts.find(conflict => conflict.itemId === itemId && conflict.field === field);
                const values = {current: copy(target[field] ?? null), proposed: copy(after[field] ?? null)};
                if (conflict) Object.assign(conflict, values);
                else session.conflicts.push({id: newId(), itemId, field, ...values});
            } else target[field] = copy(after[field] ?? null);
        }
    };
    const moveToDrafts = (session, items) => {
        const ids = new Set(items.map(item => item.id));
        if (session.conflicts.some(conflict => ids.has(conflict.itemId))) throw new Error(t('請先處理待暫存操作的分頁衝突。', '请先处理待暂存操作的分页冲突。'));
        session.drafts.push(...items);
        session.items = session.items.filter(item => !ids.has(item.id));
        return items.length;
    };
    return {
        key, read, mutate,
        async init() {
            return lock('state', () => {
                if (storage.getItem(key)) return read();
                const session = empty();
                const legacy = readLegacyDrafts(storage, prefix);
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
                if (nomination.source && session.submissions.some(item => !item.finished && item.draft.archive?.date === nomination.source.date)) throw new Error(t('此小節正在歸檔，請先處理其儲存結果。', '此小节正在归档，请先处理其保存结果。'));
                const existing = session.items.find(item => sameSource(item.nomination.source, nomination.source));
                if (existing) {
                    if (existing.mode !== mode) throw new Error(t('這筆提名已有另一種編輯操作，請先暫存或取消該筆操作。', '这项提名已有另一种编辑操作，请先暂存或取消该项操作。'));
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
            return mutate(session => moveToDrafts(session, [editable(session, id)]));
        },
        stashAll() {
            // 在同一把狀態鎖內選取與搬移，避免跨分頁更新遺失或保存失敗時只暫存半批。
            // 已送出的操作仍由儲存流程持有；空白、未改動及未完成的表單都可以暫存。
            return mutate(session => moveToDrafts(session, session.items.filter(item => !lockedItem(session, item.id))));
        },
        restore(ids) {
            return mutate(session => {
                const selected = ids.map(id => session.drafts.find(item => item.id === id));
                if (selected.some(item => !item)) throw new Error(t('草稿箱已在另一個分頁變更，請重新選取。', '草稿箱已在另一个分页变更，请重新选择。'));
                const sources = [...session.items];
                for (const item of selected) {
                    if (item.nomination.source && session.submissions.some(submission => !submission.finished && submission.draft.archive?.date === item.nomination.source.date)) throw new Error(t('此小節正在歸檔，請先處理其儲存結果。', '此小节正在归档，请先处理其保存结果。'));
                    if (sources.some(other => sameSource(other.nomination.source, item.nomination.source))) throw new Error(t('此提名已在表單中，請先處理目前的操作。', '此提名已在表单中，请先处理目前的操作。'));
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
                if (!held) throw new Error(t('另一個分頁正在儲存，進度會自動同步。', '另一个分页正在保存，进度会自动同步。'));
                return callback();
            }, {ifAvailable: true});
        },
    };
}
