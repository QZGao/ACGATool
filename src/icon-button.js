/** 編輯、核對與刪除共用圖標按鈕；無文字的按鈕仍提供提示與無障礙名稱。 */
export function iconButton(icon, label, handler, {showLabel = false, destructive = false} = {}) {
    const $icon = $('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true" focusable="false">').html(icon);
    const $button = $('<button>').addClass('acga-icon-button')
        .toggleClass('acga-icon-button--destructive', destructive)
        .attr({type: 'button', title: label, 'aria-label': label}).append($icon).on('click', handler);
    if (showLabel) $button.append($('<span>').text(label));
    return $button;
}
