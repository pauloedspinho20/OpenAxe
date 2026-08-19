#include "nam_studio/dsp/wav.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace nam_studio::dsp {

namespace {

// Little-endian readers. WAV is little-endian regardless of host, and reading
// byte by byte avoids both alignment assumptions and any host-endianness
// dependency.
uint16_t ReadU16(const uint8_t* p) {
  return static_cast<uint16_t>(p[0] | (p[1] << 8));
}

uint32_t ReadU32(const uint8_t* p) {
  return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
         (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}

// WAVE format tags. EXTENSIBLE defers the real format to a GUID in the fmt
// chunk's extension, whose first two bytes are the tag it stands in for.
constexpr uint16_t kFormatPcm = 0x0001;
constexpr uint16_t kFormatFloat = 0x0003;
constexpr uint16_t kFormatExtensible = 0xFFFE;

// One sample, normalised to roughly -1..1. 8-bit PCM is unsigned with a 128
// offset (the format's own quirk); the wider integer forms are signed
// two's-complement.
float SampleAt(const uint8_t* p, uint16_t bits, uint16_t format) {
  if (format == kFormatFloat) {
    if (bits == 32) {
      float value = 0.0f;
      std::memcpy(&value, p, sizeof(value));
      return value;
    }
    double value = 0.0;
    std::memcpy(&value, p, sizeof(value));
    return static_cast<float>(value);
  }
  switch (bits) {
    case 8:
      return (static_cast<float>(p[0]) - 128.0f) / 128.0f;
    case 16:
      return static_cast<float>(static_cast<int16_t>(ReadU16(p))) / 32768.0f;
    case 24: {
      // Sign-extend the 24-bit value into an int32.
      int32_t value = static_cast<int32_t>(static_cast<uint32_t>(p[0]) |
                                           (static_cast<uint32_t>(p[1]) << 8) |
                                           (static_cast<uint32_t>(p[2]) << 16));
      if (value & 0x800000) value |= static_cast<int32_t>(0xFF000000u);
      return static_cast<float>(value) / 8388608.0f;
    }
    case 32:
      return static_cast<float>(static_cast<int32_t>(ReadU32(p))) / 2147483648.0f;
    default:
      return 0.0f;
  }
}

// Lanczos window half-width. 8 taps either side is well past the point where a
// cabinet IR's own bandwidth dominates the error, and this runs once per load.
constexpr int kLanczosA = 8;

float Lanczos(double x) {
  if (x == 0.0) return 1.0f;
  if (std::fabs(x) >= kLanczosA) return 0.0f;
  const double pi_x = 3.14159265358979323846 * x;
  const double a = static_cast<double>(kLanczosA);
  return static_cast<float>((std::sin(pi_x) / pi_x) * (std::sin(pi_x / a) / (pi_x / a)));
}

}  // namespace

// Walk the RIFF chunk list, pull `fmt ` and `data`, and decode. Every read is
// bounds-checked against `size` - this parses whatever a user drags in, so a
// truncated or hostile file has to fail cleanly rather than read past the buffer.
std::optional<WavAudio> DecodeWav(const uint8_t* bytes, size_t size) {
  if (!bytes || size < 12) return std::nullopt;
  if (std::memcmp(bytes, "RIFF", 4) != 0 || std::memcmp(bytes + 8, "WAVE", 4) != 0) {
    return std::nullopt;
  }

  uint16_t format = 0;
  uint16_t channels = 0;
  uint16_t bits = 0;
  uint32_t sample_rate = 0;
  const uint8_t* data = nullptr;
  size_t data_size = 0;

  size_t offset = 12;
  while (offset + 8 <= size) {
    const uint8_t* id = bytes + offset;
    const uint32_t chunk_size = ReadU32(bytes + offset + 4);
    const size_t body = offset + 8;
    if (body + chunk_size > size) {
      // A truncated final chunk: usable only if it is the data we were after and
      // we simply take what is actually present.
      if (std::memcmp(id, "data", 4) == 0 && body < size) {
        data = bytes + body;
        data_size = size - body;
      }
      break;
    }

    if (std::memcmp(id, "fmt ", 4) == 0 && chunk_size >= 16) {
      format = ReadU16(bytes + body);
      channels = ReadU16(bytes + body + 2);
      sample_rate = ReadU32(bytes + body + 4);
      bits = ReadU16(bytes + body + 14);
      if (format == kFormatExtensible && chunk_size >= 40) {
        // The real format is the first two bytes of the SubFormat GUID.
        format = ReadU16(bytes + body + 24);
      }
    } else if (std::memcmp(id, "data", 4) == 0) {
      data = bytes + body;
      data_size = chunk_size;
    }

    // Chunks are word-aligned: an odd size is followed by a pad byte.
    offset = body + chunk_size + (chunk_size & 1);
  }

  if (!data || data_size == 0 || channels == 0 || sample_rate == 0) return std::nullopt;
  if (format != kFormatPcm && format != kFormatFloat) return std::nullopt;
  if (format == kFormatPcm && bits != 8 && bits != 16 && bits != 24 && bits != 32) {
    return std::nullopt;
  }
  if (format == kFormatFloat && bits != 32 && bits != 64) return std::nullopt;

  const size_t bytes_per_sample = bits / 8u;
  const size_t frame_bytes = bytes_per_sample * channels;
  if (frame_bytes == 0) return std::nullopt;
  const size_t frames = data_size / frame_bytes;
  if (frames == 0) return std::nullopt;

  WavAudio out;
  out.sample_rate = static_cast<double>(sample_rate);
  out.source_channels = channels;
  out.samples.resize(frames);
  const float scale = 1.0f / static_cast<float>(channels);
  for (size_t frame = 0; frame < frames; ++frame) {
    float sum = 0.0f;
    for (uint16_t channel = 0; channel < channels; ++channel) {
      sum += SampleAt(data + frame * frame_bytes + channel * bytes_per_sample, bits, format);
    }
    out.samples[frame] = sum * scale;
  }
  return out;
}

// Windowed-sinc resampling. For each output position, sum the input samples
// within the kernel's half-width, weighted by the Lanczos window, and normalise
// by the weight actually used so the edges of the buffer don't sag.
std::vector<float> ResampleMono(const std::vector<float>& samples, double source_rate,
                                double target_rate) {
  if (samples.empty() || source_rate <= 0.0 || target_rate <= 0.0 || source_rate == target_rate) {
    return samples;
  }

  const double ratio = target_rate / source_rate;
  const size_t out_length = static_cast<size_t>(std::llround(static_cast<double>(samples.size()) * ratio));
  if (out_length == 0) return {};

  // Downsampling needs the kernel stretched in input samples, otherwise it
  // samples above the new Nyquist and aliases.
  const double step = ratio < 1.0 ? 1.0 / ratio : 1.0;

  std::vector<float> out(out_length, 0.0f);
  const auto input_size = static_cast<int64_t>(samples.size());
  for (size_t i = 0; i < out_length; ++i) {
    const double centre = static_cast<double>(i) / ratio;
    const int64_t first = static_cast<int64_t>(std::floor(centre - kLanczosA * step)) + 1;
    const int64_t last = static_cast<int64_t>(std::floor(centre + kLanczosA * step));
    float sum = 0.0f;
    float weight_sum = 0.0f;
    for (int64_t n = first; n <= last; ++n) {
      if (n < 0 || n >= input_size) continue;
      const float weight = Lanczos((static_cast<double>(n) - centre) / step);
      sum += weight * samples[static_cast<size_t>(n)];
      weight_sum += weight;
    }
    out[i] = weight_sum != 0.0f ? sum / weight_sum : 0.0f;
  }
  return out;
}

}  // namespace nam_studio::dsp
