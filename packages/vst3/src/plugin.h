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

#include <array>
#include <atomic>
#include <chrono>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "IPlug_include_in_plug_hdr.h"

#include "openaxe/api.h"

#include "editor.h"

namespace openaxe_vst3 {
class VstBridge;
class HttpServer;
}

const int kNumPresets = 2;  // Clean Boost, Ambient Swell — generated from same rows as web

class OpenAxePlugin final : public iplug::Plugin {
 public:
  explicit OpenAxePlugin(const iplug::InstanceInfo& info);
  ~OpenAxePlugin() override;

#if IPLUG_DSP
  void ProcessBlock(iplug::sample** inputs, iplug::sample** outputs, int nFrames) override;
  void OnReset() override;
  void OnActivate(bool enable) override;
  void OnParamChange(int paramIdx) override;
  bool SerializeState(iplug::IByteChunk& chunk) const override;
  int UnserializeState(const iplug::IByteChunk& chunk, int startPos) override;
  void ProcessMidiMsg(const iplug::IMidiMsg& msg) override;
  // Main-thread pump. Applies Tier-2 parameter writes the audio thread parked
  // in deferred_writes_ (issue #300 C1).
  void OnIdle() override;
#endif

  // Portable JSON round-trip (same document as the host chunk, just on disk)
  // — web ↔ desktop ↔ plugin share this. Useful for .json preset import/export
  // and for tests that don't have an IByteChunk.
  bool SavePortableJson(const std::string& path) const;
  int LoadPortableJson(const std::string& path);

  // Missing assets from the last Restore/UnserializeState (#120). Empty when
  // everything resolved; otherwise display names for UI relink affordance.
  std::vector<std::string> GetMissingAssets() const;

  // ── Asset loading (issue #129) ────────────────────────────────────────
  // All Tier-2 (suspended). Prefer in-memory JSON/WAV forms so a restored
  // session never stages a temp file (#47). Size guards before core (#69).
  // Dialog helpers remember last dir per type.
  int LoadNamModelFromPath(int32_t block_id, const std::string& path, std::string* error = nullptr);
  int LoadNamModelFromJson(int32_t block_id, const std::string& json, std::string* error = nullptr);
  int LoadIrWavFromPath(int32_t block_id, const std::string& path, std::string* error = nullptr);
  int LoadIrWavFromBytes(int32_t block_id, const std::vector<uint8_t>& wav_bytes, std::string* error = nullptr);
  // Dialog → load (returns LoadResult as int; *error has readable message).
  // Empty path / cancel returns Cancelled without touching the graph.
  int PickAndLoadNamModel(int32_t block_id, std::string* error = nullptr);
  int PickAndLoadIrWav(int32_t block_id, std::string* error = nullptr);
  // For UI display: sample rate / loudness / slim breakpoints etc.
  // Returns false when block has no model.
  bool GetModelInfo(int32_t block_id, double* out_sample_rate, int* out_has_loudness,
                    double* out_loudness_db, int* out_is_slimmable, int* out_bp_count) const;

  // Editor shell (issue #132) — webview hosting the shared React app.
  // Exposed for state persistence and host window embedding; the audio path
  // never touches the editor (open/close must not disturb audio).
  openaxe_vst3::editor::Editor& GetEditor();
  const openaxe_vst3::editor::Editor& GetEditor() const;

  // Suspend handshake — control thread only. Mirrors
  // apps/desktop/src/audio.cpp's BeginSuspend/EndSuspend contract (see
  // AudioEngine's Tier 2 docs): BeginSuspend raises suspend_requested_ and
  // waits for ProcessBlock to observe it (bump suspend_ack_), guaranteeing no
  // nam_studio_process is in flight before the caller mutates the graph.
  // Returns false on timeout (audio thread stalled); mutation is still safe
  // in that case, matching the desktop fallback of stopping the stream.
  bool BeginSuspend() const;
  void EndSuspend() const;

