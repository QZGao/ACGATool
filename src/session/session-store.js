import {t} from '../i18n.js';
import {copy, equal, createItem, sameSource, lockedItem, hasInput} from '../nomination/operations.js';
import {newId} from '../nomination/scoring.js';

const empty = () => ({schema: 3, revision: 0, items: [], drafts: [], fields: {message: '', summary: ''}, conflicts: [], submissions: []});

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validItem = item => object(item) && typeof item.id === 'string' && ['new', 'edit', 'check'].includes(item.mode) &&
    object(item.nomination) && ['pageName', 'awarder'].every(field => typeof item.nomination[field] === 'string') &&
    object(item.nomination.ruleStatus) && Object.values(item.nomination.ruleStatus).every(object) &&
    (item.mode === 'new' || object(item.nomination.source) && typeof item.nomination.source.date === 'string' &&
        Number.isInteger(item.nomination.source.index) && object(item.nomination.source.values) &&
        ['條目名稱', '用戶名稱', '提名理由', '核對用'].every(field => typeof item.nomination.source.values[field] === 'string'));

/** 驗證啟動與表單同步會用到的資料結構，不把壞記錄交給畫面後才拋錯。 */
function validSession(session) {
    return session?.schema === 3 && Number.isInteger(session.revision) &&
        ['items', 'drafts', 'conflicts', 'submissions'].every(name => Array.isArray(session[name])) &&
        object(session.fields) && ['message', 'summary'].every(field => typeof session.fields[field] === 'string') &&
        [...session.items, ...session.drafts].every(validItem) &&
        session.conflicts.every(conflict => object(conflict) && typeof conflict.id === 'string' && typeof conflict.field === 'string') &&
        session.submissions.every(submission => object(submission) && typeof submission.id === 'string' &&
            Array.isArray(submission.itemIds) && object(submission.draft) && ['mixed', 'archive'].includes(submission.draft.mode) &&
            (!submission.draft.operation || object(submission.draft.operation) && Array.isArray(submission.draft.operation.steps) &&
                submission.draft.operation.steps.every(step => object(step) && typeof step.key === 'string' && typeof step.status === 'string')));
}

/** 讀取時清理孤立的未完成提交。 */
function collectSubmissions(session) {
    const reachable = new Set([...session.items, ...session.drafts].map(item => item.id));
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    const retained = session.submissions.filter(submission => {
        // 歸檔沒有逐筆表單，仍由儲存進度提供操作入口，不能據此視為孤立紀錄。
        if (!submission.itemIds.length || submission.itemIds.some(id => reachable.has(id))) return true;
        return submission.createdAt >= cutoff;
    });
    if (retained.length === session.submissions.length) return false;
    session.submissions = retained;
    return true;
}

/**
 * localStorage 是共同工作區的唯一持久來源。Web Locks 將跨分頁的讀取／修改／寫入
 * 串行化；每次只套用受影響欄位，不能用記憶體中的整份舊快照覆寫其他分頁。
 * locks 可注入記憶體實作，測試不需要瀏覽器或網路。
 */
