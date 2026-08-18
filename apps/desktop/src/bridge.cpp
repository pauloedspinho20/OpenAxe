#include "bridge.h"

#include <nlohmann/json.hpp>
#include <portable-file-dialogs.h>

#include <filesystem>
#include <fstream>
#include <optional>
#include <system_error>
#include <utility>

#include "debug_log.h"
#include "nam_studio/api.h"
#include "nam_studio/core.h"

namespace nam_desktop {

using nlohmann::json;

namespace {

// webview passes the bound JS call's arguments as one JSON array string;
// tolerate a bare value too.
json ParseArgs(const std::string& req) {
  json j = json::parse(req, nullptr, false);
  if (j.is_discarded()) return json::array();
  if (j.is_array()) return j;
  return json::array({j});
}

std::string JsonError(const std::string& message) {
  return (json{{"ok", false}, {"error", message}}).dump();
}

struct KindEntry {
  const char* web;
  NamStudioBlockKind core;
};
constexpr KindEntry kKinds[] = {
    {"noise-gate", NAM_STUDIO_BLOCK_NOISE_GATE},
    {"compressor", NAM_STUDIO_BLOCK_COMPRESSOR},
    {"eq", NAM_STUDIO_BLOCK_EQ},
    {"chorus", NAM_STUDIO_BLOCK_CHORUS},
    {"flanger", NAM_STUDIO_BLOCK_FLANGER},
    {"phaser", NAM_STUDIO_BLOCK_PHASER},
    {"tremolo", NAM_STUDIO_BLOCK_TREMOLO},
    {"delay", NAM_STUDIO_BLOCK_DELAY},
    {"ping-pong-delay", NAM_STUDIO_BLOCK_PING_PONG_DELAY},
    {"reverb", NAM_STUDIO_BLOCK_REVERB},
    {"amp", NAM_STUDIO_BLOCK_AMP},
    {"amp-cab", NAM_STUDIO_BLOCK_AMP_CAB},
    {"pedal", NAM_STUDIO_BLOCK_PEDAL},
    {"outboard", NAM_STUDIO_BLOCK_OUTBOARD},
    {"space", NAM_STUDIO_BLOCK_SPACE},
    {"cab", NAM_STUDIO_BLOCK_CAB},
    {"mixer", NAM_STUDIO_BLOCK_MIXER},
    {"splitter", NAM_STUDIO_BLOCK_SPLITTER},
};

std::optional<NamStudioBlockKind> WebToCoreKind(const std::string& web) {
  for (const auto& e : kKinds)
    if (web == e.web) return e.core;
  return std::nullopt;
}

const char* CoreToWebKind(NamStudioBlockKind core) {
  for (const auto& e : kKinds)
    if (core == e.core) return e.web;
  return "unknown";
}

template <typename E>
std::optional<E> MapByName(const std::string& name, const std::pair<const char*, E>* table,
                           size_t n) {
  for (size_t i = 0; i < n; ++i)
    if (name == table[i].first) return table[i].second;
  return std::nullopt;
}

// -3 = unknown (a real core id is never < -2).
constexpr int32_t kUnknownBlock = -3;

}  // namespace

// ── Control executor ────────────────────────────────────────────────────

StudioBridge::StudioBridge() {
  graph_ = nam_studio_graph_create();
  audio_.SetGraph(graph_, graph_sample_rate_, graph_block_);
  control_thread_ = std::thread(&StudioBridge::ControlLoop, this);
}

StudioBridge::~StudioBridge() {
  {
    std::lock_guard<std::mutex> lock(queue_mutex_);
    control_stop_.store(true, std::memory_order_release);
  }
  queue_cv_.notify_all();
  if (control_thread_.joinable()) control_thread_.join();
  nam_studio_graph_destroy(graph_);
}

void StudioBridge::Submit(std::function<void()> task) {
  {
    std::lock_guard<std::mutex> lock(queue_mutex_);
    queue_.push_back(std::move(task));
  }
  queue_cv_.notify_one();
}

void StudioBridge::Call(std::function<void()> task) {
  std::mutex done_mutex;
  std::condition_variable done_cv;
  bool done = false;
  Submit([&] {
    try {
      task();
    } catch (...) {
      // Never let a handler exception kill the control thread; handlers
      // already translate core errors into JSON, so reaching here means a
      // programming bug that should not take the app down.
    }
    {
      std::lock_guard<std::mutex> lock(done_mutex);
      done = true;
    }
    done_cv.notify_one();
  });
  std::unique_lock<std::mutex> lock(done_mutex);
  done_cv.wait(lock, [&] { return done; });
}

void StudioBridge::ControlLoop() {
  for (;;) {
    std::function<void()> task;
    {
      std::unique_lock<std::mutex> lock(queue_mutex_);
      queue_cv_.wait(lock, [&] { return control_stop_.load() || !queue_.empty(); });
      if (control_stop_.load() && queue_.empty()) return;
      task = std::move(queue_.front());
      queue_.pop_front();
    }
    task();
  }
}

void StudioBridge::Mutate(const std::function<void()>& mutation, bool reset_after) {
  const bool suspended_cleanly = audio_.BeginSuspend();
  mutation();
  if (reset_after) nam_studio_reset(graph_, graph_sample_rate_, graph_block_);
  audio_.EndSuspend();
  if (!suspended_cleanly) {
    // BeginSuspend timed out waiting for the callback to observe the pause and
    // force-stopped the stream so this mutation could still run safely. The
    // stream is now open but not running - without this, audio would stay
    // silently (and permanently) dead until something else happened to call
    // Start() again (issue #43).
    WriteLog("bridge: suspend handshake timed out; restarting the audio stream");
    if (!audio_.Start()) {
      WriteLog("bridge: failed to restart audio stream after suspend timeout: " +
               audio_.LastError());
    }
  }
}

// Resolves a JS jack endpoint to a core block id: a number rail sentinel
// (-1/-2), a "-1"/"-2"/"IN"/"OUT" string, or a known block js id. Returns
// kUnknownBlock for anything unrecognised. Must run on the control thread
// (reads blocks_).
int32_t ResolveCoreId(const json& id_json, const std::map<std::string, BlockRecord>& blocks) {
  if (id_json.is_number()) return id_json.get<int32_t>();
  if (!id_json.is_string()) return kUnknownBlock;
  const std::string s = id_json.get<std::string>();
  if (s == "-1" || s == "IN") return NAM_STUDIO_IN_RAIL;
  if (s == "-2" || s == "OUT") return NAM_STUDIO_OUT_RAIL;
  const auto it = blocks.find(s);
  return it == blocks.end() ? kUnknownBlock : it->second.core_id;
}

std::string StudioBridge::GenBlockId() {
  return "block-" + std::to_string(auto_block_id_.fetch_add(1));
}

std::string StudioBridge::GenEdgeId() {
  return "edge-" + std::to_string(auto_edge_id_.fetch_add(1));
}

void StudioBridge::DropEdgesTouching(const std::string& block_id) {
  // Called after core RemoveBlock already dropped the edges; this only cleans
  // up the bridge's own bookkeeping. Iterate a snapshot: erasing while
  // iterating would invalidate the map iterator.
  std::vector<std::string> doomed;
  for (const auto& [edge_id, edge] : edges_) {
    const bool from_matches = edge.from_id.is_string() && edge.from_id.get<std::string>() == block_id;
    const bool to_matches = edge.to_id.is_string() && edge.to_id.get<std::string>() == block_id;
    if (from_matches || to_matches) doomed.push_back(edge_id);
  }
  for (const std::string& edge_id : doomed) {
    const auto it = edge_ids_.find(edge_id);
    if (it != edge_ids_.end()) {
      edge_ids_rev_.erase(it->second);
      edge_ids_.erase(it);
    }
    edges_.erase(edge_id);
  }
}

// ── Handlers ────────────────────────────────────────────────────────────

std::string StudioBridge::HandleVersion(const std::string&) {
  return json(nam_studio::core::version()).dump();
}

std::string StudioBridge::HandleListDevices(const std::string&) {
  json out = json::array();
  for (const auto& d : audio_.ListDevices()) {
    out.push_back({{"id", d.id},
                   {"name", d.name},
                   {"api", d.api},
                   {"isDefault", d.is_default},
                   {"inputChannels", d.input_channels},
                   {"outputChannels", d.output_channels},
                   {"preferredSampleRate", d.preferred_sample_rate},
                   {"isInput", d.is_input},
                   {"isOutput", d.is_output}});
  }
  return out.dump();
}

std::string StudioBridge::HandleGetConfig(const std::string&) {
  // latencyFrames is RtAudio's reported device round-trip (input + output
  // buffering), -1 when the backend can't report it or nothing is open; the ms
  // figure is derived from it so the UI can show real measured latency rather
  // than an estimate from the block size alone.
  const long latency_frames = audio_.IsOpen() ? audio_.StreamLatencyFrames() : -1;
  const double rate = audio_.SampleRate();
  json out = {{"ok", true},
              {"open", audio_.IsOpen()},
              {"running", audio_.IsRunning()},
              {"sampleRate", rate},
              {"bufferFrames", audio_.BufferFrames()},
              {"latencyFrames", latency_frames},
              {"latencyMs", latency_frames > 0 && rate > 0.0
                                ? 1000.0 * static_cast<double>(latency_frames) / rate
                                : -1.0},
              {"lastError", audio_.LastError()},
              {"cpuLoad", nam_studio_get_cpu_load(graph_)}};
  return out.dump();
}

std::string StudioBridge::HandleOpen(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const unsigned int input_device = o.value("inputDeviceId", 0xFFFFFFFFu);
    const unsigned int output_device = o.value("outputDeviceId", 0xFFFFFFFFu);
    const double sample_rate = o.value("sampleRate", 48000.0);
    // 0 asks the device for the smallest block it supports (lowest possible
    // round-trip); anything else is a requested block size the backend may
    // still adjust. The reply reports what was actually granted.
    const unsigned int buffer_frames = o.value("bufferFrames", 128u);

    if (!audio_.Open(input_device, output_device, sample_rate, buffer_frames)) {
      return JsonError("open failed: " + audio_.LastError());
    }
    graph_sample_rate_ = audio_.SampleRate();
    graph_block_ = static_cast<int32_t>(audio_.BufferFrames());
    // Re-arm the graph at the stream's actual parameters. Stream is open but
    // not started, so no audio thread is touching the graph yet.
    Call([this] { audio_.SetGraph(graph_, graph_sample_rate_, graph_block_); });
    const long latency_frames = audio_.StreamLatencyFrames();
    return (json{{"ok", true},
                 {"sampleRate", audio_.SampleRate()},
                 {"bufferFrames", audio_.BufferFrames()},
                 {"latencyFrames", latency_frames},
                 {"latencyMs", latency_frames > 0 && audio_.SampleRate() > 0.0
                                   ? 1000.0 * static_cast<double>(latency_frames) / audio_.SampleRate()
                                   : -1.0}})
        .dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("open: ") + e.what());
  }
}

