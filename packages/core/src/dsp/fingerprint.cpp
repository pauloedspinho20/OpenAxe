#include "openaxe/dsp/fingerprint.h"

#include "openaxe/dsp/nam_amp.h"

#include <algorithm>
#include <cmath>
#include <complex>
#include <vector>

namespace openaxe::dsp {

namespace {

constexpr double kSampleRate = 48000.0;
constexpr int kMaxBlock = 512;
constexpr int kProbeFrames = 4096;
constexpr float kProbeAmp = 0.5f;
constexpr double kTwoPi = 6.283185307179586;

struct Complex {
  double re = 0, im = 0;
  Complex() = default;
  Complex(double r, double i) : re(r), im(i) {}
  Complex operator+(const Complex& o) const { return {re + o.re, im + o.im}; }
  Complex operator-(const Complex& o) const { return {re - o.re, im - o.im}; }
  Complex operator*(const Complex& o) const { return {re * o.re - im * o.im, re * o.im + im * o.re}; }
  Complex& operator*=(const Complex& o) {
    double nr = re * o.re - im * o.im;
    double ni = re * o.im + im * o.re;
    re = nr; im = ni; return *this;
  }
};

void Fft(std::vector<Complex>& data, bool inverse) {
  const int n = static_cast<int>(data.size());
  for (int i = 1, j = 0; i < n; i++) {
    int bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) std::swap(data[i], data[j]);
  }
  for (int len = 2; len <= n; len <<= 1) {
    double ang = kTwoPi / len * (inverse ? -1 : 1);
    Complex wlen(std::cos(ang), std::sin(ang));
    for (int i = 0; i < n; i += len) {
      Complex w(1, 0);
      for (int j = 0; j < len / 2; j++) {
        Complex u = data[i + j];
        Complex v = data[i + j + len / 2] * w;
        data[i + j] = u + v;
        data[i + j + len / 2] = u - v;
        w *= wlen;
      }
    }
  }
  if (inverse) {
    for (auto& c : data) { c.re /= n; c.im /= n; }
  }
}

}  // namespace

std::optional<Fingerprint> ComputeFingerprint(const std::string& json_text) {
  NamAmp amp;
  auto err = amp.LoadModelFromJson(json_text);
  if (err) return std::nullopt;
  amp.Reset(kSampleRate, kMaxBlock);

  std::vector<float> input(kProbeFrames);
  std::vector<float> output(kProbeFrames);
  std::vector<float> outAccum(kProbeFrames, 0.0f);

  for (int i = 0; i < kProbeFrames; i++) {
    double t = static_cast<double>(i) / kSampleRate;
    double chirp = 80.0 + (8000.0 - 80.0) * (static_cast<double>(i) / kProbeFrames);
    input[i] = kProbeAmp * static_cast<float>(std::sin(kTwoPi * chirp * t));
    if (i < 512) {
      double env = static_cast<double>(i) / 512.0;
      input[i] = static_cast<float>(input[i] * env);
    }
  }

  int processed = 0;
  while (processed < kProbeFrames) {
    int chunk = std::min(kMaxBlock, kProbeFrames - processed);
    amp.Process(input.data() + processed, output.data() + processed, chunk);
    processed += chunk;
  }

  double sumSq = 0;
  for (int i = 512; i < kProbeFrames; i++) {
    sumSq += static_cast<double>(output[i]) * output[i];
  }
  int count = kProbeFrames - 512;
  double rms = std::sqrt(sumSq / count);
  if (rms < 1e-9) rms = 1e-9;
  float gainDb = static_cast<float>(20.0 * std::log10(rms));

  int fftSize = 1;
  while (fftSize < count) fftSize <<= 1;
  std::vector<Complex> fft(fftSize);
  for (int i = 0; i < count; i++) {
    double window = 0.5 * (1.0 - std::cos(kTwoPi * i / (count - 1)));
    fft[i] = Complex(output[512 + i] * window, 0);
  }
  for (int i = count; i < fftSize; i++) fft[i] = Complex(0, 0);
  Fft(fft, false);

  double magSum = 0;
  double weightedSum = 0;
  int half = fftSize / 2;
  for (int k = 1; k < half; k++) {
    double mag = std::sqrt(fft[k].re * fft[k].re + fft[k].im * fft[k].im);
    double freq = static_cast<double>(k) * kSampleRate / fftSize;
    magSum += mag;
    weightedSum += mag * freq;
  }
  float brightness = 0.5f;
  if (magSum > 1e-9) {
    double centroid = weightedSum / magSum;
    brightness = static_cast<float>(centroid / (kSampleRate * 0.5));
    brightness = std::clamp(brightness, 0.0f, 1.0f);
  }

  const auto& info = amp.ModelInfo();
  if (info.has_loudness) {
    float loudGain = static_cast<float>(info.loudness_db);
    gainDb = gainDb * 0.7f + loudGain * 0.3f;
  }

  return Fingerprint{gainDb, brightness};
}

}  // namespace openaxe::dsp
