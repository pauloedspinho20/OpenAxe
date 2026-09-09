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

// The four springs' loop times in seconds - the time for one trip down the
// spring and back, i.e. one turn of the feedback loop. Deliberately
// incommensurate so the comb resonances scatter into the metallic "boing"
// instead of stacking into one ringing pitch: a real tank has springs of
// different lengths and tensions. Chosen around 25-70ms so the modes sit in
// the audible metallic range.
constexpr float kSpringTimesS[kNumSprings] = {0.028f, 0.039f, 0.053f, 0.071f};

// The right channel's springs are stretched slightly, so the two pickups hear
// combs at different frequencies. Together with the LFO phase offset below
// this is what gives the tank a stereo image from a mono source - without it
// both channels are bit-identical and `width` has nothing to act on.
constexpr float kRightChannelStretch = 1.031f;

// Quarter-cycle LFO offset between the channels, for the same reason.
constexpr float kRightChannelLfoOffset = 0.25f;

// Ceiling on the wander excursion, as a fraction of each spring's own length.
// 2% is a few cents of detune - a spring's natural warble - where the raw
// `wander` millisecond value would be a third of the shortest spring.
constexpr float kMaxWanderFraction = 0.02f;

// The longest spring tap reachable: the longest spring, stretched, plus the
// full wander excursion, plus slack.
constexpr float kMaxSpringMs = 130.0f;

// Maximum pre-delay the param schema allows.
constexpr float kMaxPredelayMs = 100.0f;

// Below this the feedback state is denormal and costs orders of magnitude more
// to multiply than it contributes; flush it.
constexpr float kDenormalFloor = 1e-20f;

inline float FlushDenormal(float v) { return std::fabs(v) < kDenormalFloor ? 0.0f : v; }

// One spring: a variable-delay line (read through Lagrange3 so the LFO wobble
// is a smooth glide, not a stepped tap) plus the two elements that make a
// spring sound like a spring rather than a digital delay:
//   - a one-pole damping lowpass *in the feedback path* (springs are lossy;
//     highs must die faster than lows, which only happens if the damping is
//     inside the loop), and
//   - a *pair* of cascaded allpass dispersion stages (issue #372's premium
//     upgrade: a spring's round-trip time is frequency-dependent, and two
//     detuned stages smear a transient into the "boing"/chirp far better
//     than one - the second stage runs at 0.61x the first's coefficient so
//     the pair chirps instead of ringing one pitch).
struct SpringLine {
  internal::VariableDelay line;
  float damp_state = 0.0f;
  float allpass_state = 0.0f;
  float allpass_state2 = 0.0f;

  void Prepare(float sample_rate) { line.Prepare(sample_rate, kMaxSpringMs); }
  void Reset() {
    line.Reset();
    damp_state = 0.0f;
    allpass_state = 0.0f;
    allpass_state2 = 0.0f;
  }

