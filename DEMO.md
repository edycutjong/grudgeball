# DEMO — Grudgeball (judge path)

A 90-second path that shows the whole loop: **open → drop → die to Greg's Regret
→ place → wake to a seeded report**. Every number below is deterministic on the
seeded board, so you see the same thing every run.

> ### ⭐ THE MAGIC MOMENT — ~0:09 (film this beat first)
> Drop down the centre (don't touch the aim). The marble threads the friendly top
> third, then dies on **"Greg's Regret"** — a spike a *stranger* named. A big
> **`312` ticks to `313` bodies claimed**, `u/gb_founder_greg banks +1 Menace`, and
> you're told **`You were victim #313 · ×2.7 · 3510`**. The "oh": a stranger named
> the thing that killed you, and their kill count went up *because of your death*.
> This is [step 2](#2-drop-down-the-centre--death-to-gregs-regret) below, and it is
> witnessable **on load** (offline demo mode, no server). Lead the ≤60s video here.

**Prerequisites:** the app is installed on your test subreddit, you are logged in
as a moderator of it (`npm run login`), and a board post exists (the midnight
cron creates one, or use the mod menu **"Grudgeball: Create Today's Post"**).

---

## 0. Seed the demo (once)

Subreddit menu → **"Grudgeball: Seed Demo Day"**.

**Expected toast:**
`Seeded demo day YYYY-MM-DD: 60 objects, 40 ghost trails, 12 founders. Open today's post and drop.`

This writes a deterministic 60-object board to Redis, populated kill/save
counters, 40 faint ghost trails, yesterday's leaderboards, and — because *you*
invoked it — a pre-populated Grudge Report keyed to your account.

---

## 1. Open the post → splash → game

- The feed shows the **splash** card: title, a live board snapshot (you can see
  the red kill-zone density in the lower half), and one CTA.
- **Expected stat line:** `DAY N · 32 TRAPS · CRUELTY ×2.7`
  (the seeded board has 32 active menace objects; `cruelty = 1.0 + 3.0 ×
  32/56 = 2.7`).
- Tap **ENTER THE GAUNTLET** → the game expands (`requestExpandedMode → 'game'`).
  The HUD shows `DAY N`, `32 TRAPS`, `×2.7`, and three filled marble pips.

## 2. Drop down the centre → death to Greg's Regret

- Do **not** move the aim (it defaults to the centre column). Press **DROP**.
- The marble threads the friendly top third (it clips a booster — one "save"
  for that builder), banks through the character zone, and enters the kill zone.
- **Expected killer card (the magic moment):**
  - **KILLED BY** → **Greg's Regret**
  - a big body count **ticks up 312 → 313** under the label `bodies claimed`
  - `u/gb_founder_greg banks +1 Menace`
  - You were victim: `#313` · Cruelty: `×2.7` · Score: `3510`
    (`score = depth 13 × 100 × 2.7`).
  - *This is the beat:* you died to a spike a stranger named, you are its 313th
    victim, and that stranger's credit ticks up in front of you.
- Under the hood the server credited `obj:d31:kills += 1` and bumped
  `u/gb_founder_greg` on the Menace ladder. `POST /api/drop-result` returned:
  ```json
  { "status": "ok", "score": 3510, "best": 3510, "cruelty": 2.7, "marblesLeft": 2, "canPlace": false }
  ```
- Press **CONTINUE** and drop the remaining two marbles. On the seeded funnel
  they also end at Greg's Regret — that is the point: "all roads lead to Greg."
  After the third, `marblesLeft: 0`, `canPlace: true`.

## 3. Place your grudge (returns at dawn)

- The board dims, legal cells glow green, and the palette opens.
- Pick **spike** (Menace, red), tap a glowing cell, type a name
  (e.g. `My First Grudge`), press **PLANT — returns at dawn**.
- **Expected confirmation:**
  - **PLANTED** → your name
  - `Returns tomorrow around hour H UTC. Every stranger it kills earns you credit overnight.`
- `POST /api/place` returned `{ "status": "ok", "placementId": "...", "day": "<tomorrow>", "releasePreviewHour": H }`.
  Placement went through one `watch/multi/exec` that enforced one-per-day, cell
  vacancy, the band cap, and an A\* solvability re-check. Try to place a second
  time and the server replies `rejected · ALREADY_PLACED`.

## 4. See yesterday's Grudge Report

The report modal fires automatically on open (it fired in step 1 if you seeded as
this account; re-open the post to see it again after clearing the seen-marker via
a re-seed). It reads `report:{yesterday}:{yourUserId}`.

- **Expected report card:**
  - **YESTERDAY'S GRUDGE** → **First Grudge**
  - `claimed 87 marbles overnight`
  - Kills: `87` · Saves: `3` · Your rank: `#3 Menace`
  - Board deadliest: `Greg's Regret (312)` · Built by: `214 redditors`
- Single CTA → **TO TODAY'S BOARD**.

## 5. Leaderboard sheet (optional)

Press **LEADERBOARD** → tabs **depth / menace / angel / streak**. On the seeded
board the Menace tab is topped by the founders whose objects killed most
overnight (Greg leads at 312). Your own row is highlighted if you scored.

---

## What to look for (judging cues)

- The board is **player-built** (every object is named + attributed) yet
  **provably playable** (A\* solvability gate) — the answer to UGC troll-levels.
- The **Cruelty Multiplier** is live and server-applied, not cosmetic.
- The **report** turns yesterday's crowd into a personal grudge — the retention hook.
- **Zero external fetch, zero runtime AI** — the content engine is the crowd
  (`devvit.json` → `http.enable: false`).

## If something looks off

- Board renders but drops say `closed` → the board was not compiled/seeded; run
  **Seed Demo Day** (step 0).
- Killer card says a *different* spike → you moved the aim; every column still
  funnels to the kill zone, only the exact spike changes.
- No report modal → you are not the account that ran the seed, or the marker was
  already seen; re-run **Seed Demo Day** to reset it.
