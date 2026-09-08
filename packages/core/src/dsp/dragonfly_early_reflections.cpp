#include "openaxe/dsp/dragonfly_early_reflections.h"

// Permissive-licensed clean-room early-reflections reverb (issue #372).
//
// Same replacement story as dragonfly_hall_reverb.cpp: no Dragonfly/DPF/
// freeverb3 code remains, the 7-parameter surface is unchanged. ER has no
// tail by design - a deterministic tapped-delay cluster (~100 lines, no
// dependency, exactly what the issue prescribes): 12 taps per channel whose
// times scale with `size` and whose pattern selects with `program` (0-7:
// small room through large hall), filtered by `low_cut`/`high_cut`, spread
// by `width`. `early_level` is the wet level. Fully RT-safe; Reset()
// pre-allocates the longest reachable tap.

#include <algorithm>
#include <array>
#include <cmath>
#include <memory>
#include <vector>

#include "openaxe/dsp/dragonfly_early_reflections.h"

#include "internal/variable_delay.h"

namespace openaxe {
namespace dsp {
namespace {

constexpr int kParamCount = 7;

constexpr int kDryLevel = 0;
constexpr int kEarlyLevel = 1;  // wet level
constexpr int kProgram = 2;
constexpr int kSize = 3;
constexpr int kWidth = 4;
constexpr int kLowCut = 5;
constexpr int kHighCut = 6;

const DragonflyEarlyReflections::ParamInfo kParamInfo[kParamCount] = {
#include "generated/dragonfly_early_reflections_params.inc"
};

constexpr int kTaps = 12;

// Base tap times (ms) for program 0; other programs stretch/rotate these.
constexpr float kTapMs[kTaps] = {3.1f, 5.8f,  9.4f,  13.7f, 18.9f, 24.6f,
                                 31.2f, 38.4f, 46.1f, 54.3f, 63.0f, 72.2f};
// Tap gains alternate in sign for a diffuse (non-comby) cluster.
constexpr float kTapGain[kTaps] = {0.55f, -0.48f, 0.42f, -0.38f, 0.34f, -0.30f,
                                   0.27f, -0.24f, 0.21f, -0.19f, 0.17f, -0.15f};

constexpr float kMaxTapMs = 260.0f;
constexpr float kDenormalFloor = 1e-20f;

inline float FlushDenormal(float v) { return std::fabs(v) < kDenormalFloor ? 0.0f : v; }

}  // namespace

struct DragonflyEarlyReflections::Impl {
  float dry = 80.0f, wet = 80.0f, program = 2.0f;
  float size = 30.0f, width = 100.0f, low_cut = 0.0f, high_cut = 12000.0f;

  float sr = 48000.0f;
  std::array<std::array<internal::VariableDelay, kTaps>, 2> taps;
  float lp[2] = {0.0f, 0.0f};
  float hp[2] = {0.0f, 0.0f};

  void Resize(float sample_rate) {
    sr = sample_rate;
    for (auto& ch : taps)
      for (auto& t : ch) t.Prepare(sample_rate, kMaxTapMs);
    Silence();
  }

