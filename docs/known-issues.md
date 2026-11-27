# Known issues and workarounds (third-party)

Bugs, quirks and surprising behaviour in libraries, browsers and tools that
this repo works around. Each entry says what goes wrong, how it shows up, and
where the workaround lives, so nobody "simplifies" a workaround away and the
original problem comes back. When an upstream fix lands, re-test, remove the
workaround and delete the entry.

Most entries came out of the Media Center / tab editor work (issues #205,
#206, #459).

## alphaTab (`@coderline/alphatab` 1.9)

### The canvas engine crashes on whammy-bar symbols

- **Symptom:** rendering a score that has a whammy bar on a notation staff
  with `core.engine = 'html5'` throws `Cannot read properties of undefined
(reading 'textAlign')` from `ScoreWhammyBarGlyph.paintOrMeasure`. The glyph
  reads `canvas.textAlign` while being measured, before the canvas has a 2D
  context (`Html5Canvas.beginRender` creates it).
- **Workaround:** video export renders with the default SVG engine and
  rasterises each SVG part itself (`apps/web/src/media/tabs/videoExport.ts`,
  `renderSheet` / `rasterise`). The app view always used SVG, so it isn't
  affected.

### SVG parts turned into images lose the music font

- **Symptom:** an alphaTab SVG drawn via `<img>`/canvas shows empty boxes or
  nothing for note heads, rests, clefs and so on. Glyphs are `<text
class="at">` styled by the page's `@font-face` (`alphaTab` → Bravura), and
  an SVG used as an image can't load page or external fonts.
- **Workaround:** `videoExport.ts` fetches `/font/Bravura.woff2` once, embeds
  it as a data URL in an `@font-face` inside each SVG, and adds alphaTab's own
  `.at` glyph rule (font family, `font-size: 36px`, `line-height: 1`) before
  rasterising.

### `activeBeatsChanged` doesn't fire with `PlayerMode.EnabledExternalMedia`

- **Symptom:** when alphaTab only follows our core player (it doesn't play
  the audio itself), `api.activeBeatsChanged` never fires, so nothing tracks
  "the beat playing now".
- **Workaround:** look the beat up from the tick position instead:
  `api.tickCache.findBeat(new Set([track]), api.tickPosition)`. This is used by
  the fretboard highlight and Listen mode (`TabWorkspace.tsx`).

### Exporting MIDI throws on bends unless written as SMF 1

- **Symptom:** `MidiFileGenerator` with the default handler throws on scores
  with bends.
- **Workaround:** use `new midi.AlphaSynthMidiFileHandler(file, true)` (SMF 1
  mode), which writes bends as pitch-wheel events (`TabWorkspace.tsx`,
  `exportAs('mid')`).

### Drum articulations come back wrong after a Guitar Pro save

- **Symptom:** percussion notes written with articulation ids read back as
  other kit pieces after a `.gp` round trip. `note.percussionArticulation` is
  an index into the track's registered articulations, not a GM id.
- **Workaround:** register the articulation on the track with
  `track.getOrRegisterPercussionArticulation(...)` and store the returned
  index. The default kit table is taken from a GP7 round trip
  (`scoreOps.ts`, `drumId` / `toggleDrumHit`). Tests cover the round trip.

### Printing opens a pop-up window

- **Symptom:** `api.print()` renders into `window.open(...)`. Pop-up blockers
  (and embedded browsers without `window.open`) make it throw on
  `preview.document`.
- **Workaround:** `printWith` in `TabWorkspace.tsx` catches the failure and
  asks the user to allow pop-ups. On the desktop webview, check that printing
  works before relying on it.

### Print and video copy the current colours

- **Note:** `api.print()` copies the live `settings` (via
  `settingsToJsObject`), including the dark-sheet colours. `printWith` puts
  alphaTab's default colours back just for the print call, so prints are
  always black on paper.

### Smaller gotchas

- **`score.tempo` is read-only:** it's derived from the first bar. To change
  tempo, edit `masterBar.tempoAutomations` (see `scoreAudio.ts`, `tempoScale`).
- **String numbers differ:** alphaTex counts strings from the highest (`5.3`
  is the G string), while the model's `note.string` counts from the lowest
  (1 = low E on a 6-string). Tests written in alphaTex must convert.
- **alphaTex note effects** go after the string, before the duration:
  `3.6{pm}.4`, not `3.6.4 {pm}`.
- **AlphaTex parse errors** carry their details in `lexerDiagnostics` /
  `parserDiagnostics` on the error; `describeError` shows them to the user.
- **The attribution must stay visible.** alphaTab's "♪ alphaTab.net" mark is
  drawn inside the first system's top band. The practice view never covers
  the first system, and video export also draws the mark on every frame.
- **Build-only optional peer:** `@coderline/alphatab-vite` lists `vite` as an
  optional peer, which pulled Vite into the redistributed licence list.
  `scripts/sync-licenses.mjs` excludes build-only optional peers.

## three.js TSL / WebGPU (`three` 0.181)

These came out of porting the VISUALS scenes from GLSL to TSL
(`apps/web/src/visuals/scenes/`).

### WGSL reserved words break `Fn().setLayout()` names

- **Symptom:** a black canvas and `'type' is a reserved keyword` from the WGSL
  parser. TSL writes layout input names and function names into the WGSL as
  they are, and WGSL reserves many common words (`type`, `ptr`, `fn`, `let`,
  `var`, `loop`, `target`, `sample`, `filter`, `meta`...).
- **Workaround:** pick other names (`kind` in
  `scenes/distilledCube/scene.ts`).

### A layout function shared by several materials loses its uniforms

- **Symptom:** `unresolved value 'NodeBuffer_…'` or `struct member nodeUniform0
not found` when a scene compiles. A `Fn().setLayout()` function becomes one
  WGSL function, generated once; materials built after the first don't
  register the uniforms or uniform arrays it reads, so their shaders refer to
  bindings that don't exist. A single material is fine (Distilled Cube,
  Holographic Cube Grid); Digital Core has five sharing helpers.
