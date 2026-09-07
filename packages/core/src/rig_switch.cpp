// Gapless A/B rig switching (issue #367) - see include/openaxe/rig_switch.h.
//
// Ownership discipline (the whole design rests on this): AudioEngine objects
// are NEVER deleted while their OpenAxeGraph lives. Retired engines park in
// the freelist for reuse as future staged engines; only graph destruction
// (Tier-2 context, no Process() in flight - the pre-existing destroy
// contract) deletes them. Tier-1 callers therefore resolve the live engine
// through an atomic raw pointer that is always dereferenceable - no hazard
// window, no UAF, even for a caller preempted mid-call on another thread.

#include "openaxe/rig_switch.h"

#include <algorithm>
#include <cmath>
#include <utility>
#include <vector>

#include "Effects/Crossfade.h"

namespace openaxe::switcher {
namespace {

constexpr int kMaxFadeMs = 500;
constexpr int kMaxDrainMs = 5000;
// Tail-drain mix-in ramp: the old engine's input has already been silent for
// the whole fade, so only its wet tail remains - a ~1.3 ms ramp back in is
// inaudible and keeps the mix continuous (no 0->1 coefficient step).
constexpr int kDrainRampInSamples = 64;
// Retired-engine freelist capacity. Reclaim() runs on every Commit, and a
// commit is rejected while a switch is in flight, so at most one retired
// engine can ever be waiting - this is headroom, not a limit the steady
// state approaches. Anything beyond it is leaked deliberately (counted in
// retired_dropped_) rather than freed where another thread might still hold
// the pointer - see the file comment.
constexpr int kFreeListCap = 4;

}  // namespace

struct RigSwitch::Impl {
  // The current live engine. Owned here; the process thread rotates it at
  // commit pickup, the control thread reads it for session-state carryover.
  // Process() never touches automation_slots_/midi_mappings_, so that read
  // is safe concurrently (see AudioEngine::ImportSessionStateFrom).
  std::unique_ptr<engine::AudioEngine> live_;
  // Control/webview thread view of the live engine for Tier-1 routing.
  // Published by the process thread at pickup (release); loaded with
  // acquire. Always dereferenceable per the file comment.
  std::atomic<engine::AudioEngine*> current_{nullptr};
  // Staged engine awaiting pickup. Single producer (Commit, control) /
  // single consumer (Process): release-store / acquire-exchange.
  std::atomic<engine::AudioEngine*> pending_{nullptr};
  // True from pickup until the drain retires. Set/cleared by the process
  // thread; Commit's busy-guard loads it with acquire.
  std::atomic<bool> active_{false};

  // Retiring engine, draining its tails. Process-owned from pickup until it
  // is released into the garbage ring - never touched by the control thread
  // while active_ is set.
  std::unique_ptr<engine::AudioEngine> old_;
  int fade_total_ = 0;
  int fade_pos_ = 0;
  int drain_total_ = 0;
  int drain_pos_ = 0;
  int drain_out_len_ = 0;

  // Commit-allocated (control thread), process-read/write, never reallocated
  // while a switch is in flight (Commit is rejected while active_).
  std::vector<float> in_l_;
  std::vector<float> in_r_;
  std::vector<float> old_l_;
  std::vector<float> old_r_;
  std::vector<float> positions_;
  std::vector<float> zeros_;
  int scratch_frames_ = 0;

  dspark::Crossfade<float> xfade_l_;
  dspark::Crossfade<float> xfade_r_;

  // Retired engines, process -> control. Fixed-size SPSC ring; the control
  // thread moves them into freelist_ in Reclaim(). Engines are never freed
  // here, only parked - see the file comment.
  static constexpr int kGarbageSlots = 8;
  std::atomic<engine::AudioEngine*> garbage_[kGarbageSlots];
  std::atomic<int> garbage_head_{0};  // producer (process)
  std::atomic<int> garbage_tail_{0};  // consumer (control)
  std::atomic<int> retired_dropped_{0};

  std::vector<std::unique_ptr<engine::AudioEngine>> freelist_;  // control thread only

