#include "openaxe/dsp/noise_gate.h"

#include <algorithm>
#include <atomic>
#include <cmath>

#include "Effects/NoiseGate.h"
#include "internal/dspark_wrapper.h"

namespace openaxe::dsp {

namespace {

constexpr int kThresholdParam = 0;
constexpr int kHysteresisParam = 1;
constexpr int kAttackParam = 2;
constexpr int kHoldParam = 3;
constexpr int kReleaseParam = 4;
constexpr int kRangeParam = 5;
constexpr int kParamCount = 6;

// Generated from packages/core/param_schema.json (issue #51) - run
// scripts/gen-param-schema.mjs after editing the schema.
const DsparkParamInfo kParamInfo[kParamCount] = {
#include "generated/noise_gate_params.inc"
};

// A usable single-coil starting point: open at -40dB, 4dB of hysteresis so a
// decaying note doesn't chatter the gate, fast attack, short hold, and a range
// deep enough (-80dB) to read as silence when closed.
constexpr float kDefaults[kParamCount] = {
    -40.0f,  // threshold
    4.0f,    // hysteresis
    0.5f,    // attack
    50.0f,   // hold
    100.0f,  // release
    -80.0f,  // range
};

}  // namespace

// The policy DsparkEffect<> needs: param table, defaults, and how each param
// index maps onto the vendored gate's setters. See internal/dspark_wrapper.h.
// Threshold/hysteresis/range are dB; attack/hold/release are milliseconds -
// the units the generated param table declares, passed straight through.
struct NoiseGateTraits {
  static constexpr int kParamCount = openaxe::dsp::kParamCount;
  static constexpr const DsparkParamInfo* kInfo = openaxe::dsp::kParamInfo;
  static constexpr const float* kDefaults = openaxe::dsp::kDefaults;

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

// Pimpl so the vendored dspark:: types stay out of the public header.
struct NoiseGate::Impl {
  DsparkEffect<dspark::NoiseGate<float>, NoiseGateTraits> dsp;
  std::atomic<float> gate_gain{1.0f};
};

NoiseGate::NoiseGate() : impl_(std::make_unique<Impl>()) {}
NoiseGate::~NoiseGate() = default;

// Re-prepare for a new sample rate - the envelope follower's attack/hold/
// release coefficients are all derived from it - and re-seed every param.
// Allocates; not real-time safe.
void NoiseGate::Reset(double sample_rate) {
  impl_->dsp.Reset(sample_rate);
  impl_->gate_gain.store(0.0f, std::memory_order_relaxed);
}

// Envelope-following gate: while the input sits below the threshold the
// output is attenuated by `range`, and it opens/closes over the attack/hold/
// release times. Hysteresis raises the close threshold above the open one so a
// note decaying through the threshold doesn't flutter the gate. Real-time safe.
void NoiseGate::Process(const float* const* input, float* const* output, int num_frames) {
  impl_->dsp.Process(input, output, num_frames);
  // Derive gate openness from the actual I/O ratio: when closed the output is
  // near silence (range attenuation), when open output ≈ input. This avoids
  // patching the vendored DSPark header for a private field.
  float in_peak = 0.0f;
  float out_peak = 0.0f;
  for (int ch = 0; ch < 2; ++ch) {
    for (int i = 0; i < num_frames; ++i) {
      in_peak = std::max(in_peak, std::fabs(input[ch][i]));
      out_peak = std::max(out_peak, std::fabs(output[ch][i]));
    }
  }
  float gain = 1.0f;
  if (in_peak > 1e-6f) gain = std::clamp(out_peak / in_peak, 0.0f, 1.0f);
  else if (out_peak < 1e-6f) gain = 0.0f;
  impl_->gate_gain.store(gain, std::memory_order_relaxed);
}

// Param surface: threshold (dB), hysteresis (dB), attack (ms), hold (ms),
// release (ms), range (dB of attenuation while closed).
int NoiseGate::ParamCount() {
  return DsparkEffect<dspark::NoiseGate<float>, NoiseGateTraits>::ParamCount();
}

// Name/symbol/range/unit for one param index.
const NoiseGate::ParamInfo& NoiseGate::GetParamInfo(int index) {
  return DsparkEffect<dspark::NoiseGate<float>, NoiseGateTraits>::GetParamInfo(index);
}

// Current value of one param, from DsparkEffect's mirror of what it pushed
// into the processor (the vendored types expose no getters).
float NoiseGate::GetParam(int index) const { return impl_->dsp.GetParam(index); }

// Store one param and push it into the processor. Real-time safe.
void NoiseGate::SetParam(int index, float value) { impl_->dsp.SetParam(index, value); }

float NoiseGate::GetGateGain() const { return impl_->gate_gain.load(std::memory_order_relaxed); }

float NoiseGate::GetGainReductionDb() const {
  const float g = impl_->gate_gain.load(std::memory_order_relaxed);
  return g > 0.0f ? 20.0f * std::log10(std::max(g, 1e-6f)) : -100.0f;
}

}  // namespace openaxe::dsp