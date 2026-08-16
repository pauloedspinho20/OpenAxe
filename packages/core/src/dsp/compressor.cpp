#include "nam_studio/dsp/compressor.h"

#include "Effects/Compressor.h"
#include "internal/dspark_wrapper.h"

namespace nam_studio::dsp {

namespace {

constexpr int kThresholdParam = 0;
constexpr int kRatioParam = 1;
constexpr int kAttackParam = 2;
constexpr int kReleaseParam = 3;
constexpr int kKneeParam = 4;
constexpr int kMakeupParam = 5;
constexpr int kCharacterParam = 6;
constexpr int kMixParam = 7;
constexpr int kParamCount = 8;

const DsparkParamInfo kParamInfo[kParamCount] = {
    {"Threshold", "threshold", -60.0f, 0.0f, "dB"},
    {"Ratio", "ratio", 1.0f, 20.0f, ":1"},
    {"Attack", "attack", 0.1f, 100.0f, "ms"},
    {"Release", "release", 1.0f, 2000.0f, "ms"},
    {"Knee", "knee", 0.0f, 20.0f, "dB"},
    {"Makeup", "makeup_gain", 0.0f, 24.0f, "dB"},
    {"Character", "character", 0.0f, 3.0f, "x"},
    {"Mix", "mix", 0.0f, 1.0f, "x"},
};

constexpr float kDefaults[kParamCount] = {
    -18.0f,  // threshold
    4.0f,    // ratio
    5.0f,    // attack
    100.0f,  // release
    0.0f,    // knee
    0.0f,    // makeup
    0.0f,    // character (Clean)
    1.0f,    // mix (fully wet)
};

using Character = dspark::Compressor<float>::Character;

struct CompressorTraits {
  static constexpr int kParamCount = 8;
  static constexpr const DsparkParamInfo* kInfo = kParamInfo;
  static constexpr const float* kDefaults = nam_studio::dsp::kDefaults;

  static void Apply(dspark::Compressor<float>& proc, const float* values, int index, float value) {
    (void)values;
    switch (index) {
      case kThresholdParam:
        proc.setThreshold(value);
        break;
      case kRatioParam:
        proc.setRatio(value);
        break;
      case kAttackParam:
        proc.setAttack(value);
        break;
      case kReleaseParam:
        proc.setRelease(value);
        break;
      case kKneeParam:
        proc.setKnee(value);
        break;
      case kMakeupParam:
        proc.setMakeupGain(value);
        break;
      case kCharacterParam:
        proc.setCharacter(static_cast<Character>(static_cast<int>(value)));
        break;
      case kMixParam:
        proc.setMix(value);
        break;
      default:
        break;
    }
  }
};

}  // namespace

struct Compressor::Impl {
  DsparkEffect<dspark::Compressor<float>, CompressorTraits> dsp;
};

Compressor::Compressor() : impl_(std::make_unique<Impl>()) {}
Compressor::~Compressor() = default;

void Compressor::Reset(double sample_rate) { impl_->dsp.Reset(sample_rate); }

void Compressor::Process(const float* const* input, float* const* output, int num_frames) {
  impl_->dsp.Process(input, output, num_frames);
}

int Compressor::ParamCount() {
  return DsparkEffect<dspark::Compressor<float>, CompressorTraits>::ParamCount();
}

const Compressor::ParamInfo& Compressor::GetParamInfo(int index) {
  return DsparkEffect<dspark::Compressor<float>, CompressorTraits>::GetParamInfo(index);
}

float Compressor::GetParam(int index) const { return impl_->dsp.GetParam(index); }

void Compressor::SetParam(int index, float value) { impl_->dsp.SetParam(index, value); }

}  // namespace nam_studio::dsp