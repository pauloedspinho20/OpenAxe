#pragma once

#include <memory>

namespace openaxe::dsp {

// Tremolo with mono/stereo toggle + harmonic mode per issue #268.
// Stereo: mono=same gain, stereo=180° anti-phase auto-pan.
// Harmonic: crossover split, highs/lows opposite phase.
class Tremolo {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  Tremolo();
  ~Tremolo();
  Tremolo(const Tremolo&) = delete;
  Tremolo& operator=(const Tremolo&) = delete;

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
