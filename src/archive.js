import {getDateSections} from './api.js';
import {newId} from './scoring.js';
import {REGISTER} from './submission.js';
import {wikiTransport, writeStep} from './transport.js';

/** 歸檔保留小節快照：先追加存檔，再從登記處移除同一份內容。 */
export async function prepareArchive(date, io = wikiTransport) {
    const registry = await io.read(REGISTER);
    const section = getDateSections(registry.text).find(section => section.date === date);
    if (!section) throw new Error('找不到要歸檔的日期小節。');
    const source = registry.text.slice(section.start, section.end);
    const utc = source.match(/提名人：[^\n]*?(\d{4})年(\d{1,2})月\d{1,2}日[^\n]*?\(UTC\)/);
    if (!utc) throw new Error('無法確認此小節的 UTC 年月，請檢查提名簽名。');
    const target = `WikiProject:ACG/維基ACG專題獎/存檔/${utc[1]}年${utc[2]}月`;
    return {mode: 'archive', archive: {date, source, target}, operation: {id: newId(), mode: 'archive', steps: [
        {key: 'archive', label: '存檔頁', title: target, status: 'pending'},
        {key: 'registry', label: '登記處', title: REGISTER, status: 'pending'},
    ]}};
}

function attempt(draft, snapshot, title, text) {
    const id = draft.operation.id;
    const marker = `<!--ACGATool-archive:${id}-->`;
    const tag = `[ACGATool:${id}]`;
    return {title, text: text + '\n' + marker, marker, tag, create: !!snapshot.missing,
        summary: `歸檔「${draft.archive.date}」至[[${draft.archive.target}]] ${tag}`,
        base: {revid: snapshot.revid, starttimestamp: snapshot.starttimestamp}};
}

/** 與核分一樣保存原請求；進入恢復流程後只執行使用者指定的單一步驟。 */
export async function submitArchive(draft, persist, io = wikiTransport, action = null) {
    const {operation, archive} = draft;
    const steps = action ? operation.steps.filter(step => step.key === action.stepKey) : operation.steps;
    if (!steps.length) throw new Error('找不到指定的歸檔步驟。');
    for (const step of steps) {
        if (step.status === 'succeeded') continue;
        const index = operation.steps.indexOf(step);
        if (operation.steps.slice(0, index).some(previous => previous.status !== 'succeeded')) throw new Error('請先完成存檔頁的儲存。');
        const uncertain = ['unknown', 'saving'].includes(step.status);
        if (action?.kind === 'query' && !uncertain) throw new Error('此步驟沒有結果未明的請求。');
        if (action?.kind === 'retry' && uncertain) throw new Error('請先查詢上次儲存結果。');
        if (!uncertain) {
            try {
                const current = await io.read(step.title, {allowMissing: step.key === 'archive'});
                let text;
                if (step.key === 'archive') {
                    if (current.text.includes(archive.source)) {
                        // 其他使用者可能已完成同一份搬移；完整副本存在時不再追加。
                        step.status = 'succeeded'; step.revid = current.revid; step.error = '';
                        await persist(); continue;
                    }
                    const header = current.text || '{{Talk archive|WikiProject:ACG/維基ACG專題獎/登記處}}';
                    text = header + '\n\n' + archive.source;
                } else {
                    const section = getDateSections(current.text).find(section => section.date === archive.date);
                    if (section && current.text.slice(section.start, section.end) !== archive.source) {
                        throw new Error('存檔頁已儲存，但登記處的小節內容已變更，尚未移除。請檢視兩頁差異後再重試。');
                    }
                    const savedArchive = await io.read(archive.target);
                    if (!savedArchive.text.includes(archive.source)) throw new Error('存檔頁內容已變更，未移除登記處的小節。請先檢查存檔。');
                    if (!section) {
                        // 使用者可能已手動完成移除；完整副本仍在時毋須再次寫入。
                        step.status = 'succeeded'; step.revid = current.revid; step.error = '';
                        await persist(); continue;
                    }
                    text = current.text.slice(0, section.start) + current.text.slice(section.end);
                }
                step.attempt = attempt(draft, current, step.title, text);
            } catch (error) {
                step.status = 'failed'; step.error = error.message;
                await persist(); return false;
            }
        }
        if (!await writeStep(step, persist, io)) return false;
    }
    return operation.steps.every(step => step.status === 'succeeded');
}
