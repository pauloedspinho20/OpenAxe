#pragma once

#include <memory>

namespace nam_studio::dsp {

// Classic feedback phaser: a cascade of first-order all-pass filters whose
// center frequency is swept by a sine LFO, creating the signature notch
// sweep. Stereo via phase-offset LFOs per channel. The feedback path wraps
// the last stage's output back to the input; higher feedback deepens the
// notches toward a resonant peak. See include/nam_studio/dsp/chorus.h for
// the doc comment on why BYOD's own code can't be compiled standalone.
class Phaser {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  Phaser();
  ~Phaser();
  Phaser(const Phaser&) = delete;
  Phaser& operator=(const Phaser&) = delete;

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
