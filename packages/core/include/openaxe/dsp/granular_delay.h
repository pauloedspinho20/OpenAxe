#pragma once

#include <memory>

namespace openaxe::dsp {

// Granular delay with pristine↔lo-fi character via `character` knob,
// Freeze/Hold per issue #268. Circular buffer 2–3s, 2 overlapping Hann grains,
// per-grain pitch/jitter/spread, diffuser, Lagrange3 interpolation.
//
// Parameters (see granular_delay.cpp):
//   time 10-2000ms, grain_size 10-500ms, density 1-50Hz, pitch -12..12st,
//   jitter 0-1, feedback 0-0.9, spread 0-1, character 0-1, freeze 0/1
class GranularDelay {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  GranularDelay();
  ~GranularDelay();
  GranularDelay(const GranularDelay&) = delete;
  GranularDelay& operator=(const GranularDelay&) = delete;

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
