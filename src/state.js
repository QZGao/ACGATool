/** 語言轉換共用設定；編輯內容由 localStorage 的共同工作區管理。 */
const state = {
    convByVar: () => '繁簡轉換未初始化！',
    init(convByVar) { this.convByVar = convByVar; },
};
export default state;
