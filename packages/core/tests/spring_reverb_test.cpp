// End-to-end test for the hand-rolled spring tank reverb (kReverb with
// ReverbAlgorithm::kSpring): constructs the real DSP, renders an impulse
// through it, and verifies it produces a finite, decaying tail (the spring
// "boing") rather than silence, NaN, or a diverging loop.
#include "openaxe/dsp/spring_reverb.h"

#include <cmath>
#include <cstdio>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::SpringReverb;

namespace {

void TestParamCountAndInfo() {
  OPENAXE_EXPECT(SpringReverb::ParamCount() == 8);
  const auto& dry = SpringReverb::GetParamInfo(0);
  OPENAXE_EXPECT(std::string(dry.symbol) == "dry_level");
  const auto& decay = SpringReverb::GetParamInfo(1);
  OPENAXE_EXPECT(std::string(decay.symbol) == "decay");
  const auto& drive = SpringReverb::GetParamInfo(7);
  OPENAXE_EXPECT(std::string(drive.symbol) == "drive");
}

void TestGetSetEveryParam() {
  SpringReverb r;
  for (int i = 0; i < SpringReverb::ParamCount(); ++i) {
    const auto& info = SpringReverb::GetParamInfo(i);
    r.SetParam(i, info.min_value);
    OPENAXE_EXPECT(r.GetParam(i) == info.min_value);
    r.SetParam(i, info.max_value);
    OPENAXE_EXPECT(r.GetParam(i) == info.max_value);
  }
}

void TestImpulseProducesFiniteDecayingTail() {
  SpringReverb r;
  r.Reset(48000.0);
  // Fully wet so the tail is what we measure.
  r.SetParam(0 /* dry_level */, 0.0f);
  r.SetParam(1 /* decay */, 2.0f);
  r.SetParam(4 /* predelay */, 0.0f);

  constexpr int kFrames = 16384;
  std::vector<float> left(kFrames, 0.0f);
  std::vector<float> right(kFrames, 0.0f);
  left[0] = 1.0f;
  right[0] = 1.0f;
  std::vector<float> out_l(kFrames, 0.0f);
  std::vector<float> out_r(kFrames, 0.0f);
  const float* input[2] = {left.data(), right.data()};
  float* output[2] = {out_l.data(), out_r.data()};
  r.Process(input, output, kFrames);

  bool all_finite = true;
  bool has_early = false;   // reflections start once the shortest spring rings
  bool decays = true;       // tail must not grow without bound
  float peak = 0.0f;
  float late_peak = 0.0f;
  for (int i = 0; i < kFrames; ++i) {
    if (!std::isfinite(out_l[i]) || !std::isfinite(out_r[i])) all_finite = false;
    peak = std::max(peak, std::fabs(out_l[i]));
    if (i > 100 && i < 4000 && std::fabs(out_l[i]) > 1e-4f) has_early = true;
    if (i > 12000) late_peak = std::max(late_peak, std::fabs(out_l[i]));
  }
  // The spring rings for a while (tail exists) but must decay toward silence.
  if (peak > 0.0f && late_peak > peak * 0.99f) decays = false;

  OPENAXE_EXPECT(all_finite);
  OPENAXE_EXPECT(has_early);
  OPENAXE_EXPECT(peak > 0.0f);
  OPENAXE_EXPECT(decays);
}

void TestMuteSilences() {
  SpringReverb r;
  r.Reset(48000.0);
  r.SetParam(0, 0.0f);  // wet only
  constexpr int kFrames = 4096;
  std::vector<float> left(kFrames, 0.0f), right(kFrames, 0.0f);
  left[0] = 1.0f;
  right[0] = 1.0f;
  std::vector<float> out_l(kFrames, 0.0f), out_r(kFrames, 0.0f);
  const float* input[2] = {left.data(), right.data()};
  float* output[2] = {out_l.data(), out_r.data()};
  r.Process(input, output, kFrames);
  r.Mute();
  // After mute, a silence input must stay silent.
  std::fill(left.begin(), left.end(), 0.0f);
  std::fill(right.begin(), right.end(), 0.0f);
  std::fill(out_l.begin(), out_l.end(), 0.0f);
  std::fill(out_r.begin(), out_r.end(), 0.0f);
  r.Process(input, output, kFrames);
  bool silent = true;
  for (int i = 0; i < kFrames; ++i) {
    if (std::fabs(out_l[i]) > 1e-6f || std::fabs(out_r[i]) > 1e-6f) silent = false;
  }
  OPENAXE_EXPECT(silent);
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestImpulseProducesFiniteDecayingTail();
  TestMuteSilences();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}