#pragma once

#include <memory>

namespace openaxe {
namespace dsp {

// Permissive-licensed clean-room early-reflections reverb (issue #372): a
// deterministic tapped-delay cluster (no tail, no dependency) with the
// 7-parameter surface (dry/wet, program 0-7 room shape, size, width,
// low/high cut). Stereo only. Real-time safe after Reset(); Reset is the
// only allocating method; Mute() silences tails.
class DragonflyEarlyReflections {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  DragonflyEarlyReflections();
  ~DragonflyEarlyReflections();
  DragonflyEarlyReflections(const DragonflyEarlyReflections&) = delete;
  DragonflyEarlyReflections& operator=(const DragonflyEarlyReflections&) = delete;

  void Reset(double sample_rate);
  void Process(const float* const* input, float* const* output, int num_frames);
  void Mute();

  static int ParamCount();
  static const ParamInfo& GetParamInfo(int index);
  float GetParam(int index) const;
  void SetParam(int index, float value);

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace dsp
}  // namespace openaxe
