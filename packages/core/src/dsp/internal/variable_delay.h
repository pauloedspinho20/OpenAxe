#pragma once
// Phase 0 commons — VariableDelay: DelayLine + Lagrange3 interpolator +
// optional crossface between two taps (for pitch shifter / granular).
// Provides fractional-delay read with high quality.
#include "delay_line.h"
#include "lagrange3.h"

namespace openaxe::dsp::internal {

struct VariableDelay {
  DelayLine<float> line;

  void Prepare(float sr, float max_ms) { line.Prepare(sr, max_ms); }
  void PrepareSamples(int max_samps) { line.PrepareSamples(max_samps); }
  void Reset() { line.Reset(); }
  inline void Write(float x) { line.Write(x); }

  // fractional delay in ms, interpolated with Lagrange3
  inline float Read(float delay_ms, float sr) const {
    const float ds = delay_ms * sr / 1000.0f;
    const float rp = (float)line.write_pos - ds;
    return ReadLagrange3(line.buf, rp);
  }
  inline float ReadSamples(float delay_samps) const {
    const float rp = (float)line.write_pos - delay_samps;
    return ReadLagrange3(line.buf, rp);
  }

  // Dual-tap Hann crossfade (for granular pitch shifter) — weight 0..1 blends tapB into tapA
  inline float ReadCrossfade(float delayA_ms, float delayB_ms, float sr, float wA) const {
    const float a = Read(delayA_ms, sr);
    const float b = Read(delayB_ms, sr);
    return a * wA + b * (1.0f - wA);
  }
};

} // namespace openaxe::dsp::internal
