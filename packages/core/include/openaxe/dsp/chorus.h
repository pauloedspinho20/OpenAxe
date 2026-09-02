#pragma once

#include <memory>

namespace openaxe::dsp {

// Classic stereo chorus: a modulated delay line whose read tap position is
// swept by an LFO, creating the signature pitch-wavering and stereo
// widening. Each stereo channel has its own independent delay line.
//
// This is a wrapper around the chorus from DaisySP (Electro-Smith's MIT
// DSP library, vendored at packages/core/third_party/daisysp) - the same
// double-tap design used in the Daisy hardware platform's own patches. The
// DSP comes from Source/Effects/chorus.{h,cpp}; only that MIT part of the
// repo is compiled (the DaisySP-LGPL tree is deliberately excluded). See
// chorus.cpp's file header for how the wrapper maps the engine's params onto
// daisysp::Chorus and how it strips DaisySP's internal wet/dry mix so the
// engine's own `mix` knob keeps owning the blend.
//
// Parameters (see chorus.cpp's kParamInfo):
//   - Rate: 0.1–10 Hz, default 0.2 — LFO speed
//   - Depth: 0.2–10 ms, default 0.8 — modulation deviation from center delay.
//     DaisySP's LFO depth is normalized 0..0.93 relative to the delay time,
//     so the wrapper re-derives it as depth_ms / delay_ms each time either
//     knob moves - the effective excursion is the current depth_ms, capped at
//     93% of the delay so the tap never reads a negative time.
//   - Delay: 5–30 ms, default 5.5 — center delay time (classic chorus ~7–8 ms)
//   - Feedback: 0–0.5, default 0.15 — output fed back into the buffer
//
// DaisySP's delay line is fixed at 2400 samples (50 ms at 48 kHz), so at
// higher sample rates the read tap clamps to 25 ms at 96 kHz. The web app
// runs at 48 kHz, where the schema's max tap (30 ms delay + 10 ms depth)
// fits with headroom; the desktop/plugin back-ends inherit the same engine.
//   - Stereo: 0/1, default 1 — two engines per channel swept at slightly
//     different LFO rates (the classic drift-based widening) plus mirrored
//     panning; off collapses both to centre for a mono chorus that stays put
//     in the image in front of an amp.
//
// The BaseEffect layer in the web app (apps/web/src/effects/Effect.ts)
// handles the dry/wet crossfade via its own mix knob — this DSP always
// outputs the 100%-wet modulated signal so BaseEffect can blend it cleanly
// against the original dry input. At mix=1.0 (fully wet), the effect is
// vibrato-like; blend back with the dry signal for classic chorus.
class Chorus {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  Chorus();
  ~Chorus();
  Chorus(const Chorus&) = delete;
  Chorus& operator=(const Chorus&) = delete;

  // (Re)initializes the daisysp chorus for the given sample rate. Must be
  // called at least once before Process().
  void Reset(double sample_rate);

  // Real-time safe (no allocation). input/output are interleaved stereo
  // float buffers of num_frames samples each.
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