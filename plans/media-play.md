# Media Play — stacked plan (worktree `feat/media-play` off `dev`)

> **Scope lock (2026-08-24 Q&A):** Full session — epics #204 + #205 + #207 + mixer #203. Includes all P1/P2 stretch (loop-jam #191, overdub #193, MP3 #190, session persistence #194, iOS bring-up deferred but tracked). DI audition #273 is **out of scope** (separate worktree). Web + desktop together, stacked PRs per phase, `emcc` available, TinySoundFont + alphaTab 1.8.x approved.
>
> **Worktree:** `../NAM-Web-Studio.worktrees/media-play` · branch `feat/media-play` → PRs into `dev` · base commit `b944f7e` (dev at #272).
> **One-engine rule:** All mixing/routing/scheduling in `packages/core`; front ends only own device/host integration + persistence plumbing (ARCHITECTURE.md).

---

## 0. Conventions for every phase

- ABI shape: `extern "C"` in `packages/core/include/openaxe/api.h`, int ids / float params / out-params, no exceptions, threading contract in comment (control-thread vs `nam_studio_process`-safe). Same pattern as `nam_studio_load_ir_wav` for byte-entry loads.
- Whole-archive + `-fexceptions` (ARCHITECTURE.md — silent-failure traps). Every new ABI symbol must be added to `EXPORTED_FUNCTIONS` in `packages/core/CMakeLists.txt:244` + `scripts/check-wasm-exports.mjs` expectation + `bash scripts/build-core-wasm.sh` rebuild (re-commit `apps/web/public/wasm-core/{js,wasm}` atomically).
- Drift guards after each core ABI change: `node scripts/gen-param-schema.mjs --check`, `node scripts/check-grid-dims.mjs`, `node scripts/check-wasm-exports.mjs`, `node scripts/sync-version.mjs --check`.
- Verification per phase: `cmake -S packages/core -B packages/core/build -DOPENAXE_BUILD_TESTS=ON && cmake --build packages/core/build && ctest --test-dir packages/core/build --output-on-failure` + `pnpm test:run` + `pnpm lint && pnpm build` + `pnpm test:e2e` for UI phases.

---

## Phase 1 — Core session foundations (stack base)

**Goal:** Engine can load an SF2, queue sample-offset MIDI, tick a transport, and sum buses — but no takes/recording yet.

| # | Issue | Deliverable |
|---|-------|-------------|
| 1.1 | #152 | Vendor `TinySoundFont` under `packages/core/third_party/tinysoundfont/` (public-domain/MIT, add `THIRD_PARTY_NOTICES.md` attribution). New `SongPlayer` in `packages/core/src/dsp/` or `src/engine/` — `load_sf2_bytes`, poly cap, stereo render into own bus, no alloc on RT path. ABI: `nam_studio_song_load_sf2(bytes,len)`, `unload`, `has_sf2`. Tests: load failure codes, poly cap, SR independence. |
| 1.2 | #153 | Scheduled MIDI event ABI — `nam_studio_song_schedule_events(events, count, sample_offset)` + lookahead queue (note on/off, cc, program, pitch-bend). Sample-offset within next block, drained in `nam_studio_process`. Tests: offset ordering, queue overflow, program/pitch-bend. |
| 1.3 | #154 | Transport clock — `nam_studio_song_start/stop/seek(samples)` + `nam_studio_song_get_position()` (engine samples while playing). Single clock shared by song bus/clip players/capture taps (sample-synced by construction). Tempo stays front-end (events pre-scaled). Tests: monotonicity, seek flushes pending events, idempotent start/stop. |
| 1.4 | #156 | Session mixer — bus ids `song/grid/take0..N`, per-bus `gain/pan(m/equal-power)/mute/solo` (solo overrides mute — document rule), sum pre-master (existing master level/mute unchanged). ABI: `nam_studio_bus_set_gain/pan/mute/solo`, `get_bus_meter(bus_id)`. Extend metering beyond `get_meter`. Tests: sum order, solo exclusivity, pan law, meter correspondence. |
| 1.5 | #158 (partial) + #159 | Core tests harness for 1.1–1.4 + WASM rebuild + `EXPORTED_FUNCTIONS` update. |

**Dep chain:** 152 → 153 → 154 → 156 (155 can parallelize after 152, but serialized here for review clarity).

**PR:** `feat/session-core-transport-mixer` → `feat/media-play` (then to `dev`).

---

## Phase 2 — Clip players + capture taps

| # | Issue | Deliverable |
|---|-------|-------------|
| 2.1 | #155 | `nam_studio_clip_create/destroy`, `clip_feed_pcm(clip_id, floats, frames)` chunked into lock-free ring (control thread), `clip_play/stop/seek`, `clip_get_position`, max 8 clips, each stereo into own mixer bus, EOF = stop. Document overrun policy (drop-oldest vs stall). Tests: chunked continuity, gapless, concurrent clips, position accuracy. |
| 2.2 | #157 | Recorder capture taps — post-master FIFO + optional per-bus/dry taps, `jam-ring` mode (N-second always-on ring, one-click save). ABI: `nam_studio_capture_start/stop/drain`, `jam_ring_configure/save`. Tests: FIFO drain without alloc, ring wraparound, per-bus tap correctness. |
| 2.3 | #158 (cont.) | Extend api + realtime coverage for clips/capture (RT thread must not alloc/lock). |

**Dep:** 156 → 155/157.

**PR:** `feat/session-clips-capture` .

---

## Phase 3 — Songbook package + scheduler + soundfont bundling

| # | Issue | Deliverable |
|---|-------|-------------|
| 3.1 | #163 | New `packages/songbook` (TS, Vitest) — wraps `@coderline/alphaTab@1.8.x` (MPL-2.0, note in README). API: `parseScore(bytes|text)->ScoreSummary{title,tracks{instrument,channel,tuning}, bars, tempoMap, duration}`, `extractTrackEvents(score,trackIds,opts)->EventStream`. Fixture tests with small committed .gp5/.gpx/.musicxml/.mid (license-safe). No rendering (parsing only — keeps desktop/webview reuse clean). |
| 3.2 | #164 | Lookahead scheduler (`apps/web/src/engine/` shared or `packages/songbook` re-export) — converts `EventStream` + `transportPosition` + `tempoScale` into `ScheduledEvent{sampleOffset, midi}` for #153 queue. Handles loop range, tempo scaling, count-in. Tests: loop wrap, tempo scaling math, sample-offset quantization vs `AudioWorklet` quantum (128). |
| 3.3 | #165 | Soundfont bundling — pick compact MIT-licensed GM font (propose FluidR3_GM subset, ~15-30 MB → lazy-load from `apps/web/public/soundfonts/` + IndexedDB assets cache per `assetCache.ts` pattern). Settings entry for user-supplied SF2/SF3 (size limit like `assetLimits.ts`). Attribution in `THIRD_PARTY_NOTICES.md`. |

**PR:** `feat/songbook-scheduler-soundfont`.

---

## Phase 4 — Web + desktop wiring for the session ABI

| # | Issue | Deliverable |
|---|-------|-------------|
| 4.1 | #160 | Web: `RigWorkletNode.ts` + `namStudioRigWorklet.js` messages for SF2 bytes, schedule, transport, clips, bus params, capture drain. Mirror existing request-reply for `connect` + fire-and-forget for `set_param` pattern. Wire `get_bus_meter` polling. |
| 4.2 | #161 | Desktop: `apps/desktop/src/bridge.cpp` handlers — control-thread mutations + lock-free PCM rings for `clip_feed_pcm` / `capture_drain`. Same suspend handshake as existing `load_ir_wav` path. CTest for bridge. |
| 4.3 | #166 | Web songs store — IndexedDB `songs` store + library UI (import, list, search, rename, delete). File picker for .gp/.musicxml/.mid/.atex. |
| 4.4 | #167 | Desktop songs files — app-data dir storage, native open dialog + reveal-in-folder, bridge list/read/write/delete. Parity with web TS library model. |
| 4.5 | #159 (final) | Rebuild WASM with Phase 1–2 ABI, update drift-guards, `pnpm build` green. |

**PR:** `feat/session-web-desktop-wiring` (split 4.1/4.2 if large).

---

## Phase 5 — Player widget, sheet viewer, practice toolkit

| # | Issue | Deliverable |
|---|-------|-------------|
| 5.1 | #168 | Player widget — dockable panel (collapsible, coexists with grid): title, transport buttons, position bar w/ scrub, tempo 25–200%, loop range set/clear (bar-granular), track mute toggles. Space=play/pause, L=set loop. Selecting song → `scheduler` → transport. |
| 5.2 | #169 | Sheet viewer — alphaTab SVG rendering, track list solo/mute/volume, cursor sync with transport, zoom/layouts. Consumes `packages/songbook` + `ScoreSummary`. |
| 5.3 | #170 | Practice toolkit — speed trainer presets, section navigation, metronome + count-in, transpose. |
| 5.4 | #171 / #174 / #180 | Stretch within songs: tuner-awareness (derive tunings from score → `detect_pitch` ref), AlphaTex editor pane, lasso/clipboard — include only if "Everything" scope holds; otherwise defer to follow-up. |

**PR:** `feat/songs-player-sheet-practice`.

---

## Phase 6 — Session mixer UI + recorder

| # | Issue | Deliverable |
|---|-------|-------------|
| 6.1 | #203 | Session mixer UI — strips for Song/Grid/each Take with fader, pan, mute/solo, per-bus meters (from `get_bus_meter`). Pre-master sum visualization. |
| 6.2 | #187 | Record panel v1 — arm, source select (master / dry input / song-only / grid-only), timer, levels. |
| 6.3 | #188 | Takes store + manager — IndexedDB (web) / files (desktop), rename/delete/download/import. |
| 6.4 | #189 | WAV export — 16/24-bit int + 32f float, peak normalize option, valid RIFF headers. |
| 6.5 | #190 | MP3 via `lamejs` (LGPL — attribution per CONTRIBUTING) + Opus stretch. |
| 6.6 | #191 | Loop-jam — always-on N-second ring, one-click "save what I just played" (consumes #157 jam-ring). |
| 6.7 | #192 | Record-with-song — transport-linked recording, punch-in/out. |
| 6.8 | #193 | Overdub — layer takes while previous play back, per-take monitor mute. |
| 6.9 | #194 | Session persistence — save/load mixer state + song/take refs as reusable sessions (core model, front-end storage). |
| 6.10 | #196 | E2E — Playwright: record→stop→take appears→RIFF valid; fader affects bus meter. |

Order: 203 → 187 → 188 → 189 → 190/191 (parallel) → 192 → 193 → 194 → 196.

**PR(s):** `feat/mixer-record-panel` (6.1–6.4), `feat/recorder-loop-overdub` (6.5–6.8), persistence+E2E can be a third.

---

## Phase 7 — Docs, iOS stub, and release hardening

| # | Issue | Deliverable |
|---|-------|-------------|
| 7.1 | #162 | `ARCHITECTURE.md` — session layer rows in per-target table + migration order entry (where session sits between graph and presets). |
| 7.2 | #208 (deferred) | iOS bring-up — Xcframework + ObjC++ bridge + AVAudioEngine shell — tracked but not blocking this worktree's green. If "Everything" demands it, open `feat/ios-session` stacked after 4.2. |
| 7.3 | Drift & CI | Final `node scripts/gen-param-schema.mjs --check --target=automation-map`, `check-wasm-exports.mjs`, `sync-version.mjs --check`, `pnpm lint/format:check/build/test:run/test:e2e`, Storybook if tokens touched. |

---

## Stacked PR graph

```
dev
 └─ feat/media-play (integration, this worktree's main — not directly PR'd)
     ├─ PR1: feat/session-core-transport-mixer    (#152 #153 #154 #156 #158p #159p)
     ├─ PR2: feat/session-clips-capture           (#155 #157)
     ├─ PR3: feat/songbook-scheduler-soundfont    (#163 #164 #165)
     ├─ PR4: feat/session-web-desktop-wiring      (#160 #161 #166 #167 #159)
     ├─ PR5: feat/songs-player-sheet-practice     (#168 #169 #170 (+#171 #174 #180 if Everything))
     ├─ PR6a: feat/mixer-record-panel             (#203 #187 #188 #189)
     ├─ PR6b: feat/recorder-loop-overdub          (#190 #191 #192 #193 #194 #196)
     └─ PR7: docs/session-arch                     (#162 + drift)
```

Each PR rebases onto the previous; CI must be green before merging the next (avoids big-bang drift).

---

## Open questions resolved

- Q1 Scope → Full session (#204+#205+#207+#203), #273 excluded — confirmed.
- Q2 Stretch → Everything (loop-jam, overdub, MP3, persistence, iOS tracked) — confirmed.
- Q3 Base → `dev` — confirmed.
- Q4 PRs → Stacked per phase — confirmed.
- Q5 Desktop → Web + desktop together — confirmed.
- WASM → `emcc` on PATH — confirmed, rebuild in Phases 1 & 4.
- Vendors → TinySoundFont + alphaTab 1.8.x approved — confirmed.
- Plan location → `plans/media-play.md` — this file.

## Next step

Run `/start-phase 1` (or say "start phase 1") to kick off core song player + transport. Until then this worktree is plan-only — no code has been changed on `feat/media-play`.
