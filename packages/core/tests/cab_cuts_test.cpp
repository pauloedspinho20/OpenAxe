// Cab post-IR low-cut / high-cut (issue #373): the wet/dry blend gained two
// sibling params shaping the wet (convolved) signal before the dry blend.
// These tests pin the behavior at the engine surface: the param table, that
// defaults are bit-identical to the pre-cut path, that the cuts attenuate
// out-of-band content, and that the dry path stays truly dry.
#include "openaxe/engine.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

#include "test_harness.h"

using openaxe::engine::AudioEngine;
using openaxe::engine::BlockId;
using openaxe::engine::kInRailId;
using openaxe::engine::kOutRailId;
using openaxe::graph::BlockKind;

namespace {

constexpr int kFrames = 64;
constexpr double kSampleRate = 48000.0;

// A 64-tap Dirac IR: exactly one partition (kPartitionFrames == 64), so the
// whole IR runs as the direct-FIR head with no FFT round-trip, and unit
// energy, so LoadIr's attenuate-only leveling installs it verbatim. The wet
// signal is then exactly the input, which isolates the cuts under test.
std::vector<float> DiracIr() {
  std::vector<float> ir(kFrames, 0.0f);
  ir[0] = 1.0f;
  return ir;
}

// Wire In -> cab -> Out, install the Dirac IR, apply `writes` as
// (param index, value), run `buffers` buffers of a continuous `freq_hz` sine
// (amplitude 1.0), and return the peak absolute output over the second half
// of the run (past convolver/biquad attack transients).
float SettledSinePeak(float freq_hz, std::vector<std::pair<int, float>> writes, int buffers) {
  AudioEngine engine;
  const BlockId cab = engine.AddBlock(BlockKind::kCab, 0, 0);
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, cab, 0).ok);
  OPENAXE_EXPECT(engine.Connect(cab, 0, kOutRailId, 0).ok);
  engine.Reset(kSampleRate, kFrames);
  const std::vector<float> ir = DiracIr();
  engine.LoadIr(cab, ir.data(), static_cast<int>(ir.size()));
  OPENAXE_EXPECT(engine.IrLength(cab) == static_cast<int>(ir.size()));
  for (const auto& [index, value] : writes) engine.SetParam(cab, index, value);

  std::vector<float> in(kFrames);
  std::vector<float> out(kFrames, 0.0f);
  double phase = 0.0;
  const double step = static_cast<double>(freq_hz) * 6.283185307179586 / kSampleRate;
  float peak = 0.0f;
  for (int b = 0; b < buffers; ++b) {
    for (int i = 0; i < kFrames; ++i) {
      in[static_cast<size_t>(i)] = static_cast<float>(std::sin(phase));
      phase += step;
    }
    const float* in_ptrs[1] = {in.data()};
    float* out_ptrs[1] = {out.data()};
    engine.Process(in_ptrs, 1, out_ptrs, 1, kFrames);
    if (b >= buffers / 2) {
      for (float sample : out) peak = std::max(peak, std::fabs(sample));
    }
  }
  return peak;
}

void TestParamSurface() {
  AudioEngine engine;
  const BlockId cab = engine.AddBlock(BlockKind::kCab, 0, 0);
  OPENAXE_EXPECT(engine.ParamCount(cab) == 3);
  const auto mix = engine.ParamInfo(cab, 0);
  const auto low = engine.ParamInfo(cab, 1);
  const auto high = engine.ParamInfo(cab, 2);
  OPENAXE_EXPECT(mix && std::strcmp(mix->symbol, "ir_mix") == 0);
  OPENAXE_EXPECT(low && std::strcmp(low->symbol, "low_cut") == 0);
  OPENAXE_EXPECT(high && std::strcmp(high->symbol, "high_cut") == 0);
  OPENAXE_EXPECT(low && low->min_value == 20.0f && low->max_value == 1000.0f);
  OPENAXE_EXPECT(high && high->min_value == 2000.0f && high->max_value == 20000.0f);
  // Transparent defaults: range extremes, matching param_schema.json.
  OPENAXE_EXPECT(engine.GetParam(cab, 1) == 20.0f);
  OPENAXE_EXPECT(engine.GetParam(cab, 2) == 20000.0f);
}

void TestDefaultsAreBitIdentical() {
  // Dirac-wet == dry and the fully-wet fast path skips the blend, so with the
  // cuts at defaults the output must equal the input bit-for-bit.
  AudioEngine engine;
  const BlockId cab = engine.AddBlock(BlockKind::kCab, 0, 0);
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, cab, 0).ok);
  OPENAXE_EXPECT(engine.Connect(cab, 0, kOutRailId, 0).ok);
  engine.Reset(kSampleRate, kFrames);
  const std::vector<float> ir = DiracIr();
  engine.LoadIr(cab, ir.data(), static_cast<int>(ir.size()));

  std::vector<float> in(kFrames);
  std::vector<float> out(kFrames, 0.0f);
  double phase = 0.0;
  bool identical = true;
  for (int b = 0; b < 8; ++b) {
    for (int i = 0; i < kFrames; ++i) {
      in[static_cast<size_t>(i)] = static_cast<float>(std::sin(phase));
      phase += 500.0 * 6.283185307179586 / kSampleRate;
    }
    const float* in_ptrs[1] = {in.data()};
    float* out_ptrs[1] = {out.data()};
    engine.Process(in_ptrs, 1, out_ptrs, 1, kFrames);
    for (int i = 0; i < kFrames; ++i) {
      if (out[static_cast<size_t>(i)] != in[static_cast<size_t>(i)]) identical = false;
    }
  }
  OPENAXE_EXPECT(identical);
}

void TestLowCutAttenuates() {
  // 100 Hz sine, ~2.3 octaves below a 500 Hz HPF (~27 dB down).
  const float peak = SettledSinePeak(100.0f, {{1 /* low_cut */, 500.0f}}, 16);
  OPENAXE_EXPECT(std::isfinite(peak));
  OPENAXE_EXPECT(peak < 0.1f);
}

void TestHighCutAttenuates() {
  // 8 kHz sine, ~1.4 octaves above a 3 kHz LPF (~17 dB down).
  const float peak = SettledSinePeak(8000.0f, {{2 /* high_cut */, 3000.0f}}, 16);
  OPENAXE_EXPECT(std::isfinite(peak));
  OPENAXE_EXPECT(peak < 0.3f);
}

void TestCutsLeaveDryPathAlone() {
  // Fully dry (ir_mix = 0): the cuts shape the wet signal only, so a 100 Hz
  // sine must pass essentially untouched despite the 500 Hz low-cut. Needs a
  // long run: ir_mix eases from its seeded 1.0 with a 30 ms exponential ramp,
  // so the first ~150 ms are still partly (filtered) wet.
  const float peak = SettledSinePeak(100.0f, {{0 /* ir_mix */, 0.0f}, {1 /* low_cut */, 500.0f}}, 200);
  OPENAXE_EXPECT(std::isfinite(peak));
  OPENAXE_EXPECT(peak > 0.95f);
}

}  // namespace

int main() {
  TestParamSurface();
  TestDefaultsAreBitIdentical();
  TestLowCutAttenuates();
  TestHighCutAttenuates();
  TestCutsLeaveDryPathAlone();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}
