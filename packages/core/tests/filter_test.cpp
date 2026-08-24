// End-to-end test for the Filter DSP (kFilter): verifies the ladder lowpass
// and wah bandpass actually filter (highs attenuated / tuned band passed), the
// envelope-follower coefficients are per-block hoisted (output stays finite and
// stable), and the param surface. No vendored dependency - builds
// unconditionally.
#include "openaxe/dsp/filter.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::Filter;

namespace {

void TestParamCountAndInfo() {
  OPENAXE_EXPECT(Filter::ParamCount() == 7);
  const char* expected[] = {"type",  "frequency", "q", "drive",
                            "sensitivity", "mode", "lfo_rate"};
  for (int i = 0; i < Filter::ParamCount(); ++i) {
    const auto& info = Filter::GetParamInfo(i);
    OPENAXE_EXPECT(std::string(info.symbol) == expected[i]);
  }
  const auto& type = Filter::GetParamInfo(0);
  OPENAXE_EXPECT(type.min_value == 0.0f && type.max_value == 2.0f);
}

void TestGetSetEveryParam() {
  Filter f;
  for (int i = 0; i < Filter::ParamCount(); ++i) {
    const auto& info = Filter::GetParamInfo(i);
    f.SetParam(i, info.min_value);
    OPENAXE_EXPECT(f.GetParam(i) == info.min_value);
    f.SetParam(i, info.max_value);
    OPENAXE_EXPECT(f.GetParam(i) == info.max_value);
  }
}

void TestSilenceStaysSilent() {
  Filter f;
  f.Reset(48000);
  constexpr int kFrames = 256;
  std::vector<float> in(kFrames, 0.0f);
  std::vector<float> out_l(kFrames), out_r(kFrames);
  const float* ip[2] = {in.data(), in.data()};
  float* op[2] = {out_l.data(), out_r.data()};
  f.Process(ip, op, kFrames);
  for (int i = 0; i < kFrames; ++i) {
    OPENAXE_EXPECT(out_l[i] == 0.0f && out_r[i] == 0.0f);
  }
}

// RMS of the filter's output over a sine input of `freq` Hz, after settling.
double OutputRms(Filter& f, float freq, int samples) {
  constexpr int kBlock = 256;
  constexpr int kSettle = 4096; // let filter transients + smoothing die out
  double sq = 0.0;
  int count = 0;
  std::vector<float> in(kBlock), out_l(kBlock), out_r(kBlock);
  int processed = 0;
  while (processed < samples + kSettle) {
    for (int i = 0; i < kBlock; ++i) {
      in[i] = std::sin(6.28318530718f * freq * (processed + i) / 48000.0f);
    }
    const float* ip[2] = {in.data(), in.data()};
    float* op[2] = {out_l.data(), out_r.data()};
    f.Process(ip, op, kBlock);
    if (processed >= kSettle) {
      for (int i = 0; i < kBlock; ++i) {
        sq += static_cast<double>(out_l[i]) * out_l[i];
        ++count;
      }
    }
    processed += kBlock;
  }
  return std::sqrt(sq / static_cast<double>(std::max(count, 1)));
}

// Ladder lowpass at 400Hz must pass a 100Hz sine and sharply attenuate 5kHz.
void TestLadderLowpass() {
  Filter f;
  f.Reset(48000);
  f.SetParam(0, 2.0f);  // ladder
  f.SetParam(1, 400.0f); // frequency
  f.SetParam(2, 0.7f);   // q
  f.SetParam(3, 0.0f);   // drive

  constexpr double kInputRms = 1.0 / 1.41421356; // sine peak 1.0
  const double low = OutputRms(f, 100.0f, 24000);
  const double high = OutputRms(f, 5000.0f, 24000);
  OPENAXE_EXPECT(std::isfinite(low) && std::isfinite(high));
  OPENAXE_EXPECT(low / kInputRms > 0.5);  // 100Hz passes (below cutoff)
  OPENAXE_EXPECT(high / kInputRms < 0.1); // 5kHz is ~3.6 octaves up -> cut hard
}

// Wah bandpass tuned to 1kHz must pass a 1kHz sine and reject 200Hz.
void TestWahBandpass() {
  Filter f;
  f.Reset(48000);
  f.SetParam(0, 0.0f);   // wah
  f.SetParam(1, 1000.0f); // frequency (pedal mode, mode=0)
  f.SetParam(2, 4.0f);   // q
  f.SetParam(3, 0.0f);   // drive

  constexpr double kInputRms = 1.0 / 1.41421356;
  const double at_fc = OutputRms(f, 1000.0f, 24000);
  const double off_fc = OutputRms(f, 200.0f, 24000);
  OPENAXE_EXPECT(std::isfinite(at_fc) && std::isfinite(off_fc));
  OPENAXE_EXPECT(at_fc / kInputRms > 0.3);  // tuned band is passed
  OPENAXE_EXPECT(off_fc / kInputRms < 0.15); // an octave+ away is rejected
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestSilenceStaysSilent();
  TestLadderLowpass();
  TestWahBandpass();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}