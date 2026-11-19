#pragma once

// Backing-track player (issue #205): a stereo audio file played alongside the
// rig, with pitch-preserving speed, transposition, A-B looping and its own
// volume. It is deliberately NOT a grid block and has no routing path into the
// rig - front ends render it after openaxe_process and add it to the same
// output buffer, so it reaches the user's selected interface on every shell
// (web worklet, desktop miniaudio callback) without a second audio path.
//
// Threading follows api.h's two tiers:
//   Tier 2 (not real-time safe, must not run concurrently with Render):
//     Reset, LoadBegin, Unload. They (re)allocate.
//   LoadWrite only touches the buffer while it is unpublished (between
//     LoadBegin and LoadEnd), so it is safe concurrently with Render.
//   Tier 1 (any thread, lock-free): everything else - the transport and
//     the controls are atomics the audio thread picks up on its next block.
//
// Audio is held as interleaved int16 (half the memory of float - a 10-minute
// stereo track is ~115 MB, which matters inside the WASM heap). The source
// sample rate may differ from the engine's: playback compensates both rate and
// pitch, so a 44.1 kHz file sounds right on a 48 kHz device.

#include <atomic>
#include <cstdint>
#include <memory>
#include <vector>

namespace openaxe::player {

inline constexpr float kMinSpeed = 0.25f;
inline constexpr float kMaxSpeed = 2.0f;
inline constexpr float kMinSemitones = -12.0f;
inline constexpr float kMaxSemitones = 12.0f;
inline constexpr float kMaxVolume = 2.0f;
// Hard cap on a loaded track (frames at its own rate): 20 minutes at 48 kHz.
inline constexpr int64_t kMaxFrames = int64_t(48000) * 60 * 20;

class Stretcher;  // pimpl around signalsmith::stretch (heavy header)

class BackingPlayer {
 public:
  BackingPlayer();
  ~BackingPlayer();
  BackingPlayer(const BackingPlayer&) = delete;
  BackingPlayer& operator=(const BackingPlayer&) = delete;

  // Tier 2. Prepares for an engine rate/block size. Keeps the loaded track
  // and the transport position.
  void Reset(double sample_rate, int max_block_size);

  // Tier 2. Stops playback and allocates `frames` x `channels` (1 or 2) at
  // `source_rate`. Returns false for out-of-range arguments.
  bool LoadBegin(int64_t frames, int channels, double source_rate);
  // Copies `count` frames of interleaved float (channels as LoadBegin) at
  // frame `offset`. Returns the number of frames written (clipped to the
  // allocation), 0 if no load is in progress.
  int64_t LoadWrite(int64_t offset, const float* interleaved, int64_t count);
  // Publishes the loaded track (position 0, loop cleared). False if no load
  // was in progress.
  bool LoadEnd();
  // Tier 2. Drops the track.
  void Unload();

  bool HasTrack() const { return ready_.load(std::memory_order_acquire); }
  int64_t LengthFrames() const { return ready_.load(std::memory_order_acquire) ? frames_ : 0; }
  double SourceRate() const { return source_rate_; }

  // ── Tier 1 transport / controls ────────────────────────────────────────
  void Play();
  void Pause();
  bool IsPlaying() const { return playing_.load(std::memory_order_relaxed); }
  // Source-frame position. Clamped to the track; flushes the stretcher.
  void Seek(int64_t frame);
  // Audible position in source frames (latency-compensated).
  int64_t Position() const { return position_.load(std::memory_order_relaxed); }

  void SetSpeed(float speed);  // clamped kMinSpeed..kMaxSpeed, pitch preserved
  float Speed() const { return speed_.load(std::memory_order_relaxed); }
  void SetSemitones(float semitones);  // clamped +-12
  float Semitones() const { return semitones_.load(std::memory_order_relaxed); }
  void SetVolume(float volume);  // linear 0..kMaxVolume
  float Volume() const { return volume_.load(std::memory_order_relaxed); }
  // A-B loop in source frames. Disabled, or end <= start, plays straight
  // through and stops at the end of the track.
  void SetLoop(int64_t start, int64_t end, bool enabled);
  bool LoopEnabled() const { return loop_enabled_.load(std::memory_order_relaxed); }
  float Meter() const { return meter_.load(std::memory_order_relaxed); }

  // Real-time safe. ADDS the track into `output` (1 or 2 channels, more are
  // left untouched beyond the first two). num_frames <= max_block_size.
  void Render(float* const* output, int output_channels, int num_frames);

 private:
  void FillInput(int count);  // reads `count` source frames into in_ from read_pos_
  void Prime(int64_t frame, double rate);
  float Sample(int64_t frame, int channel) const;

  std::vector<int16_t> pcm_;
  int64_t frames_ = 0;
  int channels_ = 2;
  double source_rate_ = 48000.0;
  std::atomic<bool> ready_{false};
  bool loading_ = false;

  double sample_rate_ = 48000.0;
  int max_block_ = 0;
  std::unique_ptr<Stretcher> stretch_;
  std::vector<float> in_[2];
  std::vector<float> out_[2];

  // Controls (written anywhere, read by Render).
  std::atomic<bool> playing_{false};
  std::atomic<float> speed_{1.0f};
  std::atomic<float> semitones_{0.0f};
  std::atomic<float> volume_{1.0f};
  std::atomic<int64_t> loop_start_{0};
  std::atomic<int64_t> loop_end_{0};
  std::atomic<bool> loop_enabled_{false};
  std::atomic<int64_t> seek_request_{-1};

  // Audio-thread state.
  double read_pos_ = 0.0;      // next source frame fed to the stretcher
  double in_accum_ = 0.0;      // fractional input carry
  bool stretching_ = false;    // currently routed through the stretcher
  float applied_semitones_ = 0.0f;
  double applied_factor_ = 1.0;
  double latency_frames_ = 0.0;  // source frames between read_pos_ and audible output
  int64_t tail_left_ = 0;      // output frames to flush after the end of the track
  float gain_ = 0.0f;          // smoothed output gain (fades play/pause)
  std::atomic<int64_t> position_{0};
  std::atomic<float> meter_{0.0f};
};

}  // namespace openaxe::player
