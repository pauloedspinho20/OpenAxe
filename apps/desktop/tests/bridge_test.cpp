#include <nlohmann/json.hpp>

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

#include "audio.h"
#include "bridge.h"

// Tests the window.openAxe bridge through its public Handle* interface -
// the exact entry points webview::bind calls - so the whole round-trip (JSON
// request -> control-thread mutation -> JSON response) is exercised. Most
// tests need no audio hardware: the graph runs without an open stream. The
// suspend flag on the callback is tested directly with fake buffers in
// isolation; TestConcurrentMutationsWhileStreamRunning (issue #52) instead
// drives a real open+running stream so BeginSuspend/Mutate/EndSuspend and the
// control-thread executor are stressed against a genuine concurrently-running
// audio callback, not just the flag on its own - it skips itself on hosts
// with no audio device, same as audio_io_test.cpp's TestOpenStartStop.
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
  openaxe_desktop::StudioBridge bridge;
  const auto j = Parse(bridge.HandleVersion(""));
  CHECK(j.is_string() && !j.get<std::string>().empty());
}

void TestAddBlockAndInfo() {
  openaxe_desktop::StudioBridge bridge;
  // Delay has wrapped DSP, so it exposes a real param table.
  auto r = Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"delay","row":0,"col":2,"id":"d1"}])")));
  CHECK(r["ok"] == true && r["id"] == "d1");

  // Mixer stays a monostate (no wrapped DSP) but still exposes real params:
  // level + pan for each of its 4 input ports - see kMixerParamCount in
  // engine.cpp.
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
  // 4 inputs x 2 params each (level, pan), interleaved in{p}_level/in{p}_pan -
  // unity level (1.0) and centre pan (0.0) by default.
  CHECK(mixer["paramCount"] == 8);
  CHECK(mixer["params"].is_array());
  CHECK(mixer["params"].size() == 8);
  for (size_t i = 0; i < mixer["params"].size(); ++i) {
    const double value = mixer["params"][i]["value"].get<double>();
    const bool is_pan = (i % 2) == 1;
    CHECK(std::abs(value - (is_pan ? 0.0 : 1.0)) < 1e-6);
  }
}

void TestParamsByIndexAndSymbol() {
  openaxe_desktop::StudioBridge bridge;
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

// issue #41: every plain-symbol-mapped effect kind's web param keys must
// actually round-trip through the live bridge resolution path (HandleSetParam
// -> ResolveParamIndex -> core -> HandleGetParam), not just satisfy the
// static schema-equality check in paramSchema.coreDrift.test.ts (which only
// compares packages/core/param_schema.json against apps/web/src/effects/
// paramSchema.ts as data - it can't catch a bridge-side resolution bug, and
// it doesn't run against the desktop binary at all). TestParamsByIndexAndSymbol
// covers one block (delay) via its own generic symbol; TestReverbControlKeys
// and TestAmpToneStackAndSlimSizeKeys already cover the special-routed kinds
// (reverb controls, slimSize/irMix aliases). This covers every remaining kind
// whose web keys are meant to equal the core's symbols outright, using the
// exact key names apps/web/src/effects/paramSchema.ts sends.
void TestSymbolMappedParamRoundTripAllEffectKinds() {
  struct Kind {
    const char* kind;
    std::vector<const char*> keys;
  };
  const std::vector<Kind> kinds = {
      {"noise-gate", {"threshold", "hysteresis", "attack", "hold", "release", "range"}},
      {"compressor",
       {"threshold", "ratio", "attack", "release", "knee", "makeup_gain", "character", "mix"}},
      {"eq",
       {"band0_frequency", "band0_gain", "band0_q", "band1_frequency", "band1_gain", "band1_q",
        "band2_frequency", "band2_gain", "band2_q", "band3_frequency", "band3_gain", "band3_q"}},
      {"chorus", {"rate", "depth", "delay", "feedback"}},
      {"flanger", {"rate", "depth", "delay", "feedback"}},
      {"phaser", {"rate", "depth", "feedback", "stages"}},
      {"tremolo", {"rate", "depth", "shape"}},
      {"delay", {"time", "feedback", "tone", "wow_depth", "wow_rate"}},
      {"ping-pong-delay", {"time", "feedback", "tone"}},
      {"mixer",
       {"in0_level", "in0_pan", "in1_level", "in1_pan", "in2_level", "in2_pan", "in3_level",
        "in3_pan"}},
      {"splitter", {"out0_level", "out1_level", "out2_level", "out3_level"}},
  };

  int next_id = 0;
  for (const auto& k : kinds) {
    openaxe_desktop::StudioBridge bridge;
    const std::string id = "k" + std::to_string(++next_id);
    const std::string add =
        std::string(R"([{"kind":")") + k.kind + R"(","row":0,"col":0,"id":")" + id + R"("}])";
    CHECK(Parse(bridge.HandleAddBlock(Arr(add.c_str())))["ok"] == true);

    const auto info =
        Parse(bridge.HandleBlockInfo(Arr((R"([{"blockId":")" + id + R"("}])").c_str())));

    for (const char* key : k.keys) {
      double min_v = 0.0, max_v = 1.0;
      bool found = false;
      for (const auto& p : info["params"]) {
        if (p["symbol"].get<std::string>() == key) {
          min_v = p["min"].get<double>();
          max_v = p["max"].get<double>();
          found = true;
          break;
        }
      }
      // A web key with no matching core symbol is exactly the bug issue #41
      // describes - fail loudly here instead of only via a runtime
      // console.warn a user will never see.
      CHECK(found);
      if (!found) continue;

      const std::string get_req =
          std::string(R"([{"blockId":")") + id + R"(","key":")" + key + R"("}])";
      const double before = Parse(bridge.HandleGetParam(Arr(get_req.c_str())))["value"].get<double>();
      double target = min_v + (max_v - min_v) * 0.75;
      if (std::fabs(target - before) < 1e-6) target = min_v + (max_v - min_v) * 0.25;

      const std::string set_req = std::string(R"([{"blockId":")") + id + R"(","key":")" + key +
                                   R"(","value":)" + std::to_string(target) + R"(}])";
      const auto set_result = Parse(bridge.HandleSetParam(Arr(set_req.c_str())));
      CHECK(set_result["ok"] == true);

      const auto got = Parse(bridge.HandleGetParam(Arr(get_req.c_str())));
      CHECK(got["ok"] == true);
      CHECK(std::fabs(got["value"].get<double>() - target) < 1e-3);
    }
  }
}

