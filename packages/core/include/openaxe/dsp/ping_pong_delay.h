#pragma once

#include <memory>

namespace openaxe::dsp {

// Stereo ping-pong delay: a single delay line whose output alternates
// between the left and right channels on each repeat, creating a bouncing
// stereo echo. The feedback path includes a biquad lowpass tone filter for
// warmth/analog character.
//
// The first repeat goes to the right channel, the second to the left, and
// so on — each repeat passes through the feedback filter before being
// written back, so later repeats get progressively darker.
//
// Parameters:
//   - time:     50–1000 ms, default 250 — delay time
//   - feedback: 0–0.9, default 0.5 — regeneration
//   - tone:     200–12000 Hz, default 6000 — lowpass cutoff in feedback path
//   - width:    0–1, default 1 — stereo width (0 mono center, 1 hard left/right ping-pong)
//
// BaseEffect handles dry/wet crossfade. This DSP outputs only the wet echo
// on the active channel per repeat; the silent channel outputs zero.
class PingPongDelay {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  PingPongDelay();
  ~PingPongDelay();
  PingPongDelay(const PingPongDelay&) = delete;
  PingPongDelay& operator=(const PingPongDelay&) = delete;

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
