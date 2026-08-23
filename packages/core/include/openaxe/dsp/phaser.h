#pragma once

#include <memory>

namespace openaxe::dsp {

// Classic feedback phaser: a cascade of first-order all-pass filters whose
// center frequency is swept by a sine LFO, creating the signature moving-
// notch effect. Feedback wraps the last stage's output back to the input;
// higher feedback deepens the notches toward resonant peaks. Stereo via
// 90° phase-offset LFOs per channel.
//
// This is a from-scratch C++ implementation (see chorus.h's doc comment
// for why BYOD/LSP modulation code can't be compiled standalone). The core
// DSP — bilinear-transform all-pass coefficient computation, Direct Form I
// recursion, and exponential LFO-to-frequency mapping — is textbook and
// identical in every phaser implementation.
//
// The frequency sweep uses exponential interpolation from 150 Hz to
// 3000 Hz driven by a unipolar LFO (0.5 + 0.5*sin(phase)), so the sweep
// always stays within stable, positive frequency bounds regardless of depth
// setting. This avoids the |a| > 1 instability that occurs at negative
// frequencies in the all-pass coefficient formula:
//
//   a = (1 − tan(π·f/fs)) / (1 + tan(π·f/fs))
//
// where |a| > 1 for f < 0, placing the pole outside the unit circle.
//
// Parameters:
//   - Rate: 0.1–5 Hz, default 0.3 — LFO speed
//   - Depth: 0.1–1.0, default 0.7 — sweep range ratio (controls how much of
//     the 150–3000 Hz spectrum the LFO covers; at 1.0, full range)
//   - Feedback: 0–0.9, default 0.5 — regeneration (higher → more resonant)
//   - Stages: 2–8, default 4 — number of all-pass stages (each adds one
//     notch; classic 4-stage phaser = 2 notches in stereo summed to mono)
//
// All all-pass stages within a channel share the same instantaneous LFO
// frequency (classic single-LFO topology); changing the stage count resets
// all internal state to zero to avoid glitching from the size change.
//
// Like every other DSP wrapper in this codebase, this outputs the 100%-wet
// (all-passed) signal. BaseEffect handles dry/wet blend.
class Phaser {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

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
