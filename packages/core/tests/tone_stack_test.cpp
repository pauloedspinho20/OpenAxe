// The 4-band tone stack every NAM-backed block runs after its model
// (dsp/tone_stack.cpp). These assert what a tone control has to do - move energy
// at its own frequency and leave the others roughly alone - by measuring the
// stack's response to sine waves rather than by inspecting coefficients.
#include "openaxe/dsp/tone_stack.h"

#include <cmath>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::ToneStack;

namespace {

constexpr double kSampleRate = 48000.0;
constexpr int kFrames = 8192;

/** RMS of a sine at `freq` after the stack, relative to its RMS before it. */
double GainAt(ToneStack& tone, double freq) {
  std::vector<float> buffer(kFrames);
  for (int i = 0; i < kFrames; ++i) {
    buffer[static_cast<size_t>(i)] =
        static_cast<float>(std::sin(6.283185307179586 * freq * i / kSampleRate));
  }
  tone.Reset(kSampleRate);  // clear history so each measurement is independent
  tone.Process(buffer.data(), kFrames);

  // Skip the first 1000 samples: the filters' transient response isn't the
  // steady-state gain being measured here.
  double sum = 0.0;
  int count = 0;
  for (int i = 1000; i < kFrames; ++i) {
    sum += static_cast<double>(buffer[static_cast<size_t>(i)]) * buffer[static_cast<size_t>(i)];
    ++count;
  }
  const double rms = std::sqrt(sum / count);
  return rms / 0.70710678;  // a unit sine's own RMS
}

double ToDb(double gain) { return 20.0 * std::log10(gain); }

// Flat means bit-exact passthrough, not just "close" - Process() returns early
// while every band sits at 0dB, which is the common case (no EQ dialled in).
void TestFlatIsBitExact() {
  ToneStack tone;
  tone.Reset(kSampleRate);

  std::vector<float> buffer(64);
  for (int i = 0; i < 64; ++i) buffer[static_cast<size_t>(i)] = 0.1f * static_cast<float>(i);
  const std::vector<float> original = buffer;
  tone.Process(buffer.data(), 64);
  for (size_t i = 0; i < buffer.size(); ++i) OPENAXE_EXPECT(buffer[i] == original[i]);

  // ...and it stays exact after a band is moved and returned to 0.
  tone.SetGainDb(ToneStack::Band::kBass, 6.0f);
  tone.SetGainDb(ToneStack::Band::kBass, 0.0f);
  buffer = original;
  tone.Process(buffer.data(), 64);
  for (size_t i = 0; i < buffer.size(); ++i) OPENAXE_EXPECT(buffer[i] == original[i]);
}

// Each band boosts around its own centre frequency. Tolerances are wide on
// purpose: this is asserting "the Bass knob raises the bass", not exact
// cookbook coefficients.
void TestEachBandBoostsItsOwnRegion() {
  {
    ToneStack tone;
    tone.SetGainDb(ToneStack::Band::kBass, 12.0f);
    OPENAXE_EXPECT(ToDb(GainAt(tone, 50.0)) > 9.0);      // well inside the shelf
    OPENAXE_EXPECT(ToDb(GainAt(tone, 4000.0)) < 1.0);    // far above it: untouched
  }
  {
    ToneStack tone;
    tone.SetGainDb(ToneStack::Band::kMid, 12.0f);
    OPENAXE_EXPECT(ToDb(GainAt(tone, 1000.0)) > 9.0);    // at the bell's centre
    OPENAXE_EXPECT(ToDb(GainAt(tone, 50.0)) < 3.0);
  }
  {
    ToneStack tone;
    tone.SetGainDb(ToneStack::Band::kTreble, 12.0f);
    OPENAXE_EXPECT(ToDb(GainAt(tone, 12000.0)) > 9.0);
    OPENAXE_EXPECT(ToDb(GainAt(tone, 100.0)) < 1.0);
  }
  {
    ToneStack tone;
    tone.SetGainDb(ToneStack::Band::kPresence, 12.0f);
    OPENAXE_EXPECT(ToDb(GainAt(tone, 8000.0)) > 8.0);
    OPENAXE_EXPECT(ToDb(GainAt(tone, 200.0)) < 1.0);
  }
}

// Cuts have to work as well as boosts (a tone control that only adds is a gain
// knob), and the four bands compose.
void TestCutsAttenuateAndBandsCompose() {
  ToneStack tone;
  tone.SetGainDb(ToneStack::Band::kBass, -12.0f);
  OPENAXE_EXPECT(ToDb(GainAt(tone, 50.0)) < -9.0);

  tone.SetGainDb(ToneStack::Band::kMid, 12.0f);
  // The bass cut and the mid boost coexist rather than replacing each other.
  OPENAXE_EXPECT(ToDb(GainAt(tone, 50.0)) < -8.0);
  OPENAXE_EXPECT(ToDb(GainAt(tone, 1000.0)) > 8.0);
}

// Gains are clamped to the ±12dB the UI offers, and read back clamped.
void TestGainsAreClampedAndReadBack() {
  ToneStack tone;
  tone.SetGainDb(ToneStack::Band::kTreble, 100.0f);
  OPENAXE_EXPECT(tone.GetGainDb(ToneStack::Band::kTreble) == 12.0f);
  tone.SetGainDb(ToneStack::Band::kTreble, -100.0f);
  OPENAXE_EXPECT(tone.GetGainDb(ToneStack::Band::kTreble) == -12.0f);
  OPENAXE_EXPECT(tone.GetGainDb(ToneStack::Band::kBass) == 0.0f);
}

// The response has to hold at other sample rates - the coefficients depend on
// it, and a 96kHz session must not sound like a differently-tuned amp.
void TestResponseHoldsAt96k() {
  ToneStack tone;
  tone.SetGainDb(ToneStack::Band::kMid, 12.0f);

  std::vector<float> buffer(kFrames);
  for (int i = 0; i < kFrames; ++i) {
    buffer[static_cast<size_t>(i)] =
        static_cast<float>(std::sin(6.283185307179586 * 1000.0 * i / 96000.0));
  }
  tone.Reset(96000.0);
  tone.Process(buffer.data(), kFrames);

  double sum = 0.0;
  int count = 0;
  for (int i = 2000; i < kFrames; ++i) {
    sum += static_cast<double>(buffer[static_cast<size_t>(i)]) * buffer[static_cast<size_t>(i)];
    ++count;
  }
  const double gain_db = ToDb(std::sqrt(sum / count) / 0.70710678);
  OPENAXE_EXPECT(gain_db > 9.0);
}

// A stack processing silence must stay silent, and nothing may produce NaN/Inf.
void TestSilenceAndFiniteness() {
  ToneStack tone;
  tone.Reset(kSampleRate);
  tone.SetGainDb(ToneStack::Band::kBass, 12.0f);
  tone.SetGainDb(ToneStack::Band::kPresence, -12.0f);

  std::vector<float> buffer(256, 0.0f);
  tone.Process(buffer.data(), 256);
  for (float sample : buffer) OPENAXE_EXPECT(sample == 0.0f);

  std::vector<float> loud(256, 1.0f);
  tone.Process(loud.data(), 256);
  for (float sample : loud) OPENAXE_EXPECT(std::isfinite(sample));

  tone.Process(nullptr, 256);  // must not crash
  tone.Process(buffer.data(), 0);
}

}  // namespace

int main() {
  TestFlatIsBitExact();
  TestEachBandBoostsItsOwnRegion();
  TestCutsAttenuateAndBandsCompose();
  TestGainsAreClampedAndReadBack();
  TestResponseHoldsAt96k();
  TestSilenceAndFiniteness();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}
