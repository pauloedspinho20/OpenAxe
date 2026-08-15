#pragma once

#include <memory>

namespace nam_studio::dsp {

// Wraps BYOD's Tube Screamer clipping-stage circuit (a wave digital filter
// model of the classic op-amp diode-clipper topology used in the Ibanez
// Tube Screamer), reimplemented from BYOD's TubeScreamerWDF using
// chowdsp_wdf's header-only WDF primitives directly - same reasoning as
// DiodeClipper (see diode_clipper.h's doc comment): BYOD's own file can't
// be compiled standalone (force-included pch.h drags in JUCE/RTNeural/
// Eigen). Reuses the diode-pair math's default chowdsp_wdf Wright-Omega
// approximation and drops JUCE-only parameter smoothing, same as
// DiodeClipper; the DC-blocking highpass after the WDF stage (needed here
// - this circuit is asymmetric enough to leave a real DC bias) is kept as
// a simple one-pole highpass rather than porting chowdsp::SVFHighpass -
// see wdf_common.h's DcBlocker.
//
// Stereo, like DiodeClipper: one independent circuit instance per channel.
class TubeScreamer {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  TubeScreamer();
  ~TubeScreamer();
  TubeScreamer(const TubeScreamer&) = delete;
  TubeScreamer& operator=(const TubeScreamer&) = delete;

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
