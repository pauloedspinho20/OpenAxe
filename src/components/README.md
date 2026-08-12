# UI / design system

The app is styled as a piece of hardware, not a website — a unibody chassis, tight machined-metal
spacing/radii, an LCD-style recessed readout, real fader caps instead of `<input type="range">`
chrome, and a single signature accent color used sparingly (teenage engineering-inspired: minimal,
high-contrast, one accent, technical monospace labels everywhere a real product would silkscreen a
name onto its panel).

This pass added the design system, primitive component library, the core dual-chain layout wired
to real state, two hardware finishes (light/dark), and made loading actually work: local `.nam`
model files, cabinet IR files, and adding/bypassing/removing effects in the FX slots. Still open
on this epic: a first-run onboarding walkthrough, per-chain live meters, Tone3000-backed model
browsing (currently local-file-only), and a full accessibility/responsive audit. See "what's
deferred" at the end.

## Design tokens (`src/index.css`) — two finishes, not a website's light/dark mode

"Carbon" (dark, TX-6-style unibody) and "Aluminum" (light, OP-1-style brushed finish) — picked via
`useTheme` and applied as `data-theme="dark"|"light"` on `<html>`, **not** derived from
`prefers-color-scheme`. A physical device doesn't relight itself for the OS's setting; the user
picks a finish and it's persisted (`localStorage`), same as they'd pick a physical color option
when buying the hardware.

Tokens: `--chassis`/`--panel`/`--panel-raised`/`--panel-recessed` (surfaces, darkest to lightest -
theme-dependent), `--ink-1/2/3` (text, brightest to dimmest - theme-dependent), `--screen-bg`/
`--screen-text`/`--screen-dim` (LCD readouts - **always dark glass in both finishes**, since a real
device's screen doesn't turn white when the case does), `--accent` (the one signature color, same
in both finishes, used only for active/engaged state, never decoration), `--led-on`/`--led-warn`/
`--led-hot` (status colors), `--font-display` (monospace, for every label/readout/wordmark), plus a
4px spacing scale (`--sp-1`..`--sp-7`) and small machined radii (`--r-sm`/`--r-md`/`--r-lg` -
3/6/10px, not the soft rounded corners typical of web apps).

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
moment a rig exists. The IR-mix knob and the amp-model/cab-IR readouts need the `rig` prop, since
that state lives on `AmpCabChain`, not the store; loading either needs the raw `AudioContext` too
(for `decodeAudioData`), so `ChannelStrip` also takes a `context` prop passed straight from
`useAudioEngine`.

**Loading a model or IR is local-file-only for now** (no Tone3000 browsing yet): the "Amp Model"
and "Cab IR" screens are buttons that open a native file picker (`.nam` / audio file respectively)
via a hidden `<input type="file">`; on selection, `AmpCabChain.loadModel`/`loadIR` runs and the
screen updates to show the loaded filename, or a red error line below if it fails (e.g. a malformed
`.nam` file). Both are disabled (and say why, via `title`) until the engine is powered on.

**FX slots are functional**: each of the 3 slots per row is either an empty `+` button, a
`<select>` of all 10 built effect kinds (appears in place of the slot when you click `+`), or a
filled slot showing the effect's name (click to bypass - bypassed effects show struck-through) and
a `×` to remove it. Backed directly by `rig.preFx(chain)`/`postFx(chain)` (`EffectsChain.insert`/
`remove`, `effectRegistry.createEffect`) - `ChannelStrip` mirrors the chain's effect list in local
state purely to trigger re-renders, since `EffectsChain` itself has no change-notification
mechanism and `ChannelStrip` is presently the only thing that mutates it during a session.

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
to its exact initial state.

Loading, FX slots, and theming were verified in a second pass: loaded a real `.nam` model and a
real IR file (simulated file-picker selection via `DataTransfer` + a dispatched `change` event,
since headless browser automation can't drive a native OS file dialog) and confirmed each chain's
screen updates independently and the audio graph actually receives them (`AmpCabChain` logs
confirmed IR decode). Added a Drive effect to a Pre FX slot, toggled its bypass (label struck
through, title updated), and removed it (`EffectsChain.remove` + `effect.dispose()` both fired).
Toggled the "Aluminum" switch and confirmed `data-theme` and computed background color both flipped
correctly, in both directions.

**A caught-and-fixed test artifact, not an app bug**: an early IR-load attempt appeared to silently
fail (screen stayed on "NO IR LOADED", no error shown). Tracing confirmed the cause was a stale
`amp`/`context` prop caused by editing a file mid-session, which triggers React Fast Refresh to
remount the whole tree and reset the (in-memory) engine state back to `'off'` - not a defect in the
loading code, which worked correctly once retested without an edit in between. This session
overall surfaced real flakiness in the browser automation tooling itself (synthetic clicks not
reaching elements, stale accessibility-tree refs, a screenshot scaling bug, this HMR-reset
scenario) - resolved each time by cross-checking against `getBoundingClientRect()`, direct DOM
state reads, and console tracing rather than trusting any single capture or test run.

## What's deferred (still open on the UI/UX epic)

- **Tone3000-backed model/IR browsing** — loading is local-file-only for now (see above). Browsing
  and importing from Tone3000's catalog is the Tone3000 Integration epic's job.
- **Effect parameter editing** — a filled FX slot can be bypassed or removed, but its parameters
  (e.g. a Drive's gain, an EQ's bands) aren't editable from the UI yet; effects load with their
  class defaults. Every effect's `getParams()`/`setParams()` already exists (Effects Suite epic) -
  this is purely the missing per-effect control UI.
- **Effect reordering** — `EffectsChain.move()` exists and is tested, but there's no drag-and-drop
  (or any UI) wired to it yet.
- **First-run onboarding** — the power-on button _is_ the audio-permission moment, but there's no
  explanatory first-run walkthrough yet.
- **Per-chain live meters** — only the master output has a `LiveMeter`; tapping each chain's own
  output for individual meters needs a small `DualChainRig` API addition (an exposed pre-master tap
  point per side).
- **Full accessibility/responsive audit** — primitives are keyboard-accessible individually and
  there's a single-column mobile breakpoint, but neither has had a dedicated pass yet (screen
  reader flow across the whole rack, touch target sizing, tablet layout).
