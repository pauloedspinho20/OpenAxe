// Tests the real-time audio wiring layer built on top of GraphRig for issue
// #14's extern "C" ABI: buffer routing, mixer summing, passthrough for
// not-yet-wrapped block kinds, and reverb algorithm switching. Exercises
// nam_studio::engine::AudioEngine directly (not the extern "C" surface - see
// api_realtime_test.cpp for that). Needs NAM_CORE_DIR/DRAGONFLY_DIR
// initialized, same as the rest of nam_studio_core - see CMakeLists.txt's
// comment on why engine.cpp doesn't degrade gracefully like the rest of
// this file.
#include "nam_studio/engine.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

#include "nam_studio/dsp/compressor.h"
#include "nam_studio/dsp/dragonfly_hall_reverb.h"
#include "nam_studio/dsp/dragonfly_plate_reverb.h"
#include "nam_studio/dsp/equalizer.h"
#include "nam_studio/dsp/noise_gate.h"
#include "nam_studio/dsp/tremolo.h"
#include "test_harness.h"

using nam_studio::engine::AudioEngine;
using nam_studio::engine::BlockId;
using nam_studio::engine::kInRailId;
using nam_studio::engine::kOutRailId;
using nam_studio::engine::ReverbAlgorithm;
using nam_studio::engine::ReverbControl;
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

