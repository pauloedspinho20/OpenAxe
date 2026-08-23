// End-to-end test for the DSPark-backed NoiseGate wrapper (kNoiseGate):
// verifies the gate opens for a signal above the threshold and closes (with
// range attenuation) below it. Only built if OPENAXE_HAS_DSPARK.
#include "openaxe/dsp/noise_gate.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::NoiseGate;

namespace {

void TestParamCountAndInfo() {
  OPENAXE_EXPECT(NoiseGate::ParamCount() == 6);
  const auto& threshold = NoiseGate::GetParamInfo(0);
  OPENAXE_EXPECT(std::string(threshold.symbol) == "threshold");
  const auto& range = NoiseGate::GetParamInfo(5);
  OPENAXE_EXPECT(std::string(range.symbol) == "range");
}

void TestGetSetEveryParam() {
  NoiseGate gate;
  for (int i = 0; i < NoiseGate::ParamCount(); ++i) {
    const auto& info = NoiseGate::GetParamInfo(i);
    gate.SetParam(i, info.min_value);
    OPENAXE_EXPECT(gate.GetParam(i) == info.min_value);
    gate.SetParam(i, info.max_value);
    OPENAXE_EXPECT(gate.GetParam(i) == info.max_value);
  }
}

// Peak |output| over `frames` of a constant `value` input after `warmup`
// blocks through a fresh gate.
float ConstantLevelPeak(float value, int frames, int warmup) {
  NoiseGate gate;
  gate.Reset(48000.0);
  // Fast envelopes so the gate's open/close state settles within the warmup.
  gate.SetParam(2 /* attack */, 0.5f);
  gate.SetParam(4 /* release */, 10.0f);

  std::vector<float> input(frames, value);
  std::vector<float> out_l(frames, 0.0f);
  std::vector<float> out_r(frames, 0.0f);
  const float* in_ptrs[2] = {input.data(), input.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};

  float peak = 0.0f;
  for (int block = 0; block < warmup + 1; ++block) {
    gate.Process(in_ptrs, out_ptrs, frames);
    if (block == warmup) {
      for (int i = 0; i < frames; ++i) peak = std::max(peak, std::fabs(out_l[i]));
    }
  }
  return peak;
}

void TestLoudSignalOpensTheGate() {
  // 0.1 (~ -20 dB) is well above the default -40 dB threshold, so the gate
  // stays open and the signal passes near-unity (range only applies when
  // closed): the 0.1 input must come out at ~0.1, not ~1e-4.
  const float peak = ConstantLevelPeak(0.1f, 256, 8);
  OPENAXE_EXPECT(std::isfinite(peak));
  OPENAXE_EXPECT(peak > 0.08f);
}

void TestSilentSignalIsGated() {
  // 1e-5 (~ -100 dB) sits far below the threshold: the gate closes and
  // applies its default -80 dB range, crushing the output to ~1e-4 of input.
  const float peak = ConstantLevelPeak(1e-5f, 256, 16);
  OPENAXE_EXPECT(std::isfinite(peak));
  OPENAXE_EXPECT(peak < 1e-4f);
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestLoudSignalOpensTheGate();
  TestSilentSignalIsGated();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}