void TestConnectDisconnectAndEdges() {
  openaxe_desktop::StudioBridge bridge;
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
  openaxe_desktop::StudioBridge bridge;
  Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"mixer","row":0,"col":0,"id":"m1"}])")));
  Parse(bridge.HandleConnect(Arr(R"([{"fromId":-1,"fromPort":0,"toId":"m1","toPort":0,"id":"e1"}])")));
  Parse(bridge.HandleConnect(Arr(R"([{"fromId":"m1","fromPort":0,"toId":-2,"toPort":0,"id":"e2"}])")));

  auto r = Parse(bridge.HandleRemoveBlock(Arr(R"([{"blockId":"m1"}])")));
  CHECK(r["ok"] == true);
  CHECK(Parse(bridge.HandleListBlocks("")).empty());
  CHECK(Parse(bridge.HandleListEdges("")).empty());
}

void TestMoveBlock() {
  openaxe_desktop::StudioBridge bridge;
  Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"eq","row":0,"col":0,"id":"e1"}])")));
  Parse(bridge.HandleMoveBlock(Arr(R"([{"blockId":"e1","row":3,"col":4}])")));
  const auto info = Parse(bridge.HandleBlockInfo(Arr(R"([{"blockId":"e1"}])")));
  CHECK(info["row"] == 3 && info["col"] == 4);
}

// issue #62: a moveBlock must not reset the whole audio engine. It used to
// pass reset_after=true, which re-seeded every block's params from the DSP
// defaults on each move - so a single param tweak that reconciles every block
// reset the engine N times. Set a param to a non-default value, move the
// block, and confirm the param survives the move (proving no reset ran).
void TestMoveBlockDoesNotReset() {
  openaxe_desktop::StudioBridge bridge;
  Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"delay","row":0,"col":0,"id":"d1"}])")));

  const double def = Parse(bridge.HandleBlockInfo(Arr(R"([{"blockId":"d1"}])")))["params"][0]
                          ["value"].get<double>();
  const double kVal = (def == 0.0) ? 0.5 : 0.0;  // guaranteed != default

  Parse(bridge.HandleSetParam(
      Arr((R"([{"blockId":"d1","key":0,"value":)" + std::to_string(kVal) + R"(}])").c_str())));
  const auto after_set = Parse(bridge.HandleGetParam(Arr(R"([{"blockId":"d1","key":0}])")));
  CHECK(after_set["ok"] == true && std::fabs(after_set["value"].get<double>() - kVal) < 1e-6);

  Parse(bridge.HandleMoveBlock(Arr(R"([{"blockId":"d1","row":3,"col":4}])")));
  const auto after_move = Parse(bridge.HandleGetParam(Arr(R"([{"blockId":"d1","key":0}])")));
  CHECK(after_move["ok"] == true && std::fabs(after_move["value"].get<double>() - kVal) < 1e-6);
}

