import {copy, equal, sessionProgress} from './operations.js';
import {newId} from './scoring.js';
import {submitWorkspace} from './submission.js';
import {wikiTransport} from './transport.js';
import {reloadForReview} from './conflicts.js';
import {prepareArchive, submitArchive} from './archive.js';

/** 提交時凍結指定項目；每次進度更新只改該次提交，保留其他分頁新增的工作。 */
export function createSubmitController(store, changed, io = wikiTransport) {
    const persist = async (id, draft, error = '') => {
        await store.mutate(session => {
            const submission = session.submissions.find(item => item.id === id);
            if (!submission) throw new Error('儲存紀錄已變更，請重新檢查。');
            submission.draft = copy(draft);
            submission.error = error;
        });
        changed();
    };
    const run = async (id, action) => {
        const submission = store.read().submissions.find(item => item.id === id);
        if (!submission || submission.finished) return;
        const draft = submission.draft;
        try {
            const submit = draft.mode === 'archive' ? submitArchive : submitWorkspace;
            const success = await submit(draft, () => persist(id, draft), io, action);
            if (success) {
                await store.mutate(session => {
                    const current = session.submissions.find(item => item.id === id);
                    current.draft = copy(draft);
                    current.finished = true;
                    current.error = '';
                    // 鎖住的項目仍作快照比對，避免任何後來的修改被成功清理誤刪。
                    const sent = draft.items || [];
                    session.items = session.items.filter(item => !submission.itemIds.includes(item.id) ||
                        sent.length > 0 && !sent.some(original => original.id === item.id && equal(original, item)));
                    if ((draft.mode === 'new' || sent.some(item => item.mode === 'new')) && session.fields.message === draft.message) session.fields.message = '';
                    if (session.fields.summary === draft.summary) session.fields.summary = '';
                });
                changed();
            }
            return success;
        } catch (error) {
            await persist(id, draft, error.message || String(error));
            throw error;
        }
    };
    return {
        archive(date) {
            return store.publish(async () => {
                const draft = await prepareArchive(date, io), id = newId();
                await store.mutate(session => {
                    if (session.items.some(item => item.nomination.source?.date === date)) throw new Error('此小節仍有正在編輯的提名，請先送出、暫存或取消這些操作。');
                    if (session.submissions.some(item => !item.finished && item.draft.archive?.date === date)) throw new Error('此小節已有未完成的歸檔，請從儲存結果繼續。');
                    session.submissions.push({id, itemIds: [], draft});
                });
                changed();
                return run(id);
            });
        },
        start(expected) {
            return store.publish(async () => {
                const id = newId();
                await store.mutate(session => {
                    const progress = sessionProgress(session);
                    if (!progress.complete || !equal(progress.items, expected.items) || !equal(session.fields, expected.fields)) {
                        throw new Error('表單已變更，請重新確認本次送出內容。');
                    }
                    const draft = {mode: 'mixed', items: copy(progress.items), message: session.fields.message, summary: session.fields.summary};
                    session.submissions.push({id, itemIds: progress.items.map(item => item.id), draft});
                });
                changed();
                return run(id);
            });
        },
        step(id, stepKey, kind) { return store.publish(() => run(id, {stepKey, kind})); },
        rebase(id) {
            return store.publish(async () => {
                const submission = store.read().submissions.find(item => item.id === id);
                if (!submission) return;
                const draft = submission.draft;
                const registrySaved = draft.operation?.steps.find(step => step.key === 'registry')?.status === 'succeeded';
                const publishedNew = registrySaved && (draft.mode === 'new' || draft.items?.some(item => item.mode === 'new'));
                // 舊版未完成提交也轉成逐筆操作，原 attempt 只在查證／重建成功後移除。
                if (!draft.items) draft.items = draft.nominations.map((nomination, index) => ({id: submission.itemIds[index], mode: draft.mode, nomination}));
                await reloadForReview(draft, io);
                await store.mutate(session => {
                    session.items = session.items.filter(item => !submission.itemIds.includes(item.id));
                    session.items.push(...draft.items);
                    if (publishedNew && session.fields.message === draft.message) session.fields.message = '';
                    session.submissions = session.submissions.filter(item => item.id !== id);
                });
                changed();
            });
        },
        returnToEditing(id) {
            return store.publish(async () => {
                await store.mutate(session => {
                    const submission = session.submissions.find(item => item.id === id);
                    if (submission?.draft.operation?.steps.some(step => ['saving', 'unknown', 'succeeded'].includes(step.status))) {
                        throw new Error('已有儲存成功或結果未明的步驟，請先處理儲存結果。');
                    }
                    session.submissions = session.submissions.filter(item => item.id !== id);
                });
                changed();
            });
        },
        dismiss(id) {
            return store.mutate(session => {
                const submission = session.submissions.find(item => item.id === id);
                if (!submission?.finished) throw new Error('尚未完成儲存。');
                session.submissions = session.submissions.filter(item => item.id !== id);
            });
        },
    };
}
