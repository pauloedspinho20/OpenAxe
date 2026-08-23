#pragma once

#include <cmath>
#include <cstddef>

namespace nam_studio::dsp {

// Per-param smoothing policy for the real-time path (issue #122). A param is
// either left as-is (kNone - discrete/enum/selector params, and any wrapped
// DSP that already smooths internally, e.g. the Dragonfly reverbs, so we don't
// double-smooth), or ramped toward its target with a linear slew rate or an
// exponential one-pole. The engine owns the ramp state and applies it on the
// audio thread; this struct is the schema-derived, runtime-immutable policy.
enum class SmoothingMode {
  kNone,         // snap to the new value each block (no ramp)
  kLinear,       // constant slew rate, full range traversed in time_constant_s
  kExponential,  // one-pole, ~63% settled after time_constant_s
};

struct ParamSmoothing {
  SmoothingMode mode = SmoothingMode::kNone;
  float time_constant_s = 0.0f;  // ramp duration; meaningful for linear/exponential
  float min = 0.0f;              // param range (for the linear slew rate)
  float max = 1.0f;
};

// One step of a param's ramp over a time interval dt_s, returning the new
// value. kNone snaps; kExponential is a one-pole (63% settled after the time
// constant); kLinear slews at a constant rate that traverses the full param
// range in the time constant and never overshoots. Real-time safe: pure
// arithmetic, no allocation, no atomics. Operates in double so a live ramp
// held in double can actually reach its target (a float32 accumulator stalls
// ~1 ULP short because the per-sample step rounds to zero).
//
// Header-inline rather than engine-local so it is directly unit-testable and
// shareable by future front ends; the engine's ramp *state* stays private to
// AudioEngine.
inline double RampStep(double current, float target, const ParamSmoothing& s, double dt_s) {
  switch (s.mode) {
    case SmoothingMode::kNone:
      return target;
    case SmoothingMode::kExponential: {
      const double tau = s.time_constant_s > 1e-6f ? s.time_constant_s : 1e-6f;
      const double coef = 1.0 - std::exp(-dt_s / tau);
      const double delta = static_cast<double>(target) - current;
      // Snap once the remaining gap is negligible on the param's own scale.
      // The one-pole only approaches asymptotically, and without this the
      // value never lands exactly on its target - which would keep any
      // fast path keyed on exact settled values (mixer unity, cab fully-wet)
      // disarmed forever after a single excursion. A snap of <=1e-6 of the
      // param range is far below audible.
      const double eps = (static_cast<double>(s.max) - s.min) * 1e-6;
      if (!(std::fabs(delta) > eps)) return target;
      return current + delta * coef;
    }
    case SmoothingMode::kLinear: {
      const double range = s.max - s.min;
      if (!(range > 0.0)) return target;
      const double tau = s.time_constant_s > 1e-6f ? s.time_constant_s : 1e-6f;
      const double max_step = range * (dt_s / tau);
      const double diff = target - current;
      if (std::fabs(diff) <= max_step) return target;
      return current + std::copysign(max_step, diff);
    }
  }
  return target;
}

}  // namespace nam_studio::dsp
