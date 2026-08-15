#include "nam_studio/dsp/diode_clipper.h"

#include <array>
#include <cmath>

#include "chowdsp_wdf/chowdsp_wdf.h"

namespace nam_studio::dsp {
namespace {

constexpr int kParamCount = 4;
constexpr int kCutoffParam = 0;
constexpr int kDriveParam = 1;
constexpr int kDiodeTypeParam = 2;
constexpr int kNumDiodesParam = 3;

constexpr float kTwoPi = 6.283185307179586f;
constexpr float kThermalVoltage = 0.02585f;
constexpr float kCapValue = 47.0e-9f;

const DiodeClipper::ParamInfo kParamInfo[kParamCount] = {
    {"Cutoff", "cutoff", 200.0f, 20000.0f, "Hz"},
    {"Drive", "drive", 0.0f, 1.0f, "%"},
    // Diode type is a discrete choice (GZ34/1N34/1N4148) encoded as a float
    // index - same convention DragonflyPlateReverb already uses for its own
    // algorithm-choice parameter.
    {"Diode Type", "diode_type", 0.0f, 2.0f, "x"},
    {"Diode Count", "num_diodes", 0.3f, 3.0f, "x"},
};

// Reverse saturation current per diode type - BYOD's own
// DiodeParameter::getDiodeIs values (DiodeParameter.h).
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

// One channel's diode-clipper circuit: a first-order RC lowpass (Vs/C1)
// clamped by a WDF diode pair, built directly from chowdsp_wdf's
// header-only, dependency-free primitives - the same components BYOD's own
// DiodeClipperWDF (src/processors/drive/diode_circuits/DiodeClipperWDF.h)
// uses, reimplemented here without its JUCE-only parameter smoothing (see
// diode_clipper.h's doc comment for why that's dropped rather than ported)
// and using chowdsp_wdf's own built-in Wright-Omega approximation (the
// default 4th DiodePairT template argument) instead of pulling in
// math_approx + BYOD's own OmegaProvider wrapper for no real accuracy gain.
struct Channel {
  using Wdf = float;
  using Res = chowdsp::wdft::ResistorT<Wdf>;
  using Cap = chowdsp::wdft::CapacitorT<Wdf>;
  using ResVs = chowdsp::wdft::ResistiveVoltageSourceT<Wdf>;

  ResVs Vs{4700.0f};
  Cap C1{kCapValue};
  chowdsp::wdft::WDFParallelT<Wdf, Cap, ResVs> P1{C1, Vs};
  chowdsp::wdft::DiodePairT<Wdf, decltype(P1), chowdsp::wdft::DiodeQuality::Best> dp{P1, 2.52e-9f};

  void Prepare(float sample_rate) { C1.prepare(sample_rate); }

  void SetParams(float cutoff_hz, float diode_is, float num_diodes) {
    Vs.setResistanceValue(1.0f / (kTwoPi * cutoff_hz * kCapValue));
    dp.setDiodeParameters(diode_is, kThermalVoltage, num_diodes);
  }

  float ProcessSample(float x) {
    Vs.setVoltage(x);
    dp.incident(P1.reflected());
    const float y = chowdsp::wdft::voltage<float>(C1);
    P1.incident(dp.reflected());
    return y;
  }
};

}  // namespace

struct DiodeClipper::Impl {
  std::array<Channel, 2> channels;
  float cutoff_hz = 5000.0f;
  float drive = 0.5f;
  int diode_type = 0;
  float num_diodes = 1.0f;

  void ApplyParams() {
    const float is = DiodeIsFor(diode_type);
    for (auto& ch : channels) ch.SetParams(cutoff_hz, is, num_diodes);
  }
};

DiodeClipper::DiodeClipper() : impl_(std::make_unique<Impl>()) { impl_->ApplyParams(); }

DiodeClipper::~DiodeClipper() = default;

void DiodeClipper::Reset(double sample_rate) {
  for (auto& ch : impl_->channels) ch.Prepare(static_cast<float>(sample_rate));
  impl_->ApplyParams();
}

void DiodeClipper::Process(const float* const* input, float* const* output, int num_frames) {
  // Gain staging matches BYOD's own DiodeClipper::setGains exactly: drive
  // maps to an input boost, with an output trim that compensates so the
  // overall level stays roughly consistent as drive increases.
  const float in_gain = 0.5f + impl_->drive * (10.0f - 0.5f);
  const float out_gain = in_gain < 1.0f ? 1.0f / in_gain : 1.0f / std::sqrt(in_gain);

  for (int ch = 0; ch < 2; ++ch) {
    Channel& channel = impl_->channels[static_cast<size_t>(ch)];
    for (int i = 0; i < num_frames; ++i) {
      output[ch][i] = channel.ProcessSample(input[ch][i] * in_gain) * out_gain;
    }
  }
}

int DiodeClipper::ParamCount() { return kParamCount; }

const DiodeClipper::ParamInfo& DiodeClipper::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}

float DiodeClipper::GetParam(int index) const {
  switch (index) {
    case kCutoffParam:
      return impl_->cutoff_hz;
    case kDriveParam:
      return impl_->drive;
    case kDiodeTypeParam:
      return static_cast<float>(impl_->diode_type);
    case kNumDiodesParam:
      return impl_->num_diodes;
    default:
      return 0.0f;
  }
}

void DiodeClipper::SetParam(int index, float value) {
  switch (index) {
    case kCutoffParam:
      impl_->cutoff_hz = value;
      break;
    case kDriveParam:
      impl_->drive = value;
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
