#include "nam_studio/dsp/dragonfly_plate_reverb.h"

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

namespace nam_studio {
namespace dsp {
namespace {

// Generated from packages/core/param_schema.json (issue #51) - run
// scripts/gen-param-schema.mjs after editing the schema.
const DragonflyPlateReverb::ParamInfo kParamInfo[paramCount] = {
#include "generated/dragonfly_plate_reverb_params.inc"
};

}  // namespace

// An electromechanical plate emulation (freeverb3's strev): dense, bright,
// early-reflection-free decay with several plate models selectable through its
// `algorithm` param. The lightest of the four.
//
// The vendored DSP object is held as an opaque void* and cast at every use:
// DragonflyReverbDSP has internal linkage (see the anonymous namespace above),
// so its type cannot appear in the public header. Constructed at 48kHz and
// re-prepared by Reset(); allocates, like every method here that isn't marked
// real-time safe below.
DragonflyPlateReverb::DragonflyPlateReverb() : dsp_(new DragonflyReverbDSP(48000.0)) {}

DragonflyPlateReverb::~DragonflyPlateReverb() { delete static_cast<DragonflyReverbDSP*>(dsp_); }

// Re-prepare for a new sample rate. Dragonfly rebuilds its delay networks
// here, so this allocates and is not real-time safe.
void DragonflyPlateReverb::Reset(double sample_rate) {
  static_cast<DragonflyReverbDSP*>(dsp_)->sampleRateChanged(sample_rate);
}

// Run one stereo block. The const_casts are Dragonfly's signature, not a
// mutation: run() takes non-const pointers but only reads the input. Real-time
// safe. Output is the algorithm's own dry/wet blend (its `dry_level` param),
// which is why the engine leaves reverb mix to the DSP rather than staging it.
void DragonflyPlateReverb::Process(const float* const* input, float* const* output, int num_frames) {
  static_cast<DragonflyReverbDSP*>(dsp_)->run(const_cast<const float**>(input),
                                               const_cast<float**>(output),
                                               static_cast<uint32_t>(num_frames));
}

// Flush the tail to silence without re-preparing - used when the graph is
// rewired underneath the block, so a stale tail can't bleed into a new route.
void DragonflyPlateReverb::Mute() { static_cast<DragonflyReverbDSP*>(dsp_)->mute(); }

// Param count for this algorithm; each of the four differs, which is why
// switching algorithms re-reads the whole param surface (see the engine's
// SetReverbAlgorithm and SetReverbControl).
int DragonflyPlateReverb::ParamCount() { return static_cast<int>(paramCount); }

// Name/symbol/range/unit for one param index, from the generated table above
// (which mirrors Dragonfly's own PARAMS metadata).
const DragonflyPlateReverb::ParamInfo& DragonflyPlateReverb::GetParamInfo(int index) {
  return kParamInfo[index];
}

// Read one param straight out of the Dragonfly DSP object - unlike the DSPark
// wrappers, these do expose getters, so no local mirror is needed.
float DragonflyPlateReverb::GetParam(int index) const {
  return static_cast<DragonflyReverbDSP*>(dsp_)->getParameterValue(static_cast<uint32_t>(index));
}

// Write one param into the Dragonfly DSP object. Real-time safe: Dragonfly
// smooths param changes internally rather than rebuilding its networks.
void DragonflyPlateReverb::SetParam(int index, float value) {
  static_cast<DragonflyReverbDSP*>(dsp_)->setParameterValue(static_cast<uint32_t>(index), value);
}

}  // namespace dsp
}  // namespace nam_studio
