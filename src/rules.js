import state from "./state.js";

/**
 * 維基ACG專題獎提名規則。
 * @returns {object} 包含規則組的對象。
 */
export function NominationRules() {
    return [
        {
            group: state.convByVar({
                hant: '(1) 內容擴充', hans: '(1) 内容扩充',
            }), rules: [
                {
                    rule: '1a', desc: state.convByVar({
                        hant: '短新增', hans: '短新增',
                    }), score: 1,
                }, {
                    rule: '1b', desc: state.convByVar({
                        hant: '中新增', hans: '中新增',
                    }), score: 2,
                }, {
                    rule: '1c', desc: state.convByVar({
                        hant: '長新增', hans: '长新增',
                    }), score: 3,
                },
            ], explanation: state.convByVar({
                hant: '鼓勵編者新增或擴充條目內容。新內容達 2 kB 為「短新增」，達 3 kB 為「中新增」，達 5 kB 為「長新增」。',
                hans: '新增或扩充条目内容。新内容达 2 kB 为「短新增」，达 3 kB 为「中新增」，达 5 kB 为「长新增」。',
            }),
        }, {
            group: state.convByVar({
                hant: '(2) 品質提升', hans: '(2) 品质提升',
            }), rules: [
                {
                    rule: '2-c', desc: state.convByVar({
                        hant: '丙級', hans: '丙级',
                    }), score: 1,
                }, {
                    rule: '2-b', desc: state.convByVar({
                        hant: '乙級', hans: '乙级',
                    }), score: 3,
                }, {
                    rule: '2-ga', desc: state.convByVar({
                        hant: '優良', hans: '优良',
                    }), score: 5,
                }, {
                    rule: '2-fa', desc: state.convByVar({
                        hant: '典特', hans: '典特',
                    }), score: 10,
                },
            ], explanation: state.convByVar({
                hant: '鼓勵編者以條目品質評級為標準，提升條目品質。由缺失條目、小作品、初級提升至丙級為「丙級」，由丙級提升至乙級為「乙級」，由乙級提升至優良為「優良」，由優良提升至典範（特色）為「典特」。跨級品質提升，則多選所有符合項。',
                hans: '以条目品质评级为标准，提升条目品质。由缺失条目、小作品、初级提升至丙级为「丙级」，由丙级提升至乙级为「乙级」，由乙级提升至优良为「优良」，由优良提升至典范（特色）为「典特」。跨级品质提升，则多选所有符合项。',
            }),
        }, {
            group: state.convByVar({
                hant: '(3) 格式', hans: '(3) 格式',
            }), rules: [
                {
                    rule: '3', desc: state.convByVar({
                        hant: '格式', hans: '格式',
                    }), score: 1,
                },
            ], explanation: state.convByVar({
                hant: '鼓勵編者創作整潔的條目。對於未滿 5 級創作獎的編者，條目應採用 ref 格式搭配 Cite 家族模板列出來源，引文沒有格式錯誤；對於已滿 5 級創作獎的有經驗編者，條目須行文通順、符合命名常規、遵循格式手冊。此項得分需依附於項目 1 或 2，不可單獨申請。',
                hans: '鼓励编辑者创作整洁的条目。对于未满 5 级创作奖的编辑者，条目应采用 ref 格式搭配 Cite 家族模板列出来源，引文没有格式错误；对于已满 5 级创作奖的有经验编辑者，条目须行文通顺、符合命名常规、遵循格式手册。此项得分需依附于项目 1 或 2，不可单独申请。',
            }),
        }, {
            group: state.convByVar({
                hant: '(4) 編輯活動', hans: '(4) 编辑活动',
            }), rules: [
                {
                    rule: '4', desc: state.convByVar({
                        hant: '活動', hans: '活动',
                    }), score: 1,
                }, {
                    rule: '4-req', desc: state.convByVar({
                        hant: '請求', hans: '请求',
                    }), score: 1,
                }, {
                    rule: '4-dyk', desc: state.convByVar({
                        hant: 'DYK', hans: 'DYK',
                    }), score: 1,
                }, {
                    rule: '4-req-game', desc: state.convByVar({
                        hant: '請求·遊戲', hans: '请求·游戏',
                    }), score: 1,
                }, {
                    rule: '4-req-ac', desc: state.convByVar({
                        hant: '請求·動漫', hans: '请求·动漫',
                    }), score: 1,
                },
            ], explanation: state.convByVar({
                hant: '鼓勵編者參加社群或專題活動。可單獨申請的活動：新條目推薦、拯救典優條目。須依附於項目 1 或 2，不可單獨申請的活動：動漫及電子遊戲條目請求、基礎條目擴充挑戰、編輯松、動員令。提名時請手動編輯規則，註明所參與活動。',
                hans: '鼓励编辑者参加社群或专题活动。可单独申请的活动：新条目推荐、拯救典优条目。须依附于项目 1 或 2，不可单独申请的活动：动漫及电子游戏条目请求、基础条目扩充挑战、编辑松、动员令。提名时请手动编辑规则，注明所参与活动。',
            }),
        }, {
            group: state.convByVar({
                hant: '(5) 條目評審', hans: '(5) 条目评审',
            }), tabs: [
                {
                    tab: state.convByVar({
                        hant: '泛用評審', hans: '泛用评审',
                    }), rules: [
                        {
                            rule: '5', desc: state.convByVar({
                                hant: '評審', hans: '评审',
                            }), score: 1,
                        }, {
                            rule: '5-half', desc: state.convByVar({
                                hant: '快評', hans: '快评',
                            }), score: 0.5,
                        }, {
                            rule: '5a', desc: state.convByVar({
                                hant: '文筆評審', hans: '文笔评审',
                            }), score: 1,
                        }, {
                            rule: '5a-half', desc: state.convByVar({
                                hant: '文筆快評', hans: '文笔快评',
                            }), score: 0.5,
                        }, {
                            rule: '5b', desc: state.convByVar({
                                hant: '覆蓋面評審', hans: '覆盖面评审',
                            }), score: 1,
                        }, {
                            rule: '5b-half', desc: state.convByVar({
                                hant: '覆蓋面快評', hans: '覆盖面快评',
                            }), score: 0.5,
                        }, {
                            rule: '5c', desc: state.convByVar({
                                hant: '來源格式評審', hans: '来源格式评审',
                            }), score: 1,
                        }, {
                            rule: '5c-half', desc: state.convByVar({
                                hant: '來源格式快評', hans: '来源格式快评',
                            }), score: 0.5,
                        }, {
                            rule: '5x', desc: state.convByVar({
                                hant: '完整評審', hans: '完整评审',
                            }), score: 3,
                        },
                    ],
                }, {
                    tab: state.convByVar({
                        hant: '乙級(乙上級)內容評審', hans: '乙级(乙上级)内容评审',
                    }), rules: [
                        {
                            rule: '5-bcr', desc: state.convByVar({
                                hant: '乙級評審', hans: '乙级评审',
                            }), score: 1,
                        }, {
                            rule: '5-bcr-half', desc: state.convByVar({
                                hant: '乙級快評', hans: '乙级快评',
                            }), score: 0.5,
                        }, {
                            rule: '5a-bcr', desc: state.convByVar({
                                hant: '乙級文筆評審', hans: '乙级文笔评审',
                            }), score: 1,
                        }, {
                            rule: '5a-bcr-half', desc: state.convByVar({
                                hant: '乙級文筆快評', hans: '乙级文笔快评',
                            }), score: 0.5,
                        }, {
                            rule: '5b-bcr', desc: state.convByVar({
                                hant: '乙級覆蓋面評審', hans: '乙级覆盖面评审',
                            }), score: 1,
                        }, {
                            rule: '5b-bcr-half', desc: state.convByVar({
                                hant: '乙級覆蓋面快評', hans: '乙级覆盖面快评',
                            }), score: 0.5,
                        }, {
                            rule: '5c-bcr', desc: state.convByVar({
                                hant: '乙級來源格式評審', hans: '乙级来源格式评审',
                            }), score: 1,
                        }, {
                            rule: '5c-bcr-half', desc: state.convByVar({
                                hant: '乙級來源格式快評', hans: '乙级来源格式快评',
                            }), score: 0.5,
                        }, {
                            rule: '5x-bcr', desc: state.convByVar({
                                hant: '完整乙級評審', hans: '完整乙级评审',
                            }), score: 3,
                        },
                    ],
                }, {
                    tab: state.convByVar({
                        hant: '優良內容評審', hans: '优良内容评审',
                    }), rules: [
                        {
                            rule: '5-gan', desc: state.convByVar({
                                hant: '優良評審', hans: '优良评审',
                            }), score: 1,
                        }, {
                            rule: '5-gan-half', desc: state.convByVar({
                                hant: '優良快評', hans: '优良快评',
                            }), score: 0.5,
                        }, {
                            rule: '5a-gan', desc: state.convByVar({
                                hant: '優良文筆評審', hans: '优良文笔评审',
                            }), score: 1,
                        }, {
                            rule: '5a-gan-half', desc: state.convByVar({
                                hant: '優良文筆快評', hans: '优良文笔快评',
                            }), score: 0.5,
                        }, {
                            rule: '5b-gan', desc: state.convByVar({
                                hant: '優良覆蓋面評審', hans: '优良覆盖面评审',
                            }), score: 1,
                        }, {
                            rule: '5b-gan-half', desc: state.convByVar({
                                hant: '優良覆蓋面快評', hans: '优良覆盖面快评',
                            }), score: 0.5,
                        }, {
                            rule: '5c-gan', desc: state.convByVar({
                                hant: '優良來源格式評審', hans: '优良来源格式评审',
                            }), score: 1,
                        }, {
                            rule: '5c-gan-half', desc: state.convByVar({
                                hant: '優良來源格式快評', hans: '优良来源格式快评',
                            }), score: 0.5,
                        }, {
                            rule: '5x-gan', desc: state.convByVar({
                                hant: '完整優良評審', hans: '完整优良评审',
                            }), score: 3,
                        },
                    ],
                }, {
                    tab: state.convByVar({
                        hant: '甲級內容評審', hans: '甲级内容评审',
                    }), rules: [
                        {
                            rule: '5-acr', desc: state.convByVar({
                                hant: '甲級評審', hans: '甲级评审',
                            }), score: 2,
                        }, {
                            rule: '5-acr-half', desc: state.convByVar({
                                hant: '甲級快評', hans: '甲级快评',
                            }), score: 1,
                        }, {
                            rule: '5a-acr', desc: state.convByVar({
                                hant: '甲級文筆評審', hans: '甲级文笔评审',
                            }), score: 2,
                        }, {
                            rule: '5a-acr-half', desc: state.convByVar({
                                hant: '甲級文筆快評', hans: '甲级文笔快评',
                            }), score: 1,
                        }, {
                            rule: '5b-acr', desc: state.convByVar({
                                hant: '甲級覆蓋面評審', hans: '甲级覆盖面评审',
                            }), score: 2,
                        }, {
                            rule: '5b-acr-half', desc: state.convByVar({
                                hant: '甲級覆蓋面快評', hans: '甲级覆盖面快评',
                            }), score: 1,
                        }, {
                            rule: '5c-acr', desc: state.convByVar({
                                hant: '甲級來源格式評審', hans: '甲级来源格式评审',
                            }), score: 2,
                        }, {
                            rule: '5c-acr-half', desc: state.convByVar({
                                hant: '甲級來源格式快評', hans: '甲级来源格式快评',
                            }), score: 1,
                        }, {
                            rule: '5x-acr', desc: state.convByVar({
                                hant: '完整甲級評審', hans: '完整甲级评审',
                            }), score: 6,
                        },
                    ],
                }, {
                    tab: state.convByVar({
                        hant: '典範(特色)內容評審', hans: '典范(特色)内容评审',
                    }), rules: [
                        {
                            rule: '5-fac', desc: state.convByVar({
                                hant: '典特評審', hans: '典特评审',
                            }), score: 2,
                        }, {
                            rule: '5-fac-half', desc: state.convByVar({
                                hant: '典特快評', hans: '典特快评',
                            }), score: 1,
                        }, {
                            rule: '5a-fac', desc: state.convByVar({
                                hant: '典特文筆評審', hans: '典特文笔评审',
                            }), score: 2,
                        }, {
                            rule: '5a-fac-half', desc: state.convByVar({
                                hant: '典特文筆快評', hans: '典特文笔快评',
                            }), score: 1,
                        }, {
                            rule: '5b-fac', desc: state.convByVar({
                                hant: '典特覆蓋面評審', hans: '典特覆盖面评审',
                            }), score: 2,
                        }, {
                            rule: '5b-fac-half', desc: state.convByVar({
                                hant: '典特覆蓋面快評', hans: '典特覆盖面快评',
                            }), score: 1,
                        }, {
                            rule: '5c-fac', desc: state.convByVar({
                                hant: '典特來源格式評審', hans: '典特来源格式评审',
                            }), score: 2,
                        }, {
                            rule: '5c-fac-half', desc: state.convByVar({
                                hant: '典特來源格式快評', hans: '典特来源格式快评',
                            }), score: 1,
                        }, {
                            rule: '5x-fac', desc: state.convByVar({
                                hant: '完整典特評審', hans: '完整典特评审',
                            }), score: 6,
                        },
                    ],
                },
            ], explanation: state.convByVar({
                hant: '鼓勵維基人評審他人主編的條目。條目評審分為三大層面：文筆、覆蓋面、來源和格式。不完整評審（快評）折半得分。',
                hans: '鼓励维基人评审他人主编的条目。条目评审分为三大层面：文笔、覆盖面、来源和格式。不完整评审（快评）折半得分。',
            }),
        }, {
            group: state.convByVar({
                hant: '(6) 媒體', hans: '(6) 媒体',
            }), rules: [
                {
                    rule: '6', desc: state.convByVar({
                        hant: '媒體', hans: '媒体',
                    }), score: 3,
                }, {
                    rule: '6-fp', desc: state.convByVar({
                        hant: '特色圖片', hans: '特色图片',
                    }), score: 5,
                },
            ], explanation: state.convByVar({
                hant: '鼓勵編者上載與 ACG 專題相關的自由版權媒體檔案至 Wikimedia Commons。若檔案當選特色圖片，額外加 5 分。',
                hans: '鼓励编辑者上传与 ACG 专题相关的自由版权媒体文件至 Wikimedia Commons。若文件当选特色图片，额外加 5 分。',
            }),
        }, {
            group: state.convByVar({
                hant: '(7) 他薦', hans: '(7) 他荐',
            }), rules: [
                {
                    rule: '7', desc: state.convByVar({
                        hant: '他薦', hans: '他荐',
                    }), score: 0.5,
                },
            ], explanation: state.convByVar({
                hant: '鼓勵維基人提名他人。每有效提名他人 1 次得 0.5 分，每人每月最多得 5 分。若多次得分，請按照規則編輯自定義分數。',
                hans: '鼓励维基人提名他人。每有效提名他人 1 次得 0.5 分，每人每月最多得 5 分。若多次得分，请按照规则编辑自定义分数。',
            }),
        }, {
            group: state.convByVar({
                hant: '(8) 其他', hans: '(8) 其他',
            }), rules: [
                {
                    rule: '8', desc: state.convByVar({
                        hant: '其他', hans: '其他',
                    }), score: 0,
                },
            ], explanation: state.convByVar({
                hant: '獎勵維基人做出的其他難以量化的貢獻，如大量整理格式條目、上載作品封面、製作模板、制定寫作方案、維護資料庫等。請手動編輯規則名稱、自定義分數，並附上說明。最終具體得分將由與專題成員共同商討得出。',
                hans: '奖励维基人做出的其他难以量化的贡献，如大量整理格式条目、上传作品封面、制作模板、制定写作方案、维护数据库等。请手动编辑规则名称、自定义分数，并附上说明。最终具体得分将由与专题成员共同商讨得出。',
            }),
        },
    ];
}

