#pragma once

// The fingerprint the DSP regression harness compares against its golden file
// (issue #315).
//
// Why metrics rather than the raw output buffers:
//
//  1. A golden file has to survive CI on three platforms and two compilers.
//     Float results are not bit-identical across them (different libm,
//     different FMA contraction), so a byte comparison of audio would fail
//     everywhere for reasons that have nothing to do with the DSP. Every gate
//     here is therefore a tolerance, not an equality.
//  2. Raw audio for every case at every sample rate is megabytes of binary in
//     the repository, and a diff nobody can read. A metric diff says
//     "band 7 dropped 4.2 dB", which is reviewable - and reviewing the diff is
//     the entire point of blessing a reference.
//
// What is deliberately NOT here: a hash of the output. It would be exact, but
// it would also differ on every platform for the reason above, so it can only
// ever be noise in a cross-platform CI.

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <iterator>
#include <vector>

#include "dsp_stimuli.h"

namespace openaxe::test {

// Log-spaced probe frequencies, 40Hz to 16kHz. Coarse on purpose: fine bins
// would trip on inaudible phase differences between platforms, while an octave
// spacing still localises "the top end got darker" or "the resonance moved".
inline constexpr float kBandFrequencies[] = {40.0f,   80.0f,   160.0f,  320.0f,
                                             640.0f,  1280.0f, 2560.0f, 5120.0f,
                                             10240.0f, 16000.0f};
inline constexpr int kBandCount = static_cast<int>(std::size(kBandFrequencies));

// Single-frequency magnitude by Goertzel, which is a second-order recurrence
// per bin - cheaper and shorter than pulling in an FFT for ten bins, and it
// needs no power-of-two length.
//
// Returns the raw DFT magnitude, NOT divided by the length. An earlier version
// divided by n, which flattened every band to the same number: an impulse
// response's energy is concentrated in a handful of samples, so 1/n scaling
// pushed all ten bands to -87dB and made the digital and analog delay models
// measure identically. The scale is removed by the normalisation in Measure
// instead, which is where it belongs.
inline float GoertzelMagnitude(const std::vector<float>& x, double sample_rate, double freq) {
  const size_t n = x.size();
  if (n == 0 || freq <= 0.0 || freq >= sample_rate * 0.5) return 0.0f;
  const double w = 2.0 * M_PI * freq / sample_rate;
  const double coeff = 2.0 * std::cos(w);
  double s1 = 0.0, s2 = 0.0;
  for (size_t i = 0; i < n; ++i) {
    const double s0 = static_cast<double>(x[i]) + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const double real = s1 - s2 * std::cos(w);
  const double imag = s2 * std::sin(w);
  return static_cast<float>(std::sqrt(real * real + imag * imag));
}

// Total signal energy, the denominator that turns the band magnitudes into a
// scale-invariant shape.
inline float Energy(const std::vector<float>& x) {
  double sum = 0.0;
  for (float v : x) sum += static_cast<double>(v) * v;
  return static_cast<float>(std::sqrt(sum));
}

inline float ToDb(float magnitude) {
  // Floored rather than -inf so a silent band is a comparable number. -120dB
  // is far below anything the tolerance cares about.
  return magnitude <= 1e-6f ? -120.0f : 20.0f * std::log10(magnitude);
}

inline float Peak(const std::vector<float>& x) {
  float peak = 0.0f;
  for (float v : x) peak = std::max(peak, std::fabs(v));
  return peak;
}

inline float Rms(const std::vector<float>& x) {
  if (x.empty()) return 0.0f;
  double sum = 0.0;
  for (float v : x) sum += static_cast<double>(v) * v;
  return static_cast<float>(std::sqrt(sum / static_cast<double>(x.size())));
}

// First sample whose magnitude clears `threshold`, or -1. This is what pins a
// delay time or an added latency: it moved by a sample or it did not.
inline int Onset(const std::vector<float>& x, float threshold = 1e-3f) {
  for (size_t i = 0; i < x.size(); ++i) {
    if (std::fabs(x[i]) >= threshold) return static_cast<int>(i);
  }
  return -1;
}

// Normalised L/R correlation. Catches a channel swap, a polarity flip, or a
// stereo width change - none of which move a mono level metric at all.
inline float Correlation(const std::vector<float>& a, const std::vector<float>& b) {
  const size_t n = std::min(a.size(), b.size());
  if (n == 0) return 0.0f;
  double sab = 0.0, saa = 0.0, sbb = 0.0;
  for (size_t i = 0; i < n; ++i) {
    sab += static_cast<double>(a[i]) * b[i];
    saa += static_cast<double>(a[i]) * a[i];
    sbb += static_cast<double>(b[i]) * b[i];
  }
  if (saa <= 0.0 || sbb <= 0.0) return 0.0f;
  return static_cast<float>(sab / std::sqrt(saa * sbb));
}

// One stimulus' worth of fingerprint.
struct StimulusMetrics {
  float peak_l = 0.0f, peak_r = 0.0f;
  float rms_l = 0.0f, rms_r = 0.0f;
  int onset_l = -1, onset_r = -1;
  float correlation = 0.0f;
  // Per-band level relative to the signal's total energy, i.e. the spectral
  // *shape*. Normalising by total energy is what makes this robust: a
  // platform-to-platform gain difference moves peak/rms (which are absolute
  // and gate on their own) without moving the shape at all.
  //
  // Computed for every stimulus, not just the impulse. On the impulse it is
  // the effect's frequency response. On the two-tone it is what catches
  // aliasing and frequency shifting - energy appearing in bands the input
  // never occupied. That replaced a purpose-built "spurious energy ratio",
  // which saturated at 1.0 for ring-mod (every product of a 500Hz carrier is
  // "unexpected") and so discriminated nothing.
  float bands_db[kBandCount] = {};
  bool finite = true;
};

inline StimulusMetrics Measure(const Stereo& out, double sample_rate) {
  StimulusMetrics m;
  for (float v : out.left) if (!std::isfinite(v)) m.finite = false;
  for (float v : out.right) if (!std::isfinite(v)) m.finite = false;
  m.peak_l = Peak(out.left);
  m.peak_r = Peak(out.right);
  m.rms_l = Rms(out.left);
  m.rms_r = Rms(out.right);
  m.onset_l = Onset(out.left);
  m.onset_r = Onset(out.right);
  m.correlation = Correlation(out.left, out.right);
  const float energy = Energy(out.left);
  for (int b = 0; b < kBandCount; ++b) {
    if (energy <= 1e-9f) {
      m.bands_db[b] = -120.0f;  // silent output has no shape to report
      continue;
    }
    const float mag = GoertzelMagnitude(out.left, sample_rate, kBandFrequencies[b]);
    m.bands_db[b] = ToDb(mag / energy);
  }
  return m;
}

}  // namespace openaxe::test
