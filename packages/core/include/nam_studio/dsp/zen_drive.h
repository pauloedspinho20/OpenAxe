#pragma once

#include <memory>

namespace nam_studio::dsp {

// Wraps BYOD's Zen Drive circuit (a wave digital filter model of the
// Hermida Audio Zen Drive overdrive pedal), reimplemented from BYOD's
// ZenDriveWDF using chowdsp_wdf's header-only WDF primitives directly -
// same reasoning as DiodeClipper/TubeScreamer (see diode_clipper.h's doc
// comment). No diode-type choice here - unlike Diode Clipper/Tube Screamer,
// BYOD's own Zen Drive UI doesn't expose one either (a single fixed diode
// pair in the circuit). Stereo: one independent circuit instance per
// channel.
class ZenDrive {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  ZenDrive();
  ~ZenDrive();
  ZenDrive(const ZenDrive&) = delete;
  ZenDrive& operator=(const ZenDrive&) = delete;

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
