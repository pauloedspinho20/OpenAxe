#pragma once
// Phase 0 commons — shared Biquad (Transposed Direct Form II) used by
// Filter, Tremolo harmonic crossover, Rotary crossover and Delay tone filter.
// RT-safe: coefficient update is caller's responsibility (once per block),
// Process is pure arithmetic, Reset clears history.
#include <cmath>

namespace openaxe::dsp::internal {

struct Biquad {
  float b0 = 1.0f, b1 = 0.0f, b2 = 0.0f;
  float a1 = 0.0f, a2 = 0.0f;
  float z1 = 0.0f, z2 = 0.0f;

  void Reset() { z1 = z2 = 0.0f; }

  // Butterworth Q=0.707 lowpass via RBJ cookbook
  void SetLowpass(float freq, float q, float sr) {
    if (freq <= 0 || sr <= 0) { b0 = 1; b1 = b2 = a1 = a2 = 0; return; }
    if (freq >= sr * 0.49f) { b0 = 1; b1 = b2 = a1 = a2 = 0; return; }
    const float w0 = 6.28318530718f * freq / sr;
    const float alpha = std::sin(w0) / (2.0f * q);
    const float cosw = std::cos(w0);
    const float a0 = 1.0f + alpha;
    b0 = (1.0f - cosw) * 0.5f / a0;
    b1 = (1.0f - cosw) / a0;
    b2 = b0;
    a1 = (-2.0f * cosw) / a0;
    a2 = (1.0f - alpha) / a0;
  }
  void SetHighpass(float freq, float q, float sr) {
    if (freq <= 0 || sr <= 0) { b0 = 1; b1 = b2 = a1 = a2 = 0; return; }
    if (freq >= sr * 0.49f) { b0 = 0; b1 = b2 = a1 = a2 = 0; return; }
    const float w0 = 6.28318530718f * freq / sr;
    const float alpha = std::sin(w0) / (2.0f * q);
    const float cosw = std::cos(w0);
    const float a0 = 1.0f + alpha;
    b0 = (1.0f + cosw) * 0.5f / a0;
    b1 = -(1.0f + cosw) / a0;
    b2 = b0;
    a1 = (-2.0f * cosw) / a0;
    a2 = (1.0f - alpha) / a0;
  }
  void SetBandpass(float freq, float q, float sr) {
    if (freq <= 0 || sr <= 0) { b0 = 1; b1 = b2 = a1 = a2 = 0; return; }
    const float w0 = 6.28318530718f * freq / sr;
    const float alpha = std::sin(w0) / (2.0f * q);
    const float cosw = std::cos(w0);
    const float a0 = 1.0f + alpha;
    b0 = alpha / a0;
    b1 = 0;
    b2 = -alpha / a0;
    a1 = (-2.0f * cosw) / a0;
    a2 = (1.0f - alpha) / a0;
  }
  inline float Process(float x) {
    const float y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  }
};

} // namespace openaxe::dsp::internal
