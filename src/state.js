/**
 * workspace 是可序列化的草稿：id、mode、nominations、message 及未完成的 operation。
 * 畫面元件留在編輯器模組；nominations 與目前 workspace 的陣列共享參照，changed 負責通知保存。
 */
const state = {
    convByVar: (langDict) => "繁簡轉換未初始化！",  // 簡繁轉換
    nominations: [],  // 提名
    workspace: null,
    changed: () => {},

    init(convByVar) {
        this.convByVar = convByVar;
    }
};

export default state;