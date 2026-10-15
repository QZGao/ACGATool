import {t} from '../i18n.js';
import {getArticleRoot} from './sections.js';
import {REGISTER} from '../wiki/submission.js';
import {wikiTransport} from '../wiki/transport.js';

/** 成功後只讀取 MediaWiki 渲染結果；保留浮層節點及頁面捲動位置。 */
export async function refreshRegistryContent(retained, beforeReplace) {
    const {html, text} = await wikiTransport.render(REGISTER);
    if (typeof html !== 'string' || typeof text !== 'string') throw new Error(t('無法讀取儲存後的提名。', '无法读取保存后的提名。'));
    const $parsed = $('<div>').append($.parseHTML(html, document, false));
    const $content = $parsed.children('.mw-parser-output').first();
    const $root = $(getArticleRoot());
    const position = window.scrollY;
    if (beforeReplace() === false) return false;
    retained.forEach($element => $element.detach());
    $root.empty().append($content.length ? $content.contents() : $parsed.contents());
    retained.forEach($element => $root.append($element));
    // 維基小工具（包括 CD）可重新處理伺服器產生的正文。
    mw.hook('wikipage.content').fire($root);
    const {addEditButtonsToPage} = await import('./controls.js');
    await addEditButtonsToPage(text);
    window.scrollTo({top: position});
    return true;
}
