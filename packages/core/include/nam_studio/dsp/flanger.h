#pragma once

#include <memory>

namespace nam_studio::dsp {

// Classic stereo flanger: a modulated delay line with strong feedback and
// shorter base delays than a chorus, creating the signature comb-filter
// sweep ("jet plane" or "through-zero" flange when delay approaches zero).
// Same delay-line backbone as Chorus but with shorter center delays
// (0.1–3 ms vs 5–30 ms), higher feedback (up to 0.9), and no stereo phase
// offset — a traditional flanger runs a single LFO across both channels.
//
// This is a from-scratch C++ implementation (see chorus.h's doc comment
// for why BYOD/LSP chorus/flanger code can't be compiled standalone). The
// core DSP — a circular buffer, sine LFO, linear interpolation, and
// feedback path — is identical in every flanger implementation.
//
// Parameters:
//   - Rate: 0.1–10 Hz, default 0.3 — LFO speed
//   - Depth: 0.1–5 ms, default 2 — modulation deviation
//   - Feedback: 0–0.9, default 0.5 — regeneration (higher → metallic)
//   - Delay: 0.1–3 ms, default 1 — center delay (shorter = brighter sweep)
//
// The LFO is unipolar (0.5 + 0.5*sin(phase)) so the modulated delay never
// goes negative — the minimum delay is always ≥ center – depth. Classic
// through-zero flanging (where the swept delay crosses zero, momentarily
// passing a dry tap) requires a second dry delay line for alignment; not
// implemented here, but the delay + feedback topology still produces the
// characteristic comb-filter sweep.
//
// Like Chorus, this DSP always outputs the 100%-wet signal. BaseEffect
// handles dry/wet blend via its own mix knob.
class Flanger {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  Flanger();
  ~Flanger();
  Flanger(const Flanger&) = delete;
  Flanger& operator=(const Flanger&) = delete;

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
