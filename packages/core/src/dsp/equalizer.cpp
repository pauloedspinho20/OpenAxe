#include "openaxe/dsp/equalizer.h"

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
constexpr int kParamCount = kBandParamCount + 2;
constexpr float kCutQ = 0.707f;

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
  static void Configure(EqualizerProc& proc) { proc.setNumBands(kBandCount); }

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
  double sample_rate = 48000.0;

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
  impl_->RefreshCuts();
}

// Four biquad bands in series (low shelf, two sweepable peaks, high shelf)
// followed by the global cuts. Real-time safe.
void Equalizer::Process(const float* const* input, float* const* output, int num_frames) {
  impl_->dsp.Process(input, output, num_frames);
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
// on - followed by low_cut (HPF Hz) and high_cut (LPF Hz).
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
}

}  // namespace openaxe::dsp