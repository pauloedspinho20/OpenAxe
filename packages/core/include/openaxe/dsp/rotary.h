#pragma once

#include <memory>

namespace openaxe::dsp {

// Rotary (Leslie) — full mda/Faust Leslie per issue #268:
// wood cabinet + mic distance + acceleration, controls for
// slow/fast/stop + drive + horn/drum balance + mic distance + crossover.
//
// Single-header vendor avoided; implementation uses stereo modulated delays
// and crossover filtering to emulate horn/drum Doppler + cabinet color.
class Rotary {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  enum class Speed { kStop = 0, kChorale = 1, kTremolo = 2 };

  Rotary();
  ~Rotary();
  Rotary(const Rotary&) = delete;
  Rotary& operator=(const Rotary&) = delete;

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
