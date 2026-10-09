# ACGATool

專案頁面：[ACGATool](https://zh.wikipedia.org/wiki/User:SuperGrey/gadgets/ACGATool)

[維基ACG專題獎](https://zh.wikipedia.org/wiki/WikiProject:ACG/維基ACG專題獎) 專用提名、核分小工具。

- **新提名：** 點擊 [登記處](https://zh.wikipedia.org/wiki/WikiProject:ACG/維基ACG專題獎/登記處) 頁面頂部「登記新提名」按鈕，即可打開「新提名」視窗。可同時提名多則條目。按「儲存」即發佈至登記處頁面。
- **編輯提名：** 點擊登記處內任一已有提名中條目名稱右側出現的「筆」圖示，即可打開「編輯提名」視窗。在此，可對單則提名進行修改。介面與新提名類似。按「儲存」即完成修訂。
- **核對分數：** 點擊登記處內任一已有提名中提名核對欄出現的「螢光筆」圖示，即可打開「提名核分」視窗。在此，可對單則提名進行核分，也可以對已核分提名重新核分。除了可選擇部分項得分外，也可直接選取「提名無效」。按「儲存」即完成核分。此外，小工具將自動於 [Module:ACGaward/list](https://zh.wikipedia.org/wiki/Module:ACGaward/list) 登記分數（但不會自動傳送「頒獎」通知）。
- **歸檔：** 點擊登記處內任一章節標題的「歸檔」連結，即可一鍵歸檔該章節。

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
