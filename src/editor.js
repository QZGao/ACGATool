import state from './state.js';
import {createDock} from './dock.js';
import {getArticleRoot, getNominationSections} from './page-dom.js';
import {initRuleEditor, chooseRules} from './rule-dialog.js';
import {initEditorStyles} from './editor-styles.js';
import {DraftDialog, initDraftDialog} from './draft-dialog.js';
import {appendNominationRows, createNominationTable, sourceRows, ruleFragments} from './table-editor.js';
import {createSessionStore} from './session-store.js';
import {createSubmitController} from './session-submit.js';
import {copy, equal, operationStatus, sessionProgress, lockedItem, sameSource} from './operations.js';
import {newId} from './scoring.js';
import {getNewNominationPlacement} from './submission.js';
import {appendDifferences, fieldText} from './review-ui.js';
import {cdxIconUserAdd, cdxIconEdit, cdxIconHighlight} from './icons.js';
import {refreshRegistryContent} from './published-view.js';
import {bindTextInput} from './text-input.js';

const t = (hant, hans = hant) => state.convByVar({hant, hans});
let store, controller, dock, windows, ready, session, queue = Promise.resolve(), busy = false;
let $newSection, $newTable, $date, previewTimer, confirming = false, confirmation;
let saveButton, addButton, messageInput, summaryInput, confirmButton, fieldsBaseline;
const fieldInputs = new Map();
let queuedUpdates = 0;
let storageFailure = null, unsavedTasks = [];
const views = new Map();
const renderedResults = new Set();
let refreshing = false;

function signature(item) {
    return JSON.stringify([item, session.conflicts.filter(conflict => conflict.itemId === item.id),
        session.submissions.flatMap(submission => submission.draft.conflicts || []).filter(conflict => conflict.id === item.nomination.id)]);
}