/**
 * 提名規則別名。
 * @returns {object} 包含別名的對象。
 */
export function NominationRuleAliases() {
    return {
        '2a': '2-c',
        'c': '2-c',
        '2b': '2-b',
        'b': '2-b',
        '2c': '2-ga',
        'ga': '2-ga',
        '2d': '2-fa',
        'fa': '2-fa',
        '4a': '4-dyk',
        'dyk': '4-dyk',
        '4p': '4-req',
        '4p-game': '4-req-game',
        '4p-ac': '4-req-ac',
        'fp': '6-fp',
    };
}

/**
 * 提名規則集合。
 * @returns {object} 包含規則名稱和規則對象的對象。
 */
export function NominationRuleSet() {
    let ruleNames = [];
    let ruleDict = {};
    for (let ruleGroup of NominationRules()) {
        if (ruleGroup.rules) {
            for (let ruleSet of ruleGroup.rules) {
                ruleNames.push(ruleSet.rule);
                ruleDict[ruleSet.rule] = ruleSet;
            }
        } else if (ruleGroup.tabs) {
            for (let tab of ruleGroup.tabs) {
                for (let ruleSet of tab.rules) {
                    ruleNames.push(ruleSet.rule);
                    ruleDict[ruleSet.rule] = ruleSet;
                }
            }
        }
    }
    return {
        ruleNames: ruleNames, ruleDict: ruleDict,
    };
}

