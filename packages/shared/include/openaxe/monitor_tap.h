#pragma once

// Stereo monitor tap: the audio thread writes, the UI thread reads (#300 E4c).
//
// Feeds the facade analysers — input/output meters, the scope and the tuner's
// autocorrelation. The plugin's getTap was returning empty arrays, which is why
// the tuner and scope read flat inside a DAW.
//
// The design is lifted from apps/desktop/src/audio.cpp, where it was worked out
// and is covered by that shell's own concurrency test. NOTE: the desktop has
// NOT been migrated onto this class yet — its ring is woven into
// RtCallbackState and its tests reach into those members directly, so moving it
// is a refactor of a working audio path rather than a mechanical swap. That is
// the remaining slice of the J2 unification; until it happens the two
// implementations are deliberately identical in behaviour, and a change here
// must be mirrored there.
//
// Guarded by a seqlock, deliberately not a mutex. The audio thread is the sole
// writer and must never block on anything a non-real-time thread could hold —
// a reader's resize()/copy behind a plain mutex is exactly the kind of
// unbounded work that stalls an audio callback (issue #43). `seq` is odd while
// a write is in progress and even otherwise; the reader retries if it observes
// odd, or sees the value change across its copy. The writer never retries and
// never waits.
//
// A reader can therefore see a torn window under heavy contention. That is the
// right trade for a meter or a scope: a slightly mixed frame is invisible,
// whereas a glitch in the audio is not.

#include <array>
#include <atomic>
#include <cstdint>
#include <vector>

namespace openaxe {

// A copy of the tap window, oldest-to-newest.
struct TapFrame {
  std::vector<float> l;
  std::vector<float> r;
  unsigned int frames = 0;
};

class MonitorTap {
 public:
  // A full FFT window: the tuner's autocorrelation needs ~4096 samples at
  // 48 kHz to resolve low bass (~31 Hz needs >1500 samples per cycle).
  static constexpr unsigned int kCapacity = 4096;

  MonitorTap();

  // Audio thread. No allocation, no locking, no waiting. `in` and `out` are
  // arrays of up to 2 channel pointers; either may be null, as may individual
  // channels (a mono bus). Safe to call with frames > kCapacity — only the
  // most recent kCapacity are retained.
  void Write(const float* const* in, const float* const* out, unsigned int frames);

  // UI/control thread. Returns up to `max_frames` of the most recent input
  // (`input=true`) or output frames, oldest-to-newest.
  TapFrame Read(bool input, unsigned int max_frames) const;

  // Drops the retained window without touching the audio thread's position —
  // used when the graph is reset so a stale window is not shown as live audio.
  void Clear();

 private:
  std::atomic<uint64_t> seq_{0};
  std::array<std::vector<float>, 2> in_;
  std::array<std::vector<float>, 2> out_;
  unsigned int write_pos_ = 0;
  unsigned int count_ = 0;
};

}  // namespace openaxe
