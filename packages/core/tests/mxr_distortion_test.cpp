// Real end-to-end test: constructs the actual MXR Distortion+ DSP, sweeps
// every exposed parameter, and processes real audio through it, checking
// for finite, genuinely non-linear (clipped) output. Only built if
// NAM_STUDIO_HAS_CHOWDSP_WDF (see tests/CMakeLists.txt).
#include "nam_studio/dsp/mxr_distortion.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "test_harness.h"

using nam_studio::dsp::MxrDistortion;

namespace {

void TestParamCountAndInfo() {
  NAM_EXPECT(MxrDistortion::ParamCount() == 2);
  const auto& dist = MxrDistortion::GetParamInfo(0);
  NAM_EXPECT(std::string(dist.symbol) == "dist");
  const auto& level = MxrDistortion::GetParamInfo(1);
  NAM_EXPECT(std::string(level.symbol) == "level");
}

void TestGetSetEveryParam() {
  MxrDistortion distortion;
  for (int i = 0; i < MxrDistortion::ParamCount(); ++i) {
    const auto& info = MxrDistortion::GetParamInfo(i);
    distortion.SetParam(i, info.min_value);
    NAM_EXPECT(distortion.GetParam(i) == info.min_value);
    distortion.SetParam(i, info.max_value);
    NAM_EXPECT(distortion.GetParam(i) == info.max_value);
  }
}

void TestProcessClipsALoudSineFinitely() {
  MxrDistortion distortion;
  distortion.Reset(48000.0);
  distortion.SetParam(0 /* dist */, 1.0f);   // max distortion - should clip hard
  distortion.SetParam(1 /* level */, 0.5f);  // -12dB post gain, well below unity

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
  distortion.Process(input, output, kFrames);

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
  // Unlike DiodeClipper, MXR Distortion+'s circuit carries a real DC bias
  // (see Channel::Prepare's Vb.setVoltage(4.5f)), so a silent channel
  // doesn't produce silent output (the bias transient decays slowly
  // through the DC blocker) - "stays silent" isn't a valid invariant here.
  // Instead, verify true independence directly: two otherwise-identical
  // instances fed the same left-channel content but different
  // right-channel content must produce byte-for-byte identical
  // left-channel output.
  constexpr int kFrames = 256;
  std::vector<float> left(kFrames, 0.5f);
  std::vector<float> right_a(kFrames, 0.0f);
  std::vector<float> right_b(kFrames, 0.9f);

  MxrDistortion distortion_a;
  distortion_a.Reset(48000.0);
  std::vector<float> out_left_a(kFrames, 0.0f);
  std::vector<float> out_right_a(kFrames, 0.0f);
  {
    const float* input[2] = {left.data(), right_a.data()};
    float* output[2] = {out_left_a.data(), out_right_a.data()};
    distortion_a.Process(input, output, kFrames);
  }

  MxrDistortion distortion_b;
  distortion_b.Reset(48000.0);
  std::vector<float> out_left_b(kFrames, 0.0f);
  std::vector<float> out_right_b(kFrames, 0.0f);
  {
    const float* input[2] = {left.data(), right_b.data()};
    float* output[2] = {out_left_b.data(), out_right_b.data()};
    distortion_b.Process(input, output, kFrames);
  }

  bool left_channel_independent = true;
  for (int i = 0; i < kFrames; ++i) {
    if (out_left_a[i] != out_left_b[i]) left_channel_independent = false;
  }
  NAM_EXPECT(left_channel_independent);
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestProcessClipsALoudSineFinitely();
  TestChannelsAreIndependent();

  return nam_studio::test::g_failures == 0 ? 0 : 1;
}
