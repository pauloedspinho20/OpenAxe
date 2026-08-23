// Real end-to-end test: constructs the actual Dragonfly Room Reverb DSP,
// sweeps every exposed parameter, and processes a real stereo impulse
// through it, checking for a genuine (non-silent, finite) reverb tail. Only
// built if OPENAXE_HAS_DRAGONFLY (see tests/CMakeLists.txt).
#include "openaxe/dsp/dragonfly_room_reverb.h"

#include <cmath>
#include <string>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::DragonflyRoomReverb;

namespace {

void TestParamCountAndInfo() {
  OPENAXE_EXPECT(DragonflyRoomReverb::ParamCount() == 17);
  const auto& dry = DragonflyRoomReverb::GetParamInfo(0);
  OPENAXE_EXPECT(std::string(dry.symbol) == "dry_level");
  const auto& low_cut = DragonflyRoomReverb::GetParamInfo(16);
  OPENAXE_EXPECT(std::string(low_cut.symbol) == "in_low_cut");
}

void TestGetSetEveryParam() {
  DragonflyRoomReverb reverb;
  for (int i = 0; i < DragonflyRoomReverb::ParamCount(); ++i) {
    const auto& info = DragonflyRoomReverb::GetParamInfo(i);
    reverb.SetParam(i, info.min_value);
    OPENAXE_EXPECT(reverb.GetParam(i) == info.min_value);
    reverb.SetParam(i, info.max_value);
    OPENAXE_EXPECT(reverb.GetParam(i) == info.max_value);
  }
}

void TestProcessProducesFiniteReverbTail() {
  DragonflyRoomReverb reverb;
  reverb.Reset(48000.0);

  reverb.SetParam(0 /* dry_level */, 0.0f);
  reverb.SetParam(1 /* early_level */, 100.0f);
  reverb.SetParam(3 /* late_level */, 100.0f);

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
  OPENAXE_EXPECT(all_finite);
  OPENAXE_EXPECT(has_nonzero_tail);

  reverb.Mute();
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestProcessProducesFiniteReverbTail();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}
