#pragma once
// Phase 0 commons - DelayLine<T>: the circular buffer every modulated-delay
// effect writes into. RT-safe after Prepare; Prepare allocates, so it belongs
// in Reset() and nowhere else.
//
// The buffer length is rounded up to a power of two so the index wrap is a
// mask rather than a division or a loop. That costs at most 2x memory (a
// 1005ms delay line at 48kHz rounds 48241 -> 65536 samples, 256KB per
// channel) and buys a branch-free wrap on the audio thread.
//
// Sizing is deliberately for the *maximum* delay the param schema allows, not
// the current knob position. Sizing to the current position means every turn
// of a delay knob reallocates and clears the line - which is what chorus.cpp
// and flanger.cpp used to do, silencing the effect mid-note (and making
// SetParam not RT-safe for that one param). One allocation in Reset covers
// every reachable setting instead.
#include <algorithm>
#include <cmath>
#include <vector>

#include "lagrange3.h"

namespace openaxe::dsp::internal {

// Smallest power of two >= n, floored at 8 so a degenerate request still
// leaves room for Lagrange3's 4-point kernel.
inline int NextPow2AtLeast(int n) {
  int size = 8;
  while (size < n) size <<= 1;
  return size;
}

template <typename Sample = float>
struct DelayLine {
  std::vector<Sample> buf;
  int mask = 0;
  int write_pos = 0;

  // Allocate for `max_delay_samps` of history plus Lagrange3's forward tap.
  // Not RT-safe.
  void PrepareSamples(int max_delay_samps) {
    const int size = NextPow2AtLeast(std::max(max_delay_samps, 4) + 4);
    buf.assign(static_cast<size_t>(size), Sample{0});
    mask = size - 1;
    write_pos = 0;
  }

  // Same, expressed as a duration. Not RT-safe.
  void Prepare(float sample_rate, float max_delay_ms) {
    PrepareSamples(static_cast<int>(std::ceil(max_delay_ms * sample_rate / 1000.0f)));
  }

  // Clear the history without reallocating. RT-safe only if the caller can
  // afford the memset; the engine calls it between blocks.
  void Reset() {
    std::fill(buf.begin(), buf.end(), Sample{0});
    write_pos = 0;
  }

  // Write one sample and advance the cursor.
  inline void Write(Sample x) {
    buf[static_cast<size_t>(write_pos)] = x;
    write_pos = (write_pos + 1) & mask;
  }

  // The sample `delay_samps` in the past, snapped to the nearest whole
  // sample. For a static tap only - a moving tap needs the fractional read
  // on VariableDelay, or the sweep quantises into audible steps.
  inline Sample ReadSamples(float delay_samps) const {
    const int pos = (write_pos - static_cast<int>(std::lround(delay_samps))) & mask;
    return buf[static_cast<size_t>(pos)];
  }

  inline Sample ReadInt(float delay_ms, float sample_rate) const {
    return ReadSamples(delay_ms * sample_rate / 1000.0f);
  }
};

}  // namespace openaxe::dsp::internal
