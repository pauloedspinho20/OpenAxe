#include "openaxe/dsp/flanger.h"

#include <algorithm>
#include <array>
#include <cmath>

#include "internal/variable_delay.h"

namespace openaxe::dsp {

namespace {

constexpr int kRateParam = 0;
constexpr int kDepthParam = 1;
constexpr int kFeedbackParam = 2;
constexpr int kDelayParam = 3;
constexpr int kParamCount = 4;

// Generated from packages/core/param_schema.json (issue #51) - run
// scripts/gen-param-schema.mjs after editing the schema.
const Flanger::ParamInfo kParamInfo[kParamCount] = {
#include "generated/flanger_params.inc"
};

// The longest tap the params can ask for: delay's maximum (3ms) plus depth's
// full excursion (5ms), per packages/core/param_schema.json. Sized once in
// Reset rather than per knob position - see chorus.cpp's note.
constexpr float kMaxDelayMs = 8.0f;

// One channel's modulated delay line plus the LFO phase, carried across
// Process() calls so the sweep stays continuous over block boundaries. A
// flanger sweeps a very short delay (~1-5ms), so the interpolated read
// VariableDelay provides is what keeps the comb notches gliding rather than
// stepping.
struct Channel {
  internal::VariableDelay line;
  float phase = 0.0f;
};

}  // namespace

struct Flanger::Impl {
  std::array<Channel, 2> channels;
  float rate = 0.2f;
  float depth = 0.4f;
  float feedback = 0.25f;
  float delay = 0.3f;
  float sample_rate = 48000.0f;

  // Size both delay lines for the largest tap the param schema allows; only
  // the sample rate can change that.
  void ApplySampleRate() {
    for (auto& ch : channels) ch.line.Prepare(sample_rate, kMaxDelayMs);
  }
};

// Buffers are allocated here (and on Reset) so Process() never allocates on
// the audio thread.
Flanger::Flanger() : impl_(std::make_unique<Impl>()) { impl_->ApplySampleRate(); }

Flanger::~Flanger() = default;

// Re-prepare the delay lines for a new sample rate. Params are in
// milliseconds, so they carry over unchanged. Allocates - not real-time safe.
void Flanger::Reset(double sample_rate) {
  impl_->sample_rate = static_cast<float>(sample_rate);
  impl_->ApplySampleRate();
}

// Flanging is chorus' close relative: the same LFO-modulated delay line, but
// a much shorter base delay and a stronger feedback path, so summing the wet
// output with the dry signal produces a moving comb filter rather than a
// detuned second voice.
//
// Two deliberate differences from Chorus::Process: the LFO is offset to a
// unipolar 0..1 sweep (0.5f + 0.5f * lfo) so the delay only ever grows from
// its base rather than swinging either side of it - a flanger's minimum delay
// is what sets the highest comb notch - and both channels share one LFO phase,
// since a phase-split flanger smears the comb into something much less
// characteristic. Output is wet-only; the dry/wet mix belongs to the caller.
void Flanger::Process(const float* const* input, float* const* output, int num_frames) {
  const float sr = impl_->sample_rate;
  const float fb = impl_->feedback;
  const float base_delay = impl_->delay;
  const float mod_depth = impl_->depth;
  const float phase_step = impl_->rate / sr;

  for (int ch = 0; ch < 2; ++ch) {
    Channel& c = impl_->channels[static_cast<size_t>(ch)];
    for (int i = 0; i < num_frames; ++i) {
      const float in = input[ch][i];
      const float lfo = std::sin(c.phase + static_cast<float>(i) * phase_step * 6.28318530718f);
      const float delay_ms = base_delay + mod_depth * (0.5f + 0.5f * lfo);
      const float wet = c.line.Read(delay_ms, sr);
      c.line.Write(in + wet * fb);
      output[ch][i] = wet;
    }
    c.phase = std::fmod(c.phase + phase_step * static_cast<float>(num_frames) * 6.28318530718f,
                         6.28318530718f);
  }
}

// Param surface: rate (Hz), depth (ms of excursion), feedback (0..0.9),
// base delay (ms). Index order comes from the generated kParamInfo table.
int Flanger::ParamCount() { return kParamCount; }

// Name/symbol/range/unit for one param index; callers bound-check first.
const Flanger::ParamInfo& Flanger::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}

// Current value of one param, 0 for an unknown index.
float Flanger::GetParam(int index) const {
  switch (index) {
    case kRateParam:
      return impl_->rate;
    case kDepthParam:
      return impl_->depth;
    case kFeedbackParam:
      return impl_->feedback;
    case kDelayParam:
      return impl_->delay;
    default:
      return 0.0f;
  }
}

// Store one param. All real-time safe: the delay lines are sized for
// kMaxDelayMs up front, so moving the Delay knob only moves the read tap.
void Flanger::SetParam(int index, float value) {
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
    case kDelayParam:
      impl_->delay = value;
      break;
    default:
      return;
  }
}

}  // namespace openaxe::dsp
