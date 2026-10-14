import state from "./state.js";
import {NominationRuleAliases, NominationRuleSet} from "./rules.js";

let mwApi;
/**
 * 延後到第一次請求才建立 mw.Api，讓 ResourceLoader 先完成 API 模組載入。
 */
function getApi() {
    if (!mwApi) mwApi = new mw.Api({userAgent: 'ACGATool/2.0.0'});
    return mwApi;
}

/**
 * 獲取完整的wikitext。
 * @param {string} pageName 頁面名稱，默認為「WikiProject:ACG/維基ACG專題獎/登記處」。
 * @returns {Promise<string>} 包含完整wikitext的Promise。
 */
export async function getFullText(pageName = '') {
    let response = await getApi().get({
        action: 'query',
        titles: pageName || 'WikiProject:ACG/維基ACG專題獎/登記處',
        prop: 'revisions',
        rvslots: '*',
        rvprop: 'content',
        indexpageids: 1,
    });
    if (!response.query.pageids[0] || response.query.pages[response.query.pageids[0]].missing) {
        return '';  // 頁面不存在，返回空字串
    }
    const fulltext = response.query.pages[response.query.pageids[0]].revisions[0].slots.main['*'] || '';
    return fulltext.trim();
}

/**
 * Trims a token’s text and adjusts its absolute boundaries (skipping leading/trailing whitespace).
 * @param {object} token An object with properties { text, start, end }.
 * @returns {object} An object with properties { text, start, end } after trimming.
 */
function trimToken(token) {
    const leadingMatch = token.text.match(/^\s*/);
    const trailingMatch = token.text.match(/\s*$/);
    const leading = leadingMatch ? leadingMatch[0].length : 0;
    const trailing = trailingMatch ? trailingMatch[0].length : 0;
    return {
        text: token.text.trim(), start: token.start + leading, end: token.end - trailing,
    };
}

/**
 * Splits the inner content of a template into tokens by detecting top-level "\n|" delimiters.
 * It scans the inner text (tracking nested braces) and splits only when it sees a newline followed by "|".
 * @param {string} innerContent The content between the outer "{{" and "}}".
 * @param {number} offset The absolute start position of innerContent in the wikitext.
 * @returns {Array} An array of tokens; each token is an object { text, start, end }.
 */
function splitParameters(innerContent, offset) {
    let tokens = [];
    let lastIndex = 0;
    let braceCount = 0;
    let i = 0;
    while (i < innerContent.length) {
        if (innerContent.slice(i, i + 2) === '{{') {
            braceCount++;
            i += 2;
            continue;
        }
        if (innerContent.slice(i, i + 2) === '}}') {
            braceCount = Math.max(braceCount - 1, 0);
            i += 2;
            continue;
        }
        // At top level, if we see a newline followed by a pipe, split here.
        if (braceCount === 0 && innerContent[i] === '\n' && innerContent[i + 1] === '|') {
            tokens.push({
                text: innerContent.slice(lastIndex, i), start: offset + lastIndex, end: offset + i,
            });
            i += 2; // skip the "\n|"
            lastIndex = i;
            continue;
        }
        i++;
    }
    tokens.push({
        text: innerContent.slice(lastIndex), start: offset + lastIndex, end: offset + innerContent.length,
    });
    return tokens;
}

/**
 * Finds the matching closing braces "}}" for a template that starts at the given index.
 * @param {string} text The full wikitext.
 * @param {number} start The starting index where "{{" is found.
 * @returns {object} An object { endIndex } where endIndex is the index immediately after the closing "}}".
 */
function findTemplateEnd(text, start) {
    let braceCount = 0;
    let i = start;
    while (i < text.length) {
        if (text.slice(i, i + 2) === '{{') {
            braceCount++;
            i += 2;
            continue;
        }
        if (text.slice(i, i + 2) === '}}') {
            braceCount--;
            i += 2;
            if (braceCount === 0) break;
            continue;
        }
        i++;
    }
    return {endIndex: i};
}

