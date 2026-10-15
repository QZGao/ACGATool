/**
 * 使用者輸入只向資料層提交；同步回畫面時，值不同才呼叫 setValue。
 * IME 組合期間保留原 DOM 與未確認文字，等 compositionend 後的最終 input
 * 處理完才提交一次。程式回寫不再觸發自動保存，避免資料來回傳遞。
 */
export function bindTextInput(widget, commit, settled = () => {}) {
    let writing = false, composing = false, ending = null;
    const waiters = [];
    const isComposing = () => composing || ending !== null;
    const change = value => { if (!writing && !isComposing()) commit(value); };
    const resolve = () => { waiters.splice(0).forEach(done => done()); };
    const finish = () => {
        composing = false;
        clearTimeout(ending);
        // 各瀏覽器的最終 input 與 compositionend 順序不同，讀取實際輸入值。
        ending = setTimeout(() => {
            ending = null;
            commit(widget.$input.val());
            resolve(); settled();
        }, 0);
    };
    widget.on('change', change);
    widget.$input.on('compositionstart.acgaInput', () => {
        clearTimeout(ending); ending = null; composing = true;
    }).on('compositionend.acgaInput', finish).on('blur.acgaInput', () => {
        if (composing) finish();
    });
    return {
        isComposing,
        settled: () => isComposing() ? new Promise(done => waiters.push(done)) : Promise.resolve(),
        sync(value) {
            if (isComposing()) return false;
            const text = String(value ?? '');
            if (widget.$input.val() !== text) {
                writing = true;
                try { widget.setValue(text); } finally { writing = false; }
            }
            return true;
        },
        destroy() {
            clearTimeout(ending); ending = null; composing = false;
            widget.off('change', change); widget.$input.off('.acgaInput');
            resolve();
        },
    };
}