void TestBadInputs() {
  openaxe_desktop::StudioBridge bridge;
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

  openaxe_desktop::RtCallbackState state;
  for (auto& ch : state.tap_in) ch.assign(openaxe_desktop::RtCallbackState::kTapCapacity, 0.0f);
  for (auto& ch : state.tap_out) ch.assign(openaxe_desktop::RtCallbackState::kTapCapacity, 0.0f);
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
  openaxe_desktop::RtProcessCallback(out, in, kFrames, &state);
  openaxe_desktop::RtProcessCallback(out, in, kFrames, &state);

  auto tap_in = openaxe_desktop::ReadTap(state, /*input=*/true, kFrames);
  CHECK(tap_in.frames == static_cast<unsigned int>(kFrames));
  for (int i = 0; i < kFrames; ++i) {
    CHECK(tap_in.l[i] == static_cast<float>(i));
    CHECK(tap_in.r[i] == static_cast<float>(i) * 2.0f);
  }

  auto tap_out = openaxe_desktop::ReadTap(state, /*input=*/false, kFrames);
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
  openaxe_desktop::RtCallbackState state;
  state.suspend.store(true, std::memory_order_release);

  float out0[kFrames], out1[kFrames];
  for (int i = 0; i < kFrames; ++i) out0[i] = out1[i] = 1.0f;
  float* out[2] = {out0, out1};
  float in0[kFrames], in1[kFrames];
  for (int i = 0; i < kFrames; ++i) in0[i] = in1[i] = 0.5f;
  float* in[2] = {in0, in1};

  openaxe_desktop::RtProcessCallback(out, in, kFrames, &state);

  CHECK(state.suspended_callbacks.load() == 1);
  for (int i = 0; i < kFrames; ++i) {
    CHECK(out0[i] == 0.0f);
    CHECK(out1[i] == 0.0f);
  }
}

