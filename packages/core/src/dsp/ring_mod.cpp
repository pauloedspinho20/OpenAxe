#include "openaxe/dsp/ring_mod.h"

#include "Effects/RingModulator.h"
#include "internal/dspark_wrapper.h"

namespace openaxe::dsp {

namespace {
constexpr int kFrequencyParam = 0;
constexpr int kDriveParam = 1;
constexpr int kParamCount = 2;
const DsparkParamInfo kParamInfo[kParamCount] = {
#include "generated/ring_mod_params.inc"
};
constexpr float kDefaults[kParamCount] = {400.0f, 0.3f};
using RingModProc = dspark::RingModulator<float>;
struct RingModTraits {
  static constexpr int kParamCount = 2;
  static constexpr const DsparkParamInfo* kInfo = kParamInfo;
  static constexpr const float* kDefaults = openaxe::dsp::kDefaults;
  static void Configure(RingModProc& p) {
    p.setMix(1.0f);
    p.setMode(dspark::RingModulator<float>::Mode::Classic);
  }
  static void Apply(RingModProc& p, const float* v, int, float) {
    p.setFrequency(v[kFrequencyParam]);
    p.setSoar(v[kDriveParam]);
  }
};
} // namespace
struct RingMod::Impl {
  DsparkEffect<RingModProc, RingModTraits> dsp;
};
RingMod::RingMod() : impl_(std::make_unique<Impl>()) {}
RingMod::~RingMod() = default;
void RingMod::Reset(double sr) { impl_->dsp.Reset(sr); }
void RingMod::Process(const float* const* in, float* const* out, int n) { impl_->dsp.Process(in, out, n); }
int RingMod::ParamCount() { return DsparkEffect<RingModProc, RingModTraits>::ParamCount(); }
const RingMod::ParamInfo& RingMod::GetParamInfo(int i) { return DsparkEffect<RingModProc, RingModTraits>::GetParamInfo(i); }
float RingMod::GetParam(int i) const { return impl_->dsp.GetParam(i); }
void RingMod::SetParam(int i, float v) { impl_->dsp.SetParam(i, v); }
} // namespace openaxe::dsp
