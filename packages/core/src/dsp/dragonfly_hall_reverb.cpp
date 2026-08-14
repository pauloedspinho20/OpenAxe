#include "nam_studio/dsp/dragonfly_hall_reverb.h"

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

namespace nam_studio {
namespace dsp {
namespace {

// Mirrors DistrhoPluginInfo.h's PARAMS table (name/symbol/range/unit) so
// this wrapper doesn't need to pull in DistrhoPlugin.hpp's full plugin
// machinery just to read parameter metadata.
const DragonflyHallReverb::ParamInfo kParamInfo[paramCount] = {
    {"Dry Level", "dry_level", 0.0f, 100.0f, "%"},
    {"Early Level", "early_level", 0.0f, 100.0f, "%"},
    {"Late Level", "late_level", 0.0f, 100.0f, "%"},
    {"Size", "size", 10.0f, 60.0f, "m"},
    {"Width", "width", 50.0f, 150.0f, "%"},
    {"Predelay", "delay", 0.0f, 100.0f, "ms"},
    {"Diffuse", "diffuse", 0.0f, 100.0f, "%"},
    {"Low Cut", "low_cut", 0.0f, 200.0f, "Hz"},
    {"Low Cross", "low_xo", 200.0f, 1200.0f, "Hz"},
    {"Low Mult", "low_mult", 0.5f, 2.5f, "X"},
    {"High Cut", "high_cut", 1000.0f, 16000.0f, "Hz"},
    {"High Cross", "high_xo", 1000.0f, 16000.0f, "Hz"},
    {"High Mult", "high_mult", 0.2f, 1.2f, "X"},
    {"Spin", "spin", 0.0f, 10.0f, "Hz"},
    {"Wander", "wander", 0.0f, 40.0f, "ms"},
    {"Decay", "decay", 0.1f, 10.0f, "s"},
    {"Early Send", "early_send", 0.0f, 100.0f, "%"},
    {"Modulation", "modulation", 0.0f, 100.0f, "%"},
};

}  // namespace

DragonflyHallReverb::DragonflyHallReverb() : dsp_(new DragonflyReverbDSP(48000.0)) {}

DragonflyHallReverb::~DragonflyHallReverb() { delete static_cast<DragonflyReverbDSP*>(dsp_); }

void DragonflyHallReverb::Reset(double sample_rate) {
  static_cast<DragonflyReverbDSP*>(dsp_)->sampleRateChanged(sample_rate);
}

void DragonflyHallReverb::Process(const float* const* input, float* const* output, int num_frames) {
  static_cast<DragonflyReverbDSP*>(dsp_)->run(const_cast<const float**>(input),
                                               const_cast<float**>(output),
                                               static_cast<uint32_t>(num_frames));
}

void DragonflyHallReverb::Mute() { static_cast<DragonflyReverbDSP*>(dsp_)->mute(); }

int DragonflyHallReverb::ParamCount() { return static_cast<int>(paramCount); }

const DragonflyHallReverb::ParamInfo& DragonflyHallReverb::GetParamInfo(int index) {
  return kParamInfo[index];
}

float DragonflyHallReverb::GetParam(int index) const {
  return static_cast<DragonflyReverbDSP*>(dsp_)->getParameterValue(static_cast<uint32_t>(index));
}

void DragonflyHallReverb::SetParam(int index, float value) {
  static_cast<DragonflyReverbDSP*>(dsp_)->setParameterValue(static_cast<uint32_t>(index), value);
}

}  // namespace dsp
}  // namespace nam_studio
