// Tests the real-time audio wiring layer built on top of GraphRig for issue
// #14's extern "C" ABI: buffer routing, mixer summing, passthrough for
// not-yet-wrapped block kinds, and reverb algorithm switching. Exercises
// openaxe::engine::AudioEngine directly (not the extern "C" surface - see
// api_realtime_test.cpp for that). Needs NAM_CORE_DIR/DRAGONFLY_DIR
// initialized, same as the rest of openaxe_core - see CMakeLists.txt's
// comment on why engine.cpp doesn't degrade gracefully like the rest of
// this file.
#include "openaxe/engine.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <limits>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

#include "openaxe/dsp/chorus.h"
#include "openaxe/dsp/compressor.h"
#include "openaxe/dsp/delay.h"
#include "openaxe/dsp/dragonfly_hall_reverb.h"
#include "openaxe/dsp/dragonfly_plate_reverb.h"
#include "openaxe/dsp/spring_reverb.h"
#include "openaxe/dsp/equalizer.h"
#include "openaxe/dsp/filter.h"
#include "openaxe/dsp/flanger.h"
#include "openaxe/dsp/granular_delay.h"
#include "openaxe/dsp/noise_gate.h"
#include "openaxe/dsp/phaser.h"
#include "openaxe/dsp/pitch_shifter.h"
#include "openaxe/dsp/ring_mod.h"
#include "openaxe/dsp/rotary.h"
#include "openaxe/dsp/tremolo.h"
#include "openaxe/generated/enabled_blocks.h"
#include "test_harness.h"

using openaxe::engine::AudioEngine;
using openaxe::engine::BlockId;
using openaxe::engine::kInRailId;
using openaxe::engine::kOutRailId;
using openaxe::engine::ReverbAlgorithm;
using openaxe::engine::ReverbControl;
using openaxe::graph::BlockKind;

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
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, block, 0).ok);
  OPENAXE_EXPECT(engine.Connect(block, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  const auto output = RunMono(engine, 0.5f);
  for (float sample : output) OPENAXE_EXPECT(sample == 0.5f);
}

void TestMixerSumsBothConnectedPorts() {
  AudioEngine engine;
  const BlockId a = engine.AddBlock(BlockKind::kCab, 0, 0);
  const BlockId b = engine.AddBlock(BlockKind::kCab, 1, 0);
  const BlockId mixer = engine.AddBlock(BlockKind::kMixer, 0, 1);
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, a, 0).ok);
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, b, 0).ok);
  OPENAXE_EXPECT(engine.Connect(a, 0, mixer, 0).ok);
  OPENAXE_EXPECT(engine.Connect(b, 0, mixer, 1).ok);
  OPENAXE_EXPECT(engine.Connect(mixer, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  const auto output = RunMono(engine, 0.25f);
  for (float sample : output) OPENAXE_EXPECT(std::fabs(sample - 0.5f) < 1e-6f);
}

void TestUnconnectedOutputIsSilent() {
  AudioEngine engine;
  engine.AddBlock(BlockKind::kCab, 0, 0);  // never wired to OUT
  engine.Reset(48000.0, kFrames);

  const auto output = RunMono(engine, 1.0f);
  for (float sample : output) OPENAXE_EXPECT(sample == 0.0f);
}

void TestReverbDefaultsToHallThenSwitchesAlgorithm() {
  AudioEngine engine;
  const BlockId reverb = engine.AddBlock(BlockKind::kReverb, 0, 0);
  OPENAXE_EXPECT(engine.ParamCount(reverb) == openaxe::dsp::DragonflyHallReverb::ParamCount());

  engine.SetReverbAlgorithm(reverb, ReverbAlgorithm::kPlate);
  OPENAXE_EXPECT(engine.ParamCount(reverb) == openaxe::dsp::DragonflyPlateReverb::ParamCount());

  // The hand-rolled spring tank is a fifth algorithm with its own surface.
  engine.SetReverbAlgorithm(reverb, ReverbAlgorithm::kSpring);
  OPENAXE_EXPECT(engine.ParamCount(reverb) == openaxe::dsp::SpringReverb::ParamCount());
  const auto spring_decay = engine.ParamInfo(reverb, 1);
  OPENAXE_EXPECT(spring_decay.has_value() && spring_decay->symbol == std::string("decay"));
}

// Issue #392: every reverb algorithm must read back what was written -
// GetReverbAlgorithm recovers the choice from the DSP variant, so a missing
// branch silently downgrades to Hall (Spring did exactly this).
void TestReverbAlgorithmGetRoundTripsAllFive() {
  AudioEngine engine;
  const BlockId reverb = engine.AddBlock(BlockKind::kReverb, 0, 0);
  OPENAXE_EXPECT(engine.GetReverbAlgorithm(reverb) == ReverbAlgorithm::kHall);
  for (ReverbAlgorithm algo : {ReverbAlgorithm::kHall, ReverbAlgorithm::kRoom,
                               ReverbAlgorithm::kPlate,
                               ReverbAlgorithm::kEarlyReflections,
                               ReverbAlgorithm::kSpring}) {
    engine.SetReverbAlgorithm(reverb, algo);
    OPENAXE_EXPECT(engine.GetReverbAlgorithm(reverb) == algo);
  }
}

void TestDsparkKindsDefaultParamsAndProcessRealAudio() {
  AudioEngine engine;
  const BlockId compressor = engine.AddBlock(BlockKind::kCompressor, 0, 0);
  const BlockId eq = engine.AddBlock(BlockKind::kEq, 0, 1);
  const BlockId noise_gate = engine.AddBlock(BlockKind::kNoiseGate, 0, 2);
  const BlockId tremolo = engine.AddBlock(BlockKind::kTremolo, 0, 3);
  // Phase-2 kinds (issue #268): every one is a wet-only DSP kind that also
  // gets the engine-level mix, so param_count must be dsp + 1. Each is
  // guarded because effects.config.json can compile its DSP out (#313), and
  // the assertion below names a type that would not exist in that build.
#if OPENAXE_BLOCK_RING_MOD_COMPILED
  const BlockId ring_mod = engine.AddBlock(BlockKind::kRingMod, 0, 4);
#endif
#if OPENAXE_BLOCK_FILTER_COMPILED
  const BlockId filter = engine.AddBlock(BlockKind::kFilter, 0, 5);
#endif
#if OPENAXE_BLOCK_PITCH_SHIFTER_COMPILED
  const BlockId pitch = engine.AddBlock(BlockKind::kPitchShifter, 0, 6);
#endif
#if OPENAXE_BLOCK_GRANULAR_DELAY_COMPILED
  const BlockId granular = engine.AddBlock(BlockKind::kGranularDelay, 0, 7);
#endif
  const BlockId rotary = engine.AddBlock(BlockKind::kRotary, 0, 8);

  OPENAXE_EXPECT(engine.ParamCount(compressor) == openaxe::dsp::Compressor::ParamCount());
  // eq / noise_gate / tremolo now expose an additional engine-level mix (hybrid dry/wet, #263)
  OPENAXE_EXPECT(engine.ParamCount(eq) == openaxe::dsp::Equalizer::ParamCount() + 1);
  OPENAXE_EXPECT(engine.ParamCount(noise_gate) == openaxe::dsp::NoiseGate::ParamCount() + 1);
  OPENAXE_EXPECT(engine.ParamCount(tremolo) == openaxe::dsp::Tremolo::ParamCount() + 1);
#if OPENAXE_BLOCK_RING_MOD_COMPILED
  OPENAXE_EXPECT(engine.ParamCount(ring_mod) == openaxe::dsp::RingMod::ParamCount() + 1);
#endif
#if OPENAXE_BLOCK_FILTER_COMPILED
  OPENAXE_EXPECT(engine.ParamCount(filter) == openaxe::dsp::Filter::ParamCount() + 1);
#endif
#if OPENAXE_BLOCK_PITCH_SHIFTER_COMPILED
  OPENAXE_EXPECT(engine.ParamCount(pitch) == openaxe::dsp::PitchShifter::ParamCount() + 1);
#endif
#if OPENAXE_BLOCK_GRANULAR_DELAY_COMPILED
  OPENAXE_EXPECT(engine.ParamCount(granular) == openaxe::dsp::GranularDelay::ParamCount() + 1);
#endif
  OPENAXE_EXPECT(engine.ParamCount(rotary) == openaxe::dsp::Rotary::ParamCount() + 1);

  // Assembled from whatever kinds this build actually has, in placement
  // order, so a config that compiles one out (#313) still exercises the rest
  // of the chain end to end instead of failing to compile.
  std::vector<BlockId> chain{compressor, eq, noise_gate, tremolo};
#if OPENAXE_BLOCK_RING_MOD_COMPILED
  chain.push_back(ring_mod);
#endif
#if OPENAXE_BLOCK_FILTER_COMPILED
  chain.push_back(filter);
#endif
#if OPENAXE_BLOCK_PITCH_SHIFTER_COMPILED
  chain.push_back(pitch);
#endif
#if OPENAXE_BLOCK_GRANULAR_DELAY_COMPILED
  chain.push_back(granular);
#endif
  chain.push_back(rotary);

  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, chain.front(), 0).ok);
  for (size_t i = 1; i < chain.size(); ++i) {
    OPENAXE_EXPECT(engine.Connect(chain[i - 1], 0, chain[i], 0).ok);
  }
  OPENAXE_EXPECT(engine.Connect(chain.back(), 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  // A loud sine through the full chain: every stage engaged, output must stay
  // finite and non-silent.
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
  OPENAXE_EXPECT(all_finite);
  OPENAXE_EXPECT(max_abs_out > 0.0f);
}

void TestUnknownBlockIsSafeNoOp() {
  AudioEngine engine;
  constexpr BlockId kUnknown = 999;
  OPENAXE_EXPECT(engine.ParamCount(kUnknown) == 0);
  OPENAXE_EXPECT(engine.GetParam(kUnknown, 0) == 0.0f);
  engine.SetParam(kUnknown, 0, 1.0f);                            // must not crash
  OPENAXE_EXPECT(engine.GetMeter(kUnknown) == 0.0f);
  engine.RemoveBlock(kUnknown);                                  // must not crash
  engine.SetReverbAlgorithm(kUnknown, ReverbAlgorithm::kRoom);   // must not crash
  engine.SetBypass(kUnknown, true);                              // must not crash
  OPENAXE_EXPECT(!engine.IsBypassed(kUnknown));
}

// issue #42: bypass and the master bus were UI-state-only no-ops on desktop -
// these prove the core side that backs them actually affects Process().

void TestBypassSkipsDspAndPassesInputThrough() {
  AudioEngine engine;
  const BlockId tremolo = engine.AddBlock(BlockKind::kTremolo, 0, 0);
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, tremolo, 0).ok);
  OPENAXE_EXPECT(engine.Connect(tremolo, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);
  OPENAXE_EXPECT(!engine.IsBypassed(tremolo));

  // Default tremolo (4Hz rate, 50% depth) modulates a constant input - at
  // least one sample in a 64-frame block must differ from the dry value.
  const auto processed = RunMono(engine, 0.5f);
  bool any_modulated = false;
  for (float sample : processed) {
    if (std::fabs(sample - 0.5f) > 1e-6f) any_modulated = true;
  }
  OPENAXE_EXPECT(any_modulated);

  engine.SetBypass(tremolo, true);
  OPENAXE_EXPECT(engine.IsBypassed(tremolo));
  for (float sample : RunMono(engine, 0.5f)) OPENAXE_EXPECT(sample == 0.5f);

  engine.SetBypass(tremolo, false);
  OPENAXE_EXPECT(!engine.IsBypassed(tremolo));
}

