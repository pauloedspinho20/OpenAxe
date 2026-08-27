#pragma once
// Phase 0 commons — TPT State-Variable Filter (zero-delay feedback)
// Used by Filter ladder pre-filter and optional WDF CryBaby path.
// Based on Vadim Zavalishin TPT SVF, 2x oversampling not needed for LFO rates.
#include <cmath>

namespace openaxe::dsp::internal {

// TPT SVF with low/high/band outputs simultaneously
struct SvfTPT {
  float g = 0, R = 1, h = 0;
  float s1 = 0, s2 = 0; // integrators

  void Reset() { s1 = s2 = 0; }

  // type: 0 lowpass, cutoff in Hz, q = 0.5..10 (resonance)
  void SetLowpass(float cutoff, float q, float sr) {
    if (cutoff <= 0 || sr <= 0) { g = 0; R = 1; h = 1; return; }
    cutoff = std::clamp(cutoff, 20.0f, sr * 0.45f);
    g = std::tan(3.14159265359f * cutoff / sr);
    R = 1.0f / (2.0f * std::clamp(q, 0.1f, 10.0f));
    h = 1.0f / (1.0f + g * (g + 2.0f * R));
  }

  // Process one sample, returns lowpass output
  inline float ProcessLow(float x) {
    const float yH = (x - R * s1 - g * s1 - s2) * h;
    const float yB = g * yH + s1;
    const float yL = g * yB + s2;
    s1 = g * yH + yB;
    s2 = g * yB + yL;
    return yL;
  }
  inline float ProcessBand(float x) {
    const float yH = (x - R * s1 - g * s1 - s2) * h;
    const float yB = g * yH + s1;
    const float yL = g * yB + s2;
    s1 = g * yH + yB;
    s2 = g * yB + yL;
    return yB;
  }
  inline float ProcessHigh(float x) {
    const float yH = (x - R * s1 - g * s1 - s2) * h;
    const float yB = g * yH + s1;
    const float yL = g * yB + s2;
    s1 = g * yH + yB;
    s2 = g * yB + yL;
    return yH;
  }
};

} // namespace openaxe::dsp::internal
