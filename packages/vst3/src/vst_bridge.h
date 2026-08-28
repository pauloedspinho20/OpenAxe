#pragma once

#include <cstdint>
#include <functional>
#include <map>
#include <mutex>
#include <string>

struct NamStudioGraph;
class OpenAxePlugin;

namespace openaxe_vst3 {

// VST bridge — mirrors apps/desktop/src/bridge.h but for the plugin's
// NamStudioGraph that the host's ProcessBlock also drives. Exposes the same
// window.openAxe.* surface the React app expects (NativeGraphRig, etc.).
// Each handler takes the raw JSON string the webview posted and returns a JSON
// string the webview will resolve. Threading: called on the UI thread via
// IWebViewControl::OnMessageFromWebView; Tier 2 mutations go through
// OpenAxePlugin::WithSuspend.

class VstBridge {
 public:
  explicit VstBridge(OpenAxePlugin* plugin, NamStudioGraph* graph);
  ~VstBridge() = default;

  // Rebuild the jsId <-> core id maps from the graph itself.
  //
  // The core is the source of truth for the rig (issue #300 D1/D2). Restoring a
  // host chunk calls nam_studio_load_state, which rebuilds the topology and
  // assigns fresh core ids — the bridge's maps still held the previous
  // session's pairs, so every setParam/blockInfo/removeBlock from the UI then
  // addressed the wrong block or returned "unknown block". Anything that
  // replaces the graph must call this.
  //
  // Ids become the core's own ids as strings, so the map is an identity and
  // cannot drift again; the UI adopts them when it hydrates from GetStateJson.
  void SyncFromCore();

  // The core's serialized rig, which is what the UI hydrates from in plugin
  // mode instead of its own browser storage. Assets are not embedded — this is
  // read on editor open, not a save.
  std::string GetStateJson() const;

  // Dispatch a message from the webview: expects JSON like
  // {"method":"openAxe.addBlock","args":{...},"id":123}
  // Returns JSON string for the response which the caller should deliver back
  // via EvaluateJavaScript("window.IPlugWebViewResolve(id, JSON)").
  // If the message has no id (legacy), returns the result JSON directly.
  std::string HandleMessage(const std::string& json);

 private:
  std::string HandleVersion(const std::string& argsJson);
  std::string HandleListDevices(const std::string& argsJson);
  std::string HandleGetConfig(const std::string& argsJson);
  std::string HandleAddBlock(const std::string& argsJson);
  std::string HandleRemoveBlock(const std::string& argsJson);
  std::string HandleMoveBlock(const std::string& argsJson);
  std::string HandleConnect(const std::string& argsJson);
  std::string HandleDisconnect(const std::string& argsJson);
  std::string HandleSetParam(const std::string& argsJson);
  std::string HandleGetParam(const std::string& argsJson);
  std::string HandleBlockInfo(const std::string& argsJson);
  std::string HandleListBlocks(const std::string& argsJson);
  std::string HandleListEdges(const std::string& argsJson);
  std::string HandleSetMasterLevel(const std::string& argsJson);
  std::string HandleSetMasterMuted(const std::string& argsJson);
  std::string HandleSetBypass(const std::string& argsJson);
  std::string HandleSetBlockTrim(const std::string& argsJson);
  std::string HandleMeters(const std::string& argsJson);
  std::string HandleCpuLoad(const std::string& argsJson);
  std::string HandleLoadModel(const std::string& argsJson);
  std::string HandleLoadModelJson(const std::string& argsJson);
  std::string HandleUnloadModel(const std::string& argsJson);
  std::string HandleSetReverbAlgorithm(const std::string& argsJson);
  std::string HandleSetDelayModel(const std::string& argsJson);
  std::string HandleLoadIrWav(const std::string& argsJson);
  std::string HandleUnloadIr(const std::string& argsJson);
  std::string HandleSecureStore(const std::string& argsJson);
  std::string HandleSecureLoad(const std::string& argsJson);
  std::string HandleSecureDelete(const std::string& argsJson);
  std::string HandleTakeStreamError(const std::string& argsJson);
  std::string HandleGetState(const std::string& argsJson);

  OpenAxePlugin* plugin_ = nullptr;
  NamStudioGraph* graph_ = nullptr;

  std::mutex mutex_;
  // jsId -> core
  std::map<std::string, int32_t> blockIds_;
  std::map<std::string, int32_t> edgeIds_;
  // reverse for list
  std::map<int32_t, std::string> blockKinds_;
  std::map<std::string, std::pair<int,int>> blockPos_; // row,col
  // Edge endpoints kept as structured data. They used to be stored as JSON
  // dumps of the id and re-parsed by listEdges, which also hard-coded
  // "port": 0 and threw away the real fromPort/toPort that connect() was
  // given (issue #300 J5).
  struct EdgeEndpoints {
    std::string fromId;   // js id, "IN" or "OUT"
    std::string toId;
    int fromPort = 0;
    int toPort = 0;
  };
  std::map<std::string, EdgeEndpoints> edgeEndpoints_;

  // Id counters for blocks/edges the UI did not name. Members, not
  // function-local statics: a static is shared by every VstBridge in the
  // process, so two plugin instances in one project interleaved their id
  // sequences, and the bare ++ was a data race besides. Guarded by mutex_
  // (issue #300 D3).
  int nextBlockId_ = 0;
  int nextEdgeId_ = 0;
};

}  // namespace openaxe_vst3