- **Workaround:** only pure functions (hashes, noise) keep `setLayout`; any
  helper that reads a scene uniform is a plain `Fn` and inlines at each call
  (`scenes/digitalCore/materials.ts`).

### Shader errors don't throw

- **Symptom:** a WGSL compile or pipeline error is only logged; `compileAsync`
  resolves and the canvas stays black.
- **Workaround:** `VisualsEngine.loadScene` wraps scene creation in a WebGPU
  validation error scope and shows the first error over the stage.

### `screenCoordinate` is top-left on both backends

- **Symptom:** a ported fullscreen shader renders upside down.
  `gl_FragCoord` is bottom-left in GLSL, but TSL's `screenCoordinate` follows
  WebGPU (top-left) on WebGL2 too.
- **Workaround:** flip it: `vec2(screenCoordinate.x, screenSize.y.sub(screenCoordinate.y))`.

### Headless Chromium drops the device on heavy scenes

- **Symptom:** `Instance dropped in popErrorScope` when capturing screenshots
  in headless Playwright. Headless Chromium runs WebGPU on SwiftShader (on the
  CPU), and the ray-marching scenes lose the device.
- **Workaround:** `apps/landing/scripts/capture-screenshots.mjs` launches with
  `--enable-gpu --ignore-gpu-blocklist --use-angle=metal` to use the real GPU
  (`CAPTURE_HEADED=1` for a visible window).

### Vite hot reload doesn't refresh a loaded scene

- **Symptom:** editing `scenes/*/scene.ts` changes nothing on screen. Scenes
  are loaded with a dynamic `import()` and kept by the engine.
- **Workaround:** reload the page after editing a scene.

## iPlug2 on Linux (pinned `1527935`)

### Closing the editor can abort the host with an X `BadWindow`

- **Symptom:** the host process died when the plugin editor closed, with
  `Gdk-WARNING ... X Window System error ... BadWindow (invalid Window
parameter) ... request_code 12`. iPlug2's Linux webview is a GtkPlug inside
  the host's X11 window. A host that destroys that parent first also destroys
  our plug window, the requests GTK then makes against it fail, and GDK's
  default X error handler aborts the process. It reproduced on every pluginval
  Editor test, but is timing-dependent: `GDK_SYNCHRONIZE=1` hides it.
- **Workaround:** the plugin's Linux `OpenWindow`/`CloseWindow` run inside a
  GDK X-error trap that syncs and discards errors from requests made in it
  (`packages/vst3/src/x11_error_trap.{h,cpp}`). It's a separate translation
  unit because `<gdk/gdkx.h>` (Xlib) and iPlug2 both define `KeyCode`.
  Upstream-worthy.

### `IWebViewControl` doesn't exist on Linux

- **Symptom:** the macOS/Windows editor (an IGraphics `IWebViewControl`)
  can't be built on Linux. iPlug2 offers its Linux webview only as
  `WebViewEditorDelegate`, and doesn't define `iPlug2::Extras::IWebViewControl`
  there.