// 只有來源結構改變（例如使用者載入新版本）才需要重新建立表單。
function structure(item) {
    const n = item.nomination;
    return JSON.stringify([item.mode, n.source, n.original, n.baseline, n.previousProposal]);
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
function update(task, retainInput = false) {
    queuedUpdates++;
    const next = queue.catch(() => {}).then(async () => {
        if (storageFailure) { unsavedTasks.push(task); throw storageFailure; }
        try { return await task(); }
        catch (error) {
            // 本地輸入保存失敗時保留畫面，不以舊資料蓋回去；另一分頁可能剛送出或取消該筆。
            if (error.code === 'local-storage' || retainInput) { storageFailure = error; unsavedTasks.push(task); }
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
    dock.$notice.empty().append(t('自動保存失敗，畫面上的輸入尚未保存：', '自动保存失败，画面上的输入尚未保存：'), storageFailure.message,
        ' ', button('重試保存', async () => {
            await queue.catch(() => {});
            try {
                while (unsavedTasks.length) { await unsavedTasks[0](); unsavedTasks.shift(); }
                storageFailure = null; dock.$notice.empty(); sync();
            } catch (error) { storageFailure = error; showStorageFailure(); }
        }).$element, ' ', button('捨棄未保存輸入', () => {
            unsavedTasks = []; storageFailure = null;
            for (const view of views.values()) removeView(view);
            views.clear(); dock.$notice.empty(); sync();
        }).$element);
}

function button(label, handler, flags) {
    const widget = new OO.ui.ButtonWidget({label: t(label), flags});
    widget.on('click', () => Promise.resolve().then(handler).catch(report));
    return widget;
}

export function initOOUI() {
    const root = getArticleRoot();
    initEditorStyles();
    windows = initRuleEditor(root);
    initDraftDialog();
    dock = createDock(root);
    store = createSessionStore(window.localStorage, `ACGATool:v1:${mw.config.get('wgDBname')}:${mw.config.get('wgUserName') || 'anonymous'}`);
    ready = store.init();
    controller = createSubmitController(store, () => { if (session) sync(); });
    saveButton = button('送出全部', openConfirmation, ['primary', 'progressive']);
    addButton = button('新增一筆', () => showNewNominationDialog());
    dock.$actions.append(saveButton.$element, addButton.$element);
    dock.jumpButton.on('click', () => {
        const item = session.items.find(item => !operationStatus(item).ready) || session.items[0];
        focusItem(item?.id);
    });
    dock.toggles.drafts.on('click', () => openDraftBox().catch(report));
    initConfirmation();
    window.addEventListener('storage', event => {
        if (event.key === store.key || event.key === null) queue.catch(() => {}).then(sync);
    });
    return ready.catch(error => { report(error); throw error; });
}

export async function resumeOpenWorkspace() {
    await ready;
    sync();
    return session.items.length > 0;
}

async function addItems(mode, nominations) {
    await ready;
    const {result} = await update(() => store.add(mode, nominations));
    sync();
    focusItem(result.at(-1));
}

export async function showNewNominationDialog(workspace) {
    const nominations = workspace?.nominations || [{id: newId(), pageName: '', awarder: mw.config.get('wgUserName') || '', ruleStatus: {}}];
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

function ensureNewTable() {
    if ($newSection) return;
    $date = $('<div>').addClass('mw-heading mw-heading3').append($('<h3>'));
    $newTable = createNominationTable();
    $newSection = $('<section>').addClass('acga-editor acga-new-editor').append($date, $('<div>').addClass('acga-table-scroll').append($newTable));
    $(getArticleRoot()).append($newSection);
    refreshPlacement();
}

function refreshPlacement() {
    clearTimeout(previewTimer);
    if (!$newSection) return;
    const dates = getNominationSections(getArticleRoot()).map(section => section.heading.textContent.trim());
    const {date, newSection} = getNewNominationPlacement(dates);
    $date.toggle(newSection).find('h3').text(date);
    $newSection.attr('aria-label', newSection ? `新提名：新增 ${date} 小節` : `新提名：接在 ${date} 小節末尾`);
    dock.$summary.attr('title', $newSection.attr('aria-label'));
    const now = new Date();
    previewTimer = setTimeout(refreshPlacement, Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime() + 50);
}

function removeView(view) {
    view.rows.destroy();
    view.rows.$entry.add(view.rows.$check).remove();
    view.$container?.remove();
    for (const [element, display] of view.hidden) element.style.display = display;
}

function renderItem(item) {
    const view = {item: copy(item), structure: structure(item), hidden: [], lastSent: copy(item.nomination)};
    const n = view.item.nomination;
    const save = () => {
        const before = view.lastSent, after = copy(n);
        if (equal(before, after)) return;
        view.lastSent = after;
        update(() => store.patch(item.id, before, after), true);
    };
    const touch = () => { if (item.mode === 'check') n.reviewed = false; save(); };
    const $table = item.mode === 'new' ? (ensureNewTable(), $newTable) : createNominationTable();
    view.rows = appendNominationRows($table, n, session.items.indexOf(item), {
        checking: item.mode === 'check', touch, onReviewed: save, onInputSettled: afterComposition,
        openRules: async () => {
            await settleInputs();
            const before = copy(n);
            const rules = await chooseRules(before, item.mode === 'check');
            if (rules) await update(() => store.patch(item.id, before, {...before, ruleStatus: rules,
                ...(item.mode === 'check' ? {reviewed: false} : {})}));
            afterComposition();
        },
        onRemove: async () => { await settleInputs(); return discard(item.id); },
        onStash: async () => { await settleInputs(); return update(() => store.stash(item.id)); },
    });
    const $rows = view.rows.$entry.add(view.rows.$check);
    $rows.attr('data-acga-operation', item.id).addClass('acga-editor-row');
    view.$table = $table;
    const $cell = view.rows.$check.children('td');
    view.$extras = $('<div>').appendTo($cell);
    $cell.addClass(`acga-operation-background acga-type-${item.mode}`);
    const icon = {new: cdxIconUserAdd, edit: cdxIconEdit, check: cdxIconHighlight}[item.mode];
    $cell.append($('<span>').addClass('acga-background-mark').attr('aria-hidden', 'true')
        .append($('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">').html(icon)));
    view.$label = $('<span>').addClass('acga-ready-label').appendTo($cell);
    view.$errors = $('<ul>').addClass('acga-validation').appendTo($cell);
    views.set(item.id, view);
    placeView(view);
    refreshView(view, item);
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
        } else {
            // 原提名不在本頁時仍呈現本地輸入；提交前會重新驗證來源。
            view.$table.children('tbody').append($rows);
            view.$container = $('<section>').addClass('acga-editor').attr('aria-label', t('既有提名的編輯', '现有提名的编辑')).append(view.$table);
            if ($newSection) $newSection.before(view.$container);
            else $(getArticleRoot()).append(view.$container);
        }
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
    const $rows = view.rows.$entry.add(view.rows.$check), $cell = view.rows.$check.children('td');
    $rows.toggleClass('acga-needs-review', !!item.needsReview || session.submissions.some(submission => submission.draft.conflicts?.some(conflict => conflict.id === n.id)));
    const extras = JSON.stringify([item.reviewDiff, item.needsReview, n.previousProposal]);
    if (extras !== view.extras) {
        view.extras = extras;
        const $extras = view.$extras.empty();
        if (item.reviewDiff?.length) {
            const $diff = $('<details>').addClass('acga-conflicts').prop('open', true).append($('<summary>').text(t('來源變更與先前輸入', '来源变更与先前输入')));
            appendDifferences($diff, item.reviewDiff);
            if (item.needsReview) $diff.append(button('已檢視差異，保留目前修改', () => {
                const expected = copy(view.item);
                return update(() => store.mutate(current => {
                    const target = current.items.find(row => row.id === item.id);
                    if (target && equal(target, expected)) target.needsReview = false;
                    else throw new Error('內容已變更，請重新檢視。');
                }));
            }).$element);
            $extras.append($diff);
        }
        if (n.previousProposal && item.mode === 'check') $extras.append(button('套用先前輸入', async () => {
            await settleInputs();
            const proposed = n.previousProposal;
            return update(() => store.patch(item.id, n, {...n, awarder: proposed.awarder, ruleStatus: proposed.ruleStatus,
                message: proposed.message || '', invalid: !!proposed.invalid, reviewed: false}));
        }).$element);
    }
    const status = operationStatus(item);
    const complete = status.active && status.ready && !$rows.hasClass('acga-needs-review') && !session.conflicts.some(conflict => conflict.itemId === item.id);
    $cell.toggleClass('acga-ready', complete);
    const locked = lockedItem(session, item.id);
    view.$label.toggle(complete).text(locked ? t('已送出，等待儲存完成', '已提交，等待保存完成') : t('已準備送出', '已准备提交'));
    const errors = status.errors.filter(error => error.field !== 'reviewed');
    if (JSON.stringify(errors) !== view.errors) {
        view.errors = JSON.stringify(errors);
        view.$errors.empty(); $rows.find('[aria-invalid]').removeAttr('aria-invalid');
        for (const error of errors) {
            view.$errors.append($('<li>').text(t(error.message)));
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
function sync() {
    if (queuedUpdates) return;
    if (storageFailure) { showStorageFailure(); return; }
    session = store.read();
    for (const [id, view] of views) {
        if (view.rows.isComposing()) continue;
        const item = session.items.find(item => item.id === id);
        if (!item || view.structure !== structure(item)) {
            removeView(view); views.delete(id);
        } else if (view.signature !== signature(item) || view.locked !== lockedItem(session, id)) refreshView(view, item);
    }
    for (const item of session.items) {
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
    addButton.toggle(session.items.some(item => item.mode === 'new'));
    dock.toggles.drafts.setLabel(`${t('草稿箱')} (${session.drafts.length})`);
    dock.toggles.sync.toggle(session.conflicts.length > 0);
    dock.toggles.progress.toggle(session.submissions.length > 0);
    renderSyncConflicts();
    renderProgress();
    syncConfirmation(progress);
    updatePublishedResults();
}

/** 成功結果直接更新正文；浮層與尚未提交的輸入留在共同工作區，不靠整頁重載。 */
async function updatePublishedResults() {
    const pending = session.submissions.filter(submission => submission.finished && !renderedResults.has(submission.id));
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
                view.$container?.remove(); view.$container = null;
            }
            $newSection?.remove(); $newSection = $newTable = $date = null;
            clearTimeout(previewTimer);
        });
        if (replaced) {
            pending.forEach(submission => renderedResults.add(submission.id));
            sync();
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
        sync();
    }
}

async function discard(id) {
    const {result} = await update(() => store.discard(id));
    dock.$notice.empty().append(t('已取消此筆操作。', '已取消此项操作。'), ' ', button('復原', () => update(() => store.mutate(current => {
        if (current.items.some(item => item.id === id) || current.drafts.some(item => item.id === id)) throw new Error('此操作已恢復。');
        if (current.items.some(item => sameSource(item.nomination.source, result.nomination.source))) throw new Error('這筆提名已有其他編輯，請先暫存或取消該筆操作後再復原。');
        current.items.push(result);
        dock.$notice.empty();
    }))).$element);
}

async function openDraftBox() {
    await queue.catch(() => {});
    const items = store.read().drafts.map(item => ({...item, label: `${item.nomination.awarder || '未填用戶'} · ${item.nomination.pageName || '未填條目'} · ${ruleFragments(item.nomination.ruleStatus).$element.text() || '尚未選擇規則'}`}));
    const dialog = new DraftDialog({size: 'medium', items,
        restore: selected => update(() => store.restore(selected.map(item => item.id))),
        discard: selected => update(() => store.mutate(current => { current.drafts = current.drafts.filter(item => !selected.some(choice => choice.id === item.id)); })),
    });
    windows.addWindows([dialog]);
    await windows.openWindow(dialog).closed;
    await windows.removeWindows(['ACGADrafts']);
    afterComposition();
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
            update(() => store.fields(before, after), true);
        }, afterComposition));
    }
    confirmButton = button('確認送出', async () => {
        await settleInputs();
        if (!confirmation) return;
        const expected = copy(confirmation);
        confirming = false;
        await save(() => controller.start(expected));
    }, ['primary', 'progressive']);
    $pane.append($('<div>').addClass('acga-actions').append(confirmButton.$element, button('返回編輯', () => { confirming = false; dock.showPanel(null); }).$element));
}

async function openConfirmation() {
    await settleInputs();
    if (storageFailure) return showStorageFailure();
    sync();
    confirming = true;
    syncConfirmation(sessionProgress(session));
    dock.showPanel('confirm');
}

function syncConfirmation(progress) {
    if ([...fieldInputs.values()].some(input => input.isComposing())) return;
    const counts = {new: 0, edit: 0, check: 0};
    progress.items.forEach(item => counts[item.mode]++);
    dock.panes.confirm.find('.acga-confirm-summary').text(`新提名 ${counts.new} 筆、修改 ${counts.edit} 筆、核對 ${counts.check} 筆`);
    dock.panes.confirm.find('.acga-submit-message').toggle(counts.new > 0);
    for (const [field, input] of fieldInputs) input.sync(session.fields[field]);
    fieldsBaseline = {...session.fields};
    confirmButton.setDisabled(!progress.complete || busy);
    if (confirming) confirmation = {items: copy(progress.items), fields: {...session.fields}};
}

async function save(task) {
    busy = true; sync(); dock.showPanel('progress');
    try { await task(); }
    finally { busy = false; sync(); }
}

function renderSyncConflicts() {
    const $pane = dock.panes.sync.empty();
    for (const conflict of session.conflicts) {
        const name = session.items.find(item => item.id === conflict.itemId)?.nomination.pageName || '送出說明／摘要';
        const labels = {pageName: '條目', awarder: '得分者', ruleStatus: '規則', message: '說明', summary: '編輯摘要', reviewed: '核對完成'};
        $pane.append($('<p>').text(`${name}：${labels[conflict.field] || conflict.field}在不同分頁有不同修改。`));
        $pane.append($('<p>').text(`目前保存：${fieldText(conflict.field, conflict.current)}`), $('<p>').text(`這次輸入：${fieldText(conflict.field, conflict.proposed)}`));
        $pane.append($('<div>').addClass('acga-actions').append(
            button('使用目前保存的內容', () => update(() => store.resolve(conflict.id, false))).$element,
            button('使用這次輸入', () => update(() => store.resolve(conflict.id, true))).$element));
    }
    if (session.conflicts.length && !composing()) dock.showPanel('sync');
}

function renderProgress() {
    const $pane = dock.panes.progress.empty();
    for (const submission of session.submissions) {
        const draft = submission.draft, operation = draft.operation;
        const $block = $('<section>').addClass('acga-save-result');
        $block.append($('<strong>').text((draft.archive ? `歸檔「${draft.archive.date}」：` : '') + (submission.finished ? t('本次提交已完成。', '本次提交已完成。') : t('本次儲存進度', '本次储存进度'))));
        const $steps = $('<ol>').addClass('acga-save-progress');
        for (const [index, step] of (operation?.steps || []).entries()) {
            const name = step.label || (step.key === 'registry' ? '登記處' : '積分榜');
            const labels = {pending: '等待儲存', saving: '正在儲存／等待查證', succeeded: '✓ 已完成', failed: '儲存失敗', unknown: '結果未明', conflict: '內容已變更'};
            const $row = $('<li>').append($('<strong>').text(`${name}：${labels[step.status]}`));
            if (step.error) $row.append($('<p>').text(step.error));
            if (step.status === 'succeeded' && step.revid) $row.append(' ', $('<a>').attr({href: mw.util.getUrl(step.title, {oldid: step.revid}), target: '_blank', rel: 'noopener'}).text(t('查看已儲存版本', '查看已储存版本')));
            if (['pending', 'failed', 'saving', 'unknown'].includes(step.status)) {
                const query = ['saving', 'unknown'].includes(step.status);
                const retry = button(query ? `查詢${name}結果` : `${step.status === 'failed' ? '重試儲存' : '儲存'}${name}`, () => save(() => controller.step(submission.id, step.key, query ? 'query' : 'retry')));
                retry.setDisabled(busy || operation.steps.slice(0, index).some(previous => previous.status !== 'succeeded'));
                $row.append(retry.$element);
            }
            $steps.append($row);
        }
        $block.append($steps);
        if (submission.error) $block.append($('<p>').attr('role', 'alert').text(submission.error));
        if (draft.conflicts?.length) {
            const $diff = $('<div>').addClass('acga-conflicts');
            appendDifferences($diff, draft.conflicts);
            $block.append($diff, button('載入最新內容並重新核對', () => save(() => controller.rebase(submission.id))).$element);
        }
        const $actions = $('<div>').addClass('acga-actions');
        if (submission.finished) {
            const close = async reload => { await update(() => controller.dismiss(submission.id)); dock.showPanel(null); if (reload) location.reload(); };
            $actions.append(button('關閉', () => close(false)).$element, button('關閉並重新載入頁面', () => close(true)).$element);
        } else {
            if (!operation?.steps.some(step => ['succeeded', 'unknown', 'saving'].includes(step.status))) {
                const back = button(draft.mode === 'archive' ? '取消歸檔' : '返回修改', () => save(() => controller.returnToEditing(submission.id)));
                back.setDisabled(busy); $actions.append(back.$element);
            }
            $actions.append(button('稍後處理', () => dock.showPanel(null)).$element);
        }
        $pane.append($block.append($actions));
    }
}
