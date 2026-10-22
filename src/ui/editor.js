import {t} from '../i18n.js';
import {createDock} from './dock.js';
import {getArticleRoot, getNominationSections} from '../page/sections.js';
import {initRuleEditor, chooseRules} from './dialogs/rule-dialog.js';
import {initEditorStyles} from './editor-styles.js';
import {DraftDialog, initDraftDialog} from './dialogs/draft-dialog.js';
import {collectUnsavedInputs, confirmDiscardInputs, initDiscardInputDialog} from './dialogs/discard-input-dialog.js';
import {appendNominationRows, createNominationTable, sourceRows, ruleFragments} from './table-editor.js';
import {createSessionStore} from '../session/session-store.js';
import {createSubmitController} from '../session/session-submit.js';
import {copy, equal, operationStatus, operationType, sessionProgress, lockedItem, sameSource} from '../nomination/operations.js';
import {newId} from '../nomination/scoring.js';
import {getNewNominationPlacement} from '../wiki/submission.js';
import {appendDifferences, fieldLabel, fieldText} from './review-ui.js';
import {cdxIconUserAdd, cdxIconEdit, cdxIconHighlight, cdxIconSandbox} from './icons.js';
import {refreshRegistryContent} from '../page/refresh.js';
import {bindTextInput} from './text-input.js';

let store, controller, dock, windows, ready, session, queue = Promise.resolve(), busy = false;
let $newSection, $newTable, $date, previewTimer, confirming = false, confirmation;
let saveButton, messageInput, summaryInput, confirmButton, fieldsBaseline;
const fieldInputs = new Map();
let queuedUpdates = 0;
let storageFailure = null, unsavedTasks = [];
const views = new Map();
const completedResults = new Map();
const renderedResults = new Set();
let refreshing = false, pageReady = false;

function signature(item) {
    return JSON.stringify([item, session.conflicts.filter(conflict => conflict.itemId === item.id),
        session.submissions.flatMap(submission => submission.draft.conflicts || []).filter(conflict => conflict.id === item.nomination.id)]);
}


// 只有來源結構改變（例如使用者載入新版本）才需要重新建立表單。
function structure(item) {
    const n = item.nomination;
    return JSON.stringify([item.mode, n.source, n.original, n.previousProposal]);
}

function composing() {
    return [...views.values()].some(view => view.rows.isComposing()) || [...fieldInputs.values()].some(input => input.isComposing());
}

function afterComposition() { queue.catch(() => {}).then(sync); }

async function settleInputs() {
    await Promise.all([...views.values()].map(view => view.rows.settled()).concat([...fieldInputs.values()].map(input => input.settled())));
    await queue.catch(() => {});
}

function report(error) {
    const message = error.message || String(error);
    dock.$notice.text(message);
    mw.notify(message, {type: 'error'});
}

/** 本分頁的輸入依事件順序保存；完成後同步資料與派生顯示，保留原輸入框。 */
function update(task, retainInput = false, inputs = []) {
    // 失敗的規則彈窗修改未必已顯示在表單上，須連同重試函式保存實際輸入供確認。
    const pending = {run: task, inputs: copy(inputs)};
    queuedUpdates++;
    const next = queue.catch(() => {}).then(async () => {
        if (storageFailure) { unsavedTasks.push(pending); throw storageFailure; }
        try { return await task(); }
        catch (error) {
            // 本地輸入保存失敗時保留畫面，不以舊資料蓋回去；另一分頁可能剛送出或取消該筆。
            if (error.code === 'local-storage' || retainInput) { storageFailure = error; unsavedTasks.push(pending); }
            throw error;
        }
    });
    queue = next;
    next.then(() => { queuedUpdates--; if (queue === next) sync(); }, error => {
        queuedUpdates--;
        if (storageFailure) showStorageFailure();
        else { report(error); if (queue === next) sync(); }
    });
    return next;
}

