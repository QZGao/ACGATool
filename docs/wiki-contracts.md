# Chinese Wikipedia integration

Template and registration contracts were checked against public source and
rendered markup on 2026-10-09. Automated validation uses local fixtures and mocked
APIs. These assumptions guide host adapters and parsers.

<!-- toc:start -->

## Contents

- [Registration and scoring](#registration-and-scoring)
- [Article and file context](#article-and-file-context)
- [Runtime and interface](#runtime-and-interface)

<!-- toc:end -->

## Registration and scoring

- [ACG提名2](https://zh.wikipedia.org/wiki/Template:ACG提名2) accepts article,
  recipient, request and check fields for 25 items. Larger groups split into
  multiple templates in the same page edit; their comments follow the signature.
- [Module:ACG提名2](https://zh.wikipedia.org/wiki/Module:ACG提名2) renders
  `.acgnom-entry` and `.acgnom-check-row` rows for each item. Both carry
  `data-acgnom-index` and `data-acgnom-status`, with matching `itemN` and
  `pending`, `done` or `rechecking` classes. Pair rows by item number within
  their own table, including when other rows intervene.
- Dedicated `.acgnom-title-cell`, `.acgnom-user-cell`, `.acgnom-reason-cell`
  and `.acgnom-check-cell` cells identify the article, recipient, request and
  result; `.acgnom-check` contains the result and its controls. Nested tables
  must not contribute nominations to the outer table.
- The [registration page](https://zh.wikipedia.org/wiki/WikiProject:ACG/維基ACG專題獎/登記處)
  uses level-three month/day headings. Repeated headings identify distinct physical
  sections. Parsing masks comments and literal examples before matching source to
  rendered items. Template position and the explicit item number identify the
  corresponding numbered source fields, even when numbers are sparse or source
  parameters appear in a different order. Match field names exactly; whitespace
  before the numeric suffix does not form an alias for a valid field.
- Unknown reason syntax stays available for source editing or repair. Batches
  resolve and deduplicate targets against one source snapshot, then reject
  overlapping edits, changed targets or missing editable fields before writing.
- An empty `核對用N` field, comments alone, or `{{ACG提名2/check|ver=1|}}`
  represents an unreviewed nomination. These open with every scoring row selected.
  An explicit `|0` result or rejected `no=` rows are saved decisions and retain
  their selection state when reopened for rechecking.
- [Module:ACGaward/nominee check new](https://zh.wikipedia.org/wiki/Module:ACGaward/nominee_check_new) supports
  statuses beyond a new score. Saved scores are parsed from source rather than
  rendered result text or recipient totals. Recheck deltas require a recognized
  saved check, including `status=rechecking`; unknown or rescinded results
  request manual score reconciliation.

Controls mount on the registration subpage. Semantic row status determines the
action: `pending` offers an initial check and a batch-selection checkbox, while
`done` and `rechecking` offer a recheck. Stylesheet colors and rendered result text
do not determine this state. Legacy tables without semantic nomination markers
retain the inline yellow article-cell fallback (`#ffffb999`) for pending checks.
Source lookup enforces checking permissions and rejects stale nominations. Checks
are staged locally, then submitted with one registration-page edit and one
score-list edit per completed batch. Rechecks apply only the difference from the
saved score, with partial-failure recovery preventing duplicate scoring.

Archive eligibility requires a completed check for every item, each strictly
older than seven days; the latest completed result governs age. Unknown dates
require manual review. Fresh source and the expected revision are validated before
archive edits.

Edit summaries fit within 255 UTF-8 bytes including the tool credit. Nomination
summaries progressively reduce item details, links and score expressions before
falling back to batch totals or counts. Shortening preserves Unicode characters.

## Article and file context

The contributor suggestion reads the past year's revision history, including
continuation pages and parent sizes, and ranks cumulative positive byte additions.
File pages and MediaViewer previews use the latest uploader, including Commons
files. Permalink and diff views use the displayed revision's editor, with category
7 retaining the current user. Explicit inputs take priority over suggestions.

Page assessments use `prop=pageassessments`, following redirects and continuation.
Projects group by descending quality; ACG, animation, comics and video games take
priority within a group, and slash-named taskforces are filtered out.

DYK outcomes come only from explicit results in
[`DYKEntry/archive`](https://zh.wikipedia.org/wiki/Template:DYKEntry/archive):
`+` and `^` mean passed; `-` and `!` mean failed. Without a recognized result
there is no completed DYK record. The closing date comes from `closets` or the
positional closing timestamp after the result and archive hash; nomination
timestamps and banner dates do not supply that date. `DYK`, `DYKtalk`,
`Didyouknow date`, `Article history` and vote counts do not supply outcomes.
Comments and literal examples are masked. `DYK_Invite` and `DYK Invite` banners
provide an independent link to the article's current candidates-page section.
Displayed dates use localized formatting and elapsed UTC calendar days.

## Runtime and interface

Follow [UI guidelines](ui-guidelines.md) for adapter controls. MediaWiki supplies
Vue and Codex through ResourceLoader. Local language selection
chooses aligned English, Simplified Chinese and Traditional Chinese catalogs.
The [Codex form guidance](https://doc.wikimedia.org/codex/latest/style-guide/constructing-forms.html)
informs labelled fields, related control groups, submission validation and narrow
screen layouts. Article hints provide context; users must verify the selected
scoring rows before submitting.
