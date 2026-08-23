#include "openaxe/dsp/tone_stack.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace openaxe::dsp {

namespace {

// ±12dB, matching the range the web UI's Bass/Mid/Treble/Presence knobs offer.
constexpr float kGainLimitDb = 12.0f;

// One biquad per band, in Direct Form I. Coefficients are the RBJ cookbook
// low-shelf / peaking / high-shelf forms - the same ones Web Audio's
// BiquadFilterNode implements, which is what makes this stack sound like the
// Web Audio chain it replaces.
struct Biquad {
  float b0 = 1.0f, b1 = 0.0f, b2 = 0.0f;
  float a1 = 0.0f, a2 = 0.0f;
  float x1 = 0.0f, x2 = 0.0f, y1 = 0.0f, y2 = 0.0f;

  void Reset() { x1 = x2 = y1 = y2 = 0.0f; }

  // Flat: pass the signal through untouched (a band at 0dB).
  void SetBypass() {
    b0 = 1.0f;
    b1 = b2 = a1 = a2 = 0.0f;
  }

  // Peaking EQ: a bell of `db` at `freq`, width set by q.
  void SetPeaking(float freq, float q, float db, float sample_rate) {
    const float a = std::pow(10.0f, db / 40.0f);  // sqrt of the linear gain
    const float w0 = 6.28318530718f * freq / sample_rate;
    const float cos_w0 = std::cos(w0);
    const float alpha = std::sin(w0) / (2.0f * q);
    const float a0_inv = 1.0f / (1.0f + alpha / a);
    b0 = (1.0f + alpha * a) * a0_inv;
    b1 = (-2.0f * cos_w0) * a0_inv;
    b2 = (1.0f - alpha * a) * a0_inv;
    a1 = b1;  // identical numerator/denominator middle term for this form
    a2 = (1.0f - alpha / a) * a0_inv;
  }

  // Low/high shelf: `db` applied below (kLow) or above (kHigh) `freq`. S = 1,
  // matching Web Audio's fixed shelf slope.
  enum class Shelf { kLow, kHigh };
  void SetShelf(Shelf shelf, float freq, float db, float sample_rate) {
    const float a = std::pow(10.0f, db / 40.0f);
    const float w0 = 6.28318530718f * freq / sample_rate;
    const float cos_w0 = std::cos(w0);
    // alpha for S = 1 reduces to sin(w0)/2 * sqrt((A + 1/A) * (1/S - 1) + 2),
    // i.e. sin(w0)/2 * sqrt(2) at S = 1.
    const float alpha = std::sin(w0) * 0.5f * 1.41421356237f;
    const float two_sqrt_a_alpha = 2.0f * std::sqrt(a) * alpha;
    if (shelf == Shelf::kLow) {
      const float a0 = (a + 1.0f) + (a - 1.0f) * cos_w0 + two_sqrt_a_alpha;
      const float a0_inv = 1.0f / a0;
      b0 = a * ((a + 1.0f) - (a - 1.0f) * cos_w0 + two_sqrt_a_alpha) * a0_inv;
      b1 = 2.0f * a * ((a - 1.0f) - (a + 1.0f) * cos_w0) * a0_inv;
      b2 = a * ((a + 1.0f) - (a - 1.0f) * cos_w0 - two_sqrt_a_alpha) * a0_inv;
      a1 = -2.0f * ((a - 1.0f) + (a + 1.0f) * cos_w0) * a0_inv;
      a2 = ((a + 1.0f) + (a - 1.0f) * cos_w0 - two_sqrt_a_alpha) * a0_inv;
    } else {
      const float a0 = (a + 1.0f) - (a - 1.0f) * cos_w0 + two_sqrt_a_alpha;
      const float a0_inv = 1.0f / a0;
      b0 = a * ((a + 1.0f) + (a - 1.0f) * cos_w0 + two_sqrt_a_alpha) * a0_inv;
      b1 = -2.0f * a * ((a - 1.0f) + (a + 1.0f) * cos_w0) * a0_inv;
      b2 = a * ((a + 1.0f) + (a - 1.0f) * cos_w0 - two_sqrt_a_alpha) * a0_inv;
      a1 = 2.0f * ((a - 1.0f) - (a + 1.0f) * cos_w0) * a0_inv;
      a2 = ((a + 1.0f) - (a - 1.0f) * cos_w0 - two_sqrt_a_alpha) * a0_inv;
    }
  }

