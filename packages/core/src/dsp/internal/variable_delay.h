#pragma once
// Phase 0 commons - VariableDelay: a DelayLine read through the Lagrange3
// interpolator, i.e. the modulated delay line Chorus, Flanger, Delay and
// Rotary all need.
//
// The fractional read is the whole point. A moving tap read at integer
// positions quantises the sweep into steps; read with 2-point linear
// interpolation - what chorus.cpp, flanger.cpp and delay.cpp each hand-rolled
// before this header replaced them - it is filtered by a lowpass whose corner
// moves with the fractional part, so the effect audibly dulls and brightens as
// it sweeps. Lagrange3 is flat enough across the band that the sweep stops
// colouring the signal.
#include "delay_line.h"
#include "lagrange3.h"

namespace openaxe::dsp::internal {

struct VariableDelay {
  DelayLine<float> line;

  // Not RT-safe (allocates) - call from Reset(). Size for the largest delay
  // the params allow, never for the current knob position.
  void Prepare(float sample_rate, float max_delay_ms) { line.Prepare(sample_rate, max_delay_ms); }
  void PrepareSamples(int max_delay_samps) { line.PrepareSamples(max_delay_samps); }

  void Reset() { line.Reset(); }
  inline void Write(float x) { line.Write(x); }

  // The signal `delay_samps` in the past, interpolated. RT-safe.
  inline float ReadSamples(float delay_samps) const {
    return ReadLagrange3Masked(line.buf, static_cast<float>(line.write_pos) - delay_samps,
                               line.mask);
  }

  inline float Read(float delay_ms, float sample_rate) const {
    return ReadSamples(delay_ms * sample_rate / 1000.0f);
  }
};

}  // namespace openaxe::dsp::internal
