#pragma once

#include <memory>

#include "nam_studio/dsp/dspark_param.h"

namespace nam_studio::dsp {

// Tremolo block (kTremolo), backed by dspark::Tremolo<float> (packages/core/
// third_party/dspark) through the shared DsparkEffect adapter. Classic
// amplitude modulation: a per-channel phasor sweeps a gain from 1 down to
// (1 - depth) at the LFO rate, with sine/triangle/square waveforms. Stereo
// mode offsets the right channel's LFO by 180° for a slow auto-pan effect.
//
// Parameters (see tremolo.cpp's kParamInfo):
//   - Rate: 0.1–20 Hz, default 4 — LFO speed
//   - Depth: 0–1, default 0.5 — modulation depth (1 = full amplitude cut)
//   - Shape: 0–2, default 0 — Sine / Triangle / Square waveform select
//
// Outputs the fully-modulated signal; BaseEffect blends it against the dry
// input, matching every other wrapper in this codebase.
class Tremolo {
 public:
  using ParamInfo = DsparkParamInfo;

  Tremolo();
  ~Tremolo();
  Tremolo(const Tremolo&) = delete;
  Tremolo& operator=(const Tremolo&) = delete;

  void Reset(double sample_rate);
  void Process(const float* const* input, float* const* output, int num_frames);

  static int ParamCount();
  static const ParamInfo& GetParamInfo(int index);
  float GetParam(int index) const;
  void SetParam(int index, float value);

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace nam_studio::dsp