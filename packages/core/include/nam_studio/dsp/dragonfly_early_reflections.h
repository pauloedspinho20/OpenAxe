#pragma once

// Note: this file (and dragonfly_early_reflections.cpp) is compiled at
// C++14 - see CMakeLists.txt - so it avoids the C++17 nested-namespace
// shorthand used elsewhere in this codebase.
namespace nam_studio {
namespace dsp {

// Wraps Dragonfly Reverb's early-reflections-only algorithm, exposing its
// 7-parameter surface: dry/wet levels, program (0-7, selecting one of the
// vendored early-reflection presets), size, width, and low/high cut. No
// late-reverberation tail - just the discrete early reflection pattern,
// useful as a lighter-weight "room ambience" effect on its own.
//
// See dragonfly_hall_reverb.h for why this uses an opaque `void*` rather
// than a forward-declared DragonflyReverbDSP*: Dragonfly's four reverb
// algorithms all define an identically-named DragonflyReverbDSP class,
// each made anonymous-namespace-private to its own .cpp to avoid a
// duplicate-symbol conflict if two were ever linked into the same binary.
class DragonflyEarlyReflections {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  DragonflyEarlyReflections();
  ~DragonflyEarlyReflections();
  DragonflyEarlyReflections(const DragonflyEarlyReflections&) = delete;
  DragonflyEarlyReflections& operator=(const DragonflyEarlyReflections&) = delete;

  void Reset(double sample_rate);
  void Process(const float* const* input, float* const* output, int num_frames);
  void Mute();

  static int ParamCount();
  static const ParamInfo& GetParamInfo(int index);
  float GetParam(int index) const;
  void SetParam(int index, float value);

 private:
  void* dsp_;  // owning pointer to an (anonymous namespace)::DragonflyReverbDSP*
};

}  // namespace dsp
}  // namespace nam_studio
