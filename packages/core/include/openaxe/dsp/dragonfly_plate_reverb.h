#pragma once

#include <memory>

namespace openaxe {
namespace dsp {

// Permissive-licensed clean-room plate reverb (issue #372): dense short
// combs + 3 allpasses per channel, voiced bright like a steel plate, with
// the 9-parameter surface (dry/wet, algorithm voicing 0/1/2, width,
// predelay, decay, low/high cut, dampen). Stereo only. Real-time safe after
// Reset(); Reset is the only allocating method; Mute() silences tails.
class DragonflyPlateReverb {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  DragonflyPlateReverb();
  ~DragonflyPlateReverb();
  DragonflyPlateReverb(const DragonflyPlateReverb&) = delete;
  DragonflyPlateReverb& operator=(const DragonflyPlateReverb&) = delete;

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
