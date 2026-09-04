// End-to-end test for the DSPark-backed Equalizer wrapper (kEq): 4 bands x
// {frequency, gain, q} = 12 params plus a global low-cut (HPF) and high-cut
// (LPF) in series after the bands = 14 params (issue #373). Verifies a band
// boost/cut actually changes the output energy at that frequency, the cuts
// attenuate out-of-band content, and that all-default bands are transparent.
// Only built if OPENAXE_HAS_DSPARK.
#include "openaxe/dsp/equalizer.h"

#include <algorithm>
#include <cmath>
#include <numeric>
#include <string>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::Equalizer;

namespace {

void TestParamCountAndInfo() {
  OPENAXE_EXPECT(Equalizer::ParamCount() == 14);
  const auto& first = Equalizer::GetParamInfo(0);
  OPENAXE_EXPECT(std::string(first.symbol) == "band0_frequency");
  const auto& last_band = Equalizer::GetParamInfo(11);
  OPENAXE_EXPECT(std::string(last_band.symbol) == "band3_q");
  const auto& low_cut = Equalizer::GetParamInfo(12);
  OPENAXE_EXPECT(std::string(low_cut.symbol) == "low_cut");
  const auto& high_cut = Equalizer::GetParamInfo(13);
  OPENAXE_EXPECT(std::string(high_cut.symbol) == "high_cut");
}

void TestGetSetEveryParam() {
  Equalizer eq;
  for (int i = 0; i < Equalizer::ParamCount(); ++i) {
    const auto& info = Equalizer::GetParamInfo(i);
    eq.SetParam(i, info.min_value);
    OPENAXE_EXPECT(eq.GetParam(i) == info.min_value);
    eq.SetParam(i, info.max_value);
    OPENAXE_EXPECT(eq.GetParam(i) == info.max_value);
  }
}

// Peak output magnitude for a `freq_hz` sine of amplitude 1.0 through a fresh
// EQ with band 0 (low-shelf) set to gain_db, after a few warmup blocks.
float LowShelfSinePeak(float gain_db, int frames, int warmup_blocks) {
  Equalizer eq;
  eq.Reset(48000.0);
  eq.SetParam(0 /* band0_frequency */, 100.0f);
  eq.SetParam(1 /* band0_gain */, gain_db);
  eq.SetParam(2 /* band0_q */, 0.707f);

  std::vector<float> input(frames);
  std::vector<float> out_l(frames, 0.0f);
  std::vector<float> out_r(frames, 0.0f);
  const float* in_ptrs[2] = {input.data(), input.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};

  float peak = 0.0f;
  for (int block = 0; block < warmup_blocks + 1; ++block) {
    for (int i = 0; i < frames; ++i) {
      input[i] = std::sin(static_cast<float>(i) / 48000.0f * 100.0f * 6.283185307179586f);
    }
    eq.Process(in_ptrs, out_ptrs, frames);
    if (block == warmup_blocks) {
      for (int i = 0; i < frames; ++i) peak = std::max(peak, std::fabs(out_l[i]));
    }
  }
  return peak;
}

void TestBassBoostRaisesLevelBelowBoost() {
  // A 100 Hz sine through a low-shelf set to +12 dB at 100 Hz must come out
  // louder than the same EQ with -12 dB at 100 Hz.
  const float boosted = LowShelfSinePeak(12.0f, 256, 8);
  const float cut = LowShelfSinePeak(-12.0f, 256, 8);
  OPENAXE_EXPECT(std::isfinite(boosted) && std::isfinite(cut));
  OPENAXE_EXPECT(boosted > cut);
  OPENAXE_EXPECT(boosted > 1.0f);  // +12 dB -> peak well above the input's 1.0
  OPENAXE_EXPECT(cut < 1.0f);      // -12 dB -> peak well below the input's 1.0
}

// Peak output magnitude for a continuous `freq_hz` sine of amplitude 1.0
// through a fresh EQ with the series cuts set to low_cut_hz/high_cut_hz.
// Phase is continuous across blocks and only the post-warmup block is
// measured, so both the dspark bands and the cut biquads are in steady state.
float CutSinePeak(float freq_hz, float low_cut_hz, float high_cut_hz, int frames, int warmup_blocks) {
  Equalizer eq;
  eq.Reset(48000.0);
  eq.SetParam(12 /* low_cut */, low_cut_hz);
  eq.SetParam(13 /* high_cut */, high_cut_hz);

  std::vector<float> input(frames);
  std::vector<float> out_l(frames, 0.0f);
  std::vector<float> out_r(frames, 0.0f);
  const float* in_ptrs[2] = {input.data(), input.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};

  double phase = 0.0;
  const double step = static_cast<double>(freq_hz) * 6.283185307179586 / 48000.0;
  float peak = 0.0f;
  for (int block = 0; block < warmup_blocks + 1; ++block) {
    for (int i = 0; i < frames; ++i) {
      input[static_cast<size_t>(i)] = static_cast<float>(std::sin(phase));
      phase += step;
    }
    eq.Process(in_ptrs, out_ptrs, frames);
    if (block == warmup_blocks) {
      for (int i = 0; i < frames; ++i) peak = std::max(peak, std::fabs(out_l[i]));
    }
  }
  return peak;
}

void TestCutsAttenuateOutOfBand() {
  // 12 dB/oct cuts, well into the stopband: a 100 Hz sine through a 500 Hz
  // HPF (~2.3 octaves down, ~27 dB) and an 8 kHz sine through a 3 kHz LPF
  // (~1.4 octaves up, ~17 dB) must both come out strongly attenuated.
  const float hp_stop = CutSinePeak(100.0f, 500.0f, 20000.0f, 256, 8);
  const float lp_stop = CutSinePeak(8000.0f, 20.0f, 3000.0f, 256, 8);
  OPENAXE_EXPECT(std::isfinite(hp_stop) && std::isfinite(lp_stop));
  OPENAXE_EXPECT(hp_stop < 0.15f);
  OPENAXE_EXPECT(lp_stop < 0.3f);

  // ...while a 1 kHz sine with both cuts engaged (500 Hz / 3 kHz) passes
  // essentially untouched (each ~1+ octave into its passband).
  const float pass = CutSinePeak(1000.0f, 500.0f, 3000.0f, 256, 8);
  OPENAXE_EXPECT(std::isfinite(pass));
  OPENAXE_EXPECT(pass > 0.9f);
}

void TestAllDefaultsAreTransparent() {
  Equalizer eq;
  eq.Reset(48000.0);

  constexpr int kFrames = 256;
  std::vector<float> input(kFrames);
  std::vector<float> out_l(kFrames, 0.0f);
  std::vector<float> out_r(kFrames, 0.0f);
  const float* in_ptrs[2] = {input.data(), input.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};

  bool close = true;
  for (int block = 0; block < 8; ++block) {
    for (int i = 0; i < kFrames; ++i) {
      input[i] = 0.5f * std::sin(static_cast<float>(i) / 48000.0f * 500.0f * 6.283185307179586f);
    }
    eq.Process(in_ptrs, out_ptrs, kFrames);
    for (int i = 0; i < kFrames; ++i) {
      if (std::fabs(out_l[i] - input[i]) > 1e-3f) close = false;
    }
  }
  OPENAXE_EXPECT(close);
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestBassBoostRaisesLevelBelowBoost();
  TestCutsAttenuateOutOfBand();
  TestAllDefaultsAreTransparent();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}