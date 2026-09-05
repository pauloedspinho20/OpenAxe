#pragma once

#include <memory>

#include "openaxe/dsp/dspark_param.h"

namespace openaxe::dsp {

// EQ block (kEq), backed by dspark::Equalizer<float, 4> (packages/core/
// third_party/dspark) through the shared DsparkEffect adapter, plus a global
// low-cut (HPF) + high-cut (LPF) biquad pair in series after the bands (issue
// #373). A 4-band parametric equalizer mirroring the web app's ParametricEQ
// layout (guitar/bass-oriented: low-shelf, two mid peaks, high-shelf), each
// band with frequency/gain/Q, with freq-only cuts for the two most basic
// guitar/bass moves (trimming boom/fizz without spending a shelf band).
//
// Parameters (see equalizer.cpp's kParamInfo): 14, laid out as
// band0_frequency, band0_gain, band0_q, band1_..., band3_q, low_cut,
// high_cut - the same flattened keys the web app's paramSchema.ts uses for
// the EQ block, so a preset's params map 1:1 onto the DSP. Band 0 is a
// LowShelf at 100 Hz, bands 1–2 are Peaks (500 Hz / 2000 Hz), band 3 is a
// HighShelf at 6000 Hz; the DSPark processor's matched-bell (Orfanidis
// de-cramped) design is left at its default off state, and the filter mode
// at MinimumPhase (zero latency, unlike LinearPhase which adds a
// block-sized delay). The cuts are fixed-Q (Butterworth, 12 dB/oct)
// biquads, one pair per channel; at their defaults (20 Hz / 20 kHz) the
// stages are skipped outright, so a default EQ is transparent.
//
// The default gain of 0 dB on every band means a freshly-Reset instance is
// transparent; SetParam re-derives the full band config from the three
// sibling values on every write (see equalizer.cpp's Apply), so turning one
// knob never loses another band's settings.
class Equalizer {
 public:
  using ParamInfo = DsparkParamInfo;

  Equalizer();
  ~Equalizer();
  Equalizer(const Equalizer&) = delete;
  Equalizer& operator=(const Equalizer&) = delete;

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

}  // namespace openaxe::dsp