#pragma once

#include <memory>

namespace openaxe {
namespace dsp {

// Permissive-licensed clean-room room reverb (issue #372): shorter damped
// combs + a tight allpass pair per channel, input high/low cuts, separate
// early/late damping, and a low-frequency boost - the full 17-parameter
// surface. Stereo only. Real-time safe after Reset(); Reset is the only
// allocating method; Mute() silences tails.
class DragonflyRoomReverb {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  DragonflyRoomReverb();
  ~DragonflyRoomReverb();
  DragonflyRoomReverb(const DragonflyRoomReverb&) = delete;
  DragonflyRoomReverb& operator=(const DragonflyRoomReverb&) = delete;

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
