#include "openaxe/dsp/dragonfly_hall_reverb.h"

// Permissive-licensed clean-room hall reverb (issue #372).
//
// This file used to compile Dragonfly Reverb's hall DSP (GPLv3, freeverb3)
// inside an anonymous namespace. It no longer includes, links, or derives
// from any Dragonfly/DPF/freeverb3 source: the algorithm below is
// hand-written for OpenAxe (same license as the rest of packages/core) and
// keeps the identical 18-parameter surface so the engine (`RefreshReverbControlSlots`),
// the web/desktop/plugin bridges, presets, and the plugin automation map see
// zero API change - only the tail character changes (goldens re-blessed).
//
// Topology: input low-cut -> predelay -> early-reflection taps + a modulated
// late field. The late field is 4 parallel damped combs per channel (Moorer
// style, incommensurate times scaled by `size`, RT60 `decay` setting each
// loop gain, `high_cut` + `high_mult`/`high_xo` darkening the feedback path
// and `low_mult`/`low_xo` shelving the lows) feeding 2 series Schroeder
// allpasses (`diffuse` sets their coefficients). `spin`/`wander` wobble the
// comb taps through a per-channel LFO (scaled by `modulation`); `early_send`
// feeds the ER taps into the late field. Output is the DSP's own
// dry/early/late blend, like before.
//
// RT rules: Process() allocates nothing and throws nothing; Reset() is the
// only allocating method; Mute() silences tails without touching params.
// Internal one-pole smoothing on the derived gains matches the old
// "smooths internally" contract, so the schema keeps mode:none and the
// engine applies no double smoothing.

#include <algorithm>
#include <array>
#include <cmath>
#include <memory>
#include <vector>

#include "openaxe/dsp/dragonfly_hall_reverb.h"

#include "internal/variable_delay.h"

namespace openaxe {
namespace dsp {
namespace {

constexpr int kParamCount = 18;

constexpr int kDryLevel = 0;
constexpr int kEarlyLevel = 1;
constexpr int kLateLevel = 2;
constexpr int kSize = 3;
constexpr int kWidth = 4;
constexpr int kPredelay = 5;  // symbol "delay"
constexpr int kDiffuse = 6;
constexpr int kLowCut = 7;
constexpr int kLowXo = 8;
constexpr int kLowMult = 9;
constexpr int kHighCut = 10;
constexpr int kHighXo = 11;
constexpr int kHighMult = 12;
constexpr int kSpin = 13;
constexpr int kWander = 14;
constexpr int kDecay = 15;
constexpr int kEarlySend = 16;
constexpr int kModulation = 17;

const DragonflyHallReverb::ParamInfo kParamInfo[kParamCount] = {
#include "generated/dragonfly_hall_reverb_params.inc"
};

constexpr int kCombs = 4;
constexpr int kAllpasses = 2;
constexpr int kErTaps = 6;

// Comb base times (ms), incommensurate. Scaled by size/30 around these.
constexpr float kCombMs[kCombs] = {29.7f, 37.1f, 41.1f, 43.7f};
constexpr float kAllpassMs[kAllpasses] = {5.0f, 1.7f};
// Early taps (ms) before size scaling.
constexpr float kErMs[kErTaps] = {4.2f, 9.1f, 14.8f, 21.3f, 28.9f, 36.4f};

constexpr float kMaxCombMs = 160.0f;
constexpr float kMaxAllpassMs = 90.0f;
constexpr float kMaxPredelayMs = 100.0f;
constexpr float kMaxErMs = 200.0f;
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

struct DragonflyHallReverb::Impl {
  // Param mirror (schema ranges, musical defaults).
  float dry = 80.0f, early = 60.0f, late = 65.0f;
  float size = 30.0f, width = 100.0f, predelay = 0.0f, diffuse = 65.0f;
  float low_cut = 0.0f, low_xo = 300.0f, low_mult = 1.0f;
  float high_cut = 8000.0f, high_xo = 8000.0f, high_mult = 1.0f;
  float spin = 0.5f, wander = 5.0f, decay = 2.5f, early_send = 50.0f, modulation = 50.0f;

