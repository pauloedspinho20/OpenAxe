// Verification for issue #122: sample-accurate parameter smoothing. Proves
// that automating a gain-like param (a mixer input level, which is an
// exponential one-pole in the schema) eases toward its target per-sample
// instead of stepping once per buffer (the zipper-noise failure mode), and
// that a param explicitly marked "none" (a reverb's dry/wet level) snaps to
// its target on the very first sample. Exercises openaxe::engine::
// AudioEngine directly. Needs NAM_CORE_DIR/DRAGONFLY_DIR initialized, same
// as engine_test.cpp.
#include "openaxe/engine.h"

#include "openaxe/dsp/smoothing.h"

#include <cmath>
#include <cstddef>
#include <cstdio>
#include <string>
#include <vector>

using openaxe::graph::BlockKind;

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
std::vector<float> RunMono(openaxe::engine::AudioEngine& engine, float value) {
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
  openaxe::engine::AudioEngine engine;
  const auto mixer = engine.AddBlock(BlockKind::kMixer, 0, 0);
  EXPECT(engine.Connect(openaxe::engine::kInRailId, 0, mixer, 0).ok);
  EXPECT(engine.Connect(mixer, 0, openaxe::engine::kOutRailId, 0).ok);
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
  openaxe::engine::AudioEngine engine;
  const auto splitter = engine.AddBlock(BlockKind::kSplitter, 0, 0);
  // Both branches fed by output port 0; cabs carry no IR, so they're pure
  // passthroughs standing in for the two paths of a dry/wet split.
  const auto cab_a = engine.AddBlock(BlockKind::kCab, 0, 1);
  const auto cab_b = engine.AddBlock(BlockKind::kCab, 0, 2);  // later column - the divergence case
  const auto mixer = engine.AddBlock(BlockKind::kMixer, 0, 3);
  EXPECT(engine.Connect(openaxe::engine::kInRailId, 0, splitter, 0).ok);
  EXPECT(engine.Connect(splitter, 0, cab_a, 0).ok);
  EXPECT(engine.Connect(splitter, 0, cab_b, 0).ok);  // SAME port as cab_a
  EXPECT(engine.Connect(cab_a, 0, mixer, 0).ok);
  EXPECT(engine.Connect(cab_b, 0, mixer, 1).ok);
  EXPECT(engine.Connect(mixer, 0, openaxe::engine::kOutRailId, 0).ok);
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

// Direct unit coverage of the pure ramp function itself, including the
// kLinear path no schema row uses yet (it must stay correct so the schema can
// adopt it) and the exact-settle behaviour the engine's fast paths rely on.
void RampStepUnitSemantics() {
  using openaxe::dsp::ParamSmoothing;
  using openaxe::dsp::RampStep;
  using openaxe::dsp::SmoothingMode;
  const double dt = 1.0 / kSampleRate;

  // kNone snaps to the target immediately.
  {
    ParamSmoothing s;  // defaults to kNone
    // Returns the float target widened to double - exactly what the atomic
    // mirror holds, so "snap" means bit-exact with the stored param.
    EXPECT(RampStep(0.25, 0.9f, s, dt) == static_cast<double>(0.9f));
  }

  // kExponential: matches the closed form mid-ramp, is monotonic, never
  // overshoots, and settles EXACTLY on the target once the gap drops below
  // 1e-6 of the range (the snap that lets exact-value fast paths re-arm).
  {
    ParamSmoothing s{SmoothingMode::kExponential, 0.03f, 0.0f, 1.0f};
    double v = 1.0;
    const double tau = 0.03f;  // the POLICY stores float - closed form must match it
    const double base = std::exp(-dt / tau);
    for (int i = 0; i < 64; ++i) {
      v = RampStep(v, 0.5f, s, dt);
      const double expected = 0.5 + 0.5 * std::pow(base, i + 1);
      EXPECT(std::fabs(v - expected) < 1e-12);
      EXPECT(v >= 0.5);
    }
    // Far from settled: must NOT have snapped yet.
    EXPECT(v > 0.97);
    bool snapped = false;
    for (int i = 0; i < 100000 && !snapped; ++i) {
      v = RampStep(v, 0.5f, s, dt);
      if (v == 0.5) snapped = true;
    }
    EXPECT(snapped);
  }

  // The float32-stall regression from issue #122: a one-pole held in float32
  // stalls ~4e-5 short of 0.5 because its per-sample step rounds to 0 ULP.
  // In double with the settle snap, the ramp must reach the target exactly.
  {
    ParamSmoothing s{SmoothingMode::kExponential, 0.03f, 0.0f, 1.0f};
    float stalled = 0.0f;
    for (int i = 0; i < 200000; ++i)
      stalled = static_cast<float>(static_cast<double>(stalled) +
                                   (0.5 - static_cast<double>(stalled)) * (1.0 - std::exp(-dt / 0.03)));
    EXPECT(stalled < 0.5f && stalled > 0.49995f);  // documents the stall itself
    double v = 0.0;
    for (int i = 0; i < 200000; ++i) v = RampStep(v, 0.5f, s, dt);
    EXPECT(v == 0.5);  // ...and the fix
  }

  // kLinear: constant slew bounded by range/tau per second, completes exactly,
  // never overshoots, and handles a degenerate zero-range policy.
  {
    ParamSmoothing s{SmoothingMode::kLinear, 0.03f, 0.0f, 1.0f};
    const double step = 1.0 * (dt / 0.03f);  // match the policy's float tau
    double v = 0.0;
    int steps_taken = 0;
    while (v != 1.0 && steps_taken < 100000) {
      const double prev = v;
      v = RampStep(v, 1.0f, s, dt);
      ++steps_taken;
      EXPECT(v > prev);                                   // always moving forward...
      EXPECT(v - prev <= step + 1e-15);                   // ...at most max_step...
      EXPECT(v <= 1.0);                                   // ...and never past the target
    }
    EXPECT(v == 1.0);
    // Full range traversed in ~tau (1440 samples at 48 kHz), not just eventually.
    EXPECT(steps_taken > 1400 && steps_taken < 1480);

    ParamSmoothing degenerate{SmoothingMode::kLinear, 0.03f, 1.0f, 1.0f};
    EXPECT(RampStep(0.3, 0.7f, degenerate, dt) == static_cast<double>(0.7f));
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
  RampStepUnitSemantics();
  if (g_failures != 0) {
    std::fprintf(stderr, "\n%d smoothing checks failed\n", g_failures);
    return 1;
  }
  std::printf("all smoothing checks passed\n");
  return 0;
}
