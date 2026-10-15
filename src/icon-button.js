/** 編輯、核對與刪除共用圖標按鈕；無文字的按鈕仍提供提示與無障礙名稱。 */
export function iconButton(icon, label, handler, {showLabel = false, destructive = false} = {}) {
    const $icon = $('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true" focusable="false">').html(icon);
    const $button = $('<button>').addClass('acga-icon-button')
        .toggleClass('acga-icon-button--destructive', destructive)
        .attr({type: 'button', title: label, 'aria-label': label}).append($icon).on('click', async event => {
            // 讀取提名時保留入口位置並展示忙碌狀態，避免連點建立重複請求。
            $button.prop('disabled', true).attr('aria-busy', 'true');
            try { await handler(event); }
            catch (error) { mw.notify(error.message || String(error), {type: 'error'}); }
            finally { $button.prop('disabled', false).removeAttr('aria-busy'); }
        });
    if (showLabel) $button.append($('<span>').text(label));
    return $button;
}
