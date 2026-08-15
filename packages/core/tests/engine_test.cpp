// Tests the real-time audio wiring layer built on top of GraphRig for issue
// #14's extern "C" ABI: buffer routing, mixer summing, passthrough for
// not-yet-wrapped block kinds, reverb algorithm switching, and drive model
// switching. Exercises nam_studio::engine::AudioEngine directly (not the
// extern "C" surface - see api_realtime_test.cpp for that). Needs
// NAM_CORE_DIR/DRAGONFLY_DIR/CHOWDSP_WDF_DIR initialized, same as the rest
// of nam_studio_core - see CMakeLists.txt's comment on why engine.cpp
// doesn't degrade gracefully like the rest of this file.
#include "nam_studio/engine.h"

#include <algorithm>
#include <cmath>
#include <vector>

#include "nam_studio/dsp/diode_clipper.h"
#include "nam_studio/dsp/dragonfly_hall_reverb.h"
#include "nam_studio/dsp/dragonfly_plate_reverb.h"
#include "test_harness.h"

using nam_studio::engine::AudioEngine;
using nam_studio::engine::BlockId;
using nam_studio::engine::DriveModel;
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

void TestDriveDefaultsToDiodeClipperAndProcessesRealAudio() {
  AudioEngine engine;
  const BlockId drive = engine.AddBlock(BlockKind::kDrive, 0, 0);
  NAM_EXPECT(engine.ParamCount(drive) == nam_studio::dsp::DiodeClipper::ParamCount());
  NAM_EXPECT(engine.Connect(kInRailId, 0, drive, 0).ok);
  NAM_EXPECT(engine.Connect(drive, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  // Max drive should clip a loud sine's peak well below linear - same
  // nonlinearity-actually-engages check diode_clipper_test.cpp does, this
  // time through the full engine (routing + param application), not the
  // DiodeClipper class directly.
  engine.SetParam(drive, 1 /* drive */, 1.0f);
  std::vector<float> input(kFrames);
  for (int i = 0; i < kFrames; ++i) {
    input[i] = 5.0f * std::sin(static_cast<float>(i) / 48000.0f * 200.0f * 6.283185307179586f);
  }
  std::vector<float> output(kFrames, 0.0f);
  const float* in_ptrs[1] = {input.data()};
  float* out_ptrs[1] = {output.data()};
  engine.Process(in_ptrs, 1, out_ptrs, 1, kFrames);

  bool all_finite = true;
  float max_abs_out = 0.0f;
  for (float sample : output) {
    if (!std::isfinite(sample)) all_finite = false;
    max_abs_out = std::max(max_abs_out, std::fabs(sample));
  }
  NAM_EXPECT(all_finite);
  NAM_EXPECT(max_abs_out > 0.0f);
  NAM_EXPECT(max_abs_out < 5.0f);

  // SetDriveModel is a documented no-op on a block of the wrong kind.
  const BlockId reverb = engine.AddBlock(BlockKind::kReverb, 1, 0);
  engine.SetDriveModel(reverb, DriveModel::kDiodeClipper);
  NAM_EXPECT(engine.ParamCount(reverb) == nam_studio::dsp::DragonflyHallReverb::ParamCount());
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
  engine.SetDriveModel(kUnknown, DriveModel::kDiodeClipper);     // must not crash
}

}  // namespace

int main() {
  TestPassthroughForUnwrappedKind();
  TestMixerSumsBothConnectedPorts();
  TestUnconnectedOutputIsSilent();
  TestReverbDefaultsToHallThenSwitchesAlgorithm();
  TestDriveDefaultsToDiodeClipperAndProcessesRealAudio();
  TestUnknownBlockIsSafeNoOp();

  return nam_studio::test::g_failures == 0 ? 0 : 1;
}
