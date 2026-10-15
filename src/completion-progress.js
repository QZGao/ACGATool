import {t} from './state.js';
import {cdxIconUserAdd, cdxIconEdit, cdxIconHighlight, cdxIconSandbox} from './icons.js';


/**
 * 色塊先排已完成、再排未完成；各組依新提名／修改／核對／覆核排列，共用一次插值。
 * 同一輪伸縮使用相同時間與緩動，總寬度才不會因個別動畫反轉而產生空隙。
 */
export function createCompletionProgress() {
    const types = [
        {type: 'new', label: t('新提名'), icon: cdxIconUserAdd},
        {type: 'edit', label: t('修改提名'), icon: cdxIconEdit},
        {type: 'check', label: t('核對分數', '核对分数'), icon: cdxIconHighlight},
        {type: 'recheck', label: t('分數覆核', '分数复核'), icon: cdxIconSandbox},
    ];
    const $element = $('<div>').addClass('acga-completion-progress').attr({role: 'progressbar',
        'aria-label': t('操作完成進度', '操作完成进度'), 'aria-valuemin': 0, 'aria-valuemax': 100});
    const segments = [true, false].flatMap(done => types.map(({type}) => ({type, done,
        $element: $('<span>').addClass(`acga-completion-segment acga-type-${type}`)
            .toggleClass('acga-completion-pending', !done).attr('aria-hidden', 'true').appendTo($element),
    })));
    const $legend = $('<span>').addClass('acga-operation-counts').attr({role: 'group', 'aria-label': t('各類操作完成數', '各类操作完成数')});
    const labels = types.map(({type, label, icon}) => {
        const $count = $('<span>');
        const $item = $('<span>').addClass(`acga-operation-count acga-type-${type}`).append(
            $('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true" focusable="false">').html(icon), $count);
        $legend.append($item);
        return {type, label, $item, $count};
    });
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let current = Array(segments.length).fill(0), target = [...current], frame = null;
    const paint = widths => {
        current = widths;
        segments.forEach((segment, index) => segment.$element.css('width', `${widths[index] * 100}%`));
    };
    const animate = next => {
        // 自動保存可頻繁通知畫面；比例沒變時不可反覆重啟動畫。
        if (next.every((width, index) => width === target[index])) return;
        if (frame !== null) cancelAnimationFrame(frame);
        target = next;
        if (reducedMotion?.matches) { frame = null; paint(target); return; }
        const from = [...current], started = performance.now();
        const tick = now => {
            const time = Math.min(1, Math.max(0, (now - started) / 400));
            const eased = time < .5 ? 4 * time ** 3 : 1 - (-2 * time + 2) ** 3 / 2;
            paint(from.map((width, index) => width + (target[index] - width) * eased));
            frame = time < 1 ? requestAnimationFrame(tick) : null;
        };
        frame = requestAnimationFrame(tick);
    };
    reducedMotion?.addEventListener?.('change', () => {
        if (reducedMotion.matches) {
            if (frame !== null) cancelAnimationFrame(frame);
            frame = null; paint(target);
        }
    });
    return {$element, $legend, update({ready, total, byType}) {
        $element.attr({'aria-valuenow': total ? ready / total * 100 : 0, 'aria-valuetext': `${ready}/${total}`});
        for (const {type, label, $item, $count} of labels) {
            const counts = byType[type];
            $item.toggle(counts.total > 0);
            $count.text(`${label} ${counts.ready}/${counts.total}`);
        }
        $legend.toggle(total > 0);
        animate(segments.map(({type, done}) => total ? (done ? byType[type].ready : byType[type].total - byType[type].ready) / total : 0));
    }};
}
