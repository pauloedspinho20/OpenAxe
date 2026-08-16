#include <nlohmann/json.hpp>

#include <cstdio>
#include <cstring>
#include <string>

#include "audio.h"
#include "bridge.h"

// Tests the window.namStudio bridge through its public Handle* interface -
// the exact entry points webview::bind calls - so the whole round-trip (JSON
// request -> control-thread mutation -> JSON response) is exercised. No audio
// hardware is needed: the graph runs without an open stream. The suspend flag
// on the callback is tested directly with fake buffers.
//
// loadModel is deliberately not exercised (it opens a native modal dialog).

static int g_failures = 0;

#define CHECK(cond)                                        \
  do {                                                     \
    if (!(cond)) {                                         \
      std::fprintf(stderr, "CHECK failed: %s (%s:%d)\n",   \
                   #cond, __FILE__, __LINE__);             \
      ++g_failures;                                        \
    }                                                      \
  } while (0)

namespace {

nlohmann::json Parse(const std::string& s) {
  const auto j = nlohmann::json::parse(s, nullptr, false);
  CHECK(!j.is_discarded());
  return j.is_discarded() ? nlohmann::json() : j;
}

const char* Arr(const char* obj) { return obj; }

void TestVersion() {
  nam_desktop::StudioBridge bridge;
  const auto j = Parse(bridge.HandleVersion(""));
  CHECK(j.is_string() && !j.get<std::string>().empty());
}

void TestAddBlockAndInfo() {
  nam_desktop::StudioBridge bridge;
  // Delay has wrapped DSP, so it exposes a real param table.
  auto r = Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"delay","row":0,"col":2,"id":"d1"}])")));
  CHECK(r["ok"] == true && r["id"] == "d1");

  // Mixer is a passthrough (monostate) block - 0 params.
  r = Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"mixer","row":1,"col":1,"id":"m1"}])")));
  CHECK(r["ok"] == true && r["id"] == "m1");

  auto info = Parse(bridge.HandleBlockInfo(Arr(R"([{"blockId":"d1"}])")));
  CHECK(info["ok"] == true);
  CHECK(info["kind"] == "delay");
  CHECK(info["row"] == 0 && info["col"] == 2);
  CHECK(info["paramCount"].get<int>() > 0);
  CHECK(info["params"].is_array());
  CHECK(info["params"].size() == static_cast<size_t>(info["paramCount"].get<int>()));
  for (const auto& p : info["params"]) {
    CHECK(p.contains("index") && p.contains("symbol") && p.contains("value"));
  }

  auto mixer = Parse(bridge.HandleBlockInfo(Arr(R"([{"blockId":"m1"}])")));
  CHECK(mixer["paramCount"] == 0);
}

