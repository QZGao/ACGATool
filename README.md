# ACGATool

專案頁面：[ACGATool](https://zh.wikipedia.org/wiki/User:SuperGrey/gadgets/ACGATool)

[維基ACG專題獎](https://zh.wikipedia.org/wiki/WikiProject:ACG/維基ACG專題獎) 專用提名、核分小工具。

- **新提名與編輯：** 直接在登記處的原生提名表格內操作，沿用「條目／獲提名者／提名內容」三欄與下方核對行，可同時新增最多 25 筆提名。「選擇規則」另開彈窗；較少使用的分類預設摺疊，已有選項的分類會展開。
- **批次核對：** 選取提名後在同樣的提名表格內逐筆檢查，勾選「已核對此筆」再一次送出。修改核對內容會取消該筆的完成狀態。
- **覆核與更正得分者：** 已核分及覆核中的提名提供「覆核／更正得分」。舊結果連同簽名會保留並標記撤銷，積分榜按實際已入帳分數的差額調整。沒有入帳紀錄的舊核分，需要確認原分數是否已登記。
- **草稿：** 編輯、附加說明和核對進度自動保存於目前瀏覽器的 localStorage，依站點與登入帳號分開。「關閉並保留草稿」後可從草稿清單恢復。另一分頁修改同一草稿時，可另存目前內容。只有本次成功提交的內容會清除。
- **儲存進度：** 登記處與積分榜分別顯示完成狀態。失敗時保留畫面與草稿，重試只處理尚未完成的步驟。回應逾時會先查證結果；無法確認時保留「結果未明」，不重複加分。
- **變更檢查：** 提交前及登記積分前重新比對提名。內容有變時停止，展示差異並要求重新核對，保留先前草稿供參考。
- **自己的提名：** 登入者是提名人或得分者時，不顯示單筆核對與批次選取入口，提交時也會再檢查。無法辨識提名人或無法完整解析舊核分的項目需手動處理。
- **歸檔：** 點擊章節標題的「歸檔」連結，可歸檔該章節。

小工具會在提名內容及 `Module:ACGaward/list` 的註解中保留提交識別與入帳紀錄，用於覆核、逾時確認及避免重複加分。手動維護時請保留這些註解。登記處與積分榜是兩次獨立編輯，部分成功時可恢復尚未完成的步驟。

## 使用方式
### 發行版本
将如下程式碼复制至 [User:你的用戶名/common.js](https://zh.wikipedia.org/wiki/Special:MyPage/common.js) 頁面：

```js
importScript('User:SuperGrey/gadgets/ACGATool/main.js');  // Backlink: [[User:SuperGrey/gadgets/ACGATool]]
```

### 從原始碼建構

1. **安裝 Node.js**
   - 請先安裝 [Node.js](https://nodejs.org/)。

2. **安裝依賴套件**
   - 在 ACGATool 目錄下執行：
     ```sh
     npm install
     ```

3. **建構 Bundled 版本**
   - 執行下列指令以產生 `dist/bundled.js`：
     ```sh
     npm run build
     ```
   - 若需持續監看檔案變動並自動重建，請執行：
     ```sh
     npm run watch
     ```

4. **安裝至維基**
   - 將 `dist/bundled.js` 上傳至你的維基用戶頁面，例如 [User:你的用戶名/ACGATool.js](https://zh.wikipedia.org/wiki/Special:MyPage/ACGATool.js)。
   - 在 [User:你的用戶名/common.js](https://zh.wikipedia.org/wiki/Special:MyPage/common.js) 頁面加入：
     ```js
     importScript('User:你的用戶名/ACGATool.js');  // 修改為你的用戶名
     ```

## 本機驗證

```sh
npm test
npm run build
```

`tests/` 使用 Node.js 內建測試工具，集中檢查批次定位、覆核差額、草稿清除、部分失敗、逾時確認與提交期間的內容變更。全部為 dry-run：測試啟動時禁止網路及真實 `mw.Api`，儲存流程僅使用注入的記憶體模擬介面，不會儲存維基頁面。
