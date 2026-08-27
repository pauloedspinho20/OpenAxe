// End-to-end test for the PitchShifter DSP (kPitchShifter): property tests
// that pin the issue-#268 review fixes -
//   * whammy at 0 st is an exact ~30ms delay (no granular warble),
//   * +12 st doubles the input frequency and -12 st halves it,
//   * detune at 0 cents is an exact delay and at ±15 cents produces audible
//     two-voice beating (it's a real pitch offset, not a modulated delay).
// No vendored dependency - builds unconditionally.
#include "openaxe/dsp/pitch_shifter.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::PitchShifter;

namespace {

constexpr float kSr = 48000.0f;
constexpr float kTwoPi = 6.28318530718f;

// Run `in` through the shifter in blocks, feeding the same mono signal to both
// channels (each channel keeps independent state). Returns channel 0.
std::vector<float> Run(const std::vector<float>& in, PitchShifter& ps) {
  constexpr int kBlock = 512;
  std::vector<float> out(in.size(), 0.0f);
  for (size_t off = 0; off < in.size(); off += kBlock) {
    const int n = static_cast<int>(std::min<size_t>(kBlock, in.size() - off));
    const float* ip[2] = {in.data() + off, in.data() + off};
    float* op[2] = {out.data() + off, out.data() + off};
    ps.Process(ip, op, n);
  }
  return out;
}

void TestParamCountAndInfo() {
  OPENAXE_EXPECT(PitchShifter::ParamCount() == 3);
  const char* expected[] = {"mode", "pitch", "detune_cents"};
  for (int i = 0; i < PitchShifter::ParamCount(); ++i) {
    const auto& info = PitchShifter::GetParamInfo(i);
    OPENAXE_EXPECT(std::string(info.symbol) == expected[i]);
  }
  const auto& pitch = PitchShifter::GetParamInfo(1);
  OPENAXE_EXPECT(pitch.min_value == -12.0f && pitch.max_value == 12.0f);
  const auto& detune = PitchShifter::GetParamInfo(2);
  OPENAXE_EXPECT(detune.min_value == -15.0f && detune.max_value == 15.0f);
}

void TestGetSetEveryParam() {
  PitchShifter ps;
  for (int i = 0; i < PitchShifter::ParamCount(); ++i) {
    const auto& info = PitchShifter::GetParamInfo(i);
    ps.SetParam(i, info.min_value);
    OPENAXE_EXPECT(ps.GetParam(i) == info.min_value);
    ps.SetParam(i, info.max_value);
    OPENAXE_EXPECT(ps.GetParam(i) == info.max_value);
  }
}

void TestSilenceStaysSilent() {
  PitchShifter ps;
  ps.Reset(kSr);
  constexpr int kFrames = 256;
  std::vector<float> in(kFrames, 0.0f);
  std::vector<float> out_l(kFrames), out_r(kFrames);
  const float* ip[2] = {in.data(), in.data()};
  float* op[2] = {out_l.data(), out_r.data()};
  ps.Process(ip, op, kFrames);
  for (int i = 0; i < kFrames; ++i) {
    OPENAXE_EXPECT(out_l[i] == 0.0f && out_r[i] == 0.0f);
  }
}

// Dominant zero-crossing frequency over x[begin, end).
double ZeroCrossingHz(const std::vector<float>& x, size_t begin, size_t end) {
  int crossings = 0;
  for (size_t i = begin + 1; i < end; ++i) {
    if ((x[i - 1] < 0.0f && x[i] >= 0.0f) || (x[i - 1] > 0.0f && x[i] <= 0.0f)) ++crossings;
  }
  return crossings * kSr / (2.0 * static_cast<double>(end - begin));
}

// Lag in [lo, hi] maximizing the correlation of in[i] with out[i + lag].
int BestLag(const std::vector<float>& in, const std::vector<float>& out, int lo, int hi,
            double& corr) {
  const size_t n = out.size();
  const size_t win = 24000;  // use the tail of the buffers
  const size_t begin = n - win;
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

// whammy at 0 st must be a clean ~30ms delay: best correlation lag ≈ 1440
// samples (30ms at 48k) with correlation ~1, i.e. no unity-pitch warble.
void TestWhammyUnityIsCleanDelay() {
  constexpr float kFreq = 440.0f;
  const int total = 3 * 48000;
  std::vector<float> in(total);
  for (int i = 0; i < total; ++i) in[i] = std::sin(kTwoPi * kFreq * i / kSr);

  PitchShifter ps;
  ps.Reset(kSr);
  ps.SetParam(0, 1.0f); // whammy
  ps.SetParam(1, 0.0f); // 0 st
  const auto out = Run(in, ps);

  double corr = 0.0;
  const int lag = BestLag(in, out, 1300, 1600, corr);
  OPENAXE_EXPECT(std::fabs(lag - 1440) <= 3);
  OPENAXE_EXPECT(corr > 0.99);
}

// +12 st must double the frequency, -12 st halve it (spectral peak moves by
// the requested ratio).
void TestWhammyShiftsFrequency() {
  constexpr float kFreq = 440.0f;
  const int total = 3 * 48000;
  std::vector<float> in(total);
  for (int i = 0; i < total; ++i) in[i] = std::sin(kTwoPi * kFreq * i / kSr);

  PitchShifter up;
  up.Reset(kSr);
  up.SetParam(0, 1.0f);
  up.SetParam(1, 12.0f);
  const auto out_up = Run(in, up);
  const double f_up = ZeroCrossingHz(out_up, total - 48000, total);
  OPENAXE_EXPECT(std::fabs(f_up - 880.0) < 40.0);

  PitchShifter down;
  down.Reset(kSr);
  down.SetParam(0, 1.0f);
  down.SetParam(1, -12.0f);
  const auto out_down = Run(in, down);
  const double f_down = ZeroCrossingHz(out_down, total - 48000, total);
  OPENAXE_EXPECT(std::fabs(f_down - 220.0) < 15.0);
}

// Max/min RMS over 20ms windows of the tail - a measure of amplitude beating.
double EnvelopeRatio(const std::vector<float>& x, size_t begin, size_t end) {
  const int win = 960;  // 20ms
  double mx = 0.0, mn = 1e30;
  for (size_t s = begin; s + win < end; s += win) {
    double sq = 0.0;
    for (int i = 0; i < win; ++i) sq += static_cast<double>(x[s + i]) * x[s + i];
    const double rms = std::sqrt(sq / win);
    mx = std::max(mx, rms);
    mn = std::min(mn, rms);
  }
  return mx / std::max(mn, 1e-9);
}

// detune 0 cents = exact delay (no beating); ±15 cents = two voices an octave
// of cents apart, which beat audibly - the sign of a real pitch offset.
void TestDetuneBeats() {
  constexpr float kFreq = 440.0f;
  const int total = 3 * 48000;
  std::vector<float> in(total);
  for (int i = 0; i < total; ++i) in[i] = std::sin(kTwoPi * kFreq * i / kSr);

  PitchShifter zero;
  zero.Reset(kSr);
  zero.SetParam(0, 0.0f); // detune
  zero.SetParam(1, 0.0f);
  zero.SetParam(2, 0.0f);
  const auto out_zero = Run(in, zero);
  OPENAXE_EXPECT(EnvelopeRatio(out_zero, total - 96000, total - 48000) < 1.05);

  PitchShifter detuned;
  detuned.Reset(kSr);
  detuned.SetParam(0, 0.0f); // detune
  detuned.SetParam(1, 0.0f);
  detuned.SetParam(2, 15.0f);
  const auto out_detuned = Run(in, detuned);
  OPENAXE_EXPECT(EnvelopeRatio(out_detuned, total - 96000, total - 48000) > 1.5);
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestSilenceStaysSilent();
  TestWhammyUnityIsCleanDelay();
  TestWhammyShiftsFrequency();
  TestDetuneBeats();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}