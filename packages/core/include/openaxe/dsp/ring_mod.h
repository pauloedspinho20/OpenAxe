#pragma once

#include <memory>

#include "openaxe/dsp/dspark_param.h"

namespace openaxe::dsp {

// Ring modulator with vintage diode/transformer saturation flavor.
// Sine carrier only (per issue #268), with drive adding saturation via tanh
// soft-clipping mimicking diode ring transformer coloration.
//
// Parameters (see ring_mod.cpp kParamInfo):
//   - frequency: 20–2000 Hz carrier
//   - drive: 0–1 saturation amount
class RingMod {
 public:
  using ParamInfo = DsparkParamInfo;

  RingMod();
  ~RingMod();
  RingMod(const RingMod&) = delete;
  RingMod& operator=(const RingMod&) = delete;

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

}  // namespace openaxe::dsp
