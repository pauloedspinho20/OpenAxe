#pragma once
// Phase 0 commons - Lagrange 3rd-order interpolator for fractional delay
// reads. Used by GranularDelay and PitchShifter directly, and by
// VariableDelay (which every modulated-delay effect reads through) for
// high-quality tap reads. RT-safe, pure arithmetic, no branching in the hot
// path beyond the index wrap.
#include <cmath>

namespace openaxe::dsp::internal {

// 4-point, 3rd-order cubic interpolation (the Catmull-Rom / Hermite kernel -
// the name here predates this note and is kept because three files call it).
// `xm1, x0, x1, x2` are the samples at -1, 0, +1, +2 relative to the read
// point, and the result is the value at `x0 + frac` for frac in [0,1).
//
// The coefficients are unchanged, but the arguments they read were not: c0
// was `x1` and c1 was `0.5f * (x2 - xm1)`, i.e. the kernel was centred one
// sample later than the caller asked for, so every tap read one sample short
// of its requested delay. Constant and inaudible for the two effects that
// already used this (GranularDelay, PitchShifter, where the tap is relative
// anyway), but wrong - a Delay set to 100ms at 48kHz returned its echo at
// sample 4799 rather than 4800.
inline float Lagrange3(float xm1, float x0, float x1, float x2, float frac) {
  const float c0 = x0;
  const float c1 = 0.5f * (x1 - xm1);
  const float c2 = xm1 - 2.5f * x0 + 2.0f * x1 - 0.5f * x2;
  const float c3 = 0.5f * (x2 - xm1) + 1.5f * (x0 - x1);
  return ((c3 * frac + c2) * frac + c1) * frac + c0;
}

// Wrap an index into [0, n) in constant time. The previous form here was
// `while (i < 0) i += n;` - correct, but an unbounded loop on the audio
// thread: a read position far in the past (a corrupted delay time, a
// sample-rate change racing a param write) would spin proportionally to how
// far negative it went. One remainder plus one conditional add is bounded
// whatever the input.
inline int WrapIndex(int i, int n) {
  i %= n;
  return i < 0 ? i + n : i;
}

// Read from a circular buffer of arbitrary length with Lagrange3.
// For power-of-two buffers prefer ReadLagrange3Masked - it drops four integer
// divisions per sample. This overload stays for the two effects whose buffers
// are sized from a duration rather than rounded up to a power of two
// (GranularDelay, PitchShifter).
template <typename Buf>
inline float ReadLagrange3(const Buf& buf, float read_pos) {
  const int n = static_cast<int>(buf.size());
  const int i0 = static_cast<int>(std::floor(read_pos));
  const float frac = read_pos - static_cast<float>(i0);
  return Lagrange3(buf[static_cast<size_t>(WrapIndex(i0 - 1, n))],
                   buf[static_cast<size_t>(WrapIndex(i0, n))],
                   buf[static_cast<size_t>(WrapIndex(i0 + 1, n))],
                   buf[static_cast<size_t>(WrapIndex(i0 + 2, n))], frac);
}

// Same read against a power-of-two buffer, wrapping with a mask
// (buf.size() - 1). Two's-complement AND is a correct modulo for negative
// indices too, so no sign fixup is needed.
template <typename Buf>
inline float ReadLagrange3Masked(const Buf& buf, float read_pos, int mask) {
  const int i0 = static_cast<int>(std::floor(read_pos));
  const float frac = read_pos - static_cast<float>(i0);
  return Lagrange3(buf[static_cast<size_t>((i0 - 1) & mask)],
                   buf[static_cast<size_t>(i0 & mask)],
                   buf[static_cast<size_t>((i0 + 1) & mask)],
                   buf[static_cast<size_t>((i0 + 2) & mask)], frac);
}

}  // namespace openaxe::dsp::internal