// issue #52: the suspend handshake and the control-thread executor have only
// ever been tested in isolation (the flag directly above; add/remove/connect
// one at a time elsewhere in this file). This drives a real open+running
// audio stream and hammers the bridge with concurrent graph mutations from
// several threads at once - each one a genuine BeginSuspend/Mutate/EndSuspend
// round trip racing a real audio callback, and several threads' Call()s
// racing each other into the same control-thread queue. Success is simply
// completing without crashing or hanging, plus the bridge's own bookkeeping
// (blocks_) coming out exactly as populated - a leak there would mean the
// concurrent add/remove pairs didn't all land.
//
// Deliberately opens a single device that supports both input and output
// (e.g. an audio interface, or a loopback device like BlackHole), rather than
// resolving separate defaults for input and output. Two independent physical
// devices (this host's own default pairing is the MacBook's built-in mic +
// built-in speakers) is unconditionally rejected by Open() (see its
// comment) - this used to also reproduce a RtAudio CoreAudio-backend bug on
// exactly that single-device setup (garbage input pointer on the very first
// callback(s) during its internal duplex bridging); this test (and
// audio_io_test.cpp's TestOpenStartStop) is the regression test for the swap
// to JUCE's own from-scratch CoreAudio backend. Skips if no single
// duplex-capable device exists.
void TestConcurrentMutationsWhileStreamRunning() {
  openaxe_desktop::StudioBridge bridge;

  const auto devices = Parse(bridge.HandleListDevices(""));
  if (!devices.is_array() || devices.empty()) {
    std::printf("  Skipping concurrent-mutation stress test: no audio devices on this host\n");
    return;
  }
  // int64_t, not int: device ids are now a hash spanning the full unsigned
  // 32-bit range (see AudioIO::HashDeviceId in audio.cpp), so about half of
  // them would overflow a plain int - and this still needs a negative
  // sentinel for "not found".
  int64_t duplex_id = -1;
  for (const auto& d : devices) {
    if (d.value("isInput", false) && d.value("isOutput", false)) {
      duplex_id = d.value("id", int64_t{-1});
      break;
    }
  }
  if (duplex_id < 0) {
    std::printf(
        "  Skipping concurrent-mutation stress test: no single input+output device on this "
        "host\n");
    return;
  }

  const auto opened = Parse(bridge.HandleOpen(
      Arr((std::string(R"([{"inputDeviceId":)") + std::to_string(duplex_id) +
           R"(,"outputDeviceId":)" + std::to_string(duplex_id) + "}]")
              .c_str())));
  if (opened["ok"] != true) {
    std::printf("  Skipping concurrent-mutation stress test: open failed (%s)\n",
                opened.value("error", "").c_str());
    return;
  }
  const auto started = Parse(bridge.HandleStart(""));
  if (started["ok"] != true) {
    std::printf("  Skipping concurrent-mutation stress test: start failed (%s)\n",
                started.value("error", "").c_str());
    bridge.HandleClose("");
    return;
  }

  // One long-lived, wired block so the audio callback always has real DSP to
  // run while the worker threads add/remove others around it.
  auto anchor = Parse(bridge.HandleAddBlock(Arr(
      R"([{"kind":"mixer","row":0,"col":0,"id":"anchor"}])")));
  CHECK(anchor["ok"] == true);
  CHECK(Parse(bridge.HandleConnect(Arr(R"([{"fromId":"IN","toId":"anchor"}])")))["ok"] == true);
  CHECK(Parse(bridge.HandleConnect(Arr(R"([{"fromId":"anchor","toId":"OUT"}])")))["ok"] == true);

  // Issue #52/#59: the rare hang/crash only shows up under sustained,
  // repeated thread-creation pressure against a live audio stream. A single
  // 500ms burst was nowhere near enough to get a statistical read, so we run
  // many back-to-back rounds - each round spins up, hammers, and tears down 4
  // worker threads - which is exactly the pattern that reproduced #59.
  static const int kStressRounds = 30;
  static const char* const kKinds[] = {"delay", "reverb", "compressor", "chorus"};

  std::atomic<bool> stop{false};
  std::atomic<int> mutations{0};
  auto worker = [&](int seed) {
    int i = 0;
    while (!stop.load(std::memory_order_relaxed)) {
      const std::string id = "w" + std::to_string(seed) + "-" + std::to_string(i);
      const std::string kind = kKinds[i % 4];
      ++i;
      const auto add = Parse(bridge.HandleAddBlock(Arr(
          (std::string(R"([{"kind":")") + kind + R"(","row":1,"col":0,"id":")" + id + R"("}])")
              .c_str())));
      if (add["ok"] == true) {
        Parse(bridge.HandleSetParam(
            Arr((std::string(R"([{"blockId":")") + id + R"(","key":0,"value":0.3}])").c_str())));
        Parse(bridge.HandleRemoveBlock(
            Arr((std::string(R"([{"blockId":")") + id + R"("}])").c_str())));
      }
      mutations.fetch_add(1, std::memory_order_relaxed);
    }
  };

  for (int round = 0; round < kStressRounds; ++round) {
    std::vector<std::thread> workers;
    for (int t = 0; t < 4; ++t) workers.emplace_back(worker, t);
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    stop.store(true, std::memory_order_relaxed);
    for (auto& w : workers) w.join();
    stop.store(false, std::memory_order_relaxed);
  }

  CHECK(mutations.load() > 0);

  // The bridge must still be in a sane, queryable state: every worker's
  // add/remove pair completed, so only the anchor block should remain.
  const auto blocks = Parse(bridge.HandleListBlocks(""));
  CHECK(blocks.is_array());
  CHECK(blocks.size() == 1);
  if (blocks.is_array() && blocks.size() == 1) CHECK(blocks[0]["id"] == "anchor");

  const auto config = Parse(bridge.HandleGetConfig(""));
  CHECK(config["ok"] == true);
  CHECK(config["running"] == true);

  Parse(bridge.HandleStop(""));
  bridge.HandleClose("");

  std::printf("  TestConcurrentMutationsWhileStreamRunning: %d mutations across %d rounds x 4 threads, no crash\n",
               mutations.load(), kStressRounds);
}

// HandleOpen used to call AudioIO::Open()/SetGraph() (which resizes
// AudioEngine's ext_in_l_/ext_in_r_ and re-publishes max_block_size_) with no
// suspend/resume around it, unlike every other graph mutation in this file.
// Reopening while a previous stream was still live - a device switch, or the
// no-sound recovery poll retrying every few seconds - could race an in-flight
// nam_studio_process call against that resize: ASAN caught it as a
// heap-buffer-overflow store in AudioEngine::Process (engine.cpp, on
// ext_in_l_). This drives that exact sequence - open+start, then reopen while
// running with a real block wired in - so the race would show up as an ASAN
// abort or a crash rather than silently passing.
void TestReopenWhileStreamRunning() {
  openaxe_desktop::StudioBridge bridge;

  const auto devices = Parse(bridge.HandleListDevices(""));
  if (!devices.is_array() || devices.empty()) {
    std::printf("  Skipping reopen-while-running test: no audio devices on this host\n");
    return;
  }
  int64_t duplex_id = -1;
  for (const auto& d : devices) {
    if (d.value("isInput", false) && d.value("isOutput", false)) {
      duplex_id = d.value("id", int64_t{-1});
      break;
    }
  }
  if (duplex_id < 0) {
    std::printf(
        "  Skipping reopen-while-running test: no single input+output device on this host\n");
    return;
  }

  const std::string open_args = std::string(R"([{"inputDeviceId":)") + std::to_string(duplex_id) +
                                 R"(,"outputDeviceId":)" + std::to_string(duplex_id) + "}]";

  const auto opened = Parse(bridge.HandleOpen(Arr(open_args.c_str())));
  if (opened["ok"] != true) {
    std::printf("  Skipping reopen-while-running test: open failed (%s)\n",
                opened.value("error", "").c_str());
    return;
  }
  const auto started = Parse(bridge.HandleStart(""));
  if (started["ok"] != true) {
    std::printf("  Skipping reopen-while-running test: start failed (%s)\n",
                started.value("error", "").c_str());
    bridge.HandleClose("");
    return;
  }

  CHECK(Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"amp","row":0,"col":0,"id":"anchor"}])")))
            ["ok"] == true);
  CHECK(Parse(bridge.HandleConnect(Arr(R"([{"fromId":"IN","toId":"anchor"}])")))["ok"] == true);
  CHECK(Parse(bridge.HandleConnect(Arr(R"([{"fromId":"anchor","toId":"OUT"}])")))["ok"] == true);

  // Let real callbacks run against the anchor block for a moment, then reopen
  // (same devices, stand-in for a device switch or a recovery retry) while
  // the previous stream is still playing - this is the exact window the fix
  // suspends around.
  std::this_thread::sleep_for(std::chrono::milliseconds(50));
  for (int i = 0; i < 5; ++i) {
    const auto reopened = Parse(bridge.HandleOpen(Arr(open_args.c_str())));
    CHECK(reopened["ok"] == true);
    CHECK(Parse(bridge.HandleStart(""))["ok"] == true);
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
  }

  const auto config = Parse(bridge.HandleGetConfig(""));
  CHECK(config["ok"] == true);
  CHECK(config["running"] == true);

  Parse(bridge.HandleStop(""));
  bridge.HandleClose("");

  std::printf("  TestReopenWhileStreamRunning: 5 reopens against a live stream, no crash\n");
}

