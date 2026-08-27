#include "vst_bridge.h"

#include "asset_loading.h"
#include "openaxe/secure_storage.h"
#include "plugin.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <cstring>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

#include "openaxe/api.h"

using nlohmann::json;

namespace openaxe_vst3 {

namespace {

json ParseArgs(const std::string& req) {
  json j = json::parse(req, nullptr, false);
  if (j.is_discarded()) return json::array();
  if (j.is_array()) return j;
  return json::array({j});
}

std::string JsonError(const std::string& msg) { return (json{{"ok", false}, {"error", msg}}).dump(); }

const char* CoreSymbolAliasFor(const std::string& key) {
  if (key == "slimSize") return "slim_size";
  if (key == "irMix") return "ir_mix";
  return nullptr;
}

int32_t ResolveParamIndex(const std::string& symbol, int32_t core_id, NamStudioGraph* graph) {
  if (symbol.empty() || core_id < 0 || !graph) return -1;
  std::string sym = symbol;
  if (const char* alias = CoreSymbolAliasFor(symbol)) sym = alias;
  const int32_t n = nam_studio_block_param_count(graph, core_id);
  for (int32_t i = 0; i < n; ++i) {
    const char* s = nullptr;
    if (!nam_studio_block_param_info(graph, core_id, i, nullptr, &s, nullptr, nullptr, nullptr)) continue;
    if (s && sym == s) return i;
  }
  return -1;
}

int32_t ResolveParamIndexJson(const json& key, int32_t core_id, NamStudioGraph* graph) {
  if (key.is_number()) return key.get<int32_t>();
  if (!key.is_string()) return -1;
  return ResolveParamIndex(key.get<std::string>(), core_id, graph);
}

bool IsValidSecretKey(const std::string& key) {
  if (key.empty()) return false;
  return std::all_of(key.begin(), key.end(), [](unsigned char c){ return std::isalnum(c) || c=='_' || c=='-'; });
}

}  // namespace

VstBridge::VstBridge(OpenAxePlugin* plugin, NamStudioGraph* graph) : plugin_(plugin), graph_(graph) {}

std::string VstBridge::HandleMessage(const std::string& jsonStr) {
  json j = json::parse(jsonStr, nullptr, false);
  if (j.is_discarded()) return JsonError("bad json");
  std::string method;
  json args = json::object();
  int id = -1;
  if (j.is_object() && j.contains("method")) {
    method = j.value("method", "");
    if (j.contains("args")) args = j["args"];
    if (j.contains("id")) id = j.value("id", -1);
  } else {
    return JsonError("missing method");
  }
  std::string result;
  if (method == "openAxe.version") result = HandleVersion(args.dump());
  else if (method == "openAxe.listDevices") result = HandleListDevices(args.dump());
  else if (method == "openAxe.getConfig") result = HandleGetConfig(args.dump());
  // The DAW owns the audio device, so these are no-ops — but they must answer
  // with the same shape the desktop shell does, because
  // useNativeAudioEngine reads `sampleRate` off open()'s result and silently
  // fell back to a hard-coded 48000 (issue #300 E3).
  else if (method == "openAxe.open") result = HandleGetConfig(args.dump());
  else if (method == "openAxe.close") result = (json{{"ok", true}}).dump();
  else if (method == "openAxe.start") result = HandleGetConfig(args.dump());
  else if (method == "openAxe.stop") result = (json{{"ok", true}}).dump();
  else if (method == "openAxe.addBlock") result = HandleAddBlock(args.dump());
  else if (method == "openAxe.removeBlock") result = HandleRemoveBlock(args.dump());
  else if (method == "openAxe.moveBlock") result = HandleMoveBlock(args.dump());
  else if (method == "openAxe.connect") result = HandleConnect(args.dump());
  else if (method == "openAxe.disconnect") result = HandleDisconnect(args.dump());
  else if (method == "openAxe.setParam") result = HandleSetParam(args.dump());
  else if (method == "openAxe.getParam") result = HandleGetParam(args.dump());
  else if (method == "openAxe.blockInfo") result = HandleBlockInfo(args.dump());
  else if (method == "openAxe.listBlocks") result = HandleListBlocks(args.dump());
  else if (method == "openAxe.listEdges") result = HandleListEdges(args.dump());
  else if (method == "openAxe.setMasterLevel") result = HandleSetMasterLevel(args.dump());
  else if (method == "openAxe.setMasterMuted") result = HandleSetMasterMuted(args.dump());
  else if (method == "openAxe.setBypass") result = HandleSetBypass(args.dump());
  else if (method == "openAxe.setBlockTrim") result = HandleSetBlockTrim(args.dump());
  else if (method == "openAxe.meters") result = HandleMeters(args.dump());
  else if (method == "openAxe.cpuLoad") result = HandleCpuLoad(args.dump());
  else if (method == "openAxe.loadModel") result = HandleLoadModel(args.dump());
  else if (method == "openAxe.loadModelJson") result = HandleLoadModelJson(args.dump());
  else if (method == "openAxe.unloadModel") result = HandleUnloadModel(args.dump());
  else if (method == "openAxe.setReverbAlgorithm") result = HandleSetReverbAlgorithm(args.dump());
  else if (method == "openAxe.setDelayModel") result = HandleSetDelayModel(args.dump());
  else if (method == "openAxe.loadIrWav") result = HandleLoadIrWav(args.dump());
  else if (method == "openAxe.unloadIr") result = HandleUnloadIr(args.dump());
  else if (method == "openAxe.secureStore") result = HandleSecureStore(args.dump());
  else if (method == "openAxe.secureLoad") result = HandleSecureLoad(args.dump());
  else if (method == "openAxe.secureDelete") result = HandleSecureDelete(args.dump());
  else if (method == "openAxe.takeStreamError") result = HandleTakeStreamError(args.dump());
  else if (method == "openAxe.getTap") result = (json{{"l", json::array()}, {"r", json::array()}, {"frames", 0}}).dump();
  else if (method == "openAxe.setInputGain") result = (json{{"ok", true}}).dump();
  else if (method == "openAxe.setTunerMuted") result = (json{{"ok", true}}).dump();
  else result = JsonError("unknown method: " + method);

  if (id >= 0) {
    // Wrap for polyfill resolver: caller will do EvaluateJavaScript("window.IPlugWebViewResolve(id, 'result')")
    // We return a small JSON envelope the plugin's OnMessage can use to call the resolver.
    // For simplicity, return result directly and let the C++ side handle wrapping.
    // Here we just return result; the plugin will wrap it.
    return result;
  }
  return result;
}

std::string VstBridge::HandleVersion(const std::string&) {
  // Generated from the root VERSION file (issue #300 E6) — this used to be a
  // hard-coded "0.1.0" that disagreed with both VERSION and the update check.
  return json(OPENAXE_VERSION_STR).dump();
}
std::string VstBridge::HandleListDevices(const std::string&) { return json::array().dump(); }
std::string VstBridge::HandleGetConfig(const std::string&) {
  // Report the HOST's real sample rate and block size (issue #300 E2). These
  // used to be hard-coded 48000/512 behind a comment claiming
  // Plugin::GetSampleRate wasn't public — it is, on IPlugProcessor. At 44.1 or
  // 96 kHz the UI showed the wrong rate and everything the app derives from it
  // (tempo-synced delay times, the tuner, latency readouts) was wrong by that
  // ratio.
  //
  // `shell` tells the React app which native shell it is talking to (issue
  // #300 E1). The app's own check is only "is there a bridge?", which in the
  // plugin resolved to "desktop" and put audio-device pickers, a power gate
  // and buffer-size controls in front of a user whose DAW owns all three.
  // ownsAudioDevice is the property the UI should actually branch on.
  const double sr = plugin_ ? plugin_->GetSampleRate() : 0.0;
  const int bs = plugin_ ? plugin_->GetBlockSize() : 0;
  return (json{{"ok", true},
               {"shell", "plugin"},
               {"ownsAudioDevice", false},
               {"open", true},
               {"running", true},
               {"sampleRate", sr},
               {"bufferFrames", bs},
               {"latencyFrames", 0},
               {"latencyMs", 0.0},
               {"lastError", ""},
               {"cpuLoad", graph_ ? nam_studio_get_cpu_load(graph_) : 0.0}})
      .dump();
}

std::string VstBridge::HandleAddBlock(const std::string& req) {
  try {
    json args = ParseArgs(req); json o = args.empty()? json::object(): args[0];
    std::string kind = o.value("kind", ""); int row = o.value("row", 0); int col = o.value("col", 0); std::string jsId = o.value("id", "");
    if (jsId.empty()) {
      std::lock_guard<std::mutex> lock(mutex_);
      jsId = "block-" + std::to_string(++nextBlockId_);
    }
    if (!graph_) return JsonError("no graph");
    // Map kind string to core
    NamStudioBlockKind k;
    if (kind=="noise-gate") k=NAM_STUDIO_BLOCK_NOISE_GATE;
    else if(kind=="compressor") k=NAM_STUDIO_BLOCK_COMPRESSOR;
    else if(kind=="eq") k=NAM_STUDIO_BLOCK_EQ;
    else if(kind=="chorus") k=NAM_STUDIO_BLOCK_CHORUS;
    else if(kind=="flanger") k=NAM_STUDIO_BLOCK_FLANGER;
    else if(kind=="phaser") k=NAM_STUDIO_BLOCK_PHASER;
    else if(kind=="tremolo") k=NAM_STUDIO_BLOCK_TREMOLO;
    else if(kind=="ring-mod") k=NAM_STUDIO_BLOCK_RING_MOD;
    else if(kind=="filter") k=NAM_STUDIO_BLOCK_FILTER;
    else if(kind=="pitch-shifter") k=NAM_STUDIO_BLOCK_PITCH_SHIFTER;
    else if(kind=="granular-delay") k=NAM_STUDIO_BLOCK_GRANULAR_DELAY;
    else if(kind=="rotary") k=NAM_STUDIO_BLOCK_ROTARY;
    else if(kind=="delay") k=NAM_STUDIO_BLOCK_DELAY;
    else if(kind=="ping-pong-delay") k=NAM_STUDIO_BLOCK_PING_PONG_DELAY;
    else if(kind=="reverb") k=NAM_STUDIO_BLOCK_REVERB;
    else if(kind=="amp") k=NAM_STUDIO_BLOCK_AMP;
    else if(kind=="amp-cab") k=NAM_STUDIO_BLOCK_AMP_CAB;
    else if(kind=="pedal") k=NAM_STUDIO_BLOCK_PEDAL;
    else if(kind=="outboard") k=NAM_STUDIO_BLOCK_OUTBOARD;
    else if(kind=="space") k=NAM_STUDIO_BLOCK_SPACE;
    else if(kind=="cab") k=NAM_STUDIO_BLOCK_CAB;
    else if(kind=="mixer") k=NAM_STUDIO_BLOCK_MIXER;
    else if(kind=="splitter") k=NAM_STUDIO_BLOCK_SPLITTER;
    else if(kind=="send-1") k=NAM_STUDIO_BLOCK_SEND_1;
    else if(kind=="return-1") k=NAM_STUDIO_BLOCK_RETURN_1;
    else if(kind=="send-2") k=NAM_STUDIO_BLOCK_SEND_2;
    else if(kind=="return-2") k=NAM_STUDIO_BLOCK_RETURN_2;
    else return JsonError("unknown kind: "+kind);
    int32_t coreId = -1;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (blockIds_.count(jsId)) return JsonError("id exists");
    }
    if (plugin_) plugin_->WithSuspend([&]{ coreId = nam_studio_add_block(graph_, k, row, col); });
    else coreId = nam_studio_add_block(graph_, k, row, col);
    if (coreId < 0) return JsonError("add_block failed");
    {
      std::lock_guard<std::mutex> lock(mutex_);
      blockIds_[jsId]=coreId; blockKinds_[coreId]=kind; blockPos_[jsId]={row,col};
    }
    return (json{{"ok", true}, {"id", jsId}}).dump();
  } catch(std::exception& e){ return JsonError(e.what()); }
}
std::string VstBridge::HandleRemoveBlock(const std::string& req){
  try{ json args=ParseArgs(req); json o=args.empty()? json::object():args[0]; std::string jsId=o.value("blockId",""); int32_t coreId=-1; { std::lock_guard<std::mutex> lock(mutex_); auto it=blockIds_.find(jsId); if(it==blockIds_.end()) return (json{{"ok", true}}).dump(); coreId=it->second; } if(plugin_) plugin_->WithSuspend([&]{ nam_studio_remove_block(graph_, coreId); }); else nam_studio_remove_block(graph_, coreId); { std::lock_guard<std::mutex> lock(mutex_); blockIds_.erase(jsId); blockKinds_.erase(coreId); blockPos_.erase(jsId); } return (json{{"ok", true}}).dump(); }catch(...){ return JsonError("removeBlock failed"); }
}
std::string VstBridge::HandleMoveBlock(const std::string& req){
  try{ json args=ParseArgs(req); json o=args.empty()? json::object():args[0]; std::string jsId=o.value("blockId",""); int row=o.value("row",0); int col=o.value("col",0); int32_t coreId=-1; { std::lock_guard<std::mutex> lock(mutex_); auto it=blockIds_.find(jsId); if(it==blockIds_.end()) return JsonError("unknown block"); coreId=it->second; } if(plugin_) plugin_->WithSuspend([&]{ nam_studio_move_block(graph_, coreId, row, col); }); else nam_studio_move_block(graph_, coreId, row, col); { std::lock_guard<std::mutex> lock(mutex_); blockPos_[jsId]={row,col}; } return (json{{"ok", true}}).dump(); }catch(...){ return JsonError("moveBlock failed"); }
}
std::string VstBridge::HandleConnect(const std::string& req){
  try{ json args=ParseArgs(req); json o=args.empty()? json::object():args[0]; std::string jsEdge=o.value("id",""); int fromPort=o.value("fromPort",0); int toPort=o.value("toPort",0); auto resolve=[&](const json& j)->int32_t{ if(j.is_number()) return j.get<int32_t>(); if(j.is_string()){ std::string s=j.get<std::string>(); if(s=="IN"||s=="-1") return NAM_STUDIO_IN_RAIL; if(s=="OUT"||s=="-2") return NAM_STUDIO_OUT_RAIL; std::lock_guard<std::mutex> lock(mutex_); auto it=blockIds_.find(s); if(it!=blockIds_.end()) return it->second; } return -999; }; int32_t from=resolve(o.at("fromId")); int32_t to=resolve(o.at("toId")); if(from==-999||to==-999) return JsonError("unknown block in edge"); if(jsEdge.empty()){ std::lock_guard<std::mutex> lock(mutex_); jsEdge="edge-"+std::to_string(++nextEdgeId_); } int32_t coreEdge=-1; if(plugin_) plugin_->WithSuspend([&]{ coreEdge=nam_studio_connect(graph_, from, fromPort, to, toPort); }); else coreEdge=nam_studio_connect(graph_, from, fromPort, to, toPort); if(coreEdge<0) return JsonError("connection rejected"); { std::lock_guard<std::mutex> lock(mutex_); edgeIds_[jsEdge]=coreEdge;
      auto asId=[](const json& j){ return j.is_string()? j.get<std::string>() : j.dump(); };
      edgeEndpoints_[jsEdge]=EdgeEndpoints{asId(o.at("fromId")), asId(o.at("toId")), fromPort, toPort}; } return (json{{"ok", true}, {"id", jsEdge}}).dump(); }catch(std::exception& e){ return JsonError(e.what()); }
}
std::string VstBridge::HandleDisconnect(const std::string& req){
  try{ json args=ParseArgs(req); json o=args.empty()? json::object():args[0]; std::string jsEdge=o.value("edgeId",""); int32_t coreEdge=-1; { std::lock_guard<std::mutex> lock(mutex_); auto it=edgeIds_.find(jsEdge); if(it==edgeIds_.end()) return (json{{"ok", true}}).dump(); coreEdge=it->second; } if(plugin_) plugin_->WithSuspend([&]{ nam_studio_disconnect(graph_, coreEdge); }); else nam_studio_disconnect(graph_, coreEdge); { std::lock_guard<std::mutex> lock(mutex_); edgeIds_.erase(jsEdge); edgeEndpoints_.erase(jsEdge); } return (json{{"ok", true}}).dump(); }catch(...){ return JsonError("disconnect failed"); }
}
std::string VstBridge::HandleSetParam(const std::string& req){
  try{ json args=ParseArgs(req); json o=args.empty()? json::object():args[0]; std::string jsId=o.value("blockId",""); json key=o.at("key"); float value=o.value("value",0.0f); int32_t coreId=-1; { std::lock_guard<std::mutex> lock(mutex_); auto it=blockIds_.find(jsId); if(it==blockIds_.end()) return JsonError("unknown block"); coreId=it->second; } int32_t idx=ResolveParamIndexJson(key, coreId, graph_); if(idx<0) return JsonError("unknown param"); nam_studio_set_param(graph_, coreId, idx, value); return (json{{"ok", true}}).dump(); }catch(std::exception& e){ return JsonError(e.what()); }
}
std::string VstBridge::HandleGetParam(const std::string& req){
  try{ json args=ParseArgs(req); json o=args.empty()? json::object():args[0]; std::string jsId=o.value("blockId",""); json key=o.at("key"); int32_t coreId=-1; { std::lock_guard<std::mutex> lock(mutex_); auto it=blockIds_.find(jsId); if(it==blockIds_.end()) return JsonError("unknown block"); coreId=it->second; } int32_t idx=ResolveParamIndexJson(key, coreId, graph_); if(idx<0) return JsonError("unknown param"); float v=nam_studio_get_param(graph_, coreId, idx); return (json{{"ok", true}, {"value", v}}).dump(); }catch(std::exception& e){ return JsonError(e.what()); }
}
std::string VstBridge::HandleBlockInfo(const std::string& req){
  try{ json args=ParseArgs(req); json o=args.empty()? json::object():args[0]; std::string jsId=o.value("blockId",""); int32_t coreId=-1; std::string kind; int row=0,col=0; { std::lock_guard<std::mutex> lock(mutex_); auto it=blockIds_.find(jsId); if(it==blockIds_.end()) return JsonError("unknown block"); coreId=it->second; auto kIt=blockKinds_.find(coreId); if(kIt!=blockKinds_.end()) kind=kIt->second; auto pIt=blockPos_.find(jsId); if(pIt!=blockPos_.end()){ row=pIt->second.first; col=pIt->second.second; } } int32_t n=nam_studio_block_param_count(graph_, coreId); json params=json::array(); for(int32_t i=0;i<n;++i){ const char* name=nullptr; const char* sym=nullptr; const char* unit=nullptr; float mn=0,mx=0; if(!nam_studio_block_param_info(graph_, coreId, i, &name, &sym, &mn, &mx, &unit)) continue; params.push_back({{"index", i}, {"name", name?name:""}, {"symbol", sym?sym:""}, {"min", mn}, {"max", mx}, {"unit", unit?unit:""}, {"value", nam_studio_get_param(graph_, coreId, i)}}); } return (json{{"ok", true}, {"id", jsId}, {"kind", kind}, {"row", row}, {"col", col}, {"hasModel", nam_studio_block_has_model(graph_, coreId)!=0}, {"paramCount", n}, {"params", params}, {"meter", nam_studio_get_meter(graph_, coreId)}}).dump(); }catch(std::exception& e){ return JsonError(e.what()); }
}
std::string VstBridge::HandleListBlocks(const std::string&){
  std::lock_guard<std::mutex> lock(mutex_); json out=json::array(); for(auto& [jsId, coreId]: blockIds_){ auto kIt=blockKinds_.find(coreId); std::string kind=kIt!=blockKinds_.end()?kIt->second:"unknown"; auto pIt=blockPos_.find(jsId); int row=0,col=0; if(pIt!=blockPos_.end()){ row=pIt->second.first; col=pIt->second.second; } out.push_back({{"id", jsId}, {"kind", kind}, {"row", row}, {"col", col}}); } return out.dump();
}
std::string VstBridge::HandleListEdges(const std::string&) {
  std::lock_guard<std::mutex> lock(mutex_);
  json out = json::array();
  for (const auto& [jsEdge, coreEdge] : edgeIds_) {
    (void)coreEdge;
    const auto it = edgeEndpoints_.find(jsEdge);
    if (it == edgeEndpoints_.end()) continue;
    const EdgeEndpoints& ep = it->second;
    out.push_back({{"id", jsEdge},
                   {"from", {{"id", ep.fromId}, {"port", ep.fromPort}}},
                   {"to", {{"id", ep.toId}, {"port", ep.toPort}}}});
  }
  return out.dump();
}

