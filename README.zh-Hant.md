# ACGATool

[English](README.md) · [繁體中文](README.zh-Hant.md) · [简体中文](README.zh-Hans.md)

協助中文維基百科「維基ACG專題獎」提名、評分與覆核的小工具。原作者為 **Quinn Gao（又名 [SuperGrey](https://zh.wikipedia.org/wiki/User:SuperGrey)）**。

<!-- toc:start -->

## 目錄

- [主要功能](#主要功能)
- [安裝](#安裝)
- [使用方式](#使用方式)
- [畫面範例](#畫面範例)
- [說明](#說明)
- [授權](#授權)

<!-- toc:end -->

## 主要功能

- 建立多項提名、分組為表格、凍結個別項目，提交前檢查整批內容。
- 跨頁面與分頁儲存草稿，使用 1–4、5、6、7、8 五組互斥規則。
- 批次核對提名，支援復原與重做，完成後更新登記頁與積分榜。
- 參考建議得分者與條目評級，再核對實際貢獻紀錄。

## 安裝

安裝可閱讀的 [Tampermonkey 使用者腳本](https://github.com/For-Each-Next/wp-acga-tool/releases/latest/download/acga_tool.user.js)，或將最新 [MediaWiki 小工具](https://github.com/For-Each-Next/wp-acga-tool/releases/latest/download/acga_tool.min.js) 內容貼入中文維基百科的 `Special:MyPage/common.js`。選擇一種安裝方式後重新載入頁面；提交使用目前登入的維基帳號。[版本列表](https://github.com/For-Each-Next/wp-acga-tool/releases)。

移除工具時，停用 Tampermonkey 中對應的腳本，或從 `common.js` 刪除工具程式碼，再重新載入維基百科。

## 使用方式

開啟條目、討論頁、檔案頁或獎項登記頁，在頁面工具中選擇 **提名至ACG專題獎**。設定得分者與規則，再選擇 **預覽** 檢查整批提名；確認內容後才提交。

在獎項登記頁，選取待核對的提名進行批次核對，或覆核既有結果以調整分數。**加入批量核對** 不可用時顯示為灰色。首次核對預設勾選所有得分列；覆核保留已儲存的勾選結果。接受結果前請檢查各列。

批次核對的橫排按鈕依序為 **取消 → 上一項 → 暫不核對 → 下一項 / 儲存全部**。**下一項** 接受並暫存目前結果；**暫不核對** 使該提名保持未核對狀態。按 **儲存全部** 完成整批，或暫不核對最後一項待核對提名時，會提交已接受的結果。**取消** 捨棄整批暫存的核對結果。重試前請閱讀部分失敗的提示。

提名時，**暫存** 將內容保存在瀏覽器。**取消** 放棄尚未儲存的表單修改，保留已明確儲存的草稿。

## 畫面範例

以下離線畫面取材自 **BanG Dream! 少女樂團派對** 條目原始碼（版本 94028176）；得分者、分數、評級橫幅與 API 結果均為示範資料，不代表實際評定。

![提名表單](docs/images/screenshot-01.png)

_為提名選擇得分規則。_

![整批提名預覽](docs/images/screenshot-02.png)

_提交前檢查獲提名者、分數與整批內容。_

[來源署名與修改說明](THIRD-PARTY-NOTICES.md#documentation-article-fixture).

## 說明

提名、覆核、草稿與失敗復原詳見[使用說明](docs/usage.md)。介面依維基百科語言設定顯示英文、繁體中文或簡體中文。

開發資訊見 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 授權

沿用 [MIT 授權](LICENSE)，保留原作者 Quinn Gao（又名 SuperGrey）的著作權聲明與署名。AI 協助維護不新增著作權主張。另見[第三方聲明](THIRD-PARTY-NOTICES.md)。
