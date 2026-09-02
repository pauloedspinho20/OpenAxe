#pragma once

#include <memory>

#include "openaxe/dsp/dspark_param.h"

namespace openaxe::dsp {

// Ring modulator: a sine carrier multiplies the input, then a tanh stage adds
// the diode/transformer grit. Sine carrier only, per issue #268.
//
// Both stages run at 4x through dspark::Oversampling's polyphase half-band
// filters (63 taps, ~-60 dB stopband), because the multiply spreads the
// spectrum and the tanh then spreads it further - at the base rate those
// products fold back into the audible band at full amplitude, which is what
// issue #318 was about. Measured residual against a 16x/Maximum-quality
// reference of the same algorithm: -68.9 dB. The cost is 48 samples (1 ms at
// 48 kHz) of group delay, two orders of magnitude below the 40 ms issue #268
// had already rejected.
//
// Not backed by dspark::RingModulator, deliberately: it has no oversampling
// of its own, its fastSin carrier measured 26.8 dB dirtier than std::sin, and
// its `soar` control - the natural home for `drive` - is only read in its
// GeometricMean branch. See the comment block in ring_mod.cpp.
//
// Parameters (see ring_mod.cpp kParamInfo):
//   - frequency: 20-2000 Hz carrier
//   - drive: 0-1 saturation amount, normalised so it changes character not level
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
