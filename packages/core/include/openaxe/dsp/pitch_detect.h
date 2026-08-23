#pragma once

#include <cstdint>
#include <optional>

namespace openaxe::dsp {

// Autocorrelation-based pitch detection: normalized cross-correlation at each
// lag in the musically-relevant range, refined with parabolic interpolation
// for sub-sample precision. Ported from apps/web/src/tuner/pitchDetect.ts
// (issue #123) so every front end — web, desktop, plugin — shares one
// detector. Lighter than Pitchfinder.js-in-a-worklet, good enough for a
// tuner that only needs a few updates per second.
//
// Pure function over a buffer — no state beyond what the caller passes,
// callable from the UI/control thread. It is not in the audio path.

struct PitchResult {
  // Detected fundamental frequency in Hz.
  float frequency = 0.0f;
  // 0..1 — normalized correlation at the detected lag; low values are unreliable.
  float clarity = 0.0f;
};

// Detect the fundamental frequency of a time-domain buffer, or std::nullopt
// if the signal is too quiet or has no clear periodicity in the searched
// range (silence, noise, a chord). Default range covers a 5-string bass's
// low B (~31Hz) up to well past a guitar's high frets, matching the TS
// defaults: minFrequency 25 Hz, maxFrequency 1500 Hz.
std::optional<PitchResult> DetectPitch(const float* samples, int32_t count,
                                       double sample_rate,
                                       float min_frequency = 25.0f,
                                       float max_frequency = 1500.0f);

}  // namespace openaxe::dsp
