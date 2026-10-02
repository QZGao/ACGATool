# Contributing

**Required UI reference: [Codex button types and order](https://doc.wikimedia.org/codex/latest/style-guide/using-links-and-buttons.html#types-and-order-of-buttons).**
Use one primary progressive button per group, normal secondary buttons, quiet
tertiary buttons and neutral cancellation. Reserve destructive actions for
irreversible operations. In forward flows the primary action comes last in
reading order (right in LTR, left in RTL); dialog footers align to the end.
Back sits beside the forward action with lower hierarchy. Stacked buttons put
the primary action at the top in both reading directions. Use `spacing-75`
(12px by default) between separate buttons; Codex ButtonGroup manages its own spacing.

Use Node.js 24.14.1 or newer. Install the locked dependency tree with `npm ci`
and Chromium with `npx playwright install chromium` for browser tests.

| Command               | Purpose                                                    |
| --------------------- | ---------------------------------------------------------- |
| `npm run format`      | Apply repository formatting.                               |
| `npm run check`       | Check formatting, lint, TypeScript, and unused code.       |
| `npm test`            | Run offline domain, API, and service tests.                |
| `npm run build`       | Generate the MediaWiki gadget and userscript.              |
| `npm run test:ui`     | Build and run the offline Chromium suite.                  |
| `npm run screenshots` | Regenerate documentation screenshots at 1024 × 768, DPR 1. |
| `npm run verify`      | Run all checks and tests.                                  |

Read [the architecture](docs/architecture.md) before changing module ownership.
Keep scoring and wikitext rules pure, inject external operations, and give each
dialog session ownership of its state and asynchronous work. Preserve the five
exclusive nomination categories and local batch staging.

Use TypeScript for source, tests and executable tools. Generated `dist/` files
come from the build. The ESLint configuration uses its conventional `.mjs`
extension. Keep translated content as text, align message catalogs, release
mounted hosts and listeners, and discard stale responses.

For material changes, run `npm run verify` and review the generated artifacts.
Cover meaningful scoring, parsing, API failure and submission behavior with
local fixtures. Browser tests exercise real Vue/Codex components with mocked
MediaWiki operations; `scripts/test-ui.ts` removes temporary reports on exit.
Production runtime dependencies come from ResourceLoader, while locked npm
packages keep builds and tests independent of live wiki access.

Use lowercase kebab-case filenames for modules, styles and test scenarios.
Keep a feature's TypeScript, template-only Vue markup and stylesheet co-located.
Dialog feedback uses Codex Message for errors and warnings; field validation
stays beside its labelled control. Preserve focus, accessible labels and text
rendering when adjusting dialog markup.

`npm run screenshots` runs the opt-in documentation scenario with
`DOCUMENTATION_SCREENSHOTS=1`. It uses real local Vue/Codex components and offline
nomination fixtures, disables animations, and replaces `docs/images/screenshot-*.png`.
The viewport is exactly 1024 × 768 CSS pixels with device scale factor 1; images
contain the full viewport. Inspect both nomination and summary views after UI edits.

Keep README focused on major features, operational guidance in `docs/`, and
release notes in `CHANGELOG.md`. Consolidate related changes into major items,
with each changelog bullet occupying at most two lines.

## Releases

1. Update `package.json` and both project version fields in `package-lock.json`.
2. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md`.
3. Run `npm run verify` and review the generated installation files.
4. Commit the release on `main`, create the matching `vX.Y.Z` tag, and push it.

The tag workflow verifies package and lockfile versions and membership in
`origin/main`, then runs validation and publishes the verified artifacts.
Prerelease versions create a GitHub prerelease.

Credit SuperGrey and preserve the MIT notice in `LICENSE` and generated files.
AI-assisted maintenance retains the original authorship and licensing without
an additional maintainer copyright claim.
