// End-to-end test for the DSPark-backed Equalizer wrapper (kEq): 4 bands x
// {frequency, gain, q} = 12 params. Verifies a band boost/cut actually
// changes the output energy at that frequency and that all-default bands are
// transparent. Only built if NAM_STUDIO_HAS_DSPARK.
#include "nam_studio/dsp/equalizer.h"

#include <algorithm>
#include <cmath>
#include <numeric>
#include <string>
#include <vector>

#include "test_harness.h"

using nam_studio::dsp::Equalizer;

namespace {

void TestParamCountAndInfo() {
  NAM_EXPECT(Equalizer::ParamCount() == 12);
  const auto& first = Equalizer::GetParamInfo(0);
  NAM_EXPECT(std::string(first.symbol) == "band0_frequency");
  const auto& last = Equalizer::GetParamInfo(11);
  NAM_EXPECT(std::string(last.symbol) == "band3_q");
}

void TestGetSetEveryParam() {
  Equalizer eq;
  for (int i = 0; i < Equalizer::ParamCount(); ++i) {
    const auto& info = Equalizer::GetParamInfo(i);
    eq.SetParam(i, info.min_value);
    NAM_EXPECT(eq.GetParam(i) == info.min_value);
    eq.SetParam(i, info.max_value);
    NAM_EXPECT(eq.GetParam(i) == info.max_value);
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
  NAM_EXPECT(std::isfinite(boosted) && std::isfinite(cut));
  NAM_EXPECT(boosted > cut);
  NAM_EXPECT(boosted > 1.0f);  // +12 dB -> peak well above the input's 1.0
  NAM_EXPECT(cut < 1.0f);      // -12 dB -> peak well below the input's 1.0
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
  NAM_EXPECT(close);
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestBassBoostRaisesLevelBelowBoost();
  TestAllDefaultsAreTransparent();

  return nam_studio::test::g_failures == 0 ? 0 : 1;
}