/**
 * Parses a template starting at the given index in the wikitext.
 * For regular {{ACG提名}} templates, parameters are parsed as key=value pairs (with special handling for nested extras).
 * For simpler {{ACG提名2}} templates, parameters are parsed as key=value pairs. The keys are expected to have a trailing number (e.g. 條目名稱1, 用戶名稱1, etc.); entries are grouped by that number.
 * @param {string} text The full wikitext.
 * @param {number} start The starting index of the template (expects "{{").
 * @returns {object} An object { template, endIndex }.
 */
function parseTemplate(text, start) {
    const templateStart = start;
    const {endIndex: templateEnd} = findTemplateEnd(text, start);
    // Extract inner content (between outer "{{" and "}}").
    const innerStart = start + 2;
    const innerEnd = templateEnd - 2;
    const innerContent = text.slice(innerStart, innerEnd);
    // Split the inner content into tokens using the top-level "\n|" delimiter.
    const tokens = splitParameters(innerContent, innerStart);
    // The first token is the template name.
    let nameToken = trimToken(tokens[0]);
    let templateObj = {
        name: nameToken.text, nameLocation: {
            start: nameToken.start, end: nameToken.end,
        }, params: {}, location: {
            start: templateStart, end: templateEnd,
        },
    };

    if (templateObj.name.startsWith("ACG提名2")) {
        // For ACG提名2, process tokens as key=value pairs.
        // Group parameters by their trailing number.
        let kvGroups = {};
        for (let j = 1; j < tokens.length; j++) {
            let token = tokens[j];
            let tokenTrim = trimToken(token);
            if (tokenTrim.text === "") continue;
            const eqIndex = tokenTrim.text.indexOf('=');
            if (eqIndex === -1) continue;
            let rawKey = tokenTrim.text.substring(0, eqIndex);
            let rawValue = tokenTrim.text.substring(eqIndex + 1);
            let keyText = rawKey.trim();
            let valueText = rawValue.trim();
            let keyLeading = rawKey.match(/^\s*/)[0].length;
            let keyLocation = {
                start: tokenTrim.start + keyLeading, end: tokenTrim.start + keyLeading + keyText.length,
            };
            let valueLeading = rawValue.match(/^\s*/)[0].length;
            let valueLocation = {
                start: tokenTrim.start + eqIndex + 1 + valueLeading, end: tokenTrim.end,
            };
            // Expect keys in the form: prefix + number, e.g. "條目名稱1", "用戶名稱1", etc.
            let m = keyText.match(/^(.+?)(\d+)$/);
            if (m) {
                let prefix = m[1].trim(); // e.g. "條目名稱"
                let num = parseInt(m[2], 10);
                if (!kvGroups[num]) kvGroups[num] = {};
                kvGroups[num][prefix] = {
                    value: valueText, keyLocation: keyLocation, valueLocation: valueLocation, fullLocation: {
                        start: token.start, end: token.end,
                    },
                };
            } else {
                // If the key doesn't match the expected pattern, store it under group "0".
                if (!kvGroups["0"]) kvGroups["0"] = {};
                kvGroups["0"][keyText] = {
                    value: valueText, keyLocation: keyLocation, valueLocation: valueLocation, fullLocation: {
                        start: token.start, end: token.end,
                    },
                };
            }
        }
        let entries = [];
        let groupNums = Object.keys(kvGroups).filter(k => k !== "0").map(Number).sort((a, b) => a - b);
        for (let num of groupNums) {
            let group = kvGroups[num];
            let allTokens = Object.values(group);
            let startPos = Math.min(...allTokens.map(t => t.fullLocation.start));
            let endPos = Math.max(...allTokens.map(t => t.fullLocation.end));
            group.fullLocation = {
                start: startPos, end: endPos,
            };
            entries.push(group);
        }
        templateObj.entries = entries;
    } else {
        // For regular ACG提名, process tokens as key=value pairs (or positional parameters).
        for (let j = 1; j < tokens.length; j++) {
            let token = tokens[j];
            let tokenTrim = trimToken(token);
            if (tokenTrim.text === "") continue; // skip empty tokens
            const eqIndex = tokenTrim.text.indexOf('=');
            if (eqIndex !== -1) {
                // Split into key and value without including the "=" in the value.
                let rawKey = tokenTrim.text.substring(0, eqIndex);
                let rawValue = tokenTrim.text.substring(eqIndex + 1);
                let keyText = rawKey.trim();
                let valueText = rawValue.trim();
                // Compute absolute positions for key and value.
                let keyLeading = rawKey.match(/^\s*/)[0].length;
                let keyLocation = {
                    start: tokenTrim.start + keyLeading, end: tokenTrim.start + keyLeading + keyText.length,
                };
                let valueLeading = rawValue.match(/^\s*/)[0].length;
                let valueLocation = {
                    start: tokenTrim.start + eqIndex + 1 + valueLeading, end: tokenTrim.end,
                };
                templateObj.params[keyText] = {
                    value: valueText, keyLocation: keyLocation, valueLocation: valueLocation, fullLocation: {
                        start: token.start, end: token.end,
                    },
                };
            } else {
                // Positional parameter.
                templateObj.params[j] = {
                    value: tokenTrim.text, fullLocation: {
                        start: token.start, end: token.end,
                    },
                };
            }
        }
        // Special handling for the "額外提名" parameter.
        if (templateObj.params['額外提名']) {
            const extraParam = templateObj.params['額外提名'];
            extraParam.nestedTemplates = parseMultipleTemplates(text, extraParam.valueLocation.start, extraParam.valueLocation.end);
        }
    }
    return {
        template: templateObj, endIndex: templateEnd,
    };
}

