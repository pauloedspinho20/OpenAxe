#pragma once

#include <memory>

namespace nam_studio::dsp {

// Wraps BYOD's diode-clipper circuit (a wave digital filter model of a
// diode pair clamping a first-order RC lowpass - Werner et al., "An
// Improved and Generalized Diode Clipper Model for Wave Digital Filters"),
// exposing cutoff, drive, diode type, and diode count as a clean C++ API.
//
// This is a hand-written reimplementation of BYOD's DiodeClipperWDF
// (src/processors/drive/diode_circuits/DiodeClipperWDF.h), not a vendored
// #include of it: that header pulls in <pch.h>, which - via CMake's
// force-included precompiled header for BYOD's own build - unconditionally
// brings in JUCE, RTNeural, and Eigen for every one of BYOD's 249 processor
// files, even this simplest one. The actual DSP (chowdsp_wdf's WDF circuit
// primitives, already header-only and dependency-free) is untouched;
// what's reimplemented is only the JUCE-touching glue around it: parameter
// smoothing (SmoothedValue) and a couple of trivial utilities. Per-sample
// smoothing is dropped rather than reimplemented - every other DSP wrapper
// in this codebase (NamAmp, the Dragonfly reverbs) also applies parameter
// changes immediately with no internal ramping; smoothing only happens, if
// at all, once per process() block at the engine layer (see engine.cpp's
// ApplyRealtimeParams), so adding a second, finer-grained smoothing
// mechanism here would be inconsistent with the rest of this library.
//
// Stereo, like the Dragonfly reverbs: BYOD's own DiodeClipper runs one
// independent DiodeClipperWDF instance per channel (wdf[2] in its
// DiodeClipper.h), which this wrapper mirrors internally.
class DiodeClipper {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  DiodeClipper();
  ~DiodeClipper();
  DiodeClipper(const DiodeClipper&) = delete;
  DiodeClipper& operator=(const DiodeClipper&) = delete;

  // Updates the sample rate the internal RC filter runs at. Not real-time
  // safe. Safe to call at any time (preserves current parameter values).
  void Reset(double sample_rate);

  // Real-time safe. Stereo: input[0]/output[0] = left, input[1]/output[1] =
  // right - each channel runs its own independent WDF circuit instance, no
  // cross-channel interaction (matching BYOD's own per-channel wdf[2]).
  void Process(const float* const* input, float* const* output, int num_frames);

  static int ParamCount();
  static const ParamInfo& GetParamInfo(int index);

  // Values are in each parameter's native range/unit (see GetParamInfo).
  // Diode type is a discrete choice (0=GZ34, 1=1N34, 2=1N4148) encoded as a
  // float index - the same convention DragonflyPlateReverb already uses
  // for its own algorithm-choice parameter.
  float GetParam(int index) const;
  void SetParam(int index, float value);

 private:
  struct Impl;  // defined in diode_clipper.cpp (holds the WDF circuit state)
  std::unique_ptr<Impl> impl_;
};

}  // namespace nam_studio::dsp