export function createSessionStore(storage, prefix, locks = globalThis.navigator?.locks, defaultAwarder = '') {
    const key = `${prefix}:session`;
    let localItems = [];
    let itemOrder = [];
    const load = () => {
        try {
            const raw = storage.getItem(key);
            const session = raw ? JSON.parse(raw) : empty();
            if (!validSession(session)) {
                throw new Error(t('本機編輯資料格式不符。', '本机编辑数据格式不符。'));
            }
            return session;
        } catch (error) {
            console.error(t('[ACGATool] 無法讀取本機編輯資料，按不存在處理。', '[ACGATool] 无法读取本机编辑数据，按不存在处理。'), error);
            return empty();
        }
    };
    const lock = (name, callback, options = {}) => {
        if (!locks?.request) return Promise.reject(new Error(t('此瀏覽器無法協調多個分頁的編輯，請更新瀏覽器後重試。', '此浏览器无法协调多个分页的编辑，请更新浏览器后重试。')));
        return locks.request(`${prefix}:${name}`, options, callback);
    };
    const persistable = (session, item) => hasInput(item, defaultAwarder) || lockedItem(session, item.id) ||
        session.conflicts.some(conflict => conflict.itemId === item.id);
    const withLocalItems = stored => {
        const session = copy(stored);
        // 別頁已開始編輯同一來源時，改用共同工作區的資料，移除本頁尚未修改的副本。
        localItems = localItems.filter(item => ![...session.items, ...session.drafts].some(other => other.id === item.id) &&
            !session.items.some(other => sameSource(other.nomination.source, item.nomination.source)));
        session.items.push(...copy(localItems));
        // 首次輸入由記憶體轉入 localStorage 時，保留本頁的表單順序與輸入框位置。
        const order = new Map(itemOrder.map((id, index) => [id, index]));
        session.items.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
        return session;
    };
    const write = (session, stored) => {
        const persistent = {...session, items: session.items.filter(item => persistable(session, item))};
        const storedOrder = new Map(stored.items.map((item, index) => [item.id, index]));
        persistent.items.sort((a, b) => (storedOrder.get(a.id) ?? Infinity) - (storedOrder.get(b.id) ?? Infinity));
        const ids = new Set(persistent.items.map(item => item.id));
        if (!equal(persistent, stored)) {
            persistent.revision = stored.revision + 1;
            try { storage.setItem(key, JSON.stringify(persistent)); }
            catch (error) { error.code = 'local-storage'; throw error; }
            session.revision = persistent.revision;
        }
        localItems = copy(session.items.filter(item => !ids.has(item.id)));
        itemOrder = session.items.map(item => item.id);
    };
    // 讀取時的垃圾清理也要持有狀態鎖，避免覆寫另一分頁剛恢復的表單。
    const readLocked = () => {
        const stored = load(), session = withLocalItems(stored);
        collectSubmissions(session);
        write(session, stored);
        return session;
    };
    const read = () => lock('state', readLocked);
    const mutate = callback => lock('state', () => {
        const stored = load(), session = withLocalItems(stored);
        collectSubmissions(session);
        const result = callback(session);
        write(session, stored);
        return {session, result};
    });
    const editable = (session, id) => {
        const item = session.items.find(item => item.id === id);
        if (!item) throw new Error(t('此操作已在另一個分頁取消或暫存。', '此操作已在另一个分页取消或暂存。'));
        if (lockedItem(session, id)) throw new Error(t('此操作正在儲存，請先處理其儲存結果。', '此操作正在保存，请先处理其保存结果。'));
        return item;
    };
    // 所有提名內容更新共用此入口，包括跨分頁衝突的取值；核對只對修改前的內容有效。
    const updateNomination = (session, id, update) => {
        const item = editable(session, id);
        const before = copy({...item.nomination, reviewed: false});
        update(item.nomination);
        if (item.mode === 'check' && !equal(before, {...item.nomination, reviewed: false})) item.nomination.reviewed = false;
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
        init: read,
        add(mode, nominations) {
            return mutate(session => nominations.map(nomination => {
                if (nomination.source && session.submissions.some(item => item.draft.archive?.date === nomination.source.date)) throw new Error(t('此小節正在歸檔，請先處理其儲存結果。', '此小节正在归档，请先处理其保存结果。'));
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
            return mutate(session => updateNomination(session, id, nomination => {
                // 不能在另一分頁已改動內容後，對過期畫面直接標記核對完成。
                if (after.reviewed && !before.reviewed && !equal({...nomination, reviewed: false}, {...before, reviewed: false})) {
                    session.conflicts.push({id: newId(), itemId: id, field: 'reviewed', current: false, proposed: true});
                    return;
                }
                merge(session, nomination, before, after, id);
            }));
        },
        fields(before, after) { return mutate(session => merge(session, session.fields, before, after, null)); },
        resolve(id, useProposed) {
            return mutate(session => {
                const conflict = session.conflicts.find(item => item.id === id);
                if (!conflict) return;
                const apply = target => { if (useProposed) target[conflict.field] = copy(conflict.proposed); };
                if (conflict.itemId) updateNomination(session, conflict.itemId, apply);
                else apply(session.fields);
                session.conflicts = session.conflicts.filter(item => item.id !== id);
            });
        },
        stash(id, restoring = false) {
            return mutate(session => {
                // 恢復時找不到原列，也將儲存中的表單移入同一草稿箱，保留其提交紀錄。
                const item = restoring ? session.items.find(item => item.id === id) : editable(session, id);
                return item ? moveToDrafts(session, [item]) : 0;
            });
        },
        stashAll() {
            // 在同一把狀態鎖內選取與搬移，避免跨分頁更新遺失或保存失敗時只暫存半批。
            // 已送出的操作仍由儲存流程持有；空白、未改動及未完成的表單都可以暫存。
            return mutate(session => moveToDrafts(session, session.items.filter(item => !lockedItem(session, item.id))));
        },
        restore(ids, sourceAvailable = () => true) {
            return mutate(session => {
                const restored = [], failures = [];
                for (const id of ids) {
                    const item = session.drafts.find(item => item.id === id);
                    let reason;
                    if (!item) reason = t('此草稿已在另一個分頁移除或恢復。', '此草稿已在另一个分页移除或恢复。');
                    else if (!sourceAvailable(item)) reason = t('找不到原提名。', '找不到原提名。');
                    else if (item.nomination.source && session.submissions.some(submission => submission.draft.archive?.date === item.nomination.source.date)) reason = t('此小節正在歸檔。', '此小节正在归档。');
                    else if (session.items.some(other => sameSource(other.nomination.source, item.nomination.source))) reason = t('此提名已在表單中。', '此提名已在表单中。');
                    if (reason) { failures.push({id, reason}); continue; }
                    session.items.push(item);
                    restored.push(id);
                }
                // 只取出成功恢復的草稿；失敗項保留原內容，讓使用者稍後處理或複製。
                session.drafts = session.drafts.filter(item => !restored.includes(item.id));
                return {restored, failures};
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