void TestParamsByIndexAndSymbol() {
  nam_desktop::StudioBridge bridge;
  Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"delay","row":0,"col":0,"id":"d1"}])")));
  const auto info = Parse(bridge.HandleBlockInfo(Arr(R"([{"blockId":"d1"}])")));
  const std::string symbol = info["params"][0]["symbol"].get<std::string>();
  const double original = info["params"][0]["value"].get<double>();
  const double next = original == 0.0 ? 0.5 : 0.0;

  // By symbol.
  auto set = Parse(bridge.HandleSetParam(Arr(
      (std::string(R"([{"blockId":"d1","key":")") + symbol + R"(","value":)" + std::to_string(next) + R"(}])").c_str())));
  CHECK(set["ok"] == true);
  auto got = Parse(bridge.HandleGetParam(Arr(
      (std::string(R"([{"blockId":"d1","key":")") + symbol + R"("}])").c_str())));
  CHECK(got["ok"] == true);
  CHECK(std::fabs(got["value"].get<double>() - next) < 1e-6);

  // By index 0.
  set = Parse(bridge.HandleSetParam(Arr(R"([{"blockId":"d1","key":0,"value":0.25}])")));
  CHECK(set["ok"] == true);
  got = Parse(bridge.HandleGetParam(Arr(R"([{"blockId":"d1","key":0}])")));
  CHECK(got["ok"] == true && std::fabs(got["value"].get<double>() - 0.25) < 1e-6);

  // Unknown symbol fails cleanly.
  set = Parse(bridge.HandleSetParam(Arr(R"([{"blockId":"d1","key":"nope","value":1}])")));
  CHECK(set["ok"] == false);
}

void TestConnectDisconnectAndEdges() {
  nam_desktop::StudioBridge bridge;
  Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"mixer","row":0,"col":0,"id":"m1"}])")));

  // IN rail (-1) -> m1 -> OUT rail (-2).
  auto r = Parse(bridge.HandleConnect(Arr(R"([{"fromId":-1,"fromPort":0,"toId":"m1","toPort":0,"id":"e1"}])")));
  CHECK(r["ok"] == true && r["id"] == "e1");
  r = Parse(bridge.HandleConnect(Arr(R"([{"fromId":"m1","fromPort":0,"toId":-2,"toPort":0,"id":"e2"}])")));
  CHECK(r["ok"] == true && r["id"] == "e2");

  auto edges = Parse(bridge.HandleListEdges(""));
  CHECK(edges.size() == 2);

  // Rejected edge: unknown block.
  r = Parse(bridge.HandleConnect(Arr(R"([{"fromId":-1,"fromPort":0,"toId":"nope","toPort":0}])")));
  CHECK(r["ok"] == false);

  Parse(bridge.HandleDisconnect(Arr(R"([{"edgeId":"e1"}])")));
  edges = Parse(bridge.HandleListEdges(""));
  CHECK(edges.size() == 1);
  CHECK(edges[0]["id"] == "e2");
}

void TestRemoveBlockDropsEdges() {
  nam_desktop::StudioBridge bridge;
  Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"mixer","row":0,"col":0,"id":"m1"}])")));
  Parse(bridge.HandleConnect(Arr(R"([{"fromId":-1,"fromPort":0,"toId":"m1","toPort":0,"id":"e1"}])")));
  Parse(bridge.HandleConnect(Arr(R"([{"fromId":"m1","fromPort":0,"toId":-2,"toPort":0,"id":"e2"}])")));

  auto r = Parse(bridge.HandleRemoveBlock(Arr(R"([{"blockId":"m1"}])")));
  CHECK(r["ok"] == true);
  CHECK(Parse(bridge.HandleListBlocks("")).empty());
  CHECK(Parse(bridge.HandleListEdges("")).empty());
}

void TestMoveBlock() {
  nam_desktop::StudioBridge bridge;
  Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"eq","row":0,"col":0,"id":"e1"}])")));
  Parse(bridge.HandleMoveBlock(Arr(R"([{"blockId":"e1","row":3,"col":4}])")));
  const auto info = Parse(bridge.HandleBlockInfo(Arr(R"([{"blockId":"e1"}])")));
  CHECK(info["row"] == 3 && info["col"] == 4);
}

void TestBadInputs() {
  nam_desktop::StudioBridge bridge;
  CHECK(Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"bogus","row":0,"col":0}])")))["ok"] == false);
  CHECK(Parse(bridge.HandleBlockInfo(Arr(R"([{"blockId":"missing"}])")))["ok"] == false);
  CHECK(Parse(bridge.HandleSetParam(Arr(R"([{"blockId":"missing","key":0,"value":1}])")))["ok"] == false);
  CHECK(Parse(bridge.HandleLoadModelJson(Arr(R"([{"blockId":"missing","json":"{}"}])")))["ok"] == false);
}

