// End-to-end test for the Phaser wrapper (kPhaser, issue #317). The DSP is
// dspark::Phaser (packages/core/third_party/dspark, MIT) voiced as an MXR
// Phase 90 - see src/dsp/phaser.cpp for the fixed pedal values (4 stages,
// triangle LFO, 200 Hz-2.8 kHz sweep, mono, wet-only) and phaser.h for why
// only rate + script are params. These tests pin the wrapper contract the
// engine depends on: the 2-param surface and its defaults, the mono sweep
// (both channels share one LFO), the Script/Block feedback voices, and that
// the sweep actually moves.
#include "openaxe/dsp/phaser.h"

#include <cmath>
#include <string>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::Phaser;

namespace {

constexpr double kSr = 48000.0;
constexpr int kFrames = 512;

void TestParamCountAndInfo() {
  OPENAXE_EXPECT(Phaser::ParamCount() == 2);
  const auto& rate = Phaser::GetParamInfo(0);
  // Symbol stays `rate` (presets saved with the old surface keep their
  // speed); the label reads Speed, like the pedal's knob.
  OPENAXE_EXPECT(std::string(rate.symbol) == "rate");
  OPENAXE_EXPECT(std::string(rate.name) == "Speed");
  OPENAXE_EXPECT(rate.unit != nullptr && std::string(rate.unit) == "Hz");
  const auto& script = Phaser::GetParamInfo(1);
  OPENAXE_EXPECT(std::string(script.symbol) == "script");
}

void TestGetSetEveryParam() {
  Phaser phaser;
  for (int i = 0; i < Phaser::ParamCount(); ++i) {
    const auto& info = Phaser::GetParamInfo(i);
    phaser.SetParam(i, info.min_value);
    OPENAXE_EXPECT(phaser.GetParam(i) == info.min_value);
    phaser.SetParam(i, info.max_value);
    OPENAXE_EXPECT(phaser.GetParam(i) == info.max_value);
  }
}

// A fresh wrapper voices the EVH default: slow swirl, Script voice on.
void TestDefaults() {
  Phaser phaser;
  OPENAXE_EXPECT(phaser.GetParam(0) == 0.5f);
  OPENAXE_EXPECT(phaser.GetParam(1) == 1.0f);
}

// Processes `frames` of input through the phaser; returns left/right outputs.
void RunPhaser(Phaser& phaser, const std::vector<float>& in_l,
               const std::vector<float>& in_r, std::vector<float>& out_l,
               std::vector<float>& out_r) {
  const int frames = static_cast<int>(in_l.size());
  out_l.assign(static_cast<size_t>(frames), 0.0f);
  out_r.assign(static_cast<size_t>(frames), 0.0f);
  const float* in_ptrs[2] = {in_l.data(), in_r.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};
  phaser.Process(in_ptrs, out_ptrs, frames);
}

// A harmonically rich, static test signal: three stacked sines so the moving
// notches always have spectrum to bite into wherever the sweep sits.
std::vector<float> TestSignal(int frames) {
  std::vector<float> in(static_cast<size_t>(frames), 0.0f);
  for (int i = 0; i < frames; ++i) {
    const double t = static_cast<double>(i) / kSr;
    in[static_cast<size_t>(i)] =
        static_cast<float>(0.4 * std::sin(6.283185307 * 220.0 * t) +
                           0.3 * std::sin(6.283185307 * 440.0 * t) +
                           0.2 * std::sin(6.283185307 * 880.0 * t));
  }
  return in;
}

// The pedal is mono, and the wrapper voices a mono sweep (stereo spread 0):
// identical inputs must produce bit-identical outputs. If a future change
// reintroduces a stereo spread, this fails and names the decision.
void TestMonoSweep() {
  Phaser phaser;
  phaser.Reset(kSr);
  phaser.SetParam(0 /* rate */, 0.5f);
  phaser.SetParam(1 /* script */, 1.0f);
  const std::vector<float> in = TestSignal(4096);
  std::vector<float> out_l, out_r;
  RunPhaser(phaser, in, in, out_l, out_r);
  OPENAXE_EXPECT(out_l == out_r);
}

// The Script switch must be audible: Block (hotter feedback) resonates
// harder than Script (light regeneration), so over two full LFO cycles its
// resonant peaks reach higher. Both voices must also differ from each other
// (a dead switch renders identical outputs).
void TestScriptVsBlock() {
  constexpr int kLong = 192000;  // 4 s at 48 kHz = 2 cycles at 0.5 Hz
  const std::vector<float> in = TestSignal(kLong);

  Phaser script;
  script.Reset(kSr);
  script.SetParam(0 /* rate */, 0.5f);
  script.SetParam(1 /* script */, 1.0f);
  std::vector<float> script_l, script_r;
  RunPhaser(script, in, in, script_l, script_r);

  Phaser block;
  block.Reset(kSr);
  block.SetParam(0 /* rate */, 0.5f);
  block.SetParam(1 /* script */, 0.0f);
  std::vector<float> block_l, block_r;
  RunPhaser(block, in, in, block_l, block_r);

  // The switch does something.
  float max_diff = 0.0f;
  float script_peak = 0.0f;
  float block_peak = 0.0f;
  for (int i = 0; i < kLong; ++i) {
    max_diff = std::max(max_diff, std::fabs(script_l[static_cast<size_t>(i)] -
                                            block_l[static_cast<size_t>(i)]));
    script_peak = std::max(script_peak, std::fabs(script_l[static_cast<size_t>(i)]));
    block_peak = std::max(block_peak, std::fabs(block_l[static_cast<size_t>(i)]));
  }
  OPENAXE_EXPECT(max_diff > 0.01f);
  // Hotter feedback peaks higher.
  OPENAXE_EXPECT(block_peak > script_peak);
}

// The LFO must actually sweep: with a static input, the only time variation
// in the output is the moving notches, so the second half of a half-cycle
// render must differ from the first.
void TestSweepMoves() {
  Phaser phaser;
  phaser.Reset(kSr);
  phaser.SetParam(0 /* rate */, 0.5f);  // 2 s period; 1 s render = half cycle
  phaser.SetParam(1 /* script */, 1.0f);
  constexpr int kHalfCycle = 48000;
  const std::vector<float> in = TestSignal(kHalfCycle);
  std::vector<float> out_l, out_r;
  RunPhaser(phaser, in, in, out_l, out_r);
  double drift = 0.0;
  for (int i = 0; i < kHalfCycle / 2; ++i) {
    const double d = static_cast<double>(out_l[static_cast<size_t>(i)]) -
                     static_cast<double>(out_l[static_cast<size_t>(i + kHalfCycle / 2)]);
    drift += d * d;
  }
  drift = std::sqrt(drift / (kHalfCycle / 2));
  OPENAXE_EXPECT(drift > 0.01);
}

// Smoke: the full rate range in both voices must stay finite and bounded (no
// runaway feedback, no NaNs), and must actually produce sound.
void TestSmokeFullRange() {
  Phaser phaser;
  phaser.Reset(kSr);
  for (float rate : {0.1f, 0.5f, 2.0f, 8.0f}) {
    for (float script : {0.0f, 1.0f}) {
      phaser.SetParam(0, rate);
      phaser.SetParam(1, script);
      const std::vector<float> in = TestSignal(kFrames);
      std::vector<float> out_l, out_r;
      RunPhaser(phaser, in, in, out_l, out_r);
      float max_abs = 0.0f;
      for (int i = 0; i < kFrames; ++i) {
        OPENAXE_EXPECT(std::isfinite(out_l[static_cast<size_t>(i)]));
        OPENAXE_EXPECT(std::isfinite(out_r[static_cast<size_t>(i)]));
        max_abs = std::max(max_abs, std::fabs(out_l[static_cast<size_t>(i)]));
      }
      OPENAXE_EXPECT(max_abs > 0.05f);
      OPENAXE_EXPECT(max_abs < 4.0f);
    }
  }
}

// Reset must preserve the knob positions (dspark::Phaser keeps its atomic
// params across prepare()) and restart the sweep deterministically: the same
// input rendered after a Reset is sample-identical.
void TestResetReappliesParams() {
  Phaser phaser;
  phaser.Reset(44100.0);
  phaser.SetParam(0, 2.0f);
  phaser.SetParam(1, 0.0f);
  phaser.Reset(48000.0);
  OPENAXE_EXPECT(phaser.GetParam(0) == 2.0f);
  OPENAXE_EXPECT(phaser.GetParam(1) == 0.0f);

  const std::vector<float> in = TestSignal(kFrames);
  std::vector<float> first_l, first_r, second_l, second_r;
  RunPhaser(phaser, in, in, first_l, first_r);
  phaser.Reset(48000.0);
  RunPhaser(phaser, in, in, second_l, second_r);
  OPENAXE_EXPECT(first_l == second_l);
  OPENAXE_EXPECT(first_r == second_r);
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestDefaults();
  TestMonoSweep();
  TestScriptVsBlock();
  TestSweepMoves();
  TestSmokeFullRange();
  TestResetReappliesParams();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}
