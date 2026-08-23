#pragma once

#include <cstdint>
#include <optional>
#include <vector>

namespace nam_studio::dsp {

// Decoded audio from a WAV file: mono float samples plus the rate they were
// captured at.
struct WavAudio {
  std::vector<float> samples;  // mono, nominally -1..1
  double sample_rate = 0.0;
  int source_channels = 0;  // channel count in the file, before folding to mono
};

// Decode a WAV file held in memory into mono float samples.
//
// This exists so impulse responses can be loaded on every platform, not just in a
// browser. The web app gets decoded audio for free from
// AudioContext.decodeAudioData; the desktop app and a plugin have no such thing,
// which is why cab blocks did nothing there even after the core learned to
// convolve. Bytes in, samples out - the same shape as loading a NAM model from
// its JSON rather than from a path.
//
// Supported: RIFF/WAVE with 8/16/24/32-bit integer PCM or 32/64-bit IEEE float
// data, any channel count, including WAVE_FORMAT_EXTENSIBLE. Unknown chunks are
// skipped. Anything else - a truncated file, a compressed codec, no data chunk -
// returns nullopt rather than throwing or guessing.
//
// Multi-channel input is averaged down to mono (rather than dropping channels) as
// IR convolution here is mono; `source_channels` reports what the file held.
std::optional<WavAudio> DecodeWav(const uint8_t* bytes, size_t size);

// Resample mono audio to `target_rate` with a windowed-sinc (Lanczos) kernel.
// Returns `samples` unchanged when the rates already match or either is
// non-positive.
//
// IRs are short and loaded once, so quality is worth more than speed here: linear
// interpolation would quietly roll off the top octave of a cabinet IR, which is
// exactly the part that makes cabinets sound different from each other.
std::vector<float> ResampleMono(const std::vector<float>& samples, double source_rate,
                                double target_rate);

// Encode mono float samples as a 32-bit IEEE-float RIFF/WAVE byte buffer - the
// exact inverse of DecodeWav's float path, so DecodeWav(EncodeWavF32(s, r), ...)
// returns `samples` bit-for-bit. Exists for state serialization (#120): a cab
// block whose IR arrived as raw samples (nam_studio_load_ir) still needs WAV
// bytes to embed in a saved rig. `sample_rate` is truncated to the unsigned
// 32-bit integer the format stores; non-positive rates yield an empty buffer.
std::vector<uint8_t> EncodeWavF32(const std::vector<float>& samples, double sample_rate);

}  // namespace nam_studio::dsp
