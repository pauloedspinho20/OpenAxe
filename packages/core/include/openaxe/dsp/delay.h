#pragma once

#include <memory>

namespace openaxe::dsp {

// Stereo delay with three character models, built on the shared modulated
// delay line in src/dsp/internal/variable_delay.h (a power-of-two circular
// buffer read through a 3rd-order Lagrange interpolator):
//
//   Digital — clean, pristine delay with configurable tone filtering.
//   Analog  — BBD-style: heavier lowpass in the feedback path and a subtle
//             saturation stage, emulating bucket-brigade chip character.
//   Tape    — builds on Analog with slow wow/flutter pitch modulation on
//             the read tap, simulating reel-to-reel delay.
//
// BaseEffect handles dry/wet crossfade; this DSP outputs the 100%-wet
// delayed signal. The feedback path includes a biquad lowpass filter
// determined by the `tone` param; at max tone (12kHz) the filter is
// effectively bypassed, giving clean digital repeats. Its Q is 1.0 - see
// delay.cpp's kToneQ for why that is not the 0.707 it once claimed.
//
// (An earlier version of this comment credited Signalsmith Audio's
// header-only delay library. That library is not vendored in this repository
// and never backed this class - the reads were hand-rolled 2-point linear
// interpolation until they moved to VariableDelay.)
//
// Parameters (see delay.cpp's kParamInfo):
//   - time:     10–1000 ms, default 300 — delay time
//   - feedback: 0–0.9, default 0.4 — regeneration
//   - tone:     200–12000 Hz, default 6000 — lowpass cutoff in feedback path
//   - model:    0=Digital, 1=Analog, 2=Tape (see NamStudioDelayModel in api.h)
//   - wowDepth: 0–5 ms, default 1.5 — tape wow depth (tape only)
//   - wowRate:  0.1–3 Hz, default 0.5 — tape wow rate (tape only)
class Delay {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  enum class Model { kDigital = 0, kAnalog, kTape };

  Delay();
  ~Delay();
  Delay(const Delay&) = delete;
  Delay& operator=(const Delay&) = delete;

  void Reset(double sample_rate);
  void Process(const float* const* input, float* const* output, int num_frames);

  static int ParamCount();
  static const ParamInfo& GetParamInfo(int index);
  float GetParam(int index) const;
  void SetParam(int index, float value);

  void SetModel(Model model);

  // The model currently backing the block (kDigital unless SetModel changed
  // it). Real-time safe: a plain field read. Serialization needs this to know
  // which of the three characters to restore - the choice lives here rather
  // than in any param table.
  Model GetModel() const;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace openaxe::dsp
