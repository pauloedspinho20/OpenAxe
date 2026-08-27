#pragma once
// Phase 0 commons — DelayLine<T> circular buffer, RT-safe after Prepare.
// Used by Chorus, Delay, PitchShifter, GranularDelay, Rotary.
// No alloc in Process; Prepare reallocates (call from Reset only).
#include <cmath>
#include <vector>

namespace openaxe::dsp::internal {

template <typename Sample = float>
struct DelayLine {
  std::vector<Sample> buf;
  int write_pos = 0;

  void Prepare(float sr, float max_delay_ms) {
    const int need = static_cast<int>(std::ceil(max_delay_ms * sr / 1000.0f)) + 4;
    buf.assign(static_cast<size_t>(std::max(need, 4)), Sample{0});
    write_pos = 0;
  }
  void PrepareSamples(int max_delay_samps) {
    buf.assign(static_cast<size_t>(std::max(max_delay_samps, 4) + 4), Sample{0});
    write_pos = 0;
  }
  void Reset() {
    std::fill(buf.begin(), buf.end(), Sample{0});
    write_pos = 0;
  }
  inline void Write(Sample x) {
    buf[static_cast<size_t>(write_pos)] = x;
    if (++write_pos >= (int)buf.size()) write_pos = 0;
  }
  // integer tap read (no interpolation)
  inline Sample ReadInt(float delay_ms, float sr) const {
    const float ds = delay_ms * sr / 1000.0f;
    int pos = write_pos - (int)std::round(ds);
    const int n = (int)buf.size();
    while (pos < 0) pos += n;
    pos %= n;
    return buf[static_cast<size_t>(pos)];
  }
  inline Sample ReadSamples(float delay_samps) const {
    int pos = write_pos - (int)std::round(delay_samps);
    const int n = (int)buf.size();
    while (pos < 0) pos += n;
    pos %= n;
    return buf[static_cast<size_t>(pos)];
  }
};

} // namespace openaxe::dsp::internal
