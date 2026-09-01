// Tuner pitch detection — port of apps/web/src/tuner/pitchDetect.test.ts
// (issue #123). Proves the C++ in dsp/pitch_detect.cpp is equivalent to the
// TS it replaces before that TS is deleted, and exercises the guitar/bass
// range the issue requires (synthesized sine sweeps + silence/noise).
#include "openaxe/api.h"
#include "openaxe/dsp/note_utils.h"
#include "openaxe/dsp/pitch_detect.h"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::DetectPitch;
using openaxe::dsp::FrequencyToNote;

namespace {

constexpr double kSampleRate = 48000.0;

std::vector<float> SineBuffer(double frequency, int size, double sample_rate = kSampleRate) {
  std::vector<float> buf(static_cast<size_t>(size));
  for (int i = 0; i < size; ++i) {
    buf[static_cast<size_t>(i)] =
        static_cast<float>(std::sin(2.0 * 3.141592653589793 * frequency * i / sample_rate));
  }
  return buf;
}

void TestDetectsE2Within1Pct() {
  auto buf = SineBuffer(82.4, 4096);
  auto result = DetectPitch(buf.data(), static_cast<int32_t>(buf.size()), kSampleRate);
  OPENAXE_EXPECT(result.has_value());
  if (!result) return;
  OPENAXE_EXPECT(std::fabs(result->frequency - 82.4f) / 82.4f < 0.01f);
}

void TestDetectsLowBWithin2Pct() {
  auto buf = SineBuffer(30.9, 8192);
  auto result = DetectPitch(buf.data(), static_cast<int32_t>(buf.size()), kSampleRate);
  OPENAXE_EXPECT(result.has_value());
  if (!result) return;
  OPENAXE_EXPECT(std::fabs(result->frequency - 30.9f) / 30.9f < 0.02f);
}

void TestDetectsA5Within1Pct() {
  auto buf = SineBuffer(880.0, 4096);
  auto result = DetectPitch(buf.data(), static_cast<int32_t>(buf.size()), kSampleRate);
  OPENAXE_EXPECT(result.has_value());
  if (!result) return;
  OPENAXE_EXPECT(std::fabs(result->frequency - 880.0f) / 880.0f < 0.01f);
}

void TestHighClarityForCleanSine() {
  auto buf = SineBuffer(220.0, 4096);
  auto result = DetectPitch(buf.data(), static_cast<int32_t>(buf.size()), kSampleRate);
  OPENAXE_EXPECT(result.has_value());
  if (!result) return;
  OPENAXE_EXPECT(result->clarity > 0.9f);
}

void TestReturnsNullForSilence() {
  std::vector<float> buf(4096, 0.0f);
  auto result = DetectPitch(buf.data(), static_cast<int32_t>(buf.size()), kSampleRate);
  OPENAXE_EXPECT(!result.has_value());
  // ABI-level: Hz == 0 for silence.
  OPENAXE_EXPECT(nam_studio_detect_pitch(buf.data(), static_cast<int32_t>(buf.size()), kSampleRate) == 0.0f);
}

void TestReturnsNullForWhiteNoise() {
  // Seeded LCG — not sin(i*k), which would be periodic and detectable.
  uint32_t seed = 42;
  std::vector<float> buf(4096);
  for (size_t i = 0; i < buf.size(); ++i) {
    seed = (seed * 1103515245u + 12345u) & 0x7fffffffu;
    buf[i] = static_cast<float>(seed) / 1073741824.0f - 1.0f;
  }
  auto result = DetectPitch(buf.data(), static_cast<int32_t>(buf.size()), kSampleRate);
  OPENAXE_EXPECT(!result.has_value());
}

// Issue #123 extra: synthesized sweeps across the guitar/bass range.
void TestSweepGuitarBassRange() {
  // E2 (82.41Hz) through E4 (329.63Hz) and A0 (~27.5Hz) through A5 (880Hz)
  const double freqs[] = {27.5, 41.2, 55.0, 82.41, 110.0, 146.83, 196.0, 246.94, 329.63, 440.0, 659.25, 880.0};
  for (double freq : freqs) {
    // Low freq needs longer window — scale size roughly with period.
    int size = freq < 50.0 ? 8192 : 4096;
    auto buf = SineBuffer(freq, size);
    auto result = DetectPitch(buf.data(), static_cast<int32_t>(buf.size()), kSampleRate);
    if (!result) {
      std::fprintf(stderr, "  sweep failed to detect %.2f Hz\n", freq);
      OPENAXE_EXPECT(false);
      continue;
    }
    double err = std::fabs(result->frequency - freq) / freq;
    if (err >= 0.02) {
      std::fprintf(stderr, "  sweep %.2f Hz: got %.2f Hz (%.2f%% error)\n", freq, result->frequency, err * 100);
    }
    OPENAXE_EXPECT(err < 0.02);
  }
}

void TestAbiReturnsHzOrZero() {
  auto buf = SineBuffer(440.0, 4096);
  float hz = nam_studio_detect_pitch(buf.data(), static_cast<int32_t>(buf.size()), kSampleRate);
  OPENAXE_EXPECT(std::fabs(hz - 440.0f) / 440.0f < 0.01f);

  std::vector<float> silence(2048, 0.0f);
  OPENAXE_EXPECT(nam_studio_detect_pitch(silence.data(), static_cast<int32_t>(silence.size()), kSampleRate) == 0.0f);
  OPENAXE_EXPECT(nam_studio_detect_pitch(nullptr, 0, kSampleRate) == 0.0f);
  OPENAXE_EXPECT(nam_studio_detect_pitch(buf.data(), 0, kSampleRate) == 0.0f);
  OPENAXE_EXPECT(nam_studio_detect_pitch(buf.data(), static_cast<int32_t>(buf.size()), 0.0) == 0.0f);
}

void TestAbiFrequencyToNote() {
  const char* name = nullptr;
  int32_t octave = -99;
  int32_t cents = -99;
  OPENAXE_EXPECT(nam_studio_frequency_to_note(440.0f, 440.0, &name, &octave, &cents) == 1);
  OPENAXE_EXPECT(name != nullptr);
  OPENAXE_EXPECT(std::string(name) == "A");
  OPENAXE_EXPECT(octave == 4);
  OPENAXE_EXPECT(cents == 0);

  // E2 ~82.41Hz
  OPENAXE_EXPECT(nam_studio_frequency_to_note(82.41f, 440.0, &name, &octave, &cents) == 1);
  OPENAXE_EXPECT(std::string(name) == "E");
  OPENAXE_EXPECT(octave == 2);

  // 0 Hz is invalid
  OPENAXE_EXPECT(nam_studio_frequency_to_note(0.0f, 440.0, &name, &octave, &cents) == 0);
  OPENAXE_EXPECT(nam_studio_frequency_to_note(-5.0f, 440.0, &name, &octave, &cents) == 0);

  // C++ API parity
  auto note = FrequencyToNote(440.0f, 440.0);
  OPENAXE_EXPECT(std::string(note.name) == "A");
  OPENAXE_EXPECT(note.octave == 4);
  OPENAXE_EXPECT(note.cents == 0);

  // Sharp / flat cents
  double sharp = 440.0 * std::pow(2.0, 20.0 / 1200.0);
  auto s = FrequencyToNote(static_cast<float>(sharp), 440.0);
  OPENAXE_EXPECT(s.cents == 20);
  double flat = 440.0 * std::pow(2.0, -20.0 / 1200.0);
  auto f = FrequencyToNote(static_cast<float>(flat), 440.0);
  OPENAXE_EXPECT(f.cents == -20);
}

}  // namespace

int main() {
  TestDetectsE2Within1Pct();
  TestDetectsLowBWithin2Pct();
  TestDetectsA5Within1Pct();
  TestHighClarityForCleanSine();
  TestReturnsNullForSilence();
  TestReturnsNullForWhiteNoise();
  TestSweepGuitarBassRange();
  TestAbiReturnsHzOrZero();
  TestAbiFrequencyToNote();
  return openaxe::test::g_failures == 0 ? 0 : 1;
}
