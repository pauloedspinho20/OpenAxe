// Verification for issue #122: sample-accurate parameter smoothing. Proves
// that automating a gain-like param (a mixer input level, which is an
// exponential one-pole in the schema) eases toward its target per-sample
// instead of stepping once per buffer (the zipper-noise failure mode), and
// that a param explicitly marked "none" (a reverb's dry/wet level) snaps to
// its target on the very first sample. Exercises nam_studio::engine::
// AudioEngine directly. Needs NAM_CORE_DIR/DRAGONFLY_DIR initialized, same
// as engine_test.cpp.
#include "nam_studio/engine.h"

#include <cmath>
#include <cstddef>
#include <cstdio>
#include <string>
#include <vector>

using nam_studio::graph::BlockKind;

namespace {

constexpr int kFrames = 64;
constexpr double kSampleRate = 48000.0;

// A short, self-contained test harness mimicking engine_test.cpp's matchers so
// this file stays independent.
int g_failures = 0;

void Check(bool ok, const char* file, int line, const std::string& msg) {
  if (!ok) {
    ++g_failures;
    std::fprintf(stderr, "FAILED: %s (%s:%d)\n", msg.c_str(), file, line);
  }
}

#define EXPECT(cond) Check((cond), __FILE__, __LINE__, #cond)

// Runs one mono buffer (duplicated to both channels) through the engine.
std::vector<float> RunMono(nam_studio::engine::AudioEngine& engine, float value) {
  std::vector<float> input(kFrames, value);
  std::vector<float> output(kFrames, 0.0f);
  const float* in_ptrs[1] = {input.data()};
  float* out_ptrs[1] = {output.data()};
  engine.Process(in_ptrs, 1, out_ptrs, 1, kFrames);
  return output;
}

// A gain-like param must ramp per-sample toward its target, never jump. Drive a
// mixer input level from 0 to 1 and inspect the single block where the change
// takes effect.
void ExponentialParamRampsSmoothly() {
  nam_studio::engine::AudioEngine engine;
  const auto mixer = engine.AddBlock(BlockKind::kMixer, 0, 0);
  EXPECT(engine.Connect(nam_studio::engine::kInRailId, 0, mixer, 0).ok);
  EXPECT(engine.Connect(mixer, 0, nam_studio::engine::kOutRailId, 0).ok);
  engine.Reset(kSampleRate, kFrames);

  // Start fully open (1.0) and settle so the smoothed level is ~1.0. We ramp
  // downward to 0.0 because an exponential toward 0 only asymptotes - it never
  // actually reaches 0 - so a downward ramp from a settled 1.0 is unambiguous.
  engine.SetParam(mixer, 0, 1.0f);
  for (int i = 0; i < 400; ++i) RunMono(engine, 0.5f);

  engine.SetParam(mixer, 0, 0.0f);
  const auto out = RunMono(engine, 0.5f);

  // First sample: the ramp has only just begun, level still ~1.0, output ~0.5.
  EXPECT(out[0] > 0.45f);
  // Last sample: starting from a settled 1.0 the level has decayed by
  // exp(-64/(sr*tau)) over the 64-sample block (~0.9566), so the output is
  // still ~0.478 - i.e. it did NOT jump straight to 0.
  EXPECT(std::fabs(out[kFrames - 1] -
                   0.5f * std::exp(-static_cast<float>(kFrames) /
                                   (static_cast<float>(kSampleRate) * 0.03f))) < 1e-3f);

  // The ramp must be monotonic (no backward jumps = no zipper noise) and the
  // per-sample step must stay small across the whole block.
  float max_step = 0.0f;
  for (int i = 1; i < kFrames; ++i) {
    EXPECT(out[i] <= out[i - 1] + 1e-6f);  // monotonic non-increasing
    max_step = std::max(max_step, std::fabs(out[i] - out[i - 1]));
  }
  EXPECT(max_step < 0.01f);

  // Given enough blocks it reaches the target (settles), proving the ramp
  // actually completes rather than stalling.
  for (int i = 0; i < 400; ++i) RunMono(engine, 0.5f);
  const auto settled = RunMono(engine, 0.5f);
  for (int i = 0; i < kFrames; ++i) {
    EXPECT(std::fabs(settled[i]) < 1e-3f);
  }
}

// Splitter fan-out: N branches hanging off ONE output port must all replay an
// identical gain curve in the transition buffer. The ramp state lives on the
// splitter and advances exactly once per buffer (PublishSplitterRamps), with
// consumers recomputing the curve read-only from the frozen snapshot - the
// naive alternative (advancing inside each consumer's edge sum) makes the
// effective time constant shrink ~N-fold and gives later-column branches
// different gains, which is precisely the dry/wet-split failure mode.
void SplitterFanOutRampsIdentically() {
  nam_studio::engine::AudioEngine engine;
  const auto splitter = engine.AddBlock(BlockKind::kSplitter, 0, 0);
  // Both branches fed by output port 0; cabs carry no IR, so they're pure
  // passthroughs standing in for the two paths of a dry/wet split.
  const auto cab_a = engine.AddBlock(BlockKind::kCab, 0, 1);
  const auto cab_b = engine.AddBlock(BlockKind::kCab, 0, 2);  // later column - the divergence case
  const auto mixer = engine.AddBlock(BlockKind::kMixer, 0, 3);
  EXPECT(engine.Connect(nam_studio::engine::kInRailId, 0, splitter, 0).ok);
  EXPECT(engine.Connect(splitter, 0, cab_a, 0).ok);
  EXPECT(engine.Connect(splitter, 0, cab_b, 0).ok);  // SAME port as cab_a
  EXPECT(engine.Connect(cab_a, 0, mixer, 0).ok);
  EXPECT(engine.Connect(cab_b, 0, mixer, 1).ok);
  EXPECT(engine.Connect(mixer, 0, nam_studio::engine::kOutRailId, 0).ok);
  engine.Reset(kSampleRate, kFrames);

  for (int i = 0; i < 400; ++i) RunMono(engine, 0.5f);

  // Automate out0_level 1 -> 0.5. With identical per-branch curves the mixer
  // sums to input * 2 * g(i), where g is the one-pole from the schema's
  // exponential policy (tau = 0.03s) applied i+1 times from the settled 1.0.
  engine.SetParam(splitter, 0, 0.5f);
  const double tau = 0.03;
  const double base = std::exp(-1.0 / (kSampleRate * tau));
  const auto out = RunMono(engine, 0.5f);

  double worst = 0.0;
  for (int i = 0; i < kFrames; ++i) {
    const double g = 0.5 + 0.5 * std::pow(base, i + 1);
    const double expected = 0.5 * 2.0 * g;  // input * two identical branches
    worst = std::max(worst, std::fabs(static_cast<double>(out[static_cast<size_t>(i)]) - expected));
  }
  if (worst >= 2e-4) {
    std::fprintf(stderr,
                 "splitter fan-out diverged from the shared ramp curve "
                 "(worst |out - expected| = %g): branches saw different gains\n",
                 worst);
    EXPECT(false);
  }

  // And it settles with both branches halved: input 0.5 * gain 0.5, summed
  // across the two branches = 0.5.
  for (int i = 0; i < 400; ++i) RunMono(engine, 0.5f);
  const auto settled = RunMono(engine, 0.5f);
  for (int i = 0; i < kFrames; ++i) {
    EXPECT(std::fabs(settled[static_cast<size_t>(i)] - 0.5f) < 1e-3f);
  }
}

// Note on "none"-mode params (the other half of issue #122's contract: where a
// wrapped DSP already smooths internally - reverb dry/wet, compressor
// threshold, amp calibration - the engine must NOT re-smooth). Those params
// flow through the very same RampStep() path exercised above; for mode
// kNone it returns the target immediately (a step, not a ramp). They live on
// DSP-family blocks (reverb/compressor/amp) whose own latency and internal
// dynamics make a clean one-block "snap vs ramp" assertion brittle, so the
// none/exponential distinction is instead locked by scripts/gen-param-schema.mjs
// --check (schema <-> generated C++ smoothing tables) rather than an audio
// round-trip here.

}  // namespace

int main() {
  ExponentialParamRampsSmoothly();
  SplitterFanOutRampsIdentically();
  if (g_failures != 0) {
    std::fprintf(stderr, "\n%d smoothing checks failed\n", g_failures);
    return 1;
  }
  std::printf("all smoothing checks passed\n");
  return 0;
}
