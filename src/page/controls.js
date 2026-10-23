import state, {t} from "../i18n.js";
import {getArticleRoot, getNominationSections} from "./sections.js";
import {entryOwnership, isOwnNomination, assertCanCheck} from "../nomination/ownership.js";
import {reviewData, parseCheck} from "../nomination/scoring.js";
import {hasRecentActivity} from "../wiki/archive.js";
import {bindTitleStatus} from "./title-status.js";
import {cdxIconEdit, cdxIconHighlight, cdxIconSandbox} from "../ui/icons.js";
import {iconButton} from "../ui/icon-button.js";
import {
    entryValues,
    getDateSections,
    getFullText,
    listEntries,
    queried2NomData,
    queryEntry
} from "../wiki/api.js";
import {
    archiveSection,
    showCheckNominations,
    showEditNominationDialog,
    showNewNominationDialog
} from "../ui/editor.js";


/**
 * 點擊編輯按鈕時的事件處理。
 * @param date 日期（章節標題）
 * @param index 該章節下第X個提名
 */
function editNomination(date, index) {
    return getFullText().then(function (fulltext) {
        const queried = queryEntry(fulltext, date, index);
        let nomData = queried2NomData(queried);
        if (nomData == null) {
            mw.notify(state.conv({
                hant: '小工具無法讀取該提名，請手動編輯。', hans: '小工具无法读取该提名，请手动编辑。',
            }), {
                type: 'error', title: state.conv({
                    hant: '錯誤', hans: '错误',
                }),
            });
        } else if (parseCheck(entryValues(queried)['核對用'])) {
            return openCheckQueue([{date, index}]);
        } else {
            nomData.source = {date, index, values: entryValues(queried)};
            return showEditNominationDialog(nomData);
        }
    }).catch(error => mw.notify(error.message || String(error), {type: 'error'}));
}

/**
 * 點擊核對按鈕時的事件處理。
 * @param date 日期（章節標題）
 * @param index 該章節下第X個提名
 * @return {Promise<void>} 核對介面建立後解析；不等待使用者提交。
 */
async function checkNomination(date, index) {
    await openCheckQueue([{date, index}]);
}

/**
 * 讀取選取項目的最新資料與來源快照，交給編輯器逐筆核對。
 * 此處只準備草稿；不因為開啟或切換核對項目而寫入維基頁面。
 */
async function openCheckQueue(targets) {
    try {
        const fulltext = await getFullText();
        const nominations = targets.map(({date, index}) => {
            const entry = queryEntry(fulltext, date, index);
            const data = queried2NomData(entry);
            if (!data) throw new Error(t('小工具無法讀取該提名，請手動編輯。', '小工具无法读取该提名，请手动编辑。'));
            const ownership = entryOwnership(fulltext, entry);
            assertCanCheck(ownership, mw.config.get('wgUserName'));
            return reviewData(data, {date, index, values: entryValues(entry), ownership});
        });
        await showCheckNominations(nominations);
    } catch (error) {
        mw.notify(error.message || String(error), {type: 'error'});
    }
}

/**
 * 點擊登記新提名按鈕時的事件處理。
 */
function newNomination() {
    if (mw.config.get('wgPageName') !== 'WikiProject:ACG/維基ACG專題獎/登記處') {
        location.href = mw.util.getUrl('WikiProject:ACG/維基ACG專題獎/登記處') + '#acga-new';
        return;
    }
    showNewNominationDialog().catch(error => mw.notify(error.message || String(error), {type: 'error'}));
}

/** 頁首與頁尾使用相同的按鈕樣式及新增流程，標記自身以免再次掃描時被當成手動入口。 */
function createNewNominationButton() {
    const $button = $('<span>').addClass('mw-ui-button mw-ui-progressive acga-new-nomination-button').attr('role', 'button')
        .text(state.conv({hant: '登記新提名', hans: '登记新提名'}));
    return $('<a>').attr('href', 'javascript:void(0)').append($button).on('click', newNomination);
}

/**
 * 點擊歸檔按鈕時的事件處理。
 */
function archiveChapter(date) {
    OO.ui.confirm(state.conv({hant: `確定要歸檔「${date}」小節嗎？`, hans: `确定要归档「${date}」章节吗？`})).done(confirmed => {
        if (confirmed) archiveSection(date).catch(error => mw.notify(error.message || String(error), {type: 'error'}));
    });
}

/**
 * 讀取提名資料後，在頁面加入編輯與核對入口，隱藏自己的核對入口。
 * 此處的身分判斷只控制顯示；提交時仍須根據最新來源再次檢查。
 * 原始列以日期與序號識別，四欄快照供內容驗證；儲存時仍讀取最新原文。
 */
