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

const DsparkParamInfo kParamInfo[kParamCount] = {
    {"Band 1 Freq", "band0_frequency", 20.0f, 20000.0f, "Hz"},
    {"Band 1 Gain", "band0_gain", -15.0f, 15.0f, "dB"},
    {"Band 1 Q", "band0_q", 0.1f, 10.0f, "x"},
    {"Band 2 Freq", "band1_frequency", 20.0f, 20000.0f, "Hz"},
    {"Band 2 Gain", "band1_gain", -15.0f, 15.0f, "dB"},
    {"Band 2 Q", "band1_q", 0.1f, 10.0f, "x"},
    {"Band 3 Freq", "band2_frequency", 20.0f, 20000.0f, "Hz"},
    {"Band 3 Gain", "band2_gain", -15.0f, 15.0f, "dB"},
    {"Band 3 Q", "band2_q", 0.1f, 10.0f, "x"},
    {"Band 4 Freq", "band3_frequency", 20.0f, 20000.0f, "Hz"},
    {"Band 4 Gain", "band3_gain", -15.0f, 15.0f, "dB"},
    {"Band 4 Q", "band3_q", 0.1f, 10.0f, "x"},
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

struct EqualizerTraits {
  static constexpr int kParamCount = nam_studio::dsp::kParamCount;
  static constexpr const DsparkParamInfo* kInfo = nam_studio::dsp::kParamInfo;
  static constexpr const float* kDefaults = nam_studio::dsp::kDefaults;

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

struct Equalizer::Impl {
  DsparkEffect<EqualizerProc, EqualizerTraits> dsp;
};

Equalizer::Equalizer() : impl_(std::make_unique<Impl>()) {}
Equalizer::~Equalizer() = default;

void Equalizer::Reset(double sample_rate) { impl_->dsp.Reset(sample_rate); }

void Equalizer::Process(const float* const* input, float* const* output, int num_frames) {
  impl_->dsp.Process(input, output, num_frames);
}

int Equalizer::ParamCount() { return DsparkEffect<EqualizerProc, EqualizerTraits>::ParamCount(); }

const Equalizer::ParamInfo& Equalizer::GetParamInfo(int index) {
  return DsparkEffect<EqualizerProc, EqualizerTraits>::GetParamInfo(index);
}

float Equalizer::GetParam(int index) const { return impl_->dsp.GetParam(index); }

void Equalizer::SetParam(int index, float value) { impl_->dsp.SetParam(index, value); }

}  // namespace nam_studio::dsp