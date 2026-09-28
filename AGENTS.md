# ACGATool contributor instructions

Read `CONTRIBUTING.md` and `docs/architecture.md` before changing project structure.

- Keep startup and orchestration in `src/app/`, pure scoring and wikitext rules in
  `src/domain/`, host integration in `src/platform/`, and UI in `src/features/`.
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
