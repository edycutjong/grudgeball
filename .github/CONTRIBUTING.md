# Contributing

Thanks for your interest in improving Grudgeball! 🎮

## Getting Started
1. Fork the repo and branch from `main`: `git checkout -b feat/your-feature`
2. Install dependencies: `npm install`
3. Log in to Devvit (only needed to actually playtest against Reddit): `npm run login`
4. Type-check + run the unit suite: `npm run type-check && npm test`
5. Build the client/server bundle: `npm run build`

Grudgeball is a **Devvit Web** app (Hono server + Canvas 2D client over a
platform-free shared core in `src/shared`). There is no dev server / localhost
origin to run locally in the traditional sense — the real end-to-end loop only
exists inside `devvit playtest` (`npm run dev`) against a test subreddit, which
needs a Reddit login. See the [README](../README.md#local-development) and
[`DEMO.md`](../DEMO.md) for the full loop.

## Before You Open a PR
- `npm run type-check` passes (`tsc --build` across client/server/shared + the test project).
- `npm test` passes (Vitest — keep the suite green; it's currently 87/87 across 9 files).
- `npm run build` succeeds (both `dist/client/{splash,game}.html` and `dist/server` resolve).
- Add or update tests in `tests/` for any behavior change to `src/shared` or `src/server/core`.
- Keep commits conventional (`feat:`, `fix:`, `docs:`, `chore:`).

## Reporting Bugs / Requesting Features
Open an issue using the provided templates. Include repro steps, expected vs.
actual behavior, and environment details (Devvit CLI version, subreddit, device).
