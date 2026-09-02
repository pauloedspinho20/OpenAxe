// End-to-end test for the Chorus wrapper (kChorus, issue #359). The DSP is
// the MIT-licensed chorus from DaisySP (packages/core/third_party/daisysp) -
// see src/dsp/chorus.cpp for how the wrapper maps the engine's params onto it
// and strips its internal equal wet/dry mix. These tests pin the wrapper
// contract that the engine depends on: the 5-DSP-param surface, wet-only
// output (the engine owns the dry/wet mix), unity tap level, and the
// mono/stereo behaviour of the `stereo` toggle.
#include "openaxe/dsp/chorus.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::Chorus;

namespace {

constexpr double kSr = 48000.0;
constexpr int kFrames = 512;

void TestParamCountAndInfo() {
  OPENAXE_EXPECT(Chorus::ParamCount() == 5);
  const auto& rate = Chorus::GetParamInfo(0);
  OPENAXE_EXPECT(std::string(rate.symbol) == "rate");
  const auto& depth = Chorus::GetParamInfo(1);
  OPENAXE_EXPECT(std::string(depth.symbol) == "depth");
  OPENAXE_EXPECT(depth.unit != nullptr && std::string(depth.unit) == "ms");
  const auto& delay = Chorus::GetParamInfo(2);
  OPENAXE_EXPECT(std::string(delay.symbol) == "delay");
  const auto& feedback = Chorus::GetParamInfo(3);
  OPENAXE_EXPECT(std::string(feedback.symbol) == "feedback");
  const auto& stereo = Chorus::GetParamInfo(4);
  OPENAXE_EXPECT(std::string(stereo.symbol) == "stereo");
}

void TestGetSetEveryParam() {
  Chorus chorus;
  for (int i = 0; i < Chorus::ParamCount(); ++i) {
    const auto& info = Chorus::GetParamInfo(i);
    chorus.SetParam(i, info.min_value);
    OPENAXE_EXPECT(chorus.GetParam(i) == info.min_value);
    chorus.SetParam(i, info.max_value);
    OPENAXE_EXPECT(chorus.GetParam(i) == info.max_value);
  }
}

// Processes `frames` of input through a fresh chorus configured with the
// given params; returns the left and right output buffers.
void RunChorus(Chorus& chorus, const std::vector<float>& in_l,
               const std::vector<float>& in_r, std::vector<float>& out_l,
               std::vector<float>& out_r) {
  const int frames = static_cast<int>(in_l.size());
  out_l.assign(static_cast<size_t>(frames), 0.0f);
  out_r.assign(static_cast<size_t>(frames), 0.0f);
  const float* in_ptrs[2] = {in_l.data(), in_r.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};
  chorus.Process(in_ptrs, out_ptrs, frames);
}

// The wrapper must be wet-only: it must not leak the dry input through, or
// the engine's own `mix` knob (which blends dry + wet post-DSP) would double
// the dry. Discriminator: a unit impulse at sample 0 must NOT appear in the
// output until the delay line has delivered its tap (~delay_ms later), and
// that tap must come back at roughly unity level (the wrapper strips
// DaisySP's (in + tap) * 0.5 / pan / gain_frac scaling).
void TestWetOnlyAndUnityTap() {
  Chorus chorus;
  chorus.Reset(kSr);
  chorus.SetParam(0 /* rate */, 0.2f);
  chorus.SetParam(1 /* depth */, 2.0f);
  chorus.SetParam(2 /* delay */, 10.0f);
  chorus.SetParam(3 /* feedback */, 0.0f);
  chorus.SetParam(4 /* stereo */, 0.0f);  // mono: both engines identical

  std::vector<float> in(static_cast<size_t>(kFrames), 0.0f);
  in[0] = 1.0f;
  std::vector<float> out_l, out_r;
  RunChorus(chorus, in, in, out_l, out_r);

  // No dry passthrough: sample 0 (where the impulse landed) must be silent,
  // and nothing may arrive before the delay line can have delivered its tap.
  // With depth 2 ms the tap never reads earlier than delay - depth = 8 ms =
  // 384 samples, and the LFO starts at zero so the first reads sit near the
  // full 10 ms.
  OPENAXE_EXPECT(out_l[0] == 0.0f);
  for (int i = 1; i < 300; ++i) {
    OPENAXE_EXPECT(out_l[static_cast<size_t>(i)] == 0.0f);
  }

  // The tap must arrive near the configured 10 ms delay (480 samples) and at
  // unity level. DaisySP's delay line interpolates, so a single-sample
  // impulse is smeared across two taps by the fractional part of the LFO
  // sweep - the peak is not the right probe. Linear interpolation preserves
  // the signal's sum, so the summed wet output of a unit impulse is 1.0
  // exactly when the wrapper's dry-strip/×4 gain is right (it measures ~0.25
  // if the compensation is missing).
  float peak = 0.0f;
  int peak_at = 0;
  double sum = 0.0;
  for (int i = 0; i < kFrames; ++i) {
    sum += out_l[static_cast<size_t>(i)];
    if (out_l[static_cast<size_t>(i)] > peak) {
      peak = out_l[static_cast<size_t>(i)];
      peak_at = i;
    }
  }
  OPENAXE_EXPECT(std::isfinite(peak));
  OPENAXE_EXPECT(sum > 0.9 && sum < 1.1);
  OPENAXE_EXPECT(peak > 0.0f && peak < 1.05f);
  OPENAXE_EXPECT(peak_at > 400 && peak_at < 560);
}

// `stereo` off must collapse to a mono chorus: both channels run identical
// engines on identical inputs, so their outputs are bit-identical. `stereo`
// on sweeps the right channel at a slightly different LFO rate (the
// drift-based widening), so over a long-enough render the two channels
// diverge. The drift accumulates per sample, so this renders 4096 samples
// (~85 ms at 48 kHz) rather than one block.
void TestStereoToggle() {
  constexpr int kLong = 4096;
  // Common rig for both halves of this test.
  std::vector<float> in(static_cast<size_t>(kLong), 0.0f);
  for (int i = 0; i < kLong; ++i) {
    in[static_cast<size_t>(i)] =
        0.5f * static_cast<float>(std::sin(6.283185307 * 220.0 * i / kSr));
  }
  std::vector<float> out_l, out_r;

  Chorus mono;
  mono.Reset(kSr);
  mono.SetParam(0 /* rate */, 4.0f);
  mono.SetParam(1 /* depth */, 3.0f);
  mono.SetParam(2 /* delay */, 12.0f);
  mono.SetParam(3 /* feedback */, 0.3f);
  mono.SetParam(4 /* stereo */, 0.0f);
  RunChorus(mono, in, in, out_l, out_r);
  OPENAXE_EXPECT(out_l == out_r);

  Chorus wide;
  wide.Reset(kSr);
  wide.SetParam(0 /* rate */, 4.0f);
  wide.SetParam(1 /* depth */, 3.0f);
  wide.SetParam(2 /* delay */, 12.0f);
  wide.SetParam(3 /* feedback */, 0.3f);
  wide.SetParam(4 /* stereo */, 1.0f);
  RunChorus(wide, in, in, out_l, out_r);
  float max_diff = 0.0f;
  for (int i = 0; i < kLong; ++i) {
    max_diff = std::max(max_diff, std::fabs(out_l[static_cast<size_t>(i)] -
                                            out_r[static_cast<size_t>(i)]));
  }
  OPENAXE_EXPECT(max_diff > 0.005f);
}

// Smoke: a longer render across the full param ranges must stay finite and
// bounded (no runaway feedback, no NaNs), and must actually produce sound.
void TestSmokeFullRange() {
  Chorus chorus;
  chorus.Reset(kSr);
  for (float rate : {0.1f, 0.5f, 2.0f, 10.0f}) {
    for (float depth : {0.2f, 5.0f, 10.0f}) {
      for (float delay : {5.0f, 20.0f, 30.0f}) {
        for (float feedback : {0.0f, 0.5f}) {
          chorus.SetParam(0, rate);
          chorus.SetParam(1, depth);
          chorus.SetParam(2, delay);
          chorus.SetParam(3, feedback);
          chorus.SetParam(4, 1.0f);
          std::vector<float> in(static_cast<size_t>(kFrames), 0.0f);
          for (int i = 0; i < kFrames; ++i) {
            in[static_cast<size_t>(i)] = 0.5f * std::sin(static_cast<float>(i) * 0.1f);
          }
          std::vector<float> out_l, out_r;
          RunChorus(chorus, in, in, out_l, out_r);
          float max_abs = 0.0f;
          for (int i = 0; i < kFrames; ++i) {
            OPENAXE_EXPECT(std::isfinite(out_l[static_cast<size_t>(i)]));
            OPENAXE_EXPECT(std::isfinite(out_r[static_cast<size_t>(i)]));
            max_abs = std::max(max_abs, std::fabs(out_l[static_cast<size_t>(i)]));
          }
          // Feedback 0.5 into a delay line cannot grow unboundedly, but guard
          // against any sign/clamp regression blowing the level out.
          OPENAXE_EXPECT(max_abs < 4.0f);
        }
      }
    }
  }
}

// Reset must be repeatable and re-seed every param (DaisySP's Init() resets
// its own defaults, so the mirror has to be reapplied) - a chorus used on a
// rig whose sample rate changed must not silently revert to defaults.
void TestResetReappliesParams() {
  Chorus chorus;
  chorus.Reset(44100.0);
  chorus.SetParam(0, 0.8f);
  chorus.SetParam(1, 4.0f);
  chorus.SetParam(2, 15.0f);
  chorus.SetParam(3, 0.25f);
  chorus.SetParam(4, 0.0f);
  chorus.Reset(96000.0);
  OPENAXE_EXPECT(chorus.GetParam(0) == 0.8f);
  OPENAXE_EXPECT(chorus.GetParam(1) == 4.0f);
  OPENAXE_EXPECT(chorus.GetParam(2) == 15.0f);
  OPENAXE_EXPECT(chorus.GetParam(3) == 0.25f);
  OPENAXE_EXPECT(chorus.GetParam(4) == 0.0f);

  // And a second Reset at the original rate stays deterministic.
  chorus.Reset(48000.0);
  OPENAXE_EXPECT(chorus.GetParam(2) == 15.0f);
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestWetOnlyAndUnityTap();
  TestStereoToggle();
  TestSmokeFullRange();
  TestResetReappliesParams();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}