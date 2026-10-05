# Architecture

<!-- toc:start -->

## Contents

- [Scope](#scope)
- [Folder names and ownership](#folder-names-and-ownership)
- [Dependencies and startup](#dependencies-and-startup)
- [Nomination state](#nomination-state)
- [Checks and wiki writes](#checks-and-wiki-writes)
- [Host, lifecycle and build](#host-lifecycle-and-build)

<!-- toc:end -->

## Scope

ACGATool separates deterministic nomination rules from browser state and wiki
effects. [Usage](usage.md) describes workflows; [wiki contracts](wiki-contracts.md)
describe the page formats and host assumptions.

## Folder names and ownership

| Path                                     | Responsibility                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `src/app/`                               | Startup, composition, service contracts, and nomination orchestration. |
| `src/domain/`                            | Nomination models, scoring, parsing, and wikitext transformations.     |
| `src/platform/`                          | MediaWiki APIs, page context, runtime adapters, and browser storage.   |
| `src/features/nomination/`               | Forms, dialog lifecycle, drafts, templates, and layout.                |
| `src/features/registry/`                 | Registration controls and native page integration.                     |
| `src/shared/`, `src/i18n/`, `src/types/` | Independent utilities, translations, and host declarations.            |
| `tests/`, `scripts/`                     | Offline fixtures and verification; TypeScript build and release tools. |
| `dist/`                                  | Generated installation artifacts.                                      |

## Dependencies and startup

Use lowercase kebab-case filenames and deliberate public exports. `src/index.ts`
is side-effect free; `src/app/browser.ts` starts the browser application. Domain
rules operate on supplied values. The composition root injects APIs, storage and
host capabilities into services and UI.

The host adapter requests current MediaWiki formatversion 2 responses with the main
revision slot. Obsolete keyed page maps and star-key content are rejected before editing.
Page-tool entries use `mw.util.addPortletLink` and retain the skin-owned anchors and
markup. Codex applies to gadget dialogs and forms. See [UI guidelines](ui-guidelines.md)
for the required interface contract.

Unit and service scenarios use `*.test.ts`; browser scenarios use `*.spec.ts`.
Feature-owned templates and styles live beside their TypeScript module:
`features/nomination/dialog.ts`, `dialog.vue` and `dialog.css`. Vue files contain
markup only. Codex Message owns dialog feedback; Codex Field owns labelled input
and validation. Avoid introducing generic helpers for feature-specific behavior.

## Nomination state

Each nomination belongs to one of five exclusive categories: 1–4, 5, 6, 7, or 8.
Forms, checking and reason rebuilding use the same boundaries. Review scoring
uses general (`5`), specialist (`5a`/`5b`/`5c`), or comprehensive (`5x`) mode;
the active rows determine emitted codes and scores.

A dialog owns its editable batch, table comments, selected item and pending
lookups. Validation resolves blank fields through their contextual defaults and
requires positive selected scores. The same validation governs summary review,
preview, explicit draft saving and submission. Frozen items retain their drafts
and are omitted from preview and submission.

Summary rows and submission payloads derive from the editable tables. Submission
validates first and copies the included payloads before starting any wiki request.

An injected store persists one versioned nomination batch per user and origin.
Stable table and item IDs let the dialog merge local changes with later saves,
including edits and deletions. Browser notifications refresh open sessions while
preserving unfinished inputs, reordered items and navigation. Synchronization waits during
a tab drag, summary-row edit or wiki submission; a changed reviewed batch returns to its
updated summary and invalidates its parsed preview.

Successful submission removes only included items whose stored versions still
match the submitted snapshot. Frozen items and newer saves survive. Cancel
discards the current unsaved changes while retaining the last explicit snapshot;
failed submission retains that snapshot for recovery.

## Checks and wiki writes

Checking drafts remain local until batch completion. Each source nomination has
a stable identity; accepting replaces its staged result, editing invalidates it,
and skipping removes it. Item forms, comments and undo/redo histories survive
navigation. Cancel discards staged results; Quit submits accepted results.

Services resolve and validate the entire batch against a current source snapshot
before preparing one registration-page edit and one score-list edit. Rechecks
apply the difference from the previous recognized score. The service also
enforces submitter/recipient checking restrictions and archive eligibility.

MediaWiki's two page edits are sequential. A registration write followed by a
score-list failure is a partial success, and the dialog reports the committed
page and required recovery. A pre-commit failure leaves the draft open; a
committed registration closes the checking session to prevent duplicate scoring.

## Host, lifecycle and build

Production obtains Vue and Codex from MediaWiki ResourceLoader. Feature components
own TypeScript logic, Vue templates and CSS. Typed message catalogs provide
English, Simplified Chinese and Traditional Chinese text with named placeholders.

Wiki content enters the UI as text or through DOM APIs. Parsed batch previews use
a sandboxed iframe. Closing dialogs releases hosts, applications and listeners;
session and request identities discard obsolete responses. Successful display
lookups and in-flight requests are cached within a dialog session, with failures
available for retry.

The compact gadget minifies CSS and Vue template whitespace and expressions,
and shortens internal message IDs across code, templates and catalogs. Source
catalogs and the readable userscript retain descriptive IDs. The build rejects
bundled package runtimes, validates both installation formats, and embeds
SuperGrey's credit and the full MIT notice.

Production runtimes stay with ResourceLoader; locked npm packages supply
development types, tooling and offline fixtures. `npm run verify` combines
formatting, lint, type and unused-code checks with unit and Chromium tests.
CI and releases use the same pipeline.

`npm run screenshots` exercises the same offline browser fixture with a fixed
1024 × 768 viewport and device scale factor 1. Its opt-in scenario writes the two
README images to `docs/images/`; normal tests leave documentation images alone.