std::string StudioBridge::HandleClose(const std::string&) {
  audio_.Close();
  return (json{{"ok", true}}).dump();
}

std::string StudioBridge::HandleStart(const std::string&) {
  if (!audio_.Start()) return JsonError("start failed: " + audio_.LastError());
  return (json{{"ok", true}}).dump();
}

std::string StudioBridge::HandleStop(const std::string&) {
  if (!audio_.Stop()) return JsonError("stop failed: " + audio_.LastError());
  return (json{{"ok", true}}).dump();
}

std::string StudioBridge::HandleAddBlock(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string kind = o.value("kind", "");
    const int row = o.value("row", 0);
    const int col = o.value("col", 0);
    std::string js_id = o.value("id", "");
    if (js_id.empty()) js_id = GenBlockId();

    const auto core_kind = WebToCoreKind(kind);
    if (!core_kind) return JsonError("unknown block kind: " + kind);

    std::string error;
    json out;
    Call([&] {
      if (blocks_.count(js_id)) {
        error = "block id already exists: " + js_id;
        return;
      }
      int32_t core_id = -1;
      Mutate([&] { core_id = nam_studio_add_block(graph_, *core_kind, row, col); }, true);
      if (core_id < 0) {
        error = "failed to add block";
        return;
      }
      blocks_[js_id] = BlockRecord{core_id, kind, row, col};
      out = json{{"ok", true}, {"id", js_id}};
    });
    return error.empty() ? out.dump() : JsonError(error);
  } catch (const std::exception& e) {
    return JsonError(std::string("addBlock: ") + e.what());
  }
}

