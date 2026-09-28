# Changelog

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