function showStorageFailure() {
    saveButton.setDisabled(true); confirmButton.setDisabled(true);
    dock.stashButton.setDisabled(true);
    dock.$notice.empty().append(t('自動保存失敗，畫面上的輸入尚未保存：', '自动保存失败，画面上的输入尚未保存：'), storageFailure.message,
        ' ', button(t('重試保存', '重试保存'), async () => {
            await queue.catch(() => {});
            try {
                while (unsavedTasks.length) { await unsavedTasks[0].run(); unsavedTasks.shift(); }
                storageFailure = null; dock.$notice.empty(); sync();
            } catch (error) { storageFailure = error; showStorageFailure(); }
        }).$element, ' ', button(t('捨棄未保存輸入', '舍弃未保存输入'), discardUnsavedInputs).$element);
}

async function discardUnsavedInputs() {
    await settleInputs();
    const pending = [...unsavedTasks];
    const entries = collectUnsavedInputs(pending.flatMap(task => task.inputs));
    if (!await confirmDiscardInputs(windows, entries)) return;
    // 確認只適用於彈窗列出的內容，不能連帶丟掉其後才進入佇列的輸入。
    if (pending.length !== unsavedTasks.length || pending.some((task, index) => task !== unsavedTasks[index])) {
        throw new Error(t('未保存輸入已變更，請重新檢視後再捨棄。', '未保存输入已变更，请重新检查后再舍弃。'));
    }
    unsavedTasks = []; storageFailure = null;
    for (const view of views.values()) removeView(view);
    views.clear(); dock.$notice.empty(); await sync();
}

function nominationInput(id, before, after) {
    const fields = ['pageName', 'awarder', 'ruleStatus', 'message', 'invalid', 'reviewed']
        .filter(field => !equal(before[field], after[field]));
    return {key: id, label: after.pageName || before.pageName || t('未填條目', '未填条目'),
        before: Object.fromEntries(fields.map(field => [field, before[field] ?? null])),
        after: Object.fromEntries(fields.map(field => [field, after[field] ?? null]))};
}

function button(label, handler, flags) {
    const widget = new OO.ui.ButtonWidget({label, flags});
    widget.on('click', () => Promise.resolve().then(handler).catch(report));
    return widget;
}

export function initOOUI() {
    const root = getArticleRoot();
    initEditorStyles();
    windows = initRuleEditor(root);
    initDraftDialog();
    initDiscardInputDialog();
    dock = createDock(root);
    store = createSessionStore(window.localStorage, `ACGATool:v1:${mw.config.get('wgDBname')}:${mw.config.get('wgUserName') || 'anonymous'}`,
        navigator.locks, mw.config.get('wgUserName') || '');
    ready = store.init();
    controller = createSubmitController(store, result => {
        if (result) completedResults.set(result.id, result);
        if (session) sync();
    });
    saveButton = button(t('送出全部', '提交全部'), openConfirmation, ['primary', 'progressive']);
    dock.$actions.append(saveButton.$element);
    dock.stashButton.on('click', () => stashAll().catch(report));
    dock.toggles.drafts.on('click', () => openDraftBox().catch(report));
    initConfirmation();
    window.addEventListener('storage', event => {
        if (event.key === store.key || event.key === null) queue.catch(() => {}).then(sync);
    });
    return ready.catch(error => { report(error); throw error; });
}

export async function resumeOpenWorkspace() {
    await ready;
    pageReady = true;
    await sync();
    return session.items.length > 0;
}

async function addItems(mode, nominations) {
    await ready;
    const {result} = await update(() => store.add(mode, nominations), false,
        nominations.map((n, index) => nominationInput(`open:${n.id || index}`, {}, n)));
    await sync();
    focusItem(result.at(-1));
}

export async function showNewNominationDialog() {
    const nominations = [{id: newId(), pageName: '', awarder: mw.config.get('wgUserName') || '', ruleStatus: {}}];
    return addItems('new', nominations);
}

export function showEditNominationDialog(nomination) { return addItems('edit', [nomination]); }
export function showCheckNominations(nominations) { return addItems('check', nominations); }
export async function archiveSection(date) { await ready; return save(() => controller.archive(date)); }

function focusItem(id) {
    const view = views.get(id);
    if (!view) return;
    view.rows.$entry[0].scrollIntoView({block: 'center'});
    view.rows.$entry.find('input').first().trigger('focus');
}

