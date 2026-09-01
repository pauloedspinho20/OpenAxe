#pragma once

// Deterministic test signals for the DSP regression harness (issue #315).
// Generated in-code rather than shipped as fixture audio: nothing to license,
// nothing to keep in sync with a sample rate, and every case is reproducible
// from the parameters alone.
//
// Each stimulus targets a different failure mode, which is why there are five
// rather than one "does it make noise" buffer:
//
//   Impulse   - the output IS the impulse response, so its spectrum is the
//               effect's transfer function. This is what the frequency-band
//               metrics are computed from, and what catches a filter moving,
//               an interpolator changing, or a delay time drifting.
//   Sweep     - an exponential sine sweep over the audible band. Excites every
//               frequency at equal energy over time, so level metrics from it
//               catch broadband gain and envelope changes an impulse misses.
//   TwoTone   - 1kHz + 1.1kHz. Any nonlinearity produces intermodulation
//               products at frequencies neither tone contains; aliasing folds
//               those back into the band. This is the stimulus that would have
//               caught ring-mod's missing oversampling.
//   Silence   - noise floor, denormal behaviour, and self-oscillation. An
//               effect that outputs anything here is generating it.
//   Pluck     - a filtered noise burst plus a decaying sine, i.e. something
//               shaped like a guitar note. Musical sanity, and the only
//               stimulus with a non-trivial stereo image.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace openaxe::test {

struct Stereo {
  std::vector<float> left;
  std::vector<float> right;

  explicit Stereo(int frames) : left(static_cast<size_t>(frames), 0.0f),
                                right(static_cast<size_t>(frames), 0.0f) {}
  int frames() const { return static_cast<int>(left.size()); }
};

// xorshift32 rather than <random>: the standard library's distributions are
// not specified to produce identical sequences across implementations, and a
// golden file compared across macOS/Linux/Windows needs the stimulus itself to
// be bit-identical everywhere.
class Xorshift32 {
 public:
  explicit Xorshift32(uint32_t seed) : state_(seed == 0 ? 0x9E3779B9u : seed) {}

  // Uniform in [-1, 1).
  float Next() {
    state_ ^= state_ << 13;
    state_ ^= state_ >> 17;
    state_ ^= state_ << 5;
    return static_cast<float>(static_cast<int32_t>(state_)) / 2147483648.0f;
  }

 private:
  uint32_t state_;
};

inline constexpr float kTwoPi = 6.28318530717958647692f;

inline Stereo MakeImpulse(int frames) {
  Stereo s(frames);
  s.left[0] = 1.0f;
  s.right[0] = 1.0f;
  return s;
}

// Exponential sweep from 20Hz to (near) Nyquist. Phase is integrated in double
// so the instantaneous frequency stays exact across a long buffer.
inline Stereo MakeSweep(int frames, double sample_rate) {
  Stereo s(frames);
  const double f0 = 20.0;
  const double f1 = std::min(20000.0, sample_rate * 0.45);
  const double duration = static_cast<double>(frames) / sample_rate;
  const double k = std::log(f1 / f0) / duration;
  for (int i = 0; i < frames; ++i) {
    const double t = static_cast<double>(i) / sample_rate;
    // Integral of f0*e^(kt) dt, the phase of an exponential sweep.
    const double phase = kTwoPi * f0 * (std::exp(k * t) - 1.0) / k;
    const float v = 0.5f * static_cast<float>(std::sin(phase));
    s.left[static_cast<size_t>(i)] = v;
    s.right[static_cast<size_t>(i)] = v;
  }
  return s;
}

inline Stereo MakeTwoTone(int frames, double sample_rate) {
  Stereo s(frames);
  for (int i = 0; i < frames; ++i) {
    const double t = static_cast<double>(i) / sample_rate;
    const float v = 0.35f * static_cast<float>(std::sin(kTwoPi * 1000.0 * t) +
                                               std::sin(kTwoPi * 1100.0 * t)) * 0.5f;
    s.left[static_cast<size_t>(i)] = v;
    s.right[static_cast<size_t>(i)] = v;
  }
  return s;
}

inline Stereo MakeSilence(int frames) { return Stereo(frames); }

// A filtered noise burst (the pick attack) over a decaying sine (the string),
// panned slightly apart so stereo processing has something to act on.
inline Stereo MakePluck(int frames, double sample_rate) {
  Stereo s(frames);
  Xorshift32 rng(0x5EED1234u);
  const double f = 196.0;  // low G
  const double decay = 2.5;
  float lp = 0.0f;
  for (int i = 0; i < frames; ++i) {
    const double t = static_cast<double>(i) / sample_rate;
    const float env = static_cast<float>(std::exp(-decay * t));
    // One-pole lowpass on the noise, only audible during the first ~5ms.
    lp += 0.25f * (rng.Next() - lp);
    const float attack = static_cast<float>(std::exp(-400.0 * t)) * lp * 0.6f;
    const float body = 0.45f * env * static_cast<float>(std::sin(kTwoPi * f * t));
    s.left[static_cast<size_t>(i)] = body + attack;
    s.right[static_cast<size_t>(i)] = body * 0.85f + attack * 1.15f;
  }
  return s;
}

}  // namespace openaxe::test
