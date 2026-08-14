#include "nam_studio/dsp/dragonfly_early_reflections.h"

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

const DragonflyEarlyReflections::ParamInfo kParamInfo[paramCount] = {
    {"Dry Level", "dry_level", 0.0f, 100.0f, "%"},
    {"Wet Level", "early_level", 0.0f, 100.0f, "%"},
    {"Program", "program", 0.0f, 7.0f, ""},
    {"Size", "size", 10.0f, 60.0f, "m"},
    {"Width", "width", 50.0f, 150.0f, "%"},
    {"Low Cut", "low_cut", 0.0f, 200.0f, "Hz"},
    {"High Cut", "high_cut", 1000.0f, 16000.0f, "Hz"},
};

}  // namespace

DragonflyEarlyReflections::DragonflyEarlyReflections() : dsp_(new DragonflyReverbDSP(48000.0)) {}

DragonflyEarlyReflections::~DragonflyEarlyReflections() {
  delete static_cast<DragonflyReverbDSP*>(dsp_);
}

void DragonflyEarlyReflections::Reset(double sample_rate) {
  static_cast<DragonflyReverbDSP*>(dsp_)->sampleRateChanged(sample_rate);
}

void DragonflyEarlyReflections::Process(const float* const* input, float* const* output,
                                         int num_frames) {
  static_cast<DragonflyReverbDSP*>(dsp_)->run(const_cast<const float**>(input),
                                               const_cast<float**>(output),
                                               static_cast<uint32_t>(num_frames));
}

void DragonflyEarlyReflections::Mute() { static_cast<DragonflyReverbDSP*>(dsp_)->mute(); }

int DragonflyEarlyReflections::ParamCount() { return static_cast<int>(paramCount); }

const DragonflyEarlyReflections::ParamInfo& DragonflyEarlyReflections::GetParamInfo(int index) {
  return kParamInfo[index];
}

float DragonflyEarlyReflections::GetParam(int index) const {
  return static_cast<DragonflyReverbDSP*>(dsp_)->getParameterValue(static_cast<uint32_t>(index));
}

void DragonflyEarlyReflections::SetParam(int index, float value) {
  static_cast<DragonflyReverbDSP*>(dsp_)->setParameterValue(static_cast<uint32_t>(index), value);
}

}  // namespace dsp
}  // namespace nam_studio
