# Contributing

Use Node.js 24.14.1 or newer. Install the exact dependency tree with `npm ci`;
install Chromium with `npx playwright install chromium` for browser tests.

| Command           | Purpose                                              |
| ----------------- | ---------------------------------------------------- |
| `npm run format`  | Apply repository formatting.                         |
| `npm run check`   | Check formatting, lint, TypeScript, and unused code. |
| `npm test`        | Run offline domain, API, and service tests.          |
| `npm run build`   | Generate the MediaWiki gadget and userscript.        |
| `npm run test:ui` | Build and run the offline Chromium suite.            |
| `npm run verify`  | Run all checks and tests.                            |

Read [the architecture](docs/architecture.md) before changing module ownership.
Keep deterministic rules independent of MediaWiki and DOM globals. Inject APIs
into application services, and keep feature state private to each dialog session.
Preserve local staging: a batch produces one registration-page edit and one
score-list edit after submission, and cancel discards the unsubmitted draft.

Automated checks must use local fixtures and must not edit live wiki pages.
Cover meaningful changes in scoring, wikitext transformation, API failure handling,
and submission behavior. UI tests exercise actual Vue and Codex components with
mocked MediaWiki operations. `scripts/test-ui.ts` keeps reports in a temporary
directory and removes them when the test process exits.

All source, tests, and executable scripts use TypeScript. Node executes test and
tool scripts directly, with a small source loader for imported CSS/Vue text.
The ESLint configuration uses the conventional `.mjs` extension. Generated
JavaScript in `dist/` is an installation artifact, never hand-edited source.

Keep translated content as text, keep message catalogs aligned, release event
listeners and mounted applications, and ignore obsolete asynchronous results.
Vue and Codex are supplied by MediaWiki ResourceLoader in production; their npm
packages provide development types and offline test fixtures. Do not add build
steps that fetch scripts from a live wiki.

## Releases

1. Update `package.json` and `package-lock.json` to the release version.
2. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md`.
3. Run `npm run verify` and review the generated installation files.
4. Commit the release on `main`, create the matching `vX.Y.Z` tag, and push it.

Publishing the tag triggers the release workflow. It verifies the exact package
and lockfile versions, checks that the tagged commit belongs to `origin/main`,
runs the full validation pipeline, and publishes the verified artifacts.
Versions containing a prerelease suffix create a GitHub prerelease.

Credit SuperGrey and preserve the MIT notice in `LICENSE` and all generated
artifacts. AI-assisted maintenance does not erase original authorship or licensing.
