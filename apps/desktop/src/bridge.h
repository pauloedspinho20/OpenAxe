#pragma once

#include <nlohmann/json.hpp>

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

#include "audio.h"

// The window.openAxe.* JS<->C++ bridge (issue #15 M2). Exposes the shared
// DSP core's extern "C" ABI plus the desktop audio I/O to the webview UI as
// promise-returning JS functions, bound via webview::bind().
//
// Threading model (three threads):
//   - webview (UI) thread: runs the bind handlers. Cheap, lock-free core calls
//     (setParam/getParam/meters/cpuLoad) and AudioIO device/stream queries run
//     straight here.
//   - control thread: owns every graph mutation - topology edits, NAM model
//     loads, reverb/delay algorithm swaps, and the post-Open reset.
//     Handlers Call() into it so these serialize against each other and never
//     run on the audio thread.
//   - audio (real-time) thread: only ever openaxe_process. Before touching
//     the graph the control thread raises the suspend flag and waits for the
//     audio callback to observe it (see AudioIO::BeginSuspend), so a mutation
//     can never race an in-flight process.
//
// Id mapping: the web app uses string ids ("block-1", "edge-1"); the core uses
// ints. The bridge owns the string<->int maps, which are only ever touched on
// the control thread (adds there, reads there via Call()), so no extra lock is
// needed. Rail jacks are the core sentinels -1 (IN) / -2 (OUT); the web UI's
// 'IN'/'OUT' strings are mapped by the M3 NativeGraphRig shim.
//
// Each handler takes the raw webview request string (a JSON array of args -
// one object per call) and returns a JSON string that webview resolves as the
// JS promise value.

namespace openaxe_desktop {

struct BlockRecord {
  int32_t core_id = -1;
  std::string kind;  // web BlockKind string ("delay", "amp", "mixer", ...)
  int row = 0;
  int col = 0;
};

struct EdgeRecord {
  nlohmann::json from_id;   // block js id, or the number -1/-2 for the rails
  int from_port = 0;
  nlohmann::json to_id;
  int to_port = 0;
};

// Which graph a staged-capable handler targets (issue #367): the live graph
// and its bookkeeping, or the staged graph under construction plus its own
// maps. Handlers read the request's "stage" flag and resolve through
// MutationTargetFor(); staged mutations skip the suspend handshake entirely
// (the staged engine is never processed before its commit) and only the
// lock-free openaxe_staged_graph_commit touches the live graph.
struct MutationTarget {
  OpenAxeGraph* graph = nullptr;
  std::map<std::string, BlockRecord>* blocks = nullptr;
  std::map<std::string, EdgeRecord>* edges = nullptr;
  std::map<std::string, int32_t>* edge_ids = nullptr;    // js edge id -> core edge id
  std::map<int32_t, std::string>* edge_ids_rev = nullptr;
  bool staged = false;
};

// issue #71: only loopback http(s) origins may host the UI while the privileged
// window.openAxe bridge is bound. Anything else (a remote host supplied via
// OPENAXE_UI_URL, a file:// or data: URL, ...) is rejected so untrusted JS
// can never reach the native bridge.
bool IsTrustedUiUrl(const std::string& url);

class StudioBridge {
 public:
  StudioBridge();
  ~StudioBridge();

  StudioBridge(const StudioBridge&) = delete;
  StudioBridge& operator=(const StudioBridge&) = delete;

  // ── Handlers (callable from the webview thread) ──────────────────────
  std::string HandleVersion(const std::string& req);
  std::string HandleListDevices(const std::string& req);
  std::string HandleGetConfig(const std::string& req);
  std::string HandleOpen(const std::string& req);
  std::string HandleClose(const std::string& req);
  std::string HandleStart(const std::string& req);
  std::string HandleStop(const std::string& req);

  std::string HandleAddBlock(const std::string& req);
  std::string HandleRemoveBlock(const std::string& req);
  std::string HandleMoveBlock(const std::string& req);
  std::string HandleConnect(const std::string& req);
  std::string HandleDisconnect(const std::string& req);
  std::string HandleSetParam(const std::string& req);
  std::string HandleGetParam(const std::string& req);
  std::string HandleBlockInfo(const std::string& req);
  std::string HandleListBlocks(const std::string& req);
  std::string HandleListEdges(const std::string& req);
  std::string HandleLoadModel(const std::string& req);
  std::string HandleLoadModelJson(const std::string& req);
  std::string HandleUnloadModel(const std::string& req);
  std::string HandleSetReverbAlgorithm(const std::string& req);
  std::string HandleSetDelayModel(const std::string& req);
  std::string HandleMeters(const std::string& req);
  std::string HandleCpuLoad(const std::string& req);
  std::string HandleGetTap(const std::string& req);
  // Polled from the JS layer's regular meter/tap poll: reports (and clears) a
  // pending RtAudio stream-level error, e.g. a second process touching the
  // same shared device forcing a mid-stream reconfiguration. The caller is
  // expected to Stop()/Close() and surface the message - see
  // AudioIO::TakeStreamError's own doc comment for why this can't be done
  // from inside the RtAudio error callback itself.
  std::string HandleTakeStreamError(const std::string& req);
  std::string HandleSetBypass(const std::string& req);
  std::string HandleSetBlockTrim(const std::string& req);
  std::string HandleLoadIrWav(const std::string& req);
  std::string HandleUnloadIr(const std::string& req);
  std::string HandleSetInputGain(const std::string& req);
  std::string HandleSetInputChannel(const std::string& req);
  std::string HandleSetMasterLevel(const std::string& req);
  std::string HandleSetMasterMuted(const std::string& req);
  std::string HandleSetTunerMuted(const std::string& req);
  // DI audition (issue #273): wavBase64 -> decoded/resampled mono, then play/stop.
  std::string HandleLoadDIWav(const std::string& req);
  std::string HandlePlayDI(const std::string& req);
  std::string HandleStopDI(const std::string& req);

