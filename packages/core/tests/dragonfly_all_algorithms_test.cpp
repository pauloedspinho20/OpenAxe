// The actual regression test for the symbol-collision problem documented
// in dragonfly_hall_reverb.cpp: constructs and processes audio through all
// four Dragonfly reverb algorithms in ONE executable. Before the
// anonymous-namespace-per-.cpp fix, linking any two of these together
// would fail with duplicate DragonflyReverbDSP/fv3::* symbols - this test
// existing and passing at all is the proof the fix holds, not just any
// individual assertion inside it. Only built if OPENAXE_HAS_DRAGONFLY
// (see tests/CMakeLists.txt).
#include <cmath>
#include <vector>

#include "openaxe/dsp/dragonfly_early_reflections.h"
#include "openaxe/dsp/dragonfly_hall_reverb.h"
#include "openaxe/dsp/dragonfly_plate_reverb.h"
#include "openaxe/dsp/dragonfly_room_reverb.h"
#include "test_harness.h"

namespace {

template <typename Reverb>
bool ProducesFiniteTail(Reverb& reverb, int dry_index, int wet_index) {
  reverb.Reset(48000.0);
  reverb.SetParam(dry_index, 0.0f);
  reverb.SetParam(wet_index, 100.0f);

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
  bool has_tail = false;
  for (int i = 100; i < kFrames; ++i) {
    if (!std::isfinite(out_left[i]) || !std::isfinite(out_right[i])) all_finite = false;
    if (out_left[i] != 0.0f || out_right[i] != 0.0f) has_tail = true;
  }
  return all_finite && has_tail;
}

}  // namespace

int main() {
  openaxe::dsp::DragonflyHallReverb hall;
  openaxe::dsp::DragonflyRoomReverb room;
  openaxe::dsp::DragonflyPlateReverb plate;
  openaxe::dsp::DragonflyEarlyReflections early;

  OPENAXE_EXPECT(ProducesFiniteTail(hall, 0, 1));   // dry_level, early_level (late_level index 2 also wet)
  OPENAXE_EXPECT(ProducesFiniteTail(room, 0, 1));   // dry_level, early_level (late_level is index 3)
  OPENAXE_EXPECT(ProducesFiniteTail(plate, 0, 1));  // dry_level, early_level (Plate's only "wet" param)
  OPENAXE_EXPECT(ProducesFiniteTail(early, 0, 1));  // dry_level, early_level

  return openaxe::test::g_failures == 0 ? 0 : 1;
}
