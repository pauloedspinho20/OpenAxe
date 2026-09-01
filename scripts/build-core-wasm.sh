#!/usr/bin/env bash
# Builds packages/core's openaxe_core_wasm target (issue #22's first
# slice - see packages/core/CMakeLists.txt's `if(EMSCRIPTEN)` branch) and
# copies the compiled glue JS + WASM binary into apps/web/public/wasm-core/,
# where DragonflyReverb's AudioWorkletProcessor expects to find them.
#
# Requires the Emscripten SDK on PATH (emcc/emcmake) - e.g. `brew install
# emscripten` on macOS. Not wired into turbo/CI yet: packages/core has no
# package.json (it isn't a pnpm workspace member), so this stays a plain
# script for now. Run manually whenever packages/core's DSP/ABI changes.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="$repo_root/packages/core/build/wasm"
out_dir="$repo_root/apps/web/public/wasm-core"

if ! command -v emcmake >/dev/null 2>&1; then
  echo "error: emcmake not found - install the Emscripten SDK first (e.g. brew install emscripten)" >&2
  exit 1
fi

emcmake cmake -B "$build_dir" -S "$repo_root/packages/core" -DCMAKE_BUILD_TYPE=Release
cmake --build "$build_dir" --target openaxe_core_wasm -j "$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"

mkdir -p "$out_dir"
cp "$build_dir/openaxe_core.js" "$build_dir/openaxe_core.wasm" "$out_dir/"

echo "Built $out_dir/openaxe_core.{js,wasm}"
