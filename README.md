# ACGATool

[English](README.md) · [繁體中文](README.zh-Hant.md) · [简体中文](README.zh-Hans.md)

Nominate and review contributions for the Chinese Wikipedia ACG WikiProject award. Original tool by **Quinn Gao (a.k.a. [SuperGrey](https://zh.wikipedia.org/wiki/User:SuperGrey))**.

<!-- toc:start -->

## Contents

- [Features](#features)
- [Installation](#installation)
- [How to use](#how-to-use)
- [Screenshots](#screenshots)
- [Help](#help)
- [License](#license)

<!-- toc:end -->

## Features

- Prepare multiple nominations, organize them into tables, freeze items, and review the batch before submitting.
- Save drafts across pages and browser tabs; select from the five exclusive rule groups: 1–4, 5, 6, 7, and 8.
- Check nominations in batches, with undo/redo and a final registration-page and score-list update.
- Use suggested recipients and article assessment information while checking the actual contribution history.

## Installation

Install the readable [Tampermonkey userscript](https://github.com/For-Each-Next/wp-acga-tool/releases/latest/download/acga_tool.user.js), or copy the latest [MediaWiki gadget](https://github.com/For-Each-Next/wp-acga-tool/releases/latest/download/acga_tool.min.js) into your Chinese Wikipedia `Special:MyPage/common.js`. Choose one installation method, then reload Wikipedia. Submissions use your logged-in wiki account. [All releases](https://github.com/For-Each-Next/wp-acga-tool/releases).

To remove the tool, disable its Tampermonkey entry or remove its code from `common.js`, then reload Wikipedia.

## How to use

Open an article, its talk page, a file page, or the award registration page and choose **Nominate to ACGA** from the page tools. Select a recipient and scoring rules, then choose **Preview** to review the complete nomination. Submit only after checking the proposed entries.

On the award registration page, select pending nominations to check them in a batch, or recheck an existing result to adjust its score. **Add to batch** is grey when unavailable. Fresh checks select all scoring rows by default; rechecks preserve the saved selections. Review the rows before accepting a result.

During batch checking, the horizontal controls are **Cancel → Previous → Check later → Next / Save all**. **Next** accepts and stages the current result; **Check later** leaves that nomination unchecked. Completing the batch with **Save all**, or deferring the last pending item, submits the accepted results. **Cancel** discards the entire staged check batch. Read partial-failure messages before retrying.

For nominations, **Save draft** stores your work locally. **Cancel** discards unsaved form changes while retaining explicitly saved drafts.

## Screenshots

Offline examples based on the article source of **BanG Dream! 少女樂團派對** (revision 94028176). Recipients, scores, banners, and API results are simulated; screenshots do not claim a live assessment.

![Nomination form](docs/images/screenshot-01.png)

_Choose scoring rules for a nomination._

![Nomination batch review](docs/images/screenshot-02.png)

_Review nominees, scores, and the complete batch before submitting._

[Source attribution and modifications](THIRD-PARTY-NOTICES.md#documentation-article-fixture).

## Help

See the [usage guide](docs/usage.md) for nominations, reviews, drafts, and recovery. The interface follows your Wikipedia language: English, Traditional Chinese, or Simplified Chinese.

Contributor information is in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

The [MIT license](LICENSE) preserves the original copyright notice and credit for Quinn Gao (a.k.a. SuperGrey). AI-assisted maintenance makes no additional copyright claim. See [third-party notices](THIRD-PARTY-NOTICES.md).
