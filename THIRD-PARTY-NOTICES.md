# Attribution and third-party notices

<!-- toc:start -->

## Contents

- [ACGATool](#acgatool)
- [Runtime components](#runtime-components)
- [Documentation article fixture](#documentation-article-fixture)

<!-- toc:end -->

## ACGATool

**Quinn Gao (a.k.a. SuperGrey)** is credited as the original author of ACGATool. The original gadget
is documented at [User:SuperGrey/gadgets/ACGATool](https://zh.wikipedia.org/wiki/User:SuperGrey/gadgets/ACGATool).
This repository retains the source project's MIT license and its original notice:

> Copyright (c) 2025 Quinn Gao

The complete MIT terms appear in [LICENSE](LICENSE) and are embedded in all
generated installation files. The repository maintainer makes no additional
copyright claim for the AI-assisted edits in this rebuild. That statement does
not remove or replace the original author's notice or any third-party terms.

## Runtime components

[Vue](https://github.com/vuejs/core) and [Wikimedia Codex](https://gerrit.wikimedia.org/g/design/codex/)
retain their respective MIT licenses. The deployed gadget requests these runtimes
from MediaWiki ResourceLoader; it does not include a second copy. npm versions
are locked for development types and offline browser fixtures. HanAssist and
jQuery are not bundled.

Development tools retain their own licenses in their installed packages.
Article text and other Wikimedia content are not relicensed by this repository.

## Documentation article fixture

The offline documentation fixtures use [BanG Dream! 少女樂團派對, revision 94028176](https://zh.wikipedia.org/w/index.php?title=BanG%20Dream!%20%E5%B0%91%E5%A5%B3%E6%A8%82%E5%9C%98%E6%B4%BE%E5%B0%8D&oldid=94028176) by the [Wikipedia contributors](https://zh.wikipedia.org/w/index.php?title=BanG%20Dream!%20%E5%B0%91%E5%A5%B3%E6%A8%82%E5%9C%98%E6%B4%BE%E5%B0%8D&action=history), under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The pinned article code is in `tests/fixtures/bang-dream.wikitext`; provenance is in the adjacent `bang-dream.source.json`.

Screenshots display selected article-code excerpts or a simplified text rendering of its opening paragraph. Images, references, and templates are omitted from the simplified rendering. Nomination recipients, scores, talk-page banners, category membership, and API responses are simulated examples. They do not describe a live nomination or assessment. No live wiki edits are performed.
