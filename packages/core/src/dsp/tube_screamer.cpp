#include "nam_studio/dsp/tube_screamer.h"

#include <array>

#include "chowdsp_wdf/chowdsp_wdf.h"
#include "internal/wdf_common.h"

namespace nam_studio::dsp {
namespace {

constexpr int kParamCount = 3;
constexpr int kGainParam = 0;
constexpr int kDiodeTypeParam = 1;
constexpr int kNumDiodesParam = 2;

const TubeScreamer::ParamInfo kParamInfo[kParamCount] = {
    {"Gain", "gain", 0.0f, 1.0f, "%"},
    {"Diode Type", "diode_type", 0.0f, 2.0f, "x"},
    {"Diode Count", "num_diodes", 0.3f, 3.0f, "x"},
};

// Reverse saturation current per diode type - BYOD's own
// DiodeParameter::getDiodeIs values (diode_circuits/DiodeParameter.h), same
// table DiodeClipper already uses.
float DiodeIsFor(int diode_type) {
  switch (diode_type) {
    case 0:
      return 2.52e-9f;  // GZ34
    case 1:
      return 200.0e-12f;  // 1N34
    case 2:
      return 2.64e-9f;  // 1N4148
    default:
      return 2.52e-9f;
  }
}

// One channel's Tube Screamer clipping stage - hand-copied from BYOD's
// TubeScreamerWDF.h using chowdsp_wdf's primitives directly, dropping its
// JUCE-only SmoothedValue members (params apply immediately, matching every
// other DSP wrapper in this codebase).
struct Channel {
  using Wdf = float;

  chowdsp::wdft::CapacitiveVoltageSourceT<Wdf> Vin_C2{1.0e-6f};
  chowdsp::wdft::ResistorT<Wdf> R5{10.0e3f};
  chowdsp::wdft::WDFParallelT<Wdf, decltype(Vin_C2), decltype(R5)> P1{Vin_C2, R5};

  chowdsp::wdft::ResistorCapacitorSeriesT<Wdf> R4_ser_C3{4.7e3f, 0.047e-6f};

  chowdsp::wdft::ResistorT<Wdf> RL{1.0e6f};

  chowdsp::wdft::RtypeAdaptor<Wdf, 0, internal::NonInvertingOpAmpRType, decltype(P1), decltype(R4_ser_C3),
                               decltype(RL)>
      R{P1, R4_ser_C3, RL};

  static constexpr float kVt = 0.02585f;
  static constexpr float kR6 = 51.0e3f;
  static constexpr float kPot1 = 500.0e3f;
  chowdsp::wdft::ResistorCapacitorParallelT<Wdf> R6_P1_par_C4{kR6, 51.0e-12f};
  chowdsp::wdft::WDFParallelT<Wdf, decltype(R6_P1_par_C4), decltype(R)> P3{R6_P1_par_C4, R};

  chowdsp::wdft::DiodePairT<Wdf, decltype(P3), chowdsp::wdft::DiodeQuality::Best> dp{P3, 4.352e-9f, kVt, 1.906f};

  internal::DcBlocker dc_blocker;

  void Prepare(float sample_rate) {
    Vin_C2.prepare(sample_rate);
    R4_ser_C3.prepare(sample_rate);
    R6_P1_par_C4.prepare(sample_rate);
    dc_blocker.SetCutoff(30.0f, sample_rate);
    dc_blocker.Reset();
  }

  void SetParams(float gain_skew, float diode_is, float num_diodes) {
    R6_P1_par_C4.setResistanceValue(kPot1 * gain_skew + kR6);
    dp.setDiodeParameters(diode_is, kVt, num_diodes);
  }

  float ProcessSample(float x) {
    Vin_C2.setVoltage(x);
    dp.incident(P3.reflected());
    P3.incident(dp.reflected());
    const float y = chowdsp::wdft::voltage<float>(RL);
    return dc_blocker.Process(y);
  }
};

}  // namespace

struct TubeScreamer::Impl {
  std::array<Channel, 2> channels;
  float gain = 0.5f;
  int diode_type = 0;
  float num_diodes = 1.0f;

  void ApplyParams() {
    const float gain_skew = internal::LogPot(gain);
    const float is = DiodeIsFor(diode_type);
    for (auto& ch : channels) ch.SetParams(gain_skew, is, num_diodes);
  }
};

TubeScreamer::TubeScreamer() : impl_(std::make_unique<Impl>()) { impl_->ApplyParams(); }

TubeScreamer::~TubeScreamer() = default;

void TubeScreamer::Reset(double sample_rate) {
  for (auto& ch : impl_->channels) ch.Prepare(static_cast<float>(sample_rate));
  impl_->ApplyParams();
}

void TubeScreamer::Process(const float* const* input, float* const* output, int num_frames) {
  // Pre/post -6dB trim matches BYOD's own TubeScreamer::processAudio exactly.
  constexpr float kTrim = 0.5011872336272722f;  // 10^(-6/20)
  for (int ch = 0; ch < 2; ++ch) {
    Channel& channel = impl_->channels[static_cast<size_t>(ch)];
    for (int i = 0; i < num_frames; ++i) {
      output[ch][i] = channel.ProcessSample(input[ch][i] * kTrim) * kTrim;
    }
  }
}

int TubeScreamer::ParamCount() { return kParamCount; }

const TubeScreamer::ParamInfo& TubeScreamer::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}

float TubeScreamer::GetParam(int index) const {
  switch (index) {
    case kGainParam:
      return impl_->gain;
    case kDiodeTypeParam:
      return static_cast<float>(impl_->diode_type);
    case kNumDiodesParam:
      return impl_->num_diodes;
    default:
      return 0.0f;
  }
}

void TubeScreamer::SetParam(int index, float value) {
  switch (index) {
    case kGainParam:
      impl_->gain = value;
      break;
    case kDiodeTypeParam:
      impl_->diode_type = static_cast<int>(value);
      break;
    case kNumDiodesParam:
      impl_->num_diodes = value;
      break;
    default:
      return;
  }
  impl_->ApplyParams();
}

}  // namespace nam_studio::dsp
