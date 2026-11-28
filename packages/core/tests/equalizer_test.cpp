// End-to-end test for the DSPark-backed Equalizer wrapper (kEq): 4 bands x
// {frequency, gain, q} = 12 params plus a global low-cut (HPF) and high-cut
// (LPF) in series after the bands = 14 params (issue #373). Verifies a band
// boost/cut actually changes the output energy at that frequency, the cuts
// attenuate out-of-band content, and that all-default bands are transparent.
// Only built if OPENAXE_HAS_DSPARK.
#include "openaxe/dsp/equalizer.h"

#include "openaxe/api.h"

#include <algorithm>
#include <cmath>
#include <numeric>
#include <string>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::Equalizer;

namespace {

void TestParamCountAndInfo() {
  OPENAXE_EXPECT(Equalizer::ParamCount() == 25);
  const auto& first = Equalizer::GetParamInfo(0);
  OPENAXE_EXPECT(std::string(first.symbol) == "band0_frequency");
  const auto& last_band = Equalizer::GetParamInfo(11);
  OPENAXE_EXPECT(std::string(last_band.symbol) == "band3_q");
  const auto& low_cut = Equalizer::GetParamInfo(12);
  OPENAXE_EXPECT(std::string(low_cut.symbol) == "low_cut");
  const auto& high_cut = Equalizer::GetParamInfo(13);
  OPENAXE_EXPECT(std::string(high_cut.symbol) == "high_cut");
  OPENAXE_EXPECT(std::string(Equalizer::GetParamInfo(14).symbol) == "mode");
  OPENAXE_EXPECT(std::string(Equalizer::GetParamInfo(15).symbol) == "graphic0_gain");
  OPENAXE_EXPECT(std::string(Equalizer::GetParamInfo(24).symbol) == "graphic9_gain");
}

void TestGetSetEveryParam() {
  Equalizer eq;
  for (int i = 0; i < Equalizer::ParamCount(); ++i) {
    const auto& info = Equalizer::GetParamInfo(i);
    eq.SetParam(i, info.min_value);
    OPENAXE_EXPECT(eq.GetParam(i) == info.min_value);
    eq.SetParam(i, info.max_value);
    OPENAXE_EXPECT(eq.GetParam(i) == info.max_value);
  }
}

// Peak output magnitude for a `freq_hz` sine of amplitude 1.0 through a fresh
// EQ with band 0 (low-shelf) set to gain_db, after a few warmup blocks.
float LowShelfSinePeak(float gain_db, int frames, int warmup_blocks) {
  Equalizer eq;
  eq.Reset(48000.0);
  eq.SetParam(0 /* band0_frequency */, 100.0f);
  eq.SetParam(1 /* band0_gain */, gain_db);
  eq.SetParam(2 /* band0_q */, 0.707f);

  std::vector<float> input(frames);
  std::vector<float> out_l(frames, 0.0f);
  std::vector<float> out_r(frames, 0.0f);
  const float* in_ptrs[2] = {input.data(), input.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};

  float peak = 0.0f;
  for (int block = 0; block < warmup_blocks + 1; ++block) {
    for (int i = 0; i < frames; ++i) {
      input[i] = std::sin(static_cast<float>(i) / 48000.0f * 100.0f * 6.283185307179586f);
    }
    eq.Process(in_ptrs, out_ptrs, frames);
    if (block == warmup_blocks) {
      for (int i = 0; i < frames; ++i) peak = std::max(peak, std::fabs(out_l[i]));
    }
  }
  return peak;
}

void TestBassBoostRaisesLevelBelowBoost() {
  // A 100 Hz sine through a low-shelf set to +12 dB at 100 Hz must come out
  // louder than the same EQ with -12 dB at 100 Hz.
  const float boosted = LowShelfSinePeak(12.0f, 256, 8);
  const float cut = LowShelfSinePeak(-12.0f, 256, 8);
  OPENAXE_EXPECT(std::isfinite(boosted) && std::isfinite(cut));
  OPENAXE_EXPECT(boosted > cut);
  OPENAXE_EXPECT(boosted > 1.0f);  // +12 dB -> peak well above the input's 1.0
  OPENAXE_EXPECT(cut < 1.0f);      // -12 dB -> peak well below the input's 1.0
}

// Peak output magnitude for a continuous `freq_hz` sine of amplitude 1.0
// through a fresh EQ with the series cuts set to low_cut_hz/high_cut_hz.
// Phase is continuous across blocks and only the post-warmup block is
// measured, so both the dspark bands and the cut biquads are in steady state.
float CutSinePeak(float freq_hz, float low_cut_hz, float high_cut_hz, int frames, int warmup_blocks) {
  Equalizer eq;
  eq.Reset(48000.0);
  eq.SetParam(12 /* low_cut */, low_cut_hz);
  eq.SetParam(13 /* high_cut */, high_cut_hz);

  std::vector<float> input(frames);
  std::vector<float> out_l(frames, 0.0f);
  std::vector<float> out_r(frames, 0.0f);
  const float* in_ptrs[2] = {input.data(), input.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};

  double phase = 0.0;
  const double step = static_cast<double>(freq_hz) * 6.283185307179586 / 48000.0;
  float peak = 0.0f;
  for (int block = 0; block < warmup_blocks + 1; ++block) {
    for (int i = 0; i < frames; ++i) {
      input[static_cast<size_t>(i)] = static_cast<float>(std::sin(phase));
      phase += step;
    }
    eq.Process(in_ptrs, out_ptrs, frames);
    if (block == warmup_blocks) {
      for (int i = 0; i < frames; ++i) peak = std::max(peak, std::fabs(out_l[i]));
    }
  }
  return peak;
}

void TestCutsAttenuateOutOfBand() {
  // 12 dB/oct cuts, well into the stopband: a 100 Hz sine through a 500 Hz
  // HPF (~2.3 octaves down, ~27 dB) and an 8 kHz sine through a 3 kHz LPF
  // (~1.4 octaves up, ~17 dB) must both come out strongly attenuated.
  const float hp_stop = CutSinePeak(100.0f, 500.0f, 20000.0f, 256, 8);
  const float lp_stop = CutSinePeak(8000.0f, 20.0f, 3000.0f, 256, 8);
  OPENAXE_EXPECT(std::isfinite(hp_stop) && std::isfinite(lp_stop));
  OPENAXE_EXPECT(hp_stop < 0.15f);
  OPENAXE_EXPECT(lp_stop < 0.3f);

  // ...while a 1 kHz sine with both cuts engaged (500 Hz / 3 kHz) passes
  // essentially untouched (each ~1+ octave into its passband).
  const float pass = CutSinePeak(1000.0f, 500.0f, 3000.0f, 256, 8);
  OPENAXE_EXPECT(std::isfinite(pass));
  OPENAXE_EXPECT(pass > 0.9f);
}

void TestAllDefaultsAreTransparent() {
  Equalizer eq;
  eq.Reset(48000.0);

  constexpr int kFrames = 256;
  std::vector<float> input(kFrames);
  std::vector<float> out_l(kFrames, 0.0f);
  std::vector<float> out_r(kFrames, 0.0f);
  const float* in_ptrs[2] = {input.data(), input.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};

  bool close = true;
  for (int block = 0; block < 8; ++block) {
    for (int i = 0; i < kFrames; ++i) {
      input[i] = 0.5f * std::sin(static_cast<float>(i) / 48000.0f * 500.0f * 6.283185307179586f);
    }
    eq.Process(in_ptrs, out_ptrs, kFrames);
    for (int i = 0; i < kFrames; ++i) {
      if (std::fabs(out_l[i] - input[i]) > 1e-3f) close = false;
    }
  }
  OPENAXE_EXPECT(close);
}

// Steady-state level of a unit sine at `freq_hz` through a graphic-mode EQ whose
// band `band` is set to `gain_db` (all others flat).
float GraphicSinePeak(int band, float gain_db, float freq_hz) {
  Equalizer eq;
  eq.Reset(48000.0);
  eq.SetParam(14, 1.0f);
  eq.SetParam(15 + band, gain_db);
  constexpr int kFrames = 4800;
  std::vector<float> input(kFrames), out_l(kFrames), out_r(kFrames);
  const float* in_ptrs[2] = {input.data(), input.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};
  double energy = 0.0;
  long count = 0;
  for (int block = 0; block < 6; ++block) {
    for (int i = 0; i < kFrames; ++i) {
      const int n = block * kFrames + i;
      input[i] = std::sin(static_cast<float>(n) / 48000.0f * freq_hz * 6.283185307179586f);
    }
    eq.Process(in_ptrs, out_ptrs, kFrames);
    if (block >= 4) {
      for (int i = 0; i < kFrames; ++i) {
        energy += static_cast<double>(out_l[i]) * out_l[i];
        ++count;
      }
    }
  }
  // RMS scaled to a unit-sine amplitude. Peak would under-read near Nyquist,
  // where a few samples per cycle never land on the crest.
  return static_cast<float>(std::sqrt(2.0 * energy / static_cast<double>(count)));
}

float DbOf(float linear) { return 20.0f * std::log10(linear); }

void TestGraphicBandGainAtCentre() {
  // Each octave band hits its set gain at its own centre frequency.
  const float centres[10] = {31.25f, 62.5f, 125.0f, 250.0f, 500.0f,
                             1000.0f, 2000.0f, 4000.0f, 8000.0f, 16000.0f};
  for (int band = 2; band < 10; ++band) {  // the lowest two are too slow to settle in 0.5 s
    OPENAXE_EXPECT(std::fabs(DbOf(GraphicSinePeak(band, 9.0f, centres[band])) - 9.0f) < 0.3f);
    OPENAXE_EXPECT(std::fabs(DbOf(GraphicSinePeak(band, -9.0f, centres[band])) + 9.0f) < 0.3f);
  }
  // A band does not move a frequency four octaves away.
  OPENAXE_EXPECT(std::fabs(DbOf(GraphicSinePeak(5, 12.0f, 62.5f))) < 0.6f);
}

void TestGraphicFlatIsBitIdentical() {
  Equalizer eq;
  eq.Reset(48000.0);
  eq.SetParam(14, 1.0f);
  constexpr int kFrames = 512;
  std::vector<float> input(kFrames), out_l(kFrames), out_r(kFrames);
  for (int i = 0; i < kFrames; ++i) input[i] = std::sin(static_cast<float>(i) * 0.05f);
  const float* in_ptrs[2] = {input.data(), input.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};
  eq.Process(in_ptrs, out_ptrs, kFrames);
  bool same = true;
  for (int i = 0; i < kFrames; ++i) same = same && out_l[i] == input[i] && out_r[i] == input[i];
  OPENAXE_EXPECT(same);
}

void TestGraphicModeIsolation() {
  // Parametric bands do nothing in graphic mode, and are live again after switching back.
  Equalizer eq;
  eq.Reset(48000.0);
  eq.SetParam(14, 1.0f);
  eq.SetParam(1, 12.0f);  // parametric band 0 gain - must be ignored in graphic mode
  constexpr int kFrames = 256;
  std::vector<float> input(kFrames, 0.5f), out_l(kFrames), out_r(kFrames);
  const float* in_ptrs[2] = {input.data(), input.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};
  eq.Process(in_ptrs, out_ptrs, kFrames);
  OPENAXE_EXPECT(out_l[kFrames - 1] == 0.5f);
  eq.SetParam(14, 0.0f);
  for (int block = 0; block < 4; ++block) eq.Process(in_ptrs, out_ptrs, kFrames);
  OPENAXE_EXPECT(out_l[kFrames - 1] > 0.5f * 2.0f);  // DC through a +12 dB low shelf
}

// The analysis tap (real-time analyser): off by default, then returns exactly
// the samples the block saw and produced, and nothing for unknown blocks.
void TestAnalysisTap() {
  OpenAxeGraph* g = openaxe_graph_create();
  const int32_t eq = openaxe_add_block(g, OPENAXE_BLOCK_EQ, 0, 0);
  OPENAXE_EXPECT(openaxe_connect(g, OPENAXE_IN_RAIL, 0, eq, 0) >= 0);
  OPENAXE_EXPECT(openaxe_connect(g, eq, 0, OPENAXE_OUT_RAIL, 0) >= 0);
  constexpr int32_t kBlock = 512;
  openaxe_reset(g, 48000.0, kBlock);

  std::vector<float> input(kBlock), output(kBlock);
  const float* in_ptrs[1] = {input.data()};
  float* out_ptrs[1] = {output.data()};
  std::vector<float> fed;
  auto run_blocks = [&](int blocks) {
    for (int b = 0; b < blocks; ++b) {
      for (int i = 0; i < kBlock; ++i) {
        input[i] = 0.5f * std::sin(static_cast<float>(fed.size() + i) * 0.07f);
      }
      fed.insert(fed.end(), input.begin(), input.end());
      openaxe_process(g, in_ptrs, 1, out_ptrs, 1, kBlock);
    }
  };

  std::vector<float> got(4096);
  run_blocks(10);
  OPENAXE_EXPECT(openaxe_get_block_samples(g, eq, 0, got.data(), 4096) == 0);  // tap off

  openaxe_set_block_tap(g, eq, 1);
  OPENAXE_EXPECT(openaxe_get_block_samples(g, eq, 0, got.data(), 4096) == 0);  // not yet filled
  run_blocks(10);                                                              // 5120 frames
  OPENAXE_EXPECT(openaxe_get_block_samples(g, eq, 0, got.data(), 4096) == 4096);
  // Input tap == the most recent 4096 frames fed in (default trim is unity), in order.
  bool in_matches = true;
  const size_t tail = fed.size() - 4096;
  for (size_t i = 0; i < 4096; ++i) in_matches = in_matches && std::fabs(got[i] - fed[tail + i]) < 1e-5f;
  OPENAXE_EXPECT(in_matches);
  // A flat EQ passes audio through, so the output tap matches too.
  OPENAXE_EXPECT(openaxe_get_block_samples(g, eq, 1, got.data(), 4096) == 4096);
  bool out_matches = true;
  for (size_t i = 0; i < 4096; ++i) out_matches = out_matches && std::fabs(got[i] - fed[tail + i]) < 1e-3f;
  OPENAXE_EXPECT(out_matches);
  // Counts above the ring size are capped; unknown blocks yield nothing.
  std::vector<float> big(8192);
  OPENAXE_EXPECT(openaxe_get_block_samples(g, eq, 0, big.data(), 8192) == 4096);
  OPENAXE_EXPECT(openaxe_get_block_samples(g, 999, 0, got.data(), 4096) == 0);

  openaxe_set_block_tap(g, eq, 0);
  OPENAXE_EXPECT(openaxe_get_block_samples(g, eq, 0, got.data(), 4096) == 0);

  // Master tap: off by default, and it keeps reporting the signal while the master is muted.
  OPENAXE_EXPECT(openaxe_get_master_samples(g, got.data(), 4096) == 0);
  openaxe_set_master_tap(g, 1);
  openaxe_set_master_muted(g, 1);
  run_blocks(10);
  OPENAXE_EXPECT(openaxe_get_master_samples(g, got.data(), 4096) == 4096);
  float peak = 0.0f;
  for (float v : got) peak = std::max(peak, std::fabs(v));
  OPENAXE_EXPECT(peak > 0.3f);                                        // the signal, not silence
  OPENAXE_EXPECT(std::fabs(*std::max_element(output.begin(), output.end())) < 1e-6f);  // yet muted
  openaxe_set_master_tap(g, 0);
  OPENAXE_EXPECT(openaxe_get_master_samples(g, got.data(), 4096) == 0);
  openaxe_graph_destroy(g);
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestBassBoostRaisesLevelBelowBoost();
  TestCutsAttenuateOutOfBand();
  TestAllDefaultsAreTransparent();
  TestGraphicBandGainAtCentre();
  TestGraphicFlatIsBitIdentical();
  TestGraphicModeIsolation();
  TestAnalysisTap();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}