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

const Flanger::ParamInfo kParamInfo[kParamCount] = {
    {"Rate", "rate", 0.1f, 10.0f, "Hz"},
    {"Depth", "depth", 0.1f, 5.0f, "ms"},
    {"Feedback", "feedback", 0.0f, 0.9f, "%"},
    {"Delay", "delay", 0.1f, 3.0f, "ms"},
};

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

struct Flanger::Impl {
  std::array<Channel, 2> channels;
  float rate = 0.3f;
  float depth = 2.0f;
  float feedback = 0.5f;
  float delay = 1.0f;
  float sample_rate = 48000.0f;

  void ApplySampleRate() {
    const float max_delay = delay + depth + 1.0f;
    for (auto& ch : channels) ch.Prepare(sample_rate, max_delay);
  }
};

Flanger::Flanger() : impl_(std::make_unique<Impl>()) { impl_->ApplySampleRate(); }

Flanger::~Flanger() = default;

void Flanger::Reset(double sample_rate) {
  impl_->sample_rate = static_cast<float>(sample_rate);
  impl_->ApplySampleRate();
}

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
      const float out = in + wet * fb;
      c.buffer[static_cast<size_t>(c.write_pos)] = in + wet * fb;
      c.write_pos = (c.write_pos + 1) % static_cast<int>(c.buffer.size());
      output[ch][i] = out;
    }
    c.phase = std::fmod(c.phase + phase_step * static_cast<float>(num_frames) * 6.28318530718f,
                         6.28318530718f);
  }
}

int Flanger::ParamCount() { return kParamCount; }

const Flanger::ParamInfo& Flanger::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}

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
