import state from "./i18n.js";
import {initOOUI, showNewNominationDialog, resumeOpenWorkspace} from "./ui/editor.js";
import {addEditButtonsToPage} from "./page/controls.js";

function init() {
    // 差異比較也可能使用 view；只在一般閱讀模式載入依賴及建立小工具介面。
    if (mw.config.get('wgAction') !== 'view' || mw.config.get('wgDiffNewId') != null) return;
    const pageName = mw.config.get('wgPageName');
    if (pageName !== 'WikiProject:ACG/維基ACG專題獎' && pageName !== 'WikiProject:ACG/維基ACG專題獎/登記處') return;  // 非目標頁面，不執行

    mw.loader.using(['ext.gadget.HanAssist', 'mediawiki.api', 'mediawiki.util', 'mediawiki.Title', 'oojs-ui-core', 'oojs-ui-widgets', 'oojs-ui-windows']).then(async (require) => {
        const {conv} = require('ext.gadget.HanAssist');
        state.init(conv);

        if (pageName.endsWith('/登記處')) await initOOUI();
        await addEditButtonsToPage();
        if (pageName.endsWith('/登記處')) {
            await resumeOpenWorkspace();
            if (location.hash === '#acga-new') {
                history.replaceState(null, '', location.pathname + location.search);
                await showNewNominationDialog();
            }
        }
    }).catch(error => mw.notify(error.message || String(error), {type: 'error'}));
}

// 懸浮區必須掛在已存在的正文容器內。
$(init);
