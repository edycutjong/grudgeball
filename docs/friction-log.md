# Friction log — Grudgeball build

Real Devvit / toolchain papercuts hit while finishing this build (2026-07-04),
newest first. Kept honest so the next person loses less time.

## Toolchain

### `tsc --noEmit` is a false-clean on a solution-style config
The root `tsconfig.json` is `{ "files": [], "references": [...] }`. Running
`tsc --noEmit` against it compiles **nothing** (files is empty; plain `--noEmit`
does not follow project references), so it reports "clean" even when a
referenced project is broken. The real check is **`tsc --build`** (wired as
`npm run type-check`). This masked a genuine server type error until a clean
`tsc --build` was run. Lesson: trust `tsc --build`, not `tsc --noEmit`, on
composite projects.

### `TaskResponse` ships from `@devvit/web/server`, not `/shared`
`src/server/routes/cron.ts` imported `TaskResponse` from `@devvit/web/shared`.
That barrel only re-exports `@devvit/shared` + `@devvit/payments/shared`.
`TaskResponse` is a **scheduler** type, so it comes through
`@devvit/web/server` (which re-exports `@devvit/scheduler`). Meanwhile
`TriggerResponse`, `OnPostCreateRequest`, and `UiResponse` *are* in
`@devvit/web/shared` (they live in `@devvit/shared`). The split between the
`/server` and `/shared` barrels is not obvious; when an import "doesn't exist,"
check the other barrel before assuming the type is missing.

### CSS side-effect imports need an ambient declaration under strict TS
`import './styles.css'` fails `tsc` with `TS2882` because the base config sets
`noUncheckedSideEffectImports: true`. Vite bundles CSS fine, but TypeScript
needs `declare module '*.css'` (added as `src/client/env.d.ts`). Nothing in the
Devvit docs flags this for the Web client template.

### `noUncheckedIndexedAccess` bites tuple indexing
`const t = ['a','b','c'] as const; t[i % 3]` is typed `... | undefined` even
though `i % 3` is provably in range. A typed ternary
(`i % 3 === 0 ? 'a' : ...`) reads cleaner than sprinkling `!`/guards. Worth
knowing before writing any modular-arithmetic cycling.

## Devvit Web client

### Empty `src/client` fails the build with an opaque error
With `devvit.json` declaring `post.entrypoints` (`splash.html`, `game.html`)
but `src/client/` empty, `vite build` dies with
`[UNRESOLVED_ENTRY] Cannot resolve entry module splash.html` and no hint that it
is looking under `src/client/`. The `@devvit/start/vite` plugin sets the client
root to `src/client` **iff that directory exists** and no explicit Vite root is
set; entrypoint paths in `devvit.json` resolve relative to that root. So the
files must be `src/client/splash.html` + `src/client/game.html`, and they build
to `dist/client/splash.html` + `dist/client/game.html` (flattened, not nested).

### splash → game is `requestExpandedMode`, not `navigateTo`
Switching from the inline splash entrypoint to the expanded game entrypoint uses
`requestExpandedMode(event, 'game')` from `@devvit/web/client` — `entry` is the
`devvit.json` `post.entrypoints` key, and it must be called from a **trusted
gesture** (a real click event). `navigateTo` is only for URLs/subreddits/posts.
Both are one export away in the same client barrel, easy to confuse. The API is
marked `@experimental`.

### Same-origin API only (by design)
`http.enable: false` (empty fetch allowlist) means the client can only talk to
its own server. That is fine: the webview is served from the app origin, so
relative `fetch('/api/board')` reaches the Hono routes. No CORS, no base URL.

### Realtime rate limits are unpublished
`connectRealtime({ channel, onMessage })` on the client pairs with
`realtime.send(channel, msg)` on the server. There is no documented rate limit,
so the 1 Hz-batched design is prudence, not a platform constraint. Treat
realtime as best-effort garnish — a dropped tick must never change game state.

## Build noise (non-fatal)

`vite build` prints two warnings from the devvit plugin's rollup options on this
Vite 8 / rolldown line — `Invalid output options … "sourcemapFileNames"` and
`inlineDynamicImports … deprecated`. Both are the plugin's, not ours, and the
build completes clean. Flagged here so nobody chases them.

## Operational landmine (not code — read before playtest)

New hackathon subreddits are being **auto-banned ("Rule #2")** by Reddit safety
automation, **including a re-ban right after installing a Devvit app**. Staff
unban manually when you post your username + subreddit in the Devpost forum
thread. Front-load this: make the sub from an aged account on day one, add a
normal pinned post before installing, expect a re-ban at first install, and keep
the unban-thread link handy. This is latency you cannot afford to discover on
demo day. (Source: cache-20260704/VERIFIED.md.)
