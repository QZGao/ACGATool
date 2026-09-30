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
New nominations start with one template group. Framed outer table tabs and an
add-table button are always visible, with unframed nomination-item tabs inside
each table. Navigation retains each group's drafts and active nomination. Each
table is submitted as its own group; removing its last item removes that empty
group, while the batch must retain at least one nomination. Adding an item or
table first validates the active nomination;
blank values resolve through their context defaults, and selected scores must
total more than zero. All groups pass validation before opening the batch summary. The summary
shows validated recipients, targets, scores, and detail codes. Editing a summary
row uses a separate local draft; accepting that edit updates the reviewed row.
Summary rows can be frozen without deleting their drafts. Frozen rows remain
visible with no number, while included rows are numbered continuously. Preview
and submission omit frozen rows and empty groups, retaining each included
group's comment. Freezing every row disables preview and submission until a row
is restored. Frozen state survives item edits and switching tabs.
Each group's optional comment is entered in its summary-table footer and saved below its
nominator signature, outside the nomination tables. A group exceeding the
template's 25-item limit is automatically split while retaining its comment.
Preview parses the same batch source through the injected MediaWiki API without
editing a page. Parser output is shown in a sandboxed iframe with scripts and
forms disabled; closing the preview invalidates pending responses.
Batch checking stages each accepted result locally for the current session.
One batch dialog groups entries by their physical registration template, with
outer table tabs and inner item tabs. Navigation retains each item's form,
selection, repair draft, reset origins, and undo/redo history. Row and table
resets are undoable; the table footer's checker comment shares that history.
Changing an accepted result removes its staged version until it is accepted
again. Staging replaces entries by stable source identity, so cloned targets and
revisits cannot duplicate scoring. Skip removes any staged result for that item.
Cancel discards the whole batch; Quit submits only accepted results. Completion
keeps the dialog open after a pre-commit failure and closes after a registration
write, including a reported score-list partial failure, to prevent duplicate edits.
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
current user. File pages and MediaViewer previews start in category 6 and suggest
the latest uploader, including files held on Commons. Permalink and diff views
suggest the displayed revision's editor for every category except category 7,
which uses the tool's current user. Pending lookups display an ellipsis; that
display text is never saved as a recipient. Explicit input takes priority, and a
blank field resolves to its context default in validation, previews, summaries,
and saving. Late responses cannot change reviewed or closed drafts.

Forms for categories 1–4, 5, and 6 look up existing nominations in the active
registration source. A possible duplicate notice links to the matching date
section only when both the target page and score recipient match, excluding the
row being edited or checked. Categories 7 and 8 do not show these notices.
Matching normalizes page and recipient spelling, including spaces and namespace
aliases, without treating two requests as proof that the same work is awarded.
Lookup errors remain visible in the supported categories, and obsolete responses
are discarded.
Registry checks compare the current user with the nomination's signed submitter
and score recipient. Either match disables the check button and batch selection,
with a tooltip explaining the reason. The service enforces the same restriction
when opening and saving checks; batch progress counts eligible entries only.
Checked entries use a recheck action and distinct edit summaries. Rechecks load
the saved scoring rows, selections and comment while retaining the original
request; unsupported saved results use the source editor. A recheck
adjusts the score list by the difference from its previous saved result,
including a negative difference when the accepted score decreases.

Score checking reads the target's talk page only when the ACGA nomination requests
the DYK scoring item. The check summary adds a DYK status row showing the latest
archived nomination's main author, closing date, and `result` outcome (`+` for
passed, `-` for not passed). Finalized `DYKEntry/archive` outcomes take precedence
over older appearance banners. Without archive outcomes, the parser recognizes
the documented [DYKtalk banner](https://zh.wikipedia.org/wiki/Template:DYKtalk/doc)
and [Article history DYK dates](https://zh.wikipedia.org/wiki/Template:Article_history/doc).
Comments and literal wikitext examples are ignored. A missing record and a failed
lookup have distinct messages; the talk-page link supports manual checking, and
the result does not change the score selection.
An actual `DYK_Invite` or `DYK Invite` banner also shows a current-nomination tag,
independent of any earlier archived outcome or appearance record.

Edit summaries fit within 255 UTF-8 bytes, including the tool credit. Nomination
summaries try linked recipients, targets, scoring codes and scores first, then
omit codes, omit targets and group item scores by recipient, remove recipient
links, and collapse score sums. If recipient totals still do not fit, the summary
uses the batch total, then recipient and item counts. Other edit summaries remove
links before shortening text without splitting Unicode characters.

Formatting, linting, type checking, unused-code checks, unit tests, and offline
browser tests make up `npm run verify`. CI and releases use that same pipeline.
