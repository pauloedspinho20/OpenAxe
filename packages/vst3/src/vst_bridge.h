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

  OpenAxePlugin* plugin_ = nullptr;
  NamStudioGraph* graph_ = nullptr;

  std::mutex mutex_;
  // jsId -> core
  std::map<std::string, int32_t> blockIds_;
  std::map<std::string, int32_t> edgeIds_;
  // reverse for list
  std::map<int32_t, std::string> blockKinds_;
  std::map<std::string, std::pair<int,int>> blockPos_; // row,col
  std::map<std::string, std::pair<std::string,std::string>> edgeEndpoints_; // fromId/toId as strings
  std::map<std::string, std::string> secureStore_;
};

}  // namespace openaxe_vst3
