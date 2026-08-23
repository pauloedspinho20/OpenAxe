#include "openaxe/dsp/pitch_detect.h"

#include <cmath>
#include <cstdint>

namespace openaxe::dsp {

namespace {

constexpr float kRmsGate = 0.01f;
constexpr float kMinClarity = 0.9f;

// Normalized cross-correlation between buffer[0..size-lag) and
// buffer[lag..size) — Pearson-style coefficient in [-1, 1] regardless of
// lag, matching pitchDetect.ts's correlationAt.
inline double CorrelationAt(const float* buffer, int32_t size, int32_t lag) {
  const int32_t count = size - lag;
  double sum = 0.0;
  double energy_a = 0.0;
  double energy_b = 0.0;
  for (int32_t i = 0; i < count; ++i) {
    const double a = static_cast<double>(buffer[i]);
    const double b = static_cast<double>(buffer[i + lag]);
    sum += a * b;
    energy_a += a * a;
    energy_b += b * b;
  }
  const double denom = std::sqrt(energy_a * energy_b);
  return denom > 0.0 ? sum / denom : 0.0;
}

}  // namespace

std::optional<PitchResult> DetectPitch(const float* samples, int32_t count,
                                       double sample_rate,
                                       float min_frequency,
                                       float max_frequency) {
  if (!samples || count <= 0 || sample_rate <= 0.0 || min_frequency <= 0.0 ||
      max_frequency <= 0.0 || min_frequency >= max_frequency) {
    return std::nullopt;
  }

  const int32_t size = count;

  double sum_squares = 0.0;
  for (int32_t i = 0; i < size; ++i) {
    const double v = static_cast<double>(samples[i]);
    sum_squares += v * v;
  }
  const double rms = std::sqrt(sum_squares / static_cast<double>(size));
  if (rms < static_cast<double>(kRmsGate)) return std::nullopt;

  int32_t min_lag = static_cast<int32_t>(std::floor(sample_rate / static_cast<double>(max_frequency)));
  if (min_lag < 1) min_lag = 1;
  int32_t max_lag = static_cast<int32_t>(std::ceil(sample_rate / static_cast<double>(min_frequency)));
  const int32_t cap = size - 2;
  if (max_lag > cap) max_lag = cap;
  if (max_lag <= min_lag) return std::nullopt;

  // Walk past the initial decline into its first trough before tracking
  // peaks — exactly like the TS implementation — so the first strong peak
  // corresponds to the true fundamental.
  int32_t lag = min_lag;
  while (lag < max_lag &&
         CorrelationAt(samples, size, lag) > CorrelationAt(samples, size, lag + 1)) {
    ++lag;
  }

  int32_t best_lag = -1;
  double best_clarity = -1.0;
  for (; lag <= max_lag; ++lag) {
    const double clarity = CorrelationAt(samples, size, lag);
    if (clarity > best_clarity) {
      best_clarity = clarity;
      best_lag = lag;
    } else if (best_clarity >= static_cast<double>(kMinClarity)) {
      // Clarity just started dropping after clearing the threshold — found
      // the first strong peak past the trough.
      break;
    }
  }
  if (best_lag < 0 || best_clarity < static_cast<double>(kMinClarity)) return std::nullopt;

  const double prev = best_lag > min_lag
                          ? CorrelationAt(samples, size, best_lag - 1)
                          : best_clarity;
  const double next = best_lag < max_lag
                          ? CorrelationAt(samples, size, best_lag + 1)
                          : best_clarity;
  const double denom = 2.0 * (2.0 * best_clarity - prev - next);
  const double refined_lag =
      denom != 0.0 ? static_cast<double>(best_lag) + (next - prev) / denom
                   : static_cast<double>(best_lag);

  if (refined_lag <= 0.0) return std::nullopt;

  PitchResult result;
  result.frequency = static_cast<float>(sample_rate / refined_lag);
  result.clarity = static_cast<float>(best_clarity);
  return result;
}

}  // namespace openaxe::dsp
