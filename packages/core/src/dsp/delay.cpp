#include "openaxe/dsp/delay.h"

#include <algorithm>
#include <array>
#include <cmath>

#include "internal/biquad.h"
#include "internal/variable_delay.h"

namespace openaxe::dsp {

namespace {

constexpr int kTimeParam = 0;
constexpr int kFeedbackParam = 1;
constexpr int kToneParam = 2;
constexpr int kModelParam = 3;
constexpr int kWowDepthParam = 4;
constexpr int kWowRateParam = 5;
constexpr int kStereoModeParam = 6;
constexpr int kWidthParam = 7;
constexpr int kParamCount = 8;

// Generated from packages/core/param_schema.json (issue #51) - run
// scripts/gen-param-schema.mjs after editing the schema.
const Delay::ParamInfo kParamInfo[kParamCount] = {
#include "generated/delay_params.inc"
};

// 1.1s of buffer, covering the 1000ms maximum delay plus the tape model's
// wow excursion.
constexpr float kMaxDelayMs = 1100.0f;

// Q of the lowpass in the feedback path. This is 1.0, not the 0.707 the
// previous hand-rolled filter's comment claimed - it computed
// `alpha = sin(w0) * 0.5`, which is sin(w0)/(2Q) at Q = 1. The value is kept
// as it was so the repeats keep their existing colour; only the comment was
// wrong. Whoever revisits the feedback filter should pick a Q deliberately
// rather than inherit this one.
constexpr float kToneQ = 1.0f;

// Soft saturator for analog/tape models — gentle tanh-based compression
// applied to the feedback path to emulate BBD/tape electronics.
inline float SoftClip(float x) { return std::tanh(x * 1.5f) / 1.5f; }

// Keep an LFO phase in [0, 2pi) without an unbounded loop.
inline float WrapPhase(float phase) {
  constexpr float kTwoPi = 6.28318530718f;
  return phase >= kTwoPi ? phase - kTwoPi : phase;
}

// One channel's delay line: the modulated buffer, the tape wow LFO phase, and
// the tone filter that sits in the feedback path. The line's interpolated
// read is what keeps the tape model's continuously-moving tap from quantising
// to whole samples.
struct Channel {
  internal::VariableDelay line;
  float wow_phase = 0.0f;
  internal::Biquad filter;

  // Allocate for the longest delay the params allow and clear the filter.
  void Resize(float sample_rate) {
    line.Prepare(sample_rate, kMaxDelayMs);
    filter.Reset();
  }
};

// One repeat's trip round the feedback loop: the analog/tape models colour it
// with the tone lowpass, and every model soft-clips so a feedback near 0.9
// saturates instead of running away.
inline float Regenerate(Channel& channel, float tap, bool analog_like, float feedback) {
  float signal = tap;
  if (analog_like) signal = channel.filter.Process(signal);
  return SoftClip(signal) * feedback;
}

}  // namespace

struct Delay::Impl {
  std::array<Channel, 2> channels;
  float time_ms = 300.0f;
  float feedback = 0.4f;
  float tone = 6000.0f;
  Model model = Model::kDigital;
  float wow_depth = 1.5f;
  float wow_rate = 0.5f;
  StereoMode stereo_mode = StereoMode::kStereo;
  float width = 1.0f;
  float sample_rate = 48000.0f;

