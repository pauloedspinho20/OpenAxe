#include "nam_studio/dsp/noise_gate.h"

#include "Effects/NoiseGate.h"
#include "internal/dspark_wrapper.h"

namespace nam_studio::dsp {

namespace {

constexpr int kThresholdParam = 0;
constexpr int kHysteresisParam = 1;
constexpr int kAttackParam = 2;
constexpr int kHoldParam = 3;
constexpr int kReleaseParam = 4;
constexpr int kRangeParam = 5;
constexpr int kParamCount = 6;

const DsparkParamInfo kParamInfo[kParamCount] = {
    {"Threshold", "threshold", -80.0f, 0.0f, "dB"},
    {"Hysteresis", "hysteresis", 0.0f, 20.0f, "dB"},
    {"Attack", "attack", 0.01f, 50.0f, "ms"},
    {"Hold", "hold", 0.0f, 500.0f, "ms"},
    {"Release", "release", 1.0f, 1000.0f, "ms"},
    {"Range", "range", -100.0f, 0.0f, "dB"},
};

constexpr float kDefaults[kParamCount] = {
    -40.0f,  // threshold
    4.0f,    // hysteresis
    0.5f,    // attack
    50.0f,   // hold
    100.0f,  // release
    -80.0f,  // range
};

}  // namespace

struct NoiseGateTraits {
  static constexpr int kParamCount = nam_studio::dsp::kParamCount;
  static constexpr const DsparkParamInfo* kInfo = nam_studio::dsp::kParamInfo;
  static constexpr const float* kDefaults = nam_studio::dsp::kDefaults;

  static void Apply(dspark::NoiseGate<float>& proc, const float* values, int index, float value) {
    (void)values;
    switch (index) {
      case kThresholdParam:
        proc.setThreshold(value);
        break;
      case kHysteresisParam:
        proc.setHysteresis(value);
        break;
      case kAttackParam:
        proc.setAttack(value);
        break;
      case kHoldParam:
        proc.setHold(value);
        break;
      case kReleaseParam:
        proc.setRelease(value);
        break;
      case kRangeParam:
        proc.setRange(value);
        break;
      default:
        break;
    }
  }
};

struct NoiseGate::Impl {
  DsparkEffect<dspark::NoiseGate<float>, NoiseGateTraits> dsp;
};

NoiseGate::NoiseGate() : impl_(std::make_unique<Impl>()) {}
NoiseGate::~NoiseGate() = default;

void NoiseGate::Reset(double sample_rate) { impl_->dsp.Reset(sample_rate); }

void NoiseGate::Process(const float* const* input, float* const* output, int num_frames) {
  impl_->dsp.Process(input, output, num_frames);
}

int NoiseGate::ParamCount() {
  return DsparkEffect<dspark::NoiseGate<float>, NoiseGateTraits>::ParamCount();
}

const NoiseGate::ParamInfo& NoiseGate::GetParamInfo(int index) {
  return DsparkEffect<dspark::NoiseGate<float>, NoiseGateTraits>::GetParamInfo(index);
}

float NoiseGate::GetParam(int index) const { return impl_->dsp.GetParam(index); }

void NoiseGate::SetParam(int index, float value) { impl_->dsp.SetParam(index, value); }

}  // namespace nam_studio::dsp