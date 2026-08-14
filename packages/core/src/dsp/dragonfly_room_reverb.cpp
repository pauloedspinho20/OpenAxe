#include "nam_studio/dsp/dragonfly_room_reverb.h"

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

const DragonflyRoomReverb::ParamInfo kParamInfo[paramCount] = {
    {"Dry Level", "dry_level", 0.0f, 100.0f, "%"},
    {"Early Level", "early_level", 0.0f, 100.0f, "%"},
    {"Early Send", "early_send", 0.0f, 100.0f, "%"},
    {"Late Level", "late_level", 0.0f, 100.0f, "%"},
    {"Size", "size", 8.0f, 32.0f, "m"},
    {"Width", "width", 50.0f, 150.0f, "%"},
    {"Predelay", "predelay", 0.0f, 100.0f, "ms"},
    {"Decay", "decay", 0.1f, 10.0f, "s"},
    {"Diffuse", "diffuse", 0.0f, 100.0f, "%"},
    {"Spin", "spin", 0.0f, 5.0f, "Hz"},
    {"Wander", "wander", 0.0f, 100.0f, "%"},
    {"High Cut", "in_high_cut", 1000.0f, 16000.0f, "Hz"},
    {"Early Damp", "early_damp", 1000.0f, 16000.0f, "Hz"},
    {"Late Damp", "late_damp", 1000.0f, 16000.0f, "Hz"},
    {"Low Boost", "low_boost", 0.0f, 100.0f, "%"},
    {"Boost Freq", "boost_freq", 50.0f, 1050.0f, "Hz"},
    {"Low Cut", "in_low_cut", 0.0f, 200.0f, "Hz"},
};

}  // namespace

DragonflyRoomReverb::DragonflyRoomReverb() : dsp_(new DragonflyReverbDSP(48000.0)) {}

DragonflyRoomReverb::~DragonflyRoomReverb() { delete static_cast<DragonflyReverbDSP*>(dsp_); }

void DragonflyRoomReverb::Reset(double sample_rate) {
  static_cast<DragonflyReverbDSP*>(dsp_)->sampleRateChanged(sample_rate);
}

void DragonflyRoomReverb::Process(const float* const* input, float* const* output, int num_frames) {
  static_cast<DragonflyReverbDSP*>(dsp_)->run(const_cast<const float**>(input),
                                               const_cast<float**>(output),
                                               static_cast<uint32_t>(num_frames));
}

void DragonflyRoomReverb::Mute() { static_cast<DragonflyReverbDSP*>(dsp_)->mute(); }

int DragonflyRoomReverb::ParamCount() { return static_cast<int>(paramCount); }

const DragonflyRoomReverb::ParamInfo& DragonflyRoomReverb::GetParamInfo(int index) {
  return kParamInfo[index];
}

float DragonflyRoomReverb::GetParam(int index) const {
  return static_cast<DragonflyReverbDSP*>(dsp_)->getParameterValue(static_cast<uint32_t>(index));
}

void DragonflyRoomReverb::SetParam(int index, float value) {
  static_cast<DragonflyReverbDSP*>(dsp_)->setParameterValue(static_cast<uint32_t>(index), value);
}

}  // namespace dsp
}  // namespace nam_studio