  // Control-thread helper that mutates the graph under the handshake (e.g. for
  // future model loads / topology edits from the UI thread). Runs `fn` while
  // suspended and resets if sample-rate or block-size changed.
  template <typename Fn>
  void WithSuspend(Fn&& fn) const {
    const bool suspended = BeginSuspend();
    (void)suspended;
    fn();
    EndSuspend();
  }
  template <typename Fn>
  void WithSuspend(Fn&& fn) {
    const bool suspended = BeginSuspend();
    (void)suspended;
    fn();
    EndSuspend();
  }

  private:
   // Tier-2 parameter writes deferred off the audio thread (issue #300 C1).
   // Producer: OnParamChange (audio thread) — lock-free, wait-free, no alloc.
   // Consumer: OnIdle (main thread) — suspends and mutates the graph.
   static constexpr int kNoHostParam = -1;
   // One slot per Tier-2 host param. The schema has a handful (the Amp
   // family's slim_size), so 32 is generous headroom; see
   // QueueDeferredParamWrite for the drop-on-overflow rationale.
   static constexpr size_t kDeferredWriteSlots = 32;
   struct DeferredWrite {
     std::atomic<int> host_id{kNoHostParam};
     std::atomic<float> normalized{0.0f};
     std::atomic<bool> pending{false};
   };
   std::array<DeferredWrite, kDeferredWriteSlots> deferred_writes_{};
   void QueueDeferredParamWrite(int host_id, float normalized);
   void DrainDeferredParamWrites();

   mutable NamStudioGraph* graph_ = nullptr;
   // Read by ProcessBlock on the audio thread, written by OnReset/OnActivate,
   // read by UnserializeState/LoadPortableJson on the main thread — so they
   // must be atomic rather than plain scalars (issue #300 C4).
   mutable std::atomic<double> sample_rate_{48000.0};
   mutable std::atomic<int> max_block_size_{0};

   // Channel-conversion scratch, sized in OnReset. Previously these were
   // 2 x 8192 float arrays declared on the audio-thread stack in two separate
   // branches of ProcessBlock — up to ~256 KB of frame that compilers reserve
   // in the prologue, on a thread with a modest stack (issue #300 C2).
   // The core's ABI accepts 1 or 2 channels regardless of graph topology
   // (openaxe/api.h), and PLUG_CHANNEL_IO is "1-1 2-2".
   static constexpr int kMaxChans = 2;
   mutable std::vector<float> scratch_in_;
   mutable std::vector<float> scratch_out_;
   mutable int scratch_frames_ = 0;
   void EnsureScratch(int frames) const;

   // Suspend handshake state — same shape as RtCallbackState::suspend +
   // suspended_callbacks in apps/desktop/src/audio.h. Audio thread only reads
   // suspend_requested_ and bumps suspend_ack_; control thread only writes
   // suspend_requested_ and waits on suspend_ack_.
   mutable std::atomic<bool> suspend_requested_{false};
   mutable std::atomic<unsigned> suspend_ack_{0};

   // Editor shell — owned here, borrowed graph pointer (no audio thread touch
   // on open/close). Mutable so SerializeState (const) can read editor size
   // for chunk inclusion.
   mutable std::unique_ptr<openaxe_vst3::editor::Editor> editor_;

   // Webview bridge + loopback HTTP server for the React UI (like desktop's
   // HttpServer). Serves apps/web/dist over 127.0.0.1 so WKWebView can load
   // it with subresources (file:// is sandboxed). The bridge exposes the same
   // window.openAxe.* surface the desktop does.
   //
   // Guarded, not just left unused, in the headless configuration: VstBridge
   // and HttpServer are only forward-declared here, and std::unique_ptr needs
   // the complete type to instantiate its deleter at destruction. Leaving the
   // members in place without the webview fails to compile with
   // "invalid application of 'sizeof' to an incomplete type".
#ifdef OPENAXE_HAS_WEBVIEW
   std::unique_ptr<openaxe_vst3::VstBridge> bridge_;
   std::unique_ptr<openaxe_vst3::HttpServer> uiServer_;
   unsigned short uiPort_ = 0;
   std::string uiRoot_;
#endif
};