// Per-block I/O trims: the user-facing Input/Output knobs every block kind
// shows. Before these existed the web app applied them with its own Web Audio
// GainNodes and the desktop path forwarded them onto the Amp family's
// input_level/output_level params, which are the loaded model's dBu
// calibration - so a trim either did nothing or recalibrated the amp.
void TestBlockTrimsScaleInputAndOutput() {
  AudioEngine engine;
  const BlockId cab = engine.AddBlock(BlockKind::kCab, 0, 0);  // pure passthrough
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, cab, 0).ok);
  OPENAXE_EXPECT(engine.Connect(cab, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  // Unity by default, on both trims and for an unknown block.
  OPENAXE_EXPECT(engine.GetInputTrim(cab) == 1.0f);
  OPENAXE_EXPECT(engine.GetOutputTrim(cab) == 1.0f);
  OPENAXE_EXPECT(engine.GetInputTrim(9999) == 1.0f);
  for (float sample : RunMono(engine, 0.5f)) OPENAXE_EXPECT(std::fabs(sample - 0.5f) < 1e-6f);

  engine.SetInputTrim(cab, 0.5f);
  OPENAXE_EXPECT(engine.GetInputTrim(cab) == 0.5f);
  for (float sample : RunMono(engine, 0.5f)) OPENAXE_EXPECT(std::fabs(sample - 0.25f) < 1e-6f);

  // Both trims compose multiplicatively (0.5 * 0.5 * 0.5 = 0.125).
  engine.SetOutputTrim(cab, 0.5f);
  for (float sample : RunMono(engine, 0.5f)) OPENAXE_EXPECT(std::fabs(sample - 0.125f) < 1e-6f);

  // Zero really mutes the block (the case the old symbol collision got wrong:
  // 0 written to the amp's input_level meant "0 dBu", i.e. unity).
  engine.SetInputTrim(cab, 0.0f);
  for (float sample : RunMono(engine, 0.5f)) OPENAXE_EXPECT(sample == 0.0f);

  // Trims stage the block's I/O, so they still apply while it is bypassed.
  engine.SetInputTrim(cab, 0.5f);
  engine.SetOutputTrim(cab, 1.0f);
  engine.SetBypass(cab, true);
  for (float sample : RunMono(engine, 0.5f)) OPENAXE_EXPECT(std::fabs(sample - 0.25f) < 1e-6f);

  engine.SetInputTrim(9999, 0.25f);   // unknown block: must not crash
  engine.SetOutputTrim(9999, 0.25f);
}

// The per-algorithm control mapping used to live in the web app's reverb
// worklet (JS index maps + the room-size/damping formulas), so the desktop
// path had no room size, damping or pre-delay at all. Core owns it now: these
// assert the resolution per algorithm through the public param surface.
void TestReverbControlsResolvePerAlgorithm() {
  AudioEngine engine;
  const BlockId reverb = engine.AddBlock(BlockKind::kReverb, 0, 0);
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, reverb, 0).ok);
  OPENAXE_EXPECT(engine.Connect(reverb, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  // Read a param back by symbol, or NaN when this algorithm has no such param.
  const auto paramBySymbol = [&](const char* symbol) {
    for (int i = 0; i < engine.ParamCount(reverb); ++i) {
      const auto info = engine.ParamInfo(reverb, i);
      if (info && info->symbol && std::strcmp(info->symbol, symbol) == 0) {
        return engine.GetParam(reverb, i);
      }
    }
    return std::numeric_limits<float>::quiet_NaN();
  };

  // Hall (the default): room size drives `decay` (0..0.97 -> 0.1..10s),
  // damping drives `high_cut` (0..1 -> 16000..1000Hz), pre-delay is `delay`.
  engine.SetReverbControl(reverb, ReverbControl::kRoomSize, 0.97f);
  OPENAXE_EXPECT(std::fabs(paramBySymbol("decay") - 10.0f) < 1e-3f);
  engine.SetReverbControl(reverb, ReverbControl::kRoomSize, 0.0f);
  OPENAXE_EXPECT(std::fabs(paramBySymbol("decay") - 0.1f) < 1e-3f);
  engine.SetReverbControl(reverb, ReverbControl::kDamping, 0.0f);
  OPENAXE_EXPECT(std::fabs(paramBySymbol("high_cut") - 16000.0f) < 1.0f);
  engine.SetReverbControl(reverb, ReverbControl::kDamping, 1.0f);
  OPENAXE_EXPECT(std::fabs(paramBySymbol("high_cut") - 1000.0f) < 1.0f);
  engine.SetReverbControl(reverb, ReverbControl::kPredelay, 25.0f);
  OPENAXE_EXPECT(std::fabs(paramBySymbol("delay") - 25.0f) < 1e-3f);
  engine.SetReverbControl(reverb, ReverbControl::kWidth, 120.0f);
  OPENAXE_EXPECT(std::fabs(paramBySymbol("width") - 120.0f) < 1e-3f);

  // Room: damping is `in_high_cut` here, and pre-delay its own `predelay`.
  engine.SetReverbAlgorithm(reverb, ReverbAlgorithm::kRoom);
  engine.SetReverbControl(reverb, ReverbControl::kDamping, 1.0f);
  OPENAXE_EXPECT(std::fabs(paramBySymbol("in_high_cut") - 1000.0f) < 1.0f);
  engine.SetReverbControl(reverb, ReverbControl::kPredelay, 30.0f);
  OPENAXE_EXPECT(std::fabs(paramBySymbol("predelay") - 30.0f) < 1e-3f);

  // Early Reflections has no decay/pre-delay/spin: those controls are no-ops,
  // while the ones it does have still resolve.
  engine.SetReverbAlgorithm(reverb, ReverbAlgorithm::kEarlyReflections);
  OPENAXE_EXPECT(std::isnan(paramBySymbol("decay")));
  engine.SetReverbControl(reverb, ReverbControl::kRoomSize, 0.5f);  // must not crash
  engine.SetReverbControl(reverb, ReverbControl::kPredelay, 30.0f);
  engine.SetReverbControl(reverb, ReverbControl::kSpin, 1.0f);
  engine.SetReverbControl(reverb, ReverbControl::kDamping, 1.0f);
  OPENAXE_EXPECT(std::fabs(paramBySymbol("high_cut") - 1000.0f) < 1.0f);

  // Values are clamped into the algorithm's own declared range.
  engine.SetReverbAlgorithm(reverb, ReverbAlgorithm::kHall);
  engine.SetReverbControl(reverb, ReverbControl::kWidth, 1000.0f);
  const auto width = paramBySymbol("width");
  OPENAXE_EXPECT(width <= 150.0f);

  // Non-reverb blocks ignore reverb controls.
  const BlockId cab = engine.AddBlock(BlockKind::kCab, 1, 0);
  engine.SetReverbControl(cab, ReverbControl::kRoomSize, 0.5f);  // must not crash
}

// The amp family's tone stack and its model-less behaviour. The 4-band stack
// used to exist only as Web Audio biquads in the web app, so the desktop path
// had no working Bass/Mid/Treble/Presence at all - the knobs resolved to no core
// param and were rejected by the bridge.
void TestAmpToneStackAndPassthroughWithoutModel() {
  AudioEngine engine;
  const BlockId amp = engine.AddBlock(BlockKind::kAmp, 0, 0);
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, amp, 0).ok);
  OPENAXE_EXPECT(engine.Connect(amp, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  // Fixed 7-param surface: two calibration values, slim size, four tone bands.
  OPENAXE_EXPECT(engine.ParamCount(amp) == 7);
  const auto symbolAt = [&](int index) {
    const auto info = engine.ParamInfo(amp, index);
    return info && info->symbol ? std::string(info->symbol) : std::string();
  };
  OPENAXE_EXPECT(symbolAt(3) == "bass");
  OPENAXE_EXPECT(symbolAt(4) == "mid");
  OPENAXE_EXPECT(symbolAt(5) == "treble");
  OPENAXE_EXPECT(symbolAt(6) == "presence");

  // No model loaded: the block passes audio through rather than repeating its
  // previous output buffer (which is what an untouched output buffer meant).
  for (float sample : RunMono(engine, 0.25f)) OPENAXE_EXPECT(std::fabs(sample - 0.25f) < 1e-6f);
  for (float sample : RunMono(engine, 0.0f)) OPENAXE_EXPECT(sample == 0.0f);

  // Flat tone stack is bit-exact, so a DC input comes back untouched.
  for (float sample : RunMono(engine, 0.5f)) OPENAXE_EXPECT(sample == 0.5f);

  // A bass boost lifts DC (the low shelf's passband extends down to 0Hz), which
  // is enough to prove the params actually reach the stack from Process(). The
  // 100Hz shelf takes longer than one 64-frame buffer to settle, so measure the
  // steady state rather than the transient.
  const auto settled = [&](float input) {
    std::vector<float> output;
    for (int i = 0; i < 60; ++i) output = RunMono(engine, input);
    return output.back();
  };

  engine.SetParam(amp, 3, 12.0f);
  OPENAXE_EXPECT(settled(0.5f) > 0.9f);  // +12dB on a 0.5 DC level

  // ...and a cut pulls it well below unity.
  engine.SetParam(amp, 3, -12.0f);
  OPENAXE_EXPECT(settled(0.5f) < 0.25f);

  // Values outside ±12dB are clamped by the stack rather than rejected.
  engine.SetParam(amp, 3, 100.0f);
  for (float sample : RunMono(engine, 0.1f)) OPENAXE_EXPECT(std::isfinite(sample));
}

// Runs one stereo buffer through the engine and returns {left, right} outputs.
// A constant input on both channels - mono source duplicated to both, so pan
// behaviour is visible on the stereo output.
std::pair<std::vector<float>, std::vector<float>> RunStereo(AudioEngine& engine,
                                                             float input_value) {
  std::vector<float> input_l(kFrames, input_value);
  std::vector<float> input_r(kFrames, input_value);
  std::vector<float> output_l(kFrames, 0.0f);
  std::vector<float> output_r(kFrames, 0.0f);
  const float* in_ptrs[2] = {input_l.data(), input_r.data()};
  float* out_ptrs[2] = {output_l.data(), output_r.data()};
  engine.Process(in_ptrs, 2, out_ptrs, 2, kFrames);
  return {output_l, output_r};
}

// Runs `blocks` buffers (discarding output) so a freshly-set, smoothed param
// settles to its target before an exact-value assertion - see issue #122,
// whose exponential ramp approaches the target asymptotically rather than
// snapping. 400 blocks at kFrames=64 / 48kHz is ~0.5s, ~17 time constants.
void SettleMono(AudioEngine& engine, float input_value, int blocks) {
  for (int b = 0; b < blocks; ++b) RunMono(engine, input_value);
}

// Runs `blocks` stereo buffers and returns the final {left, right} outputs.
std::pair<std::vector<float>, std::vector<float>> RunStereoSettled(AudioEngine& engine,
                                                                   float input_value,
                                                                   int blocks) {
  std::pair<std::vector<float>, std::vector<float>> out;
  for (int b = 0; b < blocks; ++b) out = RunStereo(engine, input_value);
  return out;
}

// Mixer per-input level and pan: the DSP that used to live only in the web
// MixerBlock's per-input GainNode + StereoPanner, now driven by core params so
// web and desktop share the same summing/pan behaviour.
void TestMixerPerInputLevelAndPan() {
  AudioEngine engine;
  const BlockId a = engine.AddBlock(BlockKind::kCab, 0, 0);
  const BlockId mixer = engine.AddBlock(BlockKind::kMixer, 0, 1);
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, a, 0).ok);
  OPENAXE_EXPECT(engine.Connect(a, 0, mixer, 0).ok);
  OPENAXE_EXPECT(engine.Connect(mixer, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  // Param surface: 4 inputs x (level + pan) = 8, first is in0_level (unity),
  // second in0_pan (centre).
  OPENAXE_EXPECT(engine.ParamCount(mixer) == 8);
  const auto info0 = engine.ParamInfo(mixer, 0);
  const auto info1 = engine.ParamInfo(mixer, 1);
  OPENAXE_EXPECT(info0 && std::string(info0->symbol) == "in0_level");
  OPENAXE_EXPECT(info1 && std::string(info1->symbol) == "in0_pan");
  OPENAXE_EXPECT(engine.GetParam(mixer, 0) == 1.0f);  // unity level default
  OPENAXE_EXPECT(engine.GetParam(mixer, 1) == 0.0f);  // centre pan default

  // Centre pan, unity level: both channels pass through untouched (equal-power
  // law normalised to unity at centre).
  auto [l, r] = RunStereo(engine, 0.5f);
  for (int i = 0; i < kFrames; ++i) {
    OPENAXE_EXPECT(std::fabs(l[static_cast<size_t>(i)] - 0.5f) < 1e-5f);
    OPENAXE_EXPECT(std::fabs(r[static_cast<size_t>(i)] - 0.5f) < 1e-5f);
  }

  // Per-input level scales the summed signal (0.5 * 0.5 = 0.25). The level is
  // exponentially smoothed (issue #122), so settle before the exact check.
  engine.SetParam(mixer, 0, 0.5f);
  std::tie(l, r) = RunStereoSettled(engine, 0.5f, 400);
  for (int i = 0; i < kFrames; ++i) {
    OPENAXE_EXPECT(std::fabs(l[static_cast<size_t>(i)] - 0.25f) < 1e-5f);
    OPENAXE_EXPECT(std::fabs(r[static_cast<size_t>(i)] - 0.25f) < 1e-5f);
  }

  // Hard left: everything to the left channel, right silent (equal-power gain
  // sqrt(2) at the extreme).
  engine.SetParam(mixer, 0, 1.0f);
  engine.SetParam(mixer, 1, -1.0f);
  std::tie(l, r) = RunStereoSettled(engine, 0.5f, 400);
  for (int i = 0; i < kFrames; ++i) {
    OPENAXE_EXPECT(std::fabs(l[static_cast<size_t>(i)] - 0.5f * 1.41421356f) < 1e-5f);
    // Hard-left pans the signal fully right; with the (smoothed) pan eased to
    // -1.0 the right channel approaches zero but only asymptotically, so assert
    // it's negligible rather than bit-exact zero.
    OPENAXE_EXPECT(std::fabs(r[static_cast<size_t>(i)]) < 1e-6f);
  }

  // Hard right: the reverse. cos(pi/2) is ~6e-17, so the left channel isn't
  // bit-exact zero - assert it's negligible rather than exactly zero.
  engine.SetParam(mixer, 1, 1.0f);
  std::tie(l, r) = RunStereoSettled(engine, 0.5f, 400);
  for (int i = 0; i < kFrames; ++i) {
    OPENAXE_EXPECT(std::fabs(l[static_cast<size_t>(i)]) < 1e-6f);
    OPENAXE_EXPECT(std::fabs(r[static_cast<size_t>(i)] - 0.5f * 1.41421356f) < 1e-5f);
  }
}


// issue #66: Process() walks per-block incoming edges (incoming_) rather than
// rescanning the whole flat edge list. This rig exercises the grouping in both
// directions: one block fans out to multiple targets (each target block gets
// exactly its own incoming edge), and a mixer fans those branches back in
// across its independent input ports (the mixer's incoming_ vector holds
// several edges) - all must be delivered so the summed output is correct.
//
// The fan-out source used to be a splitter, on its two output ports. That kind
// is gone, and fanning out was never what made it special - several edges off a
// single output port do the same thing, which is what this now uses.
void TestFanOutAndMixerFanInRouting() {
  AudioEngine engine;
  const BlockId source = engine.AddBlock(BlockKind::kCab, 0, 0);
  const BlockId cab_a = engine.AddBlock(BlockKind::kCab, 0, 1);
  const BlockId cab_b = engine.AddBlock(BlockKind::kCab, 1, 1);
  const BlockId mixer = engine.AddBlock(BlockKind::kMixer, 0, 2);  // fans in from a and b
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, source, 0).ok);
  OPENAXE_EXPECT(engine.Connect(source, 0, cab_a, 0).ok);
  OPENAXE_EXPECT(engine.Connect(source, 0, cab_b, 0).ok);
  OPENAXE_EXPECT(engine.Connect(cab_a, 0, mixer, 0).ok);
  OPENAXE_EXPECT(engine.Connect(cab_b, 0, mixer, 1).ok);
  OPENAXE_EXPECT(engine.Connect(mixer, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  const auto settled = [&](float input) {
    std::vector<float> output;
    for (int i = 0; i < 400; ++i) output = RunMono(engine, input);
    return output;
  };

  // Unity throughout: each fan-out branch carries 0.5, the mixer sums its two
  // unity-gain inputs (port0 + port1) into 1.0 output.
  for (float sample : settled(0.5f)) OPENAXE_EXPECT(std::fabs(sample - 1.0f) < 1e-5f);
  RunMono(engine, 0.5f);
  OPENAXE_EXPECT(std::fabs(engine.GetMeter(cab_a) - 0.5f) < 1e-5f);
  OPENAXE_EXPECT(std::fabs(engine.GetMeter(cab_b) - 0.5f) < 1e-5f);

  // Halving one branch must drop only that branch's contribution: the mixer
  // then sums 0.5 (from a) + 0.25 (from b) = 0.75. This proves both fan-out
  // edges and both mixer fan-in edges reached Process() through the per-block
  // incoming_ lists. The knob used to be the splitter's per-output level; with
  // that kind gone it is the mixer's per-input level instead - input 1's level
  // sits at index 1 * kMixerParamsPerInput.
  engine.SetParam(mixer, 2, 0.5f);
  for (float sample : settled(0.5f)) OPENAXE_EXPECT(std::fabs(sample - 0.75f) < 1e-5f);
}

void TestMasterLevelScalesOutput() {
  AudioEngine engine;
  const BlockId cab = engine.AddBlock(BlockKind::kCab, 0, 0);  // pure passthrough
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, cab, 0).ok);
  OPENAXE_EXPECT(engine.Connect(cab, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);
  OPENAXE_EXPECT(engine.GetMasterLevel() == 1.0f);

  for (float sample : RunMono(engine, 0.4f)) OPENAXE_EXPECT(std::fabs(sample - 0.4f) < 1e-6f);

  engine.SetMasterLevel(0.5f);
  OPENAXE_EXPECT(engine.GetMasterLevel() == 0.5f);
  for (float sample : RunMono(engine, 0.4f)) OPENAXE_EXPECT(std::fabs(sample - 0.2f) < 1e-6f);

  engine.SetMasterLevel(1.0f);
}

