---
name: verify
description: 'Verify DWV locally with the pre-commit harness: formatting, lint, coverage tests, strict library/API build, demo, PWA and docs. Use before committing or reporting completion.'
---

# Verify DWV locally

GitHub workflows are absent. Install dependencies and the tracked hook with
`corepack yarn setup` after cloning. Use Node 26.

1. Inspect `git status --short` and the staged diff.
2. Run `corepack yarn format` to format staged paths in the working tree.
   Inspect fixes and stage them explicitly. Never stage unrelated edits.
3. Commit normally. `.githooks/pre-commit` verifies the exact Git index in a
   temporary checkout. `corepack yarn pre-commit` runs it manually;
   `corepack yarn verify` checks the working tree.

The hook checks dependency/lock consistency, staged formatting, library/PWA/
tooling lint, the full coverage suite, strict library/API build, demo/PWA
builds and docs. It stops on failure and preserves unstaged/untracked edits.
Keep warnings at zero. Test output must contain no application logs.

For a public API change, inspect `resources/api/dwv.api.md`; deliberately run
`corepack yarn api` and stage the report before retrying. The strict check
does not update it. Review controller use, undoable commands, customization,
exports and stray generated output against `AGENTS.md`.

Do not run property-based or mutation testing for this task. Do not publish
from a commit hook. Deployment is manual. For UI changes, also exercise the
affected browser workflow and report any limits.

Report checks accurately. Include the first error for any failing step;
never report a skipped check as passed.