  float sr = 48000.0f;
  std::array<internal::VariableDelay, 2> predelay_line;
  std::array<std::array<Comb, kCombs>, 2> combs;
  std::array<std::array<Allpass, kAllpasses>, 2> allpasses;
  std::array<std::array<internal::VariableDelay, kErTaps>, 2> er;
  // Per-channel input HPF + low-shelf states, LFO phase, smoothed gains.
  float hpf[2] = {0.0f, 0.0f};
  float shelf[2] = {0.0f, 0.0f};
  float lfo[2] = {0.0f, 0.25f};
  float smooth_fb[kCombs] = {0.0f, 0.0f, 0.0f, 0.0f};
  float smooth_damp = 0.0f;
  float smooth_wet = 1.0f;

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
    hpf[0] = hpf[1] = shelf[0] = shelf[1] = 0.0f;
    lfo[0] = 0.0f;
    lfo[1] = 0.25f;
    for (int i = 0; i < kCombs; ++i) smooth_fb[i] = 0.0f;
    smooth_damp = 0.0f;
    smooth_wet = 1.0f;
  }
};

DragonflyHallReverb::DragonflyHallReverb() : impl_(std::make_unique<Impl>()) {
  impl_->Resize(48000.0f);
}

DragonflyHallReverb::~DragonflyHallReverb() = default;

void DragonflyHallReverb::Reset(double sample_rate) {
  impl_->Resize(static_cast<float>(sample_rate));
}

void DragonflyHallReverb::Mute() { impl_->Silence(); }

void DragonflyHallReverb::Process(const float* const* input, float* const* output,
                                  int num_frames) {
  if (num_frames <= 0) return;
  Impl& st = *impl_;
  const float sr = st.sr;

  const float dry_g = std::clamp(st.dry, 0.0f, 100.0f) / 100.0f;
  const float early_g = std::clamp(st.early, 0.0f, 100.0f) / 100.0f;
  const float late_g = std::clamp(st.late, 0.0f, 100.0f) / 100.0f;
  const float size_scale = std::clamp(st.size, 10.0f, 60.0f) / 30.0f;
  const float width = std::clamp(st.width, 50.0f, 150.0f) / 100.0f;
  const float predelay_samps = std::clamp(st.predelay, 0.0f, 100.0f) * sr / 1000.0f;
  const float diffuse = std::clamp(st.diffuse, 0.0f, 100.0f) / 100.0f;
  const float allpass_g = 0.3f + 0.5f * diffuse;
  const float damp_cut =
      std::clamp(st.high_cut * std::clamp(st.high_mult, 0.2f, 1.2f), 1000.0f, 16000.0f);
  const float damp_t = 1.0f - std::exp(-6.28318530718f * damp_cut / sr);
  const float low_t = 1.0f - std::exp(-6.28318530718f * std::clamp(st.low_xo, 200.0f, 1200.0f) / sr);
  const float low_gain = std::clamp(st.low_mult, 0.5f, 2.5f) - 1.0f;
  const float hpf_t = st.low_cut > 1.0f
                          ? 1.0f - std::exp(-6.28318530718f * std::clamp(st.low_cut, 0.0f, 200.0f) / sr)
                          : 0.0f;
  const float spin = std::clamp(st.spin, 0.0f, 10.0f);
  const float wander_samps =
      std::clamp(st.wander, 0.0f, 40.0f) * sr / 1000.0f * (0.2f + 0.8f * std::clamp(st.modulation, 0.0f, 100.0f) / 100.0f);
  const float decay = std::max(st.decay, 0.1f);
  const float send = std::clamp(st.early_send, 0.0f, 100.0f) / 100.0f;
  // Per-sample smoothing rate (~25 ms) for derived gains.
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
      const float in = input[ch][n];
      // Input high-pass (DC/low rumble out of the tank).
      float hp = in;
      if (hpf_t > 0.0f) {
        st.hpf[ch] = FlushDenormal(st.hpf[ch] + hpf_t * (in - st.hpf[ch]));
        hp = in - st.hpf[ch];
      }
      st.predelay_line[ch].Write(hp);
      const float delayed = predelay_samps > 1.0f ? st.predelay_line[ch].ReadSamples(predelay_samps) : hp;

      // Early taps feed both the early out and (via early_send) the late field.
      float er_out = 0.0f;
      for (int t = 0; t < kErTaps; ++t) {
        st.er[ch][t].Write(delayed);
        const float tap = st.er[ch][t].ReadSamples(kErMs[t] * size_scale * sr / 1000.0f);
        er_out += tap * ((t % 2 == 0) ? 0.6f : -0.4f);
      }
      er_out *= 0.25f;

      // Late field: combs in parallel, allpasses in series.
      st.lfo[ch] += spin / sr;
      if (st.lfo[ch] >= 1.0f) st.lfo[ch] -= 1.0f;
      const float lfo_v = std::sin(6.28318530718f * st.lfo[ch]);
      float late_in = delayed + send * er_out;
      float late = 0.0f;
      for (int i = 0; i < kCombs; ++i) {
        st.smooth_fb[i] += smooth_a * (fb_target[i] - st.smooth_fb[i]);
        Comb& c = st.combs[ch][i];
        const float tap = c.line.ReadSamples(comb_base[i]);
        st.smooth_damp += smooth_a * (damp_t - st.smooth_damp);
        c.damp = FlushDenormal(c.damp + st.smooth_damp * (tap - c.damp));
        c.line.Write(late_in + st.smooth_fb[i] * c.damp);
        late += c.damp;
      }
      late *= 0.25f;
      // Low shelf on the tail (low_mult around low_xo).
      st.shelf[ch] = FlushDenormal(st.shelf[ch] + low_t * (late - st.shelf[ch]));
      late += low_gain * st.shelf[ch];
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
      wet_ch[ch] = early_g * er_out + late_g * late;
    }
    // Width as mid/side scaling on the wet field.
    const float mid = 0.5f * (wet_ch[0] + wet_ch[1]);
    const float side = 0.5f * (wet_ch[0] - wet_ch[1]) * width;
    output[0][n] = dry_g * input[0][n] + mid + side;
    output[1][n] = dry_g * input[1][n] + mid - side;
  }
}

