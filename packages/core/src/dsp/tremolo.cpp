#include "nam_studio/dsp/tremolo.h"

#include "Effects/Tremolo.h"
#include "internal/dspark_wrapper.h"

namespace nam_studio::dsp {

namespace {

constexpr int kRateParam = 0;
constexpr int kDepthParam = 1;
constexpr int kShapeParam = 2;
constexpr int kParamCount = 3;

// Generated from packages/core/param_schema.json (issue #51) - run
// scripts/gen-param-schema.mjs after editing the schema.
const DsparkParamInfo kParamInfo[kParamCount] = {
#include "generated/tremolo_params.inc"
};

constexpr float kDefaults[kParamCount] = {
    4.0f,  // rate
    0.5f,  // depth
    0.0f,  // shape (Sine)
};

using Shape = dspark::Tremolo<float>::Shape;

}  // namespace

struct TremoloTraits {
  static constexpr int kParamCount = nam_studio::dsp::kParamCount;
  static constexpr const DsparkParamInfo* kInfo = nam_studio::dsp::kParamInfo;
  static constexpr const float* kDefaults = nam_studio::dsp::kDefaults;

  // Classic stereo tremolo is often a slow auto-pan; offset the right
  // channel's LFO by 180° instead of syncing both channels to the same LFO.
  static void Configure(dspark::Tremolo<float>& proc) { proc.setStereo(true); }

  static void Apply(dspark::Tremolo<float>& proc, const float* values, int index, float value) {
    (void)values;
    switch (index) {
      case kRateParam:
        proc.setRate(value);
        break;
      case kDepthParam:
        proc.setDepth(value);
        break;
      case kShapeParam:
        proc.setShape(static_cast<Shape>(static_cast<int>(value)));
        break;
      default:
        break;
    }
  }
};

struct Tremolo::Impl {
  DsparkEffect<dspark::Tremolo<float>, TremoloTraits> dsp;
};

Tremolo::Tremolo() : impl_(std::make_unique<Impl>()) {}
Tremolo::~Tremolo() = default;

void Tremolo::Reset(double sample_rate) { impl_->dsp.Reset(sample_rate); }

void Tremolo::Process(const float* const* input, float* const* output, int num_frames) {
  impl_->dsp.Process(input, output, num_frames);
}

int Tremolo::ParamCount() {
  return DsparkEffect<dspark::Tremolo<float>, TremoloTraits>::ParamCount();
}

const Tremolo::ParamInfo& Tremolo::GetParamInfo(int index) {
  return DsparkEffect<dspark::Tremolo<float>, TremoloTraits>::GetParamInfo(index);
}

float Tremolo::GetParam(int index) const { return impl_->dsp.GetParam(index); }

void Tremolo::SetParam(int index, float value) { impl_->dsp.SetParam(index, value); }

}  // namespace nam_studio::dsp