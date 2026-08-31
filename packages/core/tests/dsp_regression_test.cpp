// Golden-audio regression harness for every compiled effect (issue #315).
//
// The problem this exists for: packages/core/tests has a test per effect, but
// they assert structural properties - param ranges, no NaNs, no allocation -
// not what the effect sounds like. Nothing would catch a change that inverted
// a phase, moved a filter an octave, introduced aliasing, or quietly dropped a
// delay model's modulation. That makes "improve the effect quality" (the whole
// #310 epic) unfalsifiable and every DSPark migration a blind swap.
//
// What it does: renders five deterministic stimuli (see dsp_stimuli.h) through
// each effect at fixed params, reduces each output to a fingerprint (see
// dsp_metrics.h), and compares that against tests/golden/dsp_metrics.json
// within per-metric tolerances.
//
// Run with --bless to rewrite the golden file. Blessing is meant to be a
// visible, reviewed diff: a PR that moves a reference must say why in its
// description, because the diff is the evidence that the change was intended.
//
// Cases run through AudioEngine rather than the DSP classes directly, so the
// fingerprint covers the engine's staging too - the wet/dry mix, the output
// level, and the param smoothing ramps are all part of what ships.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <iterator>
#include <optional>
#include <string>
#include <vector>

#include "dsp_metrics.h"
#include "dsp_stimuli.h"
#include "openaxe/engine.h"
#include "openaxe/generated/enabled_blocks.h"
#include "serialization/json.h"
#include "test_harness.h"

using openaxe::engine::AudioEngine;
using openaxe::engine::BlockId;
using openaxe::engine::kInRailId;
using openaxe::engine::kOutRailId;
using openaxe::engine::ReverbAlgorithm;
using openaxe::graph::BlockKind;
using openaxe::json::Value;
using namespace openaxe::test;

