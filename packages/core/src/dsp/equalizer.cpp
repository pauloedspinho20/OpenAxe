#include "nam_studio/dsp/equalizer.h"

#include "Effects/Equalizer.h"
#include "internal/dspark_wrapper.h"

namespace nam_studio::dsp {

namespace {

constexpr int kBandCount = 4;
constexpr int kFieldsPerBand = 3;  // frequency, gain, q
constexpr int kParamCount = kBandCount * kFieldsPerBand;

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

// Same frequencies as ParametricEQ.ts's DEFAULT_BANDS.
constexpr float kDefaults[kParamCount] = {
    100.0f, 0.0f, 0.707f,  // band 0: low-shelf
    500.0f, 0.0f, 0.707f,  // band 1: mid peak
    2000.0f, 0.0f, 0.707f,  // band 2: mid peak
    6000.0f, 0.0f, 0.707f,  // band 3: high-shelf
};

using EqualizerProc = dspark::Equalizer<float, kBandCount>;

}  // namespace

// The policy DsparkEffect<> needs. The EQ is the reason Traits::Apply gets the
// whole param mirror rather than just the changed value: DSPark configures a
// band as one struct (frequency + gain + Q + type), so a single knob turn has
// to be re-expanded into its two siblings' current values.
struct EqualizerTraits {
  static constexpr int kParamCount = nam_studio::dsp::kParamCount;
  static constexpr const DsparkParamInfo* kInfo = nam_studio::dsp::kParamInfo;
  static constexpr const float* kDefaults = nam_studio::dsp::kDefaults;

  // One-time setup, run before the defaults are seeded (setNumBands resets
  // every band, so it must not run after them).
  static void Configure(EqualizerProc& proc) { proc.setNumBands(kBandCount); }

  static void Apply(EqualizerProc& proc, const float* values, int index, float value) {
    (void)value;
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

// Pimpl so the vendored dspark:: types stay out of the public header.
struct Equalizer::Impl {
  DsparkEffect<EqualizerProc, EqualizerTraits> dsp;
};

Equalizer::Equalizer() : impl_(std::make_unique<Impl>()) {}
Equalizer::~Equalizer() = default;

// Re-prepare for a new sample rate - every biquad's coefficients depend on it -
// and re-seed all 12 params. Allocates; not real-time safe.
void Equalizer::Reset(double sample_rate) { impl_->dsp.Reset(sample_rate); }

// Four biquad bands in series: low shelf, two sweepable peaks, high shelf.
// Real-time safe.
void Equalizer::Process(const float* const* input, float* const* output, int num_frames) {
  impl_->dsp.Process(input, output, num_frames);
}

// Param surface: 4 bands x (frequency Hz, gain dB, Q), in band order - so
// index / 3 is the band and index % 3 the field, which is what Apply relies on.
int Equalizer::ParamCount() { return DsparkEffect<EqualizerProc, EqualizerTraits>::ParamCount(); }

// Name/symbol/range/unit for one param index (band0_frequency, band0_gain,
// band0_q, band1_frequency, ...).
const Equalizer::ParamInfo& Equalizer::GetParamInfo(int index) {
  return DsparkEffect<EqualizerProc, EqualizerTraits>::GetParamInfo(index);
}

// Current value of one param, from DsparkEffect's mirror.
float Equalizer::GetParam(int index) const { return impl_->dsp.GetParam(index); }

// Store one param and re-derive its whole band. Real-time safe: recomputing
// biquad coefficients is arithmetic, no allocation.
void Equalizer::SetParam(int index, float value) { impl_->dsp.SetParam(index, value); }

}  // namespace nam_studio::dsp