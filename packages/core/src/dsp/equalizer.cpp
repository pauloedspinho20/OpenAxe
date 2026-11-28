#include "openaxe/dsp/equalizer.h"

#include <algorithm>
#include <cmath>

#include "Effects/Equalizer.h"
#include "internal/biquad.h"
#include "internal/dspark_wrapper.h"

namespace openaxe::dsp {

namespace {

constexpr int kBandCount = 4;
constexpr int kFieldsPerBand = 3;  // frequency, gain, q
constexpr int kBandParamCount = kBandCount * kFieldsPerBand;
// Global low-cut (HPF) + high-cut (LPF) in series after the 4 bands (issue
// #373). Freq-only, fixed Butterworth Q - indices 12/13, after the band table.
constexpr int kLowCutParam = kBandParamCount;
constexpr int kHighCutParam = kBandParamCount + 1;
// Graphic mode (issue: Graphic EQ in the eq block): `mode` (0 parametric,
// 1 graphic) and ten fixed-frequency octave gains.
// Appended after the cuts so every existing parametric index is unchanged.
constexpr int kModeParam = kBandParamCount + 2;
constexpr int kGraphicBandCount = 10;
constexpr int kGraphicFirstParam = kModeParam + 1;
constexpr int kParamCount = kGraphicFirstParam + kGraphicBandCount;
constexpr float kCutQ = 0.707f;
// ISO octave centres. Constant-Q peaks (Q = sqrt(2)) so adjacent octaves
// overlap by a half-power point and a flat slider set sums to exactly 0 dB.
constexpr float kGraphicFreq[kGraphicBandCount] = {31.25f,  62.5f,   125.0f,  250.0f, 500.0f,
                                                    1000.0f, 2000.0f, 4000.0f, 8000.0f, 16000.0f};
constexpr float kGraphicQ = 1.41421356f;

// Guitar/bass-oriented band types, mirroring ParametricEQ.ts's DEFAULT_BANDS:
// low-shelf, two sweepable mid peaks, high-shelf.
const dspark::Equalizer<float, kBandCount>::BandType kBandType[kBandCount] = {
    dspark::Equalizer<float, kBandCount>::BandType::LowShelf,
    dspark::Equalizer<float, kBandCount>::BandType::Peak,
    dspark::Equalizer<float, kBandCount>::BandType::Peak,
    dspark::Equalizer<float, kBandCount>::BandType::HighShelf,
};

// Generated from packages/core/param_schema.json (issue #51) - run
// scripts/gen-param-schema.mjs after editing the schema.
const DsparkParamInfo kParamInfo[kParamCount] = {
#include "generated/equalizer_params.inc"
};

// Same frequencies as ParametricEQ.ts's DEFAULT_BANDS, plus the transparent
// cut defaults (schema range extremes - keep in sync with param_schema.json's
// eq low_cut min / high_cut max; the stages are skipped outright there).
constexpr float kDefaults[kParamCount] = {
    100.0f, 0.0f, 0.707f,  // band 0: low-shelf
    500.0f, 0.0f, 0.707f,  // band 1: mid peak
    2000.0f, 0.0f, 0.707f,  // band 2: mid peak
    6000.0f, 0.0f, 0.707f,  // band 3: high-shelf
    20.0f,                 // low_cut: HPF frequency, off at range min
    20000.0f,              // high_cut: LPF frequency, off at range max
    0.0f,                  // mode: parametric
    0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f,  // graphic gains, flat
};

using EqualizerProc = dspark::Equalizer<float, kBandCount>;

}  // namespace

// The policy DsparkEffect<> needs. The EQ is the reason Traits::Apply gets the
// whole param mirror rather than just the changed value: DSPark configures a
// band as one struct (frequency + gain + Q + type), so a single knob turn has
// to be re-expanded into its two siblings' current values.
struct EqualizerTraits {
  static constexpr int kParamCount = openaxe::dsp::kParamCount;
  static constexpr const DsparkParamInfo* kInfo = openaxe::dsp::kParamInfo;
  static constexpr const float* kDefaults = openaxe::dsp::kDefaults;

