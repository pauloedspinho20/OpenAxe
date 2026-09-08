#pragma once

#include <memory>

namespace openaxe {
namespace dsp {

// Permissive-licensed clean-room hall reverb (issue #372): 4 damped combs +
// 2 allpasses per channel with spin/wander modulation, early-reflection taps
// with an early-send into the late field, and the full 18-parameter surface
// (dry/early/late levels, size/width, predelay, diffusion, low/high
// cut+crossover+multiplier, spin/wander, decay, early send, modulation).
// Stereo only. Real-time safe after Reset(); Reset is the only allocating
// method; Mute() silences tails.
class DragonflyHallReverb {
 public:
  struct ParamInfo {
    const char* name;    // e.g. "Dry Level"
    const char* symbol;  // e.g. "dry_level" - stable machine-readable id
    float min_value;
    float max_value;
    const char* unit;  // e.g. "%", "Hz", "s", "ms", "m", "X"
  };

  DragonflyHallReverb();
  ~DragonflyHallReverb();
  DragonflyHallReverb(const DragonflyHallReverb&) = delete;
  DragonflyHallReverb& operator=(const DragonflyHallReverb&) = delete;

  // (Re)allocates delay lines for the given sample rate. Not real-time safe.
  void Reset(double sample_rate);

  // Real-time safe. Stereo planar (input[0]/output[0] = left).
  void Process(const float* const* input, float* const* output, int num_frames);

  // Silences the tail immediately without discarding parameter values.
  void Mute();

  static int ParamCount();
  static const ParamInfo& GetParamInfo(int index);

  // Values are in each parameter's native range/unit (see GetParamInfo).
  float GetParam(int index) const;
  void SetParam(int index, float value);

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace dsp
}  // namespace openaxe