  // Gapless staged switching (issue #367) - see MutationTarget above.
  std::string HandleStageBegin(const std::string& req);
  std::string HandleStageCommit(const std::string& req);
  std::string HandleStageDiscard(const std::string& req);
  std::string HandleSwitchActive(const std::string& req);

  // Small secret store (issue #146) backing the Tone3000 refresh token so it
  // survives an app restart - see secure_storage.h. Independent of the
  // graph/audio state above, so these run straight on the webview thread
  // like the read-only queries do, no Call()/Mutate() needed.
  std::string HandleSecureStore(const std::string& req);
  std::string HandleSecureLoad(const std::string& req);
  std::string HandleSecureDelete(const std::string& req);

 private:
  // Control executor ------------------------------------------------------
  // Submit a task to the control thread (fire-and-forget).
  void Submit(std::function<void()> task);
  // Submit and block until the task has run on the control thread. Must not
  // be called from the control thread itself (no nested calls today).
  void Call(std::function<void()> task);
  void ControlLoop();

  // Run `mutation` on the control thread inside a suspend handshake, then
  // reset the graph (topology ops need it; model loads self-reset). This is
  // how every graph-affecting bridge call reaches the core.
  void Mutate(const std::function<void()>& mutation, bool reset_after);
  // Same, but against a MutationTarget: live targets suspend exactly like
  // Mutate; staged targets run unsuspended (the staged engine is never
  // processed before its commit, so there is nothing to suspend) and reset
  // the staged graph directly instead.
  void MutateOn(const MutationTarget& target, const std::function<void()>& mutation,
                bool reset_after);
  // Live-graph target (blocks_/edges_/... + graph_).
  MutationTarget LiveTarget();
  // Fills *out with the staged-graph target; false when no staged graph is
  // open (the caller reports "call stageBegin first").
  bool StagedTarget(MutationTarget* out);
  // Resolves a staged-capable handler's target from its "stage" request flag.
  // Returns "" on success or an error string (no staged graph open). Control
  // thread only (reads the bookkeeping maps).
  std::string ResolveTarget(bool stage, MutationTarget* out);

  // Id/position bookkeeping (control-thread only) ------------------------
  std::string GenBlockId();
  std::string GenEdgeId();
  void DropEdgesTouching(const std::string& block_id);
  void DropEdgesTouchingOn(const std::string& block_id, std::map<std::string, EdgeRecord>& edges,
                           std::map<std::string, int32_t>& edge_ids,
                           std::map<int32_t, std::string>& edge_ids_rev);

  // State -----------------------------------------------------------------
  AudioIO audio_;
  OpenAxeGraph* graph_ = nullptr;
  // Staged graph under construction (issue #367) plus its own bookkeeping.
  // Only ever touched on the control thread, like the live maps. A
  // successful StageCommit adopts these maps into the live ones and clears
  // the handle (the core consumes it); the destructor destroys an
  // abandoned one.
  OpenAxeGraph* staged_ = nullptr;
  std::map<std::string, BlockRecord> staged_blocks_;
  std::map<std::string, EdgeRecord> staged_edges_;
  std::map<std::string, int32_t> staged_edge_ids_;
  std::map<int32_t, std::string> staged_edge_ids_rev_;

  std::thread control_thread_;
  std::mutex queue_mutex_;
  std::condition_variable queue_cv_;
  std::deque<std::function<void()>> queue_;
  std::atomic<bool> control_stop_{false};

  // Only touched on the control thread (see class comment).
  std::map<std::string, BlockRecord> blocks_;
  std::map<std::string, EdgeRecord> edges_;
  std::map<std::string, int32_t> edge_ids_;   // js edge id -> core edge id
  std::map<int32_t, std::string> edge_ids_rev_;
  std::atomic<int> auto_block_id_{1};
  std::atomic<int> auto_edge_id_{1};

  double graph_sample_rate_ = 48000.0;
  int32_t graph_block_ = 512;
};

}  // namespace openaxe_desktop