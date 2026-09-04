// Cab IR install leveling (issue #365): a peak-normalized commercial IR still
// carries ~+20 dB of broadband convolution gain, so wiring the input straight
// into a cab block clipped with every trim at unity. LoadIr/LoadIrWav level
// the installed IR to unit energy (attenuate-only). These tests pin that
// behavior at the engine surface: a hot IR stops clipping broadband input, a
// quiet IR installs verbatim, and the applied scale is exactly 1/energy.
#include "openaxe/engine.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
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

// Deterministic pseudo-random sequence in [-1, 1) - same construction as
// convolver_test.cpp so fixtures are identical on every platform.
struct Lcg {
  unsigned int state;
  float Next() {
    state = state * 1664525u + 1013904223u;
    return static_cast<float>(static_cast<int>(state >> 8) % 20000 - 10000) / 10000.0f;
  }
};

// A cab-like IR: decaying noise, peak-normalized the way commercial IR files
// ship. Energy >> 1, which is exactly the shape that clipped pre-fix.
std::vector<float> HotCabIr() {
  Lcg rng{777};
  std::vector<float> ir(2048);
  float peak = 0.0f;
  for (size_t n = 0; n < ir.size(); ++n) {
    ir[n] = rng.Next() * std::exp(-static_cast<double>(n) / 400.0);
    peak = std::max(peak, std::fabs(ir[n]));
  }
  for (float& sample : ir) sample /= peak;
  return ir;
}

double Energy(const std::vector<float>& samples) {
  double sum = 0.0;
  for (float sample : samples) sum += static_cast<double>(sample) * sample;
  return std::sqrt(sum);
}

// Wire In -> cab -> Out, install `ir`, run `buffers` buffers of `input`, and
// return the peak absolute output sample and the output RMS over the run.
struct RunStats {
  float peak = 0.0f;
  double rms = 0.0;
};
RunStats RunThroughCab(const std::vector<float>& ir, const std::vector<float>& input, int buffers) {
  AudioEngine engine;
  const BlockId cab = engine.AddBlock(BlockKind::kCab, 0, 0);
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, cab, 0).ok);
  OPENAXE_EXPECT(engine.Connect(cab, 0, kOutRailId, 0).ok);
  engine.Reset(kSampleRate, kFrames);
  engine.LoadIr(cab, ir.data(), static_cast<int>(ir.size()));
  OPENAXE_EXPECT(engine.IrLength(cab) == static_cast<int>(ir.size()));

  std::vector<float> in(kFrames);
  std::vector<float> out(kFrames, 0.0f);
  RunStats stats;
  double sum_squares = 0.0;
  long total = 0;
  for (int b = 0; b < buffers; ++b) {
    for (int i = 0; i < kFrames; ++i) in[static_cast<size_t>(i)] = input[(b * kFrames + i) % input.size()];
    const float* in_ptrs[1] = {in.data()};
    float* out_ptrs[1] = {out.data()};
    engine.Process(in_ptrs, 1, out_ptrs, 1, kFrames);
    // RMS over the second half of the run only: past the convolver's attack
    // transient, i.e. the steady-state broadband gain. Peak over the whole
    // run: clipping anywhere fails the test.
    const bool settled = b >= buffers / 2;
    for (float sample : out) {
      stats.peak = std::max(stats.peak, std::fabs(sample));
      if (settled) {
        sum_squares += static_cast<double>(sample) * sample;
        ++total;
      }
    }
  }
  stats.rms = std::sqrt(sum_squares / static_cast<double>(total));
  return stats;
}

// Broadband noise straight into the cab: the issue's repro. Unit-energy
// leveling is unity gain for broadband signals, so the settled output RMS
// must roughly equal the input RMS (pre-fix it was ~energy x hotter), and a
// guitar-hot input peak must stay under full scale.
void TestHotIrNoLongerClipsBroadbandInput() {
  const std::vector<float> ir = HotCabIr();
  const double energy = Energy(ir);
  std::printf("  hot IR energy (pre-level broadband gain): %.2f\n", energy);
  OPENAXE_EXPECT(energy > 2.0);  // the fixture is actually hot, else this proves nothing

  Lcg rng{4242};
  std::vector<float> input(4096);
  for (float& sample : input) sample = 0.35f * rng.Next();
  double in_sum = 0.0;
  for (float sample : input) in_sum += static_cast<double>(sample) * sample;
  const double in_rms = std::sqrt(in_sum / static_cast<double>(input.size()));

  const RunStats stats = RunThroughCab(ir, input, 128);
  std::printf("  in rms %.3f -> leveled out rms %.3f, peak %.3f\n", in_rms, stats.rms, stats.peak);
  OPENAXE_EXPECT(stats.rms > 0.5 * in_rms);
  OPENAXE_EXPECT(stats.rms < 2.0 * in_rms);
  OPENAXE_EXPECT(stats.peak < 1.0f);
  OPENAXE_EXPECT(stats.peak > 0.05f);  // the IR is installed, not muted
}

