#pragma once

#include <memory>

namespace nam_studio::dsp {

// Zero-latency FFT convolution for cabinet/room impulse responses - the DSP
// behind a Cab block.
//
// This is the one piece of the audio path that used to exist only in the web
// app (a Web Audio ConvolverNode), so cab blocks on the desktop passed audio
// through untouched. Having it here means the same convolution runs on web,
// desktop and in a plugin.
//
// Algorithm: partitioned convolution in the standard two-part form. The first
// kPartitionFrames taps run as a plain time-domain FIR; everything beyond them is
// cut into kPartitionFrames-sample partitions, transformed once at load time, and
// convolved by FFT through a frequency-domain delay line. That costs O(log N) per
// sample rather than the O(N) of a direct FIR - a 2048-tap cab IR is roughly 40x
// cheaper this way - while the direct head keeps latency at zero.
//
// Latency: always zero, for any block size, including sizes that aren't a
// multiple of kPartitionFrames. The head is why: the newest output sample depends
// on the newest input sample, which no purely block-based FFT scheme can deliver
// (it would either delay the stream or leave a gap in it).
//
// Real-time safety: Process is real-time safe. SetImpulseResponse allocates and
// transforms, so it must run off the audio thread (the engine loads IRs under
// its usual suspend handshake).
class Convolver {
 public:
  // Length of the direct-FIR head and of each FFT partition. 64 keeps the head
  // cheap (64 multiply-adds per sample) while still amortising the FFT well.
  static constexpr int kPartitionFrames = 64;

  Convolver();
  ~Convolver();
  Convolver(const Convolver&) = delete;
  Convolver& operator=(const Convolver&) = delete;

  // Install an impulse response, given as mono float samples at the graph's own
  // sample rate (no resampling happens here - a caller with a 44.1kHz IR in a
  // 48kHz graph should resample first). Passing length <= 0 or nullptr clears
  // it, which makes Process a passthrough. Not real-time safe.
  void SetImpulseResponse(const float* samples, int length);

  // True once an IR is installed.
  bool HasImpulseResponse() const;

  // Number of IR samples currently installed, 0 if none.
  int ImpulseResponseLength() const;

  // Drop the IR and clear all state.
  void Clear();

  // Clear the tail without touching the IR - used when the graph is rewired
  // underneath the block so a previous route's tail can't bleed through.
  void ResetState();

  // Convolve num_frames samples in place. Passthrough (untouched buffer) while
  // no IR is installed. Real-time safe.
  void Process(float* samples, int num_frames);

  // Samples of delay this convolver introduces. Always 0 - kept as an explicit
  // part of the interface because a host or plugin wrapper has to report its
  // latency, and "ask the DSP" is safer than hard-coding an assumption.
  int LatencyFrames() const;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace nam_studio::dsp
