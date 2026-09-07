#pragma once

#include <memory>

#include "openaxe/dsp/dspark_param.h"

namespace openaxe::dsp {

// MXR Phase 90 voice (the EVH pedal is the same circuit plus a Script/Block
// switch): a 4-stage cascaded-allpass phaser with a single Speed knob,
// backed by dspark::Phaser<float> (packages/core/third_party/dspark) through
// the shared DsparkEffect adapter (src/dsp/internal/dspark_wrapper.h) - the
// same shape as compressor.cpp. The pedal values are fixed in Configure()
// (see src/dsp/phaser.cpp): 4 stages, triangle LFO, 200 Hz-2.8 kHz sweep at
// full depth, mono (both channels share one LFO, the way a mono pedal sits
// in a stereo rig), tanh-saturated feedback, wet-only output.
//
// This replaced a hand-rolled 4-param implementation (rate/depth/feedback/
// stages, issue #317). The migration is a voicing change, not an
// optimisation: measured Release cost was 0.216% of real time (issue #317's
// comment), a rounding error next to NAM inference, and dspark::Phaser
// computes its allpass coefficient per sample too - just with fastExp/fastTan
// approximations. What the migration buys is the pedal behaviour: an even
// triangle sweep over a fixed guitar-mid band with two feedback voices,
// instead of a sine sweep whose `depth` knob parked the notches in the low
// mids. dspark::Phaser's centre/range/waveform/spread setters exist but are
// deliberately NOT params - a studio phaser with six sweep knobs is a
// different effect from a Phase 90, and fewer knobs here sound better.
//
// Parameters:
//   - Rate: 0.1-8 Hz, default 0.5 - the pedal's Speed knob (symbol kept as
//     `rate` so presets saved with the old surface keep their speed)
//   - Script: 0-1, default 1 - the EVH pedal's Script switch. 1 (Script) is
//     the vintage voice, light regeneration for a soft, chewy sweep; 0
//     (Block) is the modern voice, hotter feedback for sharper peaks.
//     Discrete on the pedal (>= 0.5 reads as Script); crossing the threshold
//     morphs rather than clicks (feedback is smoothed inside dspark).
//
// The fixed sweep (200 Hz-2.8 kHz at full depth) and both feedback points
// (Script 0.3, Block 0.6) are voicing choices pinned by phaser_test.cpp and
// the golden harness - see src/dsp/phaser.cpp for the reasoning.
//
// Like every other DSP wrapper in this codebase, this outputs the 100%-wet
// (all-passed) signal. BaseEffect handles dry/wet blend (the engine appends
// its own `mix`, defaulting to 0.5 for kPhaser - the classic 50/50 pedal
// blend); the processor's internal mixer stays at 1.0.
class Phaser {
 public:
  using ParamInfo = DsparkParamInfo;

  Phaser();
  ~Phaser();
  Phaser(const Phaser&) = delete;
  Phaser& operator=(const Phaser&) = delete;

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
