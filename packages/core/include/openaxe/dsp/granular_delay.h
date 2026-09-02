#pragma once

#include <memory>

#include "openaxe/dsp/dspark_param.h"

namespace openaxe::dsp {

// Granular delay: a delay line supplies the repeats, dspark::GranularProcessor
// turns each repeat into a grain cloud, and the line's regeneration path keeps
// the parts DSPark has no equivalent for - the `character` lo-fi colouring (a
// lowpass plus a soft saturation, so successive repeats darken and grit up),
// the `spread` stereo cross-feed, and Freeze/Hold per issue #268.
//
// Grain count is not fixed: DSPark keeps `density * grainSize` grains alive at
// once, so the defaults (25 Hz, 80 ms) give an overlap of 2. Below an overlap
// of 1 the output is intermittently silent, which is why `density` defaults to
// dspark's own 25 Hz rather than something lower.
//
// The delay line reads through the shared internal::VariableDelay (Lagrange3).
// Pitch is DSPark's per-grain resampling, +/-12 st; measured 445 Hz for a
// +12 st shift of 220 Hz.
//
// Two things this used to claim and does not do. Grain interpolation is
// DSPark's, not this tree's Lagrange3. And feedback taps the delay line's
// output, not the grain output: GranularProcessor is block-based, so a block's
// grains only exist after all of that block's delay reads have happened, and
// `time` can be shorter than one block (10 ms = 480 samples against a
// 512-sample block). The cloud therefore sits across the regeneration loop
// rather than inside it.
//
// Parameters (see granular_delay.cpp):
//   time 10-2000ms, grain_size 10-500ms, density 1-50Hz, pitch -12..12st,
//   jitter 0-1, feedback 0-0.9, spread 0-1, character 0-1, freeze 0/1
class GranularDelay {
 public:
  using ParamInfo = DsparkParamInfo;

  GranularDelay();
  ~GranularDelay();
  GranularDelay(const GranularDelay&) = delete;
  GranularDelay& operator=(const GranularDelay&) = delete;

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
