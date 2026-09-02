#include "openaxe/dsp/spring_reverb.h"

#include <algorithm>
#include <array>
#include <cmath>

#include "internal/variable_delay.h"

namespace openaxe::dsp {

namespace {

// Param indices, in the order generated from param_schema.json. The first
// seven symbols are chosen to match the engine's ReverbControl abstraction
// (see ReverbControlSymbols in engine.cpp) so the UI's roomSize/damping/
// width/predelay/spin/wander/dryLevel knobs map straight onto this algorithm;
// `drive` is spring-specific.
constexpr int kDryLevelParam = 0;
constexpr int kDecayParam = 1;
constexpr int kHighCutParam = 2;
constexpr int kWidthParam = 3;
constexpr int kPredelayParam = 4;
constexpr int kSpinParam = 5;
constexpr int kWanderParam = 6;
constexpr int kDriveParam = 7;
constexpr int kParamCount = 8;

// Number of parallel springs per channel.
constexpr int kNumSprings = 4;

const SpringReverb::ParamInfo kParamInfo[kParamCount] = {
#include "generated/spring_reverb_params.inc"
};

// The four springs' base round-trip times in seconds. Deliberately
// incommensurate (irrational-ish ratios) so the comb resonances scatter into
// the metallic "boing" instead of stacking into one ringing pitch - a real
// tank has springs of different lengths and tensions. Chosen around
// 25-70ms so the modes sit in the audible metallic range.
constexpr float kSpringTimesS[kNumSprings] = {0.028f, 0.039f, 0.053f, 0.071f};

// The longest spring tap reachable: base + full wander excursion + slack.
constexpr float kMaxSpringMs = 110.0f;

// Maximum pre-delay the param schema allows.
constexpr float kMaxPredelayMs = 100.0f;

inline float OnePoleStep(float y, float x, float coeff) { return y + coeff * (x - y); }

// One spring: a variable-delay line (read through Lagrange3 so the LFO wobble
// is a smooth glide, not a stepped tap) plus the two elements that make a
// spring sound like a spring rather than a digital delay:
//   - a one-pole damping lowpass in the feedback path (springs are lossy,
//     highs die faster), and
//   - an allpass dispersion stage (a spring's round-trip time is
//     frequency-dependent, which smears a transient into the "boing").
struct SpringLine {
  internal::VariableDelay line;
  float damp_state = 0.0f;
  float allpass_state = 0.0f;

  void Prepare(float sample_rate) { line.Prepare(sample_rate, kMaxSpringMs); }
  void Reset() {
    line.Reset();
    damp_state = 0.0f;
    allpass_state = 0.0f;
  }

  // Advance one sample: read the tap at `delay_samps`, apply dispersion, write
  // `input` plus the dispersed tap * feedback back into the line so the loop
  // sustains at the RT60 rate, and return the tap damped. RT-safe.
  float Process(float input, float delay_samps, float damp_coeff, float disp_coeff, float fb_gain) {
    const float tap = line.ReadSamples(delay_samps);
    // First-order allpass dispersion: y = -a*x + x1 + a*y1 via one state
    // sample. Unit gain, phase-dispersing - the spring's "boing".
    const float disp = -disp_coeff * tap + allpass_state;
    allpass_state = tap + disp_coeff * disp;
    // Write the input plus the dispersed tap * feedback so the loop sustains
    // at the RT60 rate (the loop gain is purely fb_gain - damping only
    // colours the output, it doesn't shorten the reverb).
    line.Write(input + disp * fb_gain);
    // Damping on the output tap: highs roll off faster, lows ring longer.
    const float damped = OnePoleStep(damp_state, tap, damp_coeff);
    damp_state = damped;
    return damped;
  }
};

}  // namespace

struct SpringReverb::Impl {
  float dry_level = 100.0f;  // %
  float decay = 2.0f;        // seconds (RT60)
  float high_cut = 4000.0f;  // Hz
  float width = 100.0f;      // %
  float predelay = 0.0f;     // ms
  float spin = 0.0f;         // Hz
  float wander = 0.0f;       // ms
  float drive = 0.5f;        // 0..1

  float sr = 48000.0f;

  // Pre-delay line (shared stereo).
  internal::VariableDelay predelay_line;
  // Per-channel springs, so L and R can read the same tank with different
  // taps (the width control).
  std::array<SpringLine, kNumSprings> springs_l;
  std::array<SpringLine, kNumSprings> springs_r;

  // LFO phase for spin/wander.
  float lfo_phase = 0.0f;