  Impl() {
    for (auto& slot : garbage_) slot.store(nullptr, std::memory_order_relaxed);
    live_ = std::make_unique<engine::AudioEngine>();
    current_.store(live_.get(), std::memory_order_relaxed);
    xfade_l_.setCurve(dspark::Crossfade<float>::Curve::EqualPower);
    xfade_r_.setCurve(dspark::Crossfade<float>::Curve::EqualPower);
  }

  void PushGarbage(engine::AudioEngine* engine) {
    if (engine == nullptr) return;
    const int head = garbage_head_.load(std::memory_order_relaxed);
    const int tail = garbage_tail_.load(std::memory_order_acquire);
    if ((head + 1) % kGarbageSlots == tail) {
      // Ring full: leak (counted) rather than free on the audio thread.
      // Unreachable in practice - Reclaim() runs on every Commit and a
      // commit is rejected while a switch is in flight, so at most one
      // engine can be waiting. See the file comment.
      retired_dropped_.fetch_add(1, std::memory_order_relaxed);
      return;
    }
    garbage_[head].store(engine, std::memory_order_release);
    garbage_head_.store((head + 1) % kGarbageSlots, std::memory_order_release);
  }

  // Control thread only. Moves parked engines into the freelist for reuse.
  void ReclaimInternal() {
    int tail = garbage_tail_.load(std::memory_order_relaxed);
    for (;;) {
      const int head = garbage_head_.load(std::memory_order_acquire);
      if (tail == head) break;
      engine::AudioEngine* engine = garbage_[tail].exchange(nullptr, std::memory_order_acq_rel);
      tail = (tail + 1) % kGarbageSlots;
      garbage_tail_.store(tail, std::memory_order_release);
      if (engine == nullptr) continue;
      if (static_cast<int>(freelist_.size()) < kFreeListCap) {
        freelist_.push_back(std::unique_ptr<engine::AudioEngine>(engine));
      } else {
        // Deliberate leak, same reasoning as the full ring above.
        retired_dropped_.fetch_add(1, std::memory_order_relaxed);
      }
    }
  }

  void BeginSwitch(engine::AudioEngine* staged) {
    if (old_ != nullptr) PushGarbage(old_.release());  // defensive; the busy-guard makes this unreachable
    old_ = std::move(live_);
    live_.reset(staged);
    current_.store(staged, std::memory_order_release);
    fade_pos_ = 0;
    drain_pos_ = 0;
    active_.store(true, std::memory_order_release);
  }

  void RetireOld() {
    PushGarbage(old_.release());
    active_.store(false, std::memory_order_release);
  }

