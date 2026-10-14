import state from "./state.js";
import {entryOwnership, isOwnNomination, assertCanCheck} from "./ownership.js";
import {reviewData} from "./scoring.js";
import {SCORES} from "./submission.js";
import {
    appendToPage,
    entryValues,
    editPage,
    getDateSections,
    getFullText,
    queried2NomData,
    queryEntry,
    refreshPage
} from "./api.js";
import {
    showCheckNominations,
    showEditNominationDialog,
    showNewNominationDialog
} from "./dialog.js";


/**
 * 點擊編輯按鈕時的事件處理。
 * @param date 日期（章節標題）
 * @param index 該章節下第X個提名
 */
function editNomination(date, index) {
    getFullText().then(function (fulltext) {
        const queried = queryEntry(fulltext, date, index);
        let nomData = queried2NomData(queried);
        if (nomData == null) {
            mw.notify(state.convByVar({
                hant: '小工具無法讀取該提名，請手動編輯。', hans: '小工具无法读取该提名，请手动编辑。',
            }), {
                type: 'error', title: state.convByVar({
                    hant: '錯誤', hans: '错误',
                }),
            });
        } else {
            nomData.source = {date, index, values: entryValues(queried)};
            showEditNominationDialog(nomData);
        }
    });
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
        const [fulltext, scoreText] = await Promise.all([getFullText(), getFullText(SCORES)]);
        const nominations = targets.map(({date, index}) => {
            const entry = queryEntry(fulltext, date, index);
            const data = queried2NomData(entry);
            if (!data) throw new Error('小工具無法讀取該提名，請手動編輯。');
            const ownership = entryOwnership(fulltext, entry);
            assertCanCheck(ownership, mw.config.get('wgUserName'), data.awarder);
            return reviewData(data, {date, index, values: entryValues(entry), ownership}, scoreText);
        });
        await showCheckNominations(nominations);
    } catch (error) {
        mw.notify(error.message || String(error), {type: 'error'});
    }
}

/**
 * 批量核對提名的事件處理。
 * 遍歷所有帶有 multi-nomCheck 類別的元素，為每個元素添加一個多選核對的複選框和按鈕。
 * 當按下「開始大量核對」按鈕時，會遍歷所有選中的複選框，並對每個選中的提名進行核對。
 * 如果沒有選中任何複選框，則顯示警告通知。
 * 所有選取項目會在頁面內核對，最後一起提交。
 */
function multiCheckNomination() {
    $('.multi-nomCheck').each(function () {
        let $this = $(this);
        let checkbox = $('<input type="checkbox" class="multi-nomCheck-checkbox">');
        checkbox.data('date', $this.data('date'));
        checkbox.data('index', $this.data('index'));
        checkbox.on('change', function () {
            if ($(this).is(':checked')) {
                // Change the background color of ancestor <td> to light green.
                $this.closest('td').css('background-color', '#d4edda');
            } else {
                // Reset the background color of ancestor <td> to default.
                $this.closest('td').css('background-color', '');
            }
        });
        let startCheckingButton = $('<a>').text(state.convByVar({
            hant: '開始批次核對', hans: '开始批量核对',
        })).addClass('multi-nomCheck-startBtn').attr('href', '#');
        startCheckingButton.on('click', async function (e) {
            e.preventDefault();
            const $checkboxes = $('.multi-nomCheck-checkbox:checked');
            if (!$checkboxes.length) {
                mw.notify(state.convByVar({
                    hant: '請至少選擇一個提名進行核對。', hans: '请至少选择一个提名进行核对。',
                }), {
                    type: 'warning', title: state.convByVar({
                        hant: '提示', hans: '提示',
                    }),
                });
                return;
            }
            await openCheckQueue($checkboxes.toArray().map(element => ({date: $(element).data('date'), index: $(element).data('index')})));
        });
        $this.empty(); // 清空之前的內容
        $this.append(checkbox);
        $this.append(' ');
        $this.append(startCheckingButton);
    });
}

/**
 * 點擊登記新提名按鈕時的事件處理。
 */
function newNomination() {
    showNewNominationDialog();
}

/**
 * 點擊歸檔按鈕時的事件處理。
 */
