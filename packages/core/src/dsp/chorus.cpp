#include "openaxe/dsp/chorus.h"

#include <algorithm>

#include "daisysp/Source/Effects/chorus.h"

namespace openaxe::dsp {

namespace {

constexpr int kRateParam = 0;
constexpr int kDepthParam = 1;
constexpr int kDelayParam = 2;
constexpr int kFeedbackParam = 3;
constexpr int kStereoParam = 4;
constexpr int kParamCount = 5;

// Generated from packages/core/param_schema.json (issue #51) - run
// scripts/gen-param-schema.mjs after editing the schema.
const Chorus::ParamInfo kParamInfo[kParamCount] = {
#include "generated/chorus_params.inc"
};

// DaisySP's LFO depth is normalized 0..0.93 relative to the delay time, not
// milliseconds. The wrapper re-derives it as depth_ms / delay_ms every time
// either knob moves, so the effective modulation excursion stays in the
// schema's unit (ms) and the tap never reads a negative delay. The natural
// consequence - depth saturates at 93% of the delay - is a physical limit
// shared by every delay-line chorus, not a wart: modulation cannot swing
// further than the line's own read head.
constexpr float kMaxDepthFraction = 0.93f;

// Stereo width. Each input channel runs through its own daisysp::Chorus (two
// cross-panned engines). When `stereo` is on, the right channel's chorus is
// swept at a slightly higher LFO rate, so the two channels' modulation
// phases drift apart over time - the classic wide-chorus mechanism (this is
// what DaisySP's per-channel SetLfoFreq overloads exist for). The two lines
// diverge and reconverge on a slow orbit instead of the previous wrapper's
// fixed 90-degree offset. `stereo` off runs both channels at the same rate,
// collapsing to a mono chorus that stays put in the image.
constexpr float kLfoSpread = 1.004f;  // 0.4% rate offset on the right channel

// DaisySP's ChorusEngine returns an equal wet/dry mix - (in + tap) * 0.5 -
// which Chorus then weights by its pan and halves again (gain_frac_ = 0.5).
// For any pan pair summing to 1.0 (the 0.25/0.75 and 0.5/0.5 pairs this
// wrapper uses), the dry signal lands at exactly in * 0.25 on the output the
// wrapper reads. The wrapper strips it and scales the remainder back up by
// 1/0.25 = 4 so the 100%-wet output is a full-level tap; the engine's own
// `mix` knob then owns the entire dry/wet blend (issue #263). If the pans
// were ever changed to a pair that does not sum to 1.0, re-derive both
// constants below.
constexpr float kDryFraction = 0.25f;
constexpr float kInverseDryFraction = 1.0f / kDryFraction;

}  // namespace

struct Chorus::Impl {
  daisysp::Chorus left;   // processes input channel 0
  daisysp::Chorus right;  // processes input channel 1
  float rate = 0.2f;
  float depth = 0.8f;
  float delay = 5.5f;
  float feedback = 0.15f;
  // Default on, so existing presets - which have no `stereo` value stored and
  // fall back to this - keep the sound they were saved with.
  float stereo = 1.0f;
  float sample_rate = 48000.0f;
  // depth_ms / delay_ms, re-derived whenever either knob moves. DaisySP
  // stores it normalized, so the mirror must too (see ApplyDelayAndDepth).
  float depth_fraction = 0.0f;

  // (Re)seed both channels from the mirror. Called from the constructor and
  // Reset(); the engine calls Reset() between blocks, never from the audio
  // thread, so the Init() allocation-free clears here are safe.
  void ApplyAll() {
    left.Init(sample_rate);
    right.Init(sample_rate);
    ApplyDelayAndDepth();
    ApplyFeedback();
    ApplyRateAndStereo();
  }

  // Delay and depth are coupled in DaisySP (lfo_amp_ = depth_fraction *
  // delay_), so both are applied together, delay first: SetDelayMs clamps a
  // stale lfo_amp_ down to the new delay, and SetLfoDepth then recomputes it
  // from the current depth_fraction on top of the new delay.
  void ApplyDelayAndDepth() {
    left.SetDelayMs(delay);
    right.SetDelayMs(delay);
    // Guard the division: the engine's smoothing keeps delay >= the schema's
    // 5ms min, but a direct ABI caller could pass 0, and 0/0 would be a NaN
    // that then poisons lfo_amp_ (DaisySP clamps its own delay to >= 0.1ms).
    const float delay_ms = std::max(delay, 0.1f);
    const float fraction = std::clamp(depth / delay_ms, 0.0f, kMaxDepthFraction);
    depth_fraction = fraction;
    left.SetLfoDepth(fraction);
    right.SetLfoDepth(fraction);
  }

