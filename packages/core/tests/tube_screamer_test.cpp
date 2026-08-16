// Real end-to-end test: constructs the actual Tube Screamer DSP, sweeps
// every exposed parameter, and processes real audio through it, checking
// for finite, genuinely non-linear (clipped) output. Only built if
// NAM_STUDIO_HAS_CHOWDSP_WDF (see tests/CMakeLists.txt).
#include "nam_studio/dsp/tube_screamer.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "test_harness.h"

using nam_studio::dsp::TubeScreamer;

namespace {

void TestParamCountAndInfo() {
  NAM_EXPECT(TubeScreamer::ParamCount() == 3);
  const auto& gain = TubeScreamer::GetParamInfo(0);
  NAM_EXPECT(std::string(gain.symbol) == "gain");
  const auto& num_diodes = TubeScreamer::GetParamInfo(2);
  NAM_EXPECT(std::string(num_diodes.symbol) == "num_diodes");
}

void TestGetSetEveryParam() {
  TubeScreamer screamer;
  for (int i = 0; i < TubeScreamer::ParamCount(); ++i) {
    const auto& info = TubeScreamer::GetParamInfo(i);
    screamer.SetParam(i, info.min_value);
    NAM_EXPECT(screamer.GetParam(i) == info.min_value);
    screamer.SetParam(i, info.max_value);
    NAM_EXPECT(screamer.GetParam(i) == info.max_value);
  }
}

void TestProcessClipsALoudSineFinitely() {
  TubeScreamer screamer;
  screamer.Reset(48000.0);
  screamer.SetParam(0 /* gain */, 1.0f);  // max gain - should clip hard

  constexpr int kFrames = 512;
  std::vector<float> left(kFrames);
  std::vector<float> right(kFrames);
  for (int i = 0; i < kFrames; ++i) {
    const float phase = static_cast<float>(i) / 48000.0f * 200.0f * 6.283185307179586f;
    left[i] = 5.0f * std::sin(phase);
    right[i] = left[i];
  }

  std::vector<float> out_left(kFrames, 0.0f);
  std::vector<float> out_right(kFrames, 0.0f);
  const float* input[2] = {left.data(), right.data()};
  float* output[2] = {out_left.data(), out_right.data()};
  screamer.Process(input, output, kFrames);

  bool all_finite = true;
  float max_abs_in = 0.0f;
  float max_abs_out = 0.0f;
  for (int i = 0; i < kFrames; ++i) {
    if (!std::isfinite(out_left[i]) || !std::isfinite(out_right[i])) all_finite = false;
    max_abs_in = std::max(max_abs_in, std::fabs(left[i]));
    max_abs_out = std::max(max_abs_out, std::fabs(out_left[i]));
  }
  NAM_EXPECT(all_finite);
  NAM_EXPECT(max_abs_out > 0.0f);
  NAM_EXPECT(max_abs_out < max_abs_in);
}

void TestChannelsAreIndependent() {
  TubeScreamer screamer;
  screamer.Reset(48000.0);

  constexpr int kFrames = 256;
  std::vector<float> left(kFrames, 0.5f);
  std::vector<float> right(kFrames, 0.0f);  // silent right channel
  std::vector<float> out_left(kFrames, 0.0f);
  std::vector<float> out_right(kFrames, 0.0f);
  const float* input[2] = {left.data(), right.data()};
  float* output[2] = {out_left.data(), out_right.data()};
  screamer.Process(input, output, kFrames);

  bool right_silent = true;
  for (int i = 0; i < kFrames; ++i) {
    if (out_right[i] != 0.0f) right_silent = false;
  }
  NAM_EXPECT(right_silent);
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestProcessClipsALoudSineFinitely();
  TestChannelsAreIndependent();

  return nam_studio::test::g_failures == 0 ? 0 : 1;
}
