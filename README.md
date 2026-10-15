# ACGATool

專案頁面：[ACGATool](https://zh.wikipedia.org/wiki/User:SuperGrey/gadgets/ACGATool)

[維基ACG專題獎](https://zh.wikipedia.org/wiki/WikiProject:ACG/維基ACG專題獎) 專用提名、核分小工具。

- **新提名：** 點擊 [登記處](https://zh.wikipedia.org/wiki/WikiProject:ACG/維基ACG專題獎/登記處) 頁面頂部或底部的「登記新提名」按鈕，即可在頁面底部的表格中填寫新提名。可同時提名多則條目。按「送出全部」，再按「確認送出」發佈。
- **編輯提名：** 點擊未核分提名的條目欄中的「編輯提名」按鈕，即可直接在原表格中修改條目、得分者及規則。可與其他提名操作一同按「送出全部」，再按「確認送出」儲存。
- **核對分數：** 點擊提名核對欄中的「核對」或「覆核／更正得分」，即可在表格中核分或更正已核分結果及得分者。可選擇部分項得分或「提名無效」。逐筆勾選「核對完成」或「覆核完成」後，按「送出全部」，再按「確認送出」。小工具會自動於 [Module:ACGaward/list](https://zh.wikipedia.org/wiki/Module:ACGaward/list) 登記分數（但不會自動傳送「頒獎」通知）。
- **歸檔：** 點擊章節標題的「歸檔」連結，確認後歸檔該章節。

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
