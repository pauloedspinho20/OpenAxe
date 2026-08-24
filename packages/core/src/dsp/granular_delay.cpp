#include "openaxe/dsp/granular_delay.h"

#include <algorithm>
#include <cmath>
#include <vector>

#include "internal/lagrange3.h"

namespace openaxe::dsp {

namespace {
constexpr int kTimeParam = 0;
constexpr int kGrainSizeParam = 1;
constexpr int kDensityParam = 2;
constexpr int kPitchParam = 3;
constexpr int kJitterParam = 4;
constexpr int kFeedbackParam = 5;
constexpr int kSpreadParam = 6;
constexpr int kCharacterParam = 7;
constexpr int kFreezeParam = 8;
constexpr int kParamCount = 9;
const GranularDelay::ParamInfo kParamInfo[kParamCount] = {
#include "generated/granular_delay_params.inc"
};

// simple one-pole lowpass for character
struct OnePoleLP {
  float y = 0;
  float Process(float x, float coeff) {
    y += coeff * (x - y);
    return y;
  }
  void Reset() { y = 0; }
};

// One granular voice: reads the delay tap resampled at `pitch_factor`. The
// read position tracks the (advancing) write head so unity pitch is an exact
// delay; the per-sample `drift` carries the (pitch_factor - 1) extra samples
// that make it a real ±12 st shift. Re-triggered every grain_period/2 samples,
// with its Hann window at ~0 at both the start and the re-trigger so handoffs
// and the drift reset are masked.
struct GrainVoice {
  float drift = 0; // accumulated read-speed offset since trigger (samples)
  float jitter = 0; // source offset applied at trigger
  float age = 0;   // samples since trigger
  float Window(float grain_samps) const {
    const float p = std::clamp(age / grain_samps, 0.0f, 1.0f);
    return 0.5f - 0.5f * std::cos(6.28318530718f * p);
  }
};

} // namespace

struct GranularDelay::Impl {
  float time_ms = 400;
  float grain_size_ms = 80;
  float density = 8;
  float pitch = 0;
  float jitter = 0.2f;
  float feedback = 0.3f;
  float spread = 0.5f;
  float character = 0;
  float freeze = 0;
  float sr = 48000;
  std::vector<float> bufL, bufR;
  int buf_size = 0;
  int write_pos = 0;
  float phase = 0; // samples until the next grain trigger
  int which = 0;   // which voice triggers next
  GrainVoice voices[2];
  OnePoleLP lpL, lpR;
  float fb_l = 0, fb_r = 0;

