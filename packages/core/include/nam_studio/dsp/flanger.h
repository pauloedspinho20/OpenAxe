#pragma once

#include <memory>

namespace nam_studio::dsp {

// Classic stereo flanger: a modulated delay line with strong feedback,
// creating the signature comb-filter sweep ("jet plane") effect. Same
// textbook DSP core as Chorus but with shorter base delays, higher feedback
// levels, and no stereo phase offset (flanger traditionally runs a single
// LFO across both channels). See include/nam_studio/dsp/chorus.h for the doc
// comment on why BYOD's own Flanger.h/.cpp can't be compiled standalone.
class Flanger {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  Flanger();
  ~Flanger();
  Flanger(const Flanger&) = delete;
  Flanger& operator=(const Flanger&) = delete;

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

}  // namespace nam_studio::dsp
