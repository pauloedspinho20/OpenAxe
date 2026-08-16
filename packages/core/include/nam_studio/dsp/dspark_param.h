#pragma once

// The shared parameter descriptor used by every DSPark-backed DSP wrapper
// (compressor.h, equalizer.h, noise_gate.h, tremolo.h, ...). DSPark itself is
// a dependency-free, header-only C++20 library vendored at
// packages/core/third_party/dspark; these wrappers do NOT expose any of its
// types in their public headers (matching nam_amp.h's own forward-declare
// only rule), so this file is the entire public surface a consumer sees.
//
// The wrapper contract is otherwise identical to the hand-written wrappers
// (see phaser.h for the canonical shape): Reset(sample_rate) /
// Process(input, output, num_frames) / static ParamCount() / static
// GetParamInfo(index) / GetParam(index) / SetParam(index, value). Each
// DSPark wrapper's own .cpp implements that contract through the shared
// DsparkEffect adapter (src/dsp/internal/dspark_wrapper.h), supplying only a
// parameter table (this struct, one row per param) + a free Apply() function
// forwarding each param's float to the DSPark processor's setter. Adding a
// new DSPark-backed block is therefore just a Traits table + a thin concrete
// class - see compressor.cpp for the minimal example.
namespace nam_studio::dsp {

struct DsparkParamInfo {
  const char* name;
  const char* symbol;
  float min_value;
  float max_value;
  const char* unit;
};

}  // namespace nam_studio::dsp