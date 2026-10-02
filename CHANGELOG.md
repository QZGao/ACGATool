# Changelog

<!-- toc:start -->

## Contents

- [\[2.0.2\] - 2026-10-03](#202---2026-10-03)
- [\[2.0.1-alpha.2\] - 2026-10-02](#201-alpha2---2026-10-02)
  - [Changed](#changed)
- [\[2.0.0-alpha.2\] - 2026-10-01](#200-alpha2---2026-10-01)
- [\[2.0.0-alpha.1\] - 2026-10-01](#200-alpha1---2026-10-01)
- [\[2.0.0-alpha\] - 2026-09-27](#200-alpha---2026-09-27)

<!-- toc:end -->

## [2.0.2] - 2026-10-03

- Use native Codex buttons for dialog actions and current formatversion 2
  MediaWiki responses, removing obsolete keyed-page and revision payloads.
- Publish matching readable userscript and minified gadget headers, with
  user guides in three languages and BanG Dream article-based screenshots.

## [2.0.1-alpha.2] - 2026-10-02

### Changed

- Dialog actions use Codex hierarchy, neutral cancellation and 12px spacing,
  with a primary action first when stacked.
- Developer guides require Codex button types and ordering; test names use
  kebab-case and the README presents the tool independently.
- Offline documentation screenshots have a reproducible 1024 × 768 viewport.

## [2.0.0-alpha.2] - 2026-10-01

- Identify pending checks solely by yellow article-cell backgrounds, retaining
  check buttons and batch-selection boxes after eligibility lookups.
- Remove unused nomination-template parsing branches and fixtures; registry
  parsing and editing use numbered `ACG提名2` entries.
- Read DYK outcomes only from explicit `+` or `-` archive results, removing
  obsolete banner and article-history parsing.

## [2.0.0-alpha.1] - 2026-10-01

- Save nomination batches across pages and browser sessions, synchronize open tabs,
  and retain frozen items and newer drafts after submission.
- Navigate batch checks with numbered item tabs, undo and redo scoring edits,
  and submit accepted results with one registration edit and one score-list edit.
- Support single-entry rechecks with score deltas, enforce checking
  eligibility, and validate archive timing against current page source.
- Show compact article assessments, DYK outcomes and active nomination links,
  with native wiki colors and section anchors, recipient suggestions and duplicate notices.
- Simplify nomination controls and align 23px registry buttons with selection boxes,
  preserving table comments, editable review modes, frozen rows and validated batch previews.
- Drag nomination tabs to reorder or move between tables, retain the order in drafts,
  and align recipient labels and the concise linked DYK status.
- Reduce gadget size with compact embedded templates, CSS and internal message IDs,
  and remove obsolete code while retaining readable source and userscript assets.
- Consolidate documentation around features, workflows and integration contracts;
  prepare the 2.0.0-alpha.1 prerelease.

## [2.0.0-alpha] - 2026-09-27

- Rebuild SuperGrey's ACGATool with TypeScript application, domain, platform,
  and feature layers, MediaWiki Vue/Codex components, and three interface languages.
- Preserve nomination rules and scoring with exclusive categories, editable review
  modes, contextual recipient defaults, and compact score controls.
- Review and preview multiple nomination tables, edit or freeze individual items,
  and submit locally staged checks as a completed batch.
- Add standalone gadget and userscript builds, offline unit and browser tests,
  and verified tagged releases with the original credit and MIT notice.
