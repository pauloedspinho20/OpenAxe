#pragma once

#include <memory>

namespace openaxe::dsp {

// Pitch shifter with Whammy + Detune modes per issue #268.
// Whammy: ±12 semitones via a crossfade (Eventide-style) shifter - a single
// read head drifts at the pitch ratio and jumps back one grain with a
// raised-cosine crossfade when it leaves the delay window. Expression pedal
// is first-class via the smoothed `pitch` param. Detune: two voices at ±15
// cents, a genuine pitch offset rather than a modulated delay.
//
// Latency is one fixed ~30 ms grain in both modes (the read head sits a
// grain behind the write head at unity pitch, which is also an exact delay).
class PitchShifter {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  enum class Mode { kDetune = 0, kWhammy = 1 };

  PitchShifter();
  ~PitchShifter();
  PitchShifter(const PitchShifter&) = delete;
  PitchShifter& operator=(const PitchShifter&) = delete;

  void Reset(double sample_rate);
  void Process(const float* const* input, float* const* output, int num_frames);

  static int ParamCount();
  static const ParamInfo& GetParamInfo(int index);
  float GetParam(int index) const;
  void SetParam(int index, float value);

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace openaxe::dsp