  void ApplyFeedback() {
    left.SetFeedback(feedback);
    right.SetFeedback(feedback);
  }

  // `stereo` sets the LFO-rate offset between the two channels plus the
  // panning; both instances are kept symmetric (mirror-image pans) so the
  // whole effect is centred.
  void ApplyRateAndStereo() {
    if (stereo >= 0.5f) {
      left.SetLfoFreq(rate);
      right.SetLfoFreq(rate * kLfoSpread);
      left.SetPan(0.25f, 0.75f);
      right.SetPan(0.75f, 0.25f);
    } else {
      left.SetLfoFreq(rate);
      right.SetLfoFreq(rate);
      left.SetPan(0.5f, 0.5f);
      right.SetPan(0.5f, 0.5f);
    }
  }
};

// DaisySP's Chorus inits its engines (and their 2400-sample delay lines) from
// the constructor, so Process() never allocates or initializes on the audio
// thread.
Chorus::Chorus() : impl_(std::make_unique<Impl>()) { impl_->ApplyAll(); }

Chorus::~Chorus() = default;

// Re-initialize both channels for a new sample rate, then re-seed every param
// (DaisySP's Init() resets its own defaults, so the mirror must be reapplied).
// Not real-time safe (it clears the delay lines); call it between blocks.
void Chorus::Reset(double sample_rate) {
  impl_->sample_rate = static_cast<float>(sample_rate);
  impl_->ApplyAll();
}

// Classic chorus: each input channel runs through its own daisysp::Chorus - a
// triangle-LFO-modulated delay line with feedback and two cross-panned
// engines. Output is wet-only - the dry/wet mix is the caller's business (the
// engine's block staging), so a chorus at 100% mix here is a pure voice.
//
// Level: DaisySP's ChorusEngine returns (in + tap) * 0.5 and Chorus halves
// that again via gain_frac_ = 0.5; the dry portion contributed to the read
// output is exactly in * kDryFraction for the pan pairs used. The wrapper
// subtracts the dry and scales the remainder by kInverseDryFraction to
// recover a unity-level wet tap, so the engine's mix knob remains the only
// dry/wet control.
void Chorus::Process(const float* const* input, float* const* output, int num_frames) {
  daisysp::Chorus& left = impl_->left;
  daisysp::Chorus& right = impl_->right;
  for (int i = 0; i < num_frames; ++i) {
    const float in_l = input[0][i];
    const float in_r = input[1][i];
    // Process() returns the left-panned output (GetLeft()); the pan mirror on
    // each instance means the read side is the same fraction of the dry in.
    output[0][i] = (left.Process(in_l) - in_l * kDryFraction) * kInverseDryFraction;
    output[1][i] = (right.Process(in_r) - in_r * kDryFraction) * kInverseDryFraction;
  }
}

// Param surface: rate (Hz), depth (ms of excursion), base delay (ms),
// feedback (0..1). Indices are the kParamInfo order, which is generated from
// packages/core/param_schema.json - never hand-reorder them.
int Chorus::ParamCount() { return kParamCount; }

// Name/symbol/range/unit for one param index. The caller is responsible for
// staying within [0, ParamCount()); the engine's SetParam/ParamInfo already
// bound-check before reaching here.
const Chorus::ParamInfo& Chorus::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}

// Current value of one param, 0 for an unknown index.
float Chorus::GetParam(int index) const {
  switch (index) {
    case kRateParam:
      return impl_->rate;
    case kDepthParam:
      return impl_->depth;
    case kDelayParam:
      return impl_->delay;
    case kFeedbackParam:
      return impl_->feedback;
    case kStereoParam:
      return impl_->stereo;
    default:
      return 0.0f;
  }
}

// Store one param. All real-time safe: every setter only writes scalars or
// recomputes the LFO amplitude from the new delay - no allocation, no buffer
// resizing, so turning any knob mid-note cannot clear the delay lines.
void Chorus::SetParam(int index, float value) {
  switch (index) {
    case kRateParam:
      impl_->rate = value;
      impl_->ApplyRateAndStereo();
      break;
    case kDepthParam:
      impl_->depth = value;
      impl_->ApplyDelayAndDepth();
      break;
    case kDelayParam:
      impl_->delay = value;
      impl_->ApplyDelayAndDepth();
      break;
    case kFeedbackParam:
      impl_->feedback = value;
      impl_->ApplyFeedback();
      break;
    case kStereoParam:
      impl_->stereo = value >= 0.5f ? 1.0f : 0.0f;
      impl_->ApplyRateAndStereo();
      break;
    default:
      return;
  }
}

}  // namespace openaxe::dsp