  void Silence() {
    for (auto& ch : taps)
      for (auto& t : ch) t.Reset();
    lp[0] = lp[1] = hp[0] = hp[1] = 0.0f;
  }
};

DragonflyEarlyReflections::DragonflyEarlyReflections() : impl_(std::make_unique<Impl>()) {
  impl_->Resize(48000.0f);
}

DragonflyEarlyReflections::~DragonflyEarlyReflections() = default;

void DragonflyEarlyReflections::Reset(double sample_rate) {
  impl_->Resize(static_cast<float>(sample_rate));
}

void DragonflyEarlyReflections::Mute() { impl_->Silence(); }

void DragonflyEarlyReflections::Process(const float* const* input, float* const* output,
                                        int num_frames) {
  if (num_frames <= 0) return;
  Impl& st = *impl_;
  const float sr = st.sr;

  const float dry_g = std::clamp(st.dry, 0.0f, 100.0f) / 100.0f;
  const float wet_g = std::clamp(st.wet, 0.0f, 100.0f) / 100.0f;
  const int program = static_cast<int>(std::clamp(st.program, 0.0f, 7.0f) + 0.5f);
  // Programs run small->large: 0.6x to 1.6x tap spread on top of size scaling.
  const float program_scale = 0.6f + 0.143f * program;
  const float tap_scale = std::clamp(st.size, 10.0f, 60.0f) / 30.0f * program_scale;
  const float width = std::clamp(st.width, 50.0f, 150.0f) / 100.0f;
  const float lp_t =
      1.0f - std::exp(-6.28318530718f * std::clamp(st.high_cut, 1000.0f, 16000.0f) / sr);
  const float hp_t = st.low_cut > 1.0f
                         ? 1.0f - std::exp(-6.28318530718f * std::clamp(st.low_cut, 0.0f, 200.0f) / sr)
                         : 0.0f;

  for (int n = 0; n < num_frames; ++n) {
    float wet_ch[2] = {0.0f, 0.0f};
    for (int ch = 0; ch < 2; ++ch) {
      const float in = input[ch][n];
      float cluster = 0.0f;
      // The right channel's taps run 3% long so a mono source still blooms
      // into stereo (without it both channels are bit-identical).
      const float ch_scale = tap_scale * (ch == 0 ? 1.0f : 1.03f);
      for (int t = 0; t < kTaps; ++t) {
        // Rotate the tap pattern per program so each program is a genuinely
        // different room shape, not just a louder/quieter one.
        const int tap_idx = (t + program * 3) % kTaps;
        st.taps[ch][t].Write(in);
        cluster += st.taps[ch][t].ReadSamples(
                       std::max(kTapMs[tap_idx] * ch_scale * sr / 1000.0f, 2.0f)) *
                   kTapGain[tap_idx];
      }
      cluster *= 0.5f;
      st.lp[ch] = FlushDenormal(st.lp[ch] + lp_t * (cluster - st.lp[ch]));
      float y = st.lp[ch];
      if (hp_t > 0.0f) {
        st.hp[ch] = FlushDenormal(st.hp[ch] + hp_t * (y - st.hp[ch]));
        y -= st.hp[ch];
      }
      wet_ch[ch] = y;
    }
    const float mid = 0.5f * (wet_ch[0] + wet_ch[1]);
    const float side = 0.5f * (wet_ch[0] - wet_ch[1]) * width;
    output[0][n] = dry_g * input[0][n] + wet_g * (mid + side);
    output[1][n] = dry_g * input[1][n] + wet_g * (mid - side);
  }
}

int DragonflyEarlyReflections::ParamCount() { return kParamCount; }

const DragonflyEarlyReflections::ParamInfo& DragonflyEarlyReflections::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}

float DragonflyEarlyReflections::GetParam(int index) const {
  const Impl& st = *impl_;
  switch (index) {
    case kDryLevel: return st.dry;
    case kEarlyLevel: return st.wet;
    case kProgram: return st.program;
    case kSize: return st.size;
    case kWidth: return st.width;
    case kLowCut: return st.low_cut;
    case kHighCut: return st.high_cut;
    default: return 0.0f;
  }
}

void DragonflyEarlyReflections::SetParam(int index, float value) {
  Impl& st = *impl_;
  switch (index) {
    case kDryLevel: st.dry = std::clamp(value, 0.0f, 100.0f); break;
    case kEarlyLevel: st.wet = std::clamp(value, 0.0f, 100.0f); break;
    case kProgram: st.program = std::clamp(value, 0.0f, 7.0f); break;
    case kSize: st.size = std::clamp(value, 10.0f, 60.0f); break;
    case kWidth: st.width = std::clamp(value, 50.0f, 150.0f); break;
    case kLowCut: st.low_cut = std::clamp(value, 0.0f, 200.0f); break;
    case kHighCut: st.high_cut = std::clamp(value, 1000.0f, 16000.0f); break;
    default: break;
  }
}

}  // namespace dsp
}  // namespace openaxe
