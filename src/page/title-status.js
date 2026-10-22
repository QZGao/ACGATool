import {t} from '../i18n.js';
import {getQueryTitleLimit} from '../wiki/api.js';
import {wikiTransport} from '../wiki/transport.js';
import {createTalkCategoryCache} from '../wiki/talk-categories.js';

const statuses = [
    {category: 'Category:推薦的新條目', label: () => t('通過的新條目推薦', '通过的新条目推荐'),
        image: 'https://upload.wikimedia.org/wikipedia/commons/e/e0/Symbol_question.svg'},
    {category: 'Category:新條目推薦候選', label: () => t('新條目推薦候選', '新条目推荐候选'),
        image: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/DYK_candidate.svg'},
    {category: 'Category:優良條目落選', label: () => t('優良條目落選', '优良条目落选'),
        image: 'https://upload.wikimedia.org/wikipedia/commons/7/77/Symbol_unsupport_vote-green.svg'},
    {category: 'Category:典範條目落選', label: () => t('典範條目落選', '典范条目落选'),
        image: 'https://upload.wikimedia.org/wikipedia/commons/e/e0/Symbol_unsupport_star_blue.svg'},
    {category: 'Category:维基百科同行评审', label: () => t('進行中的同行評審', '进行中的同行评审'),
        image: 'https://upload.wikimedia.org/wikipedia/commons/5/55/Nuvola_apps_kedit.svg'},
    {pattern: /^Category:第(.+)次[動动][員员]令[貢贡][獻献]一[覽览]$/, label: edition => t(`第${edition}次動員令達標貢獻`, `第${edition}次动员令达标贡献`),
        image: 'https://upload.wikimedia.org/wikipedia/commons/2/28/Wikipedia_zh_dc_logo.svg'},
    {pattern: /^Category:(.+)年[維维]基百科[亞亚]洲月[貢贡][獻献]$/, label: year => t(`${year}年亞洲月達標貢獻`, `${year}年亚洲月达标贡献`),
        image: 'https://upload.wikimedia.org/wikipedia/commons/1/1f/WAM_logo_without_text.svg'},
];

/** 將屆次或年份轉成數值，避免「第九次」在字串排序中排到「第十次」之後。 */
function editionNumber(text) {
    text = text.normalize('NFKC').replace(/廿/g, '二十').replace(/卅/g, '三十');
    if (/^\d+$/.test(text)) return Number(text);
    const digits = {'零': 0, '〇': 0, '一': 1, '二': 2, '兩': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9};
    const units = {'十': 10, '百': 100, '千': 1000};
    if ([...text].every(char => char in digits)) return Number([...text].map(char => digits[char]).join(''));
    let total = 0, digit = 0;
    for (const char of text) {
        if (char in digits) digit = digits[char];
        else if (char in units) { total += (digit || 1) * units[char]; digit = 0; }
        else return -1;
    }
    return total + digit;
}

/** 同類活動只取最新屆次／年份，圖標與懸停說明使用同一個實際分類。 */
export function getTitleStatuses(found) {
    return statuses.flatMap(status => {
        const matchedCategories = [...new Set(found.filter(title => status.pattern ? status.pattern.test(title) : title === status.category))];
        if (status.pattern) {
            matchedCategories.sort((a, b) => editionNumber(status.pattern.exec(b)[1]) - editionNumber(status.pattern.exec(a)[1]));
            matchedCategories.splice(1);
        }
        return matchedCategories.length ? [{...status, matchedCategories}] : [];
    });
}

// 模組每次頁面載入建立一次；不用 sessionStorage，重新整理即可取得最新分類。
const categories = createTalkCategoryCache(params => wikiTransport.query(params), {
    batchSize: getQueryTitleLimit,
});
const cells = new WeakMap();
let notified = false;

/** 只更新單元格開頭的標記；輸入框、選取範圍及其撤銷歷史均不重建。 */
export function bindTitleStatus(cell, pageName) {
    if (cells.has(cell)) {
        const existing = cells.get(cell); existing.update(pageName); return existing;
    }
    // 核對表格可能由原標題格複製而來，先移除副本中的標記再建立自己的綁定。
    for (const child of [...cell.children]) if (child.classList.contains('acga-title-status')) child.remove();
    const icons = cell.ownerDocument.createElement('span');
    icons.className = 'acga-title-status'; cell.prepend(icons);
    let current, status = 'idle', version = 0, timer = null, destroyed = false;
    const binding = {
        update(name, delay = 0) {
            const title = mw.Title.newFromText((name || '').replace(/<!--[\s\S]*?-->/g, '').trim());
            const talk = title?.getTalkPage()?.getPrefixedText() || '';
            // 同名成功或進行中的查詢不重做；失敗後再次綁定則可重試，或使用別格已取得的快取。
            if (destroyed || talk === current && status !== 'failed') return;
            current = talk;
            status = 'loading';
            const requestVersion = ++version;
            clearTimeout(timer); icons.replaceChildren();
            cell.style.setProperty('--acga-title-status-space', '0px');
            if (!talk) return;
            const load = async () => {
                if (destroyed) return;
                try {
                    const found = await categories.get(talk);
                    // 只接受仍有效的綁定及目前標題所對應的回應。
                    if (destroyed || version !== requestVersion) return;
                    status = 'loaded';
                    const matched = getTitleStatuses(found);
                    // 全寬輸入框只讓出圖標及原有間距，避免編輯時把圖標擠到上一行。
                    cell.style.setProperty('--acga-title-status-space', `calc(${matched.length * 14}px + ${matched.length * .25}em)`);
                    for (const match of matched) {
                        const edition = match.pattern ? match.pattern.exec(match.matchedCategories[0])[1] : undefined;
                        const label = match.label(edition);
                        const image = cell.ownerDocument.createElement('img');
                        image.src = match.image; image.width = 14; image.height = 14;
                        image.alt = image.title = label;
                        icons.append(image);
                    }
                } catch {
                    if (destroyed || version !== requestVersion) return;
                    status = 'failed';
                    if (!notified) {
                        notified = true;
                        mw.notify(t('無法讀取討論頁分類，部分條目圖標暫時無法顯示。', '无法读取讨论页分类，部分条目图标暂时无法显示。'), {type: 'warn'});
                    }
                }
            };
            if (delay) timer = setTimeout(load, delay);
            else load();
        },
        destroy() { destroyed = true; version++; clearTimeout(timer); cells.delete(cell); },
    };
    cells.set(cell, binding); binding.update(pageName);
    return binding;
}
