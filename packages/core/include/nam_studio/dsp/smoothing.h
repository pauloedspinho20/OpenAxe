#pragma once

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

}  // namespace nam_studio::dsp
