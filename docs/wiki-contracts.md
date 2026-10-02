# Chinese Wikipedia integration

**UI adapter changes must follow [Codex button types and order](https://doc.wikimedia.org/codex/latest/style-guide/using-links-and-buttons.html#types-and-order-of-buttons):**
one primary progressive action per group; normal secondary and quiet tertiary
actions; neutral cancellation. Place the primary last in reading order for a
flow (right in LTR, left in RTL), align dialog actions to the end, and place it
first when stacked in either direction. Use the 12px spacing token between
separate buttons; use destructive styling only for irreversible operations.

Template and registration contracts were checked against public source and
rendered markup on 2026-09-27. Automated validation uses local fixtures and mocked
APIs. These assumptions guide host adapters and parsers.

## Registration and scoring

- [ACG提名2](https://zh.wikipedia.org/wiki/Template:ACG提名2) accepts article,
  recipient, request and check fields for 25 items. Larger groups split into
  multiple templates in the same page edit; their comments follow the signature.
- [ACG提名2/item](https://zh.wikipedia.org/wiki/Template:ACG提名2/item) renders two
  rows per item. The article cell spans both rows; `.mw-notalk` holds the check
  in the second row. Native integration scopes discovery to the outer table.
- The [registration page](https://zh.wikipedia.org/wiki/WikiProject:ACG/維基ACG專題獎/登記處)
  uses level-three month/day headings. Repeated headings identify distinct physical
  sections. Parsing masks comments and literal examples before matching source to
  rendered item positions.
- Unknown reason syntax stays available for source editing or repair. Batches
  resolve all targets against one source snapshot and reject overlaps or changed
  targets.
- [ACG提名2/check](https://zh.wikipedia.org/wiki/Template:ACG提名2/check) supports
  statuses beyond a new score. Recheck deltas require a recognized saved check;
  other results request manual score reconciliation.

Controls mount on the registration subpage. Rendered yellow target headers
(`#ffffb999`) represent pending checks with batch-selection checkboxes, and pink
headers (`#ffb9ff99`) represent active rechecks. Only the yellow article-cell
background determines whether the controls offer an initial check or a recheck;
result text and source lookup do not change this state. Source lookup still
enforces checking permissions and rejects stale nominations. Archive
eligibility requires a completed check for every item, each strictly older than
seven days; the latest completed result governs age. Unknown dates require manual
review. Fresh source and the expected revision are validated before archive edits.

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

DYK outcomes come only from `DYKEntry/archive` templates with an explicit `+`
or `-` result. Without a finalized result there is no completed DYK record;
`DYK`, `DYKtalk`, `Didyouknow date` and `Article history` templates do not supply
outcomes. Comments and literal examples are masked. `DYK_Invite` and `DYK Invite`
banners provide an independent link to the article's current candidates-page
section. Displayed dates use localized formatting and elapsed UTC calendar days.

## Runtime and interface

MediaWiki supplies Vue and Codex through ResourceLoader. Local language selection
chooses aligned English, Simplified Chinese and Traditional Chinese catalogs.
The [Codex form guidance](https://doc.wikimedia.org/codex/latest/style-guide/constructing-forms.html)
informs labelled fields, related control groups, submission validation and narrow
screen layouts. Article hints provide context; users select scoring explicitly.
