import state from "./state.js";
import {initOOUI} from "./dialog.js";
import {addEditButtonsToPage} from "./dom.js";

function init() {
    const pageName = mw.config.get('wgPageName');
    if (pageName !== 'WikiProject:ACG/維基ACG專題獎' && pageName !== 'WikiProject:ACG/維基ACG專題獎/登記處') return;  // 非目標頁面，不執行

    mw.loader.using(['ext.gadget.HanAssist', 'mediawiki.api', 'mediawiki.util', 'oojs-ui-core', 'oojs-ui-widgets', 'oojs-ui-windows']).then((require) => {
        const {convByVar} = require('ext.gadget.HanAssist');
        state.init(convByVar);

        initOOUI();

        addEditButtonsToPage();  // 添加提名按鈕
    });
}

init();