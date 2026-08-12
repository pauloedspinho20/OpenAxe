# UI / design system

The app is styled as a piece of hardware, not a website — a dark unibody chassis, tight
machined-metal spacing/radii, an LCD-style recessed readout, real fader caps instead of `<input
type="range">` chrome, and a single signature accent color used sparingly (teenage
engineering-inspired: minimal, high-contrast, one accent, technical monospace labels everywhere a
real product would silkscreen a name onto its panel).

This is the first pass on the UI/UX epic — the design system, primitive component library, and
the core dual-chain layout wired to real state. Still open on this epic: the effect
browsing/patching UI (FX slots are visual placeholders for now), a first-run onboarding
walkthrough, per-chain live meters, and a full accessibility/responsive audit. See the "what's
deferred" section at the end.

## Design tokens (`src/index.css`)

A fixed dark theme — deliberately **not** responsive to `prefers-color-scheme`. A physical device
doesn't relight itself for the OS's light/dark setting, and this app is meant to read as one.
Tokens: `--chassis`/`--panel`/`--panel-raised`/`--panel-recessed` (surfaces, darkest to lightest),
`--ink-1/2/3` (text, brightest to dimmest), `--accent` (the one signature color — used only for
active/engaged state, never decoration), `--led-on`/`--led-warn`/`--led-hot` (status colors),
`--font-display` (monospace, for every label/readout/wordmark — this is what makes it read as
hardware silkscreen rather than website copy), plus a 4px spacing scale (`--sp-1`..`--sp-7`) and
small machined radii (`--r-sm`/`--r-md`/`--r-lg` — 3/6/10px, not the soft rounded corners typical
of web apps).

## Primitives (`src/components/primitives/`)

Every primitive is presentational (no direct engine/store dependency) so they're reusable and
independently verifiable.

- **`Knob`** — a custom SVG rotary control, not a styled native input (no native element has a
  270° rotary drag gesture). Drag vertically to turn — the standard hardware/DAW gesture, not
  drag-in-a-circle, which is awkward with a mouse. Hold Shift while dragging for 4x finer control.
  Double-click resets to `defaultValue`. Full keyboard support (arrows/PageUp/PageDown/Home/End),
  `role="slider"` with proper `aria-value*`. Verified by dispatching real `PointerEvent`s and
  `KeyboardEvent`s in a live browser session — synthetic mouse-based drag simulation doesn't
  trigger Pointer Events, which is a testing-tool gap, not a component one.
- **`Fader`** — a vertical fader built on a real `<input type="range">` (native keyboard/touch
  support for free), styled via `writing-mode: vertical-lr` plus custom track/thumb pseudo-elements
  so it reads as a recessed slot with a cap, not a browser slider.
- **`HardwareButton`** — a tactile rack button; `active` lights it in an accent or danger color
  glow, like an engaged pedal.
- **`Led`** — a small status light (color-coded, glows when `on`).
- **`Meter`** — a segmented VU-style level meter (green → amber → red near the top), purely
  presentational (`level: number` in). `LiveMeter` (in `src/components/`) wraps it with a real
  `AnalyserNode` read via its own `requestAnimationFrame` loop and local state, so ~60fps updates
  don't re-render anything outside that one component.
- **`Toggle`** — a rocker switch (`role="switch"`).
- **`Panel`** — the rack-module container everything else sits in: raised-panel gradient, hairline
  border, drop shadow, an optional header (label + corner slot for e.g. a status LED), and four
  small corner "screws" for the hardware-detail touch.

## Layout (`src/App.tsx`, `src/components/`)

```
Header (wordmark, power status, power button)
SignalFlow (schematic IN -> [Chain A / Chain B] -> MASTER -> OUT diagram)
┌─────────────┐  ┌─────────────┐
│  ChannelStrip│  │  ChannelStrip│   <- one per chain: amp/cab "screen", pre/post FX slots,
│      A       │  │      B       │      IR mix knob, level fader + pan knob + mute/solo
└─────────────┘  └─────────────┘
MasterSection (master knob, live output meter, link toggle)
Footer
```

`ChannelStrip`'s level/pan/mute/solo controls read and write `dualChainStore` directly (not through
a `rig` prop) — the store is the source of truth regardless of whether the engine is powered on;
`bindDualChainRig` (from the Audio Engine Core epic) applies whatever the store already holds the
moment a rig exists. Only the IR-mix knob and the amp-model readout need the `rig` prop, since that
state lives on `AmpCabChain`, not the store.

## `useAudioEngine` — the power-on flow

Owns the `AudioContext`/`NamEngine`/`DualChainRig` lifecycle behind an explicit "Power on" button
rather than creating an `AudioContext` on page load — browsers require a user gesture to start one
anyway, so this doubles as the natural moment to also ask for microphone access.

**Mic access is best-effort and non-blocking.** The engine reaches `'ready'` (rig created, store
bound, ready to load models/presets) as soon as the rig itself exists; the `getUserMedia()` call
runs in the background afterward and just flips `micGranted` on if/when it resolves. This was a
real bug caught during manual testing, not a hypothetical: the first version awaited
`getUserMedia()` before setting `'ready'`, so a permission prompt the user (or a sandboxed
environment) never answers left the whole engine stuck at `'starting'` forever with no feedback.
Now the rig is usable immediately regardless of what the mic prompt does.

## Verified manually

Full power-on flow traced end-to-end in a live browser session: `AudioContext` → `NamEngine.attach`
→ `DualChainRig.create` → store binding → graceful mic-denial handling (`NotAllowedError` caught,
`micGranted` stays false, engine still reaches `'ready'`) — confirmed via console tracing after the
non-blocking-mic fix. Verified the Master knob drag updates both the displayed value and the live
rig's master gain via `bindDualChainRig`. Power-off cleanly tears everything down and returns the UI
to its exact initial state. Also hit real automation-tool flakiness in this session (synthetic
clicks not reaching elements, stale accessibility-tree refs, a scaling bug in screenshot capture)
that looked like app bugs at first — resolved by cross-checking against `getBoundingClientRect()`
and direct DOM state reads rather than trusting any single capture.

## What's deferred (still open on the UI/UX epic)

- **Effect browsing/patching UI** — Pre/Post FX slots are dashed placeholders (`+`), not
  functional yet. The underlying capability (`EffectsChain.insert/remove/move`,
  `effectRegistry.createEffect`) is fully built (Effects Suite epic); this is purely the UI to
  browse/add/reorder effects visually.
- **First-run onboarding** — the power-on button _is_ the audio-permission moment, but there's no
  explanatory first-run walkthrough yet.
- **Per-chain live meters** — only the master output has a `LiveMeter`; tapping each chain's own
  output for individual meters needs a small `DualChainRig` API addition (an exposed pre-master tap
  point per side).
- **Full accessibility/responsive audit** — primitives are keyboard-accessible individually and
  there's a single-column mobile breakpoint, but neither has had a dedicated pass yet (screen
  reader flow across the whole rack, touch target sizing, tablet layout).
