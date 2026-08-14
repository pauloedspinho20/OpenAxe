// Real end-to-end test: constructs the actual Dragonfly Early Reflections
// DSP, sweeps every exposed parameter, and processes a real stereo impulse
// through it, checking for a genuine (non-silent, finite) tail. Only built
// if NAM_STUDIO_HAS_DRAGONFLY (see tests/CMakeLists.txt).
#include "nam_studio/dsp/dragonfly_early_reflections.h"

#include <cmath>
#include <string>
#include <vector>

#include "test_harness.h"

using nam_studio::dsp::DragonflyEarlyReflections;

namespace {

void TestParamCountAndInfo() {
  NAM_EXPECT(DragonflyEarlyReflections::ParamCount() == 7);
  const auto& dry = DragonflyEarlyReflections::GetParamInfo(0);
  NAM_EXPECT(std::string(dry.symbol) == "dry_level");
  const auto& high_cut = DragonflyEarlyReflections::GetParamInfo(6);
  NAM_EXPECT(std::string(high_cut.symbol) == "high_cut");
}

void TestGetSetEveryParam() {
  DragonflyEarlyReflections reverb;
  for (int i = 0; i < DragonflyEarlyReflections::ParamCount(); ++i) {
    const auto& info = DragonflyEarlyReflections::GetParamInfo(i);
    reverb.SetParam(i, info.min_value);
    NAM_EXPECT(reverb.GetParam(i) == info.min_value);
    reverb.SetParam(i, info.max_value);
    NAM_EXPECT(reverb.GetParam(i) == info.max_value);
  }
}

void TestProcessProducesFiniteReverbTail() {
  DragonflyEarlyReflections reverb;
  reverb.Reset(48000.0);

  reverb.SetParam(0 /* dry_level */, 0.0f);
  reverb.SetParam(1 /* wet_level */, 100.0f);

  constexpr int kFrames = 4096;
  std::vector<float> left(kFrames, 0.0f);
  std::vector<float> right(kFrames, 0.0f);
  left[0] = 1.0f;
  right[0] = 1.0f;

  std::vector<float> out_left(kFrames, 0.0f);
  std::vector<float> out_right(kFrames, 0.0f);

  const float* input[2] = {left.data(), right.data()};
  float* output[2] = {out_left.data(), out_right.data()};
  reverb.Process(input, output, kFrames);

  bool all_finite = true;
  bool has_nonzero_tail = false;
  for (int i = 100; i < kFrames; ++i) {
    if (!std::isfinite(out_left[i]) || !std::isfinite(out_right[i])) all_finite = false;
    if (out_left[i] != 0.0f || out_right[i] != 0.0f) has_nonzero_tail = true;
  }
  NAM_EXPECT(all_finite);
  NAM_EXPECT(has_nonzero_tail);

  reverb.Mute();
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestProcessProducesFiniteReverbTail();

  return nam_studio::test::g_failures == 0 ? 0 : 1;
}