function archiveChapter(date) {
    OO.ui.confirm(state.convByVar({
        hant: '確定要歸檔「', hans: '确定要归档「',
    }) + date + state.convByVar({
        hant: '」章節嗎？', hans: '」章节吗？',
    })).done(async function (confirmed) {
        if (!confirmed) return;

        const fulltext = await getFullText();
        let sections = getDateSections(fulltext);
        let targetSection = sections.find(sec => sec.date === date);
        if (!targetSection) {
            mw.notify(state.convByVar({
                hant: '小工具無法讀取該章節，請手動歸檔。', hans: '小工具无法读取该章节，请手动归档。',
            }), {
                type: 'error', title: state.convByVar({
                    hant: '錯誤', hans: '错误',
                }),
            });
            return;
        }
        let sectionText = fulltext.slice(targetSection.start, targetSection.end);
        let fulltextWithoutSection = fulltext.slice(0, targetSection.start) + fulltext.slice(targetSection.end);

        // 找到包含年份的UTC字串，例如 2025年2月13日 (四) 20:58 (UTC)
        let utcRegex = /提名人：.+?(\d{4})年(\d{1,2})月(\d{1,2})日 \((.*?)\) (\d{1,2}:\d{2}) \(UTC\)/;
        let utcMatch = sectionText.match(utcRegex);
        if (!utcMatch) {
            mw.notify(state.convByVar({
                hant: '小工具無法讀取該章節的UTC時間，請手動歸檔。', hans: '小工具无法读取该章节的UTC时间，请手动归档。',
            }), {
                type: 'error', title: state.convByVar({
                    hant: '錯誤', hans: '错误',
                }),
            });
            return;
        }
        // 獲得 X年Y月
        let yearMonth = utcMatch[1] + '年' + utcMatch[2] + '月';
        let archiveTarget = 'WikiProject:ACG/維基ACG專題獎/存檔/' + yearMonth;

        mw.notify(state.convByVar({
            hant: '小工具正在歸檔中，請耐心等待。', hans: '小工具正在归档中，请耐心等待。',
        }), {
            type: 'info', title: state.convByVar({
                hant: '提示', hans: '提示',
            }), autoHide: false,
        });

        // 先檢查新的存檔頁面是否存在
        const archivePageText = await getFullText(archiveTarget);
        if (!archivePageText) {
            // 新的存檔頁面不存在或者是空的
            // 將存檔頁頭加入 sectionText
            sectionText = '{{Talk archive|WikiProject:ACG/維基ACG專題獎/登記處}}\n\n' + sectionText;
        } else {
            // 直接歸檔，補充空行
            sectionText = '\n\n' + sectionText;
        }
        const success = await appendToPage(archiveTarget, sectionText, '[[User:SuperGrey/gadgets/ACGATool|' + state.convByVar({
            hant: '歸檔', hans: '归档',
        }) + ']]「' + date + '」' + state.convByVar({
            hant: '章節', hans: '章节',
        }));
        if (success) {
            const success2 = await editPage('WikiProject:ACG/維基ACG專題獎/登記處', fulltextWithoutSection, '[[User:SuperGrey/gadgets/ACGATool|' + state.convByVar({
                hant: '歸檔', hans: '归档',
            }) + ']]「' + date + '」' + state.convByVar({
                hant: '章節至', hans: '章节至',
            }) + '「[[' + archiveTarget + ']]」');
            if (success2) {
                mw.notify(state.convByVar({
                    hant: '小工具已歸檔', hans: '小工具已归档',
                }) + '「' + date + '」' + state.convByVar({
                    hant: '章節至', hans: '章节至',
                }) + '「[[' + archiveTarget + ']]」。', {
                    type: 'success', title: state.convByVar({
                        hant: '成功', hans: '成功',
                    }),
                });
                refreshPage();  // 刷新頁面
            } else {
                mw.notify(state.convByVar({
                    hant: '編輯提名頁面失敗，小工具無法歸檔，請手動歸檔。',
                    hans: '编辑提名页面失败，小工具无法归档，请手动归档。',
                }), {
                    type: 'error', title: state.convByVar({
                        hant: '錯誤', hans: '错误',
                    }),
                });
            }
        } else {
            mw.notify(state.convByVar({
                hant: '編輯存檔頁面失敗，小工具無法歸檔，請手動歸檔。',
                hans: '编辑存档页面失败，小工具无法归档，请手动归档。',
            }), {
                type: 'error', title: state.convByVar({
                    hant: '錯誤', hans: '错误',
                }),
            });
        }
    });
}

/**
 * 讀取提名資料後，在頁面加入編輯與核對入口，隱藏自己的核對入口。
 * 此處的身分判斷只控制顯示；提交時仍須根據最新來源再次檢查。
 */
