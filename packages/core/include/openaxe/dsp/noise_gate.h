#pragma once

#include <memory>

#include "openaxe/dsp/dspark_param.h"

namespace openaxe::dsp {

// Noise Gate block (kNoiseGate), backed by dspark::NoiseGate<float>
// (packages/core/third_party/dspark) through the shared DsparkEffect adapter.
// A state-machine gate with open/hold/close hysteresis, attack/hold/release
// envelopes, and a configurable maximum attenuation range. The gate's detector
// is peak-linked across both stereo channels (no channel gets ungated).
//
// Parameters (see noise_gate.cpp's kParamInfo):
//   - Threshold: -80–0 dB, default -40 — level above which the gate opens
//   - Hysteresis: 0–20 dB, default 4 — gap between open and close thresholds
//   - Attack: 0.01–50 ms, default 0.5 — fade-in once opened
//   - Hold: 0–500 ms, default 50 — time held open after the signal drops
//   - Release: 1–1000 ms, default 100 — fade-out once closing
//   - Range: -100–0 dB, default -80 — maximum attenuation when closed
//
// Outputs the gated (100%-processed) signal; BaseEffect handles dry/wet
// blending, same convention as every other wrapper in this codebase.
class NoiseGate {
 public:
  using ParamInfo = DsparkParamInfo;

  NoiseGate();
  ~NoiseGate();
  NoiseGate(const NoiseGate&) = delete;
  NoiseGate& operator=(const NoiseGate&) = delete;

  void Reset(double sample_rate);
  void Process(const float* const* input, float* const* output, int num_frames);

  static int ParamCount();
  static const ParamInfo& GetParamInfo(int index);
  float GetParam(int index) const;
  void SetParam(int index, float value);

  // Current gate gain 0..1 (1 = open) and gain reduction in dB (≤0). Tier 1.
  float GetGateGain() const;
  float GetGainReductionDb() const;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace openaxe::dsp