// The monitor tap must capture the callback's input (pre-graph) and output
// (post-graph) frames in order, and ReadTap must return them oldest-to-newest.
void TestMonitorTap() {
  constexpr double kRate = 48000.0;
  constexpr int kFrames = 64;
  constexpr int kBlock = 512;

  NamStudioGraph* graph = nam_studio_graph_create();
  const int32_t mixer = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_MIXER, 0, 0);
  nam_studio_connect(graph, NAM_STUDIO_IN_RAIL, 0, mixer, 0);
  nam_studio_connect(graph, mixer, 0, NAM_STUDIO_OUT_RAIL, 0);
  nam_studio_reset(graph, kRate, kBlock);

  nam_desktop::RtCallbackState state;
  for (auto& ch : state.tap_in) ch.assign(nam_desktop::RtCallbackState::kTapCapacity, 0.0f);
  for (auto& ch : state.tap_out) ch.assign(nam_desktop::RtCallbackState::kTapCapacity, 0.0f);
  state.graph = graph;
  state.graph_ready.store(true, std::memory_order_release);

  float in0[kFrames], in1[kFrames], out0[kFrames], out1[kFrames];
  for (int i = 0; i < kFrames; ++i) {
    in0[i] = static_cast<float>(i);
    in1[i] = static_cast<float>(i) * 2.0f;
    out0[i] = out1[i] = 0.0f;
  }
  float* in[2] = {in0, in1};
  float* out[2] = {out0, out1};

  // Two callbacks so the ring accumulates more than one frame's worth.
  nam_desktop::RtProcessCallback(out, in, kFrames, 0.0, RtAudioErrorType::RTAUDIO_NO_ERROR, &state);
  nam_desktop::RtProcessCallback(out, in, kFrames, 0.0, RtAudioErrorType::RTAUDIO_NO_ERROR, &state);

  auto tap_in = nam_desktop::ReadTap(state, /*input=*/true, kFrames);
  CHECK(tap_in.frames == static_cast<unsigned int>(kFrames));
  for (int i = 0; i < kFrames; ++i) {
    CHECK(tap_in.l[i] == static_cast<float>(i));
    CHECK(tap_in.r[i] == static_cast<float>(i) * 2.0f);
  }

  auto tap_out = nam_desktop::ReadTap(state, /*input=*/false, kFrames);
  CHECK(tap_out.frames == static_cast<unsigned int>(kFrames));
  for (int i = 0; i < kFrames; ++i) {
    CHECK(tap_out.l[i] == static_cast<float>(i));
    CHECK(tap_out.r[i] == static_cast<float>(i) * 2.0f);
  }

  nam_studio_graph_destroy(graph);
}

// The suspend flag must silence the callback and bump suspended_callbacks so
// the control thread knows no nam_studio_process is in flight.
void TestSuspendCallbackSilencesOutput() {
  constexpr int kFrames = 32;
  nam_desktop::RtCallbackState state;
  state.suspend.store(true, std::memory_order_release);

  float out0[kFrames], out1[kFrames];
  for (int i = 0; i < kFrames; ++i) out0[i] = out1[i] = 1.0f;
  float* out[2] = {out0, out1};
  float in0[kFrames], in1[kFrames];
  for (int i = 0; i < kFrames; ++i) in0[i] = in1[i] = 0.5f;
  float* in[2] = {in0, in1};

  nam_desktop::RtProcessCallback(out, in, kFrames, 0.0, RtAudioErrorType::RTAUDIO_NO_ERROR,
                                 &state);

  CHECK(state.suspended_callbacks.load() == 1);
  for (int i = 0; i < kFrames; ++i) {
    CHECK(out0[i] == 0.0f);
    CHECK(out1[i] == 0.0f);
  }
}

}  // namespace

int main() {
  TestVersion();
  TestAddBlockAndInfo();
  TestParamsByIndexAndSymbol();
  TestConnectDisconnectAndEdges();
  TestRemoveBlockDropsEdges();
  TestMoveBlock();
  TestBadInputs();
  TestMonitorTap();
  TestSuspendCallbackSilencesOutput();

  if (g_failures > 0) {
    std::fprintf(stderr, "%d failure(s)\n", g_failures);
    return 1;
  }
  std::printf("bridge_test: all checks passed\n");
  return 0;
}