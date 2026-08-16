#include "nam_studio/dsp/mxr_distortion.h"

#include <array>
#include <cmath>

#include "chowdsp_wdf/chowdsp_wdf.h"
#include "internal/wdf_common.h"

namespace nam_studio::dsp {
namespace {

constexpr int kParamCount = 2;
constexpr int kDistParam = 0;
constexpr int kLevelParam = 1;

const MxrDistortion::ParamInfo kParamInfo[kParamCount] = {
    {"Distortion", "dist", 0.0f, 1.0f, "%"},
    {"Level", "level", 0.0f, 1.0f, "%"},
};

float DecibelsToGain(float db) { return std::pow(10.0f, db / 20.0f); }

// MXR Distortion+'s own R-type adaptor scattering matrix (a 4-port VCVS
// op-amp topology, different from TubeScreamer/ZenDrive's 3-port
// NonInvertingOpAmpRType) - derived via the R-Solver tool by BYOD's own
// authors (`r_solver.py --datum 0 --adapt 3 ... netlists/mxr_distplus_vcvs.txt`),
// copied verbatim from MXRDistWDF.h.
struct MxrRType {
  template <typename RType>
  static float calcImpedance(RType& R) {
    constexpr float A = 100.0f;   // op-amp gain
    constexpr float Ri = 1.0e9f;  // op-amp input impedance
    constexpr float Ro = 1.0e-1f; // op-amp output impedance

    const auto [Ra, Rb, Rc] = R.getPortImpedances();

    R.setSMatrixData({{-(Ra * Ra * Rb * Rb + 2 * Ra * Ra * Rb * Rc + (Ra * Ra - Rb * Rb) * Rc * Rc - ((A + 1) * Rc * Rc - Ra * Ra) * Ri * Ri - ((A + 2) * Rb * Rc * Rc - 2 * Ra * Ra * Rb - 2 * Ra * Ra * Rc) * Ri + (Rb * Rb * Rc + Rb * Rc * Rc + Rc * Ri * Ri + (2 * Rb * Rc + Rc * Rc) * Ri) * Ro) / (Ra * Ra * Rb * Rb + (Ra * Ra + 2 * Ra * Rb + Rb * Rb) * Rc * Rc + ((A + 2) * Ra * Rc + (A + 1) * Rc * Rc + Ra * Ra) * Ri * Ri + 2 * (Ra * Ra * Rb + Ra * Rb * Rb) * Rc + (2 * Ra * Ra * Rb + ((A + 2) * Ra + (A + 2) * Rb) * Rc * Rc + ((A + 4) * Ra * Rb + 2 * Ra * Ra) * Rc) * Ri - (Ra * Rb * Rb + (Ra + Rb) * Rc * Rc + (Ra + Rc) * Ri * Ri + (2 * Ra * Rb + Rb * Rb) * Rc + (2 * Ra * Rb + 2 * (Ra + Rb) * Rc + Rc * Rc) * Ri) * Ro),
                       -(2 * Ra * Ra * Rb * Rc + 2 * (Ra * Ra + Ra * Rb) * Rc * Rc - (A * Ra * Ra + A * Ra * Rc) * Ri * Ri - (A * Ra * Ra * Rb - (A + 2) * Ra * Rc * Rc + ((A - 2) * Ra * Ra + A * Ra * Rb) * Rc) * Ri - (Ra * Rb * Rc + Ra * Rc * Rc + Ra * Rc * Ri) * Ro) / (Ra * Ra * Rb * Rb + (Ra * Ra + 2 * Ra * Rb + Rb * Rb) * Rc * Rc + ((A + 2) * Ra * Rc + (A + 1) * Rc * Rc + Ra * Ra) * Ri * Ri + 2 * (Ra * Ra * Rb + Ra * Rb * Rb) * Rc + (2 * Ra * Ra * Rb + ((A + 2) * Ra + (A + 2) * Rb) * Rc * Rc + ((A + 4) * Ra * Rb + 2 * Ra * Ra) * Rc) * Ri - (Ra * Rb * Rb + (Ra + Rb) * Rc * Rc + (Ra + Rc) * Ri * Ri + (2 * Ra * Rb + Rb * Rb) * Rc + (2 * Ra * Rb + 2 * (Ra + Rb) * Rc + Rc * Rc) * Ri) * Ro),
                       -(2 * Ra * Ra * Rb * Rb + ((A + 2) * Ra * Ra + 2 * (A + 1) * Ra * Rc) * Ri * Ri + 2 * (Ra * Ra * Rb + Ra * Rb * Rb) * Rc + ((A + 4) * Ra * Ra * Rb + ((A + 2) * Ra * Ra + 2 * (A + 2) * Ra * Rb) * Rc) * Ri - (Ra * Rb * Rb + Ra * Rb * Rc + Ra * Ri * Ri + (2 * Ra * Rb + Ra * Rc) * Ri) * Ro) / (Ra * Ra * Rb * Rb + (Ra * Ra + 2 * Ra * Rb + Rb * Rb) * Rc * Rc + ((A + 2) * Ra * Rc + (A + 1) * Rc * Rc + Ra * Ra) * Ri * Ri + 2 * (Ra * Ra * Rb + Ra * Rb * Rb) * Rc + (2 * Ra * Ra * Rb + ((A + 2) * Ra + (A + 2) * Rb) * Rc * Rc + ((A + 4) * Ra * Rb + 2 * Ra * Ra) * Rc) * Ri - (Ra * Rb * Rb + (Ra + Rb) * Rc * Rc + (Ra + Rc) * Ri * Ri + (2 * Ra * Rb + Rb * Rb) * Rc + (2 * Ra * Rb + 2 * (Ra + Rb) * Rc + Rc * Rc) * Ri) * Ro),
                       (Ra * Rb + Ra * Rc + Ra * Ri) / (Ra * Rb + (Ra + Rb) * Rc + (Ra + Rc) * Ri)},
                      {-(2 * Ra * Rb * Rb * Rc + 2 * (Ra * Rb + Rb * Rb) * Rc * Rc + ((A + 2) * Rb * Rc * Rc + 2 * Ra * Rb * Rc) * Ri - (Rb * Rb * Rc + Rb * Rc * Rc + Rb * Rc * Ri) * Ro) / (Ra * Ra * Rb * Rb + (Ra * Ra + 2 * Ra * Rb + Rb * Rb) * Rc * Rc + ((A + 2) * Ra * Rc + (A + 1) * Rc * Rc + Ra * Ra) * Ri * Ri + 2 * (Ra * Ra * Rb + Ra * Rb * Rb) * Rc + (2 * Ra * Ra * Rb + ((A + 2) * Ra + (A + 2) * Rb) * Rc * Rc + ((A + 4) * Ra * Rb + 2 * Ra * Ra) * Rc) * Ri - (Ra * Rb * Rb + (Ra + Rb) * Rc * Rc + (Ra + Rc) * Ri * Ri + (2 * Ra * Rb + Rb * Rb) * Rc + (2 * Ra * Rb + 2 * (Ra + Rb) * Rc + Rc * Rc) * Ri) * Ro),
                       -(Ra * Ra * Rb * Rb + 2 * Ra * Rb * Rb * Rc - (Ra * Ra - Rb * Rb) * Rc * Rc - ((A + 2) * Ra * Rc + (A + 1) * Rc * Rc + Ra * Ra) * Ri * Ri - ((A + 2) * Ra * Rc * Rc + 2 * Ra * Ra * Rc) * Ri - (Ra * Rb * Rb + Rb * Rb * Rc - Ra * Rc * Rc - (Ra + Rc) * Ri * Ri - (2 * Ra * Rc + Rc * Rc) * Ri) * Ro) / (Ra * Ra * Rb * Rb + (Ra * Ra + 2 * Ra * Rb + Rb * Rb) * Rc * Rc + ((A + 2) * Ra * Rc + (A + 1) * Rc * Rc + Ra * Ra) * Ri * Ri + 2 * (Ra * Ra * Rb + Ra * Rb * Rb) * Rc + (2 * Ra * Ra * Rb + ((A + 2) * Ra + (A + 2) * Rb) * Rc * Rc + ((A + 4) * Ra * Rb + 2 * Ra * Ra) * Rc) * Ri - (Ra * Rb * Rb + (Ra + Rb) * Rc * Rc + (Ra + Rc) * Ri * Ri + (2 * Ra * Rb + Rb * Rb) * Rc + (2 * Ra * Rb + 2 * (Ra + Rb) * Rc + Rc * Rc) * Ri) * Ro),
                       (2 * Ra * Ra * Rb * Rb + 2 * (Ra * Ra * Rb + Ra * Rb * Rb) * Rc + ((A + 2) * Ra * Rb * Rc + 2 * Ra * Ra * Rb) * Ri - (2 * Ra * Rb * Rb + (2 * Ra * Rb + Rb * Rb) * Rc + (2 * Ra * Rb + Rb * Rc) * Ri) * Ro) / (Ra * Ra * Rb * Rb + (Ra * Ra + 2 * Ra * Rb + Rb * Rb) * Rc * Rc + ((A + 2) * Ra * Rc + (A + 1) * Rc * Rc + Ra * Ra) * Ri * Ri + 2 * (Ra * Ra * Rb + Ra * Rb * Rb) * Rc + (2 * Ra * Ra * Rb + ((A + 2) * Ra + (A + 2) * Rb) * Rc * Rc + ((A + 4) * Ra * Rb + 2 * Ra * Ra) * Rc) * Ri - (Ra * Rb * Rb + (Ra + Rb) * Rc * Rc + (Ra + Rc) * Ri * Ri + (2 * Ra * Rb + Rb * Rb) * Rc + (2 * Ra * Rb + 2 * (Ra + Rb) * Rc + Rc * Rc) * Ri) * Ro),
                       Rb * Rc / (Ra * Rb + (Ra + Rb) * Rc + (Ra + Rc) * Ri)},
                      {-(2 * Ra * Rb * Rb * Rc + 2 * (Ra * Rb + Rb * Rb) * Rc * Rc + ((A + 2) * Rc * Rc + 2 * Ra * Rc) * Ri * Ri + (4 * Ra * Rb * Rc + ((A + 4) * Rb + 2 * Ra) * Rc * Rc) * Ri - (Rb * Rb * Rc + Rb * Rc * Rc + Rc * Ri * Ri + (2 * Rb * Rc + Rc * Rc) * Ri) * Ro) / (Ra * Ra * Rb * Rb + (Ra * Ra + 2 * Ra * Rb + Rb * Rb) * Rc * Rc + ((A + 2) * Ra * Rc + (A + 1) * Rc * Rc + Ra * Ra) * Ri * Ri + 2 * (Ra * Ra * Rb + Ra * Rb * Rb) * Rc + (2 * Ra * Ra * Rb + ((A + 2) * Ra + (A + 2) * Rb) * Rc * Rc + ((A + 4) * Ra * Rb + 2 * Ra * Ra) * Rc) * Ri - (Ra * Rb * Rb + (Ra + Rb) * Rc * Rc + (Ra + Rc) * Ri * Ri + (2 * Ra * Rb + Rb * Rb) * Rc + (2 * Ra * Rb + 2 * (Ra + Rb) * Rc + Rc * Rc) * Ri) * Ro),
                       (2 * Ra * Ra * Rb * Rc + 2 * (Ra * Ra + Ra * Rb) * Rc * Rc + (A * Ra * Rc + A * Rc * Rc) * Ri * Ri + ((2 * (A + 1) * Ra + A * Rb) * Rc * Rc + (A * Ra * Rb + 2 * Ra * Ra) * Rc) * Ri - (2 * Ra * Rb * Rc + (2 * Ra + Rb) * Rc * Rc + (2 * Ra * Rc + Rc * Rc) * Ri) * Ro) / (Ra * Ra * Rb * Rb + (Ra * Ra + 2 * Ra * Rb + Rb * Rb) * Rc * Rc + ((A + 2) * Ra * Rc + (A + 1) * Rc * Rc + Ra * Ra) * Ri * Ri + 2 * (Ra * Ra * Rb + Ra * Rb * Rb) * Rc + (2 * Ra * Ra * Rb + ((A + 2) * Ra + (A + 2) * Rb) * Rc * Rc + ((A + 4) * Ra * Rb + 2 * Ra * Ra) * Rc) * Ri - (Ra * Rb * Rb + (Ra + Rb) * Rc * Rc + (Ra + Rc) * Ri * Ri + (2 * Ra * Rb + Rb * Rb) * Rc + (2 * Ra * Rb + 2 * (Ra + Rb) * Rc + Rc * Rc) * Ri) * Ro),
                       (Ra * Ra * Rb * Rb - (Ra * Ra + 2 * Ra * Rb + Rb * Rb) * Rc * Rc - ((A + 1) * Rc * Rc - Ra * Ra) * Ri * Ri + (2 * Ra * Ra * Rb - ((A + 2) * Ra + (A + 2) * Rb) * Rc * Rc) * Ri - (Ra * Rb * Rb - (Ra + Rb) * Rc * Rc + Ra * Ri * Ri + (2 * Ra * Rb - Rc * Rc) * Ri) * Ro) / (Ra * Ra * Rb * Rb + (Ra * Ra + 2 * Ra * Rb + Rb * Rb) * Rc * Rc + ((A + 2) * Ra * Rc + (A + 1) * Rc * Rc + Ra * Ra) * Ri * Ri + 2 * (Ra * Ra * Rb + Ra * Rb * Rb) * Rc + (2 * Ra * Ra * Rb + ((A + 2) * Ra + (A + 2) * Rb) * Rc * Rc + ((A + 4) * Ra * Rb + 2 * Ra * Ra) * Rc) * Ri - (Ra * Rb * Rb + (Ra + Rb) * Rc * Rc + (Ra + Rc) * Ri * Ri + (2 * Ra * Rb + Rb * Rb) * Rc + (2 * Ra * Rb + 2 * (Ra + Rb) * Rc + Rc * Rc) * Ri) * Ro),
                       (Rb * Rc + Rc * Ri) / (Ra * Rb + (Ra + Rb) * Rc + (Ra + Rc) * Ri)},
                      {(A * Rc * Ri - (Rb + Rc + Ri) * Ro) / (Ra * Rb + (Ra + Rb) * Rc + ((A + 1) * Rc + Ra) * Ri - (Rb + Rc + Ri) * Ro),
                       ((A * Ra + A * Rc) * Ri - Rc * Ro) / (Ra * Rb + (Ra + Rb) * Rc + ((A + 1) * Rc + Ra) * Ri - (Rb + Rc + Ri) * Ro),
                       -(A * Ra * Ri + (Rb + Ri) * Ro) / (Ra * Rb + (Ra + Rb) * Rc + ((A + 1) * Rc + Ra) * Ri - (Rb + Rc + Ri) * Ro),
                       0}});

    return -(Ra * Rb + (Ra + Rb) * Rc + (Ra + Rc) * Ri) * Ro / (Ra * Rb + (Ra + Rb) * Rc + ((A + 1) * Rc + Ra) * Ri - (Rb + Rc + Ri) * Ro);
  }
};

// One channel's MXR Distortion+ circuit - hand-copied from BYOD's
// MXRDistWDF.h using chowdsp_wdf's primitives directly.
struct Channel {
  using Wdf = float;