// An IR already at/below unit energy installs verbatim: an impulse in
// reproduces the IR's own taps, unscaled.
void TestQuietIrInstallsVerbatim() {
  std::vector<float> ir(256, 0.0f);
  ir[0] = 0.5f;
  ir[100] = -0.25f;  // energy well under 1
  OPENAXE_EXPECT(Energy(ir) < 1.0);

  AudioEngine engine;
  const BlockId cab = engine.AddBlock(BlockKind::kCab, 0, 0);
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, cab, 0).ok);
  OPENAXE_EXPECT(engine.Connect(cab, 0, kOutRailId, 0).ok);
  engine.Reset(kSampleRate, kFrames);
  engine.LoadIr(cab, ir.data(), static_cast<int>(ir.size()));

  std::vector<float> in(kFrames, 0.0f);
  std::vector<float> out(kFrames, 0.0f);
  in[0] = 1.0f;
  const float* in_ptrs[1] = {in.data()};
  float* out_ptrs[1] = {out.data()};
  engine.Process(in_ptrs, 1, out_ptrs, 1, kFrames);
  OPENAXE_EXPECT(std::fabs(out[0] - 0.5f) < 1e-4f);

  // The late tap lands one block later, still unscaled.
  in[0] = 0.0f;
  engine.Process(in_ptrs, 1, out_ptrs, 1, kFrames);
  OPENAXE_EXPECT(std::fabs(out[36] - -0.25f) < 1e-3f);
}

// The applied scale is exactly 1/energy: an impulse through the hot IR
// reproduces the IR's peak divided by its energy.
void TestHotIrScaleIsExactlyUnitEnergy() {
  const std::vector<float> ir = HotCabIr();
  const double energy = Energy(ir);
  float ir_peak = 0.0f;
  for (float sample : ir) ir_peak = std::max(ir_peak, std::fabs(sample));

  AudioEngine engine;
  const BlockId cab = engine.AddBlock(BlockKind::kCab, 0, 0);
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, cab, 0).ok);
  OPENAXE_EXPECT(engine.Connect(cab, 0, kOutRailId, 0).ok);
  engine.Reset(kSampleRate, kFrames);
  engine.LoadIr(cab, ir.data(), static_cast<int>(ir.size()));

  std::vector<float> in(kFrames, 0.0f);
  std::vector<float> out(kFrames, 0.0f);
  in[0] = 1.0f;
  const float* in_ptrs[1] = {in.data()};
  float* out_ptrs[1] = {out.data()};
  float peak = 0.0f;
  for (int b = 0; b < 64; ++b) {
    if (b > 0) in[0] = 0.0f;
    engine.Process(in_ptrs, 1, out_ptrs, 1, kFrames);
    for (float sample : out) peak = std::max(peak, std::fabs(sample));
  }
  const float expected = ir_peak / static_cast<float>(energy);
  std::printf("  impulse peak %.4f, expected %.4f\n", peak, expected);
  OPENAXE_EXPECT(std::fabs(peak - expected) < 2e-3f);
}

// Leveling must not disturb the clear path: nullptr still returns the block
// to passthrough.
void TestClearStillPassesThrough() {
  AudioEngine engine;
  const BlockId cab = engine.AddBlock(BlockKind::kCab, 0, 0);
  OPENAXE_EXPECT(engine.Connect(kInRailId, 0, cab, 0).ok);
  OPENAXE_EXPECT(engine.Connect(cab, 0, kOutRailId, 0).ok);
  engine.Reset(kSampleRate, kFrames);

  const std::vector<float> ir = HotCabIr();
  engine.LoadIr(cab, ir.data(), static_cast<int>(ir.size()));
  OPENAXE_EXPECT(engine.IrLength(cab) == static_cast<int>(ir.size()));
  engine.LoadIr(cab, nullptr, 0);
  OPENAXE_EXPECT(engine.IrLength(cab) == 0);

  std::vector<float> in(kFrames, 0.5f);
  std::vector<float> out(kFrames, 0.0f);
  const float* in_ptrs[1] = {in.data()};
  float* out_ptrs[1] = {out.data()};
  engine.Process(in_ptrs, 1, out_ptrs, 1, kFrames);
  for (float sample : out) OPENAXE_EXPECT(sample == 0.5f);
}

}  // namespace

int main() {
  TestHotIrNoLongerClipsBroadbandInput();
  TestQuietIrInstallsVerbatim();
  TestHotIrScaleIsExactlyUnitEnergy();
  TestClearStillPassesThrough();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}
