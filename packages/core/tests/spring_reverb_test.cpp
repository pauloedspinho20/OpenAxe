// End-to-end test for the hand-rolled spring tank reverb (kReverb with
// ReverbAlgorithm::kSpring).
//
// The first version of this file asserted only "finite, non-silent, not
// growing". Every one of the defects below was present and it passed anyway,
// so the assertions here are written against the specific failure modes that
// were measured rather than against generic liveness:
//
//   - a channel-outer Process loop advanced the LFO and the shared pre-delay
//     line once per channel, making the output depend on the host block size
//     (max|128 vs 512| was 1.67) and halving the pre-delay,
//   - the right channel read the left channel's audio out of that shared line,
//   - `width` produced no stereo image at all (L and R were bit-identical),
//   - `decay` delivered ~0.45x the requested RT60,
//   - damping sat on the output tap, not in the feedback loop, so the tail
//     never darkened,
//   - four springs summed with no normalisation, running +5 dB hot.
#include "openaxe/dsp/spring_reverb.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::SpringReverb;

namespace {

constexpr int kDryLevel = 0;
constexpr int kDecay = 1;
constexpr int kHighCut = 2;
constexpr int kWidth = 3;
constexpr int kPredelay = 4;
constexpr int kSpin = 5;
constexpr int kWander = 6;
constexpr int kDrive = 7;

constexpr float kSampleRate = 48000.0f;

// Render `in` through `r` in fixed-size blocks, as a host would.
void RenderBlocks(SpringReverb& r, const std::vector<float>& in_l, const std::vector<float>& in_r,
                  std::vector<float>& out_l, std::vector<float>& out_r, int block) {
  const int n = static_cast<int>(in_l.size());
  out_l.assign(static_cast<size_t>(n), 0.0f);
  out_r.assign(static_cast<size_t>(n), 0.0f);
  for (int i = 0; i < n; i += block) {
    const int frames = std::min(block, n - i);
    const float* input[2] = {in_l.data() + i, in_r.data() + i};
    float* output[2] = {out_l.data() + i, out_r.data() + i};
    r.Process(input, output, frames);
  }
}

// A fully-wet tank with modulation and pre-delay engaged - the configuration
// in which every block-size and channel-sharing bug showed up.
void ConfigureWet(SpringReverb& r, float decay, float predelay, float spin, float wander,
                  float width) {
  r.Reset(kSampleRate);
  r.SetParam(kDryLevel, 0.0f);
  r.SetParam(kDecay, decay);
  r.SetParam(kHighCut, 8000.0f);
  r.SetParam(kWidth, width);
  r.SetParam(kPredelay, predelay);
  r.SetParam(kSpin, spin);
  r.SetParam(kWander, wander);
  r.SetParam(kDrive, 0.0f);
}

std::vector<float> Impulse(int n) {
  std::vector<float> v(static_cast<size_t>(n), 0.0f);
  v[0] = 1.0f;
  return v;
}

std::vector<float> Tone(int n, float freq, float amp) {
  std::vector<float> v(static_cast<size_t>(n));
  for (int i = 0; i < n; ++i)
    v[static_cast<size_t>(i)] = std::sin(6.28318530718f * freq * static_cast<float>(i) / kSampleRate) * amp;
  return v;
}

float Peak(const std::vector<float>& v, int from = 0) {
  float p = 0.0f;
  for (int i = from; i < static_cast<int>(v.size()); ++i) p = std::max(p, std::fabs(v[static_cast<size_t>(i)]));
  return p;
}

// Seconds until the envelope's last excursion above -60 dB relative to the
// early peak: the tank's actual RT60.
float MeasureRt60(const std::vector<float>& v) {
  float early = 0.0f;
  for (int i = 0; i < 4800 && i < static_cast<int>(v.size()); ++i)
    early = std::max(early, std::fabs(v[static_cast<size_t>(i)]));
  const float thresh = early * 0.001f;
  int last = 0;
  for (int i = 0; i < static_cast<int>(v.size()); ++i)
    if (std::fabs(v[static_cast<size_t>(i)]) > thresh) last = i;
  return static_cast<float>(last) / kSampleRate;
}

void TestParamCountAndInfo() {
  OPENAXE_EXPECT(SpringReverb::ParamCount() == 8);
  OPENAXE_EXPECT(std::string(SpringReverb::GetParamInfo(kDryLevel).symbol) == "dry_level");
  OPENAXE_EXPECT(std::string(SpringReverb::GetParamInfo(kDecay).symbol) == "decay");
  OPENAXE_EXPECT(std::string(SpringReverb::GetParamInfo(kHighCut).symbol) == "high_cut");
  OPENAXE_EXPECT(std::string(SpringReverb::GetParamInfo(kWidth).symbol) == "width");
  OPENAXE_EXPECT(std::string(SpringReverb::GetParamInfo(kPredelay).symbol) == "predelay");
  OPENAXE_EXPECT(std::string(SpringReverb::GetParamInfo(kSpin).symbol) == "spin");
  OPENAXE_EXPECT(std::string(SpringReverb::GetParamInfo(kWander).symbol) == "wander");
  OPENAXE_EXPECT(std::string(SpringReverb::GetParamInfo(kDrive).symbol) == "drive");
}

void TestGetSetEveryParam() {
  SpringReverb r;
  for (int i = 0; i < SpringReverb::ParamCount(); ++i) {
    const auto& info = SpringReverb::GetParamInfo(i);
    r.SetParam(i, info.min_value);
    OPENAXE_EXPECT(r.GetParam(i) == info.min_value);
    r.SetParam(i, info.max_value);
    OPENAXE_EXPECT(r.GetParam(i) == info.max_value);
    // Out-of-range writes must clamp, not store: automation and preset load
    // both reach SetParam without passing through the UI's knob limits.
    r.SetParam(i, info.max_value * 10.0f + 1.0f);
    OPENAXE_EXPECT(r.GetParam(i) <= info.max_value);
    r.SetParam(i, info.min_value - 1000.0f);
    OPENAXE_EXPECT(r.GetParam(i) >= info.min_value);
  }
}

void TestImpulseProducesFiniteDecayingTail() {
  SpringReverb r;
  ConfigureWet(r, 2.0f, 0.0f, 0.0f, 0.0f, 100.0f);
  constexpr int kFrames = 48000 * 2;
  const auto in = Impulse(kFrames);
  std::vector<float> out_l, out_r;
  RenderBlocks(r, in, in, out_l, out_r, 128);

  bool all_finite = true;
  float peak = 0.0f, late_peak = 0.0f;
  bool has_early = false;
  for (int i = 0; i < kFrames; ++i) {
    const float l = out_l[static_cast<size_t>(i)], rr = out_r[static_cast<size_t>(i)];
    if (!std::isfinite(l) || !std::isfinite(rr)) all_finite = false;
    peak = std::max(peak, std::fabs(l));
    if (i > 100 && i < 8000 && std::fabs(l) > 1e-4f) has_early = true;
    if (i > kFrames - 4800) late_peak = std::max(late_peak, std::fabs(l));
  }
  OPENAXE_EXPECT(all_finite);
  OPENAXE_EXPECT(has_early);
  OPENAXE_EXPECT(peak > 0.0f);
  // A 2 s decay must be well down after 2 s, not merely "not growing".
  OPENAXE_EXPECT(late_peak < peak * 0.05f);
}

// The defect: Process looped channels-outer, so the LFO phase and the shared
// pre-delay line advanced once per channel per block. Rendering the same
// input at two block sizes gave completely different audio (max|diff| 1.67).
void TestOutputIsIndependentOfBlockSize() {
  constexpr int kFrames = 48000;
  const auto in = Impulse(kFrames);
  std::vector<float> ref_l, ref_r;
  {
    SpringReverb r;
    ConfigureWet(r, 2.0f, 20.0f, 2.0f, 20.0f, 120.0f);
    RenderBlocks(r, in, in, ref_l, ref_r, 128);
  }
  for (int block : {1, 64, 256, 512, 1024}) {
    SpringReverb r;
    ConfigureWet(r, 2.0f, 20.0f, 2.0f, 20.0f, 120.0f);
    std::vector<float> out_l, out_r;
    RenderBlocks(r, in, in, out_l, out_r, block);
    float max_diff = 0.0f;
    for (int i = 0; i < kFrames; ++i)
      max_diff = std::max(max_diff, std::fabs(ref_l[static_cast<size_t>(i)] - out_l[static_cast<size_t>(i)]));
    if (max_diff > 1e-6f) std::printf("  block %d differs from 128 by %g\n", block, max_diff);
    OPENAXE_EXPECT(max_diff <= 1e-6f);
  }
}

// The defect: one pre-delay line was shared by both channels and written twice
// per block, so the right channel's tank was fed the left channel's audio.
void TestChannelsDoNotLeakThroughPredelay() {
  constexpr int kFrames = 48000;
  const auto tone = Tone(kFrames, 300.0f, 0.5f);
  const std::vector<float> silence(static_cast<size_t>(kFrames), 0.0f);
  for (int block : {128, 512}) {
    SpringReverb r;
    ConfigureWet(r, 0.5f, 20.0f, 0.0f, 0.0f, 100.0f);
    std::vector<float> out_l, out_r;
    RenderBlocks(r, tone, silence, out_l, out_r, block);
    // Right input was silent, so the right output must be silent too.
    OPENAXE_EXPECT(Peak(out_r) < 1e-6f);
    OPENAXE_EXPECT(Peak(out_l) > 1e-3f);
  }
}

// The defect: both channels applied identical spring weights, so a mono source
// produced bit-identical L and R and `width` did nothing.
void TestWidthProducesAStereoImage() {
  constexpr int kFrames = 48000;
  const auto in = Impulse(kFrames);
  SpringReverb r;
  ConfigureWet(r, 2.0f, 0.0f, 0.0f, 0.0f, 150.0f);
  std::vector<float> out_l, out_r;
  RenderBlocks(r, in, in, out_l, out_r, 128);
  float max_diff = 0.0f;
  for (int i = 0; i < kFrames; ++i)
    max_diff = std::max(max_diff, std::fabs(out_l[static_cast<size_t>(i)] - out_r[static_cast<size_t>(i)]));
  OPENAXE_EXPECT(max_diff > 1e-3f);
}

// The defect: the loop gain was computed for a round trip of 2*t while the
// delay line was only t long, so every decay came out roughly half as long as
// asked for.
void TestDecayTracksTheRequestedRt60() {
  for (float decay : {1.0f, 2.0f, 4.0f}) {
    SpringReverb r;
    ConfigureWet(r, decay, 0.0f, 0.0f, 0.0f, 100.0f);
    const int frames = static_cast<int>(kSampleRate * (decay * 2.0f + 1.0f));
    const auto in = Impulse(frames);
    std::vector<float> out_l, out_r;
    RenderBlocks(r, in, in, out_l, out_r, 128);
    const float measured = MeasureRt60(out_l);
    const float ratio = measured / decay;
    if (ratio < 0.6f || ratio > 1.25f)
      std::printf("  decay %.1f s -> measured %.3f s (ratio %.2f)\n", decay, measured, ratio);
    // In-loop damping legitimately shortens the broadband tail, so this is a
    // band rather than an equality - but 0.45x was a bug, not damping.
    OPENAXE_EXPECT(ratio > 0.6f && ratio < 1.25f);
  }
}

// The defect: the damping one-pole sat on the output tap instead of inside the
// feedback loop, so high_cut coloured the output but never shortened the tail.
void TestDampingIsInsideTheFeedbackLoop() {
  const auto rt60_at = [](float high_cut) {
    SpringReverb r;
    ConfigureWet(r, 3.0f, 0.0f, 0.0f, 0.0f, 100.0f);
    r.SetParam(kHighCut, high_cut);
    const int frames = static_cast<int>(kSampleRate * 5.0f);
    const auto in = Impulse(frames);
    std::vector<float> out_l, out_r;
    RenderBlocks(r, in, in, out_l, out_r, 128);
    return MeasureRt60(out_l);
  };
  const float dark = rt60_at(1000.0f);
  const float bright = rt60_at(16000.0f);
  if (!(bright > dark * 1.15f)) std::printf("  dark %.3f s vs bright %.3f s\n", dark, bright);
  OPENAXE_EXPECT(bright > dark * 1.15f);
}

// The defect: four springs summed with no normalisation and `width` up to
// 150% on top, so a fully-wet tank ran +3.6 to +5.1 dB hot, and the hotter it
// got the longer the decay.
void TestOutputStaysBelowUnityGain() {
  for (float decay : {1.0f, 3.0f, 6.0f, 10.0f}) {
    SpringReverb r;
    ConfigureWet(r, decay, 0.0f, 0.0f, 0.0f, 150.0f);
    r.SetParam(kDrive, 1.0f);
    constexpr int kFrames = 48000 * 3;
    const auto in = Tone(kFrames, 220.0f, 0.5f);
    std::vector<float> out_l, out_r;
    RenderBlocks(r, in, in, out_l, out_r, 128);
    const float peak = Peak(out_l, kFrames / 2);
    if (peak > 0.5f) std::printf("  decay %.1f s -> peak %.3f for a 0.5 input\n", decay, peak);
    // Fully wet, a sustained 0.5 input must not come back louder than it went in.
    OPENAXE_EXPECT(peak <= 0.5f * 1.05f);
  }
}

void TestMuteSilences() {
  SpringReverb r;
  ConfigureWet(r, 2.0f, 10.0f, 1.0f, 10.0f, 100.0f);
  constexpr int kFrames = 4096;
  const auto in = Impulse(kFrames);
  std::vector<float> out_l, out_r;
  RenderBlocks(r, in, in, out_l, out_r, 128);
  r.Mute();
  const std::vector<float> silence(static_cast<size_t>(kFrames), 0.0f);
  RenderBlocks(r, silence, silence, out_l, out_r, 128);
  OPENAXE_EXPECT(Peak(out_l) < 1e-6f);
  OPENAXE_EXPECT(Peak(out_r) < 1e-6f);
}

// dry_level is the algorithm's own blend (reverb is excluded from the engine
// mix), so 100% must be exactly the input back.
void TestDryLevelPassesInputThrough() {
  SpringReverb r;
  ConfigureWet(r, 2.0f, 20.0f, 1.0f, 10.0f, 100.0f);
  r.SetParam(kDryLevel, 100.0f);
  constexpr int kFrames = 8192;
  const auto in = Tone(kFrames, 440.0f, 0.5f);
  std::vector<float> out_l, out_r;
  RenderBlocks(r, in, in, out_l, out_r, 128);
  float max_diff = 0.0f;
  for (int i = 0; i < kFrames; ++i)
    max_diff = std::max(max_diff, std::fabs(out_l[static_cast<size_t>(i)] - in[static_cast<size_t>(i)]));
  OPENAXE_EXPECT(max_diff < 1e-6f);
}

}  // namespace

int main() {
  TestParamCountAndInfo();
  TestGetSetEveryParam();
  TestImpulseProducesFiniteDecayingTail();
  TestOutputIsIndependentOfBlockSize();
  TestChannelsDoNotLeakThroughPredelay();
  TestWidthProducesAStereoImage();
  TestDecayTracksTheRequestedRt60();
  TestDampingIsInsideTheFeedbackLoop();
  TestOutputStaysBelowUnityGain();
  TestMuteSilences();
  TestDryLevelPassesInputThrough();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}
