#include "nam_studio/dsp/phaser.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

namespace nam_studio::dsp {

namespace {

constexpr int kRateParam = 0;
constexpr int kDepthParam = 1;
constexpr int kFeedbackParam = 2;
constexpr int kStagesParam = 3;
constexpr int kParamCount = 4;

// Generated from packages/core/param_schema.json (issue #51) - run
// scripts/gen-param-schema.mjs after editing the schema.
const Phaser::ParamInfo kParamInfo[kParamCount] = {
#include "generated/phaser_params.inc"
};

constexpr int kMaxStages = 8;
constexpr float kLowFreq = 150.0f;       // minimum sweep frequency (Hz)
constexpr float kHighFreq = 3000.0f;     // maximum sweep frequency (Hz)
constexpr float kStereoOffset = 1.57079632679f;  // π/2

// One first-order allpass section: y[n] = a*x[n] + x[n-1] - a*y[n-1].
// It passes every frequency at full amplitude but rotates phase around the
// break frequency the coefficient `a` encodes - cascading several of them and
// summing against the dry signal is what produces a phaser's moving notches.
struct AllPassStage {
  float x1 = 0.0f;  // previous input
  float y1 = 0.0f;  // previous output

  // One sample through the section, updating its two-sample history.
  float Process(float x, float a) {
    const float y = a * x + x1 - a * y1;
    x1 = x;
    y1 = y;
    return y;
  }

  // Clear the history - on a sample-rate change or a stage-count change,
  // where stale state would otherwise click.
  void Reset() {
    x1 = 0.0f;
    y1 = 0.0f;
  }
};

// Allpass coefficient for a break frequency, via the bilinear transform:
// a = (1 - tan(w0/2)) / (1 + tan(w0/2)), where w0 is the normalized angular
// frequency. Recomputed per sample in Process() because the LFO is sweeping it.
float ComputeCoeff(float freq, float sample_rate) {
  const float w0 = 6.28318530718f * freq / sample_rate;
  const float t = std::tan(w0 * 0.5f);
  return (1.0f - t) / (1.0f + t);
}

// One channel's allpass cascade plus its LFO phase, carried across Process()
// calls so the sweep stays continuous across block boundaries.
struct Channel {
  std::array<AllPassStage, kMaxStages> stages;
  float phase = 0.0f;

  // Clear every stage's history.
  void Reset() {
    for (auto& s : stages) s.Reset();
  }
};

}  // namespace

struct Phaser::Impl {
  std::array<Channel, 2> channels;
  float rate = 0.3f;
  float depth = 0.7f;
  float feedback = 0.5f;
  int stages = 4;
  float sample_rate = 48000.0f;
};

Phaser::Phaser() : impl_(std::make_unique<Impl>()) {}

Phaser::~Phaser() = default;

// Adopt a new sample rate and clear the cascade. Allocation-free (the stages
// are a fixed array), but it discards state, so call it between blocks.
void Phaser::Reset(double sample_rate) {
  impl_->sample_rate = static_cast<float>(sample_rate);
  for (auto& ch : impl_->channels) ch.Reset();
}

// A sine LFO sweeps the break frequency of `stages` cascaded allpass sections,
// with the last stage's output fed back into the input at `feedback` to sharpen
// the notches. The sweep is exponential (kLowFreq * ratio^(t*depth)) rather
// than linear, because pitch is perceived logarithmically - a linear sweep
// spends most of its travel in the top octave and sounds lopsided.
//
// `depth` scales how much of the 150Hz..3kHz range the sweep actually covers.
// The right channel's LFO is offset a quarter cycle (kStereoOffset) so the two
// channels' notches don't move in lockstep. Output is the wet cascade; the
// dry/wet mix belongs to the caller.
void Phaser::Process(const float* const* input, float* const* output, int num_frames) {
  const float sr = impl_->sample_rate;
  const float fb = impl_->feedback;
  const float depth = impl_->depth;
  const float phase_step = impl_->rate / sr;
  const int num_stages = impl_->stages;
  const float freq_ratio = kHighFreq / kLowFreq;

  for (int ch = 0; ch < 2; ++ch) {
    Channel& chan = impl_->channels[static_cast<size_t>(ch)];
    const float lfo_base = chan.phase + (ch == 1 ? kStereoOffset : 0.0f);
    for (int i = 0; i < num_frames; ++i) {
      const float lfo = std::sin(lfo_base + static_cast<float>(i) * phase_step * 6.28318530718f);
      const float t = 0.5f + 0.5f * lfo;                                    // [0, 1]
      const float freq = kLowFreq * std::pow(freq_ratio, t * depth);        // exponential sweep
      const float a = ComputeCoeff(freq, sr);

      float x = input[ch][i] + fb * chan.stages[static_cast<size_t>(num_stages - 1)].y1;
      for (int s = 0; s < num_stages; ++s) {
        x = chan.stages[static_cast<size_t>(s)].Process(x, a);
      }
      output[ch][i] = x;
    }
    chan.phase = std::fmod(chan.phase + phase_step * static_cast<float>(num_frames) * 6.28318530718f,
                           6.28318530718f);
  }
}

// Param surface: rate (Hz), depth (0..1 of the sweep range), feedback (0..0.9),
// stages (2..8 allpass sections - more stages, more notches).
int Phaser::ParamCount() { return kParamCount; }

// Name/symbol/range/unit for one param index.
const Phaser::ParamInfo& Phaser::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}

// Current value of one param, 0 for an unknown index. The stage count is an
// int internally and widened to float here, matching the ABI's all-float params.
float Phaser::GetParam(int index) const {
  switch (index) {
    case kRateParam:
      return impl_->rate;
    case kDepthParam:
      return impl_->depth;
    case kFeedbackParam:
      return impl_->feedback;
    case kStagesParam:
      return static_cast<float>(impl_->stages);
    default:
      return 0.0f;
  }
}

// Store one param. All four are real-time safe: the stage count only clears
// the cascade (no allocation - kMaxStages sections always exist), and it is
// clamped to 2..kMaxStages because Process() indexes stages[num_stages - 1]
// for the feedback tap.
void Phaser::SetParam(int index, float value) {
  switch (index) {
    case kRateParam:
      impl_->rate = value;
      break;
    case kDepthParam:
      impl_->depth = value;
      break;
    case kFeedbackParam:
      impl_->feedback = value;
      break;
    case kStagesParam: {
      int stages = std::clamp(static_cast<int>(std::round(value)), 2, kMaxStages);
      if (stages != impl_->stages) {
        impl_->stages = stages;
        for (auto& ch : impl_->channels) ch.Reset();
      }
      break;
    }
    default:
      return;
  }
}

}  // namespace nam_studio::dsp
