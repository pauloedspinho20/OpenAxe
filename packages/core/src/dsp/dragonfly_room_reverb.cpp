#include "openaxe/dsp/dragonfly_room_reverb.h"

// Permissive-licensed clean-room room reverb (issue #372).
//
// Same replacement story as dragonfly_hall_reverb.cpp (which documents the
// topology and the RT contract): no Dragonfly/DPF/freeverb3 code remains,
// the 17-parameter surface is unchanged, only the tail character changes.
// Voiced smaller and drier than the hall: shorter incommensurate combs
// (scaled by `size` 8-32 m), a tighter allpass pair (`diffuse`), input
// high/low cuts, separate early/late damping, and a low-frequency boost
// around `boost_freq`. `wander` here is 0-100 % (per the schema), mapped to
// a millisecond excursion.

#include <algorithm>
#include <array>
#include <cmath>
#include <memory>
#include <vector>

#include "openaxe/dsp/dragonfly_room_reverb.h"

#include "internal/variable_delay.h"

namespace openaxe {
namespace dsp {
namespace {

constexpr int kParamCount = 17;

constexpr int kDryLevel = 0;
constexpr int kEarlyLevel = 1;
constexpr int kEarlySend = 2;
constexpr int kLateLevel = 3;
constexpr int kSize = 4;
constexpr int kWidth = 5;
constexpr int kPredelay = 6;
constexpr int kDecay = 7;
constexpr int kDiffuse = 8;
constexpr int kSpin = 9;
constexpr int kWander = 10;  // % (unlike the hall's ms)
constexpr int kInHighCut = 11;
constexpr int kEarlyDamp = 12;
constexpr int kLateDamp = 13;
constexpr int kLowBoost = 14;
constexpr int kBoostFreq = 15;
constexpr int kInLowCut = 16;

const DragonflyRoomReverb::ParamInfo kParamInfo[kParamCount] = {
#include "generated/dragonfly_room_reverb_params.inc"
};

constexpr int kCombs = 4;
constexpr int kAllpasses = 2;
constexpr int kErTaps = 4;

constexpr float kCombMs[kCombs] = {14.2f, 17.8f, 21.4f, 25.9f};
constexpr float kAllpassMs[kAllpasses] = {3.1f, 1.1f};
constexpr float kErMs[kErTaps] = {2.8f, 6.4f, 11.2f, 17.5f};

constexpr float kMaxCombMs = 90.0f;
constexpr float kMaxAllpassMs = 50.0f;
constexpr float kMaxPredelayMs = 100.0f;
constexpr float kMaxErMs = 120.0f;
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

struct DragonflyRoomReverb::Impl {
  float dry = 80.0f, early = 55.0f, early_send = 50.0f, late = 60.0f;
  float size = 16.0f, width = 100.0f, predelay = 0.0f, decay = 1.2f, diffuse = 60.0f;
  float spin = 0.4f, wander = 20.0f;
  float in_high_cut = 8000.0f, early_damp = 8000.0f, late_damp = 6000.0f;
  float low_boost = 0.0f, boost_freq = 200.0f, in_low_cut = 0.0f;

  float sr = 48000.0f;
  std::array<internal::VariableDelay, 2> predelay_line;
  std::array<std::array<Comb, kCombs>, 2> combs;
  std::array<std::array<Allpass, kAllpasses>, 2> allpasses;
  std::array<std::array<internal::VariableDelay, kErTaps>, 2> er;
  float in_lp[2] = {0.0f, 0.0f};
  float in_hp[2] = {0.0f, 0.0f};
  float er_lp[2] = {0.0f, 0.0f};
  float boost[2] = {0.0f, 0.0f};
  float lfo[2] = {0.0f, 0.25f};
  float smooth_fb[kCombs] = {0.0f, 0.0f, 0.0f, 0.0f};
  float smooth_damp = 0.0f;

  void Resize(float sample_rate) {
    sr = sample_rate;
    for (auto& p : predelay_line) p.Prepare(sample_rate, kMaxPredelayMs);
    for (auto& ch : combs)
      for (auto& c : ch) c.Prepare(sample_rate);
    for (auto& ch : allpasses)
      for (auto& a : ch) a.Prepare(sample_rate);
    for (auto& ch : er)
      for (auto& t : ch) t.Prepare(sample_rate, kMaxErMs);
    Silence();
  }

