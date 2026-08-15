#pragma once

#include <memory>

namespace nam_studio::dsp {

// Classic stereo chorus: modulated delay line with a sine LFO sweeping the
// read tap, plus optional feedback. One independent delay line per channel;
// the right channel's LFO runs 90° out of phase for stereo widening.
//
// Not extracted from BYOD/LSP — the core algorithm (ring buffer + sin LFO +
// lerp read + feedback) is textbook DSP and identical in every chorus
// implementation. See include/nam_studio/dsp/diode_clipper.h for the doc
// comment on why BYOD's own Chorus.h/.cpp can't be compiled standalone
// (requires JUCE's BaseProcessor pipeline).
class Chorus {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  Chorus();
  ~Chorus();
  Chorus(const Chorus&) = delete;
  Chorus& operator=(const Chorus&) = delete;

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
