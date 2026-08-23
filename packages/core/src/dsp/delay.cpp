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

// Generated from packages/core/param_schema.json (issue #51) - run
// scripts/gen-param-schema.mjs after editing the schema.
const Delay::ParamInfo kParamInfo[kParamCount] = {
#include "generated/delay_params.inc"
};

constexpr float kMaxDelaySeconds = 1.1f;  // 1.1s max buffer (covers 1000ms + wow)

// Simple biquad lowpass (one per channel). Computes coefficients once per
// block so the tone filter stays smooth across parameter changes.
struct ToneFilter {
  float b0 = 1.0f, b1 = 0.0f, b2 = 0.0f;
  float a1 = 0.0f, a2 = 0.0f;
  float x1 = 0.0f, x2 = 0.0f;
  float y1 = 0.0f, y2 = 0.0f;

  // Butterworth (Q = 0.707) lowpass coefficients via the bilinear transform,
  // or a straight pass-through when the cutoff reaches Nyquist - the standard
  // RBJ cookbook forms. Coefficients are recomputed once per block, not per
  // sample, since the tone knob doesn't need sample-accurate smoothing.
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

  // Direct Form I biquad step: two input and two output history taps.
  float Process(float x) {
    const float y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
    return y;
  }

  // Clear the filter history (model or sample-rate change).
  void Reset() { x1 = x2 = y1 = y2 = 0.0f; }
};

// Soft saturator for analog/tape models — gentle tanh-based compression
// applied to the feedback path to emulate BBD/tape electronics.
inline float SoftClip(float x) { return std::tanh(x * 1.5f) / 1.5f; }

// One channel's delay line: the circular buffer, its write cursor, the tape
// wow LFO phase, and the tone filter that sits in the feedback path.
struct Channel {
  std::vector<float> buffer;
  int write_pos = 0;
  float wow_phase = 0.0f;
  ToneFilter filter;

  // Allocate for the longest delay the params allow (kMaxDelaySeconds covers
  // the 1000ms maximum plus the tape model's wow excursion) and clear state.
  void Resize(float sample_rate) {
    const int size = static_cast<int>(std::ceil(sample_rate * kMaxDelaySeconds)) + 1;
    buffer.assign(static_cast<size_t>(size), 0.0f);
    write_pos = 0;
    filter.Reset();
  }

  // Read `delay_ms` in the past with linear interpolation, so the tape model's
  // continuously-moving tap doesn't quantise to whole samples.
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

  // Re-allocate both delay lines for the current sample rate.
  void ApplySampleRate() {
    for (auto& ch : channels) ch.Resize(sample_rate);
  }
};

// Buffers are allocated here and on every Reset(), never in Process().
Delay::Delay() : impl_(std::make_unique<Impl>()) { impl_->ApplySampleRate(); }

Delay::~Delay() = default;

// Adopt a new sample rate and re-allocate the delay lines. Delay times are
// held in milliseconds, so the params themselves carry over. Not real-time safe.
void Delay::Reset(double sample_rate) {
  impl_->sample_rate = static_cast<float>(sample_rate);
  impl_->ApplySampleRate();
}

// Switch model (Digital / Tape / Analog). Clears the tone filters so the
// previous model's filter state can't ring into the new one; the delay buffer
// contents are deliberately kept, so switching mid-repeat doesn't cut the tail.
void Delay::SetModel(Model model) {
  if (model != impl_->model) {
    impl_->model = model;
    for (auto& ch : impl_->channels) ch.filter.Reset();
  }
}

// Which character the block currently plays through - see the header.
Delay::Model Delay::GetModel() const { return impl_->model; }

// Feedback delay with three models differing only in what happens inside the
// feedback loop:
//
//   Digital - clean repeats: the tap is fed straight back (still soft-clipped,
//             which only engages on hot signals).
//   Analog  - BBD-style: the tone lowpass sits in the loop, so each successive
//             repeat is darker than the last.
//   Tape    - Analog plus "wow": a slow LFO modulates the tap position, giving
//             the pitch drift of a tape mechanism. The right channel's wow runs
//             a quarter cycle behind the left for a wider image.
//
// The soft clipper (tanh) in the loop is what keeps feedback near 0.9 from
// running away - it compresses rather than hard-clipping, so a self-oscillating
// setting saturates musically instead of blowing up. Output is wet-only; the
// dry/wet mix belongs to the caller.
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

// Param surface: time (ms), feedback (0..0.9), tone (Hz cutoff in the feedback
// loop), model (0=Digital, 1=Tape, 2=Analog), wow depth (ms) and wow rate (Hz)
// for the tape model.
int Delay::ParamCount() { return kParamCount; }

// Name/symbol/range/unit for one param index.
const Delay::ParamInfo& Delay::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}

// Current value of one param, 0 for an unknown index (the model enum is
// widened to float, matching the all-float param ABI).
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

// Store one param. All real-time safe: the buffer is already sized for the
// maximum delay, so a time change just moves the read tap. The model index is
// clamped to the enum's range rather than trusted.
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