/** 新表單排在正文最後、頁尾新增入口之前；只在建立或恢復位置時插入，不搬動既有輸入框。 */
function appendEditorSection($section) {
    const $root = $(getArticleRoot());
    const $footer = $root.children('.acga-new-nomination-footer');
    if ($footer.length) $section.insertBefore($footer);
    else $root.append($section);
}

function ensureNewTable() {
    if ($newSection) return;
    $date = $('<div>').addClass('mw-heading mw-heading3').append($('<h3>'));
    $newTable = createNominationTable();
    $newSection = $('<section>').addClass('acga-editor acga-new-editor').append($date, $('<div>').addClass('acga-table-scroll').append($newTable));
    appendEditorSection($newSection);
    refreshPlacement();
}

function refreshPlacement() {
    clearTimeout(previewTimer);
    if (!$newSection) return;
    const dates = getNominationSections(getArticleRoot()).map(section => section.heading.textContent.trim());
    const {date, newSection} = getNewNominationPlacement(dates);
    $date.toggle(newSection).find('h3').text(date);
    $newSection.attr('aria-label', newSection ? t(`新提名：新增 ${date} 小節`, `新提名：新增 ${date} 小节`) : t(`新提名：接在 ${date} 小節末尾`, `新提名：接在 ${date} 小节末尾`));
    dock.$summary.attr('title', $newSection.attr('aria-label'));
    const now = new Date();
    previewTimer = setTimeout(refreshPlacement, Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime() + 50);
}

function removeView(view) {
    view.rows.destroy();
    view.rows.$entry.add(view.rows.$check).remove();
    for (const [element, display] of view.hidden) element.style.display = display;
}

function renderItem(item) {
    const view = {item: copy(item), structure: structure(item), hidden: [], lastSent: copy(item.nomination)};
    const n = view.item.nomination;
    const save = () => {
        const before = view.lastSent, after = copy(n);
        if (equal(before, after)) return;
        view.lastSent = after;
        update(() => store.patch(item.id, before, after), true, [nominationInput(item.id, before, after)]);
    };
    const touch = () => { if (item.mode === 'check') n.reviewed = false; save(); };
    const $table = item.mode === 'new' ? (ensureNewTable(), $newTable) : createNominationTable();
    view.rows = appendNominationRows($table, n, session.items.indexOf(item), {
        checking: item.mode === 'check', touch, onReviewed: save, onInputSettled: afterComposition,
        openRules: async () => {
            await settleInputs();
            const before = copy(n);
            const rules = await chooseRules(before, item.mode === 'check');
            if (rules) {
                const after = {...before, ruleStatus: rules, ...(item.mode === 'check' ? {reviewed: false} : {})};
                await update(() => store.patch(item.id, before, after), false, [nominationInput(item.id, before, after)]);
            }
            afterComposition();
        },
        onRemove: async () => { await settleInputs(); return discard(item.id); },
        onStash: async () => { await settleInputs(); return update(() => store.stash(item.id), false,
            [{label: t('暫存：', '暂存：') + (n.pageName || t('未填條目', '未填条目'))}]); },
    });
    const $rows = view.rows.$entry.add(view.rows.$check);
    $rows.attr('data-acga-operation', item.id).addClass('acga-editor-row');
    view.$table = $table;
    const $cell = view.rows.$check.children('td');
    view.$extras = $('<div>').appendTo($cell);
    const type = operationType(item);
    view.$backgroundRows = $rows.addClass(`acga-operation-background acga-type-${type}`);
    const icon = {new: cdxIconUserAdd, edit: cdxIconEdit, check: cdxIconHighlight, recheck: cdxIconSandbox}[type];
    $cell.append($('<span>').addClass('acga-background-mark').attr('aria-hidden', 'true')
        .append($('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">').html(icon)));
    view.$label = $('<span>').addClass('acga-ready-label').appendTo($cell);
    view.$errors = $('<ul>').addClass('acga-validation').appendTo($cell);
    views.set(item.id, view);
    placeView(view);
    refreshView(view, item);
}

function sourceAvailable(item) {
    return item.mode === 'new' || sourceRows(item.nomination.source).length > 0;
}