- **Workaround:** on Linux the plugin itself is the webview
  (`WEBVIEW_EDITOR_DELEGATE`). The page/bridge logic both shells need lives
  in `packages/vst3/src/webview_session.{h,cpp}`.

### Testing the Linux plugin under Docker on Apple Silicon

Not product bugs, but each one cost time. The CI image (`openaxe-ci-linux`)
is amd64, so it runs under Rosetta there:

- X11 shared memory trips a Rosetta assertion (`VMAllocationTracker.cpp ...
remove_shared_mem`, then `Trace/breakpoint trap`) as soon as GTK draws.
  Start Xvfb with `-extension MIT-SHM`, and set
  `WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1`.
- `gdb` can't trace under Rosetta (`Couldn't get registers`); use logs
  (`OPENAXE_DESKTOP_DEBUG=1` writes the plugin's) or an arm64 image.
- With no sound card the standalone app stops on a modal "Please check the
  audio settings". Run `pulseaudio -D --load=module-null-sink`, and dismiss the
  dialog with `xdotool key Return`.
- pluginval's Editor test closes the editor before WebKit finishes loading the
  page under emulation; use the standalone app to check the page and bridge.
- Building the VST3 SDK's own tools (validator, `editorhost`) needs VSTGUI's
  xcb/cairo/pango/gtkmm-3.0 dev packages. `editorhost` couldn't create its X
  window under Xvfb at all.

## Browsers

### `std::random_device` aborts inside an AudioWorklet (Emscripten / WASM)

- **Symptom:** the rig worklet died as soon as the backing player was
  created. Signalsmith Stretch seeds its RNG from `std::random_device`, which
  Emscripten implements with `crypto.getRandomValues`, and that isn't
  available in `AudioWorkletGlobalScope`.
- **Workaround:** the core's backing player seeds the stretcher with a fixed
  seed (`packages/core/src/backing_player.cpp`). The worklet also wraps player
  calls in try/catch so a player failure can't take the rig down
  (`apps/web/public/wasm-core/openAxeRigWorklet.js`).

### MediaRecorder records in real time, and formats vary

- **Symptom:** a video export takes as long as the song. Chrome and Safari
  record MP4 (H.264/AAC), while some browsers only offer WebM.
- **Workaround / status:** `pickMime()` in `videoExport.ts` chooses MP4 when
  `MediaRecorder.isTypeSupported` allows it, else WebM. Frames are driven by
  a timer, not `requestAnimationFrame`, so recording continues when the page
  isn't painted. Faster-than-real-time export needs WebCodecs plus a muxer
  (tracked in #459).

### Pop-ups and microphone in embedded browsers

- Pop-ups only open from a real user click. A pop-up opened from code (or in
  some embedded panes) returns `null`; see "Printing opens a pop-up window"
  above.
- Embedded preview panes may block microphone capture, so Wait/Listen mode
  and guitar step entry can't be tried there. Their timing logic is
  unit-tested (`waitMode.test.ts`, `practiceScore.test.ts`,
  `stepEntry.test.ts`).

## Tooling

### Vite's SPA fallback answers missing assets with `index.html`

- **Symptom:** in `pnpm dev:desktop:attach` mode, fetching an asset that
  doesn't exist returned `200 text/html` (the app shell), which was then
  cached as if it were the asset.
- **Workaround:** `apps/web/src/engine/assetCache.ts` rejects HTML responses
  for binary assets. There is a test for it.

### TypeScript 7 native binary missing on arm64 after install

- **Symptom:** `tsc` fails because the platform binary for the native
  TypeScript compiler isn't there (seen on Apple Silicon after switching
  branches).
- **Fix:** `pnpm install --frozen-lockfile --force` reinstalls the optional
  platform package.

### Vite hot reload and module-level stores

- **Symptom:** after editing `media/mediaDb.ts` (or another module a zustand
  store imports) in `pnpm dev`, the Media Center can show an empty library or
  "Power on the audio engine" with the engine already on. Hot reload creates
  a second store instance that the mounted hooks don't use.
- **Fix:** do a full page reload. Production builds aren't affected.

### Testing React inputs from scripts

- Synthetic `input`/`change` events plus `blur()` from a script can blur
  before React has re-rendered, so commit-on-blur fields (`TextField` in the
  tab toolbox) don't save. Use real typing (Playwright `fill`/`type`) for
  those fields.

### CI flakes

- `desktop.yml` on Linux occasionally fails in `apt-get` (mirror timeouts);
  re-run the failed jobs.
