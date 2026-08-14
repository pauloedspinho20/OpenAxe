#pragma once

#include <memory>

// Forward-declared only - defined in the vendored dragonfly-reverb's
// plugins/dragonfly-hall-reverb/DSP.hpp. Consumers of nam_studio_core never
// need freeverb3/DPF headers on their own include path because of this -
// those stay behind this library's CMake target (dragonfly_hall_reverb
// itself is compiled at C++14, since freeverb3 uses dynamic exception
// specifications removed in C++17 - see CMakeLists.txt).
class DragonflyReverbDSP;

// Note: this file (and dragonfly_hall_reverb.cpp) is compiled at C++14 -
// see CMakeLists.txt - so it avoids the C++17 nested-namespace shorthand
// used elsewhere in this codebase.
namespace nam_studio {
namespace dsp {

// Wraps Dragonfly Reverb's hall-style algorithm (DragonflyReverbDSP),
// exposing its full 18-parameter surface: dry/early/late levels, room
// size/width, predelay, diffusion, low/high cut+crossover+multiplier,
// modulation spin/wander, decay time, and early-reflections send. This
// replaces the app's current basic Freeverb effect with a modulated,
// frequency-dependent-decay algorithmic reverb.
//
// Unlike NamAmp/RTNeural, there's no external model file to load - the
// reverb algorithm itself is the "model," parameterized directly. Stereo
// only (Dragonfly's own DSP class processes left/right independently with
// shared parameters), matching how reverb is actually used.
class DragonflyHallReverb {
 public:
  struct ParamInfo {
    const char* name;    // e.g. "Dry Level"
    const char* symbol;  // e.g. "dry_level" - stable machine-readable id
    float min_value;
    float max_value;
    const char* unit;  // e.g. "%", "Hz", "s", "ms", "m", "X"
  };

  DragonflyHallReverb();
  ~DragonflyHallReverb();
  DragonflyHallReverb(const DragonflyHallReverb&) = delete;
  DragonflyHallReverb& operator=(const DragonflyHallReverb&) = delete;

  // Updates the sample rate the reverb's internal delay lines/filters run
  // at. Not real-time safe. Safe to call at any time (cheaper than
  // reconstruction - preserves current parameter values).
  void Reset(double sample_rate);

  // Real-time safe. Stereo: input[0]/output[0] = left, input[1]/output[1]
  // = right. Internally self-chunks in 256-frame blocks, so num_frames may
  // be arbitrary.
  void Process(const float* const* input, float* const* output, int num_frames);

  // Silences the internal reverb tail immediately (e.g. on transport stop),
  // without discarding parameter values.
  void Mute();

  static int ParamCount();
  static const ParamInfo& GetParamInfo(int index);

  // Values are in each parameter's native range/unit (see GetParamInfo) -
  // e.g. dry/early/late levels are 0-100 (%), not normalized 0-1.
  float GetParam(int index) const;
  void SetParam(int index, float value);

 private:
  std::unique_ptr<DragonflyReverbDSP> dsp_;
};

}  // namespace dsp
}  // namespace nam_studio