  chowdsp::wdft::ResistorT<Wdf> R4{1.0e6f};

  chowdsp::wdft::ResistiveVoltageSourceT<Wdf> Vin;
  chowdsp::wdft::CapacitorT<Wdf> C1{1.0e-9f};
  chowdsp::wdft::WDFParallelT<Wdf, decltype(Vin), decltype(C1)> P1{Vin, C1};

  chowdsp::wdft::ResistorCapacitorSeriesT<Wdf> R1_C2{10.0e3f, 10.0e-9f};

  chowdsp::wdft::WDFSeriesT<Wdf, decltype(R1_C2), decltype(P1)> S2{R1_C2, P1};
  chowdsp::wdft::ResistiveVoltageSourceT<Wdf> Vb{1.0e6f};
  chowdsp::wdft::WDFParallelT<Wdf, decltype(Vb), decltype(S2)> P2{Vb, S2};

  static constexpr float kR3Val = 4.7e3f;
  static constexpr float kRDistVal = 1.0e6f;
  chowdsp::wdft::ResistorCapacitorSeriesT<Wdf> ResDist_R3_C3{kRDistVal + kR3Val, 47.0e-9f};

  chowdsp::wdft::RtypeAdaptor<Wdf, 3, MxrRType, decltype(R4), decltype(P2), decltype(ResDist_R3_C3)> R{R4, P2,
                                                                                                        ResDist_R3_C3};