  // Advance one sample and return the dispersed tap. `input` is expected to be
  // pre-scaled by sqrt(1 - fb_gain^2) by the caller so the tank's output power
  // stays put as the decay lengthens. RT-safe.
  float Process(float input, float delay_samps, float damp_coeff, float disp_coeff,
                float fb_gain) {
    const float tap = line.ReadSamples(delay_samps);
    // First-order allpass dispersion, twice cascaded: y = -a*x + x1 + a*y1
    // per stage, unit gain, phase-dispersing - the spring's "boing". The
    // second stage is detuned (0.61x) so the pair smears rather than rings.
    const float disp = -disp_coeff * tap + allpass_state;
    allpass_state = FlushDenormal(tap + disp_coeff * disp);
    constexpr float kSecondStageRatio = 0.61f;
    const float disp2 = -disp_coeff * kSecondStageRatio * disp + allpass_state2;
    allpass_state2 = FlushDenormal(disp + disp_coeff * kSecondStageRatio * disp2);
    // Damping sits inside the loop, so each turn loses more high end than low
    // and the tail darkens as it decays. The one-pole is DC-unity, so it does
    // not change the low-frequency RT60 that `fb_gain` sets.
    damp_state = FlushDenormal(damp_state + damp_coeff * (disp2 - damp_state));
    line.Write(input + damp_state * fb_gain);
    return disp2;
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

  // One pre-delay line per channel. A single shared line would be written
  // twice per block by a channel-outer loop and read across channels.
  std::array<internal::VariableDelay, 2> predelay_line;
  // Per-channel springs: the right tank is stretched (kRightChannelStretch)
  // so the two channels comb at different frequencies.
  std::array<std::array<SpringLine, kNumSprings>, 2> springs;

  // LFO phase in cycles [0,1), advanced once per frame - never per channel.
  float lfo_phase = 0.0f;

  void Resize(float sample_rate) {
    sr = sample_rate;
    for (auto& p : predelay_line) p.Prepare(sample_rate, kMaxPredelayMs);
    for (auto& tank : springs)
      for (auto& s : tank) s.Prepare(sample_rate);
    lfo_phase = 0.0f;
  }

  void Silence() {
    for (auto& p : predelay_line) p.Reset();
    for (auto& tank : springs)
      for (auto& s : tank) s.Reset();
    lfo_phase = 0.0f;
  }
};

SpringReverb::SpringReverb() : impl_(std::make_unique<Impl>()) { impl_->Resize(48000.0f); }

SpringReverb::~SpringReverb() = default;

void SpringReverb::Reset(double sample_rate) { impl_->Resize(static_cast<float>(sample_rate)); }

void SpringReverb::Mute() { impl_->Silence(); }

// A spring tank: the input drives four springs per channel, each sustaining
// itself through its damped, dispersed feedback (the RT60 `decay` sets the
// loop gain), and the two channels tap tanks of slightly different length with
// complementary weights (`width`) for the stereo spread. A slow LFO wobbles
// the taps (spin/wander) and an input-drive saturation adds the transducer
// "crunch". The algorithm owns its dry/wet blend via `dry_level`, like the
// rest of the reverb family.
//
// The frame loop is outermost: the pre-delay lines and the LFO advance exactly
// once per frame, so the output does not depend on the host's block size.
void SpringReverb::Process(const float* const* input, float* const* output, int num_frames) {
  if (num_frames <= 0) return;
  const float sr = impl_->sr;

  const float dry = std::clamp(impl_->dry_level, 0.0f, 100.0f) / 100.0f;
  // Additive like the rest of the reverb family (hall/room/plate/ER all run
  // dry*in + full wet): the Dry knob preserves dry signal alongside the tank,
  // it must never duck the effect itself. A crossfade here made Dry=100%
  // (the default) come out as pure dry with no audible reverb at all.

  const float damp_cutoff = std::clamp(impl_->high_cut, 1000.0f, 16000.0f);
  const float damp_coeff = 1.0f - std::exp(-6.28318530718f * damp_cutoff / sr);
  // Tension: longer dwells run higher dispersion, so a 10 s tank chirps harder
  // than a 0.5 s one - the premium "boing" gradient (issue #372). The range
  // 0.52-0.68 keeps both allpass stages stable (|a| < 1) at every decay.
  const float disp_coeff = 0.52f + 0.16f * (std::clamp(impl_->decay, 0.1f, 10.0f) / 10.0f);

  const float width = std::clamp(impl_->width, 50.0f, 150.0f) / 100.0f;
  const float decay = std::max(impl_->decay, 0.1f);

  const float predelay_samps = std::max(impl_->predelay, 0.0f) * sr / 1000.0f;
  const float drive = std::clamp(impl_->drive, 0.0f, 1.0f);
  const float drive_gain = 1.0f + drive * 3.0f;

  const float spin_hz = std::clamp(impl_->spin, 0.0f, 10.0f);
  const float wander_samps = std::clamp(impl_->wander, 0.0f, 40.0f) * 0.5f * sr / 1000.0f;
  const float lfo_step = spin_hz / sr;

  // Per-spring loop gain for the RT60: one turn of the loop takes the spring's
  // own time t, so decaying 60 dB over `decay` seconds needs fb = 10^(-3t/decay).
  // The matching input scale sqrt(1 - fb^2) is the energy normaliser for a
  // recirculating comb: it holds the tank's output power roughly constant as
  // the decay lengthens, instead of a 10-second decay arriving 25 dB hotter
  // than a 1-second one. (The tighter 1 - fb normalises the resonant peaks to
  // unity but costs ~18 dB of level between them, which reads as "too quiet".)
  float fb[2][kNumSprings];
  float in_scale[2][kNumSprings];
  float delay_base[2][kNumSprings];
  for (int ch = 0; ch < 2; ++ch) {
    const float stretch = ch == 0 ? 1.0f : kRightChannelStretch;
    for (int s = 0; s < kNumSprings; ++s) {
      const float t = kSpringTimesS[s] * stretch;
      delay_base[ch][s] = t * sr;
      fb[ch][s] = std::pow(10.0f, -3.0f * t / decay);
      in_scale[ch][s] = std::sqrt(std::max(1.0f - fb[ch][s] * fb[ch][s], 0.0f));
    }
  }

  // Complementary output weights: the left pickup favours the even springs,
  // the right the odd ones, by `width`. Normalised so the summed level is
  // independent of both the width setting and the spring count.
  const float w_even[2] = {1.0f, width};
  const float w_odd[2] = {width, 1.0f};
  const float weight_norm = 1.0f / (2.0f * (1.0f + width));

  for (int i = 0; i < num_frames; ++i) {
    const float lfo_l = std::sin(6.28318530718f * impl_->lfo_phase);
    const float lfo_r =
        std::sin(6.28318530718f * (impl_->lfo_phase + kRightChannelLfoOffset));

    for (int ch = 0; ch < 2; ++ch) {
      const float in = input[ch][i];

      // Pre-delay: write this frame, then read `predelay` behind it.
      impl_->predelay_line[static_cast<size_t>(ch)].Write(in);
      const float delayed =
          predelay_samps > 1.0f
              ? impl_->predelay_line[static_cast<size_t>(ch)].ReadSamples(predelay_samps)
              : in;

      // Input-drive saturation, normalised so the knob changes character
      // rather than level. Asymmetric (a touch of second harmonic) for the
      // transducer "crunch" a real tank has at high levels (issue #372):
      // positive half saturates a little earlier than the negative half.
      const float tanh_norm = std::tanh(drive_gain);
      const float x = drive > 0.001f
                          ? (std::tanh(delayed * drive_gain) + 0.15f * drive * delayed * delayed) /
                                (tanh_norm + 0.15f * drive)
                          : delayed;

      const float lfo = ch == 0 ? lfo_l : lfo_r;

      auto& tank = impl_->springs[static_cast<size_t>(ch)];
      float out = 0.0f;
      for (int s = 0; s < kNumSprings; ++s) {
        // Wander is capped at kMaxWanderFraction of each spring's own length.
        // The param is nominally in ms (it shares the Dragonfly `wander`
        // range), but a spring is only 28-73ms long, so the raw millisecond
        // value would detune the shortest spring by a third and turn a steady
        // note into a warble 22 dB below where it started.
        const float excursion =
            std::min(wander_samps, delay_base[ch][s] * kMaxWanderFraction) * lfo;
        const float delay_samps = std::max(delay_base[ch][s] + excursion, 4.0f);
        const float tap = tank[static_cast<size_t>(s)].Process(
            x * in_scale[ch][s], delay_samps, damp_coeff, disp_coeff, fb[ch][s]);
        out += tap * ((s % 2 == 0) ? w_even[ch] : w_odd[ch]);
      }

      output[ch][i] = dry * in + out * weight_norm;
    }

    impl_->lfo_phase += lfo_step;
    if (impl_->lfo_phase >= 1.0f) impl_->lfo_phase -= 1.0f;
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
