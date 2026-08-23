#include "bridge.h"

#include <nlohmann/json.hpp>
#include <portable-file-dialogs.h>

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <optional>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

#include "debug_log.h"
#include "openaxe/api.h"
#include "openaxe/core.h"
#include "secure_storage.h"

namespace openaxe_desktop {

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

// issue #69: hard ceilings on user-supplied asset bytes before they reach the
// DSP core, so a large/malformed file can't exhaust memory or crash the
// engine. Mirrors the web UI's caps in apps/web/.../assetLimits.ts.
constexpr size_t kMaxNamModelJsonBytes = 32 * 1024 * 1024;  // 32 MB
constexpr size_t kMaxIrWavBytes = 8 * 1024 * 1024;          // 8 MB

}  // namespace

bool IsTrustedUiUrl(const std::string& url) {
  // Accept only loopback http(s). The bundled UI is served from our own
  // loopback HTTP server and the dev server is also loopback; nothing else
  // should ever receive the privileged bridge (issue #71).
  std::string lower;
  lower.reserve(url.size());
  for (char c : url) lower.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));

  const size_t scheme_end = lower.find("://");
  if (scheme_end == std::string::npos) return false;
  const std::string scheme = lower.substr(0, scheme_end);
  if (scheme != "http" && scheme != "https") return false;

  std::string host = lower.substr(scheme_end + 3);
  const size_t slash = host.find('/');
  if (slash != std::string::npos) host = host.substr(0, slash);
  const size_t at = host.find('@');  // drop userinfo
  if (at != std::string::npos) host = host.substr(at + 1);
  const size_t colon = host.rfind(':');  // drop port
  if (colon != std::string::npos) host = host.substr(0, colon);

  return host == "127.0.0.1" || host == "localhost" || host == "[::1]" || host == "::1";
}

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
  // Heap-allocated completion object, captured by *value* into the submitted
  // lambda so the control thread never depends on this stack frame's lifetime.
  // The previous design captured stack-local done_mutex/done_cv/done by
  // reference; that is only safe because the caller blocks until the task
  // completes, but it leaves a by-reference-to-stack hazard that is exactly
  // the kind of edge case that misbehaves under thread-creation / memory
  // pressure (issue #59). Owning it via shared_ptr keeps it alive for both
  // the caller's wait and the control thread's notify no matter what.
  struct Completion {
    std::mutex mutex;
    std::condition_variable cv;
    bool done = false;
  };
  auto completion = std::make_shared<Completion>();
  Submit([completion, task = std::move(task)] {
    try {
      task();
    } catch (...) {
      // Never let a handler exception kill the control thread; handlers
      // already translate core errors into JSON, so reaching here means a
      // programming bug that should not take the app down.
    }
    {
      std::lock_guard<std::mutex> lock(completion->mutex);
      completion->done = true;
    }
    completion->cv.notify_one();
  });
  std::unique_lock<std::mutex> lock(completion->mutex);
  completion->cv.wait(lock, [&] { return completion->done; });
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
  return json(openaxe::core::version()).dump();
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

    // Reopening while a previous stream is still live (device switch, or the
    // no-sound recovery poll retrying every few seconds) must not let
    // Open()/SetGraph() below race an in-flight nam_studio_process call on
    // that old stream - both touch the same long-lived AudioEngine
    // (ext_in_l_/max_block_size_ etc., resized here and read every callback),
    // and ASAN has caught the resulting heap-buffer-overflow when a resize
    // and a Process() call interleave. BeginSuspend() is a no-op when nothing
    // is playing yet, which covers the common first-open case.
    audio_.BeginSuspend();
    if (!audio_.Open(input_device, output_device, sample_rate, buffer_frames)) {
      audio_.EndSuspend();
      return JsonError("open failed: " + audio_.LastError());
    }
    graph_sample_rate_ = audio_.SampleRate();
    graph_block_ = static_cast<int32_t>(audio_.BufferFrames());
    // Re-arm the graph at the stream's actual parameters. The old stream (if
    // any) is suspended and the new one isn't started yet, so no audio
    // thread can be touching the graph here.
    Call([this] { audio_.SetGraph(graph_, graph_sample_rate_, graph_block_); });
    audio_.EndSuspend();
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
      // Move only re-sorts execution order (AudioEngine::MoveBlock calls
      // RecomputeRouting, not Reset), so it needs no reallocation and must
      // not suspend/reset the audio thread - doing so made every param
      // change reset the whole engine (issue #62).
      Mutate([&] { nam_studio_move_block(graph_, it->second.core_id, row, col); }, false);
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
// A handful of the web UI's param keys are camelCase where the core's symbol is
// snake_case (the canonical casing - see packages/core/param_schema.json). The
// effect params were renamed on the web side to match (issue #41), but the amp's
// slim-size control kept its camelCase key, so it silently resolved to nothing
// on desktop. Translate here rather than renaming the web key, which would
// invalidate every saved preset.
const char* CoreSymbolAliasFor(const std::string& key) {
  if (key == "slimSize") return "slim_size";
  if (key == "irMix") return "ir_mix";
  return nullptr;
}

