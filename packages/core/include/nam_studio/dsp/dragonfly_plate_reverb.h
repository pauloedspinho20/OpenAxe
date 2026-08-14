#pragma once

// Note: this file (and dragonfly_plate_reverb.cpp) is compiled at C++14 -
// see CMakeLists.txt - so it avoids the C++17 nested-namespace shorthand
// used elsewhere in this codebase.
namespace nam_studio {
namespace dsp {

// Wraps Dragonfly Reverb's plate-style algorithm, exposing its
// 9-parameter surface: dry/wet levels, algorithm choice (0/1/2, selecting
// between the vendored NRev/NRevB/strev plate models), width, predelay,
// decay, low/high cut, and dampen frequency.
//
// See dragonfly_hall_reverb.h for why this uses an opaque `void*` rather
// than a forward-declared DragonflyReverbDSP*: Dragonfly's four reverb
// algorithms all define an identically-named DragonflyReverbDSP class,
// each made anonymous-namespace-private to its own .cpp to avoid a
// duplicate-symbol conflict if two were ever linked into the same binary.
class DragonflyPlateReverb {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  DragonflyPlateReverb();
  ~DragonflyPlateReverb();
  DragonflyPlateReverb(const DragonflyPlateReverb&) = delete;
  DragonflyPlateReverb& operator=(const DragonflyPlateReverb&) = delete;

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
