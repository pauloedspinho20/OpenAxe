#include "openaxe/dsp/rotary.h"

#include <algorithm>
#include <cmath>
#include <vector>

#include "internal/biquad.h"

namespace openaxe::dsp {

namespace {
constexpr int kSpeedParam = 0;
constexpr int kDriveParam = 1;
constexpr int kHornLevelParam = 2;
constexpr int kDrumLevelParam = 3;
constexpr int kMicDistParam = 4;
constexpr int kCrossoverParam = 5;
constexpr int kParamCount = 6;
const Rotary::ParamInfo kParamInfo[kParamCount] = {
#include "generated/rotary_params.inc"
};

// Spin-up time constant for the horn/drum speed ramps. A one-pole with
// tau = 0.5 s reaches ~86% of the target in 1 s and ~95% in 1.5 s - the
// Leslie "slow start" the PR describes, not a per-sample 0.002 step that
// converges in ~50 ms.
constexpr float kSpinUpTauS = 0.5f;
// Cabinet-colour one-pole cutoff (the "wood" body EQ from the spec).
constexpr float kColorCutoffHz = 250.0f;
constexpr float kColorBoost = 0.12f;

} // namespace

struct Rotary::Impl {
  float speed = 1; // 0 stop, 1 chorale, 2 tremolo
  float drive = 0.2f;
  float horn_level = 0.7f;
  float drum_level = 0.7f;
  float mic_distance = 0.3f;
  float crossover = 800;
  float sr = 48000;
  internal::Biquad lp[2], hp[2];
  // delay lines for doppler: horn faster, drum slower
  std::vector<float> horn_buf[2], drum_buf[2];
  int horn_wp = 0, drum_wp = 0, horn_size = 0, drum_size = 0;
  float horn_phase = 0, drum_phase = 0;
  float cur_horn_speed = 0, cur_drum_speed = 0; // ramped
  float mic_lp[2] = {0, 0};                     // mic-distance one-pole state
  float color_lp[2] = {0, 0};                   // cabinet-colour one-pole state

