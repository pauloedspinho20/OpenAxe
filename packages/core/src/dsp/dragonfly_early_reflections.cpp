#include "openaxe/dsp/dragonfly_early_reflections.h"

// See dragonfly_hall_reverb.cpp for the full rationale behind this
// structure (pre-include order, why the whole of freeverb3 must share one
// anonymous namespace with DSP.cpp, exact file list source).
#include "DistrhoPlugin.hpp"
#include "DistrhoPluginInfo.h"
#include "extra/ScopedDenormalDisable.hpp"

namespace {
#include "freeverb/allpass.cpp"
#include "freeverb/biquad.cpp"
#include "freeverb/comb.cpp"
#include "freeverb/delay.cpp"
#include "freeverb/delayline.cpp"
#include "freeverb/earlyref.cpp"
#include "freeverb/efilter.cpp"
#include "freeverb/nrev.cpp"
#include "freeverb/nrevb.cpp"
#include "freeverb/progenitor.cpp"
#include "freeverb/progenitor2.cpp"
#include "freeverb/revbase.cpp"
#include "freeverb/slot.cpp"
#include "freeverb/strev.cpp"
#include "freeverb/utils.cpp"
#include "freeverb/zrev.cpp"
#include "freeverb/zrev2.cpp"
#include "DSP.cpp"
}  // namespace

namespace openaxe {
namespace dsp {
namespace {

// Generated from packages/core/param_schema.json (issue #51) - run
// scripts/gen-param-schema.mjs after editing the schema.
const DragonflyEarlyReflections::ParamInfo kParamInfo[paramCount] = {
#include "generated/dragonfly_early_reflections_params.inc"
};

}  // namespace

DragonflyEarlyReflections::DragonflyEarlyReflections() : dsp_(new DragonflyReverbDSP(48000.0)) {}

DragonflyEarlyReflections::~DragonflyEarlyReflections() {
  delete static_cast<DragonflyReverbDSP*>(dsp_);
}

// Re-prepare for a new sample rate. Dragonfly rebuilds its reflection network
// here, so this allocates and is not real-time safe.
void DragonflyEarlyReflections::Reset(double sample_rate) {
  static_cast<DragonflyReverbDSP*>(dsp_)->sampleRateChanged(sample_rate);
}

// Run one stereo block. The const_casts are Dragonfly's signature, not a
// mutation: run() takes non-const pointers but only reads the input. Real-time
// safe. Output is the algorithm's own dry/wet blend (its `dry_level` param),
// which is why the engine leaves reverb mix to the DSP rather than staging it.
void DragonflyEarlyReflections::Process(const float* const* input, float* const* output,
                                         int num_frames) {
  static_cast<DragonflyReverbDSP*>(dsp_)->run(const_cast<const float**>(input),
                                               const_cast<float**>(output),
                                               static_cast<uint32_t>(num_frames));
}

// Flush the tail to silence without re-preparing - used when the graph is
// rewired underneath the block, so a stale tail can't bleed into a new route.
void DragonflyEarlyReflections::Mute() { static_cast<DragonflyReverbDSP*>(dsp_)->mute(); }

// Param count for this algorithm; each of the four differs, which is why
// switching algorithms re-reads the whole param surface (see the engine's
// SetReverbAlgorithm and SetReverbControl).
int DragonflyEarlyReflections::ParamCount() { return static_cast<int>(paramCount); }

// Name/symbol/range/unit for one param index, from the generated table above
// (which mirrors Dragonfly's own PARAMS metadata).
const DragonflyEarlyReflections::ParamInfo& DragonflyEarlyReflections::GetParamInfo(int index) {
  return kParamInfo[index];
}

// Read one param straight out of the Dragonfly DSP object - unlike the DSPark
// wrappers, these do expose getters, so no local mirror is needed.
float DragonflyEarlyReflections::GetParam(int index) const {
  return static_cast<DragonflyReverbDSP*>(dsp_)->getParameterValue(static_cast<uint32_t>(index));
}

// Write one param into the Dragonfly DSP object. Real-time safe: Dragonfly
// smooths param changes internally rather than rebuilding its networks.
void DragonflyEarlyReflections::SetParam(int index, float value) {
  static_cast<DragonflyReverbDSP*>(dsp_)->setParameterValue(static_cast<uint32_t>(index), value);
}

}  // namespace dsp
}  // namespace openaxe
