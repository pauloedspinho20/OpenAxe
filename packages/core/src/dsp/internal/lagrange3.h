#pragma once
// Phase 0 commons — Lagrange 3rd-order interpolator for fractional delay reads.
// Used by GranularDelay and PitchShifter for high-quality tap reads (replaces
// linear interp where pre-echo matters). RT-safe, pure arithmetic.
#include <cmath>

namespace openaxe::dsp::internal {

// Cubic Lagrange interpolation: 4-point, fractional in [0,1), x0..x3 are
// samples at -1,0,1,2 relative to read point.
inline float Lagrange3(float xm1, float x0, float x1, float x2, float frac) {
  const float c0 = x1;
  const float c1 = 0.5f * (x2 - xm1);
  const float c2 = xm1 - 2.5f * x0 + 2.0f * x1 - 0.5f * x2;
  const float c3 = 0.5f * (x2 - xm1) + 1.5f * (x0 - x1);
  return ((c3 * frac + c2) * frac + c1) * frac + c0;
}

// Helper: read from circular buffer with Lagrange3
template <typename Buf>
inline float ReadLagrange3(const Buf& buf, float read_pos) {
  const int n = (int)buf.size();
  int i0 = (int)std::floor(read_pos);
  float frac = read_pos - (float)i0;
  // wrap indices
  auto wrap = [&](int i){ while(i<0) i+=n; return i % n; };
  int idxm1 = wrap(i0 - 1);
  int idx0  = wrap(i0);
  int idx1  = wrap(i0 + 1);
  int idx2  = wrap(i0 + 2);
  return Lagrange3(buf[idxm1], buf[idx0], buf[idx1], buf[idx2], frac);
}

} // namespace openaxe::dsp::internal