  void Resize(float s) {
    sr = s;
    int hs = int(s * 0.04f) + 512; // 40ms max
    int ds = int(s * 0.04f) + 512;
    for (int ch = 0; ch < 2; ++ch) {
      horn_buf[ch].assign(static_cast<size_t>(hs), 0);
      drum_buf[ch].assign(static_cast<size_t>(ds), 0);
    }
    horn_size = hs;
    drum_size = ds;
    horn_wp = drum_wp = 0;
    horn_phase = drum_phase = 0;
    cur_horn_speed = cur_drum_speed = 0;
    mic_lp[0] = mic_lp[1] = 0;
    color_lp[0] = color_lp[1] = 0;
    for (int ch = 0; ch < 2; ++ch) {
      lp[ch].Reset();
      hp[ch].Reset();
    }
  }
  float ReadLinear(const std::vector<float>& b, float pos, int size) const {
    int i0 = (int)std::floor(pos);
    float frac = pos - (float)i0;
    while (i0 < 0) i0 += size;
    i0 %= size;
    int i1 = (i0 + 1) % size;
    return b[i0] * (1 - frac) + b[i1] * frac;
  }
};

Rotary::Rotary() : impl_(std::make_unique<Impl>()) { impl_->Resize(48000); }
Rotary::~Rotary() = default;

void Rotary::Reset(double sample_rate) { impl_->Resize(static_cast<float>(sample_rate)); }

void Rotary::Process(const float* const* input, float* const* output, int num_frames) {
  const float sr = impl_->sr;
  const int speed = static_cast<int>(impl_->speed);
  const float drive = impl_->drive;
  const float horn_level = impl_->horn_level;
  const float drum_level = impl_->drum_level;
  const float mic = impl_->mic_distance;
  const float xo = impl_->crossover;

  // target rates per speed (Hz): horn vs drum
  float target_horn = 0, target_drum = 0;
  if (speed == 0) {
    target_horn = 0;
    target_drum = 0;
  } else if (speed == 1) {
    target_horn = 0.8f;
    target_drum = 0.7f; // chorale slow
  } else {
    target_horn = 6.8f;
    target_drum = 5.4f; // tremolo fast
  }

  // acceleration ramp ~1s: one-pole toward the target, coefficient computed
  // once per block (constant within it)
  const float k = 1.0f - std::exp(-1.0f / (kSpinUpTauS * sr));
  const float mic_cutoff = 8000.0f - mic * 6000.0f;
  const float mic_coeff = 1.0f - std::exp(-6.28318530718f * mic_cutoff / sr);
  const float color_coeff = 1.0f - std::exp(-6.28318530718f * kColorCutoffHz / sr);

  // LR2 crossover (Q = 0.5): flat sum, -6 dB at the crossover point
  for (int ch = 0; ch < 2; ++ch) {
    impl_->lp[ch].SetLowpass(xo, 0.5f, sr);
    impl_->hp[ch].SetHighpass(xo, 0.5f, sr);
  }

  for (int i = 0; i < num_frames; ++i) {
    // ramp speeds
    impl_->cur_horn_speed += k * (target_horn - impl_->cur_horn_speed);
    impl_->cur_drum_speed += k * (target_drum - impl_->cur_drum_speed);

    float inL = input[0][i];
    float inR = input[1][i];
    // drive saturation pre - continuous normaliser (no jump at g=2)
    if (drive > 0.001f) {
      const float g = 1 + drive * 3;
      const float norm = (g + 1.0f) * 0.5f; // 1 at g=1, 2.5 at g=4, smooth vs max(1,g*0.5)
      inL = std::tanh(inL * g) / norm;
      inR = std::tanh(inR * g) / norm;
    }

    // crossover split
    const float lowL = impl_->lp[0].Process(inL);
    const float lowR = impl_->lp[1].Process(inR);
    const float highL = impl_->hp[0].Process(inL);
    const float highR = impl_->hp[1].Process(inR);

    // Doppler via modulated delay: horn and drum each have delay line 5-15ms
    // modulated by sinusoid
    impl_->horn_buf[0][impl_->horn_wp] = highL;
    impl_->horn_buf[1][impl_->horn_wp] = highR;
    impl_->drum_buf[0][impl_->drum_wp] = lowL;
    impl_->drum_buf[1][impl_->drum_wp] = lowR;

    const float horn_depth_ms = 2.5f; // horn shallower
    const float drum_depth_ms = 4.0f;
    const float horn_base_ms = 6.0f;
    const float drum_base_ms = 8.0f;

    const float horn_lfo = std::sin(impl_->horn_phase);
    const float drum_lfo = std::sin(impl_->drum_phase);

    impl_->horn_phase += 6.28318530718f * impl_->cur_horn_speed / sr;
    impl_->drum_phase += 6.28318530718f * impl_->cur_drum_speed / sr;
    if (impl_->horn_phase >= 6.28318530718f) impl_->horn_phase -= 6.28318530718f;
    if (impl_->drum_phase >= 6.28318530718f) impl_->drum_phase -= 6.28318530718f;

    const float horn_samps =
        (horn_base_ms + horn_lfo * horn_depth_ms * 0.5f) * sr / 1000.0f;
    const float drum_samps =
        (drum_base_ms + drum_lfo * drum_depth_ms * 0.5f) * sr / 1000.0f;

    const float hrp = (float)impl_->horn_wp - horn_samps;
    const float drp = (float)impl_->drum_wp - drum_samps;
    const float horn_outL = impl_->ReadLinear(impl_->horn_buf[0], hrp, impl_->horn_size);
    const float horn_outR = impl_->ReadLinear(impl_->horn_buf[1], hrp, impl_->horn_size);
    const float drum_outL = impl_->ReadLinear(impl_->drum_buf[0], drp, impl_->drum_size);
    const float drum_outR = impl_->ReadLinear(impl_->drum_buf[1], drp, impl_->drum_size);

    // tremolo amplitude modulation also (horn/drum rotate produces AM)
    const float horn_ampL = 1.0f + horn_lfo * 0.25f;
    const float horn_ampR = 1.0f - horn_lfo * 0.25f;
    const float drum_ampL = 1.0f + drum_lfo * 0.2f;
    const float drum_ampR = 1.0f - drum_lfo * 0.2f;

    float outL = horn_outL * horn_ampL * horn_level + drum_outL * drum_ampL * drum_level;
    float outR = horn_outR * horn_ampR * horn_level + drum_outR * drum_ampR * drum_level;

    // mic distance: far = darker (one-pole lowpass, coeff computed per block)
    impl_->mic_lp[0] += mic_coeff * (outL - impl_->mic_lp[0]);
    impl_->mic_lp[1] += mic_coeff * (outR - impl_->mic_lp[1]);
    outL = impl_->mic_lp[0];
    outR = impl_->mic_lp[1];

    // width narrowing: mic 0 = wide, 1 = mono
    const float width = 1.0f - mic * 0.5f;
    const float mid = (outL + outR) * 0.5f;
    outL = mid + (outL - mid) * width;
    outR = mid + (outR - mid) * width;

    // wood cabinet colour: subtle low-mid body boost
    impl_->color_lp[0] += color_coeff * (outL - impl_->color_lp[0]);
    impl_->color_lp[1] += color_coeff * (outR - impl_->color_lp[1]);
    outL += kColorBoost * impl_->color_lp[0];
    outR += kColorBoost * impl_->color_lp[1];

    output[0][i] = outL;
    output[1][i] = outR;

    impl_->horn_wp = (impl_->horn_wp + 1) % impl_->horn_size;
    impl_->drum_wp = (impl_->drum_wp + 1) % impl_->drum_size;
  }
}

int Rotary::ParamCount() { return kParamCount; }
const Rotary::ParamInfo& Rotary::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}
float Rotary::GetParam(int index) const {
  switch (index) {
    case kSpeedParam: return impl_->speed;
    case kDriveParam: return impl_->drive;
    case kHornLevelParam: return impl_->horn_level;
    case kDrumLevelParam: return impl_->drum_level;
    case kMicDistParam: return impl_->mic_distance;
    case kCrossoverParam: return impl_->crossover;
    default: return 0;
  }
}
void Rotary::SetParam(int index, float value) {
  switch (index) {
    case kSpeedParam: impl_->speed = std::clamp(std::round(value), 0.0f, 2.0f); break;
    case kDriveParam: impl_->drive = std::clamp(value, 0.0f, 1.0f); break;
    case kHornLevelParam: impl_->horn_level = std::clamp(value, 0.0f, 1.0f); break;
    case kDrumLevelParam: impl_->drum_level = std::clamp(value, 0.0f, 1.0f); break;
    case kMicDistParam: impl_->mic_distance = std::clamp(value, 0.0f, 1.0f); break;
    case kCrossoverParam: impl_->crossover = std::clamp(value, 400.0f, 1200.0f); break;
    default: break;
  }
}

} // namespace openaxe::dsp