std::string VstBridge::HandleSetMasterLevel(const std::string& req){ try{ json args=ParseArgs(req); json o=args.empty()?json::object():args[0]; float v=o.value("level",1.0f); nam_studio_set_master_level(graph_, v); return (json{{"ok", true}}).dump(); }catch(...){ return JsonError("setMasterLevel failed"); } }
std::string VstBridge::HandleSetMasterMuted(const std::string& req){ try{ json args=ParseArgs(req); json o=args.empty()?json::object():args[0]; bool m=o.value("muted",false); nam_studio_set_master_muted(graph_, m?1:0); return (json{{"ok", true}}).dump(); }catch(...){ return JsonError("setMasterMuted failed"); } }
std::string VstBridge::HandleSetBypass(const std::string& req){ try{ json args=ParseArgs(req); json o=args.empty()?json::object():args[0]; std::string jsId=o.value("blockId",""); bool b=o.value("bypassed",false); int32_t coreId=-1; { std::lock_guard<std::mutex> lock(mutex_); auto it=blockIds_.find(jsId); if(it==blockIds_.end()) return JsonError("unknown block"); coreId=it->second; } nam_studio_set_bypass(graph_, coreId, b?1:0); return (json{{"ok", true}}).dump(); }catch(...){ return JsonError("setBypass failed"); } }
std::string VstBridge::HandleSetBlockTrim(const std::string& req){ try{ json args=ParseArgs(req); json o=args.empty()?json::object():args[0]; std::string jsId=o.value("blockId",""); bool hasIn=o.contains("input"); bool hasOut=o.contains("output"); float inVal=hasIn?o["input"].get<float>():1.0f; float outVal=hasOut?o["output"].get<float>():1.0f; int32_t coreId=-1; { std::lock_guard<std::mutex> lock(mutex_); auto it=blockIds_.find(jsId); if(it==blockIds_.end()) return JsonError("unknown block"); coreId=it->second; } if(hasIn) nam_studio_set_block_input_trim(graph_, coreId, inVal); if(hasOut) nam_studio_set_block_output_trim(graph_, coreId, outVal); return (json{{"ok", true}}).dump(); }catch(...){ return JsonError("setBlockTrim failed"); } }
std::string VstBridge::HandleMeters(const std::string&){ std::lock_guard<std::mutex> lock(mutex_); json out=json::array(); for(auto& [jsId, coreId]: blockIds_){ out.push_back({{"id", jsId}, {"value", nam_studio_get_meter(graph_, coreId)}}); } return out.dump(); }
std::string VstBridge::HandleCpuLoad(const std::string&){ float v=graph_? nam_studio_get_cpu_load(graph_):0.0f; return json(v).dump(); }
std::string VstBridge::HandleLoadModel(const std::string&){ return (json{{"ok", false}, {"canceled", true}}).dump(); }
std::string VstBridge::HandleLoadModelJson(const std::string& req){ try{ json args=ParseArgs(req); json o=args.empty()?json::object():args[0]; std::string jsId=o.value("blockId",""); std::string content=o.value("json",""); int32_t coreId=-1; { std::lock_guard<std::mutex> lock(mutex_); auto it=blockIds_.find(jsId); if(it==blockIds_.end()) return JsonError("unknown block"); coreId=it->second; } int r=-1; if(plugin_) plugin_->WithSuspend([&]{ r=nam_studio_load_nam_model_json(graph_, coreId, content.c_str()); }); else r=nam_studio_load_nam_model_json(graph_, coreId, content.c_str()); return (json{{"ok", r==0}, {"result", r}}).dump(); }catch(std::exception& e){ return JsonError(e.what()); } }
std::string VstBridge::HandleUnloadModel(const std::string& req){ try{ json args=ParseArgs(req); json o=args.empty()?json::object():args[0]; std::string jsId=o.value("blockId",""); int32_t coreId=-1; { std::lock_guard<std::mutex> lock(mutex_); auto it=blockIds_.find(jsId); if(it==blockIds_.end()) return JsonError("unknown block"); coreId=it->second; } if(plugin_) plugin_->WithSuspend([&]{ nam_studio_unload_nam_model(graph_, coreId); }); else nam_studio_unload_nam_model(graph_, coreId); return (json{{"ok", true}}).dump(); }catch(...){ return JsonError("unloadModel failed"); } }
std::string VstBridge::HandleSetReverbAlgorithm(const std::string& req){ try{ json args=ParseArgs(req); json o=args.empty()?json::object():args[0]; std::string jsId=o.value("blockId",""); std::string alg=o.value("algorithm",""); NamStudioReverbAlgorithm a=NAM_STUDIO_REVERB_HALL; if(alg=="hall") a=NAM_STUDIO_REVERB_HALL; else if(alg=="room") a=NAM_STUDIO_REVERB_ROOM; else if(alg=="plate") a=NAM_STUDIO_REVERB_PLATE; else if(alg=="earlyReflections") a=NAM_STUDIO_REVERB_EARLY_REFLECTIONS; else return JsonError("unknown alg"); int32_t coreId=-1; { std::lock_guard<std::mutex> lock(mutex_); auto it=blockIds_.find(jsId); if(it==blockIds_.end()) return JsonError("unknown block"); coreId=it->second; } if(plugin_) plugin_->WithSuspend([&]{ nam_studio_set_reverb_algorithm(graph_, coreId, a); }); else nam_studio_set_reverb_algorithm(graph_, coreId, a); return (json{{"ok", true}}).dump(); }catch(...){ return JsonError("setReverbAlgorithm failed"); } }
std::string VstBridge::HandleSetDelayModel(const std::string& req){ try{ json args=ParseArgs(req); json o=args.empty()?json::object():args[0]; std::string jsId=o.value("blockId",""); std::string m=o.value("model",""); NamStudioDelayModel dm=NAM_STUDIO_DELAY_DIGITAL; if(m=="digital") dm=NAM_STUDIO_DELAY_DIGITAL; else if(m=="analog") dm=NAM_STUDIO_DELAY_ANALOG; else if(m=="tape") dm=NAM_STUDIO_DELAY_TAPE; else return JsonError("unknown model"); int32_t coreId=-1; { std::lock_guard<std::mutex> lock(mutex_); auto it=blockIds_.find(jsId); if(it==blockIds_.end()) return JsonError("unknown block"); coreId=it->second; } if(plugin_) plugin_->WithSuspend([&]{ nam_studio_set_delay_model(graph_, coreId, dm); }); else nam_studio_set_delay_model(graph_, coreId, dm); return (json{{"ok", true}}).dump(); }catch(...){ return JsonError("setDelayModel failed"); } }
std::string VstBridge::HandleLoadIrWav(const std::string& req) {
  // Was a hard error string, so cab IRs could not be loaded from the plugin UI
  // at all (issue #300 E4). Mirrors the desktop bridge: decode, sanity-check the
  // container, then hand the bytes to the plugin's Tier-2 loader, which applies
  // the size guard and suspends around the core call.
  try {
    json args = ParseArgs(req);
    json o = args.empty() ? json::object() : args[0];
    const std::string jsId = o.value("blockId", "");
    const std::string encoded = o.value("wavBase64", "");
    if (encoded.empty()) return JsonError("loadIrWav: no wav data");

    const std::vector<uint8_t> bytes = assets::DecodeBase64(encoded);
    if (bytes.empty()) return JsonError("loadIrWav: could not decode the base64 payload");
    // Reject anything that isn't a RIFF/WAVE container before the core tries to
    // decode it (issue #69).
    if (bytes.size() < 12 || std::memcmp(bytes.data(), "RIFF", 4) != 0 ||
        std::memcmp(bytes.data() + 8, "WAVE", 4) != 0) {
      return JsonError("loadIrWav: not a WAV file");
    }

    int32_t coreId = -1;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      auto it = blockIds_.find(jsId);
      if (it == blockIds_.end()) return JsonError("unknown block: " + jsId);
      coreId = it->second;
    }
    if (!plugin_) return JsonError("loadIrWav: no plugin");
    std::string error;
    // LoadIrWavFromBytes already wraps the core call in WithSuspend.
    const int result = plugin_->LoadIrWavFromBytes(coreId, bytes, &error);
    if (result != 0) {
      const char* why = assets::ToString(static_cast<assets::LoadResult>(result));
      return JsonError(error.empty() ? std::string("loadIrWav: ") + (why ? why : "failed") : error);
    }
    return (json{{"ok", true}}).dump();
  } catch (std::exception& e) {
    return JsonError(std::string("loadIrWav: ") + e.what());
  }
}
std::string VstBridge::HandleUnloadIr(const std::string& req){ try{ json args=ParseArgs(req); json o=args.empty()?json::object():args[0]; std::string jsId=o.value("blockId",""); int32_t coreId=-1; { std::lock_guard<std::mutex> lock(mutex_); auto it=blockIds_.find(jsId); if(it==blockIds_.end()) return JsonError("unknown block"); coreId=it->second; } if(plugin_) plugin_->WithSuspend([&]{ nam_studio_unload_ir(graph_, coreId); }); else nam_studio_unload_ir(graph_, coreId); return (json{{"ok", true}}).dump(); }catch(...){ return JsonError("unloadIr failed"); } }
// The Tone3000 refresh token goes to the platform keychain, the same module and
// service name the desktop shell uses — so signing in once covers both, and the
// token survives closing the plugin. It used to live in a std::map that died
// with the instance, so every project reload meant signing in again, and two
// instances each had their own copy (issue #300 D4).
std::string VstBridge::HandleSecureStore(const std::string& req) {
  try {
    json args = ParseArgs(req);
    json o = args.empty() ? json::object() : args[0];
    const std::string k = o.value("key", ""), v = o.value("value", "");
    if (!IsValidSecretKey(k)) return JsonError("invalid key");
    std::string error;
    if (!openaxe::secure_storage::Store(k, v, &error)) return JsonError("secureStore: " + error);
    return (json{{"ok", true}}).dump();
  } catch (...) { return JsonError("secureStore failed"); }
}
std::string VstBridge::HandleSecureLoad(const std::string& req) {
  try {
    json args = ParseArgs(req);
    json o = args.empty() ? json::object() : args[0];
    const std::string k = o.value("key", "");
    if (!IsValidSecretKey(k)) return JsonError("invalid key");
    std::string error;
    const auto value = openaxe::secure_storage::Load(k, &error);
    if (!value) {
      // Absent is not an error — the UI treats a null value as "not signed in".
      return (json{{"ok", true}, {"value", nullptr}}).dump();
    }
    return (json{{"ok", true}, {"value", *value}}).dump();
  } catch (...) { return JsonError("secureLoad failed"); }
}
std::string VstBridge::HandleSecureDelete(const std::string& req) {
  try {
    json args = ParseArgs(req);
    json o = args.empty() ? json::object() : args[0];
    const std::string k = o.value("key", "");
    if (!IsValidSecretKey(k)) return JsonError("invalid key");
    std::string error;
    if (!openaxe::secure_storage::Delete(k, &error)) return JsonError("secureDelete: " + error);
    return (json{{"ok", true}}).dump();
  } catch (...) { return JsonError("secureDelete failed"); }
}
std::string VstBridge::HandleTakeStreamError(const std::string&){ return (json{{"error", nullptr}}).dump(); }

}  // namespace openaxe_vst3
