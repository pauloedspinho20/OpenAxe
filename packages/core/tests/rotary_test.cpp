// End-to-end test for the Rotary (Leslie) DSP (kRotary): verifies the param
// surface, that a stopped rotor passes a constant input through unmodulated,
// and that switching to tremolo spins up with a ~1s ramp (the modulation rate
// grows over the first second rather than jumping straight to 6.8Hz) and
// converges to the tremolo AM range. No vendored dependency - builds
// unconditionally.
#include "openaxe/dsp/rotary.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::Rotary;

namespace {

constexpr float kSr = 48000.0f;

void TestParamCountAndInfo() {
  OPENAXE_EXPECT(Rotary::ParamCount() == 7);
  const char* expected[] = {"speed",        "drive",     "horn_level", "drum_level",
                            "mic_distance", "crossover", "velocity"};
  for (int i = 0; i < Rotary::ParamCount(); ++i) {
    const auto& info = Rotary::GetParamInfo(i);
    OPENAXE_EXPECT(std::string(info.symbol) == expected[i]);
  }
  const auto& speed = Rotary::GetParamInfo(0);
  OPENAXE_EXPECT(speed.min_value == 0.0f && speed.max_value == 2.0f);
}

void TestGetSetEveryParam() {
  Rotary r;
  for (int i = 0; i < Rotary::ParamCount(); ++i) {
    const auto& info = Rotary::GetParamInfo(i);
    r.SetParam(i, info.min_value);
    OPENAXE_EXPECT(r.GetParam(i) == info.min_value);
    r.SetParam(i, info.max_value);
    OPENAXE_EXPECT(r.GetParam(i) == info.max_value);
  }
}

// velocity is an octave trim about unity on the selected mode's rotor rate.
// Two properties worth pinning: it changes the sound at a fixed speed, and it
// cannot start the rotors when speed is Stop.
void TestVelocityTrimsRateButNotStop() {
  constexpr int kFrames = 48000 * 2;
  std::vector<float> in(kFrames);
  for (int i = 0; i < kFrames; ++i)
    in[i] = std::sin(6.28318530718f * 440.0f * static_cast<float>(i) / kSr) * 0.5f;

  const auto render = [&](float speed, float velocity) {
    Rotary r;
    r.Reset(kSr);
    r.SetParam(0, speed);
    r.SetParam(6, velocity);
    std::vector<float> l(kFrames), rr(kFrames);
    const float* ip[2] = {in.data(), in.data()};
    float* op[2] = {l.data(), rr.data()};
    r.Process(ip, op, kFrames);
    return l;
  };

  const auto slow = render(1.0f, 0.0f);
  const auto fast = render(1.0f, 1.0f);
  float moved = 0.0f;
  for (int i = 0; i < kFrames; ++i)
    moved = std::max(moved, std::fabs(slow[static_cast<size_t>(i)] - fast[static_cast<size_t>(i)]));
  OPENAXE_EXPECT(moved > 0.01f);

  // Stop: the rotors are braked, so velocity has nothing to scale.
  const auto stopped_min = render(0.0f, 0.0f);
  const auto stopped_max = render(0.0f, 1.0f);
  float stop_diff = 0.0f;
  for (int i = 0; i < kFrames; ++i)
    stop_diff = std::max(stop_diff, std::fabs(stopped_min[static_cast<size_t>(i)] -
                                              stopped_max[static_cast<size_t>(i)]));
  OPENAXE_EXPECT(stop_diff < 1e-6f);
}

void TestSilenceStaysSilent() {
  Rotary r;
  r.Reset(kSr);
  constexpr int kFrames = 256;
  std::vector<float> in(kFrames, 0.0f);
  std::vector<float> out_l(kFrames), out_r(kFrames);
  const float* ip[2] = {in.data(), in.data()};
  float* op[2] = {out_l.data(), out_r.data()};
  r.Process(ip, op, kFrames);
  for (int i = 0; i < kFrames; ++i) {
    OPENAXE_EXPECT(out_l[i] == 0.0f && out_r[i] == 0.0f);
  }
}

// Run `samples` of constant 1.0 DC input, returning channel 0 output.
std::vector<float> RunDc(Rotary& r, int samples) {
  constexpr int kBlock = 512;
  std::vector<float> out(static_cast<size_t>(samples));
  for (int off = 0; off < samples; off += kBlock) {
    const int n = std::min(kBlock, samples - off);
    std::vector<float> in(static_cast<size_t>(n), 1.0f);
    const float* ip[2] = {in.data(), in.data()};
    float* op[2] = {out.data() + off, out.data() + off};
    r.Process(ip, op, n);
  }
  return out;
}

// Zero-crossing rate of the AC part (signal minus its mean) over [begin, end).
// With DC input the low (drum) rotor carries the AM at the drum speed.
double AcZeroCrossingHz(const std::vector<float>& x, size_t begin, size_t end) {
  double mean = 0.0;
  for (size_t i = begin; i < end; ++i) mean += x[i];
  mean /= static_cast<double>(end - begin);
  int crossings = 0;
  for (size_t i = begin + 1; i < end; ++i) {
    const double a = x[i - 1] - mean;
    const double b = x[i] - mean;
    if ((a < 0.0 && b >= 0.0) || (a > 0.0 && b <= 0.0)) ++crossings;
  }
  return crossings * kSr / (2.0 * static_cast<double>(end - begin));
}

void TestStoppedRotorIsUnmodulated() {
  Rotary r;
  r.Reset(kSr);
  r.SetParam(0, 0.0f); // speed 0 = stop
  const int total = 2 * 48000;
  const auto out = RunDc(r, total);
  // Skip the drive/crossover/mic settle; the tail must be near-constant.
  double mn = 1e30, mx = -1e30;
  for (int i = total - 48000; i < total; ++i) {
    mn = std::min(mn, static_cast<double>(out[static_cast<size_t>(i)]));
    mx = std::max(mx, static_cast<double>(out[static_cast<size_t>(i)]));
  }
  OPENAXE_EXPECT(mx - mn < 0.05); // no rotor modulation when stopped
}

void TestTremoloSpinsUpGradually() {
  // Stop for 0.5s (so the rotor is settled), then switch to tremolo and watch
  // the AM rate ramp up over ~1s rather than appearing instantly.
  Rotary r;
  r.Reset(kSr);
  r.SetParam(0, 0.0f);
  const int pre = 24000;
  const int total = 3 * 48000; // 2.5s after the switch
  std::vector<float> out(static_cast<size_t>(pre + total));
  for (int off = 0; off < pre; off += 512) {
    std::vector<float> in(512, 1.0f);
    const float* ip[2] = {in.data(), in.data()};
    float ol[512] = {0}, orr[512] = {0};
    float* op[2] = {ol, orr};
    r.Process(ip, op, 512);
  }
  r.SetParam(0, 2.0f); // tremolo
  const auto tail = RunDc(r, total);

  const double early = AcZeroCrossingHz(tail, 0, 24000);              // first 0.5s
  const double late = AcZeroCrossingHz(tail, 24000, 48000);           // next 0.5s
  const double settled = AcZeroCrossingHz(tail, total - 24000, total); // last 0.5s
  OPENAXE_EXPECT(std::isfinite(early) && std::isfinite(late) && std::isfinite(settled));
  // Gradual spin-up: the rate later in the ramp is higher than early on...
  OPENAXE_EXPECT(late > early);
  // ...and it converges to the drum rotor's tremolo range (5.4Hz, ±1Hz).
  OPENAXE_EXPECT(settled > 4.0 && settled < 7.0);
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestVelocityTrimsRateButNotStop();
  TestSilenceStaysSilent();
  TestStoppedRotorIsUnmodulated();
  TestTremoloSpinsUpGradually();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}