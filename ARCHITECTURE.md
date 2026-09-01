# Architecture: one C++ engine, four front ends

OpenAxe ships (or plans to ship) as a web app, a native desktop app, a
VST3/CLAP/AU plugin, and mobile apps. They are four shells around **one**
audio engine: `packages/core`, C++20, no platform APIs, no UI.

The rule this codebase is converging on:

> **All application logic lives in `packages/core`. A front end owns
> presentation, device/host integration, and persistence plumbing — nothing
> that decides how the rig sounds or behaves.**

"Logic" here means anything a second front end would otherwise have to
reimplement: DSP, signal routing and its rules, param semantics and ranges,
model/IR loading, metering, and the mapping between what a user sees and what
the DSP does.

## Layers

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Presentation      apps/web (React) · desktop webview · VST3 editor ·     │
│                   iOS/Android views — all sharing packages/ui tokens     │
├──────────────────────────────────────────────────────────────────────────┤
│ Integration       Web Audio worklet · JUCE audio_devices + window.openAxe bridge  │
│                   · iPlug2 processor · JNI / AVAudioEngine               │
├──────────────────────────────────────────────────────────────────────────┤
│ Engine ABI        packages/core/include/openaxe/api.h — extern "C",   │
│                   int ids, float params, no exceptions, no allocation on │
│                   the real-time path                                     │
├──────────────────────────────────────────────────────────────────────────┤
│ Core              graph_rig · graph_validation · engine · dsp/*          │
└──────────────────────────────────────────────────────────────────────────┘
```

Every front end talks to the same `extern "C"` surface. It is deliberately
narrow (int block ids, float params, out-params instead of exceptions) so it
survives WASM, FFI, JNI, and a plugin host equally well.

### What the ABI already covers

Topology (`add_block`/`connect`/`move_block`, with validation), params by index
plus metadata (`block_param_info`), NAM model load/unload, reverb algorithm
choice **and** the user-facing reverb control mapping (`set_reverb_control`),
delay models, per-block bypass and I/O trims, master level/mute, per-block
meters, and CPU load.

### What a front end is still allowed to own

- Device and host integration: Web Audio graph plumbing, JUCE audio_devices streams, the
  plugin's process callback.
- Persistence _mechanism_: IndexedDB in the browser, a shared on-disk store
  for the desktop app and the plugins, host state chunks for a plugin's rig.
  See [Persistence](#persistence) — which mechanism is available is not a
  free choice, it follows from what a webview can actually keep. The preset
  _model_ belongs in core (see below).
- Rendering, layout, interaction, theming — `packages/ui` and the design
  tokens.
- Network services with no audio meaning (the Tone3000 model library client).

## Per-target status

| Concern                      | Web                                                 | Desktop                            | VST3/CLAP/AU                                       | Owner it should have                 |
| ---------------------------- | --------------------------------------------------- | ---------------------------------- | -------------------------------------------------- | ------------------------------------ |
| DSP effects                  | core via the rig worklet                            | core, in-process                   | core, in-process                                   | core ✅                              |
| Amp (NAM inference)          | core's `NamAmp` via the rig worklet                 | core's `NamAmp`                    | core's `NamAmp`                                    | core ✅                              |
| Amp tone stack               | core (`tone_stack.cpp`) via the rig worklet         | core                               | core                                               | core ✅                              |
| Signal graph + routing rules | core `graph_rig` (single rig worklet)               | core `graph_rig`                   | core `graph_rig`                                   | core ✅                              |
| Reverb control mapping       | core (`set_reverb_control`)                         | core                               | core                                               | core ✅                              |
| Block I/O trims              | core trims via the rig worklet                      | core trims                         | core trims                                         | core ✅                              |
| Bypass / master bus          | core via the rig worklet                            | core                               | core                                               | core ✅                              |
| Cab / IR convolution         | core (`convolver.cpp`) via the rig worklet          | core, IR decoded by `wav.cpp`      | core, via `loadIrWav`                              | core ✅                              |
| Tuner pitch detection        | core via WASM, TS fallback kept for tests           | core (`openaxe_detect_pitch`)      | core, fed by the monitor tap                       | core ✅                              |
| Metering                     | core peak (`get_meter`) via the rig worklet         | core peak + a synthesized waveform | core peak + `MonitorTap` (seqlock ring)            | core ✅                              |
| Param ranges                 | hand-written in `paramSchema.ts`, guarded by a test | core table                         | core table + generated automation map              | **generated from core** ⚠️           |
| Input channel routing        | Web Audio splitter/merger                           | not offered (device layer)         | host bus → `input_routing.cpp`, in the state chunk | front end ✅                         |
| Host automation              | n/a                                                 | n/a                                | generated slot map, params reported to host        | core ✅                              |
| MIDI mapping                 | TS Web MIDI → core mapping model                    | core mapping model                 | host MIDI bus → core, sample-accurate              | core ✅                              |
| Rig state (save/restore)     | browser store                                       | browser store                      | core state doc in the host chunk (authoritative)   | core ✅                              |
| Presets / scenes / bank      | TS model + IndexedDB                                | TS model + shared on-disk store    | TS model + the same shared store                   | **core model**, front-end storage ❌ |
| Library, prefs, asset cache  | IndexedDB + localStorage                            | shared on-disk store               | the same shared store                              | front end ✅                         |

✅ done · ⚠️ core owns it, a front end still duplicates part · ❌ not in core yet

## Migration order

Each step is useful on its own and unblocks the plugin target.

1. ~~**Amp on one engine.**~~ Done: the web path runs core's `NamAmp`, and the
   `neural-amp-modeler-wasm` npm package is gone - web and desktop no longer run
   different inference code. It also needed `openaxe_load_nam_model_json` (a
   browser has no filesystem to hand a path to), which the desktop bridge now
   uses too rather than staging a temp file.
2. ~~**One graph.**~~ Done: the web path drives core's `graph_rig` from a single
   rig worklet (`wasm-core/openAxeRigWorklet.js`) that owns one `openaxe_core`
   module and one `openaxe_graph` for the whole rig, replacing the per-effect
   worklets and the TS Web Audio node graph. The trims, bypass, master bus,
   mixer per-input level/pan, splitter per-output level, routing validation and
   metering all collapsed into the engine in one move - `GraphRig.ts` is now a
   thin driver (mirroring `NativeGraphRig`), `graphValidation.ts` is a UI
   pre-check kept in lock-step with `graph_validation.cpp` by mirrored tests, and
   the per-effect worklets are deleted. This is the step the plugin needs, since
   a VST3 has no Web Audio to fall back on.
3. ~~**Convolution in core.**~~ Done: `dsp/convolver.cpp` is a zero-latency
   partitioned convolver, and `dsp/wav.cpp` decodes and resamples IR files
   for the platforms with no `AudioContext.decodeAudioData` - so the desktop app
   loads IRs by handing the core the file's bytes
   (`openaxe_load_ir_wav`), exactly as it loads NAM models. The audio path now
   has no web-only DSP left.
4. ~~**Tuner in core.**~~ Done (issue #123): `dsp/pitch_detect.cpp` is the one
   detector, compiled to WASM for the web and called natively on
   desktop/plugin. `pitchDetect.ts` is now a thin forwarder that keeps the
   original TS algorithm only as a deterministic fallback for tests and for
   the window before the WASM module is ready. It is not in the audio path,
   so it costs no latency either way.
5. **Preset/scene model in core**, with front ends supplying only storage.
   Half done: the _rig_ state document is core's
   (`openaxe_load_state`/`save`), which is what the plugin writes into the
   host chunk and what makes the core graph authoritative in a DAW. The
   preset bank, scene bank and their slot semantics are still the TS model in
   `apps/web/src/presets` and `apps/web/src/scenes`.
6. **Generate the UI's param ranges** from `packages/core/param_schema.json`
   instead of hand-maintaining them in `paramSchema.ts`
   (`paramSchema.coreDrift.test.ts` guards the gap until then).
7. ~~**MIDI mapping in core.**~~ Done (issue #124): the mapping model, learn
   and dedupe live in core, bindings ride the rig state document (so they
   survive a DAW session), and the plugin declares a MIDI input bus and
   forwards the host's event list sample-accurately. The web path feeds the
   same core model from Web MIDI.

## Latency

The engine's own contribution is zero: `latency_test` pushes an impulse through
a rig and confirms the DSP path adds no delay — no lookahead, no latency
compensation to report to a host. Everything a user feels comes from the I/O
layer.

| Target  | What sets latency                                                                           | Lowest available                                                                                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop | JUCE audio_devices block size + the device's own buffering                                  | `bufferFrames: 0` asks the device for its smallest block; default is 128 frames ≈ 2.7ms one-way at 48kHz. `getConfig()` reports the backend's measured round-trip.                                                                            |
| Web     | The 128-frame AudioWorklet render quantum, plus the context's `baseLatency`/`outputLatency` | Fixed by the platform. `latencyHint: 'interactive'` is what the app requests; chaining worklet nodes adds **no** extra latency (they all run inside one quantum), so the win from step 2 above is CPU and behaviour parity, not milliseconds. |
| VST3    | The host's block size                                                                       | Nothing to add: report zero latency and process in place.                                                                                                                                                                                     |

Rules that keep it that way:

- **Never allocate, lock, or do IO on the audio thread.** Params reach the
  audio thread as plain atomics; anything that allocates (model loading,
  algorithm switches, buffer resizes) happens on the control thread with audio
  suspended. Each core function's comment states which side it belongs on.
- **Don't resample if you can avoid it.** Desktop falls back to the device's
  preferred rate rather than forcing 48kHz through the OS resampler.
- **Ask for real-time scheduling.** The desktop stream sets
  `RTAUDIO_SCHEDULE_REALTIME` with an explicit high priority for the backends
  that schedule their own callback thread.

## Persistence

Which storage a shell uses is not a free choice — it follows from what a
webview can actually keep.

**The web** uses IndexedDB and localStorage, and always has. Nothing below
changes that: `getOpenAxe()` is null in a browser, so every store takes the
same path it always took.

**The desktop app and the plugins cannot.** Two independent reasons, and both
have to be dealt with:

1. The UI server binds a port, and the webview's origin is
   `http://127.0.0.1:<port>`. When that port was ephemeral the origin was
   different on every launch, and IndexedDB and localStorage are scoped to an
   origin — so every launch got an empty partition. Nothing was lost, exactly;
   it was stranded under an origin nothing would visit again. This is why the
   factory pack appeared to need reinstalling every time the app started. The
   server now prefers a fixed port (`kPreferredPorts`) so the origin is
   stable.
2. WKWebView and WebView2 scope website data to the **host application**. The
   desktop app's lives under `com.openaxe.desktop`; a plugin's lives under
   whatever the DAW is, a different container per DAW. So a stable port fixes
   (1) but can never let the desktop app and a plugin see one library.

Hence a filesystem store both shells reach —
`packages/shared/src/app_storage.cpp`, under the platform's per-user
application data directory. The UI talks to it through the `openAxe.storage*`
and `openAxe.asset*` bridge calls, which `storage_bridge.cpp` implements once
for both shells. This is the same conclusion `secure_storage` reached earlier
for the Tone3000 refresh token, whose header already documented the
ephemeral-port problem.

What lives where:

| Data                                       | Web          | Desktop + plugins                     |
| ------------------------------------------ | ------------ | ------------------------------------- |
| Presets, scene bank, preset bank, MIDI map | IndexedDB    | shared store, one record per key      |
| Tone3000 library metadata                  | IndexedDB    | shared store                          |
| Cached `.nam` / IR blobs                   | IndexedDB    | shared store, fetched via `/__asset/` |
| Theme, onboarding, factory-setup flag, I/O | localStorage | localStorage, mirrored to the store   |
| Tone3000 refresh token                     | localStorage | OS keychain (never the shared store)  |
| The rig itself, in a plugin                | n/a          | core state doc in the host chunk      |

Three details that are easy to get wrong:

- **Asset blobs do not ride the bridge on read.** The loopback server serves
  `GET /__asset/<key>` so the webview streams bytes straight into a Blob;
  base64 through the bridge would inflate every capture by a third. The
  bridge remains the fallback for when there is no such server (running a
  shell against a Vite dev server via `OPENAXE_UI_URL`).
- **Preferences stay synchronous.** Theme, onboarding and the factory-setup
  flag are read during the first render, so `prefsMirror.ts` copies the
  shared store into localStorage _before_ React mounts and mirrors writes
  back out, rather than making a dozen hooks async for a few bytes.
- **The plugin's bridge surface is a hand-written list.** The plugin has no
  `webview::bind`; `bridge_polyfill.cpp` defines one stub per name in a
  literal array. A handler added to `VstBridge` but not named there does not
  exist as far as the UI is concerned — and since the app reads "no bridge
  method" as "we must be on the web", it silently falls back to browser
  storage. `scripts/check-bridge-methods.mjs` guards that gap.

## Adding to the core

- Put it in `packages/core`, with a test in `packages/core/tests`, before any
  front end learns about it.
- Extend `api.h` with the same shape as its neighbours (int ids, float values,
  no exceptions) and note its threading contract in the comment.
- If it's a user-facing control that doesn't map 1:1 onto a DSP param — like
  the reverb's room size — resolve that **in core** (`ReverbControl` is the
  pattern), not in each front end.
- Params come from `packages/core/param_schema.json`; run
  `node scripts/gen-param-schema.mjs` and commit the generated files (CI fails
  on drift).
- Two WASM build requirements that fail _silently_ if forgotten: the module is
  linked **whole-archive** (NAM's architecture parsers self-register via static
  initializers, and a plain link drops them - every model load then fails with a
  generic "bad model"), and it is compiled with **`-fexceptions`** (Emscripten
  disables exceptions by default, so the `throw` NAMCore uses to report a bad
  model aborts the whole AudioWorklet instead of being caught and turned into an
  error code).
- New ABI a browser needs must be added to `EXPORTED_FUNCTIONS` in
  `packages/core/CMakeLists.txt`, then `scripts/build-core-wasm.sh` re-run and
  the artifacts committed — nothing rebuilds them automatically.

## Diagrams

Rendered inline by GitHub (Mermaid). Same content as the sections above, in
picture form — added during the OpenAxe rebrand (issue #151).

### One engine, four shells

```mermaid
flowchart TB
    subgraph shells["Presentation + integration (four shells)"]
        WEB["apps/web<br/>React SPA<br/>AudioWorklet + WASM"]
        DESK["apps/desktop<br/>C++ webview shell<br/>JUCE audio_devices"]
        VST["packages/vst3<br/>plugin editor + processor"]
        MOBILE["apps/ios · apps/android<br/>SwiftUI / Compose"]
    end

    ABI["packages/core/include/openaxe/api.h<br/>extern 'C' ABI<br/>int ids · float params · no exceptions"]

    subgraph core["packages/core (the one engine)"]
        GR["graph_rig<br/>topology + routing rules"]
        ENG["engine<br/>live DSP + meters"]
        DSP["dsp/*<br/>NamAmp · convolver · effects"]
        VAL["graph_validation"]
    end

    WEB -- "rig worklet calls _openaxe_*" --> ABI
    DESK -- "in-process calls" --> ABI
    VST -- "in-process calls" --> ABI
    MOBILE --> ABI
    ABI --> GR --> ENG --> DSP
    GR --> VAL
```

The desktop shell and the plugin editor are the _same_ React SPA: each serves
`apps/web/dist` over a loopback HTTP server and points a webview at it, with a
`window.openAxe.*` bridge standing in for Web Audio. That is why they share a
storage problem, and now a store.

### Where persisted data actually goes

```mermaid
flowchart TB
    subgraph ui["The one React app, in three shells"]
        KV["storage/kv.ts<br/>get · put · delete · getAll · clear"]
        AC["engine/assetCache.ts<br/>.nam + IR blobs"]
        PM["storage/prefsMirror.ts<br/>keeps localStorage synchronous"]
    end

    BROWSER["IndexedDB + localStorage<br/>scoped to the page origin"]

    subgraph shells["Native shells"]
        BRIDGE["window.openAxe.storage* / asset*<br/>storage_bridge.cpp, shared by both"]
        HTTP["loopback server<br/>GET /__asset/:key"]
    end

    STORE[("app_storage<br/>~/Library/Application Support/OpenAxe/data<br/>%APPDATA% · $XDG_DATA_HOME")]
    KEYCHAIN[["OS keychain<br/>Tone3000 refresh token"]]
    CHUNK[["DAW session chunk<br/>the rig, from core"]]

    KV -- "web" --> BROWSER
    AC -- "web" --> BROWSER
    KV -- "desktop · plugin" --> BRIDGE
    AC -- "writes" --> BRIDGE
    AC -- "reads, streamed" --> HTTP
    PM -- "hydrate at boot,<br/>mirror on write" --> BRIDGE
    BRIDGE --> STORE
    HTTP --> STORE
    BRIDGE -. "never mirrored" .-> KEYCHAIN
    CHUNK -. "plugin only:<br/>core graph is authoritative" .-> STORE

    DESKTOP_APP["desktop app"] --> STORE
    PLUGIN_A["plugin in DAW A"] --> STORE
    PLUGIN_B["plugin in DAW B"] --> STORE
```

One store, reached by every native shell — which is the point: the desktop app
and a plugin instance in any DAW see the same presets, the same library and the
same factory pack. The browser keeps its own, because a web page has no
filesystem to share.

### Core engine: signal, params, and assets

```mermaid
flowchart LR
    subgraph fe["Front end (web worklet / desktop bridge)"]
        UI["user gesture"]
    end

    subgraph abi["extern 'C' boundary"]
        SETP["openaxe_set_param"]
        ADD["openaxe_add_block / connect"]
        LOAD["openaxe_load_nam_model_json<br/>openaxe_load_ir_wav"]
        PROC["openaxe_process"]
    end

    subgraph engine["AudioEngine (control thread unless noted)"]
        TOPO["graph_rig: block placement,<br/>edge validation, semi-smart wiring"]
        PARAM["param tables<br/>(param_schema.json generated)"]
        ASSETS["NamAmp model load · wav decode +<br/>resample · convolver partitioning"]
    end

    RT["real-time path: atomics in,<br/>float buffers out, no allocation"]

    UI --> SETP --> PARAM --> RT
    UI --> ADD --> TOPO
    UI --> LOAD --> ASSETS
    TOPO --> RT
    ASSETS --> RT
    PROC --> RT
```

### Design system: token pipeline

```mermaid
flowchart TB
    DT["packages/ui/tokens/design-tokens.json<br/>(transcribed source of truth)"]
    CSS["CSS custom properties<br/>(packages/ui/*.css, live runtime source)"]
    UI["packages/ui components<br/>primitives: Knob · Fader · Led · Meter ·<br/>Toggle · HardwareButton · Panel"]
    SB[".storybook<br/>(component workbench)"]
    FUT["future generators:<br/>C++ (VST3) · Kotlin (Android) · Swift (iOS)"]

    DT -- "transcription (generator =<br/>future work, issue #13/#21)" --> CSS
    CSS --> UI --> SB
    DT -.-> FUT
```
