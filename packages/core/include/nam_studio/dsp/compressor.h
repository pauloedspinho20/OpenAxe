#pragma once

#include <memory>

#include "nam_studio/dsp/dspark_param.h"

namespace nam_studio::dsp {

// Compressor block (kCompressor), backed by dspark::Compressor<float>
// (packages/core/third_party/dspark) through the shared DsparkEffect adapter
// (src/dsp/internal/dspark_wrapper.h). Full modular dynamics: peak/RMS/true-
// peak/Hilbert detection, feed-forward/feedback topology, and four character
// models (Clean, Opto/LA-2A-style, FET/1176-style, Varimu/Fairchild-style).
//
// Parameters (see compressor.cpp's kParamInfo):
//   - Threshold: -60–0 dB, default -18 — level at which compression begins
//   - Ratio: 1–20, default 4 — input/output ratio above the threshold
//   - Attack: 0.1–100 ms, default 5 — t63 of the dB gain-reduction envelope
//   - Release: 1–2000 ms, default 100 — t63 recovery (character-dependent)
//   - Knee: 0–20 dB, default 0 — dB range over which ratio ramps in
//   - Makeup: 0–24 dB, default 0 — static output gain applied after reduction
//   - Character: 0–3, default 0 — Clean/Opto/FET/Varimu model select
//
// The DSPark processor's parallel-mix knob is intentionally not exposed here:
// BaseEffect owns the dry/wet crossfade via its own mix knob (see chorus.h's
// doc comment on the wet-only convention). The internal mix stays at its
// default of 1.0 (fully wet) so the wrapper's output is the fully-compressed
// signal and BaseEffect blends it against the dry input.
//
// Stereo, like every other DSP wrapper in this codebase: the detector is
// stereo-linked (peak across both channels), so a mono LFO of gain reduction
// is applied symmetrically - no image shifting.
class Compressor {
 public:
  using ParamInfo = DsparkParamInfo;

  Compressor();
  ~Compressor();
  Compressor(const Compressor&) = delete;
  Compressor& operator=(const Compressor&) = delete;

  void Reset(double sample_rate);
  void Process(const float* const* input, float* const* output, int num_frames);

  static int ParamCount();
  static const ParamInfo& GetParamInfo(int index);
  float GetParam(int index) const;
  void SetParam(int index, float value);

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace nam_studio::dsp