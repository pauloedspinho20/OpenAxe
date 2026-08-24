#pragma once

// iPlug2 plugin wrapping packages/core (issues #125, #126, #127).
// Audio path responsibilities (issue #126):
//   - ProcessBlock is lock-free: no allocation, no mutex, no IO. Only the
//     FTZ/DAZ guard and nam_studio_process are on the hot path.
//   - All Tier-2 mutations (topology, model/IR loads, algorithm switches,
//     nam_studio_reset) are serialized against ProcessBlock via the suspend
//     handshake below — ported from apps/desktop/src/audio.cpp's
//     AudioIO::BeginSuspend/EndSuspend (fix for #43/#53/#59). ProcessBlock
//     observes suspend_requested_ and silences + bumps suspend_ack_; the
//     control thread waits for that ack before touching the graph.
//   - Host block sizes larger than the last nam_studio_reset's max_block_size
//     are handled by chunking inside ProcessBlock (never by re-resetting on
//     the audio thread — that would allocate).
//   - Zero reported latency (PLUG_LATENCY 0; latency_test proves the DSP path
//     adds none) and bus arrangements 1-1 2-2 (core folds mono/stereo itself).

#include <atomic>
#include <chrono>
#include <thread>

#include "IPlug_include_in_plug_hdr.h"

#include "openaxe/api.h"

const int kNumPresets = 1;

class OpenAxePlugin final : public iplug::Plugin {
 public:
  explicit OpenAxePlugin(const iplug::InstanceInfo& info);
  ~OpenAxePlugin() override;

#if IPLUG_DSP
  void ProcessBlock(iplug::sample** inputs, iplug::sample** outputs, int nFrames) override;
  void OnReset() override;
  void OnActivate(bool enable) override;
  void OnParamChange(int paramIdx) override;
#endif

  // Suspend handshake — control thread only. Mirrors
  // apps/desktop/src/audio.cpp's BeginSuspend/EndSuspend contract (see
  // AudioEngine's Tier 2 docs): BeginSuspend raises suspend_requested_ and
  // waits for ProcessBlock to observe it (bump suspend_ack_), guaranteeing no
  // nam_studio_process is in flight before the caller mutates the graph.
  // Returns false on timeout (audio thread stalled); mutation is still safe
  // in that case, matching the desktop fallback of stopping the stream.
  bool BeginSuspend();
  void EndSuspend();

  // Control-thread helper that mutates the graph under the handshake (e.g. for
  // future model loads / topology edits from the UI thread). Runs `fn` while
  // suspended and resets if sample-rate or block-size changed.
  template <typename Fn>
  void WithSuspend(Fn&& fn) {
    const bool suspended = BeginSuspend();
    (void)suspended;
    fn();
    EndSuspend();
  }

 private:
  NamStudioGraph* graph_ = nullptr;
  double sample_rate_ = 48000.0;
  int max_block_size_ = 0;

  // Suspend handshake state — same shape as RtCallbackState::suspend +
  // suspended_callbacks in apps/desktop/src/audio.h. Audio thread only reads
  // suspend_requested_ and bumps suspend_ack_; control thread only writes
  // suspend_requested_ and waits on suspend_ack_.
  std::atomic<bool> suspend_requested_{false};
  std::atomic<unsigned> suspend_ack_{0};
};