std::string StudioBridge::HandleRemoveBlock(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string js_id = o.value("blockId", "");
    Call([&] {
      auto it = blocks_.find(js_id);
      if (it == blocks_.end()) return;
      Mutate([&] { nam_studio_remove_block(graph_, it->second.core_id); }, true);
      DropEdgesTouching(js_id);
      blocks_.erase(it);
    });
    return (json{{"ok", true}}).dump();
  } catch (...) {
    return JsonError("removeBlock failed");
  }
}

std::string StudioBridge::HandleMoveBlock(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string js_id = o.value("blockId", "");
    const int row = o.value("row", 0);
    const int col = o.value("col", 0);
    Call([&] {
      auto it = blocks_.find(js_id);
      if (it == blocks_.end()) return;
      Mutate([&] { nam_studio_move_block(graph_, it->second.core_id, row, col); }, true);
      it->second.row = row;
      it->second.col = col;
    });
    return (json{{"ok", true}}).dump();
  } catch (...) {
    return JsonError("moveBlock failed");
  }
}

std::string StudioBridge::HandleConnect(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    std::string js_edge_id = o.value("id", "");
    if (js_edge_id.empty()) js_edge_id = GenEdgeId();
    const int from_port = o.value("fromPort", 0);
    const int to_port = o.value("toPort", 0);

    std::string error;
    json out;
    Call([&] {
      if (edges_.count(js_edge_id)) {
        error = "edge id already exists: " + js_edge_id;
        return;
      }
      const int32_t from = ResolveCoreId(o.at("fromId"), blocks_);
      const int32_t to = ResolveCoreId(o.at("toId"), blocks_);
      if (from == kUnknownBlock || to == kUnknownBlock) {
        error = "unknown block in edge";
        return;
      }
      int32_t core_edge = -1;
      Mutate([&] { core_edge = nam_studio_connect(graph_, from, from_port, to, to_port); }, true);
      if (core_edge < 0) {
        error = "connection rejected";
        return;
      }
      edges_[js_edge_id] = EdgeRecord{o.at("fromId"), from_port, o.at("toId"), to_port};
      edge_ids_[js_edge_id] = core_edge;
      edge_ids_rev_[core_edge] = js_edge_id;
      out = json{{"ok", true}, {"id", js_edge_id}};
    });
    return error.empty() ? out.dump() : JsonError(error);
  } catch (const std::exception& e) {
    return JsonError(std::string("connect: ") + e.what());
  }
}

