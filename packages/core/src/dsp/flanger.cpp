#include "nam_studio/dsp/flanger.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

namespace nam_studio::dsp {

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

// One channel's modulated delay line: a circular buffer, its write cursor, and
// the LFO phase carried across Process() calls so the sweep stays continuous
// across block boundaries.
struct Channel {
  std::vector<float> buffer;
  int write_pos = 0;
  float phase = 0.0f;

  // (Re)allocate the buffer for the longest delay the current params can ask
  // for, plus a sample of slack for the fractional read below.
  void Prepare(float sample_rate, float max_delay_ms) {
    const int size = static_cast<int>(std::ceil(max_delay_ms * sample_rate / 1000.0f)) + 1;
    buffer.assign(static_cast<size_t>(size), 0.0f);
    write_pos = 0;
  }

  // Read `delay_ms` in the past, linearly interpolating between the two
  // neighbouring samples. A flanger sweeps a very short delay (~1-5ms), so
  // sub-sample precision here is what keeps the comb notches gliding smoothly
  // instead of stepping.
  float ReadDelay(float delay_ms, float sample_rate) const {
    const float delay_samples = delay_ms * sample_rate / 1000.0f;
    const float read_pos = static_cast<float>(write_pos) - delay_samples;
    const int size = static_cast<int>(buffer.size());
    int idx0 = static_cast<int>(std::floor(read_pos));
    const float frac = read_pos - static_cast<float>(idx0);
    while (idx0 < 0) idx0 += size;
    const int idx1 = (idx0 + 1) % size;
    idx0 %= size;
    return buffer[static_cast<size_t>(idx0)] * (1.0f - frac) +
           buffer[static_cast<size_t>(idx1)] * frac;
  }
};

}  // namespace

struct Flanger::Impl {
  std::array<Channel, 2> channels;
  float rate = 0.3f;
  float depth = 2.0f;
  float feedback = 0.5f;
  float delay = 1.0f;
  float sample_rate = 48000.0f;

  // Size both delay lines for the longest delay the current settings allow -
  // base delay plus the full modulation excursion, plus a sample of headroom.
  void ApplySampleRate() {
    const float max_delay = delay + depth + 1.0f;
    for (auto& ch : channels) ch.Prepare(sample_rate, max_delay);
  }
};

// Buffers are allocated here (and on Reset/base-delay changes) so Process()
// never allocates on the audio thread.
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
      const float wet = c.ReadDelay(delay_ms, sr);
      c.buffer[static_cast<size_t>(c.write_pos)] = in + wet * fb;
      c.write_pos = (c.write_pos + 1) % static_cast<int>(c.buffer.size());
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

// Store one param. Real-time safe except for the base delay, which resizes
// the delay lines and so must run between blocks (which is how the engine
// applies params anyway).
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
      impl_->ApplySampleRate();
      break;
    default:
      return;
  }
}

}  // namespace nam_studio::dsp
