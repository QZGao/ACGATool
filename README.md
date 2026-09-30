# ACGATool

協助中文維基百科「維基ACG專題獎」提名、評分與覆核的小工具。
原作歸功於 **[SuperGrey][1]**，以他的 [ACGATool][2] 為基礎，
採用 TypeScript 分層結構與 MediaWiki Codex 介面，保留原有 Git 歷史。

## 2.0 主要功能

- 多表格提名、逐項編輯、凍結與整批預覽，支援 1–4、5、6、7、8 五組規則。
- 瀏覽器暫存跨頁累積提名，自動同步其他分頁的草稿。
- 批次核對與單項複核，支援復原、重做，完成後一次更新登記頁與積分榜。
- 一般、專項及綜合評審模式，可自行調整理由與分數。
- 依條目、檔案及版本頁建議得分者，顯示已有提名、頁面評級與 DYK 資訊。
- 使用 MediaWiki 提供的 Vue、Codex 元件，支援英文、繁體中文與簡體中文介面。

## 安裝與使用

從 [最新版本][3] 下載 `acga_tool.min.js`，將內容貼入
`Special:MyPage/common.js` 或加入站點小工具。
Tampermonkey 使用者可安裝 `acga_tool.user.js`。

在登記頁、條目、討論頁或檔案頁，使用工具側欄的
**提名至ACG專題獎** 入口。提交會以目前登入的維基帳號編輯頁面。
操作詳見[使用說明](docs/usage.md)。

## 開發

使用 Node.js 24.14.1 以上版本：

```sh
npm ci
npx playwright install chromium
npm run verify
```

`npm run build` 會產生 `dist/` 中的安裝檔案。
開發與驗證流程見 [CONTRIBUTING.md](CONTRIBUTING.md)，
模組分工見[架構說明](docs/architecture.md)。

## 授權

沿用 [MIT 授權](LICENSE)，保留 `Copyright (c) 2025 Quinn Gao`。
**SuperGrey 是 ACGATool 的原作者與主要署名者**；AI 協助維護沿用原署名及授權，
維護者不就這些修改主張額外著作權。
第三方資訊見[第三方聲明](THIRD-PARTY-NOTICES.md)。

[1]: https://zh.wikipedia.org/wiki/User:SuperGrey
[2]: https://zh.wikipedia.org/wiki/User:SuperGrey/gadgets/ACGATool
[3]: https://github.com/For-Each-Next/wp-acga-tool/releases/latest
