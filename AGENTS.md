# AGENTS.md

Orientation for an agent (or a new contributor) working in this repo. Read
this first; it points at the deeper docs rather than duplicating them.

## What this is

A guitar/bass amp + cab + effects suite built on [Neural Amp
Modeler](https://github.com/sdatkinson/NeuralAmpModelerCore), shipping as a
web app today, with a native desktop app also live and VST3/mobile planned.
One C++ engine (`packages/core`), four front ends. See
[ARCHITECTURE.md](./ARCHITECTURE.md) for the actual layering rule (what must
live in `packages/core` vs. what a front end is allowed to own) and the
per-target status table — read that before adding logic to a front end that
a second front end would have to reimplement.

## Package map

pnpm + Turborepo workspace (`apps/*`, `packages/*`):

| Package                    | What it owns                                                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`            | The C++20 DSP/graph engine — the single source of truth for signal routing, params, model/IR loading. Its own CMake/CTest build, separate from the JS toolchain (see below).            |
| `apps/web`                 | The live product: Vite + React SPA, AudioWorklet + WASM (built from `packages/core`, committed under `apps/web/public/wasm-core/`).                                                     |
| `apps/desktop`             | Native shell (C++ + `webview.h` + JUCE `audio_devices`) reusing `apps/web`'s built UI, calling `packages/core` directly (no WASM, no FFI).                                              |
| `packages/ui`              | Shared React component/design-system library, consumed by `apps/web` and the desktop webview. Has its own Vitest config (`packages/ui/vite.config.ts`).                                 |
| `packages/vst3`            | VST3 + standalone plugin (iPlug2 + `packages/core`, `WHOLE_ARCHIVE`) — scaffold builds and scans (issue #125); CLAP/AU later.                                                           |
| `apps/ios`, `apps/android` | Scaffolding only (a README each) for planned targets — issues [#17](https://github.com/pauloedspinho20/OpenAxe/issues/17), [#16](https://github.com/pauloedspinho20/OpenAxe/issues/16). |

## Verification commands

Run at the repo root; Turborepo fans a script out to every workspace package
that defines it — adding a `"test"`/`"test:run"` script to a new package is
all the wiring needed for it to be picked up automatically.

- `pnpm lint` — oxlint
- `pnpm format:check` — Prettier (`pnpm format` to fix)
- `pnpm build` — typecheck + production build for the **web app + `packages/ui`
  only**. `@openaxe/desktop` is deliberately excluded (its build shells out to a
  full native CMake/webview compile) — use `pnpm build:desktop` /
  `pnpm build:all` for that.
- `pnpm test:run` — Vitest, one-shot, across every package that defines it
  (currently `apps/web` + `packages/ui`)
- `pnpm test:e2e` — Playwright, against a real browser + the actual Vite dev
  server; use for anything needing a real `AudioContext` (jsdom can't provide
  one), not as a substitute for unit tests
- `pnpm build-storybook` — static Storybook build, scans `packages/ui`'s stories

`packages/core`, `apps/desktop` and `packages/vst3` are **not** part of the pnpm/Turborepo
graph for building/testing — they're plain CMake/CTest:

```bash
cmake -S packages/core -B packages/core/build -DOPENAXE_BUILD_TESTS=ON -DCMAKE_BUILD_TYPE=Debug
cmake --build packages/core/build
ctest --test-dir packages/core/build --output-on-failure

cmake -S apps/desktop -B apps/desktop/build -DOPENAXE_DESKTOP_BUILD_TESTS=ON
cmake --build apps/desktop/build
ctest --test-dir apps/desktop/build --output-on-failure   # audio_io, bridge, latency

cmake -S packages/vst3 -B packages/vst3/build -DCMAKE_BUILD_TYPE=Release
cmake --build packages/vst3/build
ctest --test-dir packages/vst3/build --output-on-failure   # smoke, latency, suspend, realtime_safety, editor + validators (pluginval, auval, VST3 validator, clap-validator — skip if tool/bundle absent)
# ThreadSanitizer over the concurrent suspend stress (issue #130):
cmake -S packages/vst3 -B packages/vst3/build -DOPENAXE_VST3_ENABLE_TSAN=ON -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build packages/vst3/build && ctest --test-dir packages/vst3/build --output-on-failure
# RealtimeSanitizer (Clang 18+, optional):
cmake -S packages/vst3 -B packages/vst3/build -DOPENAXE_VST3_ENABLE_RTSAN=ON
```

`VSCode tasks` (`.vscode/tasks.json`) mirror all of the above — use **Run Task** (`⇧⌘B` / `Ctrl+Shift+B`) for one-click **VST: Configure / Build / Test / Full check**, **VST: Standalone**, **VST: Install bundle**, **VST: Generate design tokens** and **VST: TSan/RTSan/Validators**. The same tasks also appear for **C++**, **Desktop** and **Full check** flows.

`packages/core`'s WASM build is a separate, manual step
(`bash scripts/build-core-wasm.sh`, needs the Emscripten SDK on `PATH`) that
overwrites the checked-in `apps/web/public/wasm-core/{js,wasm}` artifacts —
run it and confirm the diff (or lack of one) whenever you change
`packages/core`'s public ABI (`include/openaxe/api.h`) or add a symbol the
web app calls (see `scripts/check-wasm-exports.mjs`, which catches the latter
in CI without needing a rebuild).

**GitHub Actions is enabled** — `ci.yml` (lint/format/build/test/e2e + 5 drift checks + Storybook), `desktop.yml` (3-OS), `plugin.yml` (tags + PR) and `release.yml` run on every push/PR to `main`/`dev` and on `v*` tags. `plugin.yml` stays `workflow_dispatch` + `v*` + `pull_request` (cost-heaviest matrix — confirm with maintainer before broadening triggers). Treat “CI is green” as required for merge (see branch protection in `CONTRIBUTING.md`).

## Drift-guard scripts

Several values are duplicated across languages by design (WASM/native ABI,
web/core param schemas) and are checked, not hand-verified — run these
directly if you touch anything they might affect, don't just trust that CI
will catch it (CI is currently off, see above):

- `node scripts/gen-param-schema.mjs --check` — web `paramSchema.ts` /
  `packages/core/param_schema.json` symbol/range agreement (issue #51), plus
  the plugin automation-slot layout `packages/vst3/generated/automation_param_map.h`
  (`--target=automation-map`; issue #121)
- `node scripts/check-grid-dims.mjs` — grid row/col constants, TS vs. C++ (issue #61)
- `node scripts/check-wasm-exports.mjs` — every `_openaxe_*` symbol the web
  app calls is actually in `packages/core/CMakeLists.txt`'s
  `EXPORTED_FUNCTIONS` (issue #70)
- `node scripts/sync-version.mjs --check` — every `package.json`'s
  `"version"` matches the root `VERSION` file (issue #54)
- `node packages/ui/scripts/generate-tokens.mjs --check` — `packages/ui/tokens/design-tokens.json` → `packages/ui/tokens/{colors,spacing,typography,shadows}.css` and optionally `packages/vst3/generated/tokens.h` (`--target=cpp`; issue #131)

Each has a `--fix`/write mode (`sync-version.mjs`'s is the no-flag default,
not `--fix`); a fix still requires re-running the relevant build (wasm
rebuild, CMake reconfigure, etc.) to take effect.

- `node scripts/check-native-bindings.mjs` — install hygiene, not drift: fails
  fast when a Rosetta x86_64 pnpm installed wrong-arch native bindings
  (`rolldown`/`oxlint`/…; issue #387). Runs automatically as root postinstall
  on every `pnpm install`; repair with `--fix` (delegates to
  `setup.mjs --web-only --skip-submodules`). If you add a dependency that
  ships per-platform native binaries, register its virtual-store prefix in
  `scripts/lib/native-bindings.mjs`.

## Env vars

| Var                     | Where                             | Purpose                                                                                                                                                                                           |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_PUBLISHABLE_KEY`  | `apps/web/src/tone3000/config.ts` | Tone3000 API client key, build-time (Vite `import.meta.env`).                                                                                                                                     |
| `OPENAXE_UI_URL`        | `apps/desktop/src/main.cpp`       | Points the desktop webview at a dev server (`pnpm dev:desktop:attach`) instead of the bundled UI. Only loopback `http(s)` origins are accepted (issue #71) — anything else is refused and logged. |
| `OPENAXE_DESKTOP_DEBUG` | `apps/desktop/src/debug_log.cpp`  | `=1` enables the webview inspector and verbose logging on desktop.                                                                                                                                |

## Key decisions worth knowing before you edit

- **Product vs. Neural Amp Modeler naming (`openaxe_*` vs. `NamAmp`)** — only product-prefix compounds were renamed in #311 (`openaxe_*`/`OpenAxe*`/`OPENAXE_*`, plus `OPENAXE_SECURE_STORAGE_USE_PLAIN_FILE`/`OPENAXE_DESKTOP_ENABLE_TSAN`). Genuine Neural Amp Modeler names keep their spelling: `NamAmp`, `NamLoadError`, `NamAmpNode`, `NamModelInfo`, `NAM_MODEL_KINDS`, `NAM_CORE_DIR`/`NAM_CORE_SOURCES_*`, `NAM_SAMPLE_FLOAT`, `nam_amp.{h,cpp}`, `nam_amp_test`, `NamModelBlockKind`, `.nam`, `third_party/nam-core`, etc. — use anchored patterns (`openaxe_`, `OPENAXE_`, `OpenAxe`, `openAxe`), never bare `nam`. The WASM artifacts are still baked and require an atomic `api.h` + `EXPORTED_FUNCTIONS` + `check-wasm-exports` + rebuild for any future ABI rename.
- **Persisted names are now `openaxe` (with migration)** — IndexedDB `openaxe`, localStorage `openaxe:*`, desktop keychain service `OpenAxe`, and on-disk `openaxe` dir. First launch after #311 copies any existing `nam-web-studio` data into the new names (IndexedDB store-by-store copy with verified counts then delete old DB; localStorage copy-on-read; keychain/disk copy-then-delete). Migration is idempotent, copy-then-delete, and falls back to the old name on failure so no user data is orphaned if interrupted.
- **One C++ engine, four shells** (see ARCHITECTURE.md) — if you're adding
  behavior a second front end would need too (routing rules, param
  semantics, model/IR handling), it belongs in `packages/core`, not a front
  end. `apps/desktop`'s bridge (`apps/desktop/src/bridge.cpp`) and the web
  worklet are both thin translation layers over the same `extern "C"` ABI
  (`packages/core/include/openaxe/api.h`) — they should stay thin.
- **No backend, no accounts** — the web app runs entirely client-side
  (IndexedDB persistence, WASM DSP); Tone3000 is the one exception (a
  network service with no audio meaning — a model-library client, not
  infrastructure this app depends on to function).
- **Desktop is C++ + `webview.h` + JUCE `audio_devices`, not Electron** — the
  React UI runs in a native system webview in the same process as the audio
  engine; JUCE was adopted after RtAudio's CoreAudio backend had a
  reproducible crash bridging independently-clocked duplex devices (see
  `apps/desktop/CMakeLists.txt`'s comment on the migration).
- **`strict-peer-dependencies=true`** (`.npmrc`) — a real unmet peer fails
  `pnpm install` outright rather than warning. If a routine dependency bump
  suddenly fails install with an unrelated-looking peer error, it's likely a
  pre-existing unmet peer elsewhere in the tree that a fresh resolution just
  surfaced, not something wrong with your change — check `pnpm-lock.yaml`'s
  current pin for the named peer before assuming your change broke it, and
  consider a `pnpm.overrides` pin (see the current `valibot` override in root
  `package.json` for precedent) rather than loosening the strict setting.
- **Root `VERSION` file is the one version source of truth** — every
  `package.json` and both `apps/desktop`'s and `packages/core`'s CMake
  `project()` version read it; see
  [CONTRIBUTING.md#releasing-desktop-builds](./CONTRIBUTING.md#releasing-desktop-builds)
  for the tag-and-release flow.
