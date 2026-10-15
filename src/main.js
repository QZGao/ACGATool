import state from "./state.js";
import {initOOUI, showNewNominationDialog, resumeOpenWorkspace} from "./dialog.js";
import {addEditButtonsToPage} from "./dom.js";

function init() {
    const pageName = mw.config.get('wgPageName');
    if (pageName !== 'WikiProject:ACG/維基ACG專題獎' && pageName !== 'WikiProject:ACG/維基ACG專題獎/登記處') return;  // 非目標頁面，不執行

    mw.loader.using(['ext.gadget.HanAssist', 'mediawiki.api', 'mediawiki.util', 'oojs-ui-core', 'oojs-ui-widgets', 'oojs-ui-windows']).then(async (require) => {
        const {convByVar} = require('ext.gadget.HanAssist');
        state.init(convByVar);

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
