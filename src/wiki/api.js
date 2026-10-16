import {t} from "../i18n.js";
import {NominationRuleAliases, NominationRuleSet} from "../nomination/rules.js";

let mwApi;
let queryTitleLimit = 50, haveUserRights = false;

/** titles 的一般上限為 50；具 apihighlimits 權限時為 500，不以使用者群組猜測權限。 */
export function getQueryTitleLimit() { return queryTitleLimit; }

/**
 * 延後到第一次請求才建立 mw.Api，讓 ResourceLoader 先完成 API 模組載入。
 */
export function getWikiApi() {
    if (!mwApi) mwApi = new mw.Api({userAgent: 'ACGATool/2.0.0'});
    return mwApi;
}

/**
 * 獲取完整的wikitext。
 * @param {string} pageName 頁面名稱，默認為「WikiProject:ACG/維基ACG專題獎/登記處」。
 * @returns {Promise<string>} 包含完整wikitext的Promise。
 */
export async function getFullText(pageName = '') {
    let response = await getWikiApi().get({
        action: 'query',
        titles: pageName || 'WikiProject:ACG/維基ACG專題獎/登記處',
        prop: 'revisions',
        rvslots: '*',
        rvprop: 'content',
        indexpageids: 1,
        // 利用既有頁面查詢確認批次上限，不為分類圖標另發權限查詢。
        ...(!haveUserRights ? {meta: 'userinfo', uiprop: 'rights'} : {}),
    });
    if (Array.isArray(response.query.userinfo?.rights)) {
        queryTitleLimit = response.query.userinfo.rights.includes('apihighlimits') ? 500 : 50;
        haveUserRights = true;
    }
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
            // 保留來源的實際編號；補寫缺少的欄位時不能用陣列位置重新編號。
            group.parameterSuffix = String(num);
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
 * @returns {Array} Entries with template, start, end, type and containerEnd.
 * containerEnd points past the enclosing nomination template, whose following signature
 * is shared by its grouped entries and nested extras.
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
                        start: entry.fullLocation.start, end: entry.fullLocation.end, type: 'acg2', containerEnd: template.location.end,
                    });
                }
            }
        } else {
            // For regular ACG提名
            entries.push({
                template: template, start: template.location.start, end: template.location.end, type: 'main', containerEnd: template.location.end,
            });
            if (template.params['額外提名'] && template.params['額外提名'].nestedTemplates) {
                for (let nested of template.params['額外提名'].nestedTemplates) {
                    entries.push({
                        template: nested, start: nested.location.start, end: nested.location.end, type: 'extra', containerEnd: template.location.end,
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
 * Existing parameters are changed in place; missing parameters are inserted with the original suffix.
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
    return updateEntries(original, [{entry, changes}]);
}

/**
 * 批次改寫提名參數；所有 entry 的字元位置必須來自同一份 original。
 * 先收集全部替換，再由後往前套用，避免前一筆修改使後面的字元位置失效。
 * 缺少的參數會補入原模板，ACG提名2 沿用原參數編號。
 * @param {string} original 產生 entry 位置的完整 wikitext。
 * @param {Array<{entry: object, changes: Object<string, string>}>} updates 待修改的參數。
 * @returns {string} 修改後的完整 wikitext，不執行儲存。
 */
export function updateEntries(original, updates) {
    const mods = [];
    for (const {entry, changes} of updates) {
        const params = entry.type === 'acg2' ? entry.template : entry.template.params;
        for (const [key, value] of Object.entries(changes)) {
            if (params[key]?.valueLocation) {
                mods.push({...params[key].valueLocation, replacement: value});
            } else {
                const end = entry.type === 'acg2' ? entry.end : entry.template.location.end - 2;
                const suffix = entry.type === 'acg2' ? entry.template.parameterSuffix : '';
                mods.push({start: end, end, replacement: `\n|${key}${suffix} = ${value}\n`});
            }
        }
    }
    mods.sort((a, b) => b.start - a.start);
    let updated = original;
    for (const mod of mods) updated = updated.slice(0, mod.start) + mod.replacement + updated.slice(mod.end);
    return updated;
}

/**
 * 取出供草稿與變更比對使用的四個原始欄位。
 * 保留 wikitext 與註解，使核對結果、說明及識別資訊的變更都能被發現。
 * @param {object} entry 已解析的提名。
 * @returns {Object<string, string>} 欄位名稱到原始文字的對應。
 */
export function entryValues(entry) {
    const params = entry.type === 'acg2' ? entry.template : entry.template.params;
    return Object.fromEntries(['條目名稱', '用戶名稱', '提名理由', '核對用'].map(key => [key, params[key]?.value || '']));
}

/**
 * 依頁面順序列出各日期章節的提名，附上日期與章節內從 1 起算的 index。
 * index 是當次讀取的位置，不能當成跨版本不變的提名識別。
 */
export function listEntries(text) {
    return getDateSections(text).flatMap(section => collectEntriesInSection(text, section)
        .map((entry, index) => ({...entry, date: section.date, index: index + 1})));
}

/**
 * 以日期與原始四欄快照，從最新本文重新找出唯一且未變更的提名。
 * 找不到或有多筆相符時停止，避免將舊的字元位置套到其他提名。
 */
export function findUnchangedEntry(text, source) {
    const matches = listEntries(text).filter(entry => entry.date === source.date &&
        JSON.stringify(entryValues(entry)) === JSON.stringify(source.values));
    if (matches.length !== 1) throw new Error(t('提名已變更、移除或無法唯一辨識，請重新核對。', '提名已变更、移除或无法唯一辨识，请重新核对。'));
    return matches[0];
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
 * @returns {object|null} 含預設說明、分數及上限的規則狀態；無法解析時為 null。
 */
export function parseUserReason(reason) {
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
                ruleStatus[rule].score = Number(ruleScoreMod);
                if (!Number.isFinite(ruleStatus[rule].score)) {
                    console.log(t('[ACGATool] 分數不是數字', '[ACGATool] 分数不是数字'), ruleScoreMod);  // 分數不是數字，報錯
                    return null;
                }
            }
        } else {
            console.log(t('[ACGATool] 不在提名規則中', '[ACGATool] 不在提名规则中'), rule);  // 不在提名規則中，報錯
            return null;
        }
    }
    for (const [key, value] of Object.entries(ruleStatus)) {
        const rule = ruleSet.ruleDict[key];
        value.desc ??= rule.desc;
        value.ogDesc = rule.desc;
        value.score ??= rule.score;
        value.maxScore = rule.score;
    }
    return ruleStatus;
}

/**
 * 將queried（查詢結果）轉換為nomData（提名數據）。
 * @param queried {object} 查詢結果。
 * @returns {object} 提名數據。
 */
export function queried2NomData(queried) {
    if (!queried) return null;
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