  chowdsp::wdft::ResistorCapacitorSeriesT<Wdf> R5_C4{10.0e3f, 1.0e-6f};
  chowdsp::wdft::WDFSeriesT<Wdf, decltype(R5_C4), decltype(R)> S7{R5_C4, R};

  chowdsp::wdft::ResistorT<Wdf> Rout{10.0e3f};
  chowdsp::wdft::WDFParallelT<Wdf, decltype(Rout), decltype(S7)> P4{Rout, S7};
  chowdsp::wdft::CapacitorT<Wdf> C5{1.0e-9f};
  chowdsp::wdft::WDFParallelT<Wdf, decltype(C5), decltype(P4)> P3{C5, P4};

  chowdsp::wdft::DiodePairT<Wdf, decltype(P3), chowdsp::wdft::DiodeQuality::Best> DP{P3, 2.52e-9f, 25.85e-3f * 1.75f};

  internal::DcBlocker dc_blocker;

  void Prepare(float sample_rate) {
    C1.prepare(sample_rate);
    R1_C2.prepare(sample_rate);
    ResDist_R3_C3.prepare(sample_rate);
    R5_C4.prepare(sample_rate);
    C5.prepare(sample_rate);
    Vb.setVoltage(4.5f);
    dc_blocker.SetCutoff(30.0f, sample_rate);
    dc_blocker.Reset();
  }