  // Re-allocate both delay lines for the current sample rate and re-seed the
  // tape wow LFOs a quarter cycle apart.
  //
  // The offset used to be applied inside Process, guarded by
  // `wow_phase == 0.0f`, which fired on the first block and then never again -
  // and would re-fire, jumping the right channel's pitch mid-tail, if the
  // phase ever wrapped through exactly zero. Seeding once here is both the fix
  // and the natural home for it.
  void ApplySampleRate() {
    for (auto& ch : channels) ch.Resize(sample_rate);
    channels[0].wow_phase = 0.0f;
    channels[1].wow_phase = 1.57079632679f;  // pi/2
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

// Switch model (Digital / Analog / Tape). Clears the tone filters so the
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
  const float wow_step = wow_rate * 6.28318530718f / sr;
  const bool tape = (model == Model::kTape);
  const bool analog_like = (model == Model::kAnalog || tape);
  const bool ping_pong = (impl_->stereo_mode == StereoMode::kPingPong);
  const float width = std::clamp(impl_->width, 0.0f, 1.0f);

  Channel& left = impl_->channels[0];
  Channel& right = impl_->channels[1];
  left.filter.SetLowpass(impl_->tone, kToneQ, sr);
  right.filter.SetLowpass(impl_->tone, kToneQ, sr);

  // The loop is sample-outer rather than channel-outer because ping-pong
  // needs both lines advanced in lockstep - one channel's write depends on
  // the other's tap from the same sample. Stereo mode is unaffected by the
  // reordering: its two channels never touch each other.
  for (int i = 0; i < num_frames; ++i) {
    // One wow LFO per channel, the right a quarter cycle behind the left, so
    // the tape drift widens the image instead of moving both taps together.
    float left_ms = base_time;
    float right_ms = base_time;
    if (tape) {
      left_ms += wow_depth * std::sin(left.wow_phase);
      right_ms += wow_depth * std::sin(right.wow_phase);
      left.wow_phase = WrapPhase(left.wow_phase + wow_step);
      right.wow_phase = WrapPhase(right.wow_phase + wow_step);
    }

    const float left_tap = left.line.Read(left_ms, sr);
    const float right_tap = right.line.Read(right_ms, sr);

    if (ping_pong) {
      // A true cross-feed: the input enters the left line, the left line's
      // output feeds the right, and the right's feeds back into the left.
      // Successive repeats therefore alternate L, R, L, R rather than each
      // channel regenerating into itself.
      //
      // The input is summed to mono before it enters. Ping-pong is only
      // legible if every repeat starts from one side, and a stereo source
      // written into the left line alone would drop its right channel
      // entirely. The dry signal keeps its stereo image - the engine mixes it
      // back around this wet-only output.
      const float in = (input[0][i] + input[1][i]) * 0.5f;
      const float from_right = Regenerate(right, right_tap, analog_like, fb);
      const float from_left = Regenerate(left, left_tap, analog_like, fb);
      left.line.Write(in + from_right);
      right.line.Write(from_left);

      // Width collapses the two taps toward their mean: 1 = hard left/right,
      // 0 = both taps centred, i.e. the ping-pong becomes a plain mono echo.
      const float centre = (left_tap + right_tap) * 0.5f;
      output[0][i] = centre + (left_tap - centre) * width;
      output[1][i] = centre + (right_tap - centre) * width;
    } else {
      left.line.Write(input[0][i] + Regenerate(left, left_tap, analog_like, fb));
      right.line.Write(input[1][i] + Regenerate(right, right_tap, analog_like, fb));
      output[0][i] = left_tap;
      output[1][i] = right_tap;
    }
  }
}

// Param surface: time (ms), feedback (0..0.9), tone (Hz cutoff in the feedback
// loop), model (0=Digital, 1=Analog, 2=Tape - matching Delay::Model and
// OpenAxeDelayModel), wow depth (ms) and wow rate (Hz) for the tape model,
// stereo_mode (0=Stereo, 1=Ping-Pong) and width (0..1, ping-pong only).
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
    case kStereoModeParam: return static_cast<float>(impl_->stereo_mode);
    case kWidthParam:    return impl_->width;
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
    case kStereoModeParam:
      impl_->stereo_mode = static_cast<StereoMode>(std::clamp(static_cast<int>(std::round(value)), 0, 1));
      break;
    case kWidthParam:    impl_->width = value; break;
    default: return;
  }
}

}  // namespace openaxe::dsp