void TestMasterAndTunerMuteAreIndependentAndBothSilence() {
  AudioEngine engine;
  const BlockId cab = engine.AddBlock(BlockKind::kCab, 0, 0);
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, cab, 0).ok);
  OPENAXE_EXPECT(engine.Connect(cab, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);
  OPENAXE_EXPECT(!engine.IsMasterMuted());
  OPENAXE_EXPECT(!engine.IsTunerMuted());

  engine.SetMasterMuted(true);
  OPENAXE_EXPECT(engine.IsMasterMuted());
  for (float sample : RunMono(engine, 0.7f)) OPENAXE_EXPECT(sample == 0.0f);

  engine.SetMasterMuted(false);
  for (float sample : RunMono(engine, 0.7f)) OPENAXE_EXPECT(std::fabs(sample - 0.7f) < 1e-6f);

  // Tuner mute silences independently of master mute.
  engine.SetTunerMuted(true);
  OPENAXE_EXPECT(engine.IsTunerMuted());
  for (float sample : RunMono(engine, 0.7f)) OPENAXE_EXPECT(sample == 0.0f);

  // Toggling master mute while tuner-muted must not clear the tuner's mute.
  engine.SetMasterMuted(true);
  engine.SetMasterMuted(false);
  OPENAXE_EXPECT(engine.IsTunerMuted());
  for (float sample : RunMono(engine, 0.7f)) OPENAXE_EXPECT(sample == 0.0f);

  engine.SetTunerMuted(false);
  for (float sample : RunMono(engine, 0.7f)) OPENAXE_EXPECT(std::fabs(sample - 0.7f) < 1e-6f);
}