export async function addEditButtonsToPage() {
    // 找到<span role"button">登記新提名</span>
    let newNominationButton = $('span[role="button"]').filter(function () {
        return $(this).text() === '登記新提名' || $(this).text() === '登记新提名';
    });
    if (newNominationButton.length > 0) {
        // 修改原本按鈕的文本為「手動登記新提名」
        newNominationButton.text(state.convByVar({
            hant: '手動登記新提名', hans: '手动登记新提名',
        }));
        newNominationButton.removeClass('mw-ui-progressive');

        // 父節點的父節點是<span>，在後面加入編輯按鈕
        let newNominationButtonParent = newNominationButton.parent().parent();
        let editUIButton = $('<span>').addClass('mw-ui-button').addClass('mw-ui-progressive').attr('role', 'button').text(state.convByVar({
            hant: '登記新提名', hans: '登记新提名',
        }));
        let editButton = $('<a>').attr('href', 'javascript:void(0)').append(editUIButton).click(newNomination);
        newNominationButtonParent.append(' ').append(editButton);
    }

    let fulltext;
    try { fulltext = await getFullText(); }
    catch { mw.notify('無法讀取提名資料，請重新整理後再試。', {type: 'error'}); return; }

    // 識別所有h3
    $('div.mw-heading3').each(function () {
        let h3div = $(this);
        let h3 = h3div.find('h3').first();
        let date = h3.text().trim();
        let index = 0;

        // 為h3div底下的span.mw-editsection添加歸檔按鈕
        let editsection = h3div.find('span.mw-editsection').first();
        let editsectionA = editsection.find('a').first();
        $('<a>').attr('href', 'javascript:void(0)').click(function () {
            archiveChapter(date);
        }).append(state.convByVar({
            hant: '歸檔', hans: '归档',
        })).insertAfter(editsectionA);
        $('<span>&nbsp;|&nbsp;</span>').insertAfter(editsectionA);

        h3div.nextUntil('div.mw-heading3', 'table.acgnom-table').each(function () {
            let table = $(this);
            let rows = table.find('tr').slice(1);  // 去掉表頭
            let title = "";
            rows.each(function () {
                let row = $(this);
                let th = row.find('th');
                if (th.length !== 0) {
                    // 提名行
                    let nomEntry = th.first();
                    let nomEntryA = nomEntry.find('a');
                    if (nomEntryA.length !== 0) {
                        title = nomEntry.find('a').first().attr('title');
                    } else {
                        title = nomEntry.text().trim();
                    }
                    ++index;

                    // 加入編輯按鈕
                    let editIcon = $('<img>').attr('src', 'https://upload.wikimedia.org/wikipedia/commons/8/8a/OOjs_UI_icon_edit-ltr-progressive.svg').css({'width': '12px'});
                    const currentIndex = index;
                    let editButton = $('<a>').attr('href', 'javascript:void(0)').append(editIcon).click(function () {
                        editNomination(date, currentIndex);
                    });
                    nomEntry.append(' ').append(editButton);
                } else {
                    // 核對行
                    let td = row.find('td').first();
                    let mwNoTalk = td.find('.mw-notalk').first();
                    const currentIndex = index;

                    const entry = queryEntry(fulltext, date, currentIndex);
                    if (!entry || isOwnNomination(entryOwnership(fulltext, entry), mw.config.get('wgUserName'))) return;

                    // 單項核對
                    let checkIcon = $('<img>').attr('src', 'https://upload.wikimedia.org/wikipedia/commons/3/30/OOjs_UI_icon_highlight-progressive.svg').css({
                        'width': '12px', 'vertical-align': 'sub',
                    });
                    let checkButton = $('<a>').css({
                        'display': 'inline-block', 'margin-left': '5px', 'font-size': '.857em', 'font-weight': 'bold',
                    }).append(checkIcon).append(' ').append(state.convByVar({
                        hant: row.is('.done, .rechecking') ? '覆核／更正得分' : '核對', hans: row.is('.done, .rechecking') ? '复核／更正得分' : '核对',
                    })).attr('href', 'javascript:void(0)').click(async function () {
                        await checkNomination(date, currentIndex);
                    });
                    mwNoTalk.append(checkButton);

                    // 多選核對
                    let multiCheckDiv = $('<div>')
                        .addClass('multi-nomCheck')
                        .attr('data-date', date)
                        .attr('data-index', currentIndex)
                        .css({
                            'display': 'inline-block', 'margin-left': '5px', 'font-size': '.857em',
                        });
                    let multiCheckButton = $('<a>').attr('href', 'javascript:void(0)').text(state.convByVar({
                        hant: '多選', hans: '多选',
                    })).click(function () {
                        multiCheckNomination();
                    });
                    multiCheckDiv.append(multiCheckButton);
                    mwNoTalk.append(multiCheckDiv);
                }
            });
        });
    });
}
