import state from "./state.js";
import {
    appendToPage,
    entryValues,
    editPage,
    getDateSections,
    getFullText,
    queried2NomData,
    queryEntry,
    refreshPage,
    updateEntryParameters
} from "./api.js";
import {
    getNewNominationDialogAdditionalMessage,
    showCheckNominations,
    showEditNominationDialog,
    showNewNominationDialog
} from "./dialog.js";
import {generateReason} from "./rules.js";


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
            showEditNominationDialog(nomData, queried);
        }
    });
}

/**
 * 點擊核對按鈕時的事件處理。
 * @param date 日期（章節標題）
 * @param index 該章節下第X個提名
 * @param multiCheckStatus 多選核對狀態字串
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
            if (!data) throw new Error('小工具無法讀取該提名，請手動編輯。');
            return {...data, source: {date, index, values: entryValues(entry)}};
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
 * 當核對完成後，如果有任何提名被修改，則刷新頁面。
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
 * 在頁面上添加編輯按鈕。
 */
export function addEditButtonsToPage() {
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

                    // 單項核對
                    let checkIcon = $('<img>').attr('src', 'https://upload.wikimedia.org/wikipedia/commons/3/30/OOjs_UI_icon_highlight-progressive.svg').css({
                        'width': '12px', 'vertical-align': 'sub',
                    });
                    let checkButton = $('<a>').css({
                        'display': 'inline-block', 'margin-left': '5px', 'font-size': '.857em', 'font-weight': 'bold',
                    }).append(checkIcon).append(' ').append(state.convByVar({
                        hant: '核對', hans: '核对',
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

/**
 * 保存新提名。
 * @returns {Promise<boolean>} 是否成功提交。
 */
export async function saveNewNomination() {
    let proposedWikitext = '{{ACG提名2';

    for (let i = 0; i < state.nominations.length; i++) {
        let nomination = state.nominations[i];
        if (nomination.awarder === '' || nomination.pageName === '') {
            mw.notify(state.convByVar({
                hant: '得分者或得分條目未填寫，請檢查！', hans: '得分者或得分条目未填写，请检查！',
            }), {
                type: 'error', title: state.convByVar({
                    hant: '錯誤', hans: '错误',
                }),
            });
            return true;
        }
        let reasonText = generateReason(nomination.ruleStatus);
        if (reasonText == null) {
            return true;
        }
        if (reasonText === '') {
            mw.notify(state.convByVar({
                hant: '未選擇任何評審規則，請檢查！', hans: '未选择任何评审规则，请检查！',
            }), {
                type: 'error', title: state.convByVar({
                    hant: '錯誤', hans: '错误',
                }),
            });
            return true;
        }
        proposedWikitext += '\n|條目名稱' + (i + 1) + ' = ' + nomination.pageName.trim();
        proposedWikitext += '\n|用戶名稱' + (i + 1) + ' = ' + nomination.awarder.trim();
        proposedWikitext += '\n|提名理由' + (i + 1) + ' = {{ACG提名2/request|ver=1|' + reasonText + '}}';
        proposedWikitext += '\n|核對用' + (i + 1) + ' = {{ACG提名2/check|ver=1|}}';
    }

    const signature = '~' + '~' + '~' + '~';
    proposedWikitext += "\n}}\n'''提名人：'''" + signature;

    // 附加說明
    let message = getNewNominationDialogAdditionalMessage();
    if (message !== '') {
        proposedWikitext += "\n: {{說明}}：" + message + '--' + signature;
    }

    // 是否已有今日的date
    let today = new Date();
    let todayDate = (today.getMonth() + 1) + '月' + today.getDate() + '日';
    let fulltext = await getFullText();
    if (!fulltext.includes('=== ' + todayDate + ' ===')) {
        // 沒有今日的date，先新增一個
        proposedWikitext = '=== ' + todayDate + ' ===\n' + proposedWikitext;
    }

    // 提交
    let success = await appendToPage('WikiProject:ACG/維基ACG專題獎/登記處', '\n' + proposedWikitext, '[[User:SuperGrey/gadgets/ACGATool|新提名]]');
    if (success) {
        mw.notify(state.convByVar({
            hant: '新提名已成功提交！', hans: '新提名已成功提交！',
        }), {
            title: state.convByVar({
                hant: '成功', hans: '成功',
            }), autoHide: true,
        });
        refreshPage();
        return false;
    } else {
        mw.notify(state.convByVar({
            hant: '新提名提交失敗：', hans: '新提名提交失败：',
        }), {
            type: 'error', title: state.convByVar({
                hant: '錯誤', hans: '错误',
            }),
        });
        return true;
    }
}

/**
 * 保存修改提名。
 * @returns {Promise<boolean>} 是否成功提交。
 */
export async function saveModifiedNomination() {
    let nomination = state.nominations[0];
    if (nomination.awarder === '' || nomination.pageName === '') {
        mw.notify(state.convByVar({
            hant: '得分者或得分條目未填寫，請檢查！', hans: '得分者或得分条目未填写，请检查！',
        }), {
            type: 'error', title: state.convByVar({
                hant: '錯誤', hans: '错误',
            }),
        });
        return true;
    }

    let reasonText = generateReason(nomination.ruleStatus);
    if (reasonText == null) {
        return true;
    }
    if (reasonText === '') {
        mw.notify(state.convByVar({
            hant: '未選擇任何評審規則，請檢查！', hans: '未选择任何评审规则，请检查！',
        }), {
            type: 'error', title: state.convByVar({
                hant: '錯誤', hans: '错误',
            }),
        });
        return true;
    }

    let fulltext = await getFullText(), updatedText;
    if (state.queried.type === 'main' || state.queried.type === 'extra') {
        let changes = {
            '條目名稱': nomination.pageName,
            '用戶名稱': nomination.awarder,
            '提名理由': '{{ACG提名2/request|ver=1|' + reasonText + '}}',
        };
        updatedText = updateEntryParameters(fulltext, state.queried, changes);
    } else if (state.queried.type === 'acg2') {
        let changes = {
            '條目名稱': nomination.pageName,
            '用戶名稱': nomination.awarder,
            '提名理由': '{{ACG提名2/request|ver=1|' + reasonText + '}}',
        };
        updatedText = updateEntryParameters(fulltext, state.queried, changes);
    }
    if (updatedText === fulltext) {
        mw.notify(state.convByVar({
            hant: '提名並未改動！', hans: '提名并未改动！',
        }), {
            type: 'warn', title: state.convByVar({
                hant: '提示', hans: '提示',
            }),
        });
        return true;
    }

    let success = await editPage('WikiProject:ACG/維基ACG專題獎/登記處', updatedText, '[[User:SuperGrey/gadgets/ACGATool|編輯提名]]');
    if (success) {
        mw.notify(state.convByVar({
            hant: '提名已成功修改！', hans: '提名已成功修改！',
        }), {
            title: state.convByVar({
                hant: '成功', hans: '成功',
            }), autoHide: true,
        });
        refreshPage();
        return false;
    } else {
        mw.notify(state.convByVar({
            hant: '提名修改失敗！', hans: '提名修改失败！',
        }), {
            type: 'error', title: state.convByVar({
                hant: '錯誤', hans: '错误',
            }),
        });
        return true;
    }
}