/** 只在初次開啟或正文真正刷新後放置表單，不隨自動保存搬動節點。 */
function placeView(view) {
    const {item, rows} = view;
    const $rows = rows.$entry.add(rows.$check);
    if (item.mode === 'new') {
        ensureNewTable();
        if (rows.$entry.parent()[0] !== $newTable.children('tbody')[0]) $newTable.children('tbody').append($rows);
        view.$table = $newTable;
    } else {
        const $source = sourceRows(item.nomination.source);
        if ($source.length) {
            $rows.addClass('acga-editor');
            $source.first().before($rows);
            $source.closest('table').addClass('acga-edit-table');
            $source.each((_, element) => { view.hidden.push([element, element.style.display]); element.style.display = 'none'; });
        } else return;
    }
    view.placed = true;
}

/** 保存不重建表單；僅同步真正不同的欄位值與派生顯示。 */
function refreshView(view, item) {
    const n = view.item.nomination;
    Object.assign(n, copy(item.nomination));
    view.item = {...copy(item), nomination: n};
    view.lastSent = copy(n);
    view.signature = signature(item);
    view.rows.sync();
    const $rows = view.rows.$entry.add(view.rows.$check);
    $rows.toggleClass('acga-needs-review', !!item.needsReview || session.submissions.some(submission => submission.draft.conflicts?.some(conflict => conflict.id === n.id)));
    const extras = JSON.stringify([item.reviewDiff, item.needsReview, n.previousProposal]);
    if (extras !== view.extras) {
        view.extras = extras;
        const $extras = view.$extras.empty();
        if (item.reviewDiff?.length) {
            const $diff = $('<details>').addClass('acga-conflicts').prop('open', true).append($('<summary>').text(t('來源變更與先前輸入', '来源变更与先前输入')));
            appendDifferences($diff, item.reviewDiff);
            if (item.needsReview) $diff.append(button(t('已檢視差異，保留目前修改', '已检查差异，保留目前修改'), () => {
                const expected = copy(view.item);
                return update(() => store.mutate(current => {
                    const target = current.items.find(row => row.id === item.id);
                    if (target && equal(target, expected)) target.needsReview = false;
                    else throw new Error(t('內容已變更，請重新檢視。', '内容已变更，请重新检查。'));
                }), false, [{label: t('確認來源差異：', '确认来源差异：') + n.pageName}]);
            }).$element);
            $extras.append($diff);
        }
        if (n.previousProposal && item.mode === 'check') $extras.append(button(t('套用先前輸入', '应用先前输入'), async () => {
            await settleInputs();
            const proposed = n.previousProposal;
            const before = copy(n), after = {...before, pageName: proposed.pageName, awarder: proposed.awarder, ruleStatus: proposed.ruleStatus,
                message: proposed.message || '', invalid: !!proposed.invalid, reviewed: false};
            return update(() => store.patch(item.id, before, after), false, [nominationInput(item.id, before, after)]);
        }).$element);
    }
    const status = operationStatus(item);
    const complete = status.active && status.ready && !$rows.hasClass('acga-needs-review') && !session.conflicts.some(conflict => conflict.itemId === item.id);
    view.$backgroundRows.toggleClass('acga-ready', complete);
    const locked = lockedItem(session, item.id);
    view.$label.toggle(complete).text(locked ? t('已送出，等待儲存完成', '已提交，等待保存完成') : t('已準備送出', '已准备提交'));
    const errors = status.errors.filter(error => error.field !== 'reviewed');
    if (JSON.stringify(errors) !== view.errors) {
        view.errors = JSON.stringify(errors);
        view.$errors.empty(); $rows.find('[aria-invalid]').removeAttr('aria-invalid');
        for (const error of errors) {
            view.$errors.append($('<li>').text(error.message));
            $rows.find(`[data-acga-field="${error.field}"]`).attr('aria-invalid', 'true');
        }
    }
    if (view.locked !== locked) {
        $rows.prop('inert', locked).toggleClass('acga-saving', locked);
        if (locked) $rows.attr('inert', '');
        else $rows.removeAttr('inert');
        view.locked = locked;
    }
}

