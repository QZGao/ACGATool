# Architecture

ACGATool follows wikEd Lite's module ownership and verification conventions while
retaining SuperGrey's nomination, scoring, and wikitext behavior.

| Path                       | Responsibility                                                                   |
| -------------------------- | -------------------------------------------------------------------------------- |
| `src/app/`                 | Browser startup, composition, service contracts, and nomination orchestration.   |
| `src/domain/`              | Nomination models, deterministic scoring, parsing, and wikitext transformations. |
| `src/platform/mediawiki/`  | Page context, API requests, and ResourceLoader contracts.                        |
| `src/features/nomination/` | Nomination form, draft state, Codex dialogs, templates, and layout.              |
| `src/features/registry/`   | Registration-page controls and integration with native page content.             |
| `src/shared/`              | Small independent capabilities.                                                  |
| `src/i18n/`                | Interface translations and language selection.                                   |
| `src/types/`               | MediaWiki, build, and imported text-asset declarations.                          |
| `tests/`                   | Offline unit and service tests; browser scenarios are under `tests/ui/`.         |
| `scripts/`                 | TypeScript build, test, and release tools.                                       |
| `dist/`                    | Generated installation artifacts, excluded from Git.                             |

Use lowercase kebab-case names. Reserve `index.ts` for deliberate public exports.
`src/index.ts` is side-effect free; the actual browser entry is
`src/app/browser.ts`. Domain rules do not read `window`, `document`, `mw`, storage,
or the network. The composition root wires concrete host operations into services
and UI, so the same rules and workflows can run against local test fixtures.

## Submission and state

The nomination dialog owns its draft and author/reason edits. Nomination
rules use five exclusive categories: 1–4, 5, 6, 7, and 8. One nomination belongs
to one category; forms, checking, and reason rebuilding share these boundaries.
Review nominations have exclusive general (`5`), specialist (`5a`/`5b`/`5c`),
and comprehensive (`5x`) modes. The tier preset only fills row controls; emitted
codes and scores come from the active mode's rows. Each row retains its own tier,
custom description, and editable score when modes change. General and specialist
rows also support quick reviews; comprehensive rows have no quick-review control.
Existing comprehensive custom totals remain editable without dividing them across
the specialist rows.
New nominations start with one template group. The split/merge button toggles the
table presentation without creating a new group. Split mode uses framed outer
table tabs with an add-table button and unframed inner nomination-item tabs;
navigation retains each group's drafts and active nomination. Merged mode shows
one continuously numbered item list and submits one combined group. Original
group assignments remain in the draft so splitting again restores them. Items
added while merged belong to the final group; removing its last item removes
that empty group. Adding an item or table first validates the active nomination;
blank values resolve through their context defaults, and selected scores must
total more than zero. All groups pass validation before opening the batch summary. The summary
shows validated recipients, targets, scores, and detail codes. Editing a summary
row uses a separate local draft; accepting that edit updates the reviewed row.
Summary rows can be frozen without deleting their drafts. Frozen rows remain
visible with no number, while included rows are numbered continuously. Preview
and submission omit frozen rows and empty groups, retaining each included
group's comment. Freezing every row disables preview and submission until a row
is restored. Frozen state survives item edits and table layout changes.
Each group's optional comment is entered in its summary-table footer and saved below its
nominator signature, outside the nomination tables. Merged mode keeps its own
comment, initially combining existing group comments; editing it preserves the
original group comments for a later split. A group exceeding the
template's 25-item limit is automatically split while retaining its comment.
Preview parses the same batch source through the injected MediaWiki API without
editing a page. Parser output is shown in a sandboxed iframe with scripts and
forms disabled; closing the preview invalidates pending responses.
Batch checking stages each accepted result locally for the current session.
Editing a draft must not write a wiki page. Completing the batch prepares the
final registration text and score text, then performs one edit of each affected
page. Cancelling discards the unsubmitted batch. Service logic validates and prepares a batch before
issuing edits, reports failures, and protects existing page content.

MediaWiki does not expose an atomic transaction covering two pages. The UI must
therefore report a partial failure accurately, preserve enough state to recover,
and avoid claiming that both pages were saved when only the first edit succeeded.

## Interface and build

The feature owns its `.ts` component logic, `.vue` template text, and scoped CSS.
The host wiki supplies Vue and Codex using ResourceLoader. A typed `msg(key, values)`
capability selects matching English, Simplified Chinese, and Traditional Chinese
JSON catalogs. Named placeholders carry dynamic values; translation keys are
independent of displayed prose. Templates interpolate
untrusted source as text; native integration uses DOM APIs. HanAssist is not
downloaded or bundled; local language selection keeps tests and builds offline.

The build uses esbuild and Terser, embeds imported CSS and Vue text, checks that no
package runtime slipped into the production bundle, and parses the complete
deliverables before replacing `dist/`. Both installation formats embed the full
MIT notice and credit SuperGrey. The userscript waits briefly for the MediaWiki
runtime, then starts the same application entry.

Article-context nominations can suggest a recipient from the year of revision
history leading up to the lookup. The platform reads every history page and the parent
revision sizes; the domain ranks editors by cumulative positive byte additions.
New drafts show recipient and contextual page defaults as placeholders. Article-creation drafts for
the sidebar's article use the suggested contributor; other categories use the
current user. Explicit input takes priority, and a blank field resolves to its
placeholder consistently in validation, source previews, summaries, and saving.
Late history responses cannot change reviewed or closed drafts.

Formatting, linting, type checking, unused-code checks, unit tests, and offline
browser tests make up `npm run verify`. CI and releases use that same pipeline.
