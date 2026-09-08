#include "openaxe/dsp/dragonfly_plate_reverb.h"

// Permissive-licensed clean-room plate reverb (issue #372).
//
// Same replacement story as dragonfly_hall_reverb.cpp: no Dragonfly/DPF/
// freeverb3 code remains, the 9-parameter surface is unchanged. Voiced
// bright and dense like a steel plate: short incommensurate combs with
// strong high-frequency damping (`high_cut` + `early_damp`), an input
// low-cut, and the `algorithm` voicing switch (0 = steel/bright,
// 1 = warm, 2 = dark/tape-ish). `early_level` is the wet level.

#include <algorithm>
#include <array>
#include <cmath>
#include <memory>
#include <vector>

#include "openaxe/dsp/dragonfly_plate_reverb.h"

#include "internal/variable_delay.h"

namespace openaxe {
namespace dsp {
namespace {

constexpr int kParamCount = 9;

constexpr int kDryLevel = 0;
constexpr int kEarlyLevel = 1;  // wet level
constexpr int kAlgorithm = 2;
constexpr int kWidth = 3;
constexpr int kPredelay = 4;
constexpr int kDecay = 5;
constexpr int kLowCut = 6;
constexpr int kHighCut = 7;
constexpr int kEarlyDamp = 8;

const DragonflyPlateReverb::ParamInfo kParamInfo[kParamCount] = {
#include "generated/dragonfly_plate_reverb_params.inc"
};

constexpr int kCombs = 4;
constexpr int kAllpasses = 3;

constexpr float kCombMs[kCombs] = {18.5f, 23.2f, 27.9f, 32.4f};
constexpr float kAllpassMs[kAllpasses] = {4.2f, 2.3f, 1.1f};

constexpr float kMaxCombMs = 120.0f;
constexpr float kMaxAllpassMs = 60.0f;
constexpr float kMaxPredelayMs = 100.0f;
constexpr float kDenormalFloor = 1e-20f;

inline float FlushDenormal(float v) { return std::fabs(v) < kDenormalFloor ? 0.0f : v; }

struct Comb {
  internal::VariableDelay line;
  float damp = 0.0f;
  void Prepare(float sr) { line.Prepare(sr, kMaxCombMs); }
  void Clear() {
    line.Reset();
    damp = 0.0f;
  }
};

struct Allpass {
  internal::VariableDelay line;
  void Prepare(float sr) { line.Prepare(sr, kMaxAllpassMs); }
  void Clear() { line.Reset(); }
};

}  // namespace

struct DragonflyPlateReverb::Impl {
  float dry = 80.0f, wet = 65.0f, algorithm = 0.0f;
  float width = 100.0f, predelay = 10.0f, decay = 2.0f;
  float low_cut = 0.0f, high_cut = 10000.0f, early_damp = 8000.0f;

  float sr = 48000.0f;
  std::array<internal::VariableDelay, 2> predelay_line;
  std::array<std::array<Comb, kCombs>, 2> combs;
  std::array<std::array<Allpass, kAllpasses>, 2> allpasses;
  float hp[2] = {0.0f, 0.0f};
  float smooth_fb[kCombs] = {0.0f, 0.0f, 0.0f, 0.0f};
  float smooth_damp = 0.0f;

  void Resize(float sample_rate) {
    sr = sample_rate;
    for (auto& p : predelay_line) p.Prepare(sample_rate, kMaxPredelayMs);
    for (auto& ch : combs)
      for (auto& c : ch) c.Prepare(sample_rate);
    for (auto& ch : allpasses)
      for (auto& a : ch) a.Prepare(sample_rate);
    Silence();
  }

