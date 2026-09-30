# Changelog

## Unreleased

- Add undo and redo to checking tables, use quiet destructive reset controls and
  row reset/trash icons, and move the optional checker comment into the footer.
- Navigate batch checks with table and item tabs while retaining each draft and
  its history; support previous, skip, next, cancel, and quitting with completed
  checks, with one final registration and score-list update.
- Label checked nominations as rechecks, apply score reductions as deltas, and
  identify rechecks in edit summaries. Center nomination editing on its own line
  while keeping check and recheck actions inline.
- Always show nomination table tabs and the add-table control, removing the
  split/merge button while preserving each table's drafts and comments.
- Use Codex buttons for registry checking and editing, with pressed toggle buttons
  for batch selection; switch row actions to batch checking when any item is selected.
- Remove the registry page toolbar in favor of the sidebar nomination link,
  rename its Chinese label to 提名至ACG专题奖, and shorten self-check restriction messages.
- Clarify the preliminary review tier and shorten its choices; remove the Commons
  upload guidance and use small grey text for scoring notices.
- Show possible duplicate notices only for categories 1–4, 5, and 6 when both
  the target and score recipient match an existing nomination.
- Show the format scoring prerequisite only as a tooltip when its checkbox is
  unavailable, removing the persistent inline message.
- Recognize all nominee-check module rule aliases by default when parsing reasons,
  preserving their modifiers and using canonical codes for checking and scoring.
- Preserve Codex's 12px padding on nomination notices and dialog errors by
  keeping messages outside the dialog body's direct-child padding resets.
- Complete existing-nomination notices in new, editing and checking forms, with
  links to existing nominations and lookup failure notices.
- Remove duplicate-nomination notices from registry rows, and disable checking
  nominations submitted by the current user or awarding points to them, with
  explanatory tooltips and matching batch exclusions.
- Keep edit summaries within 255 UTF-8 bytes, progressively reducing nomination
  details while preserving complete text and the tool credit.
- Show an ellipsis while recipient suggestions load, suggest the latest uploader
  on file pages and Commons previews, and use the viewed revision's editor on
  permalink and diff views except for category 7.
- Center nomination trash controls and align the Chinese review headings as
  行文、內容、來源.
- Show the latest DYK nomination's main author, closing date and passed or failed
  archive result while checking nominations that request DYK points; distinguish
  missing records from failed lookups.
- Recognize `DYK_Invite` and `DYK Invite` banners and show an active nomination
  tag alongside any earlier DYK outcome.

## [2.0.0-alpha] - 2026-09-27

- Rebuild the main `wp-acga-tool` repository around SuperGrey's ACGATool functionality.
- Organize TypeScript source by application, domain, platform, and feature ownership,
  following wikEd Lite's structure and Codex interface conventions.
- Stage registration changes locally and submit the batch with one registration-page
  edit and one score-list edit; cancelling discards pending changes.
- Preserve nomination rules, author/reason editing, review workflows, and score calculation.
- Simplify award dialog headings and move nomination add/delete controls into the tabs.
- Use compact half-point score steppers throughout nomination and checking forms.
- Offer general, specialist, and comprehensive review modes with editable review
  descriptions and scores, plus a tier preset for pre-filling their controls.
- Toggle split and merged nomination tables, with an add-table tab control and
  preserved group assignments when merging into one continuously numbered list.
- Review tables together with individual row editing and a separate comment for each table.
- Freeze and restore summary rows, skipping frozen items in numbering, previews,
  and submission while retaining their drafts.
- Validate the active nomination before adding items or tables, showing scoring
  errors directly below the category controls.
- Preview the whole batch as rendered wikitext before one final submission.
- Suggest the past year's largest byte contributor as the recipient for article nominations.
- Show category-specific recipient defaults as placeholders and use them when the field is blank.
- Place media and other-contribution page fields before their scoring items, with
  contextual page placeholders and the first media item selected by default.
- Add standalone gadget and userscript builds, offline tests, validation, and tagged releases.
- Remove the readable `dist/bundled.js` compatibility artifact from builds and releases.
- Preserve SuperGrey's credit and the original MIT copyright notice without adding
  a copyright claim for AI-assisted maintenance.