int32_t ResolveParamIndex(const json& key, int32_t core_id, NamStudioGraph* graph,
                          const std::map<std::string, BlockRecord>& blocks,
                          const std::string& js_id) {
  if (key.is_number()) return key.get<int32_t>();
  if (!key.is_string()) return -1;
  std::string symbol = key.get<std::string>();
  if (const char* alias = CoreSymbolAliasFor(symbol)) symbol = alias;
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
    bool slim_size = false;
    Call([&] {
      const auto it = blocks_.find(js_id);
      if (it == blocks_.end()) return;
      core_id = it->second.core_id;
      index = ResolveParamIndex(key, core_id, graph_, blocks_, js_id);
      if (index >= 0) {
        const char* name = nullptr;
        const char* sym = nullptr;
        const char* unit = nullptr;
        float min = 0, max = 0;
        if (nam_studio_block_param_info(graph_, core_id, index, &name, &sym, &min, &max, &unit) &&
            sym && std::strcmp(sym, "slim_size") == 0) {
          slim_size = true;
        }
      }
    });
    if (core_id == kUnknownBlock) return JsonError("unknown block: " + js_id);
    if (index < 0) return JsonError("unknown param key");
    if (slim_size) {
      // nam_studio_set_param forwards the Amp-family slim-size param
      // synchronously into NAMCore, which may reallocate (issue #211) - it is
      // Tier 2, not the lock-free atomic write the rest of the param surface
      // is. Called straight from the webview thread it would race an in-flight
      // nam_studio_process on the audio thread, so route it through the
      // control thread's suspend handshake like every other structural
      // mutation.
      Call([&] {
        Mutate([&] { nam_studio_set_param(graph_, core_id, index, value); },
               /*reset_after=*/false);
      });
    } else {
      // nam_studio_set_param is lock-free and thread-safe (see api.h).
      nam_studio_set_param(graph_, core_id, index, value);
    }
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

    // issue #69: reject an oversized model before the core reads it from disk
    // (mirrors the 32 MB web/native-IR caps - there is no native IR picker).
    std::error_code ec;
    const auto size = std::filesystem::file_size(path, ec);
    if (!ec && size > kMaxNamModelJsonBytes)
      return JsonError("loadModel: file too large (max 32 MB)");

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
    if (content.size() > kMaxNamModelJsonBytes)
      return JsonError("loadModelJson: file too large (max 32 MB)");

    int32_t core_id = kUnknownBlock;
    Call([&] {
      const auto it = blocks_.find(js_id);
      if (it != blocks_.end()) core_id = it->second.core_id;
    });
    if (core_id == kUnknownBlock) return JsonError("unknown block: " + js_id);

    int result = -1;
    Call([&] {
      Mutate([&] {
        // Straight into the core from memory. This used to stage `content` in a
        // temp file because the core could only load by path; it now has a JSON
        // entry point (the one the web app's WASM build needs, since a browser
        // has no filesystem), so the round-trip through disk is gone.
        result = static_cast<int>(nam_studio_load_nam_model_json(graph_, core_id, content.c_str()));
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

// Decode standard base64 (RFC 4648, with or without padding). The webview bridge
// marshals arguments as JSON, and an IR is a few hundred kilobytes of binary - a
// JSON array of numbers would be several times larger and slower to parse, so the
// UI sends base64 and this turns it back into bytes.
std::vector<uint8_t> DecodeBase64(const std::string& text) {
  static constexpr char kAlphabet[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  int8_t table[256];
  std::fill(std::begin(table), std::end(table), static_cast<int8_t>(-1));
  for (int i = 0; i < 64; ++i) table[static_cast<unsigned char>(kAlphabet[i])] = static_cast<int8_t>(i);

  std::vector<uint8_t> out;
  out.reserve(text.size() * 3 / 4);
  uint32_t accumulator = 0;
  int bits = 0;
  for (const char c : text) {
    if (c == '=') break;
    const int8_t value = table[static_cast<unsigned char>(c)];
    if (value < 0) continue;  // skip whitespace/newlines rather than failing
    accumulator = (accumulator << 6) | static_cast<uint32_t>(value);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push_back(static_cast<uint8_t>((accumulator >> bits) & 0xFF));
    }
  }
  return out;
}

// { blockId, wavBase64 } - install a cab IR from the bytes of a WAV file. The
// core decodes and resamples it (nam_studio_load_ir_wav), so this handler only
// has to get the bytes across and serialize the mutation like any other.
std::string StudioBridge::HandleLoadIrWav(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string js_id = o.value("blockId", "");
    const std::string encoded = o.value("wavBase64", "");
    if (encoded.empty()) return JsonError("loadIrWav: no wav data");

    const std::vector<uint8_t> bytes = DecodeBase64(encoded);
    if (bytes.empty()) return JsonError("loadIrWav: could not decode the base64 payload");
    if (bytes.size() > kMaxIrWavBytes)
      return JsonError("loadIrWav: file too large (max 8 MB)");
    // A cab IR is a WAV container - reject anything that isn't RIFF/WAVE before
    // the core tries to decode it (issue #69).
    if (bytes.size() < 12 || std::memcmp(bytes.data(), "RIFF", 4) != 0 ||
        std::memcmp(bytes.data() + 8, "WAVE", 4) != 0)
      return JsonError("loadIrWav: not a WAV file");

    int32_t core_id = kUnknownBlock;
    Call([&] {
      const auto it = blocks_.find(js_id);
      if (it != blocks_.end()) core_id = it->second.core_id;
    });
    if (core_id == kUnknownBlock) return JsonError("unknown block: " + js_id);

    int frames = 0;
    Call([&] {
      Mutate([&] {
        frames = static_cast<int>(
            nam_studio_load_ir_wav(graph_, core_id, bytes.data(), static_cast<int32_t>(bytes.size())));
      }, /*reset_after=*/false);
    });
    if (frames == 0) return JsonError("loadIrWav: the core could not decode this file");
    return (json{{"ok", true}, {"frames", frames}}).dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("loadIrWav: ") + e.what());
  }
}

// { blockId } - drop a cab block's IR; it passes audio through again.
std::string StudioBridge::HandleUnloadIr(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string js_id = o.value("blockId", "");
    bool found = false;
    Call([&] {
      const auto it = blocks_.find(js_id);
      if (it == blocks_.end()) return;
      found = true;
      Mutate([&] { nam_studio_unload_ir(graph_, it->second.core_id); }, /*reset_after=*/false);
    });
    if (!found) return JsonError("unloadIr: unknown block " + js_id);
    return (json{{"ok", true}}).dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("unloadIr: ") + e.what());
  }
}

std::string StudioBridge::HandleSetInputGain(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    // Straight to AudioIO, not through Mutate(): the gain is a lone atomic the
    // audio callback reads, so there is no graph state to suspend around.
    audio_.SetInputGain(o.value("gain", 1.0f));
    return (json{{"ok", true}}).dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("setInputGain: ") + e.what());
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

namespace {
// Keys only ever come from our own trusted JS (issue #71 already restricts
// who gets the bridge at all), but the Linux fallback in secure_storage.cpp
// turns a key straight into a filename - reject anything that isn't a plain
// identifier so a typo or future caller can't traverse outside its secrets
// directory.
bool IsValidSecretKey(const std::string& key) {
  if (key.empty()) return false;
  return std::all_of(key.begin(), key.end(), [](unsigned char c) {
    return std::isalnum(c) || c == '_' || c == '-';
  });
}
}  // namespace

std::string StudioBridge::HandleSecureStore(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string key = o.value("key", "");
    const std::string value = o.value("value", "");
    if (!IsValidSecretKey(key)) return JsonError("secureStore: invalid key");
    std::string error;
    if (!secure_storage::Store(key, value, &error)) return JsonError("secureStore: " + error);
    return (json{{"ok", true}}).dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("secureStore: ") + e.what());
  }
}

std::string StudioBridge::HandleSecureLoad(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string key = o.value("key", "");
    if (!IsValidSecretKey(key)) return JsonError("secureLoad: invalid key");
    std::string error;
    const auto value = secure_storage::Load(key, &error);
    if (!value && !error.empty()) return JsonError("secureLoad: " + error);
    return (json{{"ok", true}, {"value", value ? json(*value) : json()}}).dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("secureLoad: ") + e.what());
  }
}

std::string StudioBridge::HandleSecureDelete(const std::string& req) {
  try {
    const json args = ParseArgs(req);
    const json& o = args.empty() ? json::object() : args[0];
    const std::string key = o.value("key", "");
    if (!IsValidSecretKey(key)) return JsonError("secureDelete: invalid key");
    std::string error;
    if (!secure_storage::Delete(key, &error)) return JsonError("secureDelete: " + error);
    return (json{{"ok", true}}).dump();
  } catch (const std::exception& e) {
    return JsonError(std::string("secureDelete: ") + e.what());
  }
}

}  // namespace openaxe_desktop