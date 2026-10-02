# Contributing

<!-- toc:start -->

## Contents

- [Setup](#setup)
- [Development loop](#development-loop)
- [Behavior and verification](#behavior-and-verification)
- [UI and localization](#ui-and-localization)
- [Documentation and screenshots](#documentation-and-screenshots)
- [Builds and releases](#builds-and-releases)

<!-- toc:end -->

## Setup

Use Node.js `>=24.14.1`. Install the exact tracked dependency tree with
`npm ci`, then install Chromium with `npx playwright install chromium` for browser tests.
Read [architecture](docs/architecture.md) before changing source boundaries and
[contributor rules](AGENTS.md) for the project's behavioral invariants.

## Development loop

| Command               | Purpose                                                        |
| --------------------- | -------------------------------------------------------------- |
| `npm run check`       | Run the configured format, lint, type, and unused-code checks. |
| `npm test`            | Run offline unit and service tests.                            |
| `npm run build`       | Generate installation artifacts from source.                   |
| `npm run test:ui`     | Build and run offline Chromium interaction tests.              |
| `npm run screenshots` | Recreate documentation images from the pinned article fixture. |
| `npm run verify`      | Run the complete required validation pipeline.                 |
| `npm run format`      | Apply repository formatting.                                   |

Keep source and module names descriptive. Use lowercase kebab-case filenames and explicit
TypeScript boundaries. Feature templates, behavior, and scoped styles stay together.
The lockfile pins dependencies; dependency updates receive the same verification as source edits.

## Behavior and verification

Run `npm run verify` before handing off material changes and inspect `git diff --check`.
Use behavior tests for meaningful regressions: successful actions, partial failures,
cancellation, stale responses, persistence errors, selection, and teardown as applicable.
Stub external requests and reject unexpected browser network requests. Do not edit live wikis
from tests. Inspect generated files rather than changing their content directly.

Preserve the five exclusive nomination categories: 1–4, 5, 6, 7, and 8. Each nomination belongs to one group across forms, checking, and rebuilding. Stage checks locally; submit one registration-page edit and one score-list edit for a completed batch. Cancel discards pending changes. Report partial failures and prevent duplicate scoring on retries. Credit SuperGrey and preserve the MIT notice without adding a maintainer copyright claim.

Keep pure logic independent of browser and MediaWiki globals. Bind adapters in the composition
root. Render untrusted text safely; clean up all owned resources. Vue and Codex come from
ResourceLoader in production; npm packages supply local types, build data, and test fixtures.

## UI and localization

Follow [UI guidelines](docs/ui-guidelines.md), based on the
[Wikimedia Codex style guide](https://doc.wikimedia.org/codex/latest/style-guide/overview.html)
and [links and buttons guidance](https://doc.wikimedia.org/codex/latest/style-guide/using-links-and-buttons.html).
Check semantic links/buttons, action hierarchy, 12px spacing, responsive DOM order, keyboard
focus, labels, validation, and progress. Keep supported locale messages and placeholders aligned.

## Documentation and screenshots

Follow [documentation conventions](docs/documentation.md). Maintain English, Traditional Chinese,
and Simplified Chinese user READMEs with working artifact links and equivalent instructions.
Technical guidance belongs under `docs/`. Update headings and tables of contents with the code.
Record notable changes in `CHANGELOG.md` without rewriting historical release descriptions.

Run `npm run screenshots` and inspect every resulting image after changing captured UI.
Use the actual running tool with the pinned BanG Dream! article revision 94028176, an offline
host, a 1024 × 768 viewport, device scale factor 1, and disabled animations. Preserve source
attribution and describe any excerpts or simulated responses in [screenshots](docs/screenshots.md).

## Builds and releases

`npm run build` generates `dist/`, including a compressed MediaWiki `.min.js` and
readable Tampermonkey `.user.js`. Both preserve matching documentation and license notices;
the userscript metadata comes first. Builds must not contain local paths or timestamps.
Consult the workflow files for each project's published artifact names.

For a release, update the package and lockfile versions together, move completed Unreleased
notes into a dated version section, run `npm run verify`, and review installation behavior
and license notices. A maintainer creates and pushes the release commit/tag deliberately.
A local build publishes nothing. Preserve the existing workflow's distribution contract.

ACGATool release tags use `vX.Y.Z` and must point to a commit on `origin/main`.
`scripts/release-check.ts` validates the package version, both lockfile version fields,
main-branch ancestry, and the matching changelog entry before publication. Prerelease
versions create a GitHub prerelease. Preserve both `acga_tool.min.js` and
`acga_tool.user.js` asset names and the complete embedded MIT notice.
