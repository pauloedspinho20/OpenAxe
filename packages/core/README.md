# packages/core

Shared C++ DSP core — a single library housing all audio DSP and graph logic,
usable by every target with zero language bridges between DSP and platform
APIs (web via Emscripten/WASM, desktop, VST3/CLAP/AU/AAX, iOS, Android).

## Scope of this scaffold (issue #13)

This package currently contains **only build-system scaffolding**, not real
DSP code:

- `CMakeLists.txt` — configures a native static library target plus
  conditional branches for Emscripten (WASM), iOS (framework), and Android
  (JNI shared lib), each guarded so an empty `third_party/`/`tests/` doesn't
  break `cmake` configure.
- `include/nam_studio/core.h` + `src/core.cpp` — a trivial placeholder
  (`nam_studio::core::version()`) proving the include/src wiring resolves.
- `third_party/` — empty, populated by issue #14 (NAMCore, Dragonfly, LSP,
  RTNeural, etc.).
- `tests/` — empty, populated by issue #14.

The real `extern "C"` DSP/graph API, effect wrappers, and NAM model inference
are out of scope here and land in issue #14.

## Known limitation: unverified build

**Neither `cmake` nor `emcc` is installed in the environment this scaffold
was authored in.** The CMake configuration above has not been locally
configured or built for any target (native, Emscripten, iOS, or Android).
Treat it as authored-but-unverified until one of the following happens:

- A CI job is added that runs `cmake -B build && cmake --build build` (and
  equivalents for the other target platforms) against this package.
- A follow-up issue (or the start of #14) verifies it locally with the
  required toolchains installed.

## Build targets (once toolchains are available)

```bash
# Native desktop (macOS, Windows, Linux)
cmake -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native

# WASM (web, via Emscripten)
emcmake cmake -B build/wasm -DCMAKE_BUILD_TYPE=Release
cmake --build build/wasm

# iOS
cmake -B build/ios -G Xcode -DCMAKE_SYSTEM_NAME=iOS
cmake --build build/ios

# Android (via NDK)
cmake -B build/android -DCMAKE_TOOLCHAIN_FILE=$NDK/build/cmake/android.toolchain.cmake \
      -DANDROID_ABI=arm64-v8a
cmake --build build/android
```
