import {t} from '../i18n.js';
import {getDateSections} from './api.js';
import {REGISTER} from './submission.js';
import {formatEditSummary} from './edit-summary.js';
import {wikiTransport, writeStep} from './transport.js';

/** 從原始章節內的 UTC 簽名取最新時間，避免 CD 改寫日期顯示或留言順序影響判定。 */
export function hasRecentActivity(source, now = Date.now()) {
    let latest = null;
    const text = source.replace(/<!--[\s\S]*?-->/g, '');
    const signatures = /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*(?:[（(][^()（）\r\n]*[)）]\s*)?(\d{1,2})[:：](\d{2})\s*[（(]UTC[)）]/g;
    for (const match of text.matchAll(signatures)) {
        const [year, month, day, hour, minute] = match.slice(1).map(Number);
        const timestamp = Date.UTC(year, month - 1, day, hour, minute);
        const date = new Date(timestamp);
        // Date.UTC 會自動進位；格式錯誤的日期或時間不能算成新的活動。
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day ||
            date.getUTCHours() !== hour || date.getUTCMinutes() !== minute) continue;
        latest = latest === null ? timestamp : Math.max(latest, timestamp);
    }
    return latest !== null && now >= latest && now - latest < 7 * 24 * 60 * 60 * 1000;
}

/** 歸檔保留小節快照：先追加存檔，再從登記處移除同一份內容。 */
export async function prepareArchive(date, io = wikiTransport) {
    const registry = await io.read(REGISTER);
    const section = getDateSections(registry.text).find(section => section.date === date);
    if (!section) throw new Error(t('找不到要歸檔的日期小節。', '找不到要归档的日期小节。'));
    const source = registry.text.slice(section.start, section.end);
    const utc = source.match(/提名人：[^\n]*?(\d{4})年(\d{1,2})月\d{1,2}日[^\n]*?\(UTC\)/);
    if (!utc) throw new Error(t('無法確認此小節的 UTC 年月，請檢查提名簽名。', '无法确认此小节的 UTC 年月，请检查提名签名。'));
    const target = `WikiProject:ACG/維基ACG專題獎/存檔/${utc[1]}年${utc[2]}月`;
    return {mode: 'archive', archive: {date, source, target}, operation: {mode: 'archive', steps: [
        {key: 'archive', title: target, status: 'pending'},
        {key: 'registry', title: REGISTER, status: 'pending'},
    ]}};
}

function editRequest(draft, snapshot, title, text) {
    const target = `[[${draft.archive.target}|${draft.archive.target.split('/').pop()}]]`;
    const description = title === REGISTER ?
        t(`歸檔「${draft.archive.date}」至${target}`, `归档「${draft.archive.date}」至${target}`) :
        t(`歸檔「${draft.archive.date}」小節`, `归档「${draft.archive.date}」小节`);
    return {title, text, create: !!snapshot.missing,
        summary: formatEditSummary(description, draft.summary),
        base: {revid: snapshot.revid, starttimestamp: snapshot.starttimestamp}};
}

/** 重試只執行指定的歸檔步驟；成功與否由編輯請求回應決定。 */
export async function submitArchive(draft, persist, io = wikiTransport, stepKey = null) {
    const {operation, archive} = draft;
    const steps = stepKey ? operation.steps.filter(step => step.key === stepKey) : operation.steps;
    if (!steps.length) throw new Error(t('找不到指定的歸檔步驟。', '找不到指定的归档步骤。'));
    for (const step of steps) {
        if (step.status === 'succeeded') continue;
        const index = operation.steps.indexOf(step);
        if (operation.steps.slice(0, index).some(previous => previous.status !== 'succeeded')) throw new Error(t('請先完成存檔頁的儲存。', '请先完成存档页的保存。'));
        let edit;
        try {
            const current = await io.read(step.title, {allowMissing: step.key === 'archive'});
            let text;
            if (step.key === 'archive') {
                const header = current.text || '{{Talk archive|WikiProject:ACG/維基ACG專題獎/登記處}}';
                text = header + '\n\n' + archive.source;
            } else {
                const section = getDateSections(current.text).find(section => section.date === archive.date);
                if (!section || current.text.slice(section.start, section.end) !== archive.source) {
                    throw new Error(t('存檔頁已儲存，但登記處的小節內容已變更，尚未移除。請檢視兩頁差異後再重試。', '存档页已保存，但登记处的小节内容已变更，尚未移除。请检查两页差异后再重试。'));
                }
                text = current.text.slice(0, section.start) + current.text.slice(section.end);
            }
            edit = editRequest(draft, current, step.title, text);
        } catch (error) {
            step.status = 'failed'; step.error = error.message;
            await persist(); return false;
        }
        if (!await writeStep(step, edit, persist, io)) return false;
    }
    return operation.steps.every(step => step.status === 'succeeded');
}