  // Tail-drain mix coefficient for one sample: quick ramp-in from the
  // post-fade state, hold, then a short fade-out so retirement is a glide
  // to silence rather than a cut - even a long delay tail ends click-free
  // (slightly gated at the very end, inaudible that far down).
  float DrainEnvelope(int pos) const {
    float env = 1.0f;
    if (pos < kDrainRampInSamples) {
      env = static_cast<float>(pos + 1) / static_cast<float>(kDrainRampInSamples);
    }
    if (drain_out_len_ > 0) {
      const int tail_start = drain_total_ - drain_out_len_;
      if (pos >= tail_start) {
        env = std::min(env, static_cast<float>(drain_total_ - pos) /
                                static_cast<float>(drain_out_len_));
      }
    }
    return std::clamp(env, 0.0f, 1.0f);
  }
};

RigSwitch::RigSwitch() : impl_(std::make_unique<Impl>()) {}
RigSwitch::~RigSwitch() = default;

bool RigSwitch::Commit(std::unique_ptr<engine::AudioEngine>& staged, double sample_rate,
                       int max_block_size, int fade_ms, int drain_ms) {
  Impl& s = *impl_;
  if (!staged || !s.live_ || sample_rate <= 0.0 || max_block_size <= 0) return false;
  if (s.pending_.load(std::memory_order_acquire) != nullptr) return false;  // previous commit unpicked
  if (s.active_.load(std::memory_order_acquire)) return false;              // fade/drain in flight
  s.ReclaimInternal();

  staged->ImportSessionStateFrom(*s.live_);

  const int fade_samples =
      static_cast<int>(std::clamp(fade_ms, 0, kMaxFadeMs) * sample_rate / 1000.0);
  const int drain_samples =
      static_cast<int>(std::clamp(drain_ms, 0, kMaxDrainMs) * sample_rate / 1000.0);
  s.fade_total_ = std::max(fade_samples, 0);
  s.drain_total_ = std::max(drain_samples, 0);
  // The retirement glide is the last 50 ms of the drain (or the whole drain
  // when it is shorter).
  s.drain_out_len_ = std::min(s.drain_total_, static_cast<int>(sample_rate / 20.0));

  const size_t frames = static_cast<size_t>(max_block_size);
  s.in_l_.assign(frames, 0.0f);
  s.in_r_.assign(frames, 0.0f);
  s.old_l_.assign(frames, 0.0f);
  s.old_r_.assign(frames, 0.0f);
  s.positions_.assign(frames, 0.0f);
  s.zeros_.assign(frames, 0.0f);
  s.scratch_frames_ = max_block_size;

  s.pending_.store(staged.release(), std::memory_order_release);
  return true;
}

void RigSwitch::Process(const float* const* input, int input_channels,
                        float* const* output, int output_channels, int num_frames) {
  Impl& s = *impl_;

  engine::AudioEngine* staged = s.pending_.load(std::memory_order_acquire);
  if (staged == nullptr && !s.active_.load(std::memory_order_acquire)) {
    s.live_->Process(input, input_channels, output, output_channels, num_frames);
    return;
  }
  if (staged != nullptr) {
    staged = s.pending_.exchange(nullptr, std::memory_order_acq_rel);
    if (staged != nullptr) s.BeginSwitch(staged);
  }
  if (!s.active_.load(std::memory_order_relaxed)) {
    s.live_->Process(input, input_channels, output, output_channels, num_frames);
    return;
  }

  int n = num_frames;
  if (n > s.scratch_frames_) n = s.scratch_frames_;  // defensive, mirrors AudioEngine::Process
  if (n < 0) n = 0;
  if (n == 0) return;

  const bool mono_in = input_channels < 2;
  const bool mono_out = output_channels < 2;
  const float* in_l = (input && input_channels >= 1 && input[0]) ? input[0] : nullptr;
  const float* in_r = (!mono_in && input && input[1]) ? input[1] : nullptr;

  if (s.fade_pos_ < s.fade_total_) {
    // ── Fade: both engines get the input (the old one's faded to silence),
    // outputs crossfade equal-power old -> new. t clamps at 1 so a fade that
    // completes mid-buffer renders pure new for its tail samples - identical
    // to handling the phase change mid-buffer, without the bookkeeping.
    s.live_->Process(input, input_channels, output, output_channels, n);
    const float inv_fade = 1.0f / static_cast<float>(s.fade_total_);
    for (int i = 0; i < n; ++i) {
      const float t = std::min((s.fade_pos_ + i) * inv_fade, 1.0f);
      const float in_gain = 1.0f - t;
      const float l = in_l ? in_l[i] : 0.0f;
      s.in_l_[static_cast<size_t>(i)] = l * in_gain;
      s.in_r_[static_cast<size_t>(i)] = (mono_in ? l : (in_r ? in_r[i] : 0.0f)) * in_gain;
      s.positions_[static_cast<size_t>(i)] = t;
    }
    const float* old_in[2] = {s.in_l_.data(), s.in_r_.data()};
    float* old_out[2] = {s.old_l_.data(), s.old_r_.data()};
    s.old_->Process(old_in, 2, old_out, 2, n);
    if (output && output_channels >= 1 && output[0]) {
      if (!mono_out && output_channels >= 2 && output[1]) {
        s.xfade_l_.processAutomated(s.old_l_.data(), output[0], s.positions_.data(), output[0], n);
        s.xfade_r_.processAutomated(s.old_r_.data(), output[1], s.positions_.data(), output[1], n);
      } else {
        // Mono out: the live engine already averaged its stereo pair down;
        // average the old engine's pair the same way, then crossfade through
        // the same equal-power curve (reuses in_l_ as the mono scratch - the
        // faded input copy is no longer needed once old_->Process returns).
        for (int i = 0; i < n; ++i) {
          const size_t k = static_cast<size_t>(i);
          s.in_l_[k] = 0.5f * (s.old_l_[k] + s.old_r_[k]);
        }
        s.xfade_l_.processAutomated(s.in_l_.data(), output[0], s.positions_.data(), output[0], n);
      }
    }
    s.fade_pos_ += n;
    if (s.fade_pos_ >= s.fade_total_ && s.drain_total_ <= 0) s.RetireOld();
    return;
  }

  // ── Drain: the new rig owns the input; the old one renders silence-input
  // tails mixed back under it with the drain envelope. Same clamping trick
  // at the drain end: post-drain samples render pure new.
  if (s.drain_pos_ < s.drain_total_) {
    s.live_->Process(input, input_channels, output, output_channels, n);
    const float* silence[2] = {s.zeros_.data(), s.zeros_.data()};
    float* old_out[2] = {s.old_l_.data(), s.old_r_.data()};
    s.old_->Process(silence, 2, old_out, 2, n);
    if (output && output_channels >= 1 && output[0]) {
      if (!mono_out && output_channels >= 2 && output[1]) {
        for (int i = 0; i < n; ++i) {
          const float e = s.DrainEnvelope(s.drain_pos_ + i);
          const size_t k = static_cast<size_t>(i);
          output[0][i] += s.old_l_[k] * e;
          output[1][i] += s.old_r_[k] * e;
        }
      } else {
        for (int i = 0; i < n; ++i) {
          const float e = s.DrainEnvelope(s.drain_pos_ + i);
          const size_t k = static_cast<size_t>(i);
          output[0][i] += 0.5f * (s.old_l_[k] + s.old_r_[k]) * e;
        }
      }
    }
    s.drain_pos_ += n;
    if (s.drain_pos_ >= s.drain_total_) s.RetireOld();
    return;
  }

  // Unreachable (transitions retire eagerly above); stay safe.
  s.live_->Process(input, input_channels, output, output_channels, n);
}

bool RigSwitch::Active() const { return impl_->active_.load(std::memory_order_acquire); }

engine::AudioEngine* RigSwitch::Current() const {
  return impl_->current_.load(std::memory_order_acquire);
}

std::unique_ptr<engine::AudioEngine> RigSwitch::TakeStagedEngine() {
  Impl& s = *impl_;
  s.ReclaimInternal();
  if (!s.freelist_.empty()) {
    auto engine = std::move(s.freelist_.back());
    s.freelist_.pop_back();
    // A retired engine carries its previous life's topology - the staged
    // build below assumes an empty engine. Block ids keep counting (never
    // reused within an engine's lifetime); automation carryover matches by
    // id AND kind, so stale ids degrade to unbound-with-memory, never to a
    // wrong binding. Control thread, engine not processed - Tier-2 safe.
    engine->ClearTopology();
    return engine;
  }
  return std::make_unique<engine::AudioEngine>();
}

void RigSwitch::Reclaim() { impl_->ReclaimInternal(); }

void RigSwitch::Clear() {
  Impl& s = *impl_;
  if (auto* staged = s.pending_.exchange(nullptr, std::memory_order_acq_rel)) {
    if (static_cast<int>(s.freelist_.size()) < kFreeListCap) {
      s.freelist_.push_back(std::unique_ptr<engine::AudioEngine>(staged));
    } else {
      s.retired_dropped_.fetch_add(1, std::memory_order_relaxed);
    }
  }
  if (s.old_ != nullptr) {
    if (static_cast<int>(s.freelist_.size()) < kFreeListCap) {
      s.freelist_.push_back(std::move(s.old_));
    } else {
      s.old_.reset();  // Tier-2 context: no Process() in flight, safe to free here
      s.retired_dropped_.fetch_add(1, std::memory_order_relaxed);
    }
  }
  s.active_.store(false, std::memory_order_relaxed);
  s.fade_pos_ = s.fade_total_ = 0;
  s.drain_pos_ = s.drain_total_ = s.drain_out_len_ = 0;
  s.in_l_.clear();
  s.in_r_.clear();
  s.old_l_.clear();
  s.old_r_.clear();
  s.positions_.clear();
  s.zeros_.clear();
  s.scratch_frames_ = 0;
  s.ReclaimInternal();
}

}  // namespace openaxe::switcher
