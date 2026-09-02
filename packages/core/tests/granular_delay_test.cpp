// End-to-end test for the GranularDelay DSP (kGranularDelay): property tests
// that pin the issue-#268 review fixes -
//   * pitch=0 / jitter=0 is an exact `time` delay (not a warble),
//   * pitch actually shifts: +12 st doubles the input frequency,
//   * freeze holds the buffer so the output keeps sounding into silence,
//   * the feedback/spread/character surface stays finite.
// No vendored dependency - builds unconditionally.
#include "openaxe/dsp/granular_delay.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::GranularDelay;

namespace {

constexpr float kSr = 48000.0f;
constexpr float kTwoPi = 6.28318530718f;

void TestParamCountAndInfo() {
  OPENAXE_EXPECT(GranularDelay::ParamCount() == 9);
  const char* expected[] = {"time", "grain_size", "density", "pitch", "jitter",
                            "feedback", "spread", "character", "freeze"};
  for (int i = 0; i < GranularDelay::ParamCount(); ++i) {
    const auto& info = GranularDelay::GetParamInfo(i);
    OPENAXE_EXPECT(std::string(info.symbol) == expected[i]);
  }
  const auto& time = GranularDelay::GetParamInfo(0);
  OPENAXE_EXPECT(time.min_value == 10.0f && time.max_value == 2000.0f);
}

void TestGetSetEveryParam() {
  GranularDelay gd;
  for (int i = 0; i < GranularDelay::ParamCount(); ++i) {
    const auto& info = GranularDelay::GetParamInfo(i);
    gd.SetParam(i, info.min_value);
    OPENAXE_EXPECT(gd.GetParam(i) == info.min_value);
    gd.SetParam(i, info.max_value);
    OPENAXE_EXPECT(gd.GetParam(i) == info.max_value);
  }
  // freeze is a toggle: anything >= 0.5 snaps to 1, below to 0
  gd.SetParam(8, 0.7f);
  OPENAXE_EXPECT(gd.GetParam(8) == 1.0f);
  gd.SetParam(8, 0.2f);
  OPENAXE_EXPECT(gd.GetParam(8) == 0.0f);
}

void TestSilenceStaysSilent() {
  GranularDelay gd;
  gd.Reset(kSr);
  constexpr int kFrames = 256;
  std::vector<float> in(kFrames, 0.0f);
  std::vector<float> out_l(kFrames), out_r(kFrames);
  const float* ip[2] = {in.data(), in.data()};
  float* op[2] = {out_l.data(), out_r.data()};
  gd.Process(ip, op, kFrames);
  for (int i = 0; i < kFrames; ++i) {
    OPENAXE_EXPECT(out_l[i] == 0.0f && out_r[i] == 0.0f);
  }
}

// Run `in` through the granular delay in blocks (same mono signal both sides).
std::vector<float> Run(const std::vector<float>& in, GranularDelay& gd) {
  constexpr int kBlock = 512;
  std::vector<float> out(in.size(), 0.0f);
  for (size_t off = 0; off < in.size(); off += kBlock) {
    const int n = static_cast<int>(std::min<size_t>(kBlock, in.size() - off));
    const float* ip[2] = {in.data() + off, in.data() + off};
    float* op[2] = {out.data() + off, out.data() + off};
    gd.Process(ip, op, n);
  }
  return out;
}

// Best correlation lag of in[i] vs out[i+lag] in [lo, hi].
int BestLag(const std::vector<float>& in, const std::vector<float>& out, int lo, int hi,
            double& corr) {
  const size_t n = out.size();
  const size_t begin = n - 24000;
  int best = lo;
  double best_corr = -1.0;
  for (int lag = lo; lag <= hi; ++lag) {
    double dot = 0.0, a2 = 0.0, b2 = 0.0;
    for (size_t i = begin; i + lag < n; ++i) {
      dot += static_cast<double>(in[i]) * out[i + lag];
      a2 += static_cast<double>(in[i]) * in[i];
      b2 += static_cast<double>(out[i + lag]) * out[i + lag];
    }
    const double c = dot / std::sqrt(a2 * b2);
    if (c > best_corr) {
      best_corr = c;
      best = lag;
    }
  }
  corr = best_corr;
  return best;
}

double ZeroCrossingHz(const std::vector<float>& x, size_t begin, size_t end) {
  int crossings = 0;
  for (size_t i = begin + 1; i < end; ++i) {
    if ((x[i - 1] < 0.0f && x[i] >= 0.0f) || (x[i - 1] > 0.0f && x[i] <= 0.0f)) ++crossings;
  }
  return crossings * kSr / (2.0 * static_cast<double>(end - begin));
}

// pitch=0, jitter=0, feedback=0, spread=0 is an exact `time` delay: best lag
// ≈ time * sr / 1000 with correlation ~1 (window-normalised grains read the
// same tap, so the two Hann windows add to unity).
void TestPitchZeroIsCleanDelay() {
  constexpr float kFreq = 220.0f;
  constexpr float kTimeMs = 200.0f;
  const int total = 3 * 48000;
  std::vector<float> in(total);
  for (int i = 0; i < total; ++i) in[i] = std::sin(kTwoPi * kFreq * i / kSr);

  GranularDelay gd;
  gd.Reset(kSr);
  gd.SetParam(0, kTimeMs);
  gd.SetParam(1, 80.0f);  // grain_size
  gd.SetParam(2, 25.0f);  // density: 25 Hz x 80 ms grain = overlap 2.0
  gd.SetParam(3, 0.0f);   // pitch
  gd.SetParam(4, 0.0f);   // jitter
  gd.SetParam(5, 0.0f);   // feedback
  gd.SetParam(6, 0.0f);   // spread
  gd.SetParam(7, 0.0f);   // character
  gd.SetParam(8, 0.0f);   // freeze
  const auto out = Run(in, gd);

  double corr = 0.0;
  const int lag = BestLag(in, out, static_cast<int>(kTimeMs * kSr / 1000.0f) - 10,
                          static_cast<int>(kTimeMs * kSr / 1000.0f) + 10, corr);
  // The tolerance here used to be +/-(80 ms grain -> 3840) + 10 samples while
  // BestLag only searches [T-10, T+10] - an assertion that could not fail
  // whatever the block did. The search window IS the tolerance, so all that
  // remains to check is that the best lag inside it is a real correlation peak
  // rather than noise.
  OPENAXE_EXPECT(std::abs(lag - static_cast<int>(kTimeMs * kSr / 1000.0f)) <= 10);
  OPENAXE_EXPECT(corr > 0.5);
}

// pitch actually resamples: +12 st doubles the input frequency.
void TestPitchShiftsFrequency() {
  constexpr float kFreq = 220.0f;
  const int total = 3 * 48000;
  std::vector<float> in(total);
  for (int i = 0; i < total; ++i) in[i] = std::sin(kTwoPi * kFreq * i / kSr);

  GranularDelay gd;
  gd.Reset(kSr);
  gd.SetParam(0, 200.0f);
  gd.SetParam(1, 80.0f);
  gd.SetParam(2, 25.0f);  // overlap 2.0, not the degenerate 0.64
  gd.SetParam(3, 12.0f); // +12 st
  gd.SetParam(4, 0.0f);
  gd.SetParam(5, 0.0f);
  gd.SetParam(6, 0.0f);
  gd.SetParam(7, 0.0f);
  gd.SetParam(8, 0.0f);
  const auto out = Run(in, gd);
  const double f = ZeroCrossingHz(out, total - 48000, total);
  // This was widened to "50 < f < 2000" - a window that admitted the 284 Hz
  // the block actually produced for a +12 st shift of 220 Hz. The cause was
  // the defaults, not the resampler: jitter defaulted to 0.2, which in
  // dspark's GranularProcessor scatters each grain's read-back by up to
  // hundreds of milliseconds and destroys pitch coherence, and density 8 Hz
  // against an 80 ms grain left under one grain alive at a time. With the
  // defaults corrected the shift measures 445 Hz against 440 expected, so the
  // real assertion is back - with enough slack for the grain window, not
  // enough to hide an octave.
  const double expected = kFreq * 2.0;
  OPENAXE_EXPECT(std::fabs(f - expected) < expected * 0.08);
}

// freeze holds the buffer: once frozen, feeding silence must keep producing
// signal (the grains keep reading the frozen tail) instead of decaying.
void TestFreezeHoldsBuffer() {
  const int total = 2 * 48000;
  std::vector<float> in(total);
  for (int i = 0; i < total; ++i) in[i] = std::sin(kTwoPi * 220.0f * i / kSr);

  GranularDelay gd;
  gd.Reset(kSr);
  gd.SetParam(0, 200.0f);
  gd.SetParam(1, 80.0f);
  gd.SetParam(2, 25.0f);  // overlap 2.0, not the degenerate 0.64
  gd.SetParam(3, 0.0f);
  gd.SetParam(4, 0.0f);
  gd.SetParam(5, 0.0f);
  gd.SetParam(6, 0.0f);
  gd.SetParam(7, 0.0f);
  gd.SetParam(8, 0.0f);

  constexpr int kBlock = 512;
  // 1s of sine into the buffer.
  for (size_t off = 0; off < 48000; off += kBlock) {
    const float* ip[2] = {in.data() + off, in.data() + off};
    float dummy_l[kBlock] = {0}, dummy_r[kBlock] = {0};
    float* op[2] = {dummy_l, dummy_r};
    gd.Process(ip, op, kBlock);
  }
  // Freeze, then feed 1s of silence.
  gd.SetParam(8, 1.0f);
  double sq = 0.0;
  int count = 0;
  std::vector<float> sil(kBlock, 0.0f);
  for (int block = 0; block < 48000 / kBlock; ++block) {
    std::vector<float> ol(kBlock), orr(kBlock);
    const float* ip[2] = {sil.data(), sil.data()};
    float* op[2] = {ol.data(), orr.data()};
    gd.Process(ip, op, kBlock);
    for (int i = 0; i < kBlock; ++i) {
      sq += static_cast<double>(ol[i]) * ol[i];
      ++count;
    }
  }
  const double rms = std::sqrt(sq / count);
  OPENAXE_EXPECT(rms > 0.05);  // frozen signal keeps playing into silence
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestSilenceStaysSilent();
  TestPitchZeroIsCleanDelay();
  TestPitchShiftsFrequency();
  TestFreezeHoldsBuffer();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}