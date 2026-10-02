# ACGATool contributor instructions

Read `CONTRIBUTING.md` and `docs/architecture.md` before changing project structure.

**UI changes must follow [Codex button types and order](https://doc.wikimedia.org/codex/latest/style-guide/using-links-and-buttons.html#types-and-order-of-buttons).**
Use one primary progressive action per group, normal secondary actions, quiet
tertiary actions, and neutral cancellation. In flows, put the primary action last
in reading order (right in LTR, left in RTL); align dialog actions to the end.
When stacked, put the primary action at the top in both directions. Use the
12px spacing token between separate buttons; reserve destructive actions for
irreversible operations.

- Keep startup and orchestration in `src/app/`, pure scoring and wikitext rules in
  `src/domain/`, host integration in `src/platform/`, and UI in `src/features/`.
- Use lowercase kebab-case module and test filenames. Keep feature TypeScript,
  template-only Vue markup and CSS together; use `*.test.ts` for unit tests and
  `*.spec.ts` for browser scenarios.
- Keep `src/index.ts` side-effect free. Use TypeScript for source, tests, and tools.
- Preserve SuperGrey's credit and the MIT notice in `LICENSE`; the AI-assisted
  edits do not introduce an additional copyright claim.
- Keep the five exclusive nomination categories: 1–4, 5, 6, 7, and 8. Each
  nomination belongs to one group; forms, checking, and rebuilding share it.
- Stage batch checks locally. Submit one registration-page edit and one score-list
  edit for the completed batch. Cancel discards pending changes. Report partial
  failures accurately and avoid duplicate scoring on retries.
- Treat wiki content as untrusted text. Use injected services for external effects,
  clean up dialog hosts and listeners, and discard stale asynchronous results.
- Vue and Codex come from MediaWiki ResourceLoader in production. Keep automated
  builds and tests independent of live wiki downloads or edits.
- Use Node.js 24.14.1 or newer and the tracked lockfile (`npm ci`). Run
  `npm run verify` for material changes. Generate `dist/` with the build.
- Keep README features brief; place technical guidance in `docs/` and notable
  changes in `CHANGELOG.md`.
- Regenerate documentation images with `npm run screenshots`: offline fixtures,
  a 1024 × 768 viewport, device scale factor 1, and no live wiki operations.