void TestModulationEffects() {
  // Chorus should produce non-silent wet with mix=1, and dry with mix=0
  {
    AudioEngine eng;
    auto id = eng.AddBlock(BlockKind::kChorus,0,0);
    eng.Connect(kInRailId,0,id,0);
    eng.Connect(id,0,kOutRailId,0);
    eng.Reset(48000,64);
    for(int i=0;i<20;i++) RunMono(eng, 0.3f);
    auto outWet = RunMono(eng, 0.3f);
    float maxWet=0; for(float v: outWet) maxWet=std::max(maxWet, std::fabs(v));
    std::printf("chorus wet %f\n", maxWet);
    OPENAXE_EXPECT(maxWet > 0.05f);
    int mixIdx = eng.ParamCount(id) - 1;  // engine mix is appended after the DSP table
    const auto mixInfo = eng.ParamInfo(id, mixIdx);
    OPENAXE_EXPECT(mixInfo.has_value() && mixInfo->symbol == std::string("mix"));
    eng.SetParam(id, mixIdx, 0.0f);
    for(int i=0;i<200;i++) RunMono(eng, 0.3f);
    auto outDry = RunMono(eng, 0.3f);
    float maxDry=0; for(float v: outDry) maxDry=std::max(maxDry, std::fabs(v));
    std::printf("chorus dry %f\n", maxDry);
    OPENAXE_EXPECT(std::fabs(maxDry-0.3f) < 0.05f);
  }
  // Delay in ping-pong mode (#314): repeats must alternate across the image.
  // The old standalone ping-pong-delay kind is gone; stereo_mode is a Delay
  // param now, orthogonal to model.
  {
    // Param indices, in kParamInfo order (see delay.cpp).
    constexpr int kTime = 0, kFeedback = 1, kStereoMode = 6, kWidth = 7, kMix = 8;
    constexpr double kSr = 48000.0;
    constexpr int kBlock = 128;
    constexpr float kTimeMs = 100.0f;

    AudioEngine eng;
    auto id = eng.AddBlock(BlockKind::kDelay, 0, 0);
    eng.Connect(kInRailId, 0, id, 0);
    eng.Connect(id, 0, kOutRailId, 0);
    eng.Reset(kSr, kBlock);
    eng.SetParam(id, kStereoMode, 1.0f);   // ping-pong
    eng.SetParam(id, kWidth, 1.0f);        // hard left/right
    eng.SetParam(id, kTime, kTimeMs);
    eng.SetParam(id, kFeedback, 0.6f);
    eng.SetParam(id, kMix, 1.0f);          // wet only, so the taps aren't masked by dry

    // Let the engine's param smoothing settle before the impulse, so the
    // first echo lands at the delay time rather than part-way through a ramp.
    for (int i = 0; i < 40; ++i) {
      std::vector<float> inL(kBlock, 0.0f), inR(kBlock, 0.0f), oL(kBlock, 0.0f), oR(kBlock, 0.0f);
      const float* in[2] = {inL.data(), inR.data()};
      float* out[2] = {oL.data(), oR.data()};
      eng.Process(in, 2, out, 2, kBlock);
    }

    // One impulse, then render three delay times' worth and record where each
    // echo lands. Ping-pong's defining property is the alternation, so that is
    // what this asserts - not the absolute levels, which the mix/feedback
    // staging owns.
    const int total = static_cast<int>(kSr * (kTimeMs / 1000.0f) * 3.5f);
    std::vector<float> wholeL, wholeR;
    bool first = true;
    for (int done = 0; done < total; done += kBlock) {
      std::vector<float> inL(kBlock, 0.0f), inR(kBlock, 0.0f), oL(kBlock, 0.0f), oR(kBlock, 0.0f);
      if (first) { inL[0] = 1.0f; inR[0] = 1.0f; first = false; }
      const float* in[2] = {inL.data(), inR.data()};
      float* out[2] = {oL.data(), oR.data()};
      eng.Process(in, 2, out, 2, kBlock);
      wholeL.insert(wholeL.end(), oL.begin(), oL.end());
      wholeR.insert(wholeR.end(), oR.begin(), oR.end());
    }

    // Peak in a window around each expected echo time.
    auto peak_near = [](const std::vector<float>& v, int centre, int radius) {
      float peak = 0.0f;
      const int lo = std::max(0, centre - radius);
      const int hi = std::min(static_cast<int>(v.size()), centre + radius);
      for (int i = lo; i < hi; ++i) peak = std::max(peak, std::fabs(v[i]));
      return peak;
    };
    const int step = static_cast<int>(kSr * kTimeMs / 1000.0f);
    const int radius = step / 4;

    const float echo1L = peak_near(wholeL, step, radius);
    const float echo1R = peak_near(wholeR, step, radius);
    const float echo2L = peak_near(wholeL, step * 2, radius);
    const float echo2R = peak_near(wholeR, step * 2, radius);

    // The input enters the left line, so the first repeat is left and the
    // second - having crossed over - is right. Each must clearly dominate its
    // opposite channel, which is the whole point of the mode.
    OPENAXE_EXPECT(echo1L > 0.05f);
    OPENAXE_EXPECT(echo1L > echo1R * 4.0f);
    OPENAXE_EXPECT(echo2R > 0.02f);
    OPENAXE_EXPECT(echo2R > echo2L * 4.0f);

    // Width 0 collapses the pair to the centre: both channels equal. Width is
    // a smoothed param, so let the ramp finish before asserting - during it
    // the output is legitimately still part-way between hard and centred.
    eng.SetParam(id, kWidth, 0.0f);
    auto render_block = [&](std::vector<float>& oL, std::vector<float>& oR) {
      std::vector<float> inL(kBlock, 0.0f), inR(kBlock, 0.0f);
      oL.assign(kBlock, 0.0f);
      oR.assign(kBlock, 0.0f);
      const float* in[2] = {inL.data(), inR.data()};
      float* out[2] = {oL.data(), oR.data()};
      eng.Process(in, 2, out, 2, kBlock);
    };
    std::vector<float> oL, oR;
    for (int i = 0; i < 60; ++i) render_block(oL, oR);  // settle the ramp
    for (int i = 0; i < 10; ++i) {
      render_block(oL, oR);
      for (int j = 0; j < kBlock; ++j) OPENAXE_EXPECT(std::fabs(oL[j] - oR[j]) < 1e-4f);
    }
  }
  {
    AudioEngine eng;
    auto id = eng.AddBlock(BlockKind::kFlanger,0,0);
    eng.Connect(kInRailId,0,id,0);
    eng.Connect(id,0,kOutRailId,0);
    eng.Reset(48000,64);
    for(int i=0;i<20;i++) RunMono(eng, 0.3f);
    auto out = RunMono(eng, 0.3f);
    float max=0; bool finite=true;
    for(float v: out) { max=std::max(max, std::fabs(v)); if(!std::isfinite(v)) finite=false; }
    OPENAXE_EXPECT(finite);
    OPENAXE_EXPECT(max < 2.0f && max > 0.05f);
  }
  {
    AudioEngine eng;
    auto id = eng.AddBlock(BlockKind::kPhaser,0,0);
    eng.Connect(kInRailId,0,id,0);
    eng.Connect(id,0,kOutRailId,0);
    eng.Reset(48000,64);
    for(int i=0;i<20;i++) RunMono(eng, 0.3f);
    auto out = RunMono(eng, 0.3f);
    float max=0; for(float v: out) max=std::max(max, std::fabs(v));
    OPENAXE_EXPECT(max > 0.05f);
  }
}