/** 同步持久資料；本地保存只更新派生顯示，IME 組合中的操作留待輸入結束。 */
async function sync() {
    if (!pageReady || queuedUpdates) return;
    if (storageFailure) { showStorageFailure(); return; }
    let current;
    try { current = await store.read(); }
    catch (error) { report(error); return; }
    // 等待跨分頁狀態鎖時可能又有本地輸入；讓該次保存完成後再同步，保留輸入與 IME。
    if (queuedUpdates || storageFailure) return;
    if (!refreshing) {
        // 正文完成索引後才判斷來源；刷新期間暫時 detach 的列不算恢復失敗。
        const missing = current.items.filter(item => !views.get(item.id)?.placed && !sourceAvailable(item));
        let moved = 0;
        for (const item of missing) {
            try { moved += (await store.stash(item.id, true)).result; }
            catch (error) { report(error); }
        }
        if (moved) {
            mw.notify(t('恢復失敗的草稿已移動到暫存箱。', '恢复失败的草稿已移动到暂存箱。'));
            current = await store.read();
        }
        if (queuedUpdates || storageFailure) return;
    }
    session = current;
    for (const [id, view] of views) {
        if (view.rows.isComposing()) continue;
        const item = session.items.find(item => item.id === id);
        if (!item || view.structure !== structure(item)) {
            removeView(view); views.delete(id);
        } else if (view.signature !== signature(item) || view.locked !== lockedItem(session, id)) refreshView(view, item);
    }
    for (const item of session.items) {
        if (!views.get(item.id)?.placed && !sourceAvailable(item)) continue;
        if (!views.has(item.id)) renderItem(item);
        else if (!views.get(item.id).placed && !views.get(item.id).rows.isComposing()) placeView(views.get(item.id));
    }
    // 原順序已正確時不重新 append；這也保留焦點、撤銷歷史與輸入法掛載位置。
    if ($newTable && !composing()) {
        let previous = $newTable.find('.acgnom-header')[0];
        for (const item of session.items.filter(item => item.mode === 'new')) {
            const {rows} = views.get(item.id);
            if (previous.nextElementSibling !== rows.$entry[0]) rows.$entry.insertAfter(previous);
            if (rows.$entry[0].nextElementSibling !== rows.$check[0]) rows.$check.insertAfter(rows.$entry);
            previous = rows.$check[0];
        }
    }
    if ($newSection && !$newTable.find('.acgnom-entry').length) {
        $newSection.remove(); $newSection = $newTable = $date = null; clearTimeout(previewTimer);
    }
    const progress = sessionProgress(session);
    dock.setActive(session.items.length > 0);
    dock.$title.text(t('ACGATool'));
    const pending = session.items.filter(item => lockedItem(session, item.id)).length;
    dock.$summary.text((progress.total || !pending ? `${progress.ready} / ${progress.total} ${t('筆已準備完成', '项已准备完成')}` : '') +
        (pending ? `${progress.total ? '；' : ''}${pending} ${t('筆儲存尚未完成', '项保存尚未完成')}` : ''));
    dock.setProgress(progress);
    saveButton.setDisabled(!progress.complete || busy);
    dock.stashButton.setDisabled(busy || !session.items.some(item => !lockedItem(session, item.id)));
    dock.toggles.drafts.setLabel(`${t('草稿箱')} (${session.drafts.length})`);
    dock.toggles.sync.toggle(session.conflicts.length > 0);
    dock.toggles.progress.toggle(session.submissions.length > 0 || completedResults.size > 0);
    renderSyncConflicts();
    renderProgress();
    syncConfirmation(progress);
    updatePublishedResults();
}

