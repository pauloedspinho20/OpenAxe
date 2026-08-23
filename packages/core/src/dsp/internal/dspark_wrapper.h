#pragma once

// The shared adapter turning any DSPark processor into the openaxe::dsp
// wrapper contract (see include/openaxe/dsp/dspark_param.h for the
// contract). DSPark processors all speak the same small interface -
// prepare(dspark::AudioSpec) + processBlock(dspark::AudioBufferView<float>) -
// so all the plumbing that is identical across wrappers (the AudioSpec
// lifecycle, the stereo AudioBufferView bridge, the per-block-size chunking,
// and the atomic-param mirror) lives here once instead of being re-derived
// per effect the way each hand-written wrapper derives its own.
//
// A Traits specialization supplies the only processor-specific knowledge:
//
//   static constexpr int kParamCount;
//   static constexpr DsparkParamInfo kInfo[kParamCount];   // name/symbol/range/unit
//   static constexpr float kDefaults[kParamCount];         // seeded on construction
//   static void Apply(Processor&, const float* values, int index, float value);
//       // Forwards param `index` to the DSPark setter. `values` is the
//       // full live mirror (value already written at index) so multi-field
//       // processors like Equalizer can re-derive a whole band config from
//       // the siblings. Cast to the DSPark enum where a knob is discrete.
//   static void Configure(Processor&);  // optional one-time setup (e.g.
//       // Equalizer's band count); the adapter detects its absence and skips it.
//
// The wrapper keeps its own float mirror (SetParam stores + applies; GetParam
// reads the mirror), matching how the hand-written wrappers cache their knobs
// - the DSPark processors themselves only publish params atomically and don't
// all expose getters.
//
// Internal to packages/core (src/dsp/internal/, like wdf_common.h): never
// included by a public header, so DSPark's include path stays PRIVATE.

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <memory>

#include "Core/AudioBuffer.h"
#include "Core/AudioSpec.h"
#include "openaxe/dsp/dspark_param.h"

namespace openaxe::dsp {

// DSPark processors pre-allocate their block-sized buffers in prepare(), and
// hosts honour the block size they were prepared with. Process() slices
// whatever the engine hands us into kMaxBlock-size sub-blocks so the wrapper
// works regardless of the engine's configured max_block_size.
inline constexpr int kDsparkMaxBlock = 512;

inline constexpr int kDsparkChannels = 2;

template <typename Processor, typename Traits>
class DsparkEffect {
 public:
  using ParamInfo = DsparkParamInfo;

  static_assert(Traits::kParamCount > 0, "a DSPark wrapper needs at least one parameter");
  static_assert(Traits::kParamCount <= 64, "bump the mirror array in dspark_wrapper.h if this grows");

  DsparkEffect() : impl_(std::make_unique<Impl>()) {
    // Configure() first: it may (re)size processor state (e.g. Equalizer's
    // setNumBands, which resets every band), so the default param values are
    // applied on top of it, not before it.
    if constexpr (requires { Traits::Configure(impl_->proc); }) {
      Traits::Configure(impl_->proc);
    }
    for (int i = 0; i < Traits::kParamCount; ++i) {
      impl_->params[static_cast<size_t>(i)] = Traits::kDefaults[i];
      ApplyParam(i, impl_->params[static_cast<size_t>(i)]);
    }
  }
  ~DsparkEffect() = default;
  DsparkEffect(const DsparkEffect&) = delete;
  DsparkEffect& operator=(const DsparkEffect&) = delete;

  // Prepare the processor for a new sample rate. DSPark allocates its
  // block-sized scratch here, so this is not real-time safe - and it is
  // prepared for kDsparkMaxBlock regardless of the engine's block size, which
  // is what lets Process() chunk any size below that.
  void Reset(double sample_rate) {
    impl_->sample_rate = sample_rate;
    impl_->proc.prepare(dspark::AudioSpec{impl_->sample_rate, kDsparkMaxBlock, kDsparkChannels});
  }

  // Bridge the engine's planar float buffers to DSPark's in-place
  // AudioBufferView: copy input into the output buffers, then process them in
  // place, in kDsparkMaxBlock-sized slices. Real-time safe - no allocation, and
  // the copy is the price of DSPark's in-place-only block interface.
  void Process(const float* const* input, float* const* output, int num_frames) {
    if (num_frames <= 0) return;
    int offset = 0;
    while (offset < num_frames) {
      const int n = std::min(num_frames - offset, kDsparkMaxBlock);
      float* out_ptr[kDsparkChannels] = {output[0] + offset, output[1] + offset};
      std::copy_n(input[0] + offset, n, out_ptr[0]);
      std::copy_n(input[1] + offset, n, out_ptr[1]);
      dspark::AudioBufferView<float> view(out_ptr, kDsparkChannels, n);
      impl_->proc.processBlock(view);
      offset += n;
    }
  }

  // Param surface, straight from the Traits (see the file header).
  static int ParamCount() { return Traits::kParamCount; }
  static const ParamInfo& GetParamInfo(int index) { return Traits::kInfo[static_cast<size_t>(index)]; }
  float GetParam(int index) const { return impl_->params[static_cast<size_t>(index)]; }

  // Store into the mirror first, then apply - Traits::Apply reads the mirror,
  // so multi-field processors see the new value alongside its siblings.
  // Callers bound-check the index (the engine does).
  void SetParam(int index, float value) {
    impl_->params[static_cast<size_t>(index)] = value;
    ApplyParam(index, value);
  }

 private:
  // Push one mirrored value into the DSPark processor via the Traits.
  void ApplyParam(int index, float value) { Traits::Apply(impl_->proc, impl_->params.data(), index, value); }

  // Heap-allocated so the vendored processor (which can be large and is not
  // movable) has a stable address for the lifetime of the wrapper.
  struct Impl {
    Processor proc;
    std::array<float, Traits::kParamCount> params{};
    double sample_rate = 48000.0;
  };

  std::unique_ptr<Impl> impl_;
};

}  // namespace openaxe::dsp