std::string StudioBridge::HandleDisconnect(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string js_edge_id = o.value("edgeId", "");
    Call([&] {
      const auto it = edge_ids_.find(js_edge_id);
      if (it == edge_ids_.end()) return;
      Mutate([&] { nam_studio_disconnect(graph_, it->second); }, true);
      edge_ids_rev_.erase(it->second);
      edge_ids_.erase(it);
      edges_.erase(js_edge_id);
    });
    return (json{{"ok", true}}).dump();
  } catch (...) {
    return JsonError("disconnect failed");
  }
}

// Resolves a param key (index number or symbol string) to an index, reading
// the block's param table on the control thread.
int32_t ResolveParamIndex(const json& key, int32_t core_id, NamStudioGraph* graph,
                          const std::map<std::string, BlockRecord>& blocks,
                          const std::string& js_id) {
  if (key.is_number()) return key.get<int32_t>();
  if (!key.is_string()) return -1;
  const std::string symbol = key.get<std::string>();
  const auto it = blocks.find(js_id);
  const int32_t count = it == blocks.end() ? 0 : nam_studio_block_param_count(graph, core_id);
  for (int32_t i = 0; i < count; ++i) {
    const char* name = nullptr;
    const char* sym = nullptr;
    const char* unit = nullptr;
    float min = 0, max = 0;
    if (nam_studio_block_param_info(graph, core_id, i, &name, &sym, &min, &max, &unit) &&
        sym && symbol == sym)
      return i;
  }
  return -1;
}

