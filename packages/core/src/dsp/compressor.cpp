#include "openaxe/dsp/compressor.h"

#include "Effects/Compressor.h"
#include "internal/dspark_wrapper.h"

namespace openaxe::dsp {

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

// Generated from packages/core/param_schema.json (issue #51) - run
// scripts/gen-param-schema.mjs after editing the schema.
const DsparkParamInfo kParamInfo[kParamCount] = {
#include "generated/compressor_params.inc"
};

// A transparent 4:1 starting point (hard knee, no makeup, fully wet, Clean
// character) - deliberately closer to "levelling" than "pumping", since the
// character models below are what the user reaches for when they want colour.
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

// The policy DsparkEffect<> needs: param table, defaults, and how each param
// index maps onto the vendored compressor's setters. Threshold/knee/makeup are
// dB, ratio is :1, attack/release are ms, mix is 0..1.
struct CompressorTraits {
  static constexpr int kParamCount = 8;
  static constexpr const DsparkParamInfo* kInfo = kParamInfo;
  static constexpr const float* kDefaults = openaxe::dsp::kDefaults;

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

// Pimpl so the vendored dspark:: types stay out of the public header.
struct Compressor::Impl {
  DsparkEffect<dspark::Compressor<float>, CompressorTraits> dsp;
};

Compressor::Compressor() : impl_(std::make_unique<Impl>()) {}
Compressor::~Compressor() = default;

// Re-prepare for a new sample rate (the attack/release ballistics are derived
// from it) and re-seed every param. Allocates; not real-time safe.
void Compressor::Reset(double sample_rate) { impl_->dsp.Reset(sample_rate); }

// Feed-forward compressor: a level detector drives gain reduction above the
// threshold at the configured ratio, smoothed by the attack/release times and
// softened around the threshold by the knee, then makeup gain and the dry/wet
// mix (for parallel compression) are applied. `character` swaps the detector/
// ballistics model - Clean, Opto, FET, Varimu. Real-time safe.
void Compressor::Process(const float* const* input, float* const* output, int num_frames) {
  impl_->dsp.Process(input, output, num_frames);
}

// Param surface: threshold (dB), ratio (:1), attack (ms), release (ms), knee
// (dB), makeup (dB), character (0=Clean, 1=Opto, 2=FET, 3=Varimu), mix (0..1).
int Compressor::ParamCount() {
  return DsparkEffect<dspark::Compressor<float>, CompressorTraits>::ParamCount();
}

// Name/symbol/range/unit for one param index.
const Compressor::ParamInfo& Compressor::GetParamInfo(int index) {
  return DsparkEffect<dspark::Compressor<float>, CompressorTraits>::GetParamInfo(index);
}

// Current value of one param, from DsparkEffect's mirror of what it pushed
// into the processor (the vendored types expose no getters).
float Compressor::GetParam(int index) const { return impl_->dsp.GetParam(index); }

// Store one param and push it into the processor. Real-time safe.
void Compressor::SetParam(int index, float value) { impl_->dsp.SetParam(index, value); }

}  // namespace openaxe::dsp