// The UI's per-block Input/Output knobs. They used to be forwarded as the
// core params `input_level`/`output_level`, which only exist on the Amp family
// and hold the loaded model's dBu calibration - so the knobs either did
// nothing or recalibrated the amp. They now drive real core I/O trims.
void TestSetBlockTrim() {
  openaxe_desktop::StudioBridge bridge;
  Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"amp","row":0,"col":0,"id":"a1"}])")));

  auto r = Parse(bridge.HandleSetBlockTrim(Arr(R"([{"blockId":"a1","input":0.5,"output":1.2}])")));
  CHECK(r["ok"] == true);

  // One key at a time is fine (the other trim is left untouched).
  r = Parse(bridge.HandleSetBlockTrim(Arr(R"([{"blockId":"a1","output":0.25}])")));
  CHECK(r["ok"] == true);
  r = Parse(bridge.HandleSetBlockTrim(Arr(R"([{"blockId":"a1","input":0}])")));
  CHECK(r["ok"] == true);

  // Unlike bypass, an unknown block is reported rather than silently accepted:
  // a dropped trim is inaudible until someone wonders why a knob does nothing.
  r = Parse(bridge.HandleSetBlockTrim(Arr(R"([{"blockId":"missing","input":0.5}])")));
  CHECK(r["ok"] == false);

  // Amp calibration params stay reachable by symbol, independent of the trims.
  r = Parse(bridge.HandleSetParam(Arr(R"([{"blockId":"a1","key":"input_level","value":-12.0}])")));
  CHECK(r["ok"] == true);
}

// The UI's reverb knobs (camelCase names, two of them abstractions with no core
// symbol) used to resolve against nothing on desktop, so the reverb had no
// working control but the algorithm selector. They now go through the core's
// ReverbControl mapping.
void TestReverbControlKeys() {
  openaxe_desktop::StudioBridge bridge;
  Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"reverb","row":0,"col":0,"id":"r1"}])")));

  for (const char* key : {"roomSize", "damping", "width", "predelay", "spin", "wander",
                          "earlySend", "dryLevel"}) {
    const std::string req = std::string(R"([{"blockId":"r1","key":")") + key + R"(","value":0.5}])";
    auto r = Parse(bridge.HandleSetParam(Arr(req.c_str())));
    CHECK(r["ok"] == true);
  }

  // Room size lands on the Hall algorithm's decay: 0.97 -> the 10s top of the
  // mapped range, read back through the plain param surface by symbol.
  Parse(bridge.HandleSetParam(Arr(R"([{"blockId":"r1","key":"roomSize","value":0.97}])")));
  auto decay = Parse(bridge.HandleGetParam(Arr(R"([{"blockId":"r1","key":"decay"}])")));
  CHECK(decay["ok"] == true);
  CHECK(std::fabs(decay["value"].get<double>() - 10.0) < 1e-3);

  // Core param symbols still work unchanged on the same block.
  auto r = Parse(bridge.HandleSetParam(Arr(R"([{"blockId":"r1","key":"diffuse","value":0.4}])")));
  CHECK(r["ok"] == true);

  // A reverb control name on a non-reverb block still falls through to the
  // normal symbol lookup, and is reported when that finds nothing.
  Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"delay","row":1,"col":0,"id":"d1"}])")));
  r = Parse(bridge.HandleSetParam(Arr(R"([{"blockId":"d1","key":"roomSize","value":0.5}])")));
  CHECK(r["ok"] == false);

  r = Parse(bridge.HandleSetParam(Arr(R"([{"blockId":"missing","key":"roomSize","value":0.5}])")));
  CHECK(r["ok"] == false);
}

