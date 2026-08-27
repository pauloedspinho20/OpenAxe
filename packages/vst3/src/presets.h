#pragma once

#include <string>
#include <vector>

// Factory presets for the plugin — issue #128 bullet.
// Rather than hand-transcribing `"blocks":[...]` JSON, factory presets are
// *generated* from the same source row definitions as
// `apps/web/src/presets/factoryPresets.ts` (buildFactoryPreset). The web file
// lays out parallel rows of effects (IN -> row serial -> Mixer -> OUT) with
// the flat-graph mixer at the max column. This header mirrors that layout
// construction via the `openaxe_core` ABI so the JSON is never hand-written.
//
// The two starter presets are FX-only (no .nam/IR bundled) — see the web
// file's header note. Adding Tone3000-backed capture references is a future
// step once the plugin has asset loading (#129).

class OpenAxePlugin;

namespace openaxe_vst3::presets {

// Registers the factory bank into `plugin` via `MakePresetFromChunk`. Must be
// called at construction time after params are declared, before the host
// queries the preset list (VST3/AU preset menu). No-op without iPlug SDK.
void RegisterFactoryPresets(OpenAxePlugin& plugin);

// Helpers exposed for tests / portable-JSON round-trip verification without iPlug.
struct FactoryPresetJson {
  std::string name;
  std::string json;  // self-contained document (embed=true would embed assets, but these have none)
};

std::vector<FactoryPresetJson> BuildFactoryPresets();  // size 2: Clean Boost, Ambient Swell

}  // namespace openaxe_vst3::presets