  void Resize(float s) {
    sr = s;
    buf_size = int(s * 3.2f) + 1024;
    bufL.assign(static_cast<size_t>(buf_size), 0);
    bufR.assign(static_cast<size_t>(buf_size), 0);
    write_pos = 0;
    phase = 0;
    which = 0;
    voices[0] = GrainVoice{};
    voices[1] = GrainVoice{};
    lpL.Reset();
    lpR.Reset();
    fb_l = fb_r = 0;
  }
};

GranularDelay::GranularDelay() : impl_(std::make_unique<Impl>()) { impl_->Resize(48000); }
GranularDelay::~GranularDelay() = default;

void GranularDelay::Reset(double sample_rate) { impl_->Resize(static_cast<float>(sample_rate)); }

void GranularDelay::Process(const float* const* input, float* const* output, int num_frames) {
  const float sr = impl_->sr;
  const float time_ms = impl_->time_ms;
  const float grain_samps = std::max(32.0f, impl_->grain_size_ms * sr / 1000.0f);
  const float grain_period = std::max(1.0f, sr / impl_->density); // spacing between voices
  const float delay_samps = time_ms * sr / 1000.0f;
  const float pitch_factor = std::pow(2.0f, impl_->pitch / 12.0f);
  const float fb = impl_->feedback;
  const float spread = impl_->spread;
  const float character = impl_->character;
  const bool freeze = impl_->freeze >= 0.5f;

  // character controls lowpass cutoff in feedback path: 0 pristine (12k), 1 lo-fi (1.5k)
  const float cutoff = 12000.0f - character * 10500.0f;
  const float coeff = 1.0f - std::exp(-6.28318530718f * cutoff / sr);
  const float drive = character > 0.5f ? (character - 0.5f) * 2.0f : 0.0f;

  int wp = impl_->write_pos;
  const int size = impl_->buf_size;
  float phase = impl_->phase;
  int which = impl_->which;
  const float spacing = std::max(1.0f, grain_period * 0.5f);

  for (int i = 0; i < num_frames; ++i) {
    const float inL = input[0][i];
    const float inR = input[1][i];

    // write with feedback, unless frozen
    if (!freeze) {
      const float fbL = impl_->lpL.Process(impl_->fb_l, coeff);
      const float fbR = impl_->lpR.Process(impl_->fb_r, coeff);
      // add spread: cross-feed
      float wL = inL + fbL * fb * (1 - spread * 0.5f) + fbR * fb * spread * 0.5f;
      float wR = inR + fbR * fb * (1 - spread * 0.5f) + fbL * fb * spread * 0.5f;
      // character adds saturation when lo-fi
      if (drive > 0.0f) {
        wL = std::tanh(wL * (1.0f + drive * 2.0f));
        wR = std::tanh(wR * (1.0f + drive * 2.0f));
      }
      impl_->bufL[wp] = wL;
      impl_->bufR[wp] = wR;
    }

    // trigger the next voice every `spacing` samples (voices alternate)
    --phase;
    if (phase <= 0.0f) {
      phase += spacing;
      which ^= 1;
      GrainVoice& v = impl_->voices[which];
      float jitter_off = 0.0f;
      if (impl_->jitter > 0.001f) {
        jitter_off = std::sin(wp * 0.001f + phase * 0.1f) * impl_->jitter * grain_samps * 0.5f;
      }
      v.drift = 0.0f;
      v.jitter = jitter_off;
      v.age = 0;
    }

    // sum the two voices: each reads the tap (tracking the write head) at
    // pitch_factor samples per sample
    float sAL = 0, sAR = 0, sBL = 0, sBR = 0;
    float wA = 0, wB = 0;
    const float tap = static_cast<float>(wp) - delay_samps;
    for (int v = 0; v < 2; ++v) {
      GrainVoice& gv = impl_->voices[v];
      const float window = gv.Window(grain_samps);
      if (window > 0.0f) {
        const float read_pos = tap + gv.jitter + gv.drift;
        if (v == 0) {
          sAL = internal::ReadLagrange3(impl_->bufL, read_pos);
          sAR = internal::ReadLagrange3(impl_->bufR, read_pos);
          wA = window;
        } else {
          sBL = internal::ReadLagrange3(impl_->bufL, read_pos);
          sBR = internal::ReadLagrange3(impl_->bufR, read_pos);
          wB = window;
        }
      }
      gv.drift += pitch_factor - 1.0f;
      gv.age += 1.0f;
    }
    // window-normalised crossfade: pitch=0 reads the tap at unity gain
    // (a clean delay), pitch != 0 resamples it for a real ±12 st shift.
    const float denom = std::max(wA + wB, 0.01f);
    float outL = (sAL * wA + sBL * wB) / denom;
    float outR = (sAR * wA + sBR * wB) / denom;

    // stereo spread: blend center vs wide (symmetric cross-feed on the
    // pre-update mid values - the original code reused the just-updated outL
    // in outR, which double-applied the pan term)
    const float pan = spread;
    const float midL = outL * (1.0f - pan * 0.3f);
    const float midR = outR * (1.0f - pan * 0.3f);
    outL = midL + midR * pan * 0.2f;
    outR = midR + midL * pan * 0.2f;

    output[0][i] = outL;
    output[1][i] = outR;
    // store feedback source for next write
    impl_->fb_l = outL;
    impl_->fb_r = outR;

    wp = (wp + 1) % size;
  }
  impl_->write_pos = wp;
  impl_->phase = phase;
  impl_->which = which;
}

int GranularDelay::ParamCount() { return kParamCount; }
const GranularDelay::ParamInfo& GranularDelay::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}
float GranularDelay::GetParam(int index) const {
  switch (index) {
    case kTimeParam: return impl_->time_ms;
    case kGrainSizeParam: return impl_->grain_size_ms;
    case kDensityParam: return impl_->density;
    case kPitchParam: return impl_->pitch;
    case kJitterParam: return impl_->jitter;
    case kFeedbackParam: return impl_->feedback;
    case kSpreadParam: return impl_->spread;
    case kCharacterParam: return impl_->character;
    case kFreezeParam: return impl_->freeze;
    default: return 0;
  }
}
void GranularDelay::SetParam(int index, float value) {
  switch (index) {
    case kTimeParam: impl_->time_ms = std::clamp(value, 10.0f, 2000.0f); break;
    case kGrainSizeParam: impl_->grain_size_ms = std::clamp(value, 10.0f, 500.0f); break;
    case kDensityParam: impl_->density = std::clamp(value, 1.0f, 50.0f); break;
    case kPitchParam: impl_->pitch = std::clamp(value, -12.0f, 12.0f); break;
    case kJitterParam: impl_->jitter = std::clamp(value, 0.0f, 1.0f); break;
    case kFeedbackParam: impl_->feedback = std::clamp(value, 0.0f, 0.9f); break;
    case kSpreadParam: impl_->spread = std::clamp(value, 0.0f, 1.0f); break;
    case kCharacterParam: impl_->character = std::clamp(value, 0.0f, 1.0f); break;
    case kFreezeParam: impl_->freeze = value >= 0.5f ? 1.0f : 0.0f; break;
    default: break;
  }
}

} // namespace openaxe::dsp