/** 成功結果直接更新正文；浮層與尚未提交的輸入留在共同工作區，不靠整頁重載。 */
async function updatePublishedResults() {
    const pending = [...completedResults.values()].filter(result => !renderedResults.has(result.id));
    if (refreshing || !pending.length || composing() || queuedUpdates || windows.getCurrentWindow()) return;
    refreshing = true;
    try {
        let active, selection;
        const replaced = await refreshRegistryContent([dock.$element, windows.$element], () => {
            // 讀取正文期間也可能開始了輸入法組合，替換前必須再檢查。
            if (composing() || queuedUpdates || windows.getCurrentWindow()) return false;
            active = document.activeElement;
            selection = [active?.selectionStart, active?.selectionEnd];
            for (const view of views.values()) {
                view.rows.$entry.add(view.rows.$check).detach();
                for (const [element, display] of view.hidden) element.style.display = display;
                view.hidden = []; view.placed = false;
            }
            $newSection?.remove(); $newSection = $newTable = $date = null;
            clearTimeout(previewTimer);
        });
        if (replaced) {
            pending.forEach(submission => renderedResults.add(submission.id));
            await sync();
            if (document.contains(active) && document.activeElement !== active && active?.matches('input, textarea')) {
                active.focus();
                if (selection[0] !== null) try { active.setSelectionRange(...selection); } catch { /* 非文字輸入沒有選取範圍。 */ }
            }
        }
    } catch (error) {
        pending.forEach(submission => renderedResults.add(submission.id));
        dock.$notice.text(t('儲存已完成，但正文更新失敗。可查看已儲存版本，或使用「關閉並重新載入頁面」。', '储存已完成，但正文更新失败。可查看已保存版本，或使用「关闭并重新载入页面」。'));
    } finally {
        refreshing = false;
        await sync();
    }
}

async function discard(id) {
    const title = views.get(id).item.nomination.pageName || t('未填條目', '未填条目');
    const {result} = await update(() => store.discard(id), false, [{label: t('取消操作：') + title}]);
    dock.$notice.empty().append(t('已取消此筆操作。', '已取消此项操作。'), ' ', button(t('復原', '恢复'), () => update(() => store.mutate(current => {
        if (current.items.some(item => item.id === id) || current.drafts.some(item => item.id === id)) throw new Error(t('此操作已恢復。', '此操作已恢复。'));
        if (current.items.some(item => sameSource(item.nomination.source, result.nomination.source))) throw new Error(t('這筆提名已有其他編輯，請先暫存或取消該筆操作後再復原。', '这项提名已有其他编辑，请先暂存或取消该项操作后再恢复。'));
        current.items.push(result);
        dock.$notice.empty();
    }), false, [{label: t('復原操作：', '恢复操作：') + title}])).$element);
}

async function openDraftBox() {
    await queue.catch(() => {});
    const items = (await store.read()).drafts.map(item => ({...item, label: `${item.nomination.awarder || t('未填用戶', '未填用户')} · ${item.nomination.pageName || t('未填條目', '未填条目')} · ${ruleFragments(item.nomination.ruleStatus).$element.text() || t('尚未選擇規則', '尚未选择规则')}`}));
    const dialog = new DraftDialog({size: 'medium', items,
        restore: selected => update(async () => {
            const response = await store.restore(selected.map(item => item.id), sourceAvailable);
            for (const failure of response.result.failures) {
                const item = selected.find(item => item.id === failure.id);
                const name = item.nomination.pageName || t('未填條目', '未填条目');
                mw.notify(t(`「${name}」恢復失敗：`, `「${name}」恢复失败：`) + failure.reason, {type: 'error'});
            }
            return response;
        }, false, selected.map(item => ({label: t('恢復草稿：', '恢复草稿：') + (item.nomination.pageName || t('未填條目', '未填条目'))}))),
        discard: selected => update(() => store.mutate(current => { current.drafts = current.drafts.filter(item => !selected.some(choice => choice.id === item.id)); }),
            false, selected.map(item => ({label: t('刪除草稿：', '删除草稿：') + (item.nomination.pageName || t('未填條目', '未填条目'))}))),
    });
    windows.addWindows([dialog]);
    await windows.openWindow(dialog).closed;
    await windows.removeWindows(['ACGADrafts']);
    afterComposition();
}

async function stashAll() {
    await settleInputs();
    if (storageFailure) return showStorageFailure();
    const {result: count} = await update(() => store.stashAll(), false,
        session.items.filter(item => !lockedItem(session, item.id)).map(item => ({label: t('暫存：', '暂存：') + (item.nomination.pageName || t('未填條目', '未填条目'))})));
    if (confirming) { confirming = false; dock.showPanel(null); }
    dock.$notice.text(t(`已暫存 ${count} 筆操作。`, `已暂存 ${count} 项操作。`));
}

