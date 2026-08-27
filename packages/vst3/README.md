# packages/vst3

VST3 + standalone plugin built with [iPlug2](https://github.com/iPlug2/iPlug2), linking directly against `packages/core`'s C++ DSP engine (#16). Scaffold stage: loads in a host, links the real core, passes audio through — later issues wire params, state chunks and UI.

`assets/branding/` already carries the OpenAxe mark/lockup (SVG + a 256px PNG)
so the editor has branding ready for JUCE/iPlug2 resource embedding on day one
(see `packages/ui/assets/brand/` for the source of truth).

## Prerequisites

```bash
# Core submodules (NAM, Dragonfly, DSPark) — same as packages/core/README.md
git submodule update --init --recursive -- packages/core/third_party/nam-core
git -C packages/core/third_party/dragonfly-reverb submodule update --init --depth 1 -- dpf
# Or all at once:
git submodule update --init --recursive
```

iPlug2 itself is fetched at configure time via `FetchContent_Declare` (pinned `GIT_TAG d54f69050f517e43b941d88c2a170f0a840b9ee4` — never a floating ref, per #74). The VST3/AU/CLAP SDKs are **not** vendored as submodules; iPlug2 curates them under `Dependencies/` and provides `Scripts/download-iplug-sdks.sh` / `download-prebuilt-libs.sh`. Pinning iPlug2 pins the SDKs transitively — see `packages/vst3/CMakeLists.txt`'s comment for the trade-off and the alternative (submodules with `.gitmodules` SHAs) if offline reproducible builds are later required.

## Build

`packages/vst3` owns its own CMake build, separate from the pnpm/Turborepo graph (like `packages/core` and `apps/desktop`).

### macOS

```bash
# VST3 bundle + standalone
cmake -S packages/vst3 -B packages/vst3/build -DCMAKE_BUILD_TYPE=Release
cmake --build packages/vst3/build --config Release
# Smoke test (core linkage, passthrough — no host needed, no iPlug2 SDKs needed)
./packages/vst3/build/nam_studio_vst3_smoke
# Scan in a host: copy packages/vst3/build/nam_studio_vst3.vst3 to ~/Library/Audio/Plug-Ins/VST3/
```

### Windows

```powershell
cmake -S packages/vst3 -B packages/vst3/build -DCMAKE_BUILD_TYPE=Release
cmake --build packages/vst3/build --config Release
.\packages\vst3\build\Release\nam_studio_vst3_smoke.exe
# Copy build\nam_studio_vst3.vst3 to %COMMONPROGRAMFILES%\VST3\
```

### Linux

```bash
cmake -S packages/vst3 -B packages/vst3/build -DCMAKE_BUILD_TYPE=Release
cmake --build packages/vst3/build --config Release
./packages/vst3/build/nam_studio_vst3_smoke
# Copy build/nam_studio_vst3.vst3 to ~/.vst3/
```

Standalone iteration (no host, debugger-friendly):

```bash
cmake --build packages/vst3/build --target nam_studio_standalone
./packages/vst3/build/nam_studio_standalone
```

### VSCode tasks

`.vscode/tasks.json` mirrors the CLI above — **Run Task** (`⇧⌘B` / `Ctrl+Shift+B`) for:

- **VST: Configure (Release / Debug)** — `cmake -S packages/vst3 -B packages/vst3/build`
- **VST: Build / Build (Debug)** — `cmake --build packages/vst3/build` (smoke tests build even without SDK)
- **VST: Test** — `ctest --test-dir packages/vst3/build --output-on-failure` (single entry point from `AGENTS.md`; validators `SKIP` when tool/bundle absent)
- **VST: Full check** — Configure + Build + Test in sequence
- **VST: Standalone** — builds and runs `openaxe_standalone`
- **VST: Install bundle (macOS)** — copies `OpenAxe.vst3` to `~/Library/Audio/Plug-Ins/VST3/` so hosts can scan it (`~/.vst3/` on Linux, `%COMMONPROGRAMFILES%\VST3\` on Windows — copy manually there)
- **VST: Reveal VST3 bundle** — `ls -lh` the built bundle(s)
- **VST: Generate design tokens (CSS / C++ header / all)** and **VST: Design tokens drift check** — `packages/ui/scripts/generate-tokens.mjs` (`--target=css` primary, `--target=cpp` optional; `--check` is what CI runs)
- **VST: TSan / RTSan build & test** — `OPENAXE_VST3_ENABLE_TSAN` / `RTSAN` instrumented builds
- **VST: Validators** — `pluginval` (strictness 10), `auval`, VST3 `validator`, `clap-validator` filtered via `ctest -R`

The same task palette also exists for **C++** (`C++: Configure/Build/Test`) and **Desktop** (`Desktop: Configure/Build/Test/Package`).

### Which file do I download? (Release artifacts)

| What you want                                | File on the Release                                  | What it is                                                                                                                                                                                                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **macOS installer (recommended)**            | `openaxe-plugin-<ver>-Darwin.pkg`                    | `productbuild` installer — drops `OpenAxe.vst3` + `OpenAxe.component` (AUv2 `aufx Nms1 NwSt`) + `OpenAxe.clap` into `/Library/Audio/Plug-Ins/*` (double-click to install; signed + notarized when secrets are present)                                                                             |
| **Windows installer (recommended)**          | `openaxe-plugin-<ver>-win64.msi` (`WIX`) / `.zip`    | `WIX` installer — drops `OpenAxe.vst3` + `OpenAxe.clap` into `%COMMONPROGRAMFILES%\VST3\` and `…\CLAP\` (or `C:\Program Files\Common Files\…`); signed via Authenticode when `WINDOWS_CERTIFICATE_P12` is present — `plugin.yml:155-164`                                                           |
| **Linux installer (recommended)**            | `openaxe-plugin-<ver>-Linux.deb` / `.tar.gz` (`DEB`) | `DEB` + `TGZ` via `apt`/`dpkg` — drops `OpenAxe.vst3` → `~/.vst3/` / `/usr/lib/vst3/` and `OpenAxe.clap` → `~/.clap/`, same payload as bundles zip — `plugin.yml:34-43,168-189`                                                                                                                    |
| **Manual install — macOS**                   | `openaxe-plugin-bundles-macos-14-<tag>.zip`          | Bare bundles — unzip and copy `OpenAxe.vst3` → `~/Library/Audio/Plug-Ins/VST3/`, `OpenAxe.component` → `~/Library/Audio/Plug-Ins/Components/`, `OpenAxe.clap` → `~/Library/Audio/Plug-Ins/CLAP/` — `plugin.yml:206-211` (handles flat layout `build/*.vst3`)                                       |
| **Manual install — Windows**                 | `openaxe-plugin-bundles-windows-latest-<tag>.zip`    | Bare bundles — unzip and copy `OpenAxe.vst3` → `%COMMONPROGRAMFILES%\VST3\` and `OpenAxe.clap` → `…\CLAP\` (multi-config `build/**/*.vst3` handled via `globstar` — `plugin.yml:192-204`); no `.component` (AU is macOS-only)                                                                      |
| **Manual install — Linux**                   | `openaxe-plugin-bundles-ubuntu-24.04-<tag>.zip`      | Bare bundles — unzip and copy `OpenAxe.vst3` → `~/.vst3/` and `OpenAxe.clap` → `~/.clap/` (flat `build/*.vst3` layout)                                                                                                                                                                             |
| **CI debug only — not installable (any OS)** | `openaxe-plugin-build-tree-<os>-<tag>.tar.gz`        | Full `packages/vst3/build/` dump (`CMakeCache.txt`, `cmake_install.cmake`, `core/`, `Testing/`, `*.vst3` + CMake detritus — the file from the original `openaxe-plugin-macos-14-v0.2.5.tar.gz` / `windows-latest` / `ubuntu-24.04` reports) for CI triage — **do not** copy to Plug-Ins. See #292. |

> **No `.vst` (VST2) on any OS.** VST2 is EOL since 2013 and Steinberg no longer licenses the SDK for new products. This repo ships **VST3** (`OpenAxe.vst3`), **AUv2** (`OpenAxe.component` — macOS only), and **CLAP** (`OpenAxe.clap`) only — every host that still loads VST2 also loads VST3. If you must use a VST2-only host, use a wrapper (e.g. `vst3 → vst2` shim) outside this project. The former fallback tars (`openaxe-plugin-<os>-<tag>.tar.gz` on all three runners) were never valid plugins.

Unsigned manual bundles are quarantined by Gatekeeper — clear once:

```bash
xattr -dr com.apple.quarantine ~/Library/Audio/Plug-Ins/VST3/OpenAxe.vst3 ~/Library/Audio/Plug-Ins/Components/OpenAxe.component
auval -v aufx Nms1 NwSt   # AU validation (macOS only)
# Windows: Defender SmartScreen may warn on unsigned .msi/.vst3 — sign via Authenticode or allow once
# Linux: no quarantine; ensure ~/.vst3 and ~/.clap are in your host's scan paths
```

## What the scaffold does

- `CMakeLists.txt` reads the root `VERSION` file (`#54` — one source of truth, like `packages/core` and `apps/desktop`), `add_subdirectory(../../packages/core core)` and links `nam_studio_core` **with `WHOLE_ARCHIVE`** (NAM parsers self-register via static initializers — plain archive link drops them; see `packages/core/CMakeLists.txt`).
- `config.h` — plugin name (`OpenAxe`), manufacturer, unique IDs (`Nms1`/`NwSt`), I/O (`1-1 2-2`), `PLUG_DOES_STATE_CHUNKS=1`, VST3 subcategory `Fx|Amp`. VST3 target only for now; CLAP/AU later.
- `src/plugin.{h,cpp}` — minimal `NamStudioPlugin : public iplug::Plugin`: `nam_studio_graph_create`/`destroy`, `nam_studio_reset` on sample-rate/block-size change, `nam_studio_process` passthrough.
- `src/main_standalone.cpp` — standalone entry reusing the same DSP path.

Verification: builds on macOS/Windows/Linux; `.vst3` scans and instantiates in at least one host per platform; standalone runs. Audio is passthrough — expected at this stage.

## Licensing

This repo is GPLv3. Steinberg's VST3 SDK is dual-licensed GPLv3 / proprietary, so the GPLv3 arm applies cleanly. iPlug2 is MIT/zlib, CLAP is MIT. AAX requires an Avid agreement and is not covered here.

---

## Design note: the automation-parameter slot map (issue #121)

### The problem

VST3, AU and CLAP all require the parameter list to be **fixed and stable**:
declared once at construction, with ids that persist across sessions so a
host's automation lanes keep pointing at the same control. `packages/core`
addresses params as `(block_id, index)` on a **dynamic** 4×10 grid - block
ids are handed out at `nam_studio_add_block` time and each cell's param table
depends on what block kind currently sits there. Nothing about that is stable
across a project reload, and #119 deliberately made param _indices_ an
implementation detail (rig-state documents key by symbol).

### Alternatives considered

1. **One host param per possible control (40 cells × max params).**
   Every cell of the grid reserves a full param table up front; host id
   `(row, col, param)` is purely positional. Rejected: with EQ-sized tables
   that is ~480 declared parameters before globals, which several hosts and
   every automation UI handle badly; ~90% of them would sit dead over any
   empty cell; and it hard-wires the grid dimensions into the plugin ABI,
   making a future grid resize an id-breaking event.

2. **Dynamic parameter lists where the format allows (CLAP), static elsewhere.**
   CLAP supports rescanning the parameter list at runtime, so the plugin could
   mirror the rig exactly and rebuild the list on every topology change.
   Rejected as the primary design: it forks behaviour per format, and the
   formats we most need (VST3, AU) are precisely the ones whose lists must be
   static. A CLAP build can still _simulate_ this design cheaply (rescan after
   rebinds), so choosing the static pool costs CLAP nothing.

3. **Fixed slot pool (chosen).** A small, fixed pool of slots mediates between
   the host's frozen id space and the engine's dynamic one. Hosts see a
   constant parameter list forever; users assign slots to blocks in the
   editor; rebinds change what existing ids mean (with title-change
   notifications) rather than adding/removing ids.

The slot pool is the only alternative that satisfies every constraint at once:
static list at construction (all three formats), ids that persist across
sessions (automation lanes survive), bounded count (no 480-param spam), and no
grid-size coupling.

### The design

- **Pool**: `NAM_STUDIO_AUTOMATION_SLOT_COUNT = 16` slots. Slot 0 is
  permanently the master bus (level, mute); slots 1..15 bind to live blocks -
  more than any realistic rig fills, far fewer than 480.
- **Entries per slot**: `NAM_STUDIO_AUTOMATION_PARAMS_PER_SLOT = 20`, a frozen
  stride. Each entry of a bound slot _is_ an index into the bound block's
  param table; its display name, range and unit resolve dynamically from
  `nam_studio_automation_slot_param_info` (which forwards to the bound
  block's `nam_studio_block_param_info`). Unbound slots expose dead entries;
  entries past the bound block's own table resolve to nothing.
- **Host id layout** (`packages/vst3/generated/automation_param_map.h`,
  generated): id 0 = master level, id 1 = master mute, then slot-major:

      SlotParamId(slot, entry) = 2 + (slot - 1) * 20 + entry

  Total declared parameters: 2 + 15 × 20 = **302**.

- **Normalization**: values cross the plugin/host boundary as 0..1 and map
  linearly onto the resolved param's `[min, max]` (from the schema / live
  param info). Native units never leave core. This is also what makes one
  lane meaningful across different target ranges.

#### Why 20 entries per slot, not 12

The issue proposed "Param 1..12" believing EQ's 12-param table was the widest.
Validation against `param_schema.json` found the real maximum: **reverb-hall
exposes 18 params** (room 17, plate 9). A 12-entry slot would silently leave
reverb tails unautomatable, and picking which 12 by hand would bake index-
order assumptions back into the ABI. So the stride is schema-driven and set
with headroom (20 > 18 today); the generator
(`scripts/gen-param-schema.mjs`) fails if any kind/variant ever exceeds it.

**Both numbers are frozen API surface.** Changing `paramsPerSlot` shifts
every id above the first slot; changing `slotCount` adds ids but also moves
nothing existing (append-only) - still treated as breaking until #127 decides
the chunk-migration story. If a kind genuinely outgrows 20 params, that is a
versioned-layout event: bump the number, bump the plugin's own state-chunk
version, migrate on load.

#### Value semantics across rebinds

Each slot remembers the last normalized value written through it per entry
("dirty" entries). Writes go straight through to the bound block (mapped
through its live ranges); reads resolve live from the bound block, so knob
moves made outside the slot surface (web UI, desktop bridge) show up host-side
too. On **rebind**, only dirty entries re-apply onto the new target - through
the new target's own ranges. Consequences:

- An automation lane's position survives rebinding to a different kind without
  jumping (0.25 stays 0.25; threshold −45 dB becomes delay time 257.5 ms).
- A first-time binding never stomps the new block's existing values with
  zeros - untouched entries stay untouched.
- Removing a block unbinds its slot immediately (never dangles); remembered
  values survive for a later rebind.

Host integration contract on rebind: fire the format's parameter-title-change
mechanism - VST3 `restartComponent(kParamTitlesChanged)`,
AU `kAudioUnitProperty_ParameterList` changed notification,
CLAP `params_rescan(CLAP_PARAM_RESCAN_VALUES | CLAP_PARAM_RESCAN_TEXT)`.

#### Stability contract (the fine print)

Slot addressing pins TWO things as permanent API:

1. The constants above (count, stride).
2. **Per-kind param-table order.** Entry 3 of a slot bound to a compressor is
   compressor param index 3 - today "Attack". If a core release reordered a
   kind's table, saved projects' lanes would land on different controls of the
   same block. That was free to do before (#119 made documents symbol-keyed
   precisely so internal order wouldn't leak); from now on each kind's row
   order in `param_schema.json` is API surface and may only ever be appended
   to. Symbol-keyed rig-state serialization (#119) is unaffected either way.

#### Where everything lives

| Artifact                                                                                                                                                                             | Role                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `param_schema.json` → `"pluginAutomation"`                                                                                                                                           | Single source of truth: counts + master descriptors                                                                   |
| `scripts/gen-param-schema.mjs --target=automation-map`                                                                                                                               | Renders the header below; validates kinds fit the stride                                                              |
| `generated/automation_param_map.h` (this package)                                                                                                                                    | Plugin-side constants, id layout helper, master metadata, static_asserts pinning core's copies                        |
| `packages/core/include/openaxe/engine.h` → `kAutomation*` / `kMasterAutomation*`                                                                                                     | Core's mirrored constants (asserted equal to the generated ones)                                                      |
| ABI: `nam_studio_bind_automation_slot`, `_unbind_…`, `_automation_slot_block`, `_automation_slot_param_count`, `_automation_slot_param_info`, `_set/get_automation_param_normalized` | Everything a plugin wrapper needs                                                                                     |
| Rig state `"automationSlots"`                                                                                                                                                        | Bindings ride the document (`{"<slot>": {"blockId": "<doc id>"}}`); restored after blocks, soft-skipped when dangling |

Tests: `packages/core/tests/api_automation_slots_test.cpp` - rebind survival
across kinds, save/reload landing on the same control, master immutability,
dynamic resolution, removal/clear unbinding, clamping, malformed-document
tolerance, and byte-stable serialization with bindings present.
