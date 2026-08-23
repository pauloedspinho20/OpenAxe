#include "openaxe/dsp/dragonfly_hall_reverb.h"

// Pre-include anything that declares global-scope things (operator new,
// etc.) BEFORE the anonymous namespace below - their include guards make
// these same headers' re-inclusion from within DSP.cpp a no-op inside the
// namespace, so only Dragonfly/freeverb3's own declarations end up
// anonymous-namespace-scoped.
#include "DistrhoPlugin.hpp"
#include "DistrhoPluginInfo.h"
#include "extra/ScopedDenormalDisable.hpp"

// Compiles freeverb3 + DSP.cpp as one translation unit, entirely inside an
// anonymous namespace, giving DragonflyReverbDSP (and every fv3:: class it
// uses) internal linkage private to this one .o file. This is required,
// not just tidy: Dragonfly's other three reverb algorithms (room, plate,
// early reflections) each compile their own DSP.cpp defining an
// identically-named DragonflyReverbDSP class. Wrapping only DSP.cpp (and
// not the freeverb3 sources it depends on) was tried first and rejected -
// it compiles, but produces a linkage *mismatch* between the
// anonymous-namespaced class and the separately-compiled, externally-linked
// freeverb3 classes it references, which is silently wrong rather than a
// clean build error. Everything must be namespaced together, in one TU, to
// be safe.
//
// This is exactly Dragonfly's own Makefile source list for the hall
// algorithm (FILES_COMMON in plugins/dragonfly-hall-reverb/Makefile) - not
// a directory glob, since common/freeverb/ also holds files used only by
// Dragonfly's other algorithms that need the external FFTW library (hall
// only needs the bundled KISS FFT).
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

// Mirrors DistrhoPluginInfo.h's PARAMS table (name/symbol/range/unit) so
// this wrapper doesn't need to pull in DistrhoPlugin.hpp's full plugin
// machinery just to read parameter metadata.
// Generated from packages/core/param_schema.json (issue #51) - run
// scripts/gen-param-schema.mjs after editing the schema.
const DragonflyHallReverb::ParamInfo kParamInfo[paramCount] = {
#include "generated/dragonfly_hall_reverb_params.inc"
};

}  // namespace

// A large-space algorithmic hall (freeverb3's zrev/progenitor family): early
// reflections feeding a modulated late-reverberation tail, with independent
// low/mid/high decay multipliers and crossovers, plus spin/wander modulation
// that keeps a long tail from ringing metallically. The heaviest of the four
// algorithms.
//
// The vendored DSP object is held as an opaque void* and cast at every use:
// DragonflyReverbDSP has internal linkage (see the anonymous namespace above),
// so its type cannot appear in the public header. Constructed at 48kHz and
// re-prepared by Reset(); allocates, like every method here that isn't marked
// real-time safe below.
DragonflyHallReverb::DragonflyHallReverb() : dsp_(new DragonflyReverbDSP(48000.0)) {}

DragonflyHallReverb::~DragonflyHallReverb() { delete static_cast<DragonflyReverbDSP*>(dsp_); }

// Re-prepare for a new sample rate. Dragonfly rebuilds its delay networks
// here, so this allocates and is not real-time safe.
void DragonflyHallReverb::Reset(double sample_rate) {
  static_cast<DragonflyReverbDSP*>(dsp_)->sampleRateChanged(sample_rate);
}

// Run one stereo block. The const_casts are Dragonfly's signature, not a
// mutation: run() takes non-const pointers but only reads the input. Real-time
// safe. Output is the algorithm's own dry/wet blend (its `dry_level` param),
// which is why the engine leaves reverb mix to the DSP rather than staging it.
void DragonflyHallReverb::Process(const float* const* input, float* const* output, int num_frames) {
  static_cast<DragonflyReverbDSP*>(dsp_)->run(const_cast<const float**>(input),
                                               const_cast<float**>(output),
                                               static_cast<uint32_t>(num_frames));
}

// Flush the tail to silence without re-preparing - used when the graph is
// rewired underneath the block, so a stale tail can't bleed into a new route.
void DragonflyHallReverb::Mute() { static_cast<DragonflyReverbDSP*>(dsp_)->mute(); }

// Param count for this algorithm; each of the four differs, which is why
// switching algorithms re-reads the whole param surface (see the engine's
// SetReverbAlgorithm and SetReverbControl).
int DragonflyHallReverb::ParamCount() { return static_cast<int>(paramCount); }

// Name/symbol/range/unit for one param index, from the generated table above
// (which mirrors Dragonfly's own PARAMS metadata).
const DragonflyHallReverb::ParamInfo& DragonflyHallReverb::GetParamInfo(int index) {
  return kParamInfo[index];
}

// Read one param straight out of the Dragonfly DSP object - unlike the DSPark
// wrappers, these do expose getters, so no local mirror is needed.
float DragonflyHallReverb::GetParam(int index) const {
  return static_cast<DragonflyReverbDSP*>(dsp_)->getParameterValue(static_cast<uint32_t>(index));
}

// Write one param into the Dragonfly DSP object. Real-time safe: Dragonfly
// smooths param changes internally rather than rebuilding its networks.
void DragonflyHallReverb::SetParam(int index, float value) {
  static_cast<DragonflyReverbDSP*>(dsp_)->setParameterValue(static_cast<uint32_t>(index), value);
}

}  // namespace dsp
}  // namespace openaxe