function initConfirmation() {
    const $pane = dock.panes.confirm;
    $pane.append($('<p>').addClass('acga-confirm-summary'));
    messageInput = new OO.ui.MultilineTextInputWidget({autosize: true, rows: 2, placeholder: t('提名說明（選填，無須簽名）', '提名说明（选填，无须签名）')});
    summaryInput = new OO.ui.TextInputWidget({placeholder: t('編輯摘要（選填）', '编辑摘要（选填）')});
    for (const [field, input, label] of [['message', messageInput, t('本批新提名的說明', '本批新提名的说明')], ['summary', summaryInput, t('編輯摘要', '编辑摘要')]]) {
        input.$input.attr('aria-label', label);
        $pane.append($('<div>').addClass(`acga-submit-${field}`).append($('<label>').attr('for', input.getInputId()).text(label), input.$element));
        fieldInputs.set(field, bindTextInput(input, value => {
            if (!fieldsBaseline || fieldsBaseline[field] === value) return;
            const before = {...fieldsBaseline}, after = {...before, [field]: value};
            fieldsBaseline = after;
            update(() => store.fields(before, after), true, [{key: 'fields', label: t('提名說明與編輯摘要', '提名说明与编辑摘要'),
                before: {[field]: before[field]}, after: {[field]: value}}]);
        }, afterComposition));
    }
    confirmButton = button(t('確認送出', '确认提交'), async () => {
        await settleInputs();
        if (!confirmation) return;
        const expected = copy(confirmation);
        confirming = false;
        await save(() => controller.start(expected));
    }, ['primary', 'progressive']);
    $pane.append($('<div>').addClass('acga-actions').append(confirmButton.$element, button(t('返回編輯', '返回编辑'), () => { confirming = false; dock.showPanel(null); }).$element));
}

async function openConfirmation() {
    await settleInputs();
    if (storageFailure) return showStorageFailure();
    await sync();
    confirming = true;
    syncConfirmation(sessionProgress(session));
    dock.showPanel('confirm');
}

function syncConfirmation(progress) {
    if ([...fieldInputs.values()].some(input => input.isComposing())) return;
    const counts = progress.byType;
    dock.panes.confirm.find('.acga-confirm-summary').text(t(
        `新提名 ${counts.new.total} 筆、修改 ${counts.edit.total} 筆、核對 ${counts.check.total} 筆、覆核 ${counts.recheck.total} 筆`,
        `新提名 ${counts.new.total} 笔、修改 ${counts.edit.total} 笔、核对 ${counts.check.total} 笔、复核 ${counts.recheck.total} 笔`));
    dock.panes.confirm.find('.acga-submit-message').toggle(counts.new.total > 0);
    for (const [field, input] of fieldInputs) input.sync(session.fields[field]);
    fieldsBaseline = {...session.fields};
    confirmButton.setDisabled(!progress.complete || busy);
    if (confirming) confirmation = {items: copy(progress.items), fields: {...session.fields}};
}

async function save(task) {
    busy = true; sync(); dock.showPanel('progress');
    try { await task(); }
    finally { busy = false; await sync(); }
}

function renderSyncConflicts() {
    const $pane = dock.panes.sync.empty();
    for (const conflict of session.conflicts) {
        const name = session.items.find(item => item.id === conflict.itemId)?.nomination.pageName || t('送出說明／摘要', '提交说明／摘要');
        $pane.append($('<p>').text(`${name}：${fieldLabel(conflict.field)}` + t('在不同分頁有不同修改。', '在不同分页有不同修改。')));
        $pane.append($('<p>').text(t('目前保存：') + fieldText(conflict.field, conflict.current)), $('<p>').text(t('這次輸入：', '这次输入：') + fieldText(conflict.field, conflict.proposed)));
        $pane.append($('<div>').addClass('acga-actions').append(
            button(t('使用目前保存的內容', '使用目前保存的内容'), () => update(() => store.resolve(conflict.id, false), false,
                [{label: name + t('：使用目前保存的內容', '：使用目前保存的内容')}])).$element,
            button(t('使用這次輸入', '使用这次输入'), () => update(() => store.resolve(conflict.id, true), false,
                [{key: conflict.itemId || 'fields', label: name, before: {[conflict.field]: conflict.current}, after: {[conflict.field]: conflict.proposed}}])).$element));
    }
    if (session.conflicts.length && !composing()) dock.showPanel('sync');
}