namespace {

// ── Tolerances ─────────────────────────────────────────────────────────────
// Chosen to sit above cross-platform float noise and below anything audible.
// A band moving 0.5dB, or a level moving 1%, is not something a listener
// notices; it is comfortably more than libm differences produce.
constexpr float kBandToleranceDb = 0.5f;
constexpr float kLevelRelTolerance = 0.01f;   // peak / rms, relative
constexpr float kLevelAbsFloor = 1e-4f;       // below this, relative is meaningless
constexpr float kCorrelationTolerance = 0.02f;
// Onset is compared exactly for a static tap. One sample of slack covers the
// case where a smoothed param leaves the first sample a hair under threshold.
constexpr int kOnsetTolerance = 1;

constexpr double kSampleRate = 48000.0;
constexpr int kBlockSize = 128;  // the web AudioWorklet render quantum
constexpr int kRenderFrames = 24000;  // 0.5s

// Silence rendered before the stimulus so the engine's param smoothing has
// converged. Expressed in samples, not blocks, so every block size settles by
// the same amount - the block-size-invariance check below would otherwise be
// comparing two different points on the same ramp.
//
// 32768 samples is ~23 time constants of the engine's 30ms exponential ramp.
// The first attempt used 8192 (~5.7 constants), which left 0.3% of the dry
// signal still mixed in - enough to put a delay's onset at sample 0 instead of
// at its delay time, i.e. it silently destroyed the one metric that pins delay
// timing. Exponential smoothing never arrives exactly, so this needs to be
// long enough that the residue is below the onset threshold, not merely
// "settled".
constexpr int kSettleSamples = 32768;

struct ParamWrite {
  const char* symbol;
  float value;
};

struct Case {
  const char* name;  // stable key in the golden file
  BlockKind kind;
  std::vector<ParamWrite> params;
  std::optional<ReverbAlgorithm> reverb_algorithm;
};

// Two presets per effect where a second one exercises a genuinely different
// code path (a model, a type, a mode), one where it would not. Names are the
// golden file's keys, so renaming one orphans its reference - deliberate.
std::vector<Case> BuildCases() {
  std::vector<Case> cases;
  auto add = [&cases](const char* name, BlockKind kind, std::vector<ParamWrite> params,
                      std::optional<ReverbAlgorithm> algo = std::nullopt) {
    if (!openaxe::blocks::IsCompiled(kind)) return;  // effects.config.json (#313)
    cases.push_back(Case{name, kind, std::move(params), algo});
  };

  add("noise-gate/open", BlockKind::kNoiseGate, {{"threshold", -60.0f}, {"mix", 1.0f}});
  add("compressor/4to1", BlockKind::kCompressor,
      {{"threshold", -18.0f}, {"ratio", 4.0f}, {"attack", 5.0f}, {"release", 100.0f}});
  add("eq/flat", BlockKind::kEq, {{"mix", 1.0f}});
  add("chorus/default", BlockKind::kChorus,
      {{"rate", 0.8f}, {"depth", 3.0f}, {"delay", 12.0f}, {"feedback", 0.2f}, {"mix", 1.0f}});
  add("flanger/default", BlockKind::kFlanger,
      {{"rate", 0.4f}, {"depth", 2.0f}, {"feedback", 0.5f}, {"delay", 1.0f}, {"mix", 1.0f}});
  add("phaser/default", BlockKind::kPhaser,
      {{"rate", 0.5f}, {"depth", 0.8f}, {"feedback", 0.3f}, {"mix", 1.0f}});
  add("tremolo/sine", BlockKind::kTremolo,
      {{"rate", 4.0f}, {"depth", 0.7f}, {"shape", 0.0f}, {"mix", 1.0f}});
  add("tremolo/square-harmonic", BlockKind::kTremolo,
      {{"rate", 6.0f}, {"depth", 0.9f}, {"shape", 2.0f}, {"mode", 1.0f}, {"mix", 1.0f}});

  // Delay: one case per model, plus ping-pong (#314) - the four paths differ
  // only inside the feedback loop, which is exactly where a regression hides.
  //
  // 60ms rather than a musical 250ms on purpose. The models differ only in what
  // happens to each *repeat*, so the fingerprint is only sensitive to them if
  // several repeats land inside the render window: at 250ms exactly one echo
  // fit, and digital and analog measured identically flat. At 60ms with
  // feedback 0.45 there are eight, and the analog model's 3kHz loop filter
  // shows up as a progressively darker tail.
  add("delay/digital", BlockKind::kDelay,
      {{"time", 60.0f}, {"feedback", 0.45f}, {"tone", 8000.0f}, {"model", 0.0f}, {"mix", 1.0f}});
  add("delay/analog", BlockKind::kDelay,
      {{"time", 60.0f}, {"feedback", 0.45f}, {"tone", 3000.0f}, {"model", 1.0f}, {"mix", 1.0f}});
  add("delay/tape", BlockKind::kDelay,
      {{"time", 60.0f}, {"feedback", 0.45f}, {"tone", 3000.0f}, {"model", 2.0f},
       {"wow_depth", 3.0f}, {"wow_rate", 1.2f}, {"mix", 1.0f}});
  add("delay/ping-pong", BlockKind::kDelay,
      {{"time", 50.0f}, {"feedback", 0.5f}, {"tone", 6000.0f}, {"model", 0.0f},
       {"stereo_mode", 1.0f}, {"width", 1.0f}, {"mix", 1.0f}});

  add("reverb/hall", BlockKind::kReverb, {}, ReverbAlgorithm::kHall);
  add("reverb/room", BlockKind::kReverb, {}, ReverbAlgorithm::kRoom);
  add("reverb/plate", BlockKind::kReverb, {}, ReverbAlgorithm::kPlate);
  add("reverb/early-reflections", BlockKind::kReverb, {}, ReverbAlgorithm::kEarlyReflections);

  add("ring-mod/clean", BlockKind::kRingMod, {{"frequency", 500.0f}, {"drive", 0.0f}, {"mix", 1.0f}});
  add("ring-mod/driven", BlockKind::kRingMod, {{"frequency", 1500.0f}, {"drive", 0.8f}, {"mix", 1.0f}});

  add("filter/wah", BlockKind::kFilter,
      {{"type", 0.0f}, {"frequency", 800.0f}, {"q", 4.0f}, {"mix", 1.0f}});
  add("filter/envelope", BlockKind::kFilter,
      {{"type", 1.0f}, {"q", 3.0f}, {"sensitivity", 0.7f}, {"mix", 1.0f}});
  add("filter/ladder", BlockKind::kFilter,
      {{"type", 2.0f}, {"frequency", 1200.0f}, {"q", 2.0f}, {"drive", 0.4f}, {"mix", 1.0f}});

  add("pitch-shifter/detune", BlockKind::kPitchShifter,
      {{"mode", 0.0f}, {"detune_cents", 12.0f}, {"mix", 1.0f}});
  add("pitch-shifter/whammy-up", BlockKind::kPitchShifter,
      {{"mode", 1.0f}, {"pitch", 7.0f}, {"mix", 1.0f}});

  add("granular-delay/default", BlockKind::kGranularDelay,
      {{"time", 300.0f}, {"grain_size", 80.0f}, {"density", 12.0f}, {"feedback", 0.4f},
       {"mix", 1.0f}});

  add("rotary/fast", BlockKind::kRotary,
      {{"speed", 2.0f}, {"drive", 0.3f}, {"mix", 1.0f}});
  return cases;
}

// ── Rendering ──────────────────────────────────────────────────────────────

bool SetParamBySymbol(AudioEngine& engine, BlockId id, const char* symbol, float value) {
  const int count = engine.ParamCount(id);
  for (int i = 0; i < count; ++i) {
    const auto info = engine.ParamInfo(id, i);
    if (info && info->symbol != nullptr && std::strcmp(info->symbol, symbol) == 0) {
      engine.SetParam(id, i, value);
      return true;
    }
  }
  return false;
}

// One case, one stimulus, rendered block by block.
//
// kSettleSamples of silence run first so the engine's param smoothing has
// reached its targets before the stimulus arrives - otherwise every metric
// would depend on where the ramps happened to be, and the goldens would encode
// the ramp rather than the effect.
Stereo Render(const Case& test_case, const Stereo& input, int block_size) {
  AudioEngine engine;
  const BlockId id = engine.AddBlock(test_case.kind, 0, 0);
  OPENAXE_EXPECT(id >= 0);
  engine.Connect(kInRailId, 0, id, 0);
  engine.Connect(id, 0, kOutRailId, 0);
  engine.Reset(kSampleRate, block_size);
  if (test_case.reverb_algorithm) {
    engine.SetReverbAlgorithm(id, *test_case.reverb_algorithm);
  }
  for (const ParamWrite& w : test_case.params) {
    if (!SetParamBySymbol(engine, id, w.symbol, w.value)) {
      std::fprintf(stderr, "FAILED: %s has no param '%s'\n", test_case.name, w.symbol);
      ++openaxe::test::g_failures;
    }
  }

  std::vector<float> zeros(static_cast<size_t>(block_size), 0.0f);
  const int settle_blocks = (kSettleSamples + block_size - 1) / block_size;
  for (int b = 0; b < settle_blocks; ++b) {
    std::vector<float> ol(static_cast<size_t>(block_size), 0.0f);
    std::vector<float> orr(static_cast<size_t>(block_size), 0.0f);
    const float* in[2] = {zeros.data(), zeros.data()};
    float* out[2] = {ol.data(), orr.data()};
    engine.Process(in, 2, out, 2, block_size);
  }

  Stereo output(input.frames());
  for (int offset = 0; offset < input.frames(); offset += block_size) {
    const int n = std::min(block_size, input.frames() - offset);
    std::vector<float> il(input.left.begin() + offset, input.left.begin() + offset + n);
    std::vector<float> ir(input.right.begin() + offset, input.right.begin() + offset + n);
    std::vector<float> ol(static_cast<size_t>(n), 0.0f);
    std::vector<float> orr(static_cast<size_t>(n), 0.0f);
    const float* in[2] = {il.data(), ir.data()};
    float* out[2] = {ol.data(), orr.data()};
    engine.Process(in, 2, out, 2, n);
    std::copy(ol.begin(), ol.end(), output.left.begin() + offset);
    std::copy(orr.begin(), orr.end(), output.right.begin() + offset);
  }
  return output;
}

// Every stimulus gets the full metric set - see dsp_metrics.h on why the band
// shape is worth computing for all five rather than the impulse alone.
constexpr const char* kStimuli[] = {"impulse", "sweep", "two-tone", "silence", "pluck"};

Stereo MakeStimulus(const char* name, int frames) {
  if (std::strcmp(name, "impulse") == 0) return MakeImpulse(frames);
  if (std::strcmp(name, "sweep") == 0) return MakeSweep(frames, kSampleRate);
  if (std::strcmp(name, "two-tone") == 0) return MakeTwoTone(frames, kSampleRate);
  if (std::strcmp(name, "silence") == 0) return MakeSilence(frames);
  return MakePluck(frames, kSampleRate);
}

// ── Golden file ────────────────────────────────────────────────────────────

Value ToJson(const StimulusMetrics& m) {
  Value v = Value::Object();
  v.Set("peakL", Value::Number(m.peak_l));
  v.Set("peakR", Value::Number(m.peak_r));
  v.Set("rmsL", Value::Number(m.rms_l));
  v.Set("rmsR", Value::Number(m.rms_r));
  v.Set("onsetL", Value::Number(m.onset_l));
  v.Set("onsetR", Value::Number(m.onset_r));
  v.Set("correlation", Value::Number(m.correlation));
  Value bands = Value::Array();
  for (int b = 0; b < kBandCount; ++b) bands.items().push_back(Value::Number(m.bands_db[b]));
  v.Set("bandsDb", std::move(bands));
  return v;
}

// Compares one metric, reporting the case/stimulus/metric and both values on a
// mismatch - the message has to be enough to judge the change from CI output
// alone, without re-running anything locally.
struct Comparer {
  const char* case_name;
  const char* stimulus;
  int failures = 0;