// The UI's reverb knobs are per-algorithm abstractions (roomSize/damping have
// no core symbol at all, and pre-delay is `delay` on Hall but `predelay` on
// Room), so they resolve through the core's own ReverbControl mapping rather
// than a symbol lookup. Returns -1 for anything that isn't one of them.
int32_t ReverbControlFor(const std::string& key) {
  if (key == "roomSize") return NAM_STUDIO_REVERB_ROOM_SIZE;
  if (key == "damping") return NAM_STUDIO_REVERB_DAMPING;
  if (key == "width") return NAM_STUDIO_REVERB_WIDTH;
  if (key == "predelay") return NAM_STUDIO_REVERB_PREDELAY;
  if (key == "spin") return NAM_STUDIO_REVERB_SPIN;
  if (key == "wander") return NAM_STUDIO_REVERB_WANDER;
  if (key == "earlySend") return NAM_STUDIO_REVERB_EARLY_SEND;
  if (key == "dryLevel") return NAM_STUDIO_REVERB_DRY_LEVEL;
  return -1;
}

std::string StudioBridge::HandleSetParam(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string js_id = o.value("blockId", "");
    const json& key = o.at("key");
    const float value = o.value("value", 0.0f);

    // Reverb blocks: route the UI's control names through the core mapping
    // first. Before this, none of them resolved (the UI's camelCase names
    // aren't core symbols, and roomSize/damping aren't params at all), so the
    // desktop reverb had no working knobs beyond the algorithm selector.
    if (key.is_string()) {
      const int32_t control = ReverbControlFor(key.get<std::string>());
      if (control >= 0) {
        bool is_reverb = false;
        int32_t reverb_core_id = kUnknownBlock;
        Call([&] {
          const auto it = blocks_.find(js_id);
          if (it == blocks_.end()) return;
          reverb_core_id = it->second.core_id;
          is_reverb = it->second.kind == "reverb";
        });
        if (reverb_core_id == kUnknownBlock) return JsonError("unknown block: " + js_id);
        if (is_reverb) {
          nam_studio_set_reverb_control(
              graph_, reverb_core_id, static_cast<NamStudioReverbControl>(control), value);
          return (json{{"ok", true}}).dump();
        }
      }
    }

    int32_t core_id = kUnknownBlock;
    int32_t index = -1;
    Call([&] {
      const auto it = blocks_.find(js_id);
      if (it == blocks_.end()) return;
      core_id = it->second.core_id;
      index = ResolveParamIndex(key, core_id, graph_, blocks_, js_id);
    });
    if (core_id == kUnknownBlock) return JsonError("unknown block: " + js_id);
    if (index < 0) return JsonError("unknown param key");
    // nam_studio_set_param is lock-free and thread-safe (see api.h).
    nam_studio_set_param(graph_, core_id, index, value);
    return (json{{"ok", true}}).dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("setParam: ") + e.what());
  }
}