// Issue #383: the engine mix is one blend per family, picked by signal
// correlation - not one global linear crossfade. DC stimuli give exact,
// DSP-state-independent predictions per law, so each assertion below fails
// under the old linear law for its (non-linear) family and under a wrong
// family mapping.
namespace {
float MeanOfLastMonoBlock(AudioEngine& engine, float value, int settle_blocks) {
  SettleMono(engine, value, settle_blocks);
  const auto out = RunMono(engine, value);
  float mean = 0.0f;
  for (float s : out) mean += s;
  return mean / static_cast<float>(out.size());
}
float PeakOfMonoRun(AudioEngine& engine, float value, int blocks) {
  float peak = 0.0f;
  for (int i = 0; i < blocks; ++i)
    for (float s : RunMono(engine, value)) peak = std::max(peak, std::fabs(s));
  return peak;
}
// The engine mix is appended after the DSP table (and delay appends a level
// after that), so locate it by symbol instead of hardcoding an index.
int EngineMixIndex(AudioEngine& engine, BlockId id) {
  for (int i = 0; i < engine.ParamCount(id); ++i) {
    const auto info = engine.ParamInfo(id, i);
    if (info.has_value() && info->symbol == std::string("mix")) return i;
  }
  return -1;
}
}  // namespace

void TestEngineMixLaws() {
  // Linear (noise gate; DC 0.5 sits far above the -40 dB default threshold so
  // the gate is open and wet == dry): 50% must sum back to exactly dry.
  {
    AudioEngine eng;
    const BlockId id = eng.AddBlock(BlockKind::kNoiseGate, 0, 0);
    eng.Connect(kInRailId, 0, id, 0);
    eng.Connect(id, 0, kOutRailId, 0);
    eng.Reset(48000.0, kFrames);
    const int kMix = EngineMixIndex(eng, id);
    OPENAXE_EXPECT(kMix >= 0);

    eng.SetParam(id, kMix, 0.0f);
    OPENAXE_EXPECT(std::fabs(MeanOfLastMonoBlock(eng, 0.5f, 300) - 0.5f) < 1e-3f);

    eng.SetParam(id, kMix, 0.5f);
    const float half = MeanOfLastMonoBlock(eng, 0.5f, 300);
    std::printf("gate linear 50%% %f\n", half);
    OPENAXE_EXPECT(std::fabs(half - 0.5f) < 1e-3f);  // additive would read 0.75

    eng.SetParam(id, kMix, 1.0f);
    OPENAXE_EXPECT(std::fabs(MeanOfLastMonoBlock(eng, 0.5f, 300) - 0.5f) < 0.02f);
  }

  // Equal-power, exact when the DSP is available (ring-mod; drive=0 so wet is
  // a pure 400 Hz multiply of dry): with DC dry the 50% peak is
  // cos(45°)*dry + sin(45°)*wet-peak, not the linear half+half. Compiled out
  // of some configs (effects.config.json) - the stopped-rotor test below
  // covers the law in every build.
#if OPENAXE_BLOCK_RING_MOD_COMPILED
  {
    AudioEngine eng;
    const BlockId id = eng.AddBlock(BlockKind::kRingMod, 0, 0);
    eng.Connect(kInRailId, 0, id, 0);
    eng.Connect(id, 0, kOutRailId, 0);
    eng.Reset(48000.0, kFrames);
    const int kMix = EngineMixIndex(eng, id);
    OPENAXE_EXPECT(kMix >= 0);
    constexpr int kDrive = 1;
    eng.SetParam(id, kDrive, 0.0f);

    eng.SetParam(id, kMix, 1.0f);
    SettleMono(eng, 0.5f, 300);
    const float wetPeak = PeakOfMonoRun(eng, 0.5f, 60);
    std::printf("ringmod wet peak %f\n", wetPeak);
    OPENAXE_EXPECT(std::fabs(wetPeak - 0.5f) < 0.03f);

    eng.SetParam(id, kMix, 0.5f);
    SettleMono(eng, 0.5f, 300);
    const float midPeak = PeakOfMonoRun(eng, 0.5f, 60);
    const float predicted = 0.70710678f * 0.5f + 0.70710678f * wetPeak;
    std::printf("ringmod eq-power 50%% peak %f (predicted %f)\n", midPeak, predicted);
    OPENAXE_EXPECT(std::fabs(midPeak - predicted) < 0.03f);
    OPENAXE_EXPECT(midPeak > 0.6f);  // linear would peak at 0.5

    eng.SetParam(id, kMix, 0.0f);
    OPENAXE_EXPECT(std::fabs(MeanOfLastMonoBlock(eng, 0.5f, 300) - 0.5f) < 1e-3f);
  }
#endif

  // Equal-power, always compiled (rotary with speed=Stop: the frozen rotor is
  // a static filter, so wet of DC is a constant and the 50% mean is exactly
  // cos(45°)*dry + sin(45°)*wet - the same prediction as above, through the
  // decorrelated-replacement family member every build ships).
  {
    AudioEngine eng;
    const BlockId id = eng.AddBlock(BlockKind::kRotary, 0, 0);
    eng.Connect(kInRailId, 0, id, 0);
    eng.Connect(id, 0, kOutRailId, 0);
    eng.Reset(48000.0, kFrames);
    const int kMix = EngineMixIndex(eng, id);
    OPENAXE_EXPECT(kMix >= 0);
    int speedIdx = -1;
    for (int i = 0; i < eng.ParamCount(id); ++i) {
      const auto info = eng.ParamInfo(id, i);
      if (info.has_value() && info->symbol == std::string("speed")) speedIdx = i;
    }
    OPENAXE_EXPECT(speedIdx >= 0);
    eng.SetParam(id, speedIdx, 0.0f);  // Stop: rotor frozen from the first block

    eng.SetParam(id, kMix, 1.0f);
    SettleMono(eng, 0.5f, 400);
    const auto wetOut = RunMono(eng, 0.5f);
    float wetMean = 0.0f, wetMax = -1e30f, wetMin = 1e30f;
    for (float s : wetOut) {
      wetMean += s;
      wetMax = std::max(wetMax, s);
      wetMin = std::min(wetMin, s);
    }
    wetMean /= static_cast<float>(wetOut.size());
    std::printf("rotary stopped wet %f (spread %f)\n", wetMean, wetMax - wetMin);
    OPENAXE_EXPECT(wetMax - wetMin < 0.01f);  // static rotor: wet must be constant

    eng.SetParam(id, kMix, 0.5f);
    const float mid = MeanOfLastMonoBlock(eng, 0.5f, 400);
    const float predicted = 0.70710678f * 0.5f + 0.70710678f * wetMean;
    std::printf("rotary eq-power 50%% %f (predicted %f)\n", mid, predicted);
    OPENAXE_EXPECT(std::fabs(mid - predicted) < 0.02f);
    // Linear would read 0.5*(0.5+wet), additive 0.5+0.5*wet: both miss the
    // equal-power prediction by >0.05 for any wet in [-0.5, 0.5].
    OPENAXE_EXPECT(std::fabs(mid - 0.5f * (0.5f + wetMean)) > 0.05f);

    eng.SetParam(id, kMix, 0.0f);
    OPENAXE_EXPECT(std::fabs(MeanOfLastMonoBlock(eng, 0.5f, 400) - 0.5f) < 1e-3f);
  }

  // Additive with kill-dry (delay; digital model + zero feedback so wet is a
  // pure delayed tap): dry stays at unity, 50% == dry + 0.5*wet, and 100%
  // kills dry.
  {
    AudioEngine eng;
    const BlockId id = eng.AddBlock(BlockKind::kDelay, 0, 0);
    eng.Connect(kInRailId, 0, id, 0);
    eng.Connect(id, 0, kOutRailId, 0);
    eng.Reset(48000.0, kFrames);
    const int kMix = EngineMixIndex(eng, id);
    OPENAXE_EXPECT(kMix >= 0);
    constexpr int kTime = 0, kFeedback = 1;
    eng.SetParam(id, kTime, 50.0f);
    eng.SetParam(id, kFeedback, 0.0f);

    eng.SetParam(id, kMix, 1.0f);
    const float wet = MeanOfLastMonoBlock(eng, 0.4f, 300);  // also fills the 50 ms line
    std::printf("delay wet DC %f\n", wet);
    OPENAXE_EXPECT(std::fabs(wet - 0.4f) < 0.03f);

    eng.SetParam(id, kMix, 0.5f);
    const float half = MeanOfLastMonoBlock(eng, 0.4f, 300);
    std::printf("delay additive 50%% %f (predicted %f)\n", half, 0.4f + 0.5f * wet);
    OPENAXE_EXPECT(std::fabs(half - (0.4f + 0.5f * wet)) < 0.02f);
    OPENAXE_EXPECT(half > 0.5f);  // linear would read ~0.4 (dry thinned)

    eng.SetParam(id, kMix, 0.0f);
    OPENAXE_EXPECT(std::fabs(MeanOfLastMonoBlock(eng, 0.4f, 300) - 0.4f) < 1e-3f);

    // Kill-dry handoff: 50% -> 100% must stay finite and converge to wet,
    // with no burst from the >=0.999 dry mute. Settle first so the ramp
    // transient doesn't pollute the converged assertion, and bound the peak
    // across the whole sweep (dry 0.4 + wet 0.4 can never legitimately exceed
    // ~0.8, so anything near/above 1.0 is a handoff burst).
    eng.SetParam(id, kMix, 0.5f);
    SettleMono(eng, 0.4f, 300);
    eng.SetParam(id, kMix, 1.0f);
    bool finite = true;
    float sweepPeak = 0.0f;
    for (int i = 0; i < 300; ++i) {
      for (float s : RunMono(eng, 0.4f)) {
        if (!std::isfinite(s)) finite = false;
        sweepPeak = std::max(sweepPeak, std::fabs(s));
      }
    }
    const auto killTail = RunMono(eng, 0.4f);
    float killMean = 0.0f;
    for (float s : killTail) killMean += s;
    killMean /= static_cast<float>(killTail.size());
    std::printf("delay kill-dry 100%% %f sweepPeak %f (wet %f)\n", killMean, sweepPeak, wet);
    OPENAXE_EXPECT(finite);
    OPENAXE_EXPECT(sweepPeak < 1.0f);
    OPENAXE_EXPECT(std::fabs(killMean - wet) < 0.03f);
  }
}