/**
 * 獲取排序後的規則狀態。
 * @param ruleNames 即 NominationRuleSet().ruleNames。
 * @param ruleStatus 規則狀態對象。
 * @returns {Array} 包含排序後的規則狀態對象的數組。
 */
export function getOrderedRuleStatus(ruleNames, ruleStatus) {
    return ruleNames.filter(rule => ruleStatus.hasOwnProperty(rule)).map(rule => ({rule, ...ruleStatus[rule]}));
}

/**
 * 生成提名理由。
 * @param {object} ruleStatus 規則選取、說明及分數。
 * @param {boolean} [check=false] 核對模式同時輸出否決規則及總分。
 * @returns {{reasonText: string, unselectedReasonText: string, reasonScore: number}|string|null} 核對結果、提名理由字串，或驗證失敗的 null。
 */
export function generateReason(ruleStatus, check = false) {
    // 拼湊提名理由
    let reasonText = '', unselectedReasonText = '';
    let reasonScore = 0;
    let {ruleNames} = NominationRuleSet();
    let orderedRuleStatus = getOrderedRuleStatus(ruleNames, ruleStatus);
    for (const ruleItem of orderedRuleStatus) {
        if (check || ruleItem.selected) {
            if (!Number.isFinite(ruleItem.score) || ruleItem.score < 0) {
                mw.notify(state.convByVar({
                    hant: '規則', hans: '规则',
                }) + '「' + ruleItem.rule + '」' + state.convByVar({
                    hant: '的分數不合法，請檢查！', hans: '的分数不合法，请检查！',
                }), {
                    type: 'error', title: state.convByVar({
                        hant: '錯誤', hans: '错误',
                    }),
                });
                return null;
            }
            // if (ruleItem.score > ruleItem.maxScore) {
            //     mw.notify(
            //         state.convByVar({ hant: '規則', hans: '规则' }) + '「' + ruleItem.rule + '」' + state.convByVar({ hant: '的分數超過最大值', hans: '的分数超过最大值' }) + '「' + ruleItem.maxScore + '」' + state.convByVar({ hant: '，請檢查！', hans: '，请检查！' }),
            //         { type: 'error', title: state.convByVar({ hant: '錯誤', hans: '错误' }) }
            //     );
            //     return null;
            // }
            if (ruleItem.selected) {
                reasonText += ' ' + ruleItem.rule;
                if (ruleItem.desc !== ruleItem.ogDesc) reasonText += '(' + ruleItem.desc + ')';
                if (ruleItem.score !== ruleItem.maxScore) reasonText += '[' + ruleItem.score + ']';
                reasonScore += ruleItem.score;
            } else if (check) {
                unselectedReasonText += ' ' + ruleItem.rule;
                if (ruleItem.desc !== ruleItem.ogDesc) unselectedReasonText += '(' + ruleItem.desc + ')';
                if (ruleItem.score !== ruleItem.maxScore) unselectedReasonText += '[' + ruleItem.score + ']';
            }
        }
    }
    reasonText = reasonText.trim();
    unselectedReasonText = unselectedReasonText.trim();
    if (check) {
        return {
            reasonText: reasonText, unselectedReasonText: unselectedReasonText, reasonScore: reasonScore,
        };
    }
    return reasonText;
}
