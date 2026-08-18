#include "nam_studio/dsp/zen_drive.h"

#include <algorithm>
#include <array>

#include "chowdsp_wdf/chowdsp_wdf.h"
#include "internal/wdf_common.h"

namespace nam_studio::dsp {
namespace {

constexpr int kParamCount = 2;
constexpr int kVoiceParam = 0;
constexpr int kGainParam = 1;

// Generated from packages/core/param_schema.json (issue #51) - run
// scripts/gen-param-schema.mjs after editing the schema.
const ZenDrive::ParamInfo kParamInfo[kParamCount] = {
#include "generated/zen_drive_params.inc"
};

// One channel's Zen Drive circuit - hand-copied from BYOD's ZenDriveWDF.h
// using chowdsp_wdf's primitives directly, dropping its JUCE-only
// SmoothedValue members (params apply immediately, matching every other DSP
// wrapper in this codebase).
struct Channel {
  using Wdf = float;

  chowdsp::wdft::CapacitiveVoltageSourceT<Wdf> Vin_C3{470.0e-9f};
  chowdsp::wdft::ResistiveVoltageSourceT<Wdf> R4{470.0e3f};
  chowdsp::wdft::WDFParallelT<Wdf, decltype(Vin_C3), decltype(R4)> P1{Vin_C3, R4};

  static constexpr float kR5 = 1.0e3f;
  static constexpr float kR6 = 10.0e3f;
  chowdsp::wdft::ResistiveCapacitiveVoltageSourceT<Wdf> R5_R6_C5{kR5 + kR6, 100.0e-9f};

  chowdsp::wdft::ResistorT<Wdf> RL{1.0e6f};

  chowdsp::wdft::RtypeAdaptor<Wdf, 0, internal::NonInvertingOpAmpRType, decltype(P1), decltype(R5_R6_C5),
                               decltype(RL)>
      R{P1, R5_R6_C5, RL};

  static constexpr float kR9 = 500.0e3f;
  chowdsp::wdft::ResistorCapacitorParallelT<Wdf> Rv9_C4{kR9, 100.0e-12f};
  chowdsp::wdft::WDFParallelT<Wdf, decltype(Rv9_C4), decltype(R)> P3{Rv9_C4, R};

  chowdsp::wdft::DiodePairT<Wdf, decltype(P1), chowdsp::wdft::DiodeQuality::Best> diodes{
      P1, 5.241435962608312e-10f, 0.07877217375325735f};

  internal::DcBlocker dc_blocker;

  void Prepare(float sample_rate) {
    R4.setVoltage(4.5f);
    R5_R6_C5.setVoltage(4.5f);
    Vin_C3.prepare(sample_rate);
    Rv9_C4.prepare(sample_rate);
    R5_R6_C5.prepare(sample_rate);
    dc_blocker.SetCutoff(30.0f, sample_rate);
    dc_blocker.Reset();
  }

  void SetParams(float voice, float gain) {
    gain = std::max(gain, 0.001f);  // protect from R9 going to zero, matching BYOD's own jmax guard
    R5_R6_C5.setResistanceValue(kR5 + voice * kR6);
    Rv9_C4.setResistanceValue(kR9 * gain);
  }

  float ProcessSample(float x) {
    Vin_C3.setVoltage(x);
    diodes.incident(P3.reflected());
    P3.incident(diodes.reflected());
    const float y = chowdsp::wdft::voltage<float>(RL);
    return dc_blocker.Process(y);
  }
};

}  // namespace

struct ZenDrive::Impl {
  std::array<Channel, 2> channels;
  float voice = 0.5f;
  float gain = 0.5f;

  void ApplyParams() {
    // BYOD's own ZenDrive::prepare/processAudio pass (1 - voiceParam) and
    // logPot(gainParam) into setParameters - the wrapper's own params stay
    // in their natural [0, 1] UI sense, this is where that mapping happens.
    for (auto& ch : channels) ch.SetParams(1.0f - voice, internal::LogPot(gain));
  }
};

ZenDrive::ZenDrive() : impl_(std::make_unique<Impl>()) { impl_->ApplyParams(); }

ZenDrive::~ZenDrive() = default;

void ZenDrive::Reset(double sample_rate) {
  for (auto& ch : impl_->channels) ch.Prepare(static_cast<float>(sample_rate));
  impl_->ApplyParams();
}

void ZenDrive::Process(const float* const* input, float* const* output, int num_frames) {
  // Pre-gain (0.5 linear) / post-gain (-10dB) matches BYOD's own
  // ZenDrive::processAudio exactly.
  constexpr float kPreGain = 0.5f;
  constexpr float kPostGain = 0.31622776601683794f;  // 10^(-10/20)
  for (int ch = 0; ch < 2; ++ch) {
    Channel& channel = impl_->channels[static_cast<size_t>(ch)];
    for (int i = 0; i < num_frames; ++i) {
      output[ch][i] = channel.ProcessSample(input[ch][i] * kPreGain) * kPostGain;
    }
  }
}

int ZenDrive::ParamCount() { return kParamCount; }

const ZenDrive::ParamInfo& ZenDrive::GetParamInfo(int index) { return kParamInfo[static_cast<size_t>(index)]; }

float ZenDrive::GetParam(int index) const {
  switch (index) {
    case kVoiceParam:
      return impl_->voice;
    case kGainParam:
      return impl_->gain;
    default:
      return 0.0f;
  }
}

void ZenDrive::SetParam(int index, float value) {
  switch (index) {
    case kVoiceParam:
      impl_->voice = value;
      break;
    case kGainParam:
      impl_->gain = value;
      break;
    default:
      return;
  }
  impl_->ApplyParams();
}

}  // namespace nam_studio::dsp
