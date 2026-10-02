# ACGATool

[English](README.md) · [繁體中文](README.zh-Hant.md) · [简体中文](README.zh-Hans.md)

协助中文维基百科“维基ACG专题奖”提名、评分与复核的小工具。原作者为 **[SuperGrey](https://zh.wikipedia.org/wiki/User:SuperGrey)**。

<!-- toc:start -->

## 目录

- [主要功能](#主要功能)
- [安装](#安装)
- [使用方式](#使用方式)
- [画面示例](#画面示例)
- [说明](#说明)
- [许可](#许可)

<!-- toc:end -->

## 主要功能

- 创建多项提名、分组为表格、冻结个别项目，提交前检查整批内容。
- 跨页面与标签页保存草稿，使用 1–4、5、6、7、8 五组互斥规则。
- 批次核对提名，支持撤销与重做，完成后更新登记页与积分榜。
- 参考建议得分者与条目评级，再核对实际贡献记录。

## 安装

安装可阅读的 [Tampermonkey 用户脚本](https://github.com/For-Each-Next/wp-acga-tool/releases/latest/download/acga_tool.user.js)，或将最新 [MediaWiki 小工具](https://github.com/For-Each-Next/wp-acga-tool/releases/latest/download/acga_tool.min.js) 内容粘贴至中文维基百科的 `Special:MyPage/common.js`。选择一种安装方式后重新加载页面；提交使用当前登录的维基账号。[版本列表](https://github.com/For-Each-Next/wp-acga-tool/releases)。

移除工具时，停用 Tampermonkey 中对应的脚本，或从 `common.js` 删除工具代码，再重新加载维基百科。

## 使用方式

打开条目、讨论页、文件页或奖项登记页，在页面工具中选择 **提名至ACG专题奖**。设置得分者与规则，再选择 **预览** 检查整批提名；确认内容后才提交。

**暂存** 将内容保存在浏览器。**取消** 放弃尚未保存的表单修改，保留已明确保存的草稿。批次核对所接受的项目在完成整批前只保留在本机；重试前请阅读部分失败的提示。

## 画面示例

以下离线画面取材自 **BanG Dream! 少女樂團派對** 条目源代码（版本 94028176）；得分者、分数、评级横幅与 API 结果均为示例数据，不代表实际评定。

![提名表单](docs/images/screenshot-01.png)

![整批提名预览](docs/images/screenshot-02.png)

[来源署名与修改说明](THIRD-PARTY-NOTICES.md#documentation-article-fixture).

## 说明

提名、复核、草稿与失败恢复详见[使用说明](docs/usage.md)。界面依维基百科语言设置显示英文、繁体中文或简体中文。

开发信息见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

沿用 [MIT 许可](LICENSE)，保留 Copyright (c) 2025 Quinn Gao 与 SuperGrey 的原作者署名。AI 协助维护不新增版权主张。另见[第三方声明](THIRD-PARTY-NOTICES.md)。