  void SetParams(float dist_skew) {
    ResDist_R3_C3.setResistanceValue(dist_skew * kRDistVal + kR3Val);
  }

  float ProcessSample(float x) {
    Vin.setVoltage(x);
    DP.incident(P3.reflected());
    P3.incident(DP.reflected());
    const float y = chowdsp::wdft::voltage<float>(Rout);
    return dc_blocker.Process(y);
  }
};

}  // namespace

struct MxrDistortion::Impl {
  std::array<Channel, 2> channels;
  float dist = 0.5f;
  float level = 0.5f;

  void ApplyParams() {
    // Mirrors MXRDistortionParams::paramSkew (MXRDistortion.cpp): a double
    // inverse-log-pot skew for the distortion knob.
    const float dist_skew = 1.0f - internal::InverseLogPot(internal::InverseLogPot(0.5f * dist + 0.5f));
    for (auto& ch : channels) ch.SetParams(dist_skew);
  }
};

MxrDistortion::MxrDistortion() : impl_(std::make_unique<Impl>()) { impl_->ApplyParams(); }

MxrDistortion::~MxrDistortion() = default;

void MxrDistortion::Reset(double sample_rate) {
  for (auto& ch : impl_->channels) ch.Prepare(static_cast<float>(sample_rate));
  impl_->ApplyParams();
}

void MxrDistortion::Process(const float* const* input, float* const* output, int num_frames) {
  // Level knob maps to a -60..0dB output gain skewed so 50% lands on -12dB
  // (MXRDistortionParams::levelSkew), matching BYOD's own MXRDistortion::
  // processAudio exactly.
  const float level_db = internal::SkewedRange(impl_->level, -60.0f, 0.0f, -12.0f);
  const float out_gain = DecibelsToGain(level_db);

  for (int ch = 0; ch < 2; ++ch) {
    Channel& channel = impl_->channels[static_cast<size_t>(ch)];
    for (int i = 0; i < num_frames; ++i) {
      output[ch][i] = channel.ProcessSample(input[ch][i]) * out_gain;
    }
  }
}

int MxrDistortion::ParamCount() { return kParamCount; }

const MxrDistortion::ParamInfo& MxrDistortion::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}

float MxrDistortion::GetParam(int index) const {
  switch (index) {
    case kDistParam:
      return impl_->dist;
    case kLevelParam:
      return impl_->level;
    default:
      return 0.0f;
  }
}

void MxrDistortion::SetParam(int index, float value) {
  switch (index) {
    case kDistParam:
      impl_->dist = value;
      break;
    case kLevelParam:
      impl_->level = value;
      break;
    default:
      return;
  }
  impl_->ApplyParams();
}

}  // namespace nam_studio::dsp
