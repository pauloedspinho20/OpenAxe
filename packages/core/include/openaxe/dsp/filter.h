#pragma once

#include <memory>

namespace openaxe::dsp {

// Single Filter block with type enum (0=Wah, 1=Envelope, 2=Ladder) per issue #268.
// Wah driven by selectable source (pedal / envelope / LFO) via `mode` param.
// Ladder is 4-pole Moog-style cascade; Wah/Envelope use resonant bandpass.
// All three share the same param surface; `type` selects algorithm, `mode`+
// `frequency`/`sensitivity`/`lfo_rate` control Wah modulation.
//
// Parameters (see filter.cpp):
//   type (0 Wah,1 Env,2 Ladder), frequency 350-2200Hz, q 0.5-10,
//   drive 0-1, sensitivity 0-1, mode 0 pedal/1 env/2 lfo, lfo_rate 0.1-10Hz
class Filter {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  enum class Type { kWah = 0, kEnvelope = 1, kLadder = 2 };
  enum class ModMode { kPedal = 0, kEnv = 1, kLfo = 2 };

  Filter();
  ~Filter();
  Filter(const Filter&) = delete;
  Filter& operator=(const Filter&) = delete;

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
