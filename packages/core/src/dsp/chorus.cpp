#include "openaxe/dsp/chorus.h"

#include <algorithm>
#include <array>
#include <cmath>

#include "internal/variable_delay.h"

namespace openaxe::dsp {

namespace {

constexpr int kRateParam = 0;
constexpr int kDepthParam = 1;
constexpr int kDelayParam = 2;
constexpr int kFeedbackParam = 3;
constexpr int kParamCount = 4;

// Generated from packages/core/param_schema.json (issue #51) - run
// scripts/gen-param-schema.mjs after editing the schema.
const Chorus::ParamInfo kParamInfo[kParamCount] = {
#include "generated/chorus_params.inc"
};

// The right channel's LFO runs a quarter cycle behind the left one, which is
// what makes a single delay line per channel read as a stereo-wide chorus
// rather than two identical mono voices.
constexpr float kStereoPhaseOffset = 1.57079632679f;  // π/2

// The longest tap the params can ask for: delay's maximum (30ms) plus depth's
// full excursion (10ms), per packages/core/param_schema.json. The line is
// sized for this once in Reset rather than for the current knob position, so
// turning the Delay knob no longer reallocates and clears the buffer.
constexpr float kMaxDelayMs = 40.0f;

// One channel's modulated delay line plus the LFO phase, carried across
// Process() calls so the sweep stays continuous over block boundaries.
struct Channel {
  internal::VariableDelay line;
  float phase = 0.0f;
};

}  // namespace

struct Chorus::Impl {
  std::array<Channel, 2> channels;
  float rate = 0.2f;
  float depth = 0.8f;
  float delay = 5.5f;
  float feedback = 0.15f;
  float sample_rate = 48000.0f;

  // Size both delay lines for the largest tap the param schema allows. Only
  // the sample rate can change that, so this runs from the constructor and
  // Reset() and nowhere else.
  void ApplySampleRate() {
    for (auto& ch : channels) ch.line.Prepare(sample_rate, kMaxDelayMs);
  }
};

// The delay lines are allocated up front (and on every Reset) so Process()
// never allocates on the audio thread.
Chorus::Chorus() : impl_(std::make_unique<Impl>()) { impl_->ApplySampleRate(); }

Chorus::~Chorus() = default;

// Re-prepare for a new sample rate. Delay params are held in milliseconds, so
// only the buffer sizing depends on the rate - the params themselves carry over
// unchanged. Not real-time safe (it allocates); call it between blocks.
void Chorus::Reset(double sample_rate) {
  impl_->sample_rate = static_cast<float>(sample_rate);
  impl_->ApplySampleRate();
}

// Classic chorus: an LFO modulates each channel's delay time, and the
// delayed signal is fed back into the line at `feedback` before being written
// out. Output is wet-only - the dry/wet mix is the caller's business (the
// engine's block staging), so a chorus at 100% mix here is a pure voice.
//
// The LFO is a plain sine advanced per sample within the block and stored back
// as an absolute phase at the end, so rate changes take effect immediately
// without a discontinuity.
void Chorus::Process(const float* const* input, float* const* output, int num_frames) {
  const float sr = impl_->sample_rate;
  const float fb = impl_->feedback;
  const float base_delay = impl_->delay;
  const float mod_depth = impl_->depth;
  const float phase_step = impl_->rate / sr;

  for (int ch = 0; ch < 2; ++ch) {
    Channel& c = impl_->channels[static_cast<size_t>(ch)];
    const float lfo_phase = c.phase + (ch == 1 ? kStereoPhaseOffset : 0.0f);
    for (int i = 0; i < num_frames; ++i) {
      const float in = input[ch][i];
      const float lfo = std::sin(lfo_phase + static_cast<float>(i) * phase_step * 6.28318530718f);
      const float delay_ms = base_delay + mod_depth * lfo;
      const float wet = c.line.Read(delay_ms, sr);
      c.line.Write(in + wet * fb);
      output[ch][i] = wet;
    }
    c.phase = std::fmod(c.phase + phase_step * static_cast<float>(num_frames) * 6.28318530718f,
                         6.28318530718f);
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
    default:
      return 0.0f;
  }
}

// Store one param. All real-time safe: the delay lines are sized for
// kMaxDelayMs up front, so moving the Delay knob only moves the read tap
// instead of reallocating (which used to clear the line and silence the
// chorus mid-note).
void Chorus::SetParam(int index, float value) {
  switch (index) {
    case kRateParam:
      impl_->rate = value;
      break;
    case kDepthParam:
      impl_->depth = value;
      break;
    case kDelayParam:
      impl_->delay = value;
      break;
    case kFeedbackParam:
      impl_->feedback = value;
      break;
    default:
      return;
  }
}

}  // namespace openaxe::dsp
