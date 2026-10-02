# Documentation conventions

<!-- toc:start -->

## Contents

- [Readers and files](#readers-and-files)
- [Headings and tables of contents](#headings-and-tables-of-contents)
- [Distribution](#distribution)
- [Examples and independence](#examples-and-independence)

<!-- toc:end -->

## Readers and files

Keep `README.md` in English with `README.zh-Hant.md` and `README.zh-Hans.md`
as equivalent user guides. Link the three at the top. Use the same section order: Features,
Installation, How to use, Screenshots, Help, License (translated in localized guides).
Describe how to install, open, use, and remove this tool, including links to its latest GitHub
`.min.js` and `.user.js` artifacts. Keep implementation details in developer documents.

`AGENTS.md` defines contributor rules; `CONTRIBUTING.md` documents setup, development,
verification, UI, documentation, and releases. `docs/architecture.md` defines source ownership.
`docs/ui-guidelines.md` records the required Codex guidance. `docs/screenshots.md` records
capture steps, image inventory, fixture provenance, and attribution. Keep project-specific
workflow guides under `docs/` and release changes in `CHANGELOG.md`.

## Headings and tables of contents

Give each Markdown document one descriptive level-one heading and a linked table of contents
for its sections. Preserve release headings and license wording. Keep local links relative.
Use descriptive kebab-case filenames for new modules and guides.

Authored JavaScript, TypeScript, Vue, CSS, and shell/workflow files use a file header with
`@file`, `Purpose`, and `Table of contents`. List the actual declarations or sections
in source order. Keep headers descriptive; refresh them after moving or changing declarations.
JSON, lockfiles, fixture wikitext, binaries, and verbatim licenses retain their native formats;
the owning guide documents their role instead of adding invalid comments or changing evidence.

## Distribution

Build the compressed MediaWiki `.min.js` and readable Tampermonkey `.user.js` from source.
Both carry a consistent documentation heading with purpose, name, version, license, and contents.
The userscript starts with the `==UserScript==` metadata block. Keep third-party notices intact
and do not bundle a second Vue or Codex runtime. Document artifact names exactly as built.

## Examples and independence

Documentation screenshots use BanG Dream! 少女樂團派對 revision 94028176. Record selected
excerpts and simulated API responses; credit Wikipedia contributors under CC BY-SA 4.0.
Do not present a fixture as a live wiki screenshot. Keep every project independently installable;
its guides describe its own features and do not advertise or require another gadget.
Document neutral editor contracts when necessary for interoperability.