export async function addEditButtonsToPage(sourceText) {
    // 保留使用者熟悉的頁首雙按鈕：手動入口在前，小工具的藍色入口在後。
    const newNominationButton = $('span[role="button"]').not('.acga-new-nomination-button').filter(function () {
        return $(this).text() === '登記新提名' || $(this).text() === '登记新提名';
    });
    if (newNominationButton.length > 0) {
        newNominationButton.text(state.conv({hant: '手動登記新提名', hans: '手动登记新提名'}));
        newNominationButton.removeClass('mw-ui-progressive');
        newNominationButton.parent().parent().append(' ', createNewNominationButton());
    }

    if (mw.config.get('wgPageName') !== 'WikiProject:ACG/維基ACG專題獎/登記處') return;
    const root = getArticleRoot();
    if (root && !$(root).children('.acga-new-nomination-footer').length) {
        $('<div>').addClass('acga-new-nomination-footer mw-notalk noprint').append(createNewNominationButton()).appendTo(root);
    }
    let fulltext;
    try { fulltext = sourceText ?? await getFullText(); }
    catch { mw.notify(t('無法讀取提名資料，請重新整理後再試。', '无法读取提名资料，请刷新后再试。'), {type: 'error'}); return; }

    const content = document.getElementById('mw-content-text');
    if (!content) return;
    const now = Date.now();
    const recentSections = new Set(getDateSections(fulltext)
        .filter(section => hasRecentActivity(fulltext.slice(section.start, section.end), now)).map(section => section.date));
    const sections = getNominationSections(content);
    // 同一份原文只解析一次；標題列與核對列共用這份日期內的提名索引。
    const entriesByDate = new Map();
    for (const entry of listEntries(fulltext)) {
        if (!entriesByDate.has(entry.date)) entriesByDate.set(entry.date, []);
        entriesByDate.get(entry.date).push(entry);
    }
    for (const section of sections) {
        const h3 = $(section.heading);
        const date = h3.text().trim();
        let index = 0;
        const entries = entriesByDate.get(date) || [];

        // 歸檔入口沿用標題的 editsection；由標題往上找容器，兼容 CD 的標題包裝。
        const $heading = h3.closest('.mw-heading');
        const $editsection = ($heading.length ? $heading : h3).find('.mw-editsection').first();
        const $editLink = $editsection.find('a').first();
        let $archive = $editsection.find('.acga-archive');
        if ($editLink.length && !$archive.length) {
            $archive = $('<a>').addClass('acga-archive').attr('href', 'javascript:void(0)')
                .text(state.conv({hant: '歸檔', hans: '归档'})).on('click', () => archiveChapter(date));
            $editLink.after($('<span>').addClass('acga-archive-separator').html('&nbsp;|&nbsp;'), $archive);
        }
        const recent = recentSections.has(date);
        $archive.toggleClass('acga-archive-recent', recent);
        if (recent) $archive.attr('title', state.conv({hant: '本章節最後一次活動未滿七天。', hans: '本章节最后一次活动未满七天。'}));
        else $archive.removeAttr('title');

        // 使用章節掃描取得的表格，容許 CD 將其包在 cd-comment-replacedPart 等容器內。
        for (const tableElement of section.tables) {
            const table = $(tableElement);
            // 說明內可含其他表格；只處理這張提名表格自己的列。
            let rows = table.find('tr').filter((_, row) => $(row).closest('table')[0] === tableElement).slice(1);
            let entry, values, rechecking;
            rows.each(function () {
                let row = $(this);
                let th = row.children('th');
                if (th.length !== 0) {
                    entry = entries[index++];
                    values = entry ? entryValues(entry) : null;
                    rechecking = values ? !!parseCheck(values['核對用']) : false;
                }
                const currentIndex = index;
                row.attr({'data-acga-date': date, 'data-acga-source-index': currentIndex});
                if (values) row.attr('data-acga-source-values', JSON.stringify(values));
                if (th.length !== 0) {
                    // 提名行
                    let nomEntry = th.first();
                    if (values) bindTitleStatus(nomEntry[0], values['條目名稱']);
                    // 已核分項目由核對列的覆核入口處理，避免鉛筆暗中切換操作種類。
                    if (entry && !rechecking) {
                        const editButton = iconButton(cdxIconEdit, state.conv({hant: '編輯提名', hans: '编辑提名'}), () =>
                            editNomination(date, currentIndex), {showLabel: true}).addClass('acga-control acga-edit-button');
                        nomEntry.append(' ').append(editButton);
                    }
                } else {
                    // 核對行
                    let td = row.children('td').first();
                    let mwNoTalk = td.find('.mw-notalk').first();
                    if (!entry || isOwnNomination(entryOwnership(fulltext, entry), mw.config.get('wgUserName'))) return;

                    // 依來源的有效核分結果區分核對與覆核，不依賴其他小工具可改寫的列 class。
                    const label = state.conv({
                        hant: rechecking ? '覆核／更正得分' : '核對', hans: rechecking ? '复核／更正得分' : '核对',
                    });
                    const checkButton = iconButton(rechecking ? cdxIconSandbox : cdxIconHighlight, label, async () => {
                        await checkNomination(date, currentIndex);
                    }, {showLabel: true}).addClass('acga-control acga-check-button').toggleClass('acga-recheck-button', rechecking);
                    mwNoTalk.append(checkButton);


                }
            });
        }
    }
}
