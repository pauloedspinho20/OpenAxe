#include "openaxe/dsp/tremolo.h"

#include "Effects/Tremolo.h"
#include "internal/dspark_wrapper.h"

namespace openaxe::dsp {

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

// Sensible starting point rather than DSPark's own defaults: a 4Hz half-depth
// sine is the classic amp tremolo. DsparkEffect seeds the processor with these
// on construction and after every Reset.
constexpr float kDefaults[kParamCount] = {
    4.0f,  // rate
    0.5f,  // depth
    0.0f,  // shape (Sine)
};

using Shape = dspark::Tremolo<float>::Shape;

}  // namespace

// The policy DsparkEffect<> needs for this effect: the param table, the
// defaults, optional one-time configuration, and how a param index maps onto
// the vendored processor's setters. See internal/dspark_wrapper.h.
struct TremoloTraits {
  static constexpr int kParamCount = openaxe::dsp::kParamCount;
  static constexpr const DsparkParamInfo* kInfo = openaxe::dsp::kParamInfo;
  static constexpr const float* kDefaults = openaxe::dsp::kDefaults;

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

// Pimpl so the vendored dspark:: types stay out of the public header.
struct Tremolo::Impl {
  DsparkEffect<dspark::Tremolo<float>, TremoloTraits> dsp;
};

Tremolo::Tremolo() : impl_(std::make_unique<Impl>()) {}
Tremolo::~Tremolo() = default;

// Re-prepare the processor for a new sample rate (the LFO's phase increment
// depends on it) and re-seed every param. Allocates - not real-time safe.
void Tremolo::Reset(double sample_rate) { impl_->dsp.Reset(sample_rate); }

// Amplitude modulation: the LFO scales the signal's gain, with the right
// channel's LFO 180 degrees out of phase (setStereo above) so the effect reads
// as an auto-pan across the stereo field. Real-time safe.
void Tremolo::Process(const float* const* input, float* const* output, int num_frames) {
  impl_->dsp.Process(input, output, num_frames);
}

// Param surface: rate (Hz), depth (0..1), shape (0=Sine, 1=Triangle,
// 2=Square - the enum DSPark's Tremolo::Shape defines).
int Tremolo::ParamCount() {
  return DsparkEffect<dspark::Tremolo<float>, TremoloTraits>::ParamCount();
}

// Name/symbol/range/unit for one param index.
const Tremolo::ParamInfo& Tremolo::GetParamInfo(int index) {
  return DsparkEffect<dspark::Tremolo<float>, TremoloTraits>::GetParamInfo(index);
}

// Current value of one param, from DsparkEffect's own mirror of the values it
// pushed into the processor (the vendored types have no getters).
float Tremolo::GetParam(int index) const { return impl_->dsp.GetParam(index); }

// Store one param and push it into the processor. Real-time safe - all three
// params are plain coefficient updates.
void Tremolo::SetParam(int index, float value) { impl_->dsp.SetParam(index, value); }

}  // namespace openaxe::dsp