  // One-time setup, run before the defaults are seeded (setNumBands resets
  // every band, so it must not run after them).
  //
  // setMatchedBells(false): DSPark 1.8 made analog-matched Peak bells the
  // default. They are more faithful near Nyquist (2.9 dB worst deviation from
  // the analog bell at 48 kHz vs 11 dB bilinear), but they change the sound of
  // every saved rig with a high mid bell - about +1 dB at 16 kHz in the
  // eq/bells golden. Pinned to the bilinear bells this EQ has always had;
  // adopting the matched design is a deliberate, re-blessed change of its own.
  static void Configure(EqualizerProc& proc) {
    proc.setNumBands(kBandCount);
    proc.setMatchedBells(false);
  }

  static void Apply(EqualizerProc& proc, const float* values, int index, float value) {
    (void)value;
    // The cuts live outside the dspark processor (see Equalizer::Impl) - the
    // wrapper still mirrors them, but there is no band to re-derive here.
    if (index >= kBandParamCount) return;
    const int band = index / kFieldsPerBand;
    const int base = band * kFieldsPerBand;
    EqualizerProc::BandConfig cfg;
    cfg.frequency = values[base + 0];
    cfg.gain = values[base + 1];
    cfg.q = values[base + 2];
    cfg.type = kBandType[band];
    cfg.enabled = true;
    // setBand re-derives the whole band from the three sibling mirror values
    // (`values`), so turning one knob never loses the other two's settings.
    proc.setBand(band, cfg);
  }
};

// Pimpl so the vendored dspark:: types stay out of the public header. The
// cuts are one HPF + one LPF biquad per channel in series after the dspark
// bands (issue #373) - fixed Butterworth Q, freq-only params.
struct Equalizer::Impl {
  DsparkEffect<EqualizerProc, EqualizerTraits> dsp;
  internal::Biquad hp[2];
  internal::Biquad lp[2];
  // Graphic mode: ten peaking biquads per channel, series. Bands at exactly
  // 0 dB are skipped, so a flat graphic EQ is bit-identical to a bypass.
  internal::Biquad graphic[2][kGraphicBandCount];
  double sample_rate = 48000.0;

  // RBJ peaking filter at a fixed frequency/Q, gain in dB.
  void RefreshGraphicBand(int band) {
    const float sr = static_cast<float>(sample_rate);
    const float gain_db = dsp.GetParam(kGraphicFirstParam + band);
    const float f = kGraphicFreq[band];
    for (int ch = 0; ch < 2; ++ch) {
      internal::Biquad& b = graphic[ch][band];
      if (gain_db == 0.0f || f >= sr * 0.45f) {
        b.b0 = 1.0f;
        b.b1 = b.b2 = b.a1 = b.a2 = 0.0f;
        continue;
      }
      const float a = std::pow(10.0f, gain_db / 40.0f);
      const float w0 = 6.28318530718f * f / sr;
      const float alpha = std::sin(w0) / (2.0f * kGraphicQ);
      const float cosw = std::cos(w0);
      const float a0 = 1.0f + alpha / a;
      b.b0 = (1.0f + alpha * a) / a0;
      b.b1 = (-2.0f * cosw) / a0;
      b.b2 = (1.0f - alpha * a) / a0;
      b.a1 = b.b1;
      b.a2 = (1.0f - alpha / a) / a0;
    }
  }
  void RefreshAllGraphic() {
    for (int band = 0; band < kGraphicBandCount; ++band) RefreshGraphicBand(band);
  }
  bool GraphicActive(int band) const { return dsp.GetParam(kGraphicFirstParam + band) != 0.0f; }