/** 進度與完成畫面共用步驟呈現；只有未完成提交提供重試操作。 */
function renderSaveSteps(steps, retryStep) {
    const $steps = $('<ol>').addClass('acga-save-progress');
    for (const [index, step] of steps.entries()) {
        const name = {registry: t('登記處', '登记处'), scores: t('積分榜', '积分榜'), archive: t('存檔頁', '存档页')}[step.key];
        const labels = {pending: t('等待儲存', '等待保存'), saving: t('正在儲存', '正在保存'), succeeded: t('✓ 已完成'), failed: t('儲存失敗', '保存失败'), conflict: t('內容已變更', '内容已变更')};
        const $row = $('<li>').append($('<strong>').text(`${name}：${labels[step.status]}`));
        if (step.error) $row.append($('<p>').text(step.error));
        if (step.status === 'succeeded' && step.revid) $row.append(' ', $('<a>').attr({href: mw.util.getUrl(step.title, {oldid: step.revid}), target: '_blank', rel: 'noopener'}).text(t('查看已儲存版本', '查看已储存版本')));
        if (retryStep && ['pending', 'failed', 'saving'].includes(step.status)) {
            const retry = button((step.status === 'pending' ? t('儲存', '保存') : t('重試儲存', '重试保存')) + name, () => retryStep(step.key));
            retry.setDisabled(busy || steps.slice(0, index).some(previous => previous.status !== 'succeeded'));
            $row.append(retry.$element);
        }
        $steps.append($row);
    }
    return $steps;
}

function renderProgress() {
    const $pane = dock.panes.progress.empty();
    for (const submission of session.submissions) {
        const draft = submission.draft, operation = draft.operation;
        const $block = $('<section>').addClass('acga-save-result');
        $block.append($('<strong>').text((draft.archive ? t(`歸檔「${draft.archive.date}」：`, `归档「${draft.archive.date}」：`) : '') + t('本次儲存進度', '本次储存进度')),
            renderSaveSteps(operation?.steps || [], key => save(() => controller.step(submission.id, key))));
        if (submission.error) $block.append($('<p>').attr('role', 'alert').text(submission.error));
        if (draft.conflicts?.length) {
            const $diff = $('<div>').addClass('acga-conflicts');
            appendDifferences($diff, draft.conflicts);
            $block.append($diff, button(t('載入最新內容並重新核對', '载入最新内容并重新核对'), () => save(() => controller.rebase(submission.id))).$element);
        }
        const $actions = $('<div>').addClass('acga-actions');
        if (draft.mode !== 'archive' || !operation?.steps.some(step => ['succeeded', 'saving'].includes(step.status))) {
            const back = button(draft.mode === 'archive' ? t('取消歸檔', '取消归档') : t('返回修改'), async () => {
                await save(() => controller.returnToEditing(submission.id));
                dock.showPanel(null);
                if (draft.mode !== 'archive') focusItem(submission.itemIds.find(id => views.has(id)));
            });
            back.setDisabled(busy); $actions.append(back.$element);
        }
        $actions.append(button(t('稍後處理', '稍后处理'), () => dock.showPanel(null)).$element);
        $pane.append($block.append($actions));
    }
    // 完成畫面只持有本頁結果；關閉直接移除，不經過工作區保存或跨分頁同步。
    for (const result of completedResults.values()) {
        const $block = $('<section>').addClass('acga-save-result');
        $block.append($('<strong>').text((result.archiveDate ? t(`歸檔「${result.archiveDate}」：`, `归档「${result.archiveDate}」：`) : '') + t('本次提交已完成。')),
            renderSaveSteps(result.steps));
        const close = reload => {
            completedResults.delete(result.id);
            renderProgress();
            dock.toggles.progress.toggle(session.submissions.length > 0 || completedResults.size > 0);
            dock.showPanel(null);
            if (reload) location.reload();
        };
        $pane.append($block.append($('<div>').addClass('acga-actions').append(
            button(t('關閉', '关闭'), () => close(false)).$element,
            button(t('關閉並重新載入頁面', '关闭并重新载入页面'), () => close(true)).$element)));
    }
}
