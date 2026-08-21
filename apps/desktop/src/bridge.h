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

// The window.namStudio.* JS<->C++ bridge (issue #15 M2). Exposes the shared
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
//   - audio (real-time) thread: only ever nam_studio_process. Before touching
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

namespace nam_desktop {

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

// issue #71: only loopback http(s) origins may host the UI while the privileged
// window.namStudio bridge is bound. Anything else (a remote host supplied via
// NAM_STUDIO_UI_URL, a file:// or data: URL, ...) is rejected so untrusted JS
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
  std::string HandleSetMasterLevel(const std::string& req);
  std::string HandleSetMasterMuted(const std::string& req);
  std::string HandleSetTunerMuted(const std::string& req);

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

  // Id/position bookkeeping (control-thread only) ------------------------
  std::string GenBlockId();
  std::string GenEdgeId();
  void DropEdgesTouching(const std::string& block_id);

  // State -----------------------------------------------------------------
  AudioIO audio_;
  NamStudioGraph* graph_ = nullptr;

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

}  // namespace nam_desktop