  void Report(const char* metric, double golden, double actual, const char* unit) {
    std::fprintf(stderr, "  %s / %s / %s: golden %.6g%s, got %.6g%s\n", case_name, stimulus,
                 metric, golden, unit, actual, unit);
    ++failures;
  }

  void Abs(const char* metric, double golden, double actual, double tolerance,
           const char* unit = "") {
    if (std::fabs(golden - actual) > tolerance) Report(metric, golden, actual, unit);
  }

  // Relative below an absolute floor, so a near-silent metric does not fail on
  // a difference that is numerically large but inaudible.
  void Rel(const char* metric, double golden, double actual, double tolerance, double floor) {
    const double diff = std::fabs(golden - actual);
    if (diff <= floor) return;
    const double scale = std::max(std::fabs(golden), floor);
    if (diff / scale > tolerance) Report(metric, golden, actual, "");
  }
};

int Compare(const char* case_name, const char* stimulus, const Value& golden,
            const StimulusMetrics& actual) {
  Comparer c{case_name, stimulus};
  auto num = [&golden](const char* key, double fallback = 0.0) {
    const Value* v = golden.Find(key);
    return v != nullptr ? v->AsNumber(fallback) : fallback;
  };
  c.Rel("peakL", num("peakL"), actual.peak_l, kLevelRelTolerance, kLevelAbsFloor);
  c.Rel("peakR", num("peakR"), actual.peak_r, kLevelRelTolerance, kLevelAbsFloor);
  c.Rel("rmsL", num("rmsL"), actual.rms_l, kLevelRelTolerance, kLevelAbsFloor);
  c.Rel("rmsR", num("rmsR"), actual.rms_r, kLevelRelTolerance, kLevelAbsFloor);
  c.Abs("onsetL", num("onsetL", -1), actual.onset_l, kOnsetTolerance, " samples");
  c.Abs("onsetR", num("onsetR", -1), actual.onset_r, kOnsetTolerance, " samples");
  c.Abs("correlation", num("correlation"), actual.correlation, kCorrelationTolerance);
  const Value* bands = golden.Find("bandsDb");
  if (bands != nullptr && bands->IsArray() &&
      static_cast<int>(bands->items().size()) == kBandCount) {
    for (int b = 0; b < kBandCount; ++b) {
      char label[32];
      std::snprintf(label, sizeof(label), "band %.0fHz", kBandFrequencies[b]);
      const double g = bands->items()[static_cast<size_t>(b)].AsNumber(-120.0);
      if (std::fabs(g - actual.bands_db[b]) > kBandToleranceDb) {
        std::fprintf(stderr, "  %s / %s / %s: golden %.2f dB, got %.2f dB\n", case_name,
                     stimulus, label, g, actual.bands_db[b]);
        ++c.failures;
      }
    }
  }
  return c.failures;
}

}  // namespace