// GetGainReduction / GetGateGain (issue #361): the Tier-1 metering getters
// must report real compressor gain reduction and gate openness, not a
// constant 0 - they were previously dead because the #if guards named
// never-defined OPENAXE_BLOCK_* macros (the generated header only defines the
// *_COMPILED variants), so the if constexpr dispatch compiled out entirely.
void TestDynamicsMetering() {
  AudioEngine engine;
  const BlockId compressor = engine.AddBlock(BlockKind::kCompressor, 0, 0);
  const BlockId gate = engine.AddBlock(BlockKind::kNoiseGate, 0, 1);
  const BlockId cab = engine.AddBlock(BlockKind::kCab, 0, 2);  // no dynamics DSP
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, compressor, 0).ok);
  OPENAXE_EXPECT(engine.Connect(compressor, 0, gate, 0).ok);
  OPENAXE_EXPECT(engine.Connect(gate, 0, cab, 0).ok);
  OPENAXE_EXPECT(engine.Connect(cab, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  // Unknown / non-dynamics blocks always report "no metering".
  OPENAXE_EXPECT(engine.GetGainReduction(9999) == 0.0f);
  OPENAXE_EXPECT(engine.GetGateGain(9999) == 0.0f);
  OPENAXE_EXPECT(engine.GetGainReduction(cab) == 0.0f);
  OPENAXE_EXPECT(engine.GetGateGain(cab) == 0.0f);

  // A hot signal drives the compressor ~13 dB past its -18 dB threshold at
  // 4:1, so it must report real gain reduction (dB < 0), and the gate (well
  // above its -40 dB threshold) must sit open: gain ≈ 1, its own GR ≈ 0.
  for (int i = 0; i < 20; ++i) RunMono(engine, 0.9f);
  const float comp_gr = engine.GetGainReduction(compressor);
  const float gate_gr = engine.GetGainReduction(gate);
  const float gate_open = engine.GetGateGain(gate);
  OPENAXE_EXPECT(std::isfinite(comp_gr));
  OPENAXE_EXPECT(comp_gr < -3.0f);
  OPENAXE_EXPECT(std::isfinite(gate_gr));
  OPENAXE_EXPECT(gate_gr > -1.0f);  // an open gate applies ~0 dB
  OPENAXE_EXPECT(gate_open > 0.9f);

  // Silence for well past the gate's default 100 ms release closes it: the
  // meter must read a closed gate (openness → 0, its GR → deep attenuation).
  for (int i = 0; i < 400; ++i) RunMono(engine, 0.0f);
  const float gate_closed = engine.GetGateGain(gate);
  const float gate_closed_gr = engine.GetGainReduction(gate);
  OPENAXE_EXPECT(gate_closed < 0.1f);
  OPENAXE_EXPECT(gate_closed_gr < -20.0f);
}

// Send/Return pairs (issue #274): a Send N relays its single input into the
// Return N with no cable between them, even across distant columns. Both are
// no-param passthrough relays and their meters still report the signal, so a
// user can watch the hop across the grid.
void TestSendReturnRoutesImplicitlyAcrossColumns() {
  AudioEngine engine;
  const BlockId src = engine.AddBlock(BlockKind::kCab, 0, 0);
  const BlockId send = engine.AddBlock(BlockKind::kSend1, 0, 1);
  const BlockId ret = engine.AddBlock(BlockKind::kReturn1, 0, 4);
  const BlockId sink = engine.AddBlock(BlockKind::kCab, 0, 5);
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, src, 0).ok);
  OPENAXE_EXPECT(engine.Connect(src, 0, send, 0).ok);
  OPENAXE_EXPECT(engine.Connect(ret, 0, sink, 0).ok);
  OPENAXE_EXPECT(engine.Connect(sink, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  const auto output = RunMono(engine, 0.5f);
  for (float sample : output) OPENAXE_EXPECT(std::fabs(sample - 0.5f) < 1e-6f);
  // The relays expose no params...
  OPENAXE_EXPECT(engine.ParamCount(send) == 0);
  OPENAXE_EXPECT(engine.ParamCount(ret) == 0);
  // ...and their meters show the passed-through peak.
  OPENAXE_EXPECT(engine.GetMeter(send) > 0.49f);
  OPENAXE_EXPECT(engine.GetMeter(ret) > 0.49f);
}

// The implicit link is the one exception to the left-to-right column rule: a
// Return sitting to the LEFT of its Send still receives the Send's signal
// (the exec order is a topological sort, not a plain column sort).
void TestSendReturnWorksWithReturnLeftOfSend() {
  AudioEngine engine;
  const BlockId src = engine.AddBlock(BlockKind::kCab, 0, 0);
  const BlockId ret = engine.AddBlock(BlockKind::kReturn1, 0, 1);  // left of the send
  const BlockId send = engine.AddBlock(BlockKind::kSend1, 0, 3);
  const BlockId sink = engine.AddBlock(BlockKind::kCab, 0, 5);
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, src, 0).ok);
  OPENAXE_EXPECT(engine.Connect(src, 0, send, 0).ok);
  OPENAXE_EXPECT(engine.Connect(ret, 0, sink, 0).ok);
  OPENAXE_EXPECT(engine.Connect(sink, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  const auto output = RunMono(engine, 0.5f);
  for (float sample : output) OPENAXE_EXPECT(std::fabs(sample - 0.5f) < 1e-6f);
}

// Send 2 / Return 2 are an independent pair from Send 1 / Return 1 - both hops
// can be chained in series through ordinary cables.
void TestSendReturnSecondPairRoutesIndependently() {
  AudioEngine engine;
  const BlockId src = engine.AddBlock(BlockKind::kCab, 0, 0);
  const BlockId send1 = engine.AddBlock(BlockKind::kSend1, 0, 1);
  const BlockId ret1 = engine.AddBlock(BlockKind::kReturn1, 0, 2);
  const BlockId send2 = engine.AddBlock(BlockKind::kSend2, 0, 3);
  const BlockId ret2 = engine.AddBlock(BlockKind::kReturn2, 0, 4);
  const BlockId sink = engine.AddBlock(BlockKind::kCab, 0, 5);
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, src, 0).ok);
  OPENAXE_EXPECT(engine.Connect(src, 0, send1, 0).ok);
  OPENAXE_EXPECT(engine.Connect(ret1, 0, send2, 0).ok);
  OPENAXE_EXPECT(engine.Connect(ret2, 0, sink, 0).ok);
  OPENAXE_EXPECT(engine.Connect(sink, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  const auto output = RunMono(engine, 0.5f);
  for (float sample : output) OPENAXE_EXPECT(std::fabs(sample - 0.5f) < 1e-6f);
}

// An unpaired Send drops its signal at the Send; an unpaired Return stays
// silent - exactly like an unplugged bus.
void TestUnpairedSendAndReturnSilent() {
  AudioEngine engine;
  const BlockId src = engine.AddBlock(BlockKind::kCab, 0, 0);
  const BlockId send = engine.AddBlock(BlockKind::kSend1, 0, 1);       // no Return 1
  const BlockId orphan_ret = engine.AddBlock(BlockKind::kReturn2, 0, 3);  // no Send 2
  const BlockId sink = engine.AddBlock(BlockKind::kCab, 0, 5);
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, src, 0).ok);
  OPENAXE_EXPECT(engine.Connect(src, 0, send, 0).ok);
  OPENAXE_EXPECT(engine.Connect(orphan_ret, 0, sink, 0).ok);
  OPENAXE_EXPECT(engine.Connect(sink, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  const auto output = RunMono(engine, 0.5f);
  for (float sample : output) OPENAXE_EXPECT(sample == 0.0f);
  OPENAXE_EXPECT(engine.GetMeter(orphan_ret) == 0.0f);
}

// A cable from a Return back around into the same pair's Send completes a
// cycle through the implicit link (Return left of Send, so the cable is valid
// left-to-right). The engine must break the implicit link - the pair behaves
// as unpaired - rather than deadlock the grid, and an unrelated healthy pair
// must keep routing.
void TestSendReturnCycleIsBrokenNotDeadlocked() {
  AudioEngine engine;
  const BlockId src = engine.AddBlock(BlockKind::kCab, 0, 0);
  const BlockId ret1 = engine.AddBlock(BlockKind::kReturn1, 0, 1);
  const BlockId send2 = engine.AddBlock(BlockKind::kSend2, 0, 2);
  const BlockId send1 = engine.AddBlock(BlockKind::kSend1, 0, 4);
  const BlockId ret2 = engine.AddBlock(BlockKind::kReturn2, 0, 5);
  const BlockId sink = engine.AddBlock(BlockKind::kCab, 0, 6);
  // Pair 1 forms a cycle: send1 -> ret1 (implicit) plus ret1 -> send1 (cable).
  OPENAXE_EXPECT(engine.Connect(ret1, 0, send1, 0).ok);
  // Pair 2 is healthy and independent: src -> send2 -> [implicit] ret2 -> sink.
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, src, 0).ok);
  OPENAXE_EXPECT(engine.Connect(src, 0, send2, 0).ok);
  OPENAXE_EXPECT(engine.Connect(ret2, 0, sink, 0).ok);
  OPENAXE_EXPECT(engine.Connect(sink, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  const auto output = RunMono(engine, 0.5f);
  for (float sample : output) OPENAXE_EXPECT(std::fabs(sample - 0.5f) < 1e-6f);
}

// A Send and its Return may share a grid column (different rows). The exec
// order tie-break still runs the Send first, so the Return reads a fresh
// output rather than a stale one.
void TestSendReturnInSameColumnStillRoutes() {
  AudioEngine engine;
  const BlockId src = engine.AddBlock(BlockKind::kCab, 0, 0);
  const BlockId send = engine.AddBlock(BlockKind::kSend1, 0, 2);
  const BlockId ret = engine.AddBlock(BlockKind::kReturn1, 1, 2);  // same column as the send
  const BlockId sink = engine.AddBlock(BlockKind::kCab, 0, 3);
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, src, 0).ok);
  OPENAXE_EXPECT(engine.Connect(src, 0, send, 0).ok);
  OPENAXE_EXPECT(engine.Connect(ret, 0, sink, 0).ok);
  OPENAXE_EXPECT(engine.Connect(sink, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  const auto output = RunMono(engine, 0.5f);
  for (float sample : output) OPENAXE_EXPECT(std::fabs(sample - 0.5f) < 1e-6f);
}

// The input meter reports the post-input-trim peak - what the block's DSP
// actually received - while the output meter reports the post-output-trim
// peak, so the inspector's IN/OUT pair shows gain staging through the block.
void TestInputMeterTracksPostTrimInput() {
  AudioEngine engine;
  const BlockId first = engine.AddBlock(BlockKind::kCab, 0, 0);  // pure passthrough
  const BlockId second = engine.AddBlock(BlockKind::kCab, 0, 1);
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, first, 0).ok);
  OPENAXE_EXPECT(engine.Connect(first, 0, second, 0).ok);
  OPENAXE_EXPECT(engine.Connect(second, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  // Unknown blocks read 0 on both meters.
  OPENAXE_EXPECT(engine.GetInputMeter(9999) == 0.0f);
  OPENAXE_EXPECT(engine.GetMeter(9999) == 0.0f);

  // Unity trims: the second block's input is the first block's output.
  RunMono(engine, 0.5f);
  OPENAXE_EXPECT(std::fabs(engine.GetInputMeter(second) - 0.5f) < 1e-5f);
  OPENAXE_EXPECT(std::fabs(engine.GetMeter(second) - 0.5f) < 1e-5f);

  // The input trim moves the IN meter; the output trim moves the OUT meter.
  engine.SetInputTrim(second, 0.5f);
  engine.SetOutputTrim(second, 0.5f);
  RunMono(engine, 0.5f);
  OPENAXE_EXPECT(std::fabs(engine.GetInputMeter(second) - 0.25f) < 1e-5f);
  OPENAXE_EXPECT(std::fabs(engine.GetMeter(second) - 0.125f) < 1e-5f);
}

}  // namespace

