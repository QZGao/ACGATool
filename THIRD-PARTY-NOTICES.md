# Attribution and third-party notices

## ACGATool

**SuperGrey** is credited as the original author of ACGATool. The original gadget
is documented at [User:SuperGrey/gadgets/ACGATool](https://zh.wikipedia.org/wiki/User:SuperGrey/gadgets/ACGATool).
This repository retains the source project's MIT license and its original notice:

> Copyright (c) 2025 Quinn Gao

The complete MIT terms appear in [LICENSE](LICENSE) and are embedded in all
generated installation files. The repository maintainer makes no additional
copyright claim for the AI-assisted edits in this rebuild. That statement does
not remove or replace the original author's notice or any third-party terms.

## wikEd Lite

Project structure, build conventions, and verification practices follow
[wikEd Lite](https://github.com/For-Each-Next/wp-wiked-lite). Its project-owned
material is dedicated under CC0 1.0. This reference does not change the MIT terms
of the ACGATool source preserved here.

## Runtime components

[Vue](https://github.com/vuejs/core) and [Wikimedia Codex](https://gerrit.wikimedia.org/g/design/codex/)
retain their respective MIT licenses. The deployed gadget requests these runtimes
from MediaWiki ResourceLoader; it does not include a second copy. npm versions
are locked for development types and offline browser fixtures. HanAssist and
jQuery are not bundled.

Development tools retain their own licenses in their installed packages.
Article text and other Wikimedia content are not relicensed by this repository.
