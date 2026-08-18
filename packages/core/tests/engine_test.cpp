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

#include "nam_studio/dsp/compressor.h"
#include "nam_studio/dsp/diode_clipper.h"
#include "nam_studio/dsp/dragonfly_hall_reverb.h"
#include "nam_studio/dsp/dragonfly_plate_reverb.h"
#include "nam_studio/dsp/equalizer.h"
#include "nam_studio/dsp/mxr_distortion.h"
#include "nam_studio/dsp/noise_gate.h"
#include "nam_studio/dsp/tremolo.h"
#include "nam_studio/dsp/tube_screamer.h"
#include "nam_studio/dsp/zen_drive.h"
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
  const BlockId block = engine.AddBlock(BlockKind::kCab, 0, 0);
  NAM_EXPECT(engine.Connect(kInRailId, 0, block, 0).ok);
  NAM_EXPECT(engine.Connect(block, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  const auto output = RunMono(engine, 0.5f);
  for (float sample : output) NAM_EXPECT(sample == 0.5f);
}

void TestMixerSumsBothConnectedPorts() {
  AudioEngine engine;
  const BlockId a = engine.AddBlock(BlockKind::kCab, 0, 0);
  const BlockId b = engine.AddBlock(BlockKind::kCab, 1, 0);
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
  engine.AddBlock(BlockKind::kCab, 0, 0);  // never wired to OUT
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

void TestDriveModelSwitchOnlyAffectsThatBlock() {
  AudioEngine engine;
  const BlockId drive_a = engine.AddBlock(BlockKind::kDrive, 0, 0);
  const BlockId drive_b = engine.AddBlock(BlockKind::kDrive, 1, 0);
  NAM_EXPECT(engine.ParamCount(drive_a) == nam_studio::dsp::DiodeClipper::ParamCount());
  NAM_EXPECT(engine.ParamCount(drive_b) == nam_studio::dsp::DiodeClipper::ParamCount());

  engine.SetDriveModel(drive_a, DriveModel::kTubeScreamer);
  NAM_EXPECT(engine.ParamCount(drive_a) == nam_studio::dsp::TubeScreamer::ParamCount());
  NAM_EXPECT(engine.ParamCount(drive_b) == nam_studio::dsp::DiodeClipper::ParamCount());  // untouched

  engine.SetDriveModel(drive_b, DriveModel::kZenDrive);
  NAM_EXPECT(engine.ParamCount(drive_b) == nam_studio::dsp::ZenDrive::ParamCount());
  NAM_EXPECT(engine.ParamCount(drive_a) == nam_studio::dsp::TubeScreamer::ParamCount());  // untouched

  engine.SetDriveModel(drive_a, DriveModel::kMxrDistortion);
  NAM_EXPECT(engine.ParamCount(drive_a) == nam_studio::dsp::MxrDistortion::ParamCount());
}

void TestDsparkKindsDefaultParamsAndProcessRealAudio() {
  AudioEngine engine;
  const BlockId compressor = engine.AddBlock(BlockKind::kCompressor, 0, 0);
  const BlockId eq = engine.AddBlock(BlockKind::kEq, 0, 1);
  const BlockId noise_gate = engine.AddBlock(BlockKind::kNoiseGate, 0, 2);
  const BlockId tremolo = engine.AddBlock(BlockKind::kTremolo, 0, 3);

  NAM_EXPECT(engine.ParamCount(compressor) == nam_studio::dsp::Compressor::ParamCount());
  NAM_EXPECT(engine.ParamCount(eq) == nam_studio::dsp::Equalizer::ParamCount());
  NAM_EXPECT(engine.ParamCount(noise_gate) == nam_studio::dsp::NoiseGate::ParamCount());
  NAM_EXPECT(engine.ParamCount(tremolo) == nam_studio::dsp::Tremolo::ParamCount());

  NAM_EXPECT(engine.Connect(kInRailId, 0, compressor, 0).ok);
  NAM_EXPECT(engine.Connect(compressor, 0, eq, 0).ok);
  NAM_EXPECT(engine.Connect(eq, 0, noise_gate, 0).ok);
  NAM_EXPECT(engine.Connect(noise_gate, 0, tremolo, 0).ok);
  NAM_EXPECT(engine.Connect(tremolo, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  // A loud sine through the full chain: every stage engaged, output must stay
  // finite and non-silent (same real-DSP-actually-ran check the drive test
  // does for its own family).
  std::vector<float> input(kFrames);
  for (int i = 0; i < kFrames; ++i) {
    input[i] = 0.5f * std::sin(static_cast<float>(i) / 48000.0f * 200.0f * 6.283185307179586f);
  }
  std::vector<float> output(kFrames, 0.0f);
  const float* in_ptrs[1] = {input.data()};
  float* out_ptrs[1] = {output.data()};
  for (int pass = 0; pass < 4; ++pass) engine.Process(in_ptrs, 1, out_ptrs, 1, kFrames);

  bool all_finite = true;
  float max_abs_out = 0.0f;
  for (float sample : output) {
    if (!std::isfinite(sample)) all_finite = false;
    max_abs_out = std::max(max_abs_out, std::fabs(sample));
  }
  NAM_EXPECT(all_finite);
  NAM_EXPECT(max_abs_out > 0.0f);
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
  engine.SetBypass(kUnknown, true);                              // must not crash
  NAM_EXPECT(!engine.IsBypassed(kUnknown));
}

// issue #42: bypass and the master bus were UI-state-only no-ops on desktop -
// these prove the core side that backs them actually affects Process().

void TestBypassSkipsDspAndPassesInputThrough() {
  AudioEngine engine;
  const BlockId tremolo = engine.AddBlock(BlockKind::kTremolo, 0, 0);
  NAM_EXPECT(engine.Connect(kInRailId, 0, tremolo, 0).ok);
  NAM_EXPECT(engine.Connect(tremolo, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);
  NAM_EXPECT(!engine.IsBypassed(tremolo));

  // Default tremolo (4Hz rate, 50% depth) modulates a constant input - at
  // least one sample in a 64-frame block must differ from the dry value.
  const auto processed = RunMono(engine, 0.5f);
  bool any_modulated = false;
  for (float sample : processed) {
    if (std::fabs(sample - 0.5f) > 1e-6f) any_modulated = true;
  }
  NAM_EXPECT(any_modulated);

  engine.SetBypass(tremolo, true);
  NAM_EXPECT(engine.IsBypassed(tremolo));
  for (float sample : RunMono(engine, 0.5f)) NAM_EXPECT(sample == 0.5f);

  engine.SetBypass(tremolo, false);
  NAM_EXPECT(!engine.IsBypassed(tremolo));
}

void TestMasterLevelScalesOutput() {
  AudioEngine engine;
  const BlockId cab = engine.AddBlock(BlockKind::kCab, 0, 0);  // pure passthrough
  NAM_EXPECT(engine.Connect(kInRailId, 0, cab, 0).ok);
  NAM_EXPECT(engine.Connect(cab, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);
  NAM_EXPECT(engine.GetMasterLevel() == 1.0f);

  for (float sample : RunMono(engine, 0.4f)) NAM_EXPECT(std::fabs(sample - 0.4f) < 1e-6f);

  engine.SetMasterLevel(0.5f);
  NAM_EXPECT(engine.GetMasterLevel() == 0.5f);
  for (float sample : RunMono(engine, 0.4f)) NAM_EXPECT(std::fabs(sample - 0.2f) < 1e-6f);

  engine.SetMasterLevel(1.0f);
}

void TestMasterAndTunerMuteAreIndependentAndBothSilence() {
  AudioEngine engine;
  const BlockId cab = engine.AddBlock(BlockKind::kCab, 0, 0);
  NAM_EXPECT(engine.Connect(kInRailId, 0, cab, 0).ok);
  NAM_EXPECT(engine.Connect(cab, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);
  NAM_EXPECT(!engine.IsMasterMuted());
  NAM_EXPECT(!engine.IsTunerMuted());

  engine.SetMasterMuted(true);
  NAM_EXPECT(engine.IsMasterMuted());
  for (float sample : RunMono(engine, 0.7f)) NAM_EXPECT(sample == 0.0f);

  engine.SetMasterMuted(false);
  for (float sample : RunMono(engine, 0.7f)) NAM_EXPECT(std::fabs(sample - 0.7f) < 1e-6f);

  // Tuner mute silences independently of master mute.
  engine.SetTunerMuted(true);
  NAM_EXPECT(engine.IsTunerMuted());
  for (float sample : RunMono(engine, 0.7f)) NAM_EXPECT(sample == 0.0f);

  // Toggling master mute while tuner-muted must not clear the tuner's mute.
  engine.SetMasterMuted(true);
  engine.SetMasterMuted(false);
  NAM_EXPECT(engine.IsTunerMuted());
  for (float sample : RunMono(engine, 0.7f)) NAM_EXPECT(sample == 0.0f);

  engine.SetTunerMuted(false);
  for (float sample : RunMono(engine, 0.7f)) NAM_EXPECT(std::fabs(sample - 0.7f) < 1e-6f);
}

}  // namespace

int main() {
  TestPassthroughForUnwrappedKind();
  TestMixerSumsBothConnectedPorts();
  TestUnconnectedOutputIsSilent();
  TestReverbDefaultsToHallThenSwitchesAlgorithm();
  TestDriveDefaultsToDiodeClipperAndProcessesRealAudio();
  TestDriveModelSwitchOnlyAffectsThatBlock();
  TestDsparkKindsDefaultParamsAndProcessRealAudio();
  TestUnknownBlockIsSafeNoOp();
  TestBypassSkipsDspAndPassesInputThrough();
  TestMasterLevelScalesOutput();
  TestMasterAndTunerMuteAreIndependentAndBothSilence();

  return nam_studio::test::g_failures == 0 ? 0 : 1;
}
