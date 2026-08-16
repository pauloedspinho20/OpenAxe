#include "nam_studio/dsp/chorus.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

namespace nam_studio::dsp {

namespace {

constexpr int kRateParam = 0;
constexpr int kDepthParam = 1;
constexpr int kDelayParam = 2;
constexpr int kFeedbackParam = 3;
constexpr int kParamCount = 4;

const Chorus::ParamInfo kParamInfo[kParamCount] = {
    {"Rate", "rate", 0.1f, 10.0f, "Hz"},
    {"Depth", "depth", 0.2f, 10.0f, "ms"},
    {"Delay", "delay", 5.0f, 30.0f, "ms"},
    {"Feedback", "feedback", 0.0f, 0.5f, "%"},
};

constexpr float kStereoPhaseOffset = 1.57079632679f;  // π/2

struct Channel {
  std::vector<float> buffer;
  int write_pos = 0;
  float phase = 0.0f;

  void Prepare(float sample_rate, float max_delay_ms) {
    const int size = static_cast<int>(std::ceil(max_delay_ms * sample_rate / 1000.0f)) + 1;
    buffer.assign(static_cast<size_t>(size), 0.0f);
    write_pos = 0;
  }

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

  void ApplySampleRate() {
    const float max_delay = delay + depth + 1.0f;
    for (auto& ch : channels) ch.Prepare(sample_rate, max_delay);
  }
};

Chorus::Chorus() : impl_(std::make_unique<Impl>()) { impl_->ApplySampleRate(); }

Chorus::~Chorus() = default;

void Chorus::Reset(double sample_rate) {
  impl_->sample_rate = static_cast<float>(sample_rate);
  impl_->ApplySampleRate();
}

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

int Chorus::ParamCount() { return kParamCount; }

const Chorus::ParamInfo& Chorus::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}

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

}  // namespace nam_studio::dsp
