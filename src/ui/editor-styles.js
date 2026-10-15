export function initEditorStyles() {
    mw.util.addCSS(`
        .acga-editor { margin: 1.5em 0; }
        .acga-editor { scroll-margin-block: 1em var(--acga-dock-clearance, 100px); }
        .acga-new-nomination-footer { margin-block: .75em; }
        a.acga-archive.acga-archive-recent { color: var(--color-subtle, #54595d); }
        .acga-dock { position: fixed; bottom: max(8px, env(safe-area-inset-bottom)); z-index: 100; box-sizing: border-box; color: var(--color-base, #202122); background: var(--background-color-base, #fff); border: 1px solid var(--border-color-base, #a2a9b1); border-radius: 2px; }
        .acga-completion-progress { position: absolute; inset: -1px -1px auto; height: 4px; display: flex; overflow: hidden; background: var(--background-color-neutral, #eaecf0); }
        .acga-completion-segment { flex: none; width: 0; height: 100%; background: rgb(var(--acga-ready-rgb)); }
        .acga-completion-pending { background: rgba(var(--acga-ready-rgb),.25); }
        .acga-operation-counts { display: flex; flex-wrap: wrap; gap: .4em .85em; }
        .acga-operation-count, .acga-draft-type { display: inline-flex; align-items: center; gap: .3em; white-space: nowrap; }
        .acga-operation-count svg, .acga-draft-type svg { flex: none; width: 14px; height: 14px; fill: rgb(var(--acga-ready-rgb)); }
        .acga-editor-row { scroll-margin-block: 1em var(--acga-dock-clearance, 100px); }
        .acga-editor-row > .acgnom-check-cell { position: relative; padding-inline-end: 3.6em !important; }
        /* 藍色沿用 Codex blue700；青綠 #177878、黃綠 #4d7a1f 拉開色相以區分操作。
           覆核另用 Codex yellow700；入口、背景與進度條共用操作色。 */
        .acga-type-new { --acga-ready-rgb: 51,102,204; }
        .acga-edit-button, .acga-type-edit { --acga-ready-rgb: 23,120,120; }
        .acga-check-button, .acga-type-check { --acga-ready-rgb: 77,122,31; }
        .acga-recheck-button, .acga-type-recheck { --acga-ready-rgb: 136,100,37; }
        /* 行背景以整張表的寬度繪製；純橫向漸變讓兩行及跨行標題共用同一色階。
           開啟的表單清除單元格底色，避免模板的黃色標題或個別格子遮斷背景。 */
        .acga-edit-table tr.acga-operation-background { background: linear-gradient(90deg, transparent 0%, rgba(var(--acga-ready-rgb),.035) 50%, rgba(var(--acga-ready-rgb),.12) 90%, rgba(var(--acga-ready-rgb),.12) 100%); }
        .acga-edit-table tr.acga-operation-background.acga-ready { background: rgba(var(--acga-ready-rgb),.12); }
        .acga-edit-table tr.acga-editor-row.acga-operation-background > th,
        .acga-edit-table tr.acga-editor-row.acga-operation-background > td { background: transparent; }
        .acga-background-mark { position: absolute; inset-inline-end: .6em; top: 50%; transform: translateY(-50%); width: 2.3em; color: rgba(var(--acga-ready-rgb),.65); font-weight: bold; text-align: center; pointer-events: none; }
        .acga-background-mark svg { width: 2em; height: 2em; fill: currentColor; }
        .acga-ready-label { display: block; color: var(--color-subtle, #54595d); font-size: .8em; margin-top: .25em; }
        .acga-validation { font-size: .85em; color: var(--color-destructive, #b32424); margin-block: .3em; }
        .acga-validation:empty, .acga-notice:empty { display: none; }
        .acga-submit-message, .acga-submit-summary { margin-block: .6em; }
        .acga-score-preview { font-size: .9em; margin-block: .4em; }
        .acga-save-result + .acga-save-result { border-top: 1px solid var(--border-color-base, #a2a9b1); margin-top: 1em; padding-top: 1em; }
        /* OOUI 模態視窗開啟時暫藏底欄，避免底欄遮住視窗或接受提交操作。 */
        .oo-ui-windowManager-modal-active .acga-dock { visibility: hidden; }
        .acga-dock-bar { display: flex; flex-wrap: wrap; align-items: center; gap: .5em 1em; padding: .6em .8em; }
        .acga-dock-heading { display: flex; flex: 1 1 22em; min-width: 0; align-items: baseline; flex-wrap: wrap; gap: .5em 1em; }
        .acga-dock-panel { max-height: min(55vh, 32em); overflow: auto; padding: .8em; border-bottom: 1px solid var(--border-color-base, #a2a9b1); }
        .acga-dock-panel > section > :first-child { margin-top: 0; }
        .acga-dock-panel p { margin-block: .4em; }
        .acga-dock-panel .oo-ui-textInputWidget { max-width: none; }
        .acga-dock-panel .acga-actions { margin-top: .6em; }
        .acga-dock .oo-ui-buttonElement { margin: 0; }
        .acga-dock .acga-drafts { display: flex; flex-wrap: wrap; gap: .5em; }
        .acga-dock .acga-drafts > strong { flex-basis: 100%; }
        .acga-dock-options { margin-bottom: .8em; }
        .acga-conflicts { overflow-x: auto; }
        .acga-conflicts:empty { display: none; }
        .acga-conflicts table { width: 100%; border-collapse: collapse; }
        .acga-conflicts th, .acga-conflicts td { text-align: left; vertical-align: baseline; padding: .5em; border: 1px solid var(--border-color-base, #a2a9b1); overflow-wrap: anywhere; white-space: pre-wrap; }
        .acga-conflicts mark { background: var(--background-color-warning-subtle, #fef6e7); color: var(--color-base, #202122); }
        .acga-needs-review > .acgnom-check-cell { outline: 2px solid var(--color-error, #b32424); outline-offset: -2px; }
        .acga-save-progress li { margin-block: .75em; }
        .acga-save-progress p { margin-block: .25em; }
        .acga-edit-table { width: 100%; }
        .acga-edit-table .acgnom-title-heading, .acga-edit-table .acgnom-user-heading { width: 25%; }
        .acga-edit-table .acga-cell-input { width: 100%; max-width: none; }
        .acga-edit-table .acga-cell-input input { min-width: 0; background: transparent; color: inherit; font: inherit; padding: .25em; }
        .acga-inline-action { border: 0; background: transparent; padding: 0; color: var(--color-progressive, #36c); cursor: pointer; font: inherit; font-size: smaller; }
        .acga-inline-action::before { content: '［'; } .acga-inline-action::after { content: '］'; }
        .acga-inline-action:hover { text-decoration: underline; }
        .acga-inline-action:focus-visible { outline: 2px solid var(--color-progressive, #36c); }
        /* 圖標沿用原筆圖標的 12px，加上少量邊距後，純圖標按鈕為 16px。 */
        .acga-icon-button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 16px; min-height: 16px; box-sizing: border-box; padding: 1px; border: 1px solid transparent; border-radius: 2px; background: transparent; color: var(--color-progressive, #36c); font: inherit; line-height: 1; vertical-align: middle; cursor: pointer; }
        .acga-icon-button svg { display: block; flex: none; width: 12px; height: 12px; fill: currentColor; }
        .acga-icon-button:enabled:hover { background: var(--background-color-progressive-subtle, #eaf3ff); }
        .acga-icon-button--destructive { color: var(--color-destructive, #b32424); }
        .acga-icon-button--destructive:enabled:hover { background: var(--background-color-destructive-subtle, #fee7e6); }
        .acga-icon-button:focus-visible { outline: 2px solid var(--color-progressive, #36c); outline-offset: 1px; }
        .acga-icon-button:disabled { opacity: .5; cursor: default; }
        /* 操作入口與完成背景共用色相，懸停與鍵盤焦點也沿用同一顏色。 */
        .acga-icon-button.acga-edit-button, .acga-icon-button.acga-check-button { color: rgb(var(--acga-ready-rgb)); }
        .acga-edit-button:enabled:hover, .acga-check-button:enabled:hover { background: rgba(var(--acga-ready-rgb),.12); }
        .acga-edit-button:focus-visible, .acga-check-button:focus-visible { outline-color: currentColor; }
        .acga-row-actions { display: flex; justify-content: center; align-items: center; gap: 4px; margin-top: .3em; }
        .acga-row-actions.acga-review-actions { display: inline-flex; margin: 0; vertical-align: baseline; }
        .acga-row-actions .acga-icon-button { font-size: 12px; }
        .acga-stash-nomination svg { transform: rotate(90deg); }
        .acga-draft-picker .oo-ui-fieldLayout { margin-top: .75em; }
        .acga-draft-picker .oo-ui-fieldLayout:first-child { margin-top: 0; }
        .acga-edit-button, .acga-check-button { font-size: .857em; font-weight: bold; }
        .acga-check-button { margin-left: 5px; }
        .acga-inline-option { display: inline-flex; align-items: baseline; gap: .25em; margin: .4em .75em .25em 0; }
        .acga-check-message { max-width: none; margin-top: .4em; }
        .acga-original-check { margin-block: .4em; }
        .acga-booking { margin-block: .4em; }
        .acga-booking select { max-width: 100%; font: inherit; }
        .acga-edit-table th, .acga-edit-table td { overflow-wrap: anywhere; }
        .acga-edit-table .acgnom-title-cell { text-align: center; }
        .acga-table-scroll { overflow-x: auto; }
        .acga-drafts .oo-ui-buttonElement { max-width: 100%; }
        .acga-drafts .oo-ui-labelElement-label { white-space: normal; }
        .acga-editor .oo-ui-horizontalLayout { min-width: 0; }
        .acga-actions { display: flex; flex-wrap: wrap; gap: .5em; margin: 0; }
        .acga-rules details { margin: .75em 0; }
        .acga-rules summary { cursor: pointer; font-weight: bold; }
        .acga-rule-explanation { font-size: .875em; color: var(--color-subtle, #54595d); }
        .acga-rules .oo-ui-horizontalLayout { display: flex; flex-wrap: wrap; gap: .5em; }
        /* 單個規則內以 gap 統一間距，避免 OOUI margin 與手動 margin 疊加。 */
        .acga-rules .acga-rule-option { gap: 2px; }
        .acga-rules .acga-rule-option > .oo-ui-widget { margin: 0; }
        .acga-rules .acga-rule-option > .oo-ui-checkboxInputWidget { margin-inline-end: 4px; }
        @media (max-width: 600px) { .acga-edit-table { min-width: 340px; } .acga-editor .oo-ui-horizontalLayout { max-width: 100%; } }
    `);
}

