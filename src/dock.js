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
    const $progress = $('<div>').addClass('acga-completion-progress').attr({role: 'progressbar', 'aria-label': t('操作完成進度', '操作完成进度'), 'aria-valuemin': 0, 'aria-valuemax': 100});
    const $fill = $('<div>').addClass('acga-completion-fill').appendTo($progress);
    const setProgress = (ready, total) => {
        const percentage = total ? ready / total * 100 : 0;
        $progress.attr({'aria-valuenow': percentage, 'aria-valuetext': `${ready}/${total}`});
        $fill.css('transform', `scaleX(${percentage / 100})`);
    };
    const panes = {}, toggles = {};
    let currentPanel = null;
    const showPanel = name => {
        currentPanel = name;
        $panel.toggle(!!name);
        for (const [key, $pane] of Object.entries(panes)) {
            $pane.toggle(key === name);
            toggles[key]?.$button.attr('aria-expanded', key === name ? 'true' : 'false');
        }
    };
    const jumpButton = new OO.ui.ButtonWidget({label: t('回到表格')});
    toggles.drafts = new OO.ui.ButtonWidget({label: t('草稿箱')});
    $navigation.append(jumpButton.$element, toggles.drafts.$element);
    for (const [name, label] of [['progress', t('儲存結果', '储存结果')], ['sync', t('同步衝突', '同步冲突')]]) {
        panes[name] = $('<section>').attr({id: `acga-dock-${name}`, 'aria-label': label}).hide();
        const button = new OO.ui.ButtonWidget({label});
        button.$button.attr({'aria-expanded': 'false', 'aria-controls': `acga-dock-${name}`});
        button.on('click', () => showPanel(currentPanel === name ? null : name));
        toggles[name] = button;
        $navigation.append(button.$element);
        $panel.append(panes[name]);
    }
    panes.confirm = $('<section>').attr('aria-label', t('確認送出', '确认提交')).hide().appendTo($panel);
    const $notice = $('<span>').attr('role', 'status').addClass('acga-notice');
    const $bar = $('<div>').addClass('acga-dock-bar').append($('<div>').addClass('acga-dock-heading').append($title, $summary), $actions, $navigation, $notice);
    $element.append($progress, $panel, $bar);
    $(root).append($element);

    // 固定於視窗底部，但左右邊界跟隨正文欄，避免覆蓋 Vector 側欄。
    const position = () => {
        const rect = root.getBoundingClientRect();
        const viewport = document.documentElement.clientWidth || window.innerWidth;
        const left = Math.max(8, rect.width ? rect.left : 8);
        const right = Math.min(viewport - 8, rect.width ? rect.right : viewport - 8);
        $element.css({left, width: Math.max(0, right - left)});
        // 懸浮條高度只供編輯器的 scroll-margin 使用，不加到正文 padding 造成頁尾留白。
        root.style.setProperty('--acga-dock-clearance', `${$bar.outerHeight() + 24}px`);
    };
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
        if (!active) $title.text('ACGATool');
        position();
    };
    setActive(false);
    return {$element, $title, $summary, $actions, $notice, panes, toggles, jumpButton, showPanel, setActive, setProgress};
}
