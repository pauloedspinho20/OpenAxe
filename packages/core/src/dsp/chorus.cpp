#include "openaxe/dsp/chorus.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

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

// One channel's modulated delay line: a circular buffer, its write cursor, and
// the LFO phase carried across Process() calls so the sweep stays continuous
// across block boundaries.
struct Channel {
  std::vector<float> buffer;
  int write_pos = 0;
  float phase = 0.0f;

  // (Re)allocate the buffer for the longest delay the current params can ask
  // for. +1 sample of slack so the fractional read below always has a second
  // sample to interpolate towards.
  void Prepare(float sample_rate, float max_delay_ms) {
    const int size = static_cast<int>(std::ceil(max_delay_ms * sample_rate / 1000.0f)) + 1;
    buffer.assign(static_cast<size_t>(size), 0.0f);
    write_pos = 0;
  }

  // Read `delay_ms` in the past with linear interpolation between the two
  // neighbouring samples. Fractional delay is the whole point: an integer-only
  // tap would quantise the LFO sweep into audible steps ("zipper" artefacts).
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

struct Chorus::Impl {
  std::array<Channel, 2> channels;
  float rate = 0.5f;
  float depth = 5.0f;
  float delay = 8.0f;
  float feedback = 0.2f;
  float sample_rate = 48000.0f;

  // Size both delay lines for the worst case the current settings allow -
  // base delay plus the full modulation excursion, plus a sample of headroom.
  // Called whenever the sample rate or the base delay changes.
  void ApplySampleRate() {
    const float max_delay = delay + depth + 1.0f;
    for (auto& ch : channels) ch.Prepare(sample_rate, max_delay);
  }
};

// The delay lines are allocated up front (and on every Reset/base-delay
// change) so Process() never allocates on the audio thread.
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
      const float wet = c.ReadDelay(delay_ms, sr);
      c.buffer[static_cast<size_t>(c.write_pos)] = in + wet * fb;
      c.write_pos = (c.write_pos + 1) % static_cast<int>(c.buffer.size());
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

// Store one param. Real-time safe except for the base delay, which resizes
// the delay lines (ApplySampleRate) and so must not be called from the audio
// thread - the engine routes param writes through its own atomic mirror and
// applies them between blocks for exactly this reason.
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
      impl_->ApplySampleRate();
      break;
    case kFeedbackParam:
      impl_->feedback = value;
      break;
    default:
      return;
  }
}

}  // namespace openaxe::dsp
