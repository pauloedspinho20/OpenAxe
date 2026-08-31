// The WAV decoder and resampler behind IR loading on the platforms that have no
// AudioContext.decodeAudioData to lean on (dsp/wav.cpp). Files are built in
// memory here so the cases are explicit - including the malformed ones, which
// matter most: this parses whatever a user drags in.
#include "openaxe/dsp/wav.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::DecodeWav;
using openaxe::dsp::EncodeWavF32;
using openaxe::dsp::ResampleMono;

namespace {

void PushU16(std::vector<uint8_t>& out, uint16_t value) {
  out.push_back(static_cast<uint8_t>(value & 0xFF));
  out.push_back(static_cast<uint8_t>((value >> 8) & 0xFF));
}

void PushU32(std::vector<uint8_t>& out, uint32_t value) {
  for (int i = 0; i < 4; ++i) out.push_back(static_cast<uint8_t>((value >> (8 * i)) & 0xFF));
}

void PushTag(std::vector<uint8_t>& out, const char* tag) {
  out.insert(out.end(), tag, tag + 4);
}

/** Assemble a WAV file around an already-encoded data payload. */
std::vector<uint8_t> BuildWav(uint16_t format, uint16_t channels, uint32_t sample_rate,
                              uint16_t bits, const std::vector<uint8_t>& data,
                              bool extra_chunk = false) {
  std::vector<uint8_t> fmt;
  PushU16(fmt, format);
  PushU16(fmt, channels);
  PushU32(fmt, sample_rate);
  PushU32(fmt, sample_rate * channels * (bits / 8u));  // byte rate
  PushU16(fmt, static_cast<uint16_t>(channels * (bits / 8u)));
  PushU16(fmt, bits);

  std::vector<uint8_t> out;
  PushTag(out, "RIFF");
  PushU32(out, 0);  // patched below
  PushTag(out, "WAVE");
  if (extra_chunk) {
    // An unknown chunk with an odd size, to prove chunk walking skips it and
    // honours the pad byte.
    PushTag(out, "LIST");
    PushU32(out, 3);
    out.insert(out.end(), {'a', 'b', 'c', 0});
  }
  PushTag(out, "fmt ");
  PushU32(out, static_cast<uint32_t>(fmt.size()));
  out.insert(out.end(), fmt.begin(), fmt.end());
  PushTag(out, "data");
  PushU32(out, static_cast<uint32_t>(data.size()));
  out.insert(out.end(), data.begin(), data.end());

  const uint32_t riff_size = static_cast<uint32_t>(out.size() - 8);
  out[4] = static_cast<uint8_t>(riff_size & 0xFF);
  out[5] = static_cast<uint8_t>((riff_size >> 8) & 0xFF);
  out[6] = static_cast<uint8_t>((riff_size >> 16) & 0xFF);
  out[7] = static_cast<uint8_t>((riff_size >> 24) & 0xFF);
  return out;
}

// 16-bit is what almost every IR ships as.
void TestPcm16Mono() {
  std::vector<uint8_t> data;
  const std::vector<int16_t> values = {0, 16384, -16384, 32767, -32768};
  for (int16_t v : values) PushU16(data, static_cast<uint16_t>(v));

  const auto wav = BuildWav(1, 1, 48000, 16, data);
  const auto decoded = DecodeWav(wav.data(), wav.size());
  OPENAXE_EXPECT(decoded.has_value());
  OPENAXE_EXPECT(decoded->sample_rate == 48000.0);
  OPENAXE_EXPECT(decoded->source_channels == 1);
  OPENAXE_EXPECT(decoded->samples.size() == values.size());
  OPENAXE_EXPECT(std::fabs(decoded->samples[0]) < 1e-6f);
  OPENAXE_EXPECT(std::fabs(decoded->samples[1] - 0.5f) < 1e-4f);
  OPENAXE_EXPECT(std::fabs(decoded->samples[2] + 0.5f) < 1e-4f);
  OPENAXE_EXPECT(std::fabs(decoded->samples[3] - 1.0f) < 1e-4f);
  OPENAXE_EXPECT(std::fabs(decoded->samples[4] + 1.0f) < 1e-4f);
}

// Stereo folds to mono by averaging - a channel must not be dropped, or a
// mid/side-captured IR would lose its centre.
void TestStereoFoldsToMonoByAveraging() {
  std::vector<uint8_t> data;
  PushU16(data, static_cast<uint16_t>(static_cast<int16_t>(16384)));   // L +0.5
  PushU16(data, static_cast<uint16_t>(static_cast<int16_t>(-16384)));  // R -0.5
  PushU16(data, static_cast<uint16_t>(static_cast<int16_t>(16384)));   // L +0.5
  PushU16(data, static_cast<uint16_t>(static_cast<int16_t>(16384)));   // R +0.5

  const auto wav = BuildWav(1, 2, 44100, 16, data);
  const auto decoded = DecodeWav(wav.data(), wav.size());
  OPENAXE_EXPECT(decoded.has_value());
  OPENAXE_EXPECT(decoded->source_channels == 2);
  OPENAXE_EXPECT(decoded->samples.size() == 2);
  OPENAXE_EXPECT(std::fabs(decoded->samples[0]) < 1e-4f);         // +0.5 and -0.5 cancel
  OPENAXE_EXPECT(std::fabs(decoded->samples[1] - 0.5f) < 1e-4f);  // both +0.5
}

// 24-bit needs sign extension, which is the easiest thing to get wrong.
void TestPcm24SignExtension() {
  std::vector<uint8_t> data;
  const auto push24 = [&](int32_t value) {
    data.push_back(static_cast<uint8_t>(value & 0xFF));
    data.push_back(static_cast<uint8_t>((value >> 8) & 0xFF));
    data.push_back(static_cast<uint8_t>((value >> 16) & 0xFF));
  };
  push24(4194304);   // +0.5
  push24(-4194304);  // -0.5 (0xC00000 - must sign-extend, not read as +12582912)

  const auto wav = BuildWav(1, 1, 48000, 24, data);
  const auto decoded = DecodeWav(wav.data(), wav.size());
  OPENAXE_EXPECT(decoded.has_value());
  OPENAXE_EXPECT(std::fabs(decoded->samples[0] - 0.5f) < 1e-4f);
  OPENAXE_EXPECT(std::fabs(decoded->samples[1] + 0.5f) < 1e-4f);
}

// 8-bit PCM is unsigned with a 128 offset, unlike every wider integer form.
void TestPcm8IsUnsigned() {
  const std::vector<uint8_t> data = {128, 255, 0, 192};
  const auto wav = BuildWav(1, 1, 22050, 8, data);
  const auto decoded = DecodeWav(wav.data(), wav.size());
  OPENAXE_EXPECT(decoded.has_value());
  OPENAXE_EXPECT(std::fabs(decoded->samples[0]) < 1e-6f);          // 128 -> 0
  OPENAXE_EXPECT(decoded->samples[1] > 0.9f);
  OPENAXE_EXPECT(std::fabs(decoded->samples[2] + 1.0f) < 1e-6f);   // 0 -> -1
  OPENAXE_EXPECT(std::fabs(decoded->samples[3] - 0.5f) < 1e-2f);
}

// Float WAVs are common for IRs exported from DAWs.
void TestFloat32AndFloat64() {
  {
    std::vector<uint8_t> data(8);
    const float values[2] = {0.25f, -0.75f};
    std::memcpy(data.data(), values, sizeof(values));
    const auto wav = BuildWav(3, 1, 96000, 32, data);
    const auto decoded = DecodeWav(wav.data(), wav.size());
    OPENAXE_EXPECT(decoded.has_value());
    OPENAXE_EXPECT(decoded->sample_rate == 96000.0);
    OPENAXE_EXPECT(std::fabs(decoded->samples[0] - 0.25f) < 1e-6f);
    OPENAXE_EXPECT(std::fabs(decoded->samples[1] + 0.75f) < 1e-6f);
  }
  {
    std::vector<uint8_t> data(16);
    const double values[2] = {0.125, -1.0};
    std::memcpy(data.data(), values, sizeof(values));
    const auto wav = BuildWav(3, 1, 48000, 64, data);
    const auto decoded = DecodeWav(wav.data(), wav.size());
    OPENAXE_EXPECT(decoded.has_value());
    OPENAXE_EXPECT(std::fabs(decoded->samples[0] - 0.125f) < 1e-6f);
    OPENAXE_EXPECT(std::fabs(decoded->samples[1] + 1.0f) < 1e-6f);
  }
}

// WAVE_FORMAT_EXTENSIBLE hides the real format in a GUID; plenty of tools emit it.
void TestExtensibleFormat() {
  std::vector<uint8_t> fmt;
  PushU16(fmt, 0xFFFE);
  PushU16(fmt, 1);
  PushU32(fmt, 48000);
  PushU32(fmt, 48000 * 2);
  PushU16(fmt, 2);
  PushU16(fmt, 16);
  PushU16(fmt, 22);  // extension size
  PushU16(fmt, 16);  // valid bits
  PushU32(fmt, 0);   // channel mask
  PushU16(fmt, 1);   // SubFormat GUID: PCM
  for (int i = 0; i < 14; ++i) fmt.push_back(0);

  std::vector<uint8_t> data;
  PushU16(data, static_cast<uint16_t>(static_cast<int16_t>(16384)));

  std::vector<uint8_t> out;
  PushTag(out, "RIFF");
  PushU32(out, 0);
  PushTag(out, "WAVE");
  PushTag(out, "fmt ");
  PushU32(out, static_cast<uint32_t>(fmt.size()));
  out.insert(out.end(), fmt.begin(), fmt.end());
  PushTag(out, "data");
  PushU32(out, static_cast<uint32_t>(data.size()));
  out.insert(out.end(), data.begin(), data.end());

  const auto decoded = DecodeWav(out.data(), out.size());
  OPENAXE_EXPECT(decoded.has_value());
  OPENAXE_EXPECT(std::fabs(decoded->samples[0] - 0.5f) < 1e-4f);
}

// Unknown chunks before `fmt `/`data`, with odd sizes and their pad byte.
void TestSkipsUnknownChunks() {
  std::vector<uint8_t> data;
  PushU16(data, static_cast<uint16_t>(static_cast<int16_t>(32767)));
  const auto wav = BuildWav(1, 1, 48000, 16, data, /*extra_chunk=*/true);
  const auto decoded = DecodeWav(wav.data(), wav.size());
  OPENAXE_EXPECT(decoded.has_value());
  OPENAXE_EXPECT(decoded->samples.size() == 1);
  OPENAXE_EXPECT(std::fabs(decoded->samples[0] - 1.0f) < 1e-4f);
}

// Everything that isn't a WAV we can actually decode must return nullopt rather
// than throwing, guessing, or reading past the buffer.
void TestRejectsMalformedInput() {
  OPENAXE_EXPECT(!DecodeWav(nullptr, 100).has_value());
  const std::vector<uint8_t> tiny = {'R', 'I', 'F', 'F'};
  OPENAXE_EXPECT(!DecodeWav(tiny.data(), tiny.size()).has_value());

  std::vector<uint8_t> not_wave(64, 0);
  std::memcpy(not_wave.data(), "RIFF", 4);
  std::memcpy(not_wave.data() + 8, "AVI ", 4);
  OPENAXE_EXPECT(!DecodeWav(not_wave.data(), not_wave.size()).has_value());

  std::vector<uint8_t> data;
  PushU16(data, 0);
  // A compressed codec (0x0011 = IMA ADPCM) is well-formed but unsupported.
  const auto adpcm = BuildWav(0x0011, 1, 48000, 4, data);
  OPENAXE_EXPECT(!DecodeWav(adpcm.data(), adpcm.size()).has_value());

  // No data chunk at all.
  const auto empty = BuildWav(1, 1, 48000, 16, {});
  OPENAXE_EXPECT(!DecodeWav(empty.data(), empty.size()).has_value());

  // A header claiming far more data than the file contains: decode what is
  // really there instead of running off the end.
  auto truncated = BuildWav(1, 1, 48000, 16, std::vector<uint8_t>(8, 0));
  truncated[truncated.size() - 12] = 0xFF;  // inflate the data chunk size
  truncated[truncated.size() - 11] = 0xFF;
  const auto decoded = DecodeWav(truncated.data(), truncated.size());
  if (decoded.has_value()) OPENAXE_EXPECT(decoded->samples.size() <= 8);
}

// Resampling: the length scales, a constant stays constant, and a sine keeps its
// frequency (which is what a naive nearest-neighbour or off-by-one kernel breaks).
void TestResampleMono() {
  std::vector<float> constant(1000, 0.5f);
  const auto up = ResampleMono(constant, 44100.0, 48000.0);
  OPENAXE_EXPECT(up.size() == static_cast<size_t>(std::llround(1000.0 * 48000.0 / 44100.0)));
  for (size_t i = 20; i + 20 < up.size(); ++i) OPENAXE_EXPECT(std::fabs(up[i] - 0.5f) < 1e-3f);

  // Matching rates are a no-op, not a rebuild.
  const auto same = ResampleMono(constant, 48000.0, 48000.0);
  OPENAXE_EXPECT(same.size() == constant.size());

  // A 1kHz sine at 44.1k, resampled to 48k, must still be 1kHz: compare against
  // an ideal 1kHz sine at the new rate over the middle of the buffer.
  std::vector<float> sine(4410);
  for (size_t i = 0; i < sine.size(); ++i) {
    sine[i] = static_cast<float>(std::sin(6.283185307179586 * 1000.0 * static_cast<double>(i) / 44100.0));
  }
  const auto resampled = ResampleMono(sine, 44100.0, 48000.0);
  double worst = 0.0;
  for (size_t i = 200; i + 200 < resampled.size(); ++i) {
    const double expected = std::sin(6.283185307179586 * 1000.0 * static_cast<double>(i) / 48000.0);
    worst = std::max(worst, std::fabs(static_cast<double>(resampled[i]) - expected));
  }
  OPENAXE_EXPECT(worst < 0.02);

  // Downsampling shortens the buffer and stays finite (no aliasing blow-up).
  const auto down = ResampleMono(sine, 48000.0, 24000.0);
  OPENAXE_EXPECT(down.size() == sine.size() / 2);
  for (float sample : down) OPENAXE_EXPECT(std::isfinite(sample));

  // Degenerate arguments.
  OPENAXE_EXPECT(ResampleMono({}, 44100.0, 48000.0).empty());
  OPENAXE_EXPECT(ResampleMono(constant, 0.0, 48000.0).size() == constant.size());
}

// EncodeWavF32 is DecodeWav's float path in reverse (issue #120's cab-IR
// embedding needs it): whatever goes in must come back bit-for-bit, and the
// container itself has to be a valid RIFF/WAVE.
void TestEncodeWavF32RoundTrip() {
  std::vector<float> samples;
  samples.reserve(257);
  for (int i = 0; i < 257; ++i) {
    const float v = static_cast<float>(i) / 257.0f;
    samples.push_back(i % 3 == 0 ? -v : v);
  }
  samples[10] = 1.0f;
  samples[11] = -1.0f;

  const auto encoded = EncodeWavF32(samples, 48000.0);
  OPENAXE_EXPECT(encoded.size() == 44 + samples.size() * sizeof(float));
  OPENAXE_EXPECT(std::memcmp(encoded.data(), "RIFF", 4) == 0);
  OPENAXE_EXPECT(std::memcmp(encoded.data() + 8, "WAVE", 4) == 0);

  const auto decoded = DecodeWav(encoded.data(), encoded.size());
  OPENAXE_EXPECT(decoded.has_value());
  if (!decoded.has_value()) return;
  OPENAXE_EXPECT(decoded->sample_rate == 48000.0);
  OPENAXE_EXPECT(decoded->source_channels == 1);
  OPENAXE_EXPECT(decoded->samples.size() == samples.size());
  for (size_t i = 0; i < samples.size(); ++i) {
    // Bit-exact: these are raw float32 payload bytes, not a lossy codec.
    if (decoded->samples[i] != samples[i]) {
      std::fprintf(stderr, "  (round-trip mismatch at sample %zu)\n", i);
      OPENAXE_EXPECT(false);
      break;
    }
  }

  // Degenerate arguments yield an empty buffer rather than a malformed file.
  OPENAXE_EXPECT(EncodeWavF32({}, 48000.0).empty());
  OPENAXE_EXPECT(EncodeWavF32(samples, 0.0).empty());
  OPENAXE_EXPECT(EncodeWavF32(samples, -100.0).empty());
}

}  // namespace

int main() {
  TestPcm16Mono();
  TestStereoFoldsToMonoByAveraging();
  TestPcm24SignExtension();
  TestPcm8IsUnsigned();
  TestFloat32AndFloat64();
  TestExtensibleFormat();
  TestSkipsUnknownChunks();
  TestRejectsMalformedInput();
  TestResampleMono();
  TestEncodeWavF32RoundTrip();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}