  // One sample through the section, updating its two-sample history.
  float Process(float x) {
    const float y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  }
};

// Band centres/slopes, matching the Web Audio chain this replaces.
struct BandSpec {
  float frequency;
  float q;  // only used by the peaking bands
  enum class Kind { kLowShelf, kPeaking, kHighShelf } kind;
};

constexpr std::array<BandSpec, 4> kBands = {{
    {100.0f, 0.0f, BandSpec::Kind::kLowShelf},   // Bass
    {1000.0f, 0.7f, BandSpec::Kind::kPeaking},   // Mid
    {5000.0f, 0.0f, BandSpec::Kind::kHighShelf}, // Treble
    {8000.0f, 0.5f, BandSpec::Kind::kPeaking},   // Presence
}};

}  // namespace

struct ToneStack::Impl {
  std::array<Biquad, 4> bands;
  std::array<float, 4> gains_db{};  // all zero = flat
  float sample_rate = 48000.0f;
  // True while every band is flat, so Process can skip the whole chain and stay
  // bit-exact - the common case, since most captures are played without EQ.
  bool flat = true;

  // Recompute one band's coefficients from its current gain.
  void UpdateBand(size_t index) {
    Biquad& biquad = bands[index];
    const float db = gains_db[index];
    if (db == 0.0f) {
      biquad.SetBypass();
    } else {
      const BandSpec& spec = kBands[index];
      switch (spec.kind) {
        case BandSpec::Kind::kLowShelf:
          biquad.SetShelf(Biquad::Shelf::kLow, spec.frequency, db, sample_rate);
          break;
        case BandSpec::Kind::kPeaking:
          biquad.SetPeaking(spec.frequency, spec.q, db, sample_rate);
          break;
        case BandSpec::Kind::kHighShelf:
          biquad.SetShelf(Biquad::Shelf::kHigh, spec.frequency, db, sample_rate);
          break;
      }
    }
    flat = std::all_of(gains_db.begin(), gains_db.end(), [](float g) { return g == 0.0f; });
  }
};

// Starts flat at 48kHz; Reset() adopts the real rate.
ToneStack::ToneStack() : impl_(std::make_unique<Impl>()) {}

ToneStack::~ToneStack() = default;

// Adopt a sample rate and rebuild every band, clearing filter history so a rate
// change can't ring the old coefficients' state into the new ones.
void ToneStack::Reset(double sample_rate) {
  impl_->sample_rate = static_cast<float>(sample_rate);
  for (size_t i = 0; i < impl_->bands.size(); ++i) {
    impl_->bands[i].Reset();
    impl_->UpdateBand(i);
  }
}

// Set one band's gain in dB (clamped to ±12) and recompute just that band.
// Real-time safe.
void ToneStack::SetGainDb(Band band, float db) {
  const size_t index = static_cast<size_t>(band);
  const float clamped = std::clamp(db, -kGainLimitDb, kGainLimitDb);
  if (impl_->gains_db[index] == clamped) return;
  impl_->gains_db[index] = clamped;
  impl_->UpdateBand(index);
}

// Current gain of one band in dB.
float ToneStack::GetGainDb(Band band) const {
  return impl_->gains_db[static_cast<size_t>(band)];
}

// Run the four bands in series over a mono buffer, in place. Returns
// immediately while every band is flat, so an un-EQ'd amp costs nothing and
// stays bit-exact.
void ToneStack::Process(float* samples, int num_frames) {
  if (impl_->flat || !samples) return;
  for (int i = 0; i < num_frames; ++i) {
    float x = samples[i];
    for (Biquad& band : impl_->bands) x = band.Process(x);
    samples[i] = x;
  }
}

}  // namespace openaxe::dsp
