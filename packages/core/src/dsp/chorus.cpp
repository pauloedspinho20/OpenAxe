#include "openaxe/dsp/chorus.h"
#include "Effects/Chorus.h"
#include "internal/dspark_wrapper.h"
namespace openaxe::dsp {
namespace {
constexpr int kRateParam = 0;
constexpr int kDepthParam = 1;
constexpr int kDelayParam = 2;
constexpr int kFeedbackParam = 3;
constexpr int kVoicesParam = 4;
constexpr int kSpreadParam = 5;
constexpr int kParamCount = 6;
const DsparkParamInfo kParamInfo[kParamCount] = {
#include "generated/chorus_params.inc"
};
constexpr float kDefaults[kParamCount] = {0.2f,0.8f,5.5f,0.15f,2.0f,0.5f};
using ChorusProc = dspark::Chorus<float>;
struct ChorusTraits {
  static constexpr int kParamCount = 6;
  static constexpr const DsparkParamInfo* kInfo = kParamInfo;
  static constexpr const float* kDefaults = openaxe::dsp::kDefaults;
  static void Configure(ChorusProc& proc) {
    proc.setAutoDepth(false);
    proc.setModWaveform(dspark::Oscillator<float>::Waveform::Sine);
    proc.setMix(1.0f);
  }
  static void Apply(ChorusProc& proc, const float* v, int, float) {
    proc.setRate(v[kRateParam]);
    proc.setDepthMs(v[kDepthParam]);
    proc.setCenterDelay(v[kDelayParam]);
    proc.setFeedback(v[kFeedbackParam]);
    proc.setVoices((int)v[kVoicesParam]);
    proc.setStereoSpread(v[kSpreadParam]);
  }
};
}
struct Chorus::Impl { DsparkEffect<ChorusProc, ChorusTraits> dsp; };
Chorus::Chorus() : impl_(std::make_unique<Impl>()) {}
Chorus::~Chorus() = default;
void Chorus::Reset(double sr) { impl_->dsp.Reset(sr); }
void Chorus::Process(const float* const* in, float* const* out, int n) { impl_->dsp.Process(in,out,n); }
int Chorus::ParamCount() { return DsparkEffect<ChorusProc, ChorusTraits>::ParamCount(); }
const Chorus::ParamInfo& Chorus::GetParamInfo(int i) { return DsparkEffect<ChorusProc, ChorusTraits>::GetParamInfo(i); }
float Chorus::GetParam(int i) const { return impl_->dsp.GetParam(i); }
void Chorus::SetParam(int i,float v) { impl_->dsp.SetParam(i,v); }
}
