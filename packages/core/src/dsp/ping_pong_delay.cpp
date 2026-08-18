#include "nam_studio/dsp/ping_pong_delay.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace nam_studio::dsp {

namespace {

constexpr int kTimeParam = 0;
constexpr int kFeedbackParam = 1;
constexpr int kToneParam = 2;
constexpr int kParamCount = 3;

// Generated from packages/core/param_schema.json (issue #51) - run
// scripts/gen-param-schema.mjs after editing the schema.
const PingPongDelay::ParamInfo kParamInfo[kParamCount] = {
#include "generated/ping_pong_delay_params.inc"
};

constexpr float kMaxDelaySeconds = 1.1f;

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
    const float alpha = std::sin(w0) * 0.5f;
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

struct DelayLine {
  std::vector<float> buffer;
  int write_pos = 0;

  void Resize(float sample_rate) {
    const int size = static_cast<int>(std::ceil(sample_rate * kMaxDelaySeconds)) + 1;
    buffer.assign(static_cast<size_t>(size), 0.0f);
    write_pos = 0;
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

  void Advance() { write_pos = (write_pos + 1) % static_cast<int>(buffer.size()); }
};

}  // namespace

// Two delay lines: the right buffer receives input + left's echo; the left
// buffer receives only the right's echo. This naturally creates alternating
// L/R ping-pong repeats without tracking a pong counter per-sample.
struct PingPongDelay::Impl {
  DelayLine left;
  DelayLine right;
  ToneFilter filter;
  float time_ms = 250.0f;
  float feedback = 0.5f;
  float tone = 6000.0f;
  float sample_rate = 48000.0f;

  void ApplySampleRate() {
    left.Resize(sample_rate);
    right.Resize(sample_rate);
    filter.Reset();
  }
};

PingPongDelay::PingPongDelay() : impl_(std::make_unique<Impl>()) { impl_->ApplySampleRate(); }

PingPongDelay::~PingPongDelay() = default;

void PingPongDelay::Reset(double sample_rate) {
  impl_->sample_rate = static_cast<float>(sample_rate);
  impl_->ApplySampleRate();
}

void PingPongDelay::Process(const float* const* input, float* const* output, int num_frames) {
  const float sr = impl_->sample_rate;
  const float fb = impl_->feedback;
  const float time_ms = impl_->time_ms;
  impl_->filter.SetCutoff(impl_->tone, sr);

  for (int i = 0; i < num_frames; ++i) {
    const float in = input[0][i] * 0.5f + input[1][i] * 0.5f;

    const float left_tap = impl_->left.ReadTap(time_ms, sr);
    const float right_tap = impl_->right.ReadTap(time_ms, sr);

    impl_->right.buffer[static_cast<size_t>(impl_->right.write_pos)] = in + impl_->filter.Process(left_tap) * fb;
    impl_->left.buffer[static_cast<size_t>(impl_->left.write_pos)] = impl_->filter.Process(right_tap) * fb;

    output[0][i] = left_tap;
    output[1][i] = right_tap;

    impl_->left.Advance();
    impl_->right.Advance();
  }
}

int PingPongDelay::ParamCount() { return kParamCount; }

const PingPongDelay::ParamInfo& PingPongDelay::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}

float PingPongDelay::GetParam(int index) const {
  switch (index) {
    case kTimeParam:     return impl_->time_ms;
    case kFeedbackParam: return impl_->feedback;
    case kToneParam:     return impl_->tone;
    default:             return 0.0f;
  }
}

void PingPongDelay::SetParam(int index, float value) {
  switch (index) {
    case kTimeParam:     impl_->time_ms = value; break;
    case kFeedbackParam: impl_->feedback = value; break;
    case kToneParam:     impl_->tone = value; break;
    default: return;
  }
}

}  // namespace nam_studio::dsp
