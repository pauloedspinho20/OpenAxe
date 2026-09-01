#pragma once

#include <memory>

namespace openaxe::dsp {

// Classic stereo chorus: a modulated delay line whose read tap position is
// swept by a sine LFO, creating the signature pitch-wavering and stereo
// widening. Each stereo channel has its own independent delay line; the
// right channel's LFO runs 90° out of phase, producing a wider stereo image
// than a mono LFO would.
//
// This is a from-scratch C++ implementation, not extracted from BYOD or LSP.
// BYOD's own Chorus.h (src/processors/modulation/Chorus.h) depends on JUCE's
// BaseProcessor pipeline (pch.h → JUCE, RTNeural, Eigen) and can't be
// compiled standalone. LSP's chorus (lsp-plugins-chorus) pulls in 7+
// library repos for its plugin shell. The core DSP — a circular buffer,
// sine LFO, linear interpolation, and optional feedback — is textbook and
// identical in every chorus implementation; the "quality" comes from
// correct math, not from which library provides `std::sin`.
//
// Parameters (see chorus.cpp's kParamInfo):
//   - Rate: 0.1–10 Hz, default 0.5 — LFO speed
//   - Depth: 0.2–10 ms, default 5 — modulation deviation from center delay
//   - Delay: 5–30 ms, default 8 — center delay time (classic chorus ~7–8 ms)
//   - Feedback: 0–0.5, default 0.2 — output fed back into the buffer
//
// The BaseEffect layer in the web app (apps/web/src/effects/Effect.ts)
// handles the dry/wet crossfade via its own mix knob — this DSP always
// outputs the 100%-wet modulated signal so BaseEffect can blend it cleanly
// against the original dry input. At mix=1.0 (fully wet), the effect is
// vibrato-like; blend back with the dry signal for classic chorus.
//
// Stereo, like every other DSP wrapper in this codebase: one independent
// channel per Channel (left/right), no shared LFO state between them.
class Chorus {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  Chorus();
  ~Chorus();
  Chorus(const Chorus&) = delete;
  Chorus& operator=(const Chorus&) = delete;

  // (Re)allocates the internal delay buffers for the given sample rate.
  // Must be called at least once before Process().
  void Reset(double sample_rate);

  // Real-time safe (no allocation). input/output are interleaved stereo
  // float buffers of num_frames samples each. num_frames must be ≤ the
  // max_block_size the engine was Reset() with.
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