// The amp block's full param surface over the bridge: the tone stack (which used
// to exist only as Web Audio biquads in the web app, so these four knobs did
// nothing on desktop) and the camelCase `slimSize` key, which resolved to no
// core symbol before the alias existed.
void TestAmpToneStackAndSlimSizeKeys() {
  openaxe_desktop::StudioBridge bridge;
  Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"amp","row":0,"col":0,"id":"a1"}])")));

  for (const char* key : {"bass", "mid", "treble", "presence"}) {
    const std::string set = std::string(R"([{"blockId":"a1","key":")") + key + R"(","value":6.0}])";
    auto r = Parse(bridge.HandleSetParam(Arr(set.c_str())));
    CHECK(r["ok"] == true);
    const std::string get = std::string(R"([{"blockId":"a1","key":")") + key + R"("}])";
    auto value = Parse(bridge.HandleGetParam(Arr(get.c_str())));
    CHECK(value["ok"] == true);
    CHECK(std::fabs(value["value"].get<double>() - 6.0) < 1e-6);
  }

  // The UI sends camelCase here; the core symbol is slim_size.
  auto r = Parse(bridge.HandleSetParam(Arr(R"([{"blockId":"a1","key":"slimSize","value":0.5}])")));
  CHECK(r["ok"] == true);
  auto slim = Parse(bridge.HandleGetParam(Arr(R"([{"blockId":"a1","key":"slim_size"}])")));
  CHECK(std::fabs(slim["value"].get<double>() - 0.5) < 1e-6);

  // An unknown key is still reported rather than silently accepted.
  r = Parse(bridge.HandleSetParam(Arr(R"([{"blockId":"a1","key":"nonsense","value":1.0}])")));
  CHECK(r["ok"] == false);
}

// Cab IR loading over the bridge: the core decodes the WAV bytes, so the desktop
// app no longer needs an AudioContext to turn an IR file into audio. Builds a
// minimal 16-bit mono WAV inline and sends it base64-encoded, exactly as the UI
// does.
void TestLoadIrWav() {
  const auto push16 = [](std::string& out, uint16_t v) {
    out.push_back(static_cast<char>(v & 0xFF));
    out.push_back(static_cast<char>((v >> 8) & 0xFF));
  };
  const auto push32 = [](std::string& out, uint32_t v) {
    for (int i = 0; i < 4; ++i) out.push_back(static_cast<char>((v >> (8 * i)) & 0xFF));
  };

  // A two-tap IR at the engine's own rate, so nothing is resampled.
  std::string data;
  push16(data, static_cast<uint16_t>(static_cast<int16_t>(32767)));  // tap at 0
  for (int i = 0; i < 63; ++i) push16(data, 0);
  push16(data, static_cast<uint16_t>(static_cast<int16_t>(16384)));  // tap at 64

  std::string wav;
  wav += "RIFF";
  push32(wav, 0);
  wav += "WAVE";
  wav += "fmt ";
  push32(wav, 16);
  push16(wav, 1);       // PCM
  push16(wav, 1);       // mono
  push32(wav, 48000);
  push32(wav, 96000);   // byte rate
  push16(wav, 2);       // block align
  push16(wav, 16);      // bits
  wav += "data";
  push32(wav, static_cast<uint32_t>(data.size()));
  wav += data;

  static constexpr char kAlphabet[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string base64;
  for (size_t i = 0; i < wav.size(); i += 3) {
    const uint32_t b0 = static_cast<unsigned char>(wav[i]);
    const uint32_t b1 = i + 1 < wav.size() ? static_cast<unsigned char>(wav[i + 1]) : 0;
    const uint32_t b2 = i + 2 < wav.size() ? static_cast<unsigned char>(wav[i + 2]) : 0;
    const uint32_t triple = (b0 << 16) | (b1 << 8) | b2;
    base64.push_back(kAlphabet[(triple >> 18) & 0x3F]);
    base64.push_back(kAlphabet[(triple >> 12) & 0x3F]);
    base64.push_back(i + 1 < wav.size() ? kAlphabet[(triple >> 6) & 0x3F] : '=');
    base64.push_back(i + 2 < wav.size() ? kAlphabet[triple & 0x3F] : '=');
  }

  openaxe_desktop::StudioBridge bridge;
  Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"cab","row":0,"col":0,"id":"c1"}])")));

  const std::string req =
      std::string(R"([{"blockId":"c1","wavBase64":")") + base64 + R"("}])";
  auto r = Parse(bridge.HandleLoadIrWav(Arr(req.c_str())));
  CHECK(r["ok"] == true);
  CHECK(r["frames"].get<int>() == 65);

  // The mix knob reaches the core through its camelCase UI key.
  r = Parse(bridge.HandleSetParam(Arr(R"([{"blockId":"c1","key":"irMix","value":0.75}])")));
  CHECK(r["ok"] == true);

  r = Parse(bridge.HandleUnloadIr(Arr(R"([{"blockId":"c1"}])")));
  CHECK(r["ok"] == true);

  // Garbage in, error out - not a crash and not a silently-installed IR.
  r = Parse(bridge.HandleLoadIrWav(Arr(R"([{"blockId":"c1","wavBase64":"bm90IGEgd2F2"}])")));
  CHECK(r["ok"] == false);
  r = Parse(bridge.HandleLoadIrWav(Arr(R"([{"blockId":"c1","wavBase64":""}])")));
  CHECK(r["ok"] == false);
  r = Parse(bridge.HandleUnloadIr(Arr(R"([{"blockId":"missing"}])")));
  CHECK(r["ok"] == false);
}