std::string StudioBridge::HandleGetParam(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string js_id = o.value("blockId", "");
    const json& key = o.at("key");

    int32_t core_id = kUnknownBlock;
    int32_t index = -1;
    Call([&] {
      const auto it = blocks_.find(js_id);
      if (it == blocks_.end()) return;
      core_id = it->second.core_id;
      index = ResolveParamIndex(key, core_id, graph_, blocks_, js_id);
    });
    if (core_id == kUnknownBlock || index < 0) return JsonError("unknown block or param");
    return (json{{"ok", true}, {"value", nam_studio_get_param(graph_, core_id, index)}}).dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("getParam: ") + e.what());
  }
}

std::string StudioBridge::HandleBlockInfo(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string js_id = o.value("blockId", "");

    json out;
    Call([&] {
      const auto it = blocks_.find(js_id);
      if (it == blocks_.end()) return;
      const BlockRecord& rec = it->second;
      const int32_t count = nam_studio_block_param_count(graph_, rec.core_id);
      json params = json::array();
      for (int32_t i = 0; i < count; ++i) {
        const char* name = nullptr;
        const char* symbol = nullptr;
        const char* unit = nullptr;
        float min = 0, max = 0;
        if (nam_studio_block_param_info(graph_, rec.core_id, i, &name, &symbol, &min, &max,
                                        &unit)) {
          params.push_back({{"index", i},
                            {"name", name ? name : ""},
                            {"symbol", symbol ? symbol : ""},
                            {"min", min},
                            {"max", max},
                            {"unit", unit ? unit : ""},
                            {"value", nam_studio_get_param(graph_, rec.core_id, i)}});
        }
      }
      out = json{{"ok", true},
                 {"id", js_id},
                 {"kind", rec.kind},
                 {"row", rec.row},
                 {"col", rec.col},
                 {"hasModel", nam_studio_block_has_model(graph_, rec.core_id) != 0},
                 {"paramCount", count},
                 {"params", params},
                 {"meter", nam_studio_get_meter(graph_, rec.core_id)}};
    });
    return out.empty() ? JsonError("unknown block: " + js_id) : out.dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("blockInfo: ") + e.what());
  }
}

std::string StudioBridge::HandleListBlocks(const std::string&) {
  json out = json::array();
  Call([&] {
    for (const auto& [js_id, rec] : blocks_) {
      out.push_back(
          {{"id", js_id}, {"kind", rec.kind}, {"row", rec.row}, {"col", rec.col}});
    }
  });
  return out.dump();
}

std::string StudioBridge::HandleListEdges(const std::string&) {
  json out = json::array();
  Call([&] {
    for (const auto& [edge_id, edge] : edges_) {
      out.push_back({{"id", edge_id},
                     {"from", {{"id", edge.from_id}, {"port", edge.from_port}}},
                     {"to", {{"id", edge.to_id}, {"port", edge.to_port}}}});
    }
  });
  return out.dump();
}

std::string StudioBridge::HandleLoadModel(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string js_id = o.value("blockId", "");

    int32_t core_id = kUnknownBlock;
    Call([&] {
      const auto it = blocks_.find(js_id);
      if (it != blocks_.end()) core_id = it->second.core_id;
    });
    if (core_id == kUnknownBlock) return JsonError("unknown block: " + js_id);

    // Native modal picker (Win32 / AppleScript / zenity-kdialog). Runs on the
    // webview thread like any modal dialog; an empty result means cancelled.
    pfd::open_file selector("Load NAM model", "", std::vector<std::string>{"NAM model", "*.nam"});
    const auto chosen = selector.result();
    if (chosen.empty()) return (json{{"ok", false}, {"canceled", true}}).dump();
    const std::string path = chosen.front();

    int result = -1;
    Call([&] {
      Mutate([&] { result = static_cast<int>(nam_studio_load_nam_model(graph_, core_id, path.c_str())); },
             /*reset_after=*/false);
    });
    return (json{{"ok", result == 0}, {"result", result}}).dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("loadModel: ") + e.what());
  }
}

