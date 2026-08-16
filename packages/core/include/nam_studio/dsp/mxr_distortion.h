#pragma once

#include <memory>

namespace nam_studio::dsp {

// Wraps BYOD's MXR Distortion+ circuit (a wave digital filter model of the
// MXR Distortion+ overdrive pedal, originally derived by Sam Schachter's
// Master's Thesis), reimplemented from BYOD's MXRDistWDF using
// chowdsp_wdf's header-only WDF primitives directly - same reasoning as
// DiodeClipper/TubeScreamer/ZenDrive (see diode_clipper.h's doc comment).
// Stereo: one independent circuit instance per channel.
class MxrDistortion {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  MxrDistortion();
  ~MxrDistortion();
  MxrDistortion(const MxrDistortion&) = delete;
  MxrDistortion& operator=(const MxrDistortion&) = delete;

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