// issue #69: a cab IR payload larger than the cap must be rejected before the
// core tries to decode it (TestLoadIrWav already covers a valid small IR and a
// garbage-but-small one).
void TestLoadIrWavRejectsOversized() {
  static constexpr char kAlphabet[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  auto b64 = [](const std::string& in) {
    std::string out;
    for (size_t i = 0; i < in.size(); i += 3) {
      const uint32_t b0 = static_cast<unsigned char>(in[i]);
      const uint32_t b1 = i + 1 < in.size() ? static_cast<unsigned char>(in[i + 1]) : 0;
      const uint32_t b2 = i + 2 < in.size() ? static_cast<unsigned char>(in[i + 2]) : 0;
      const uint32_t triple = (b0 << 16) | (b1 << 8) | b2;
      out.push_back(kAlphabet[(triple >> 18) & 0x3F]);
      out.push_back(kAlphabet[(triple >> 12) & 0x3F]);
      out.push_back(i + 1 < in.size() ? kAlphabet[(triple >> 6) & 0x3F] : '=');
      out.push_back(i + 2 < in.size() ? kAlphabet[triple & 0x3F] : '=');
    }
    return out;
  };

  std::string wav = "RIFF";
  wav.append(4, '\0');
  wav += "WAVE";
  wav.append(9 * 1024 * 1024, '\0');  // > 8 MB cap
  const std::string encoded = b64(wav);

  openaxe_desktop::StudioBridge bridge;
  Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"cab","row":0,"col":0,"id":"c1"}])")));
  const std::string req = std::string(R"([{"blockId":"c1","wavBase64":")") + encoded + R"("}])";
  const auto r = Parse(bridge.HandleLoadIrWav(Arr(req.c_str())));
  CHECK(r["ok"] == false);
}

// issue #71: only loopback http(s) origins may host the privileged UI.
void TestIsTrustedUiUrl() {
  CHECK(openaxe_desktop::IsTrustedUiUrl("http://127.0.0.1:5173"));
  CHECK(openaxe_desktop::IsTrustedUiUrl("http://127.0.0.1/"));
  CHECK(openaxe_desktop::IsTrustedUiUrl("https://localhost:3000"));
  CHECK(openaxe_desktop::IsTrustedUiUrl("http://[::1]:5173"));
  CHECK(!openaxe_desktop::IsTrustedUiUrl("https://evil.example"));
  CHECK(!openaxe_desktop::IsTrustedUiUrl("http://192.168.1.5:5173"));
  CHECK(!openaxe_desktop::IsTrustedUiUrl("file:///Users/me/ui/index.html"));
  CHECK(!openaxe_desktop::IsTrustedUiUrl("data:text/html,<h1>x</h1>"));
  CHECK(!openaxe_desktop::IsTrustedUiUrl("http://127.0.0.1.evil.example"));
  CHECK(!openaxe_desktop::IsTrustedUiUrl("javascript:alert(1)"));
  CHECK(!openaxe_desktop::IsTrustedUiUrl(""));
}

// issue #69: a model JSON larger than the cap must be rejected before it
// reaches the core.
void TestLoadModelJsonRejectsOversized() {
  openaxe_desktop::StudioBridge bridge;
  Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"amp","row":0,"col":0,"id":"a1"}])")));
  const std::string big(33 * 1024 * 1024, 'a');  // > 32 MB cap
  const std::string req = std::string(R"([{"blockId":"a1","json":")") + big + R"("}])";
  const auto r = Parse(bridge.HandleLoadModelJson(Arr(req.c_str())));
  CHECK(r["ok"] == false);
}