std::string StudioBridge::HandleLoadModelJson(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string js_id = o.value("blockId", "");
    const std::string content = o.value("json", "");

    int32_t core_id = kUnknownBlock;
    Call([&] {
      const auto it = blocks_.find(js_id);
      if (it != blocks_.end()) core_id = it->second.core_id;
    });
    if (core_id == kUnknownBlock) return JsonError("unknown block: " + js_id);

    int result = -1;
    Call([&] {
      Mutate([&] {
        // The core loads NAM models by file path, but the web UI hands us the
        // model's JSON content - stage it in a temp file, load, then remove.
        auto tmp =
            std::filesystem::temp_directory_path() / ("nam_studio_" + std::to_string(core_id) + ".nam");
        {
          std::ofstream ofs(tmp, std::ios::binary);
          ofs << content;
        }
        result = static_cast<int>(nam_studio_load_nam_model(graph_, core_id, tmp.string().c_str()));
        std::error_code ec;
        std::filesystem::remove(tmp, ec);
      }, /*reset_after=*/false);
    });
    return (json{{"ok", result == 0}, {"result", result}}).dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("loadModelJson: ") + e.what());
  }
}

std::string StudioBridge::HandleUnloadModel(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string js_id = o.value("blockId", "");
    Call([&] {
      const auto it = blocks_.find(js_id);
      if (it == blocks_.end()) return;
      Mutate([&] { nam_studio_unload_nam_model(graph_, it->second.core_id); },
             /*reset_after=*/false);
    });
    return (json{{"ok", true}}).dump();
  } catch (...) {
    return JsonError("unloadModel failed");
  }
}

std::string StudioBridge::HandleSetReverbAlgorithm(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string js_id = o.value("blockId", "");
    const std::string name = o.value("algorithm", "");
    static const std::pair<const char*, NamStudioReverbAlgorithm> kAlgos[] = {
        {"hall", NAM_STUDIO_REVERB_HALL},
        {"room", NAM_STUDIO_REVERB_ROOM},
        {"plate", NAM_STUDIO_REVERB_PLATE},
        {"earlyReflections", NAM_STUDIO_REVERB_EARLY_REFLECTIONS},
    };
    const auto algo = MapByName(name, kAlgos, std::size(kAlgos));
    if (!algo) return JsonError("unknown reverb algorithm: " + name);
    Call([&] {
      const auto it = blocks_.find(js_id);
      if (it == blocks_.end()) return;
      Mutate([&] { nam_studio_set_reverb_algorithm(graph_, it->second.core_id, *algo); },
             /*reset_after=*/false);
    });
    return (json{{"ok", true}}).dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("setReverbAlgorithm: ") + e.what());
  }
}

std::string StudioBridge::HandleSetDelayModel(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string js_id = o.value("blockId", "");
    const std::string name = o.value("model", "");
    static const std::pair<const char*, NamStudioDelayModel> kModels[] = {
        {"digital", NAM_STUDIO_DELAY_DIGITAL},
        {"analog", NAM_STUDIO_DELAY_ANALOG},
        {"tape", NAM_STUDIO_DELAY_TAPE},
    };
    const auto model = MapByName(name, kModels, std::size(kModels));
    if (!model) return JsonError("unknown delay model: " + name);
    Call([&] {
      const auto it = blocks_.find(js_id);
      if (it == blocks_.end()) return;
      Mutate([&] { nam_studio_set_delay_model(graph_, it->second.core_id, *model); },
             /*reset_after=*/false);
    });
    return (json{{"ok", true}}).dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("setDelayModel: ") + e.what());
  }
}