int DragonflyHallReverb::ParamCount() { return kParamCount; }

const DragonflyHallReverb::ParamInfo& DragonflyHallReverb::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}

float DragonflyHallReverb::GetParam(int index) const {
  const Impl& st = *impl_;
  switch (index) {
    case kDryLevel: return st.dry;
    case kEarlyLevel: return st.early;
    case kLateLevel: return st.late;
    case kSize: return st.size;
    case kWidth: return st.width;
    case kPredelay: return st.predelay;
    case kDiffuse: return st.diffuse;
    case kLowCut: return st.low_cut;
    case kLowXo: return st.low_xo;
    case kLowMult: return st.low_mult;
    case kHighCut: return st.high_cut;
    case kHighXo: return st.high_xo;
    case kHighMult: return st.high_mult;
    case kSpin: return st.spin;
    case kWander: return st.wander;
    case kDecay: return st.decay;
    case kEarlySend: return st.early_send;
    case kModulation: return st.modulation;
    default: return 0.0f;
  }
}

void DragonflyHallReverb::SetParam(int index, float value) {
  Impl& st = *impl_;
  switch (index) {
    case kDryLevel: st.dry = std::clamp(value, 0.0f, 100.0f); break;
    case kEarlyLevel: st.early = std::clamp(value, 0.0f, 100.0f); break;
    case kLateLevel: st.late = std::clamp(value, 0.0f, 100.0f); break;
    case kSize: st.size = std::clamp(value, 10.0f, 60.0f); break;
    case kWidth: st.width = std::clamp(value, 50.0f, 150.0f); break;
    case kPredelay: st.predelay = std::clamp(value, 0.0f, 100.0f); break;
    case kDiffuse: st.diffuse = std::clamp(value, 0.0f, 100.0f); break;
    case kLowCut: st.low_cut = std::clamp(value, 0.0f, 200.0f); break;
    case kLowXo: st.low_xo = std::clamp(value, 200.0f, 1200.0f); break;
    case kLowMult: st.low_mult = std::clamp(value, 0.5f, 2.5f); break;
    case kHighCut: st.high_cut = std::clamp(value, 1000.0f, 16000.0f); break;
    case kHighXo: st.high_xo = std::clamp(value, 1000.0f, 16000.0f); break;
    case kHighMult: st.high_mult = std::clamp(value, 0.2f, 1.2f); break;
    case kSpin: st.spin = std::clamp(value, 0.0f, 10.0f); break;
    case kWander: st.wander = std::clamp(value, 0.0f, 40.0f); break;
    case kDecay: st.decay = std::clamp(value, 0.1f, 10.0f); break;
    case kEarlySend: st.early_send = std::clamp(value, 0.0f, 100.0f); break;
    case kModulation: st.modulation = std::clamp(value, 0.0f, 100.0f); break;
    default: break;
  }
}

}  // namespace dsp
}  // namespace openaxe
