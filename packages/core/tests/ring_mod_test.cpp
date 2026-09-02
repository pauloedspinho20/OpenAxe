// End-to-end test for the RingMod DSP (kRingMod): verifies the sine carrier's
// phase bookkeeping (a DC input × carrier must produce a clean unit sine), the
// drive saturation, and the param surface. No vendored dependency, so it builds
// unconditionally like wav_test/tone_stack_test.
#include "openaxe/dsp/ring_mod.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::RingMod;

namespace {

void TestParamCountAndInfo() {
  OPENAXE_EXPECT(RingMod::ParamCount() == 2);
  const auto& freq = RingMod::GetParamInfo(0);
  OPENAXE_EXPECT(std::string(freq.symbol) == "frequency");
  OPENAXE_EXPECT(freq.min_value == 20.0f && freq.max_value == 2000.0f);
  const auto& drive = RingMod::GetParamInfo(1);
  OPENAXE_EXPECT(std::string(drive.symbol) == "drive");
  OPENAXE_EXPECT(drive.min_value == 0.0f && drive.max_value == 1.0f);
}

void TestGetSetEveryParam() {
  RingMod rm;
  for (int i = 0; i < RingMod::ParamCount(); ++i) {
    const auto& info = RingMod::GetParamInfo(i);
    rm.SetParam(i, info.min_value);
    OPENAXE_EXPECT(rm.GetParam(i) == info.min_value);
    rm.SetParam(i, info.max_value);
    OPENAXE_EXPECT(rm.GetParam(i) == info.max_value);
  }
}

void TestSilenceStaysSilent() {
  RingMod rm;
  rm.Reset(48000);
  constexpr int kFrames = 256;
  std::vector<float> in(kFrames, 0.0f);
  std::vector<float> out_l(kFrames), out_r(kFrames);
  const float* ip[2] = {in.data(), in.data()};
  float* op[2] = {out_l.data(), out_r.data()};
  rm.Process(ip, op, kFrames);
  for (int i = 0; i < kFrames; ++i) {
    OPENAXE_EXPECT(out_l[i] == 0.0f && out_r[i] == 0.0f);
  }
}

// DC input × sine carrier = a sine at the carrier frequency. Over exactly
// 1000 cycles the mean must be ~0 (the DC is gone) and the peak ~1 (the
// carrier is a unit sine), which validates the per-sample phase increment and
// the inter-block phase handoff. DSPark's RingModulator has a small DC offset
// (sum ~16) due to its internal soar/saturation, so we check peak only.
void TestCarrierIsUnitSine() {
  RingMod rm;
  rm.Reset(48000);
  rm.SetParam(0, 1000.0f); // frequency
  rm.SetParam(1, 0.0f);    // drive (clean ring mod)

  constexpr int kFrames = 48000; // exactly 1000 cycles at 1kHz
  std::vector<float> in(kFrames, 1.0f);
  std::vector<float> out_l(kFrames), out_r(kFrames);
  const float* ip[2] = {in.data(), in.data()};
  float* op[2] = {out_l.data(), out_r.data()};
  rm.Process(ip, op, kFrames);

  double sum = 0.0, peak = 0.0;
  for (int i = 0; i < kFrames; ++i) {
    sum += out_l[i];
    peak = std::max(peak, static_cast<double>(std::fabs(out_l[i])));
  }
  // A DC input times a symmetric sine carrier must integrate to zero. The
  // assertion was deleted with "DSPark has small DC offset, not checking sum"
  // - the offset was real (-69 dBFS, from dspark's fastSin polynomial being
  // asymmetric about pi) and deleting the check hid it rather than filing it.
  // std::sin has no such asymmetry, so the property holds again.
  const double mean = sum / kFrames;
  OPENAXE_EXPECT(std::fabs(mean) < 1e-4);
  OPENAXE_EXPECT(peak > 0.98 && peak < 1.02);          // unit sine carrier
}

// drive must actually do something. The previous version of this test
// asserted `|peak_clean - peak_driven| < 1.0` with the comment "drive changes
// output somewhat" - and the measured difference was exactly 0.000000000,
// because the DSPark wrapper mapped drive onto `soar`, which that library
// only reads in its GeometricMean branch while the wrapper selected Classic.
// The assertion was satisfied by the knob being a bit-exact no-op, which is
// precisely what it should have caught. It now asserts the saturation is
// present and normalised.
void TestDriveSaturates() {
  constexpr int kFrames = 48000;
  std::vector<float> in(kFrames, 3.0f);
  std::vector<float> clean_l(kFrames), clean_r(kFrames), driven_l(kFrames), driven_r(kFrames);
  const float* ip[2] = {in.data(), in.data()};

  RingMod clean;
  clean.Reset(48000);
  clean.SetParam(0, 300.0f);
  clean.SetParam(1, 0.0f);
  float* op_clean[2] = {clean_l.data(), clean_r.data()};
  clean.Process(ip, op_clean, kFrames);

  RingMod driven;
  driven.Reset(48000);
  driven.SetParam(0, 300.0f);
  driven.SetParam(1, 1.0f);
  float* op_driven[2] = {driven_l.data(), driven_r.data()};
  driven.Process(ip, op_driven, kFrames);

  double peak_clean = 0.0, peak_driven = 0.0;
  for (int i = 0; i < kFrames; ++i) {
    peak_clean = std::max(peak_clean, static_cast<double>(std::fabs(clean_l[i])));
    peak_driven = std::max(peak_driven, static_cast<double>(std::fabs(driven_l[i])));
  }
  OPENAXE_EXPECT(peak_clean > 2.9);  // clean: 3 * |sin|
  // tanh(x*g)/tanh(g) compresses a 3.0 peak well below the clean one.
  OPENAXE_EXPECT(peak_driven > 0.5 && peak_driven < peak_clean);
  // The whole point: the knob must change the signal, not merely be present.
  double max_diff = 0.0;
  for (int i = 0; i < kFrames; ++i)
    max_diff = std::max(max_diff, static_cast<double>(std::fabs(clean_l[i] - driven_l[i])));
  OPENAXE_EXPECT(max_diff > 0.1);
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestSilenceStaysSilent();
  TestCarrierIsUnitSine();
  TestDriveSaturates();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}