std::string StudioBridge::HandleSetBypass(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string js_id = o.value("blockId", "");
    const bool bypassed = o.value("bypassed", false);
    // Real-time-safe atomic - no Mutate()/suspend handshake needed, only the
    // Call() to safely resolve js_id against blocks_ (control-thread only).
    Call([&] {
      const auto it = blocks_.find(js_id);
      if (it == blocks_.end()) return;
      nam_studio_set_bypass(graph_, it->second.core_id, bypassed ? 1 : 0);
    });
    return (json{{"ok", true}}).dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("setBypass: ") + e.what());
  }
}

// { blockId, input?, output? } - the UI's per-block Input/Output knobs. These
// are core I/O trims, deliberately not the Amp family's input_level/
// output_level params: those hold the loaded model's dBu calibration, so
// routing a volume knob there recalibrated the amp instead of trimming it
// (and a knob at 0 meant "0 dBu" = unity, not silence). Omitted keys are left
// untouched so a UI that only moves one knob doesn't reset the other.
std::string StudioBridge::HandleSetBlockTrim(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string js_id = o.value("blockId", "");
    const bool has_input = o.contains("input") && o["input"].is_number();
    const bool has_output = o.contains("output") && o["output"].is_number();
    const float input = has_input ? o["input"].get<float>() : 1.0f;
    const float output = has_output ? o["output"].get<float>() : 1.0f;
    bool found = false;
    // Real-time-safe atomics - no Mutate()/suspend handshake needed, only the
    // Call() to resolve js_id against blocks_ (control-thread only).
    Call([&] {
      const auto it = blocks_.find(js_id);
      if (it == blocks_.end()) return;
      found = true;
      if (has_input) nam_studio_set_block_input_trim(graph_, it->second.core_id, input);
      if (has_output) nam_studio_set_block_output_trim(graph_, it->second.core_id, output);
    });
    if (!found) return JsonError("setBlockTrim: unknown block " + js_id);
    return (json{{"ok", true}}).dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("setBlockTrim: ") + e.what());
  }
}

std::string StudioBridge::HandleSetMasterLevel(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    nam_studio_set_master_level(graph_, o.value("level", 1.0f));
    return (json{{"ok", true}}).dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("setMasterLevel: ") + e.what());
  }
}

std::string StudioBridge::HandleSetMasterMuted(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    nam_studio_set_master_muted(graph_, o.value("muted", false) ? 1 : 0);
    return (json{{"ok", true}}).dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("setMasterMuted: ") + e.what());
  }
}

std::string StudioBridge::HandleSetTunerMuted(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    nam_studio_set_tuner_muted(graph_, o.value("muted", false) ? 1 : 0);
    return (json{{"ok", true}}).dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("setTunerMuted: ") + e.what());
  }
}

std::string StudioBridge::HandleMeters(const std::string&) {
  json out = json::array();
  Call([&] {
    for (const auto& [js_id, rec] : blocks_) {
      out.push_back({{"id", js_id}, {"value", nam_studio_get_meter(graph_, rec.core_id)}});
    }
  });
  return out.dump();
}

std::string StudioBridge::HandleCpuLoad(const std::string&) {
  return json(nam_studio_get_cpu_load(graph_)).dump();
}

std::string StudioBridge::HandleGetTap(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string side = o.value("side", "out");
    const unsigned int frames = o.value("frames", 2048u);
    const TapFrame tap = audio_.GetTap(side == "in", frames);
    return (json{{"l", tap.l}, {"r", tap.r}, {"frames", tap.frames}}).dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("getTap: ") + e.what());
  }
}

std::string StudioBridge::HandleTakeStreamError(const std::string&) {
  std::string message;
  const bool errored = audio_.TakeStreamError(&message);
  return (json{{"error", errored ? json(message) : json()}}).dump();
}

}  // namespace nam_desktop