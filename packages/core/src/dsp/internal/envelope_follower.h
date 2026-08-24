#pragma once
// Phase 0 commons — EnvelopeFollower (attack/release one-pole) for Filter
// envelope mode and for Wah sensitivity scaling.
// RT-safe: Process per sample, no alloc.
#include <cmath>

namespace openaxe::dsp::internal {

struct EnvelopeFollower {
  float env = 0.0f;
  float sr = 48000.0f;
  // attack ~5ms, release ~50ms by default (issue #268 filter spec)
  float attack_coeff = 0.0f;
  float release_coeff = 0.0f;

  void Prepare(float sample_rate, float attack_ms = 5.0f, float release_ms = 50.0f) {
    sr = sample_rate;
    attack_coeff = 1.0f - std::exp(-1.0f / (attack_ms * sr / 1000.0f));
    release_coeff = 1.0f - std::exp(-1.0f / (release_ms * sr / 1000.0f));
  }
  void Reset() { env = 0.0f; }

  inline float Process(float x) {
    const float a = std::fabs(x);
    const float coeff = (a > env) ? attack_coeff : release_coeff;
    env += coeff * (a - env);
    return env;
  }
  inline float Value() const { return env; }
};

} // namespace openaxe::dsp::internal
