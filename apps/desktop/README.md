# apps/desktop

Native desktop shell (macOS, Windows, Linux) for OpenAxe (issue #15).

## Architecture

- **Shell:** [webview/webview](https://github.com/webview/webview) (C++,
  MIT) — the OS webview (WKWebView on macOS, Edge WebView2 on Windows,
  WebKitGTK on Linux). The React UI runs inside it.
- **DSP:** `packages/core`'s `openaxe_core` static library + `extern "C"`
  ABI — same process as the audio, no IPC.
- **Audio I/O:** JUCE `juce_audio_devices` (issue #15 M1) — CoreAudio / WASAPI / ALSA (see `src/audio.*`) —
  WASAPI / ALSA / JACK, fetched via CMake. The real-time callback calls
  `nam_studio_process` directly: same process, zero IPC, no Web Audio.
- **Tests:** `cmake -S apps/desktop -B build -DOPENAXE_DESKTOP_BUILD_TESTS=ON` builds `audio_io_test`
  (`ctest --test-dir build`). The callback wiring is tested with fake buffers
  (no hardware needed); the open/start/stop test uses a real device pair when
  the host has one and skips otherwise, so CI stays green headless.

## Build & run

Requires CMake 3.24+ and a C++20 compiler (Xcode Command Line Tools on
macOS; WebKitGTK dev packages on Linux; VS2022 / MinGW-w64 on Windows).

```sh
pnpm dev:desktop        # Debug build + launch
pnpm build:desktop      # Release build only
```

The CMake project is also self-contained:

```sh
cmake -S apps/desktop -B apps/desktop/build -DCMAKE_BUILD_TYPE=Debug
cmake --build apps/desktop/build
```

Binary output: `apps/desktop/build/bin/openaxe_desktop`.

## Useful commands

```sh
pnpm dev:desktop                               # Debug build + bundle UI + launch the window
pnpm --filter @openaxe/desktop dev:fast            # same, reusing the UI already in build/ui (C++-only changes)
pnpm dev:desktop:attach                        # launch against the Vite dev server (HMR) - see "Running alongside the web app"
pnpm build:desktop                             # Release build + bundle UI
pnpm package:desktop                           # build + CPack -> build/openaxe-desktop-<v>.dmg|.zip|.deb
pnpm --filter @openaxe/desktop exec tsc -b         # typecheck (the shared apps/web TS)
pnpm --filter @openaxe/web test:run src/native     # run the NativeGraphRig unit tests
```

### Running alongside the web app

The two apps are independent processes and can run at the same time — the
desktop app serves its bundled UI on an _ephemeral_ loopback port, so it never
competes with Vite's 5173:

```sh
pnpm dev:all            # Vite dev server + native app, in parallel
```

For UI work, skip the bundle step entirely and point the webview at the running
dev server, which gives the native window Vite HMR while still talking to the
real C++ engine over `window.openAxe` (the bridge binds live on the webview,
not on the page's origin):

```sh
pnpm dev:web            # terminal 1 - http://localhost:5173
pnpm dev:desktop:attach # terminal 2 - OPENAXE_UI_URL=http://localhost:5173
```

Any URL works: `OPENAXE_UI_URL=<url> ./build/bin/openaxe_desktop`, or
`node scripts/dev.mjs --ui-url=<url>`. When it is set, the bundled-UI lookup and
the built-in HTTP server are skipped.

### C++ tests

```sh
cmake -S apps/desktop -B apps/desktop/build -DOPENAXE_DESKTOP_BUILD_TESTS=ON -DCMAKE_BUILD_TYPE=Debug
cmake --build apps/desktop/build
ctest --test-dir apps/desktop/build --output-on-failure   # audio_io, bridge, latency
```

### Editor

The same build/test/package/dev commands are also exposed as VSCode tasks
(`Cmd/Ctrl+Shift+P → Run Task → "Desktop: …"`) in `.vscode/tasks.json`, plus
"Desktop: Full check" (build + C++ tests + web tests) and "Dev: web + desktop
(parallel)" / "Build: web + desktop" for running or building both apps at once.

## Debugging

A random crash is usually one of three things: a Web Audio / bridge call in the
React UI, a race between the audio callback and a graph mutation, or the
real-time thread blocking. These tools tell you which:

```sh
# 1. Log file - mirrors stderr and gets a backtrace appended on a segfault/abort.
cat apps/desktop/build/bin/openaxe_desktop.log

# 2. Webview devtools + verbose logging (WKWebView remote inspector).
OPENAXE_DESKTOP_DEBUG=1 pnpm dev:desktop
#    Then in Safari: Develop -> your Mac -> the WKWebView page, for JS console errors.

# 3. macOS crash report (crashing thread + full stack, captured by the OS).
ls -t ~/Library/Logs/DiagnosticReports/openaxe_desktop-*.crash

# 4. lldb live backtrace.
cd apps/desktop && lldb -- build/bin/openaxe_desktop   # run -> (crash) -> bt
```

Env vars: `OPENAXE_DESKTOP_DEBUG=1` enables the webview inspector and verbose
logging; `OPENAXE_DESKTOP_LOG=<path>` overrides the log file location (default:
`<exeDir>/openaxe_desktop.log`); `OPENAXE_UI_DIR=<dir>` overrides where the
bundled UI is found; `OPENAXE_UI_URL=<url>` loads the UI from a URL (dev
server) instead of the bundled copy.

## Status

- [x] M0 — shell scaffold: window + webview + core link + `namVersion` JS
      bridge demo (placeholder HTML).
- [x] M1 — JUCE audio_devices duplex I/O (`AudioIO` in `src/audio.*`), device
      enumeration, buffer/sample-rate control, DSP driven from the callback.
- [x] M2 — full `window.openAxe.*` JS↔C++ bridge (`StudioBridge` in
      `src/bridge.*`): devices, stream control, graph topology, params,
      NAM model loading via native file dialog, meters/CPU. Threading:
      control-thread executor serializes mutations under an audio suspend
      handshake; lock-free params run on the UI thread.
- [x] M3 — reuse the apps/web React UI. `NativeGraphRig` (apps/web/src/native)
      implements `GraphRigControls` over the bridge; `useAudioEngine` dispatches
      to a native variant when `window.openAxe` is present; `useAudioIO` lists
      JUCE audio_devices. `scripts/build.mjs` bundles the web build (relative base)
      into `build/ui`, served by a small loopback HTTP server (WKWebView
      sandboxes file://). Block/input meters and the tuner are fed from C++ taps
      (`namStudio.getTap`); model JSON is loaded via `namStudio.loadModelJson`.
- [x] M4 — CPack packaging + CI. `scripts/package.mjs` produces a `.dmg`
      (macOS `.app` bundle), `.zip` (Windows) or `.deb` (Linux) in `build/`.
      `.github/workflows/desktop.yml` builds all three and uploads unsigned dev
      artifacts (signing/notarization deferred).
- [x] M5 — latency validation. `latency_test` measures the DSP path's added
      latency (an impulse through the rig) and the device's reported I/O
      latency. On the dev machine the processing path adds **0 ms**
      (sample-accurate passthrough, zero delay-block overhead) - well under the
      <5ms target. Device round-trip latency is host/buffer dependent (128
      frames at 48kHz ≈ 2.7ms one-way) and reported when a duplex device is
      available.

## Packaging

```sh
pnpm package:desktop   # build web UI + native app, then CPack
```

Produces `apps/desktop/build/openaxe-desktop-<v>.dmg|.zip|.deb`. The package
layout is staged by `packaging/stage.cmake` (the build sets
`CMAKE_SKIP_INSTALL_RULES` so FetchContent subprojects never install anything,
and tells CPack to skip the generated install target). The web UI ships inside
the bundle (`Contents/Resources/ui` on macOS, `ui/` beside the exe on Windows,
`share/openaxe-desktop/ui` on Linux); the app finds it at runtime and serves
it over loopback HTTP (see `UiIndexPath` in `src/main.cpp`).

## Bridge surface (`window.openAxe.*`)

Each is a webview bind; JS passes one object argument and gets back a promise.
Block/edge ids are the web app's strings; the bridge maps them to core ints on
a control thread. Rail jacks are the numbers `-1` (IN) / `-2` (OUT).

- `version()`, `listDevices()`, `getConfig()`, `open()`, `close()`, `start()`, `stop()`
- `addBlock()`, `removeBlock()`, `moveBlock()`, `connect()`, `disconnect()`
- `setParam()` / `getParam()` (key is an index number or a param symbol string)
- `blockInfo()`, `listBlocks()`, `listEdges()`
- `loadModel()` (native open-file dialog), `unloadModel()`
- `setReverbAlgorithm()`, `setDriveModel()`, `setDelayModel()`
- `loadIrWav()` (base64 WAV bytes - the core decodes and resamples it), `unloadIr()`
- `setBypass()`, `setBlockTrim()` (per-block Input/Output trim - _not_ the Amp
  family's `input_level`/`output_level` params, which hold the loaded model's
  dBu calibration)
- `meters()`, `cpuLoad()`

## Native engine caveats (M3)

The desktop reuses the apps/web UI, but a few things are UI-state-only or
deferred because the C++ core doesn't implement them yet (see `NativeBlock`):

- The desktop uses **no Web Audio at all**. `engine.context`, `engine.analyser` /
  `tunerAnalyser`, and `getBlockAnalyser` are plain-JS shims
  (`NativeAudioContext` / `NativeAnalyser` in apps/web/src/native) fed from the
  C++ monitor taps; there is no `AudioContext`, `AudioNode`, or
  `ScriptProcessorNode` anywhere in the native path.

- Effect params apply by core param _symbol_; a symbol the core's table doesn't
  have is rejected by the bridge and warned about once per block+key
  (issue #41), rather than silently dropped. A small alias table covers the UI
  keys that stayed camelCase (`slimSize`, `irMix`).
- Block meters show the real native peak level but a synthetic waveform (a sine
  scaled to it); the tuner/input meter use the real native input tap.

## Gotchas

- `openaxe_core` must be linked **whole-archive** (`LINK_LIBRARY:WHOLE_ARCHIVE`)
  or NAM model loading silently fails (the architecture parsers self-register
  via static initializers).
- On macOS the TU that includes `webview.h` compiles as Objective-C++
  (`enable_language(OBJCXX)` + `LANGUAGE OBJCXX` on `main.cpp`).
- JUCE's `AudioIODevice::open()` returns a non-empty `juce::String` on failure
  (no exception API); `start()` is void and surfaces errors via the device's
  `lastError`. Device ids are **strings** (`AudioIODeviceType::getDeviceNames`,
  `AudioIODevice::getDeviceID()`), never integer indices — resolve "default"
  via the device manager, not a hard-coded sentinel.

## Licensing

The desktop shell uses **JUCE**'s `juce_audio_devices` module for audio I/O
(replacing the RtAudio backend the early issues/README text referenced). JUCE is
distributed under the GPL (or a paid JUCE licence for closed-source use); this
project ships under GPLv3, so the GPL flavour applies. Note this in particular
against `README.md`'s "Why these choices", which still argues _against_ JUCE on
licensing grounds — that rationale predates the switch and should be revised.