  void Silence() {
    for (auto& p : predelay_line) p.Reset();
    for (auto& ch : combs)
      for (auto& c : ch) c.Clear();
    for (auto& ch : allpasses)
      for (auto& a : ch) a.Clear();
    hp[0] = hp[1] = 0.0f;
    for (int i = 0; i < kCombs; ++i) smooth_fb[i] = 0.0f;
    smooth_damp = 0.0f;
  }
};

DragonflyPlateReverb::DragonflyPlateReverb() : impl_(std::make_unique<Impl>()) {
  impl_->Resize(48000.0f);
}

DragonflyPlateReverb::~DragonflyPlateReverb() = default;

void DragonflyPlateReverb::Reset(double sample_rate) {
  impl_->Resize(static_cast<float>(sample_rate));
}

void DragonflyPlateReverb::Mute() { impl_->Silence(); }

void DragonflyPlateReverb::Process(const float* const* input, float* const* output,
                                   int num_frames) {
  if (num_frames <= 0) return;
  Impl& st = *impl_;
  const float sr = st.sr;

  const float dry_g = std::clamp(st.dry, 0.0f, 100.0f) / 100.0f;
  const float wet_g = std::clamp(st.wet, 0.0f, 100.0f) / 100.0f;
  const int algo = static_cast<int>(std::clamp(st.algorithm, 0.0f, 2.0f) + 0.5f);
  const float width = std::clamp(st.width, 50.0f, 150.0f) / 100.0f;
  const float predelay_samps = std::clamp(st.predelay, 0.0f, 100.0f) * sr / 1000.0f;
  const float decay = std::max(st.decay, 0.1f);
  // Voicing: steel keeps the air, warm pulls the top down, dark tapes it off.
  const float voice_damp = algo == 0 ? 1.0f : (algo == 1 ? 0.7f : 0.45f);
  const float voice_diff = algo == 0 ? 0.75f : (algo == 1 ? 0.65f : 0.55f);
  const float damp_cut = std::clamp(
      std::min(st.high_cut, st.early_damp) * voice_damp, 1000.0f, 16000.0f);
  const float damp_t = 1.0f - std::exp(-6.28318530718f * damp_cut / sr);
  const float hp_t = st.low_cut > 1.0f
                         ? 1.0f - std::exp(-6.28318530718f * std::clamp(st.low_cut, 0.0f, 200.0f) / sr)
                         : 0.0f;
  const float smooth_a = 1.0f - std::exp(-1.0f / (0.025f * sr));

  float comb_base[kCombs];
  float fb_target[kCombs];
  for (int i = 0; i < kCombs; ++i) {
    const float t = kCombMs[i] / 1000.0f;
    comb_base[i] = kCombMs[i] * sr / 1000.0f;
    fb_target[i] = std::pow(10.0f, -3.0f * t / decay);
  }
  for (int n = 0; n < num_frames; ++n) {
    float wet_ch[2] = {0.0f, 0.0f};
    for (int ch = 0; ch < 2; ++ch) {
      float x = input[ch][n];
      if (hp_t > 0.0f) {
        st.hp[ch] = FlushDenormal(st.hp[ch] + hp_t * (x - st.hp[ch]));
        x -= st.hp[ch];
      }
      st.predelay_line[ch].Write(x);
      const float delayed = predelay_samps > 1.0f ? st.predelay_line[ch].ReadSamples(predelay_samps) : x;

      float late = 0.0f;
      // The right channel's combs run 2% long so a mono source still blooms
      // into stereo (without it both channels are bit-identical and `width`
      // has nothing to act on).
      const float stretch = ch == 0 ? 1.0f : 1.02f;
      for (int i = 0; i < kCombs; ++i) {
        st.smooth_fb[i] += smooth_a * (fb_target[i] - st.smooth_fb[i]);
        Comb& c = st.combs[ch][i];
        const float tap = c.line.ReadSamples(std::max(comb_base[i] * stretch, 4.0f));
        st.smooth_damp += smooth_a * (damp_t - st.smooth_damp);
        c.damp = FlushDenormal(c.damp + st.smooth_damp * (tap - c.damp));
        c.line.Write(delayed + st.smooth_fb[i] * c.damp);
        late += c.damp;
      }
      late *= 0.25f;
      for (int a = 0; a < kAllpasses; ++a) {
        Allpass& ap = st.allpasses[ch][a];
        const float d = kAllpassMs[a] * sr / 1000.0f;
        const float tap = ap.line.ReadSamples(std::max(d, 4.0f));
        const float y = -voice_diff * late + tap;
        ap.line.Write(late + voice_diff * y);
        late = y;
      }
      wet_ch[ch] = late;
    }
    const float mid = 0.5f * (wet_ch[0] + wet_ch[1]);
    const float side = 0.5f * (wet_ch[0] - wet_ch[1]) * width;
    output[0][n] = dry_g * input[0][n] + wet_g * (mid + side);
    output[1][n] = dry_g * input[1][n] + wet_g * (mid - side);
  }
}

int DragonflyPlateReverb::ParamCount() { return kParamCount; }

const DragonflyPlateReverb::ParamInfo& DragonflyPlateReverb::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}

float DragonflyPlateReverb::GetParam(int index) const {
  const Impl& st = *impl_;
  switch (index) {
    case kDryLevel: return st.dry;
    case kEarlyLevel: return st.wet;
    case kAlgorithm: return st.algorithm;
    case kWidth: return st.width;
    case kPredelay: return st.predelay;
    case kDecay: return st.decay;
    case kLowCut: return st.low_cut;
    case kHighCut: return st.high_cut;
    case kEarlyDamp: return st.early_damp;
    default: return 0.0f;
  }
}

void DragonflyPlateReverb::SetParam(int index, float value) {
  Impl& st = *impl_;
  switch (index) {
    case kDryLevel: st.dry = std::clamp(value, 0.0f, 100.0f); break;
    case kEarlyLevel: st.wet = std::clamp(value, 0.0f, 100.0f); break;
    case kAlgorithm: st.algorithm = std::clamp(value, 0.0f, 2.0f); break;
    case kWidth: st.width = std::clamp(value, 50.0f, 150.0f); break;
    case kPredelay: st.predelay = std::clamp(value, 0.0f, 100.0f); break;
    case kDecay: st.decay = std::clamp(value, 0.1f, 10.0f); break;
    case kLowCut: st.low_cut = std::clamp(value, 0.0f, 200.0f); break;
    case kHighCut: st.high_cut = std::clamp(value, 1000.0f, 16000.0f); break;
    case kEarlyDamp: st.early_damp = std::clamp(value, 1000.0f, 16000.0f); break;
    default: break;
  }
}

}  // namespace dsp
}  // namespace openaxe
