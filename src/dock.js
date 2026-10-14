import state from './state.js';

const t = (hant, hans = hant) => state.convByVar({hant, hans});

/**
 * 在正文容器內建立唯一的固定操作區。面板只覆蓋頁面，不參與正文排版。
 * 工作草稿切換時只替換 actions/details 的內容，保留整個懸浮條的位置與導覽。
 * @param {Element} root .mw-parser-output 容器。
 * @returns {object} 各內容區、導覽按鈕及面板顯示方法。
 */
export function createDock(root) {
    const $element = $('<aside>').addClass('acga-dock mw-notalk noprint').attr('aria-label', t('ACGATool 操作區', 'ACGATool 操作区'));
    const $title = $('<strong>').text('ACGATool');
    const $summary = $('<span>').attr('role', 'status');
    const $actions = $('<div>').addClass('acga-actions');
    const $navigation = $('<div>').addClass('acga-actions');
    const $panel = $('<div>').addClass('acga-dock-panel').hide();
    const panes = {}, toggles = {};
    let currentPanel = null;
    const showPanel = name => {
        currentPanel = name;
        $panel.toggle(!!name);
        for (const [key, $pane] of Object.entries(panes)) {
            $pane.toggle(key === name);
            toggles[key].$button.attr('aria-expanded', key === name ? 'true' : 'false');
        }
    };
    const jumpButton = new OO.ui.ButtonWidget({label: t('回到表格')});
    $navigation.append(jumpButton.$element);
    for (const [name, label] of [['drafts', t('草稿')], ['archives', t('歸檔', '归档')], ['details', t('說明與儲存進度', '说明与储存进度')]]) {
        panes[name] = $('<section>').attr({id: `acga-dock-${name}`, 'aria-label': label}).hide();
        const button = new OO.ui.ButtonWidget({label});
        button.$button.attr({'aria-expanded': 'false', 'aria-controls': `acga-dock-${name}`});
        button.on('click', () => showPanel(currentPanel === name ? null : name));
        toggles[name] = button;
        $navigation.append(button.$element);
        $panel.append(panes[name]);
    }
    const $bar = $('<div>').addClass('acga-dock-bar').append($('<div>').addClass('acga-dock-heading').append($title, $summary), $actions, $navigation);
    $element.append($panel, $bar);
    $(root).append($element);

    // 固定於視窗底部，但左右邊界跟隨正文欄，避免覆蓋 Vector 側欄。
    const position = () => {
        const rect = root.getBoundingClientRect();
        const viewport = document.documentElement.clientWidth || window.innerWidth;
        const left = Math.max(8, rect.width ? rect.left : 8);
        const right = Math.min(viewport - 8, rect.width ? rect.right : viewport - 8);
        $element.css({left, width: Math.max(0, right - left)});
        // 只為固定底欄預留捲動空間；展開面板不把正文往上推。
        root.style.setProperty('--acga-dock-clearance', `${$bar.outerHeight() + 24}px`);
    };
    const originalPadding = window.getComputedStyle(root).paddingBottom;
    root.style.setProperty('--acga-original-padding', originalPadding);
    root.classList.add('acga-dock-host');
    window.addEventListener('resize', position);
    if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(position);
        observer.observe(root);
        observer.observe($bar[0]);
    }
    position();

    const setActive = active => {
        jumpButton.toggle(active);
        $actions.toggle(active);
        toggles.details.toggle(active);
        toggles.archives.toggle(!active && panes.archives.children().length > 0);
        if (!active) { $title.text('ACGATool'); $summary.empty(); showPanel(null); }
        position();
    };
    setActive(false);
    return {$element, $title, $summary, $actions, panes, toggles, jumpButton, showPanel, setActive};
}
