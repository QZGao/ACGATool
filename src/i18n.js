/** 介面文字共用 HanAssist.conv；啟動前的錯誤仍能使用預設繁體訊息。 */
const state = {
    conv: ({hant}) => hant,
    init(conv) { this.conv = conv; },
};
export default state;

/** 每次顯示時才選擇語言；同字詞可省略第二參數，使用者輸入不交由此函式轉換。 */
export const t = (hant, hans = hant) => state.conv({hant, hans});
