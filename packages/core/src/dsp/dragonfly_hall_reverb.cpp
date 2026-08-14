#include "nam_studio/dsp/dragonfly_hall_reverb.h"

// DSP.hpp's DragonflyReverbDSP class references `paramCount` (from the
// Parameters enum) directly as an array size, so DistrhoPluginInfo.h must
// be included first - matching the vendored DSP.cpp's own include order.
#include "DistrhoPluginInfo.h"
#include "DSP.hpp"

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

DragonflyHallReverb::DragonflyHallReverb() : dsp_(std::make_unique<DragonflyReverbDSP>(48000.0)) {}

DragonflyHallReverb::~DragonflyHallReverb() = default;

void DragonflyHallReverb::Reset(double sample_rate) { dsp_->sampleRateChanged(sample_rate); }

void DragonflyHallReverb::Process(const float* const* input, float* const* output, int num_frames) {
  dsp_->run(const_cast<const float**>(input), const_cast<float**>(output),
            static_cast<uint32_t>(num_frames));
}

void DragonflyHallReverb::Mute() { dsp_->mute(); }

int DragonflyHallReverb::ParamCount() { return static_cast<int>(paramCount); }

const DragonflyHallReverb::ParamInfo& DragonflyHallReverb::GetParamInfo(int index) {
  return kParamInfo[index];
}

float DragonflyHallReverb::GetParam(int index) const {
  return dsp_->getParameterValue(static_cast<uint32_t>(index));
}

void DragonflyHallReverb::SetParam(int index, float value) {
  dsp_->setParameterValue(static_cast<uint32_t>(index), value);
}

}  // namespace dsp
}  // namespace nam_studio
