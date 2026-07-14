# SPONSOR_DEFENSE — Grudgeball ("Why ONLY Reddit/Devvit")

## Surface-by-surface defense (what we'd need without each)

| # | Devvit surface (cited as used) | Without it you'd need |
|---|---|---|
| 1 | `redis.watch/multi/exec` placement + score transactions | A hosted Postgres/Redis + row-locking layer + your own auth binding |
| 2 | Redis hashes/zsets (`board:{day}`, `lb:*`, `queue:*`) | A database service + an ORM + a leaderboard service |
| 3 | `scheduler` cron (`compile` 00:00, `accrete` hourly) | A cron farm/queue worker (Cloud Run jobs, Temporal) + retries |
| 4 | `onPostCreate` trigger binding day-state to posts | Webhook infra against a polling bot |
| 5 | Realtime channel `board_live` | A websocket cluster (explicitly impossible here — and unnecessary) |
| 6 | Reddit API app comments + consent-gated `asUser SUBMIT_COMMENT` | An OAuth app + comment bot + consent UX from scratch |
| 7 | Menu actions (`Seed Demo Day`, `Purge Object`) | A separate admin panel with its own auth |
| 8 | Interactive post webview + hosted distribution in the feed | Hosting, CDN, an app store, AND an audience |

**Closing:** Take Reddit/Devvit out and you'd need six separate systems (DB, cron, websockets, OAuth bot, admin panel, hosting) — and you still wouldn't have the one thing that IS the game: thousands of identified strangers walking past the same post all day. The board is manufactured by feed traffic; no other platform ships the crowd.

## Why the mechanic is Reddit-shaped (not ported)

- Persistent pseudonymous identity makes "Greg's Regret ×312" mean something; anonymous traffic would make the board sterile.
- The per-subreddit Redis silo is used as a *feature*: every community compiles a different personality of cruelty/kindness — one codebase, a thousand cultures.
- The comment thread is the blame arena the morning report deliberately feeds ("today's board was built by 214 of you").

## Honest limitations (stated in README)

1. Client-side physics is authoritative for feel; records are only plausibility-checked — a sophisticated cheater can shave leaderboard time (shadow-flagged, not prevented).
2. Realtime is best-effort garnish; two players never *see* each other's marbles mid-flight, only landings.
3. Daily limits are per-Reddit-account; alt accounts can place twice (platform-level exposure shared by all Devvit games).
