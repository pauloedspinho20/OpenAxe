#pragma once

#include <memory>

namespace openaxe::dsp {

// Pitch shifter with Whammy + Detune modes per issue #268.
// Whammy: ±12 semitones via granular/phase-vocoder approach (pedal sweep
// via host automation on `pitch` param). Detune: ±15 cents modulated delay
// (≈5-15ms) for thickening without obvious pitch shift.
//
// 40ms latency rejected → implementation keeps latency ~15-20ms (whammy)
// and ~5ms (detune). Expression pedal is first-class via smoothed `pitch`.
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
