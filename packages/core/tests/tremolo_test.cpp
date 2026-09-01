// End-to-end test for the Tremolo wrapper (kTremolo): verifies full-depth
// modulation actually sweeps the output amplitude, that depth 0 is a
// passthrough, and that harmonic mode's band split is complementary and
// actually opposed. Hand-written DSP (issue #268), no vendor dependency.
#include "openaxe/dsp/tremolo.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::Tremolo;

namespace {

void TestParamCountAndInfo() {
  OPENAXE_EXPECT(Tremolo::ParamCount() == 5);
  const auto& rate = Tremolo::GetParamInfo(0);
  OPENAXE_EXPECT(std::string(rate.symbol) == "rate");
  const auto& shape = Tremolo::GetParamInfo(2);
  OPENAXE_EXPECT(std::string(shape.symbol) == "shape");
  OPENAXE_EXPECT(shape.min_value == 0.0f && shape.max_value == 2.0f);
  const auto& stereo = Tremolo::GetParamInfo(3);
  OPENAXE_EXPECT(std::string(stereo.symbol) == "stereo");
  const auto& mode = Tremolo::GetParamInfo(4);
  OPENAXE_EXPECT(std::string(mode.symbol) == "mode");
}

void TestGetSetEveryParam() {
  Tremolo trem;
  for (int i = 0; i < Tremolo::ParamCount(); ++i) {
    const auto& info = Tremolo::GetParamInfo(i);
    trem.SetParam(i, info.min_value);
    OPENAXE_EXPECT(trem.GetParam(i) == info.min_value);
    trem.SetParam(i, info.max_value);
    OPENAXE_EXPECT(trem.GetParam(i) == info.max_value);
  }
}

// Processes `frames` of constant 1.0 input through a tremolo configured with
// the given depth/rate and returns {min, max} of the last block's output.
std::pair<float, float> ModulationRange(float depth, float rate) {
  Tremolo trem;
  trem.Reset(48000.0);
  trem.SetParam(0 /* rate */, rate);
  trem.SetParam(1 /* depth */, depth);
  trem.SetParam(2 /* shape */, 0.0f /* Sine */);

  constexpr int kFrames = 256;
  std::vector<float> input(kFrames, 1.0f);
  std::vector<float> out_l(kFrames, 0.0f);
  std::vector<float> out_r(kFrames, 0.0f);
  const float* in_ptrs[2] = {input.data(), input.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};

  float lo = 1.0f;
  float hi = 0.0f;
  // 12 blocks of 256 = ~64 ms at 48 kHz; at 20 Hz that's ~1.3 LFO cycles,
  // enough to see both the peak and the trough of the sine modulation.
  for (int block = 0; block < 12; ++block) {
    trem.Process(in_ptrs, out_ptrs, kFrames);
    if (block >= 2) {  // let the depth smoother ramp in first
      for (int i = 0; i < kFrames; ++i) {
        lo = std::min(lo, out_l[i]);
        hi = std::max(hi, out_l[i]);
      }
    }
  }
  return {lo, hi};
}

void TestFullDepthModulatesAmplitude() {
  const auto [lo, hi] = ModulationRange(1.0f, 20.0f);
  OPENAXE_EXPECT(std::isfinite(lo) && std::isfinite(hi));
  OPENAXE_EXPECT(hi > 0.9f);   // near the peak the output approaches the input
  OPENAXE_EXPECT(lo < 0.1f);   // depth 1 = full cut, the trough dips toward zero
}

void TestZeroDepthIsPassthrough() {
  const auto [lo, hi] = ModulationRange(0.0f, 10.0f);
  OPENAXE_EXPECT(lo > 0.99f && hi < 1.01f);  // untouched within float tolerance
}

// Steady-state gain harmonic mode applies to a pure tone at `freq`, measured
// over the second half of a one-second render so the filters have settled.
float HarmonicGainAt(float freq, float depth) {
  constexpr int kFrames = 48000;
  constexpr double kSr = 48000.0;
  Tremolo trem;
  trem.Reset(kSr);
  trem.SetParam(0 /* rate */, 4.0f);
  trem.SetParam(1 /* depth */, depth);
  trem.SetParam(2 /* shape */, 0.0f);
  trem.SetParam(3 /* stereo */, 1.0f);
  trem.SetParam(4 /* mode */, 1.0f /* harmonic */);

  std::vector<float> in(kFrames), out_l(kFrames, 0.0f), out_r(kFrames, 0.0f);
  for (int i = 0; i < kFrames; ++i) {
    in[i] = 0.5f * static_cast<float>(std::sin(6.283185307 * freq * i / kSr));
  }
  const float* in_ptrs[2] = {in.data(), in.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};
  trem.Process(in_ptrs, out_ptrs, kFrames);

  double energy_in = 0.0, energy_out = 0.0;
  for (int i = kFrames / 2; i < kFrames; ++i) {
    energy_in += static_cast<double>(in[i]) * in[i];
    energy_out += static_cast<double>(out_l[i]) * out_l[i];
  }
  return static_cast<float>(std::sqrt(energy_out / energy_in));
}

// The regression this exists for. Harmonic mode splits the signal in two and
// modulates the halves in opposite phase; at depth 0 there is no modulation, so
// it must be transparent. It was not: the high band came from a separate
// second-order highpass at the same cutoff as the lowpass, and a matched
// second-order LP/HP pair is 180 degrees apart at the crossover, so the two
// summed to zero there. The measured hole was 112dB deep at 800Hz and still
// 8-10dB down an octave either side - audible on every note in the range.
void TestHarmonicModeIsTransparentAtZeroDepth() {
  // Straddling the 800Hz crossover, where the cancellation was total.
  for (float freq : {100.0f, 400.0f, 600.0f, 800.0f, 1000.0f, 1600.0f, 8000.0f}) {
    const float gain = HarmonicGainAt(freq, 0.0f);
    OPENAXE_EXPECT(std::isfinite(gain));
    // 0.1dB either way. The old code failed this by 112dB at 800Hz.
    OPENAXE_EXPECT(std::fabs(gain - 1.0f) < 0.012f);
  }
}

// Transparency alone would also be satisfied by doing nothing at all, so pin
// the actual behaviour too: at full depth the bands must be driven in opposite
// directions, which means a low tone and a high tone cannot both be quiet.
void TestHarmonicModeOpposesItsBands() {
  const float low = HarmonicGainAt(200.0f, 1.0f);
  const float high = HarmonicGainAt(4000.0f, 1.0f);
  OPENAXE_EXPECT(std::isfinite(low) && std::isfinite(high));
  // Both bands are swept, so neither sits at unity...
  OPENAXE_EXPECT(low < 0.95f && high < 0.95f);
  // ...but averaged over whole LFO cycles the pair still carries the signal,
  // rather than the whole thing dipping together as normal mode does.
  OPENAXE_EXPECT(low + high > 0.9f);
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestFullDepthModulatesAmplitude();
  TestZeroDepthIsPassthrough();
  TestHarmonicModeIsTransparentAtZeroDepth();
  TestHarmonicModeOpposesItsBands();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}