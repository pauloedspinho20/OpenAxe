// End-to-end test for the Tremolo wrapper (kTremolo): verifies full-depth
// modulation actually sweeps the output amplitude, and that depth 0 is a
// passthrough. Hand-written DSP (issue #268), no vendor dependency.
#include "openaxe/dsp/tremolo.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::Tremolo;

namespace {

void TestParamCountAndInfo() {
  OPENAXE_EXPECT(Tremolo::ParamCount() == 5);
  const auto& rate = Tremolo::GetParamInfo(0);
  OPENAXE_EXPECT(std::string(rate.symbol) == "rate");
  const auto& shape = Tremolo::GetParamInfo(2);
  OPENAXE_EXPECT(std::string(shape.symbol) == "shape");
  OPENAXE_EXPECT(shape.min_value == 0.0f && shape.max_value == 2.0f);
  const auto& stereo = Tremolo::GetParamInfo(3);
  OPENAXE_EXPECT(std::string(stereo.symbol) == "stereo");
  const auto& mode = Tremolo::GetParamInfo(4);
  OPENAXE_EXPECT(std::string(mode.symbol) == "mode");
}

void TestGetSetEveryParam() {
  Tremolo trem;
  for (int i = 0; i < Tremolo::ParamCount(); ++i) {
    const auto& info = Tremolo::GetParamInfo(i);
    trem.SetParam(i, info.min_value);
    OPENAXE_EXPECT(trem.GetParam(i) == info.min_value);
    trem.SetParam(i, info.max_value);
    OPENAXE_EXPECT(trem.GetParam(i) == info.max_value);
  }
}

// Processes `frames` of constant 1.0 input through a tremolo configured with
// the given depth/rate and returns {min, max} of the last block's output.
std::pair<float, float> ModulationRange(float depth, float rate) {
  Tremolo trem;
  trem.Reset(48000.0);
  trem.SetParam(0 /* rate */, rate);
  trem.SetParam(1 /* depth */, depth);
  trem.SetParam(2 /* shape */, 0.0f /* Sine */);

  constexpr int kFrames = 256;
  std::vector<float> input(kFrames, 1.0f);
  std::vector<float> out_l(kFrames, 0.0f);
  std::vector<float> out_r(kFrames, 0.0f);
  const float* in_ptrs[2] = {input.data(), input.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};

  float lo = 1.0f;
  float hi = 0.0f;
  // 12 blocks of 256 = ~64 ms at 48 kHz; at 20 Hz that's ~1.3 LFO cycles,
  // enough to see both the peak and the trough of the sine modulation.
  for (int block = 0; block < 12; ++block) {
    trem.Process(in_ptrs, out_ptrs, kFrames);
    if (block >= 2) {  // let the depth smoother ramp in first
      for (int i = 0; i < kFrames; ++i) {
        lo = std::min(lo, out_l[i]);
        hi = std::max(hi, out_l[i]);
      }
    }
  }
  return {lo, hi};
}

void TestFullDepthModulatesAmplitude() {
  const auto [lo, hi] = ModulationRange(1.0f, 20.0f);
  OPENAXE_EXPECT(std::isfinite(lo) && std::isfinite(hi));
  OPENAXE_EXPECT(hi > 0.9f);   // near the peak the output approaches the input
  OPENAXE_EXPECT(lo < 0.1f);   // depth 1 = full cut, the trough dips toward zero
}

void TestZeroDepthIsPassthrough() {
  const auto [lo, hi] = ModulationRange(0.0f, 10.0f);
  OPENAXE_EXPECT(lo > 0.99f && hi < 1.01f);  // untouched within float tolerance
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestFullDepthModulatesAmplitude();
  TestZeroDepthIsPassthrough();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}