// issue #42: bypass and the master bus were UI-only no-ops on desktop - this
// exercises the actual bridge handlers (JSON round-trip), not just the
// underlying AudioEngine methods (see engine_test.cpp in packages/core).
void TestSetBypassAndMasterBus() {
  openaxe_desktop::StudioBridge bridge;
  Parse(bridge.HandleAddBlock(Arr(R"([{"kind":"delay","row":0,"col":0,"id":"d1"}])")));

  auto r = Parse(bridge.HandleSetBypass(Arr(R"([{"blockId":"d1","bypassed":true}])")));
  CHECK(r["ok"] == true);
  r = Parse(bridge.HandleSetBypass(Arr(R"([{"blockId":"d1","bypassed":false}])")));
  CHECK(r["ok"] == true);
  // Unknown block id is a silent no-op, matching removeBlock/moveBlock.
  r = Parse(bridge.HandleSetBypass(Arr(R"([{"blockId":"missing","bypassed":true}])")));
  CHECK(r["ok"] == true);

  r = Parse(bridge.HandleSetMasterLevel(Arr(R"([{"level":0.5}])")));
  CHECK(r["ok"] == true);
  r = Parse(bridge.HandleSetMasterMuted(Arr(R"([{"muted":true}])")));
  CHECK(r["ok"] == true);
  r = Parse(bridge.HandleSetMasterMuted(Arr(R"([{"muted":false}])")));
  CHECK(r["ok"] == true);
  r = Parse(bridge.HandleSetTunerMuted(Arr(R"([{"muted":true}])")));
  CHECK(r["ok"] == true);
  r = Parse(bridge.HandleSetTunerMuted(Arr(R"([{"muted":false}])")));
  CHECK(r["ok"] == true);
}

// Backs the Tone3000 refresh token surviving an app restart (issue #146) -
// the webview's own storage can't do that here since the UI server (and so
// the webview's origin) binds a fresh ephemeral port every launch. Uses a
// test-only key so this can never collide with (or clobber) the real
// "tone3000_refresh_token" entry a live app instance has stored.
void TestSecureStorageRoundTrip() {
  openaxe_desktop::StudioBridge bridge;

  // Start from a clean slate in case a previous run of this binary crashed
  // before its own cleanup ran.
  Parse(bridge.HandleSecureDelete(Arr(R"([{"key":"bridge_test_secret"}])")));

  auto load = Parse(bridge.HandleSecureLoad(Arr(R"([{"key":"bridge_test_secret"}])")));
  CHECK(load["ok"] == true);
  CHECK(load["value"].is_null());

  auto store = Parse(bridge.HandleSecureStore(
      Arr(R"([{"key":"bridge_test_secret","value":"s3cr3t-refresh-token"}])")));
  CHECK(store["ok"] == true);

  load = Parse(bridge.HandleSecureLoad(Arr(R"([{"key":"bridge_test_secret"}])")));
  CHECK(load["ok"] == true);
  CHECK(load["value"] == "s3cr3t-refresh-token");

  // Storing again under the same key overwrites rather than erroring or
  // duplicating - a token refresh does exactly this on every app launch.
  store = Parse(bridge.HandleSecureStore(
      Arr(R"([{"key":"bridge_test_secret","value":"rotated-refresh-token"}])")));
  CHECK(store["ok"] == true);
  load = Parse(bridge.HandleSecureLoad(Arr(R"([{"key":"bridge_test_secret"}])")));
  CHECK(load["value"] == "rotated-refresh-token");

  auto del = Parse(bridge.HandleSecureDelete(Arr(R"([{"key":"bridge_test_secret"}])")));
  CHECK(del["ok"] == true);
  load = Parse(bridge.HandleSecureLoad(Arr(R"([{"key":"bridge_test_secret"}])")));
  CHECK(load["ok"] == true);
  CHECK(load["value"].is_null());

  // Deleting an already-absent key is a no-op success, matching
  // removeBlock/setBypass's unknown-id handling elsewhere in this file.
  del = Parse(bridge.HandleSecureDelete(Arr(R"([{"key":"bridge_test_secret"}])")));
  CHECK(del["ok"] == true);

  // A key that isn't a plain identifier is rejected outright - the Linux
  // fallback turns it straight into a filename (see secure_storage.cpp).
  auto bad = Parse(bridge.HandleSecureStore(Arr(R"([{"key":"../evil","value":"x"}])")));
  CHECK(bad["ok"] == false);
}

}  // namespace

int main() {
  TestVersion();
  TestAddBlockAndInfo();
  TestParamsByIndexAndSymbol();
  TestSymbolMappedParamRoundTripAllEffectKinds();
  TestConnectDisconnectAndEdges();
  TestRemoveBlockDropsEdges();
  TestMoveBlock();
  TestMoveBlockDoesNotReset();
  TestBadInputs();
  TestMonitorTap();
  TestSuspendCallbackSilencesOutput();
  TestSetBypassAndMasterBus();
  TestSetBlockTrim();
  TestReverbControlKeys();
  TestAmpToneStackAndSlimSizeKeys();
  TestLoadIrWav();
  TestConcurrentMutationsWhileStreamRunning();
  TestReopenWhileStreamRunning();
  TestIsTrustedUiUrl();
  TestLoadIrWavRejectsOversized();
  TestLoadModelJsonRejectsOversized();
  TestSecureStorageRoundTrip();

  if (g_failures > 0) {
    std::fprintf(stderr, "%d failure(s)\n", g_failures);
    return 1;
  }
  std::printf("bridge_test: all checks passed\n");
  return 0;
}