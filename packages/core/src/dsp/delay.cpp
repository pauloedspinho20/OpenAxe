#include "nam_studio/dsp/delay.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

namespace nam_studio::dsp {

namespace {

constexpr int kTimeParam = 0;
constexpr int kFeedbackParam = 1;
constexpr int kToneParam = 2;
constexpr int kModelParam = 3;
constexpr int kWowDepthParam = 4;
constexpr int kWowRateParam = 5;
constexpr int kParamCount = 6;

const Delay::ParamInfo kParamInfo[kParamCount] = {
    {"Time", "time", 10.0f, 1000.0f, "ms"},
    {"Feedback", "feedback", 0.0f, 0.9f, "%"},
    {"Tone", "tone", 200.0f, 12000.0f, "Hz"},
    {"Model", "model", 0.0f, 2.0f, ""},
    {"Wow Depth", "wow_depth", 0.0f, 5.0f, "ms"},
    {"Wow Rate", "wow_rate", 0.1f, 3.0f, "Hz"},
};

constexpr float kMaxDelaySeconds = 1.1f;  // 1.1s max buffer (covers 1000ms + wow)

// Simple biquad lowpass (one per channel). Computes coefficients once per
// block so the tone filter stays smooth across parameter changes.
struct ToneFilter {
  float b0 = 1.0f, b1 = 0.0f, b2 = 0.0f;
  float a1 = 0.0f, a2 = 0.0f;
  float x1 = 0.0f, x2 = 0.0f;
  float y1 = 0.0f, y2 = 0.0f;

  void SetCutoff(float freq, float sample_rate) {
    if (freq >= sample_rate * 0.49f) {
      b0 = 1.0f; b1 = 0.0f; b2 = 0.0f;
      a1 = 0.0f; a2 = 0.0f;
      return;
    }
    const float w0 = 6.28318530718f * freq / sample_rate;
    const float alpha = std::sin(w0) * 0.5f;  // Q = 0.707 (Butterworth)
    const float cos_w0 = std::cos(w0);
    const float a0_inv = 1.0f / (1.0f + alpha);
    b0 = (0.5f - 0.5f * cos_w0) * a0_inv;
    b1 = (1.0f - cos_w0) * a0_inv;
    b2 = b0;
    a1 = (-2.0f * cos_w0) * a0_inv;
    a2 = (1.0f - alpha) * a0_inv;
  }

  float Process(float x) {
    const float y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
    return y;
  }

  void Reset() { x1 = x2 = y1 = y2 = 0.0f; }
};

// Soft saturator for analog/tape models — gentle tanh-based compression
// applied to the feedback path to emulate BBD/tape electronics.
inline float SoftClip(float x) { return std::tanh(x * 1.5f) / 1.5f; }

struct Channel {
  std::vector<float> buffer;
  int write_pos = 0;
  float wow_phase = 0.0f;
  ToneFilter filter;

  void Resize(float sample_rate) {
    const int size = static_cast<int>(std::ceil(sample_rate * kMaxDelaySeconds)) + 1;
    buffer.assign(static_cast<size_t>(size), 0.0f);
    write_pos = 0;
    filter.Reset();
  }

  float ReadTap(float delay_ms, float sample_rate) const {
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

struct Delay::Impl {
  std::array<Channel, 2> channels;
  float time_ms = 300.0f;
  float feedback = 0.4f;
  float tone = 6000.0f;
  Model model = Model::kDigital;
  float wow_depth = 1.5f;
  float wow_rate = 0.5f;
  float sample_rate = 48000.0f;

  void ApplySampleRate() {
    for (auto& ch : channels) ch.Resize(sample_rate);
  }
};

Delay::Delay() : impl_(std::make_unique<Impl>()) { impl_->ApplySampleRate(); }

Delay::~Delay() = default;

void Delay::Reset(double sample_rate) {
  impl_->sample_rate = static_cast<float>(sample_rate);
  impl_->ApplySampleRate();
}

void Delay::SetModel(Model model) {
  if (model != impl_->model) {
    impl_->model = model;
    for (auto& ch : impl_->channels) ch.filter.Reset();
  }
}

void Delay::Process(const float* const* input, float* const* output, int num_frames) {
  const float sr = impl_->sample_rate;
  const float fb = impl_->feedback;
  const float base_time = impl_->time_ms;
  const Model model = impl_->model;
  const float wow_depth = impl_->wow_depth;
  const float wow_rate = impl_->wow_rate;
  const float wow_step = wow_rate / sr;
  const bool tape = (model == Model::kTape);
  const bool analog_like = (model == Model::kAnalog || tape);

  for (int ch = 0; ch < 2; ++ch) {
    Channel& c = impl_->channels[static_cast<size_t>(ch)];
    c.filter.SetCutoff(impl_->tone, sr);
    if (tape && c.wow_phase == 0.0f && ch == 1) c.wow_phase = 1.57079632679f;  // π/2 stereo offset

    for (int i = 0; i < num_frames; ++i) {
      float delay_ms = base_time;
      if (tape) {
        const float wow = std::sin(c.wow_phase + static_cast<float>(i) * wow_step * 6.28318530718f);
        delay_ms += wow_depth * wow;
      }
      const float wet = c.ReadTap(delay_ms, sr);

      float fb_signal = wet;
      if (analog_like) fb_signal = c.filter.Process(fb_signal);
      fb_signal = SoftClip(fb_signal);

      c.buffer[static_cast<size_t>(c.write_pos)] = input[ch][i] + fb_signal * fb;
      c.write_pos = (c.write_pos + 1) % static_cast<int>(c.buffer.size());
      output[ch][i] = wet;
    }
    if (tape) {
      c.wow_phase = std::fmod(c.wow_phase + wow_step * static_cast<float>(num_frames) * 6.28318530718f,
                               6.28318530718f);
    }
  }
}

int Delay::ParamCount() { return kParamCount; }

const Delay::ParamInfo& Delay::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}

float Delay::GetParam(int index) const {
  switch (index) {
    case kTimeParam:     return impl_->time_ms;
    case kFeedbackParam: return impl_->feedback;
    case kToneParam:     return impl_->tone;
    case kModelParam:    return static_cast<float>(impl_->model);
    case kWowDepthParam: return impl_->wow_depth;
    case kWowRateParam:  return impl_->wow_rate;
    default:             return 0.0f;
  }
}

void Delay::SetParam(int index, float value) {
  switch (index) {
    case kTimeParam:     impl_->time_ms = value; break;
    case kFeedbackParam: impl_->feedback = value; break;
    case kToneParam:     impl_->tone = value; break;
    case kModelParam:    impl_->model = static_cast<Model>(std::clamp(static_cast<int>(std::round(value)), 0, 2)); break;
    case kWowDepthParam: impl_->wow_depth = value; break;
    case kWowRateParam:  impl_->wow_rate = value; break;
    default: return;
  }
}

}  // namespace nam_studio::dsp
