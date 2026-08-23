// End-to-end test for the DSPark-backed Compressor wrapper (kCompressor):
// constructs the real DSP, sweeps every parameter, and verifies it actually
// compresses a loud signal and leaves a quiet one alone. Only built if
// OPENAXE_HAS_DSPARK (see tests/CMakeLists.txt).
#include "openaxe/dsp/compressor.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::Compressor;

namespace {

void TestParamCountAndInfo() {
  OPENAXE_EXPECT(Compressor::ParamCount() == 8);
  const auto& threshold = Compressor::GetParamInfo(0);
  OPENAXE_EXPECT(std::string(threshold.symbol) == "threshold");
  const auto& character = Compressor::GetParamInfo(6);
  OPENAXE_EXPECT(std::string(character.symbol) == "character");
  OPENAXE_EXPECT(character.min_value == 0.0f && character.max_value == 3.0f);
  // Mix (dry/wet) is the native DSPark control added at index 7.
  const auto& mix = Compressor::GetParamInfo(7);
  OPENAXE_EXPECT(std::string(mix.symbol) == "mix");
  OPENAXE_EXPECT(mix.min_value == 0.0f && mix.max_value == 1.0f);
}

void TestGetSetEveryParam() {
  Compressor comp;
  for (int i = 0; i < Compressor::ParamCount(); ++i) {
    const auto& info = Compressor::GetParamInfo(i);
    comp.SetParam(i, info.min_value);
    OPENAXE_EXPECT(comp.GetParam(i) == info.min_value);
    comp.SetParam(i, info.max_value);
    OPENAXE_EXPECT(comp.GetParam(i) == info.max_value);
  }
}

void TestLoudSineIsCompressed() {
  // Aggressive settings: everything above -60 dB gets slammed at 20:1, fast
  // attack so the envelope settles within the warmup.
  Compressor comp;
  comp.Reset(48000.0);
  comp.SetParam(0 /* threshold */, -60.0f);
  comp.SetParam(1 /* ratio */, 20.0f);
  comp.SetParam(2 /* attack */, 0.1f);
  comp.SetParam(3 /* release */, 20.0f);

  constexpr int kFrames = 256;
  std::vector<float> input(kFrames);
  std::vector<float> out_l(kFrames, 0.0f);
  std::vector<float> out_r(kFrames, 0.0f);
  const float* in_ptrs[2] = {input.data(), input.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};

  float max_abs_out = 0.0f;
  bool all_finite = true;
  for (int block = 0; block < 16; ++block) {  // 16 * 256 = ~85 ms warmup
    for (int i = 0; i < kFrames; ++i) {
      input[i] = 1.0f * std::sin(static_cast<float>(i) / 48000.0f * 200.0f * 6.283185307179586f);
    }
    comp.Process(in_ptrs, out_ptrs, kFrames);
    for (int i = 0; i < kFrames; ++i) {
      if (!std::isfinite(out_l[i])) all_finite = false;
      max_abs_out = std::max(max_abs_out, std::fabs(out_l[i]));
    }
  }
  OPENAXE_EXPECT(all_finite);
  OPENAXE_EXPECT(max_abs_out > 0.0f);
  // 1.0 (= 0 dBFS) at threshold -60 dB with 20:1 -> output pinned well below
  // the input peak. A wide margin keeps the assertion robust to model/engine
  // details.
  OPENAXE_EXPECT(max_abs_out < 0.5f);
}

void TestQuietSignalIsNotCompressed() {
  // Default threshold is 0 dB; a -40 dB signal sits far below it, so the
  // compressor passes it through essentially untouched (no makeup gain).
  Compressor comp;
  comp.Reset(48000.0);
  comp.SetParam(1 /* ratio */, 20.0f);

  constexpr int kFrames = 256;
  std::vector<float> input(kFrames);
  std::vector<float> out_l(kFrames, 0.0f);
  std::vector<float> out_r(kFrames, 0.0f);
  const float* in_ptrs[2] = {input.data(), input.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};

  constexpr float kAmplitude = 0.01f;  // -40 dB
  float max_abs_out = 0.0f;
  for (int block = 0; block < 8; ++block) {
    for (int i = 0; i < kFrames; ++i) {
      input[i] = kAmplitude * std::sin(static_cast<float>(i) / 48000.0f * 200.0f * 6.283185307179586f);
    }
    comp.Process(in_ptrs, out_ptrs, kFrames);
    if (block >= 4) {
      for (int i = 0; i < kFrames; ++i) max_abs_out = std::max(max_abs_out, std::fabs(out_l[i]));
    }
  }
  OPENAXE_EXPECT(max_abs_out > 0.8f * kAmplitude);
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestLoudSineIsCompressed();
  TestQuietSignalIsNotCompressed();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}