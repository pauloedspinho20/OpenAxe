// Tests the real-time audio wiring layer built on top of GraphRig for issue
// #14's extern "C" ABI: buffer routing, mixer summing, passthrough for
// not-yet-wrapped block kinds, and reverb algorithm switching. Exercises
// nam_studio::engine::AudioEngine directly (not the extern "C" surface -
// see api_realtime_test.cpp for that). Needs NAM_CORE_DIR/DRAGONFLY_DIR
// initialized, same as the rest of nam_studio_core - see CMakeLists.txt's
// comment on why engine.cpp doesn't degrade gracefully like the rest of
// this file.
#include "nam_studio/engine.h"

#include <cmath>
#include <vector>

#include "nam_studio/dsp/dragonfly_hall_reverb.h"
#include "nam_studio/dsp/dragonfly_plate_reverb.h"
#include "test_harness.h"

using nam_studio::engine::AudioEngine;
using nam_studio::engine::BlockId;
using nam_studio::engine::kInRailId;
using nam_studio::engine::kOutRailId;
using nam_studio::engine::ReverbAlgorithm;
using nam_studio::graph::BlockKind;

namespace {

constexpr int kFrames = 64;

// Runs one mono-in/mono-out buffer through the engine and returns the output.
std::vector<float> RunMono(AudioEngine& engine, float input_value) {
  std::vector<float> input(kFrames, input_value);
  std::vector<float> output(kFrames, 0.0f);
  const float* in_ptrs[1] = {input.data()};
  float* out_ptrs[1] = {output.data()};
  engine.Process(in_ptrs, 1, out_ptrs, 1, kFrames);
  return output;
}

void TestPassthroughForUnwrappedKind() {
  AudioEngine engine;
  const BlockId block = engine.AddBlock(BlockKind::kNoiseGate, 0, 0);
  NAM_EXPECT(engine.Connect(kInRailId, 0, block, 0).ok);
  NAM_EXPECT(engine.Connect(block, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  const auto output = RunMono(engine, 0.5f);
  for (float sample : output) NAM_EXPECT(sample == 0.5f);
}

void TestMixerSumsBothConnectedPorts() {
  AudioEngine engine;
  const BlockId a = engine.AddBlock(BlockKind::kNoiseGate, 0, 0);
  const BlockId b = engine.AddBlock(BlockKind::kNoiseGate, 1, 0);
  const BlockId mixer = engine.AddBlock(BlockKind::kMixer, 0, 1);
  NAM_EXPECT(engine.Connect(kInRailId, 0, a, 0).ok);
  NAM_EXPECT(engine.Connect(kInRailId, 0, b, 0).ok);
  NAM_EXPECT(engine.Connect(a, 0, mixer, 0).ok);
  NAM_EXPECT(engine.Connect(b, 0, mixer, 1).ok);
  NAM_EXPECT(engine.Connect(mixer, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  const auto output = RunMono(engine, 0.25f);
  for (float sample : output) NAM_EXPECT(std::fabs(sample - 0.5f) < 1e-6f);
}

void TestUnconnectedOutputIsSilent() {
  AudioEngine engine;
  engine.AddBlock(BlockKind::kNoiseGate, 0, 0);  // never wired to OUT
  engine.Reset(48000.0, kFrames);

  const auto output = RunMono(engine, 1.0f);
  for (float sample : output) NAM_EXPECT(sample == 0.0f);
}

void TestReverbDefaultsToHallThenSwitchesAlgorithm() {
  AudioEngine engine;
  const BlockId reverb = engine.AddBlock(BlockKind::kReverb, 0, 0);
  NAM_EXPECT(engine.ParamCount(reverb) == nam_studio::dsp::DragonflyHallReverb::ParamCount());

  engine.SetReverbAlgorithm(reverb, ReverbAlgorithm::kPlate);
  NAM_EXPECT(engine.ParamCount(reverb) == nam_studio::dsp::DragonflyPlateReverb::ParamCount());
}

void TestUnknownBlockIsSafeNoOp() {
  AudioEngine engine;
  constexpr BlockId kUnknown = 999;
  NAM_EXPECT(engine.ParamCount(kUnknown) == 0);
  NAM_EXPECT(engine.GetParam(kUnknown, 0) == 0.0f);
  engine.SetParam(kUnknown, 0, 1.0f);                            // must not crash
  NAM_EXPECT(engine.GetMeter(kUnknown) == 0.0f);
  engine.RemoveBlock(kUnknown);                                  // must not crash
  engine.SetReverbAlgorithm(kUnknown, ReverbAlgorithm::kRoom);   // must not crash
}

}  // namespace

int main() {
  TestPassthroughForUnwrappedKind();
  TestMixerSumsBothConnectedPorts();
  TestUnconnectedOutputIsSilent();
  TestReverbDefaultsToHallThenSwitchesAlgorithm();
  TestUnknownBlockIsSafeNoOp();

  return nam_studio::test::g_failures == 0 ? 0 : 1;
}
