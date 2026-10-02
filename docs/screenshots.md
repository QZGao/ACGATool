# Screenshots

<!-- toc:start -->

## Contents

- [Capture](#capture)
- [Source and simulation](#source-and-simulation)
- [Image inventory](#image-inventory)
- [Test ownership](#test-ownership)

<!-- toc:end -->

## Capture

Run `npm run screenshots` to build and exercise the real interface in Chromium.
Documentation scenarios run only with `DOCUMENTATION_SCREENSHOTS=1` and use a
1024 × 768 CSS-pixel viewport, device scale factor 1, and disabled animations.
The command writes full viewport images to `docs/images/`. Inspect each image for
visible labels, action hierarchy, clipping, and accidental loading states.
Normal verification does not replace documentation images.

## Source and simulation

The pinned article is **BanG Dream! 少女樂團派對**, revision **94028176**.
`tests/fixtures/bang-dream.wikitext` stores its full original source, and
`tests/fixtures/bang-dream.source.json` records the title, revision, source and
history links, and license. See [third-party notices](../THIRD-PARTY-NOTICES.md#documentation-article-fixture)
for attribution and CC BY-SA 4.0 terms.

The nomination screenshots read the pinned article title and display its opening
source behind the dialog. Recipients, scores, and nomination entries are simulated.
The summary shows two illustrative contributions to the same article; it does not
represent an actual award nomination.

All MediaWiki responses and edits are local fixtures. Browser tests reject unexpected
network requests and assert that the screenshot scenario performs no saves.

## Image inventory

| Image               | Captured behavior                                                        |
| ------------------- | ------------------------------------------------------------------------ |
| `screenshot-01.png` | Traditional Chinese nomination form, article title, and scoring choices. |
| `screenshot-02.png` | Nomination summary, recipients, scores, source codes, and final actions. |

## Test ownership

`tests/ui/dialog.spec.ts` owns the opt-in “documentation screenshots” scenario. It
mounts the actual Vue/Codex nomination feature with injected services. Startup
scenarios separately exercise the browser host and built gadget. All three user
READMEs share these images. `scripts/test-ui.ts` removes temporary Playwright
reports when it exits.