  void Resize(float sample_rate) {
    sr = sample_rate;
    predelay_line.Prepare(sample_rate, kMaxPredelayMs);
    for (auto& s : springs_l) s.Prepare(sample_rate);
    for (auto& s : springs_r) s.Prepare(sample_rate);
    lfo_phase = 0.0f;
  }
};

SpringReverb::SpringReverb() : impl_(std::make_unique<Impl>()) { impl_->Resize(48000.0f); }

SpringReverb::~SpringReverb() = default;

void SpringReverb::Reset(double sample_rate) { impl_->Resize(static_cast<float>(sample_rate)); }

void SpringReverb::Mute() {
  impl_->predelay_line.Reset();
  for (auto& s : impl_->springs_l) s.Reset();
  for (auto& s : impl_->springs_r) s.Reset();
}

// A spring tank: the input drives all four springs on both channels, each
// spring sustains itself through its damped/dispersed feedback (the RT60
// `decay` sets the feedback gain), and the two output channels tap the same
// springs with different weights (`width`) for the tank's stereo spread. An
// optional slow LFO wobbles the spring taps (spin/wander), and an input-drive
// saturation adds the transducer "crunch". The algorithm owns its dry/wet
// blend via `dry_level`, like the rest of the reverb family.
void SpringReverb::Process(const float* const* input, float* const* output, int num_frames) {
  const float sr = impl_->sr;

  const float dry = std::clamp(impl_->dry_level, 0.0f, 100.0f) / 100.0f;
  const float wet = 1.0f - dry;

  const float damp_cutoff = std::clamp(impl_->high_cut, 1000.0f, 16000.0f);
  const float damp_coeff = 1.0f - std::exp(-6.28318530718f * damp_cutoff / sr);
  const float disp_coeff = 0.6f;

  const float width = std::clamp(impl_->width, 50.0f, 150.0f) / 100.0f;
  const float decay = std::max(impl_->decay, 0.1f);

  const float predelay_samps = impl_->predelay * sr / 1000.0f;
  const float drive = std::clamp(impl_->drive, 0.0f, 1.0f);
  const float drive_gain = 1.0f + drive * 3.0f;

  const float spin_hz = std::clamp(impl_->spin, 0.0f, 10.0f);
  const float wander_ms = std::clamp(impl_->wander, 0.0f, 40.0f);
  const float lfo_step = spin_hz / sr;

  // Per-spring feedback gain for the RT60: over one round trip (2*t) the wave
  // must decay by 60dB across `decay` seconds.
  float fb[kNumSprings];
  for (int s = 0; s < kNumSprings; ++s) {
    fb[s] = std::pow(10.0f, -3.0f * (2.0f * kSpringTimesS[s]) / decay);
  }

  for (int ch = 0; ch < 2; ++ch) {
    auto& springs = ch == 0 ? impl_->springs_l : impl_->springs_r;
    for (int i = 0; i < num_frames; ++i) {
      const float in = input[ch][i];

      // Pre-delay, then input-drive saturation.
      float drive_sig = in;
      if (predelay_samps > 0.5f) {
        drive_sig = impl_->predelay_line.ReadSamples(predelay_samps);
      }
      impl_->predelay_line.Write(in);
      float x = drive_sig;
      if (drive > 0.001f) {
        x = std::tanh(drive_sig * drive_gain) / std::tanh(drive_gain);
      }

      // LFO for this frame (same phase both channels; the wander offsets each
      // spring's tap below).
      const float lfo = std::sin(6.28318530718f * (impl_->lfo_phase + lfo_step * i));

      float out = 0.0f;
      for (int s = 0; s < kNumSprings; ++s) {
        SpringLine& spring = springs[static_cast<size_t>(s)];
        // Effective tap this frame: base spring time + LFO wobble.
        const float mod_ms = wander_ms * lfo * 0.5f;
        const float t_s = kSpringTimesS[s] + mod_ms / 1000.0f;
        const float delay_samps = std::max(t_s * sr, 4.0f);
        const float tap = spring.Process(x * 0.5f, delay_samps, damp_coeff, disp_coeff, fb[s]);
        // Output weights: even springs feed this channel at unity, odd ones at
        // `width` (and the other channel receives the complement), giving the
        // tank its stereo spread. Incommensurate springs + different weights
        // per channel = the "wide" spring image.
        const float w = (s % 2 == 0) ? 1.0f : width;
        out += tap * w;
      }

      output[ch][i] = dry * in + wet * out * 0.5f;
    }
    impl_->lfo_phase = std::fmod(impl_->lfo_phase + lfo_step * num_frames, 1.0f);
  }
}

int SpringReverb::ParamCount() { return kParamCount; }

const SpringReverb::ParamInfo& SpringReverb::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}

float SpringReverb::GetParam(int index) const {
  switch (index) {
    case kDryLevelParam: return impl_->dry_level;
    case kDecayParam: return impl_->decay;
    case kHighCutParam: return impl_->high_cut;
    case kWidthParam: return impl_->width;
    case kPredelayParam: return impl_->predelay;
    case kSpinParam: return impl_->spin;
    case kWanderParam: return impl_->wander;
    case kDriveParam: return impl_->drive;
    default: return 0.0f;
  }
}

void SpringReverb::SetParam(int index, float value) {
  switch (index) {
    case kDryLevelParam: impl_->dry_level = std::clamp(value, 0.0f, 100.0f); break;
    case kDecayParam: impl_->decay = std::clamp(value, 0.1f, 10.0f); break;
    case kHighCutParam: impl_->high_cut = std::clamp(value, 1000.0f, 16000.0f); break;
    case kWidthParam: impl_->width = std::clamp(value, 50.0f, 150.0f); break;
    case kPredelayParam: impl_->predelay = std::clamp(value, 0.0f, 100.0f); break;
    case kSpinParam: impl_->spin = std::clamp(value, 0.0f, 10.0f); break;
    case kWanderParam: impl_->wander = std::clamp(value, 0.0f, 40.0f); break;
    case kDriveParam: impl_->drive = std::clamp(value, 0.0f, 1.0f); break;
    default: break;
  }
}

}  // namespace openaxe::dsp