  void Silence() {
    for (auto& p : predelay_line) p.Reset();
    for (auto& ch : combs)
      for (auto& c : ch) c.Clear();
    for (auto& ch : allpasses)
      for (auto& a : ch) a.Clear();
    for (auto& ch : er)
      for (auto& t : ch) t.Reset();
    in_lp[0] = in_lp[1] = in_hp[0] = in_hp[1] = 0.0f;
    er_lp[0] = er_lp[1] = boost[0] = boost[1] = 0.0f;
    lfo[0] = 0.0f;
    lfo[1] = 0.25f;
    for (int i = 0; i < kCombs; ++i) smooth_fb[i] = 0.0f;
    smooth_damp = 0.0f;
  }
};

DragonflyRoomReverb::DragonflyRoomReverb() : impl_(std::make_unique<Impl>()) {
  impl_->Resize(48000.0f);
}

DragonflyRoomReverb::~DragonflyRoomReverb() = default;

void DragonflyRoomReverb::Reset(double sample_rate) {
  impl_->Resize(static_cast<float>(sample_rate));
}

void DragonflyRoomReverb::Mute() { impl_->Silence(); }

void DragonflyRoomReverb::Process(const float* const* input, float* const* output,
                                  int num_frames) {
  if (num_frames <= 0) return;
  Impl& st = *impl_;
  const float sr = st.sr;

  const float dry_g = std::clamp(st.dry, 0.0f, 100.0f) / 100.0f;
  const float early_g = std::clamp(st.early, 0.0f, 100.0f) / 100.0f;
  const float send = std::clamp(st.early_send, 0.0f, 100.0f) / 100.0f;
  const float late_g = std::clamp(st.late, 0.0f, 100.0f) / 100.0f;
  const float size_scale = std::clamp(st.size, 8.0f, 32.0f) / 16.0f;
  const float width = std::clamp(st.width, 50.0f, 150.0f) / 100.0f;
  const float predelay_samps = std::clamp(st.predelay, 0.0f, 100.0f) * sr / 1000.0f;
  const float decay = std::max(st.decay, 0.1f);
  const float allpass_g = 0.3f + 0.5f * (std::clamp(st.diffuse, 0.0f, 100.0f) / 100.0f);
  const float spin = std::clamp(st.spin, 0.0f, 5.0f);
  const float wander_samps =
      std::clamp(st.wander, 0.0f, 100.0f) / 100.0f * 6.0f * sr / 1000.0f;
  const float in_lp_t =
      1.0f - std::exp(-6.28318530718f * std::clamp(st.in_high_cut, 1000.0f, 16000.0f) / sr);
  const float er_lp_t =
      1.0f - std::exp(-6.28318530718f * std::clamp(st.early_damp, 1000.0f, 16000.0f) / sr);
  const float late_lp_t =
      1.0f - std::exp(-6.28318530718f * std::clamp(st.late_damp, 1000.0f, 16000.0f) / sr);
  const float in_hp_t = st.in_low_cut > 1.0f
                            ? 1.0f - std::exp(-6.28318530718f * std::clamp(st.in_low_cut, 0.0f, 200.0f) / sr)
                            : 0.0f;
  const float boost_t =
      1.0f - std::exp(-6.28318530718f * std::clamp(st.boost_freq, 50.0f, 1050.0f) / sr);
  const float boost_g = std::clamp(st.low_boost, 0.0f, 100.0f) / 100.0f;
  const float smooth_a = 1.0f - std::exp(-1.0f / (0.025f * sr));

  float comb_base[kCombs];
  float fb_target[kCombs];
  for (int i = 0; i < kCombs; ++i) {
    const float t = kCombMs[i] * size_scale / 1000.0f;
    comb_base[i] = kCombMs[i] * size_scale * sr / 1000.0f;
    fb_target[i] = std::pow(10.0f, -3.0f * t / decay);
  }
  float allpass_base[kAllpasses];
  for (int a = 0; a < kAllpasses; ++a) {
    allpass_base[a] = kAllpassMs[a] * (0.7f + 0.6f * size_scale) * sr / 1000.0f;
  }

  for (int n = 0; n < num_frames; ++n) {
    float wet_ch[2] = {0.0f, 0.0f};
    for (int ch = 0; ch < 2; ++ch) {
      float x = input[ch][n];
      st.in_lp[ch] = FlushDenormal(st.in_lp[ch] + in_lp_t * (x - st.in_lp[ch]));
      x = st.in_lp[ch];
      if (in_hp_t > 0.0f) {
        st.in_hp[ch] = FlushDenormal(st.in_hp[ch] + in_hp_t * (x - st.in_hp[ch]));
        x -= st.in_hp[ch];
      }
      st.predelay_line[ch].Write(x);
      const float delayed = predelay_samps > 1.0f ? st.predelay_line[ch].ReadSamples(predelay_samps) : x;

      float er_out = 0.0f;
      for (int t = 0; t < kErTaps; ++t) {
        st.er[ch][t].Write(delayed);
        er_out += st.er[ch][t].ReadSamples(kErMs[t] * size_scale * sr / 1000.0f) *
                  ((t % 2 == 0) ? 0.6f : -0.4f);
      }
      er_out *= 0.3f;
      st.er_lp[ch] = FlushDenormal(st.er_lp[ch] + er_lp_t * (er_out - st.er_lp[ch]));

      st.lfo[ch] += spin / sr;
      if (st.lfo[ch] >= 1.0f) st.lfo[ch] -= 1.0f;
      const float lfo_v = std::sin(6.28318530718f * st.lfo[ch]);
      float late = 0.0f;
      const float late_in = delayed + send * st.er_lp[ch];
      for (int i = 0; i < kCombs; ++i) {
        st.smooth_fb[i] += smooth_a * (fb_target[i] - st.smooth_fb[i]);
        Comb& c = st.combs[ch][i];
        const float tap = c.line.ReadSamples(comb_base[i]);
        st.smooth_damp += smooth_a * (late_lp_t - st.smooth_damp);
        c.damp = FlushDenormal(c.damp + st.smooth_damp * (tap - c.damp));
        c.line.Write(late_in + st.smooth_fb[i] * c.damp);
        late += c.damp;
      }
      late *= 0.25f;
      st.boost[ch] = FlushDenormal(st.boost[ch] + boost_t * (late - st.boost[ch]));
      late += boost_g * st.boost[ch];
      // spin/wander wobble the diffusing allpasses, not the resonant combs:
      // an allpass's flat magnitude response and much lower feedback gain
      // (allpass_g, well below the combs' near-unity RT60 gain) means the
      // same excursion reads as diffusion/movement instead of a Doppler
      // pitch-bend that the comb feedback loop would reinforce every pass.
      for (int a = 0; a < kAllpasses; ++a) {
        Allpass& ap = st.allpasses[ch][a];
        const float d = allpass_base[a];
        const float wob = std::min(wander_samps * (0.3f + 0.7f * (a & 1)), d * 0.05f) * lfo_v;
        const float tap = ap.line.ReadSamples(std::max(d + wob, 4.0f));
        const float y = -allpass_g * late + tap;
        ap.line.Write(late + allpass_g * y);
        late = y;
      }
      wet_ch[ch] = early_g * st.er_lp[ch] + late_g * late;
    }
    const float mid = 0.5f * (wet_ch[0] + wet_ch[1]);
    const float side = 0.5f * (wet_ch[0] - wet_ch[1]) * width;
    output[0][n] = dry_g * input[0][n] + mid + side;
    output[1][n] = dry_g * input[1][n] + mid - side;
  }
}

int DragonflyRoomReverb::ParamCount() { return kParamCount; }

const DragonflyRoomReverb::ParamInfo& DragonflyRoomReverb::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}

float DragonflyRoomReverb::GetParam(int index) const {
  const Impl& st = *impl_;
  switch (index) {
    case kDryLevel: return st.dry;
    case kEarlyLevel: return st.early;
    case kEarlySend: return st.early_send;
    case kLateLevel: return st.late;
    case kSize: return st.size;
    case kWidth: return st.width;
    case kPredelay: return st.predelay;
    case kDecay: return st.decay;
    case kDiffuse: return st.diffuse;
    case kSpin: return st.spin;
    case kWander: return st.wander;
    case kInHighCut: return st.in_high_cut;
    case kEarlyDamp: return st.early_damp;
    case kLateDamp: return st.late_damp;
    case kLowBoost: return st.low_boost;
    case kBoostFreq: return st.boost_freq;
    case kInLowCut: return st.in_low_cut;
    default: return 0.0f;
  }
}

void DragonflyRoomReverb::SetParam(int index, float value) {
  Impl& st = *impl_;
  switch (index) {
    case kDryLevel: st.dry = std::clamp(value, 0.0f, 100.0f); break;
    case kEarlyLevel: st.early = std::clamp(value, 0.0f, 100.0f); break;
    case kEarlySend: st.early_send = std::clamp(value, 0.0f, 100.0f); break;
    case kLateLevel: st.late = std::clamp(value, 0.0f, 100.0f); break;
    case kSize: st.size = std::clamp(value, 8.0f, 32.0f); break;
    case kWidth: st.width = std::clamp(value, 50.0f, 150.0f); break;
    case kPredelay: st.predelay = std::clamp(value, 0.0f, 100.0f); break;
    case kDecay: st.decay = std::clamp(value, 0.1f, 10.0f); break;
    case kDiffuse: st.diffuse = std::clamp(value, 0.0f, 100.0f); break;
    case kSpin: st.spin = std::clamp(value, 0.0f, 5.0f); break;
    case kWander: st.wander = std::clamp(value, 0.0f, 100.0f); break;
    case kInHighCut: st.in_high_cut = std::clamp(value, 1000.0f, 16000.0f); break;
    case kEarlyDamp: st.early_damp = std::clamp(value, 1000.0f, 16000.0f); break;
    case kLateDamp: st.late_damp = std::clamp(value, 1000.0f, 16000.0f); break;
    case kLowBoost: st.low_boost = std::clamp(value, 0.0f, 100.0f); break;
    case kBoostFreq: st.boost_freq = std::clamp(value, 50.0f, 1050.0f); break;
    case kInLowCut: st.in_low_cut = std::clamp(value, 0.0f, 200.0f); break;
    default: break;
  }
}

}  // namespace dsp
}  // namespace openaxe