  void RefreshCuts() {
    const float sr = static_cast<float>(sample_rate);
    const float low = dsp.GetParam(kLowCutParam);
    const float high = dsp.GetParam(kHighCutParam);
    for (int ch = 0; ch < 2; ++ch) {
      hp[static_cast<size_t>(ch)].SetHighpass(low, kCutQ, sr);
      lp[static_cast<size_t>(ch)].SetLowpass(high, kCutQ, sr);
    }
  }
};

Equalizer::Equalizer() : impl_(std::make_unique<Impl>()) {}
Equalizer::~Equalizer() = default;

// Re-prepare for a new sample rate - every biquad's coefficients depend on it -
// and re-seed all 14 params. Allocates; not real-time safe.
void Equalizer::Reset(double sample_rate) {
  impl_->sample_rate = sample_rate;
  impl_->dsp.Reset(sample_rate);
  for (auto& hp : impl_->hp) hp.Reset();
  for (auto& lp : impl_->lp) lp.Reset();
  for (auto& ch : impl_->graphic)
    for (auto& band : ch) band.Reset();
  impl_->RefreshCuts();
  impl_->RefreshAllGraphic();
}

// Four biquad bands in series (low shelf, two sweepable peaks, high shelf)
// followed by the global cuts. Real-time safe.
void Equalizer::Process(const float* const* input, float* const* output, int num_frames) {
  if (impl_->dsp.GetParam(kModeParam) >= 0.5f) {
    // Graphic mode: the four parametric bands are out of the path entirely.
    if (num_frames <= 0) return;
    for (int ch = 0; ch < 2; ++ch) {
      float* out = output[ch];
      if (out != input[ch]) std::copy(input[ch], input[ch] + num_frames, out);
      for (int band = 0; band < kGraphicBandCount; ++band) {
        if (!impl_->GraphicActive(band)) continue;
        internal::Biquad& f = impl_->graphic[static_cast<size_t>(ch)][static_cast<size_t>(band)];
        for (int i = 0; i < num_frames; ++i) out[i] = f.Process(out[i]);
      }
    }
  } else {
    impl_->dsp.Process(input, output, num_frames);
  }
  // Skipped outright at the defaults (not run as "almost transparent"
  // biquads), which is what keeps default presets bit-identical.
  const float low = impl_->dsp.GetParam(kLowCutParam);
  const float high = impl_->dsp.GetParam(kHighCutParam);
  const bool hp_active = low > kDefaults[kLowCutParam];
  const bool lp_active = high < kDefaults[kHighCutParam];
  if ((!hp_active && !lp_active) || num_frames <= 0) return;
  for (int ch = 0; ch < 2; ++ch) {
    float* out = output[ch];
    for (int i = 0; i < num_frames; ++i) {
      if (hp_active) out[i] = impl_->hp[static_cast<size_t>(ch)].Process(out[i]);
      if (lp_active) out[i] = impl_->lp[static_cast<size_t>(ch)].Process(out[i]);
    }
  }
}

// Param surface: 4 bands x (frequency Hz, gain dB, Q), in band order - so
// index / 3 is the band and index % 3 the field, which is what Apply relies
// on - followed by low_cut (HPF Hz) and high_cut (LPF Hz), then the graphic
// mode: mode, graphic0_gain..graphic9_gain.
int Equalizer::ParamCount() { return DsparkEffect<EqualizerProc, EqualizerTraits>::ParamCount(); }

// Name/symbol/range/unit for one param index (band0_frequency, band0_gain,
// band0_q, band1_frequency, ...).
const Equalizer::ParamInfo& Equalizer::GetParamInfo(int index) {
  return DsparkEffect<EqualizerProc, EqualizerTraits>::GetParamInfo(index);
}

// Current value of one param, from DsparkEffect's mirror.
float Equalizer::GetParam(int index) const { return impl_->dsp.GetParam(index); }

// Store one param and re-derive its whole band. Real-time safe: recomputing
// biquad coefficients is arithmetic, no allocation. Cut params re-derive the
// series HPF/LPF instead (Traits::Apply ignores them for the dspark bands).
void Equalizer::SetParam(int index, float value) {
  impl_->dsp.SetParam(index, value);
  if (index == kLowCutParam || index == kHighCutParam) impl_->RefreshCuts();
  if (index >= kGraphicFirstParam && index < kParamCount) {
    impl_->RefreshGraphicBand(index - kGraphicFirstParam);
  }
}

}  // namespace openaxe::dsp