// Per-block I/O trims: the user-facing Input/Output knobs every block kind
// shows. Before these existed the web app applied them with its own Web Audio
// GainNodes and the desktop path forwarded them onto the Amp family's
// input_level/output_level params, which are the loaded model's dBu
// calibration - so a trim either did nothing or recalibrated the amp.
void TestBlockTrimsScaleInputAndOutput() {
  AudioEngine engine;
  const BlockId cab = engine.AddBlock(BlockKind::kCab, 0, 0);  // pure passthrough
  NAM_EXPECT(engine.Connect(kInRailId, 0, cab, 0).ok);
  NAM_EXPECT(engine.Connect(cab, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  // Unity by default, on both trims and for an unknown block.
  NAM_EXPECT(engine.GetInputTrim(cab) == 1.0f);
  NAM_EXPECT(engine.GetOutputTrim(cab) == 1.0f);
  NAM_EXPECT(engine.GetInputTrim(9999) == 1.0f);
  for (float sample : RunMono(engine, 0.5f)) NAM_EXPECT(std::fabs(sample - 0.5f) < 1e-6f);

  engine.SetInputTrim(cab, 0.5f);
  NAM_EXPECT(engine.GetInputTrim(cab) == 0.5f);
  for (float sample : RunMono(engine, 0.5f)) NAM_EXPECT(std::fabs(sample - 0.25f) < 1e-6f);

  // Both trims compose multiplicatively (0.5 * 0.5 * 0.5 = 0.125).
  engine.SetOutputTrim(cab, 0.5f);
  for (float sample : RunMono(engine, 0.5f)) NAM_EXPECT(std::fabs(sample - 0.125f) < 1e-6f);

  // Zero really mutes the block (the case the old symbol collision got wrong:
  // 0 written to the amp's input_level meant "0 dBu", i.e. unity).
  engine.SetInputTrim(cab, 0.0f);
  for (float sample : RunMono(engine, 0.5f)) NAM_EXPECT(sample == 0.0f);

  // Trims stage the block's I/O, so they still apply while it is bypassed.
  engine.SetInputTrim(cab, 0.5f);
  engine.SetOutputTrim(cab, 1.0f);
  engine.SetBypass(cab, true);
  for (float sample : RunMono(engine, 0.5f)) NAM_EXPECT(std::fabs(sample - 0.25f) < 1e-6f);

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
  NAM_EXPECT(engine.Connect(kInRailId, 0, reverb, 0).ok);
  NAM_EXPECT(engine.Connect(reverb, 0, kOutRailId, 0).ok);
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
  NAM_EXPECT(std::fabs(paramBySymbol("decay") - 10.0f) < 1e-3f);
  engine.SetReverbControl(reverb, ReverbControl::kRoomSize, 0.0f);
  NAM_EXPECT(std::fabs(paramBySymbol("decay") - 0.1f) < 1e-3f);
  engine.SetReverbControl(reverb, ReverbControl::kDamping, 0.0f);
  NAM_EXPECT(std::fabs(paramBySymbol("high_cut") - 16000.0f) < 1.0f);
  engine.SetReverbControl(reverb, ReverbControl::kDamping, 1.0f);
  NAM_EXPECT(std::fabs(paramBySymbol("high_cut") - 1000.0f) < 1.0f);
  engine.SetReverbControl(reverb, ReverbControl::kPredelay, 25.0f);
  NAM_EXPECT(std::fabs(paramBySymbol("delay") - 25.0f) < 1e-3f);
  engine.SetReverbControl(reverb, ReverbControl::kWidth, 120.0f);
  NAM_EXPECT(std::fabs(paramBySymbol("width") - 120.0f) < 1e-3f);

  // Room: damping is `in_high_cut` here, and pre-delay its own `predelay`.
  engine.SetReverbAlgorithm(reverb, ReverbAlgorithm::kRoom);
  engine.SetReverbControl(reverb, ReverbControl::kDamping, 1.0f);
  NAM_EXPECT(std::fabs(paramBySymbol("in_high_cut") - 1000.0f) < 1.0f);
  engine.SetReverbControl(reverb, ReverbControl::kPredelay, 30.0f);
  NAM_EXPECT(std::fabs(paramBySymbol("predelay") - 30.0f) < 1e-3f);

  // Early Reflections has no decay/pre-delay/spin: those controls are no-ops,
  // while the ones it does have still resolve.
  engine.SetReverbAlgorithm(reverb, ReverbAlgorithm::kEarlyReflections);
  NAM_EXPECT(std::isnan(paramBySymbol("decay")));
  engine.SetReverbControl(reverb, ReverbControl::kRoomSize, 0.5f);  // must not crash
  engine.SetReverbControl(reverb, ReverbControl::kPredelay, 30.0f);
  engine.SetReverbControl(reverb, ReverbControl::kSpin, 1.0f);
  engine.SetReverbControl(reverb, ReverbControl::kDamping, 1.0f);
  NAM_EXPECT(std::fabs(paramBySymbol("high_cut") - 1000.0f) < 1.0f);

  // Values are clamped into the algorithm's own declared range.
  engine.SetReverbAlgorithm(reverb, ReverbAlgorithm::kHall);
  engine.SetReverbControl(reverb, ReverbControl::kWidth, 1000.0f);
  const auto width = paramBySymbol("width");
  NAM_EXPECT(width <= 150.0f);

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
  NAM_EXPECT(engine.Connect(kInRailId, 0, amp, 0).ok);
  NAM_EXPECT(engine.Connect(amp, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  // Fixed 7-param surface: two calibration values, slim size, four tone bands.
  NAM_EXPECT(engine.ParamCount(amp) == 7);
  const auto symbolAt = [&](int index) {
    const auto info = engine.ParamInfo(amp, index);
    return info && info->symbol ? std::string(info->symbol) : std::string();
  };
  NAM_EXPECT(symbolAt(3) == "bass");
  NAM_EXPECT(symbolAt(4) == "mid");
  NAM_EXPECT(symbolAt(5) == "treble");
  NAM_EXPECT(symbolAt(6) == "presence");

  // No model loaded: the block passes audio through rather than repeating its
  // previous output buffer (which is what an untouched output buffer meant).
  for (float sample : RunMono(engine, 0.25f)) NAM_EXPECT(std::fabs(sample - 0.25f) < 1e-6f);
  for (float sample : RunMono(engine, 0.0f)) NAM_EXPECT(sample == 0.0f);

  // Flat tone stack is bit-exact, so a DC input comes back untouched.
  for (float sample : RunMono(engine, 0.5f)) NAM_EXPECT(sample == 0.5f);

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
  NAM_EXPECT(settled(0.5f) > 0.9f);  // +12dB on a 0.5 DC level

  // ...and a cut pulls it well below unity.
  engine.SetParam(amp, 3, -12.0f);
  NAM_EXPECT(settled(0.5f) < 0.25f);

  // Values outside ±12dB are clamped by the stack rather than rejected.
  engine.SetParam(amp, 3, 100.0f);
  for (float sample : RunMono(engine, 0.1f)) NAM_EXPECT(std::isfinite(sample));
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
  NAM_EXPECT(engine.Connect(kInRailId, 0, a, 0).ok);
  NAM_EXPECT(engine.Connect(a, 0, mixer, 0).ok);
  NAM_EXPECT(engine.Connect(mixer, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  // Param surface: 4 inputs x (level + pan) = 8, first is in0_level (unity),
  // second in0_pan (centre).
  NAM_EXPECT(engine.ParamCount(mixer) == 8);
  const auto info0 = engine.ParamInfo(mixer, 0);
  const auto info1 = engine.ParamInfo(mixer, 1);
  NAM_EXPECT(info0 && std::string(info0->symbol) == "in0_level");
  NAM_EXPECT(info1 && std::string(info1->symbol) == "in0_pan");
  NAM_EXPECT(engine.GetParam(mixer, 0) == 1.0f);  // unity level default
  NAM_EXPECT(engine.GetParam(mixer, 1) == 0.0f);  // centre pan default

  // Centre pan, unity level: both channels pass through untouched (equal-power
  // law normalised to unity at centre).
  auto [l, r] = RunStereo(engine, 0.5f);
  for (int i = 0; i < kFrames; ++i) {
    NAM_EXPECT(std::fabs(l[static_cast<size_t>(i)] - 0.5f) < 1e-5f);
    NAM_EXPECT(std::fabs(r[static_cast<size_t>(i)] - 0.5f) < 1e-5f);
  }

  // Per-input level scales the summed signal (0.5 * 0.5 = 0.25). The level is
  // exponentially smoothed (issue #122), so settle before the exact check.
  engine.SetParam(mixer, 0, 0.5f);
  std::tie(l, r) = RunStereoSettled(engine, 0.5f, 400);
  for (int i = 0; i < kFrames; ++i) {
    NAM_EXPECT(std::fabs(l[static_cast<size_t>(i)] - 0.25f) < 1e-5f);
    NAM_EXPECT(std::fabs(r[static_cast<size_t>(i)] - 0.25f) < 1e-5f);
  }

  // Hard left: everything to the left channel, right silent (equal-power gain
  // sqrt(2) at the extreme).
  engine.SetParam(mixer, 0, 1.0f);
  engine.SetParam(mixer, 1, -1.0f);
  std::tie(l, r) = RunStereoSettled(engine, 0.5f, 400);
  for (int i = 0; i < kFrames; ++i) {
    NAM_EXPECT(std::fabs(l[static_cast<size_t>(i)] - 0.5f * 1.41421356f) < 1e-5f);
    // Hard-left pans the signal fully right; with the (smoothed) pan eased to
    // -1.0 the right channel approaches zero but only asymptotically, so assert
    // it's negligible rather than bit-exact zero.
    NAM_EXPECT(std::fabs(r[static_cast<size_t>(i)]) < 1e-6f);
  }

  // Hard right: the reverse. cos(pi/2) is ~6e-17, so the left channel isn't
  // bit-exact zero - assert it's negligible rather than exactly zero.
  engine.SetParam(mixer, 1, 1.0f);
  std::tie(l, r) = RunStereoSettled(engine, 0.5f, 400);
  for (int i = 0; i < kFrames; ++i) {
    NAM_EXPECT(std::fabs(l[static_cast<size_t>(i)]) < 1e-6f);
    NAM_EXPECT(std::fabs(r[static_cast<size_t>(i)] - 0.5f * 1.41421356f) < 1e-5f);
  }
}

// Splitter per-output level: each of the splitter's independent output jacks
// carries its own gain, the DSP that used to live only in the web
// SplitterBlock's per-output GainNodes. Both fan-out branches feed separate
// cab blocks whose per-block meters report what each splitter output delivered.
void TestSplitterPerOutputLevel() {
  AudioEngine engine;
  const BlockId splitter = engine.AddBlock(BlockKind::kSplitter, 0, 0);
  const BlockId a = engine.AddBlock(BlockKind::kCab, 0, 1);
  const BlockId b = engine.AddBlock(BlockKind::kCab, 1, 1);
  NAM_EXPECT(engine.Connect(kInRailId, 0, splitter, 0).ok);
  NAM_EXPECT(engine.Connect(splitter, 0, a, 0).ok);
  NAM_EXPECT(engine.Connect(splitter, 1, b, 0).ok);
  NAM_EXPECT(engine.Connect(a, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  // Param surface: 4 outputs x level.
  NAM_EXPECT(engine.ParamCount(splitter) == 4);
  const auto info0 = engine.ParamInfo(splitter, 0);
  NAM_EXPECT(info0 && std::string(info0->symbol) == "out0_level");
  NAM_EXPECT(engine.GetParam(splitter, 0) == 1.0f);

  // Unity defaults: both fan-out branches carry the input unchanged.
  RunMono(engine, 0.5f);
  NAM_EXPECT(std::fabs(engine.GetMeter(a) - 0.5f) < 1e-5f);
  NAM_EXPECT(std::fabs(engine.GetMeter(b) - 0.5f) < 1e-5f);

  // out0_level halves branch a; branch b stays full. The splitter output level
  // is exponentially smoothed (issue #122), so settle before the exact check.
  engine.SetParam(splitter, 0, 0.5f);
  SettleMono(engine, 0.5f, 400);
  NAM_EXPECT(std::fabs(engine.GetMeter(a) - 0.25f) < 1e-5f);
  NAM_EXPECT(std::fabs(engine.GetMeter(b) - 0.5f) < 1e-5f);

  // out1_level on the second port scales only branch b.
  engine.SetParam(splitter, 1, 0.25f);
  SettleMono(engine, 0.5f, 400);
  NAM_EXPECT(std::fabs(engine.GetMeter(a) - 0.25f) < 1e-5f);
  NAM_EXPECT(std::fabs(engine.GetMeter(b) - 0.125f) < 1e-5f);
}

// issue #66: Process() walks per-block incoming edges (incoming_) rather than
// rescanning the whole flat edge list. This rig exercises the grouping in both
// directions a splitter creates: it fans out to multiple targets (each target
// block gets exactly its own incoming edge), and a mixer fans those branches
// back in across its independent input ports (the mixer's incoming_ vector
// holds several edges) - all must be delivered so the summed output is correct.
void TestSplitterFanOutAndMixerFanInRouting() {
  AudioEngine engine;
  const BlockId splitter = engine.AddBlock(BlockKind::kSplitter, 0, 0);
  const BlockId cab_a = engine.AddBlock(BlockKind::kCab, 0, 1);
  const BlockId cab_b = engine.AddBlock(BlockKind::kCab, 1, 1);
  const BlockId mixer = engine.AddBlock(BlockKind::kMixer, 0, 2);  // fans in from a and b
  NAM_EXPECT(engine.Connect(kInRailId, 0, splitter, 0).ok);
  NAM_EXPECT(engine.Connect(splitter, 0, cab_a, 0).ok);
  NAM_EXPECT(engine.Connect(splitter, 1, cab_b, 0).ok);
  NAM_EXPECT(engine.Connect(cab_a, 0, mixer, 0).ok);
  NAM_EXPECT(engine.Connect(cab_b, 0, mixer, 1).ok);
  NAM_EXPECT(engine.Connect(mixer, 0, kOutRailId, 0).ok);
  engine.Reset(48000.0, kFrames);

  const auto settled = [&](float input) {
    std::vector<float> output;
    for (int i = 0; i < 400; ++i) output = RunMono(engine, input);
    return output;
  };

  // Unity throughout: each fan-out branch carries 0.5, the mixer sums its two
  // unity-gain inputs (port0 + port1) into 1.0 output.
  for (float sample : settled(0.5f)) NAM_EXPECT(std::fabs(sample - 1.0f) < 1e-5f);
  RunMono(engine, 0.5f);
  NAM_EXPECT(std::fabs(engine.GetMeter(cab_a) - 0.5f) < 1e-5f);
  NAM_EXPECT(std::fabs(engine.GetMeter(cab_b) - 0.5f) < 1e-5f);

  // Halving one splitter output must drop only that branch's contribution:
  // mixer now sums 0.5 (from a) + 0.25 (from b) = 0.75. This proves both
  // splitter fan-out edges and both mixer fan-in edges reached Process()
  // through the per-block incoming_ lists.
  engine.SetParam(splitter, 1, 0.5f);
  for (float sample : settled(0.5f)) NAM_EXPECT(std::fabs(sample - 0.75f) < 1e-5f);
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
  TestMixerPerInputLevelAndPan();
  TestSplitterPerOutputLevel();
  TestSplitterFanOutAndMixerFanInRouting();
  TestUnconnectedOutputIsSilent();
  TestReverbDefaultsToHallThenSwitchesAlgorithm();
  TestDsparkKindsDefaultParamsAndProcessRealAudio();
  TestUnknownBlockIsSafeNoOp();
  TestBypassSkipsDspAndPassesInputThrough();
  TestBlockTrimsScaleInputAndOutput();
  TestReverbControlsResolvePerAlgorithm();
  TestAmpToneStackAndPassthroughWithoutModel();
  TestMasterLevelScalesOutput();
  TestMasterAndTunerMuteAreIndependentAndBothSilence();

  return nam_studio::test::g_failures == 0 ? 0 : 1;
}