int main() {
  TestPassthroughForUnwrappedKind();
  TestMixerSumsBothConnectedPorts();
  TestMixerPerInputLevelAndPan();
  TestFanOutAndMixerFanInRouting();
  TestUnconnectedOutputIsSilent();
  TestReverbDefaultsToHallThenSwitchesAlgorithm();
  TestReverbAlgorithmGetRoundTripsAllFive();
  TestDsparkKindsDefaultParamsAndProcessRealAudio();
  TestUnknownBlockIsSafeNoOp();
  TestBypassSkipsDspAndPassesInputThrough();
  TestBlockTrimsScaleInputAndOutput();
  TestReverbControlsResolvePerAlgorithm();
  TestAmpToneStackAndPassthroughWithoutModel();
  TestMasterLevelScalesOutput();
  TestMasterAndTunerMuteAreIndependentAndBothSilence();
  TestModulationEffects();
  TestEngineMixLaws();
  TestDynamicsMetering();
  TestSendReturnRoutesImplicitlyAcrossColumns();
  TestSendReturnWorksWithReturnLeftOfSend();
  TestSendReturnSecondPairRoutesIndependently();
  TestUnpairedSendAndReturnSilent();
  TestSendReturnCycleIsBrokenNotDeadlocked();
  TestSendReturnInSameColumnStillRoutes();
  TestInputMeterTracksPostTrimInput();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}
