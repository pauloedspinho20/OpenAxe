#include "openaxe/dsp/ping_pong_delay.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace openaxe::dsp {

namespace {

constexpr int kTimeParam = 0;
constexpr int kFeedbackParam = 1;
constexpr int kToneParam = 2;
constexpr int kWidthParam = 3;
constexpr int kParamCount = 4;

// Generated from packages/core/param_schema.json (issue #51) - run
// scripts/gen-param-schema.mjs after editing the schema.
const PingPongDelay::ParamInfo kParamInfo[kParamCount] = {
#include "generated/ping_pong_delay_params.inc"
};

// Buffer length, covering the 1000ms maximum delay with headroom to spare.
constexpr float kMaxDelaySeconds = 1.1f;

// Butterworth (Q = 0.707) lowpass in the feedback path, so each repeat is
// darker than the last. Same RBJ-cookbook biquad as delay.cpp's - duplicated
// rather than shared because the two effects are independent wrappers, and a
// shared internal filter header is a refactor for when a third one appears.
struct ToneFilter {
  float b0 = 1.0f, b1 = 0.0f, b2 = 0.0f;
  float a1 = 0.0f, a2 = 0.0f;
  float x1 = 0.0f, x2 = 0.0f;
  float y1 = 0.0f, y2 = 0.0f;

  // Coefficients via the bilinear transform, or a pass-through at Nyquist.
  // Recomputed once per block, not per sample.
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

  // Direct Form I biquad step.
  float Process(float x) {
    const float y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
    return y;
  }

  // Clear the filter history.
  void Reset() { x1 = x2 = y1 = y2 = 0.0f; }
};

// One circular delay line with a fractionally-interpolated read tap.
struct DelayLine {
  std::vector<float> buffer;
  int write_pos = 0;

  // Allocate for the maximum delay at this sample rate and clear it.
  void Resize(float sample_rate) {
    const int size = static_cast<int>(std::ceil(sample_rate * kMaxDelaySeconds)) + 1;
    buffer.assign(static_cast<size_t>(size), 0.0f);
    write_pos = 0;
  }

  // Read `delay_ms` in the past, interpolating between neighbouring samples.
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

  // Step the write cursor one sample, wrapping at the end of the buffer.
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
  float width = 1.0f;
  float sample_rate = 48000.0f;

  // Re-allocate both lines and clear the shared tone filter.
  void ApplySampleRate() {
    left.Resize(sample_rate);
    right.Resize(sample_rate);
    filter.Reset();
  }
};

// Buffers are allocated here and on Reset(), never in Process().
PingPongDelay::PingPongDelay() : impl_(std::make_unique<Impl>()) { impl_->ApplySampleRate(); }

PingPongDelay::~PingPongDelay() = default;

// Adopt a new sample rate and re-allocate. Not real-time safe.
void PingPongDelay::Reset(double sample_rate) {
  impl_->sample_rate = static_cast<float>(sample_rate);
  impl_->ApplySampleRate();
}

// The cross-coupling described on Impl above, per sample: the input is kept
// stereo for true stereo ping-pong (left input's echo goes right, right input's
// echo goes left), so that a hard-left dry remains hard-left when mixed, and
// the wet ping-pongs hard left/right. Summing to mono (previous) made the left
// channel appear centered at low mix. Width 0 = mono (center), 1 = hard left/right.
void PingPongDelay::Process(const float* const* input, float* const* output, int num_frames) {
  const float sr = impl_->sample_rate;
  const float fb = impl_->feedback;
  const float time_ms = impl_->time_ms;
  const float width = impl_->width;
  impl_->filter.SetCutoff(impl_->tone, sr);

  for (int i = 0; i < num_frames; ++i) {
    const float inL = input[0][i];
    const float inR = input[1][i];

    const float left_tap = impl_->left.ReadTap(time_ms, sr);
    const float right_tap = impl_->right.ReadTap(time_ms, sr);

    // True stereo: cross-couple the inputs so that left input's first echo is
    // hard right, right input's first echo is hard left, preserving the dry's
    // stereo image. Width scales the wet panning: 1 = hard left/right, 0 = mono center.
    impl_->right.buffer[static_cast<size_t>(impl_->right.write_pos)] = inL + impl_->filter.Process(left_tap) * fb;
    impl_->left.buffer[static_cast<size_t>(impl_->left.write_pos)] = inR + impl_->filter.Process(right_tap) * fb;

    // Width: interpolate between mono (center, both channels same) and hard ping-pong.
    // At width 0, both outputs are mono sum of taps; at 1, hard left/right as above.
    const float mono = (left_tap + right_tap) * 0.5f;
    output[0][i] = mono * (1.0f - width) + left_tap * width;
    output[1][i] = mono * (1.0f - width) + right_tap * width;

    impl_->left.Advance();
    impl_->right.Advance();
  }
}

// Param surface: time (ms, shared by both lines), feedback (0..0.9), tone
// (Hz cutoff in the feedback path), width (0..1, stereo width).
int PingPongDelay::ParamCount() { return kParamCount; }

// Name/symbol/range/unit for one param index.
const PingPongDelay::ParamInfo& PingPongDelay::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}

// Current value of one param, 0 for an unknown index.
float PingPongDelay::GetParam(int index) const {
  switch (index) {
    case kTimeParam:     return impl_->time_ms;
    case kFeedbackParam: return impl_->feedback;
    case kToneParam:     return impl_->tone;
    case kWidthParam:    return impl_->width;
    default:             return 0.0f;
  }
}

// Store one param - all real-time safe (the buffers are already sized
// for the maximum delay, so a time change only moves the read taps).
void PingPongDelay::SetParam(int index, float value) {
  switch (index) {
    case kTimeParam:     impl_->time_ms = value; break;
    case kFeedbackParam: impl_->feedback = value; break;
    case kToneParam:     impl_->tone = value; break;
    case kWidthParam:    impl_->width = value; break;
    default: return;
  }
}

}  // namespace openaxe::dsp
