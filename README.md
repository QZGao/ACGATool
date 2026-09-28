# ACGATool

協助中文維基百科「維基ACG專題獎」提名、評分與覆核的小工具。

ACGATool 原作歸功於 **[SuperGrey][1]**。本倉庫以他的
[ACGATool][2] 功能為基礎，採用 wikEd Lite 的 TypeScript 分層結構、
Codex 介面與開發流程。`wp-acga-tool` 是本次整理的主要倉庫，保留原有 Git 歷史。

本次修改由 AI 協助完成；倉庫維護者不就這些修改主張額外著作權。
原作者的署名、著作權聲明與 MIT 授權條款繼續保留。

## 功能

- 在專題獎主頁及登記頁開啟提名對話框，填寫作者與各項得分理由。
- 在條目及其討論頁使用提名入口，自動帶入對應的條目名稱。
- 在登記頁面加入、編輯提名，核對分數並歸檔已完成的段落。
- 計算內容擴充、品質、評選及專題活動等獎勵分數。
- 將規則分成 1–4、5、6、7、8 五組，每項提名只選一組。
- 批次核對的結果先暫存；完成整批後，將登記頁與積分榜各寫入一次。
  取消核對會放棄整批尚未提交的結果。
- 使用 MediaWiki 提供的 Vue、Codex 元件，以及英文、繁體中文和簡體中文介面。

## 使用方式

從 [最新版本][3] 下載 `acga_tool.min.js`，將內容貼入
`Special:MyPage/common.js` 或加入站點小工具。
Tampermonkey 使用者可安裝 `acga_tool.user.js`。

小工具主要為中文維基百科設計。實際提交會以目前登入的維基帳號編輯頁面；
提交結果及錯誤會在介面中顯示。詳見[操作說明](docs/usage.md)。

## 開發

使用 Node.js 24.14.1 以上版本：

```sh
npm ci
npx playwright install chromium
npm run verify
```

`npm run build` 會產生 `dist/` 中的安裝檔案。
原始碼、測試與建置程式使用 TypeScript；測試採用本地資料與模擬 API，
不會修改線上維基。更多內容見 [CONTRIBUTING.md](CONTRIBUTING.md)
及[架構說明](docs/architecture.md)。

## 授權

沿用 [MIT 授權](LICENSE)，保留 `Copyright (c) 2025 Quinn Gao`。
**SuperGrey 是 ACGATool 的原作者與主要署名者**；本次 AI 協助修改不新增
維護者的著作權聲明，也不改變上游或第三方的權利。
第三方元件及參考專案資訊見[第三方聲明](THIRD-PARTY-NOTICES.md)。

[1]: https://zh.wikipedia.org/wiki/User:SuperGrey
[2]: https://zh.wikipedia.org/wiki/User:SuperGrey/gadgets/ACGATool
[3]: https://github.com/For-Each-Next/wp-acga-tool/releases/latest
