import {t} from '../i18n.js';
import {copy, equal, sessionProgress} from '../nomination/operations.js';
import {newId} from '../nomination/scoring.js';
import {submitWorkspace} from '../wiki/submission.js';
import {wikiTransport} from '../wiki/transport.js';
import {reloadForReview} from '../nomination/conflicts.js';
import {prepareArchive, submitArchive} from '../wiki/archive.js';

/** 提交時凍結指定項目；每次進度更新只改該次提交，保留其他分頁新增的工作。 */
export function createSubmitController(store, changed, io = wikiTransport) {
    const persist = async (id, draft, error = '') => {
        await store.mutate(session => {
            const submission = session.submissions.find(item => item.id === id);
            if (!submission) throw new Error(t('儲存紀錄已變更，請重新檢查。', '保存记录已变更，请重新检查。'));
            submission.draft = copy(draft);
            submission.error = error;
        });
        changed();
    };
    const run = async (id, stepKey) => {
        const submission = (await store.read()).submissions.find(item => item.id === id);
        if (!submission || submission.finished) return;
        const draft = submission.draft;
        try {
            const submit = draft.mode === 'archive' ? submitArchive : submitWorkspace;
            const success = await submit(draft, () => persist(id, draft), io, stepKey);
            if (success) {
                await store.mutate(session => {
                    const current = session.submissions.find(item => item.id === id);
                    // 成功畫面只需日期、步驟狀態與修訂連結，不再保存提交內容或草稿副本。
                    current.draft = {mode: draft.mode,
                        ...(draft.archive ? {archive: {date: draft.archive.date}} : {}),
                        operation: {steps: draft.operation.steps.map(({key, title, status, revid}) => ({key, title, status, revid}))}};
                    current.finished = true;
                    current.error = '';
                    // 鎖住的項目仍作快照比對，避免任何後來的修改被成功清理誤刪。
                    const sent = draft.items || [];
                    session.items = session.items.filter(item => !submission.itemIds.includes(item.id) ||
                        sent.length > 0 && !sent.some(original => original.id === item.id && equal(original, item)));
                    if (sent.some(item => item.mode === 'new') && session.fields.message === draft.message) session.fields.message = '';
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
                    if (session.items.some(item => item.nomination.source?.date === date)) throw new Error(t('此小節仍有正在編輯的提名，請先送出、暫存或取消這些操作。', '此小节仍有正在编辑的提名，请先提交、暂存或取消这些操作。'));
                    if (session.submissions.some(item => !item.finished && item.draft.archive?.date === date)) throw new Error(t('此小節已有未完成的歸檔，請從儲存結果繼續。', '此小节已有未完成的归档，请从保存结果继续。'));
                    session.submissions.push({id, createdAt: Date.now(), itemIds: [], draft});
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
                        throw new Error(t('表單已變更，請重新確認本次送出內容。', '表单已变更，请重新确认本次提交内容。'));
                    }
                    const draft = {mode: 'mixed', items: copy(progress.items), message: session.fields.message, summary: session.fields.summary};
                    session.submissions.push({id, createdAt: Date.now(), itemIds: progress.items.map(item => item.id), draft});
                });
                changed();
                return run(id);
            });
        },
        step(id, stepKey) { return store.publish(() => run(id, stepKey)); },
        rebase(id) {
            return store.publish(async () => {
                const submission = (await store.read()).submissions.find(item => item.id === id);
                if (!submission) return;
                const draft = submission.draft;
                await reloadForReview(draft, io);
                await store.mutate(session => {
                    session.items = session.items.filter(item => !submission.itemIds.includes(item.id));
                    session.items.push(...draft.items);
                    session.submissions = session.submissions.filter(item => item.id !== id);
                });
                changed();
            });
        },
        returnToEditing(id) {
            return store.publish(async () => {
                await store.mutate(session => {
                    const submission = session.submissions.find(item => item.id === id);
                    if (submission?.draft.mode === 'archive' && submission.draft.operation?.steps.some(step => ['saving', 'succeeded'].includes(step.status))) {
                        throw new Error(t('已有儲存中或已成功的步驟，請先處理儲存結果。', '已有保存中或已成功的步骤，请先处理保存结果。'));
                    }
                    // 返回表單只結束這次提交紀錄，保留目前輸入；離線時也能繼續編輯。
                    session.submissions = session.submissions.filter(item => item.id !== id);
                });
                changed();
            });
        },
        dismiss(id) {
            return store.mutate(session => {
                const submission = session.submissions.find(item => item.id === id);
                if (!submission?.finished) throw new Error(t('尚未完成儲存。', '尚未完成保存。'));
                session.submissions = session.submissions.filter(item => item.id !== id);
            });
        },
    };
}
