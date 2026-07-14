# AUDIO — Grudgeball (IMPLEMENTED 2026-07-14)

Status: **shipped (SFX)**. Procedural Web Audio one-shots are wired into the
client — no asset files, no external fetch, so it respects `http.enable:false`
and works offline. Implementation: `src/client/lib/audio.ts`; cues fire from
`src/client/game.ts` (kill / survive / plant / report reveal). A mute toggle
sits in the HUD and audio unlocks on the first tap (autoplay policy). Background
music is deliberately **not** shipped this pass (SFX-only) — it remains optional
per the sections below. The cue table below is now the wired map, not a draft.

## Feasibility (verified so far, audited)

- Devvit's client is a real Chromium webview (`lib.dom.d.ts` present in the
  build — `HTMLAudioElement`, `AudioContext`, etc. are all available).
  `devvit.json`'s config schema has no CSP field at all — that just means
  this repo doesn't set one, not that none applies. **The real
  Content-Security-Policy is set by Reddit's host page at runtime and is not
  verifiable from this repo.** Treat the first `devvit playtest` as the real
  test, not this doc.
- **Not officially confirmed** by any crawled Devvit doc: whether Reddit's
  mobile-app embedded webview wrapper has its own autoplay/audio quirks on
  top of standard browser autoplay policy.
- Hard constraints that apply regardless of source:
  - This project's `devvit.json` has `"http": {"enable": false}` (confirmed) —
    every audio file must be bundled into `dist/client/` at build time
    (same-origin), never fetched from an external CDN.
  - Browser autoplay policy — sound can't start until after a user gesture.
    The player's first tap (drop a marble / open the board) satisfies this.
  - `localStorage` is wiped on app updates — asserted in this project's own
    `ARCHITECTURE.md`. A persistent mute preference needs a session-only flag
    or a `user:{id}:{day}` Redis field, not `localStorage`, if it must survive.
  - **Splash (`inline: true`) vs expanded game view are different UX
    surfaces.** The inline feed splash is a passive card in someone's scroll
    — autoplaying anything there is a worse idea than in the expanded view,
    which the player explicitly opened. Scope audio to the expanded view only.
  - No documented Devvit asset-size/bundle-size budget was found; keep SFX
    files small (or synthesized, avoiding the question) until one is found.
  - Not addressed yet: pausing `AudioContext` on `visibilitychange` (user
    scrolls the post off-screen mid-feed) and calling `.resume()` inside the
    gesture handler (iOS requires this). Needed before shipping, not before
    prototyping.
  - No accessibility fallback planned (e.g. a visual pulse as the non-audio
    equivalent of the kill-thud) — worth deciding scope on, not a blocker.

## SFX cue map

| Trigger | File location | Cue | Notes |
|---|---|---|---|
| Marble dies on a trap | `src/client/lib/sim.ts` (drop resolution) → `game.ts` render tick | Short impact "thud/crack" | The magic-moment beat (`Greg's Regret` kill) — highest-value single cue in the game |
| Marble survives / banks depth | `game.ts` drop-scene loop | Soft "coin/chime" tick | Positive-feedback loop reinforcement |
| Placement planted (`PLANT` button) | `src/client/game.ts` placement scene | Low "thunk" / seal sound | Confirms the once-per-day commit |
| Grudge Report modal opens | `src/client/game.ts` — `maybeShowReport()` | Rising "reveal" sting | Pairs with the "+87 victims" reveal. (`lib/demo.ts` is the offline-fallback data layer only, not where this fires live.) |
| Cruelty Multiplier crosses a threshold (e.g. ×2, ×3) | board-render tick | Short tension riser (optional, skip if noisy) | Lowest priority — easy to cut for scope |

## Background music (optional, separate from SFX)

- **Loop**: one ambient/tense loop under the Drop scene, ducked (volume
  lowered, not stopped) during the kill-card/report reveal so the SFX cue
  reads clearly.
- **Mute control required** if music ships — a visible toggle in the splash
  or game HUD, defaulting to **on** for SFX / **off or low** for music (music
  is a bigger "is this appropriate on Reddit" surface than a short SFX tick).

## Generation approach (pick one before implementing)

1. **Web Audio synthesis (no asset files)** — generate the thud/chime/thunk
   procedurally with oscillators + short noise bursts at runtime. Zero
   generation cost, zero extra files to ship, trivially same-origin. Reads
   as "retro/arcade," which fits Grudgeball's brass/red palette tone.
2. **ElevenLabs sound-effects generation** — if the ElevenLabs API's
   dedicated SFX endpoint (separate from its TTS voice endpoint) is
   confirmed available, generates more organic/textured one-shots. Costs API
   credits per generation; output files need to be committed into
   `src/client/assets/` (or similar) and bundled by Vite.

Background music (if pursued) would use the `suno-music` skill regardless of
which SFX path is chosen, since Suno targets full loops/tracks, not one-shots.

## Open decision

Confirm before any implementation work starts:
1. SFX generation method (Web Audio synthesis vs ElevenLabs).
2. Whether background music ships at all, or SFX-only for this pass.
3. Priority order if time runs short — the marble-death thud and the Grudge
   Report reveal sting are the two cues with real "magic moment" payoff; the
   rest are lower-priority polish.
