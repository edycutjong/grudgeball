# Grudgeball

Die. Plant your revenge. Count the bodies at dawn — a daily marble gauntlet built by the crowd.

Every board in Grudgeball is built from other players' grudges. You get three marbles a day and drop them through a machine of bumpers, fans, magnets, and spikes — every object placed and *named* by another redditor, with their username and body count on it. Spend your marbles and you earn one thing: a single trap planted into *tomorrow's* board. Plant a spike and earn **Menace** credit for every stranger it kills overnight; plant a booster or cushion and earn **Angel** credit for every run it saves. Next morning, a personal **Grudge Report** tells you what your trap did while you were gone.

## How to play

1. Open today's Grudgeball post and tap **ENTER THE GAUNTLET**.
2. **Drop (×3):** tap a column to aim, then press **DROP**. If your marble dies, a killer card names the trap and the redditor who built it, and its body count ticks up to include you. If it survives, you score depth and coins × the day's Cruelty Multiplier.
3. **Place (×1):** once your three marbles are spent, pick one of eight objects, tap a glowing cell, name your grudge (≤24 chars), and **PLANT**. It returns at dawn in tomorrow's board.
4. **Report:** come back the next day for your Grudge Report — what your trap claimed overnight and your rank movement.
5. **Leaderboards:** Depth · Menace · Angel · Streak.

## Why it's different

- The board is 100% **player-built** UGC — yet every placement passes an in-transaction A* solvability check, so it can never become unplayable.
- A **Cruelty Multiplier** climbs all day as traps accrete, so the board is alive at any hour.
- The morning **Grudge Report** turns yesterday's crowd into your reason to return.

## Privacy & safety

Everything runs on Reddit's own infrastructure. **No external services, no third-party APIs, no data ever leaves the platform, and no runtime AI.** All game state lives in Reddit-hosted Redis, scoped to this subreddit. The app posts a comment as you only when you take an in-game action.

- Terms: https://edycutjong.github.io/grudgeball/terms.html
- Privacy: https://edycutjong.github.io/grudgeball/privacy.html

## Links

- Demo video: https://www.youtube.com/watch?v=ZHujf9Qudjw
- Source (MIT): https://github.com/edycutjong/grudgeball
- Built for Reddit's "Games with a Hook" hackathon

Built with TypeScript, Devvit, Hono, and a dependency-free Canvas 2D renderer. 235 tests · 100% coverage · zero runtime AI.