int main(int argc, char** argv) {
  bool bless = false;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--bless") == 0) bless = true;
  }
  const std::string golden_path = std::string(OPENAXE_GOLDEN_DIR) + "/dsp_metrics.json";

  const std::vector<Case> cases = BuildCases();
  OPENAXE_EXPECT(!cases.empty());

  // Render everything first, then compare, so a bless run and a check run walk
  // the same code path and cannot diverge.
  Value results = Value::Object();
  for (const Case& test_case : cases) {
    Value per_case = Value::Object();
    for (const char* stimulus : kStimuli) {
      const Stereo input = MakeStimulus(stimulus, kRenderFrames);
      const Stereo output = Render(test_case, input, kBlockSize);
      const StimulusMetrics m = Measure(output, kSampleRate);
      // Non-finite output is a hard failure whatever the golden says: no
      // tolerance makes a NaN acceptable.
      if (!m.finite) {
        std::fprintf(stderr, "FAILED: %s / %s produced non-finite output\n", test_case.name,
                     stimulus);
        ++openaxe::test::g_failures;
      }
      per_case.Set(stimulus, ToJson(m));
    }
    results.Set(test_case.name, std::move(per_case));
  }

  // Block-size invariance: the same rig rendered at 64 and at 512 must measure
  // the same. This is a property, not a golden - it needs no reference, and it
  // catches state that leaks across block boundaries (a phase not carried, a
  // coefficient recomputed per block against a per-sample value).
  for (const Case& test_case : cases) {
    const Stereo input = MakePluck(kRenderFrames, kSampleRate);
    const StimulusMetrics a = Measure(Render(test_case, input, 64), kSampleRate);
    const StimulusMetrics b = Measure(Render(test_case, input, 512), kSampleRate);
    // Looser than the golden tolerance: the two runs genuinely see different
    // smoothing granularity, so they are close rather than identical.
    const float scale = std::max({a.rms_l, b.rms_l, 1e-4f});
    if (std::fabs(a.rms_l - b.rms_l) / scale > 0.05f) {
      std::fprintf(stderr, "FAILED: %s rms differs by block size: 64 -> %.6g, 512 -> %.6g\n",
                   test_case.name, a.rms_l, b.rms_l);
      ++openaxe::test::g_failures;
    }
  }

  if (bless) {
    Value doc = Value::Object();
    doc.Set("$comment",
            Value::String("GENERATED by dsp_regression_test --bless (issue #315). Each entry is "
                          "a fingerprint of one effect preset under one stimulus - see "
                          "tests/dsp_metrics.h for what the numbers mean and why they are "
                          "metrics rather than audio. A PR that moves any value here must say "
                          "why in its description: the diff is the evidence the change was "
                          "intended."));
    doc.Set("sampleRate", Value::Number(kSampleRate));
    doc.Set("blockSize", Value::Number(kBlockSize));
    doc.Set("cases", std::move(results));
    const std::string text = openaxe::json::Write(doc) + "\n";
    FILE* f = std::fopen(golden_path.c_str(), "wb");
    if (f == nullptr) {
      std::fprintf(stderr, "cannot write %s\n", golden_path.c_str());
      return 1;
    }
    std::fwrite(text.data(), 1, text.size(), f);
    std::fclose(f);
    std::printf("blessed %zu case(s) -> %s\n", cases.size(), golden_path.c_str());
    return openaxe::test::g_failures == 0 ? 0 : 1;
  }

  // ── Check against the golden file ────────────────────────────────────────
  std::string golden_text;
  if (FILE* f = std::fopen(golden_path.c_str(), "rb")) {
    char buf[8192];
    size_t n;
    while ((n = std::fread(buf, 1, sizeof(buf), f)) > 0) golden_text.append(buf, n);
    std::fclose(f);
  } else {
    std::fprintf(stderr,
                 "FAILED: no golden file at %s - run dsp_regression_test --bless and review "
                 "the diff\n",
                 golden_path.c_str());
    return 1;
  }

  Value golden;
  std::string parse_error;
  if (!openaxe::json::Parse(golden_text.c_str(), golden, &parse_error)) {
    std::fprintf(stderr, "FAILED: golden file is not valid JSON: %s\n", parse_error.c_str());
    return 1;
  }
  const Value* golden_cases = golden.Find("cases");
  if (golden_cases == nullptr || !golden_cases->IsObject()) {
    std::fprintf(stderr, "FAILED: golden file has no 'cases' object\n");
    return 1;
  }

  int mismatches = 0;
  for (const Case& test_case : cases) {
    const Value* golden_case = golden_cases->Find(test_case.name);
    if (golden_case == nullptr) {
      std::fprintf(stderr, "FAILED: no golden reference for case '%s' - a new case needs a "
                           "--bless run\n", test_case.name);
      ++openaxe::test::g_failures;
      continue;
    }
    const Value* actual_case = results.Find(test_case.name);
    for (const char* stimulus : kStimuli) {
      const Value* g = golden_case->Find(stimulus);
      const Value* a = actual_case != nullptr ? actual_case->Find(stimulus) : nullptr;
      if (g == nullptr || a == nullptr) {
        std::fprintf(stderr, "FAILED: %s / %s missing from %s\n", test_case.name, stimulus,
                     g == nullptr ? "golden" : "results");
        ++openaxe::test::g_failures;
        continue;
      }
      // Re-read the measured values out of the JSON we just built, so the
      // comparison sees exactly what a bless run would have written - no
      // chance of the check passing on a precision the file cannot hold.
      StimulusMetrics m;
      m.peak_l = static_cast<float>(a->Find("peakL")->AsNumber());
      m.peak_r = static_cast<float>(a->Find("peakR")->AsNumber());
      m.rms_l = static_cast<float>(a->Find("rmsL")->AsNumber());
      m.rms_r = static_cast<float>(a->Find("rmsR")->AsNumber());
      m.onset_l = static_cast<int>(a->Find("onsetL")->AsNumber(-1));
      m.onset_r = static_cast<int>(a->Find("onsetR")->AsNumber(-1));
      m.correlation = static_cast<float>(a->Find("correlation")->AsNumber());
      const Value* ab = a->Find("bandsDb");
      for (int b = 0; b < kBandCount; ++b) {
        m.bands_db[b] = static_cast<float>(ab->items()[static_cast<size_t>(b)].AsNumber(-120.0));
      }
      mismatches += Compare(test_case.name, stimulus, *g, m);
    }
  }

  if (mismatches > 0) {
    std::fprintf(stderr,
                 "\n%d metric(s) drifted from tests/golden/dsp_metrics.json.\n"
                 "If the change was intended, re-run with --bless and explain the diff in the "
                 "PR description.\n",
                 mismatches);
    openaxe::test::g_failures += mismatches;
  }

  if (openaxe::test::g_failures == 0) {
    std::printf("dsp_regression_test passed (%zu cases x %zu stimuli)\n", cases.size(),
                std::size(kStimuli));
    return 0;
  }
  std::printf("dsp_regression_test FAILED (%d)\n", openaxe::test::g_failures);
  return 1;
}