/**
 * Parses nested extra templates from the given region of text.
 * This function uses a regex to capture any occurrence of "{{ACG提名/extra" that appears at
 * the beginning of the region or is preceded by a newline.
 * @param {string} text The full wikitext.
 * @param {number} regionStart The start index of the region.
 * @param {number} regionEnd The end index of the region.
 * @returns {Array} An array of parsed extra template objects.
 */
function parseMultipleTemplates(text, regionStart, regionEnd) {
    const templates = [];
    const regionText = text.slice(regionStart, regionEnd);
    // Regex: match either start of string (^) or a newline, then capture "{{ACG提名/extra"
    const regex = /(^|\n)({{ACG提名\/extra)/g;
    let match;
    while ((match = regex.exec(regionText)) !== null) {
        // Calculate the actual absolute start position of the extra template.
        let extraStart = regionStart + match.index + match[1].length;
        const {
            template, endIndex,
        } = parseTemplate(text, extraStart);
        templates.push(template);
        // Advance regex.lastIndex so that we do not match inside the parsed template.
        regex.lastIndex = endIndex - regionStart;
    }
    return templates;
}

/**
 * Returns an array of date sections from the full wikitext.
 * Each section is determined by h3 headings of the form "=== date ===".
 * @param {string} text The full wikitext.
 * @returns {Array} Array of sections: { date, start, end }.
 */
export function getDateSections(text) {
    const regex = /^===\s*(.+?)\s*===/gm;
    let sections = [];
    let matches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        matches.push({
            date: match[1].trim(), start: match.index, end: regex.lastIndex,
        });
    }
    for (let i = 0; i < matches.length; i++) {
        const sectionStart = matches[i].start;
        const sectionDate = matches[i].date;
        const sectionEnd = (i < matches.length - 1) ? matches[i + 1].start : text.length;
        sections.push({
            date: sectionDate, start: sectionStart, end: sectionEnd,
        });
    }
    return sections;
}

/**
 * In a given date section (from h3 heading to before the next h3), collects all entries.
 * Each entry is either a main template ({{ACG提名}}), a nested extra template, or an entry from {{ACG提名2}}.
 * @param {string} text The full wikitext.
 * @param {object} section A section object { date, start, end }.
 * @returns {Array} Array of entry objects: { template, start, end, type }.
 */
function collectEntriesInSection(text, section) {
    let entries = [];
    const sectionText = text.slice(section.start, section.end);
    // Regex: match either {{ACG提名2 or {{ACG提名 (but not /extra)
    const regex = /{{(?:ACG提名2|ACG提名(?!\/extra))/g;
    let match;
    while ((match = regex.exec(sectionText)) !== null) {
        let absolutePos = section.start + match.index;
        let {
            template, endIndex,
        } = parseTemplate(text, absolutePos);
        if (template.name.startsWith("ACG提名2")) {
            // For ACG提名2, add each grouped entry.
            if (template.entries) {
                for (let entry of template.entries) {
                    entries.push({
                        template: entry, // entry holds the grouped key-value parameters
                        start: entry.fullLocation.start, end: entry.fullLocation.end, type: 'acg2',
                    });
                }
            }
        } else {
            // For regular ACG提名
            entries.push({
                template: template, start: template.location.start, end: template.location.end, type: 'main',
            });
            if (template.params['額外提名'] && template.params['額外提名'].nestedTemplates) {
                for (let nested of template.params['額外提名'].nestedTemplates) {
                    entries.push({
                        template: nested, start: nested.location.start, end: nested.location.end, type: 'extra',
                    });
                }
            }
        }
        // Advance regex.lastIndex to avoid reparsing inside this template.
        regex.lastIndex = endIndex - section.start;
    }
    // Sort entries in order of appearance.
    entries.sort((a, b) => a.start - b.start);
    return entries;
}

/**
 * Queries the full wikitext for an entry given a specific date (from the h3 heading)
 * and an entry index (1-based, counting all entries in order).
 * Returns the entry object including its location.
 * @param {string} text The full wikitext.
 * @param {string} date The date string (e.g. "2月3日").
 * @param {number} index The 1-based index of the entry under that date.
 * @returns {object|null} The entry object { template, start, end, type } or null if not found.
 */
export function queryEntry(text, date, index) {
    const sections = getDateSections(text);
    const targetSection = sections.find(sec => sec.date === date);
    if (!targetSection) return null;
    const entries = collectEntriesInSection(text, targetSection);
    if (index < 1 || index > entries.length) return null;
    return entries[index - 1];  // 1-based index
}

/**
 * Given an entry (from queryEntry) and a set of changes (mapping parameter key to new value),
 * updates only those parameter values in the original wikitext by using the precise location data.
 * This function does not replace the entire entry substring—only the changed parameter values.
 *
 * For main or extra entries, changes should be provided as an object where keys are parameter names
 * (e.g. "條目名稱") and values are the new text.
 *
 * For ACG提名2 entries, use keys like "條目名稱", "用戶名稱", "提名理由", "核對用", etc.
 *
 * @param {string} original The full original wikitext.
 * @param {object} entry The entry object (from queryEntry).
 * @param {object} changes An object mapping parameter keys to new values.
 * @returns {string} The updated wikitext.
 */
export function updateEntryParameters(original, entry, changes) {
    let mods = [];
    if (entry.type === 'main' || entry.type === 'extra') {
        let params = entry.template.params;
        for (let key in changes) {
            if (params[key] && params[key].valueLocation) {
                mods.push({
                    start: params[key].valueLocation.start,
                    end: params[key].valueLocation.end,
                    replacement: changes[key],
                });
            }
        }
    } else if (entry.type === 'acg2') {
        // For ACG提名2 grouped entry, keys are like "條目名稱1", "用戶名稱1", etc.
        for (let key in changes) {
            if (entry.template[key]) {
                let token = entry.template[key];
                // Use token.valueLocation for precise updating.
                mods.push({
                    start: token.valueLocation.start, end: token.valueLocation.end, replacement: changes[key],
                });
            }
        }
    }
    // Apply modifications in descending order of start position.
    mods.sort((a, b) => b.start - a.start);
    let updated = original;
    for (let mod of mods) {
        updated = updated.slice(0, mod.start) + mod.replacement + updated.slice(mod.end);
    }
    return updated;
}

/**
 * Removes comments from the given text.
 * @param text {string} The text to remove comments from.
 * @returns {string} The text without comments.
 */
function removeComments(text) {
    text = text.replace(/<!--.*?-->/gs, '');
    return text.trim();
}

/**
 * 根據用戶的提名理由，解析出規則狀態。
 * @param reason {string} 用戶的提名理由。
 * @returns {object} 規則狀態。
 */
function parseUserReason(reason) {
    reason = removeComments(reason);
    let ruleStatus = {};
    if (reason.startsWith('{{ACG提名2/request|ver=1|')) {
        reason = reason.slice('{{ACG提名2/request|ver=1|'.length, -2);
    }
    let reasonList = reason.split(/\s+/);

    let ruleSet = NominationRuleSet();
    let ruleNames = ruleSet.ruleNames;
    let ruleAliases = NominationRuleAliases();
    for (let rule of reasonList) {
        if (rule.endsWith('?')) {
            // 最後一個字符是?，可直接去掉?
            rule = rule.slice(0, -1);
        }
        // 名稱和分數的自定義
        let ruleNameMod = '', ruleScoreMod = '';
        while (rule.endsWith(')') || rule.endsWith(']')) {
            if (rule.endsWith(')')) {
                let lastLeftParen = rule.lastIndexOf('(');
                if (lastLeftParen === -1) break;
                ruleNameMod = rule.slice(lastLeftParen + 1, -1);
                rule = rule.slice(0, lastLeftParen);
            }
            if (rule.endsWith(']')) {
                let lastLeftBracket = rule.lastIndexOf('[');
                if (lastLeftBracket === -1) break;
                ruleScoreMod = rule.slice(lastLeftBracket + 1, -1);
                rule = rule.slice(0, lastLeftBracket);
            }
        }
        if (rule === '') continue;
        if (ruleAliases[rule]) {  // 是否是別名
            rule = ruleAliases[rule];
        }
        if (ruleNames.includes(rule)) {  // 是否在提名規則中
            ruleStatus[rule] = {selected: true};
            if (ruleNameMod !== '') {
                ruleStatus[rule].desc = ruleNameMod;
            }
            if (ruleScoreMod !== '') {
                ruleStatus[rule].score = parseFloat(ruleScoreMod);
                if (isNaN(ruleStatus[rule].score)) {
                    console.log('[ACGATool] 分數不是數字', ruleScoreMod);  // 分數不是數字，報錯
                    return null;
                }
            }
        } else {
            console.log('[ACGATool] 不在提名規則中', rule);  // 不在提名規則中，報錯
            return null;
        }
    }
    return ruleStatus;
}

/**
 * 將queried（查詢結果）轉換為nomData（提名數據）。
 * @param queried {object} 查詢結果。
 * @returns {object} 提名數據。
 */
export function queried2NomData(queried) {
    let nomData = {};

    if (queried.type === 'main' || queried.type === 'extra') {
        let params = queried.template.params;
        nomData.pageName = params['條目名稱'].value;
        nomData.awarder = params['用戶名稱'].value;
        let reasonWikitext = params['提名理由'].value;
        nomData.ruleStatus = parseUserReason(reasonWikitext);
        if (nomData.ruleStatus == null) {
            return null;
        }
        return nomData;
    } else if (queried.type === 'acg2') {
        let params = queried.template;
        nomData.pageName = removeComments(params['條目名稱'].value);
        nomData.awarder = removeComments(params['用戶名稱'].value);
        let reasonWikitext = params['提名理由'].value;
        nomData.ruleStatus = parseUserReason(reasonWikitext);
        if (nomData.ruleStatus == null) {
            return null;
        }
        return nomData;
    } else {
        return null;
    }
}

/**
 * 獲取XTools頁面資訊。無法獲取時按下不表，返回空字串。
 * @param pageName
 * @returns {Promise<string>} XTools頁面資訊。
 */
export async function getXToolsInfo(pageName) {
    try {
        return await $.get('https://xtools.wmcloud.org/api/page/pageinfo/' + mw.config.get('wgServerName') + '/' + pageName.replace(/["?%&+\\]/g, escape) + '?format=html&uselang=' + mw.config.get('wgUserLanguage'));
    } catch (error) {
        console.error('Error fetching XTools data:', error);
        return '';
    }
}

export async function editPage(pageName, newText, editSummary) {
    let response = await getApi().postWithToken('csrf', {
        action: 'edit', title: pageName, text: newText, summary: editSummary,
    });
    if (response.edit && response.edit.result === 'Success') {
        return true;
    } else {
        console.error('Edit failed:', response);
        return false;
    }
}

export async function appendToPage(pageName, appendText, editSummary) {
    let response = await getApi().postWithToken('csrf', {
        action: 'edit', title: pageName, appendtext: appendText, summary: editSummary,
    });
    if (response.edit && response.edit.result === 'Success') {
        return true;
    } else {
        console.error('Edit failed:', response);
        return false;
    }
}

/**
 * 編輯 Module:ACGaward/list。
 * @param {string} awarder 得分者。
 * @param {number} score 得分。
 * @return {Promise<boolean>} 是否成功提交。
 */
export async function editACGAScoreList(awarder, score) {
    let scorelistText = await getFullText('Module:ACGaward/list');
    let scorelistLines = scorelistText.trim().split('\n').slice(1, -1);  // 去掉 'return {' 和 '}' 行
    let scorelist = {};
    for (let line of scorelistLines) {
        let match = line.match(/^\s*\[?(?:'([^']+)'|"([^"]+)")\]?\s*=\s*([+-]?[\d.]+)\s*,?\s*$/);
        if (match) {
            let name = match[1] || match[2];  // 使用第一個捕獲組或第二個捕獲組
            scorelist[name] = parseFloat(match[3]);
        }
    }
    let originalScore = scorelist[awarder] || 0;  // 獲取原始分數
    scorelist[awarder] = originalScore + score;  // 更新分數
    let editSummary = awarder + ' ' + originalScore + '+' + score + '=' + scorelist[awarder];

    let sortedNames = Object.keys(scorelist).sort((a, b) => {
        // 按照名稱排序，忽略大小寫
        return a.toLowerCase().localeCompare(b.toLowerCase(), "en");
    });
    let newScorelistText = 'return {\n';
    for (let name of sortedNames) {
        let nameQuoted = name.includes('"') ? "'" + name + "'" : '"' + name + '"';  // 確保名稱被正確引用
        newScorelistText += '    [' + nameQuoted + '] = ' + scorelist[name].toString() + ',\n';
    }
    newScorelistText += '}';

    // 提交修改
    let success = await editPage('Module:ACGaward/list', newScorelistText, editSummary + '（[[User:SuperGrey/gadgets/ACGATool|核對分數]]）');
    if (success) {
        mw.notify(state.convByVar({
            hant: 'Module:ACGaward/list 已成功更新！', hans: 'Module:ACGaward/list 已成功更新！',
        }), {
            title: state.convByVar({
                hant: '成功', hans: '成功',
            }), autoHide: true,
        });
        return false;  // 成功提交
    } else {
        mw.notify(state.convByVar({
            hant: 'Module:ACGaward/list 更新失敗！', hans: 'Module:ACGaward/list 更新失败！',
        }), {
            type: 'error', title: state.convByVar({
                hant: '錯誤', hans: '错误',
            }),
        });
        return true;  // 提交失敗
    }
}

/**
 * 刷新頁面。
 */
export function refreshPage() {
    // 2秒後刷新頁面
    setTimeout(function () {
        location.reload();
    }, 2000);
}