#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <thread>

#include "audio.h"
#include "openaxe/api.h"

// The audio callback test is deterministic - it calls RtProcessCallback with
// fake buffers, no hardware needed. The open/start/stop test only runs when
// the host has an audio device (CI runners often don't), and skips otherwise.

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

// Build a passthrough rig: IN rail -> Mixer -> OUT rail. The mixer is a
// monostate block (no DSP), so its output equals its input exactly.
OpenAxeGraph* MakePassthroughGraph(double sample_rate, int block_size) {
  OpenAxeGraph* graph = openaxe_graph_create();
  const int32_t mixer = openaxe_add_block(graph, OPENAXE_BLOCK_MIXER, 0, 0);
  openaxe_connect(graph, OPENAXE_IN_RAIL, 0, mixer, 0);
  openaxe_connect(graph, mixer, 0, OPENAXE_OUT_RAIL, 0);
  openaxe_reset(graph, sample_rate, block_size);
  return graph;
}

// Default callback frame count for TestCallbackInputChannelRouting's run_mode
// helper. It must live at namespace scope: a default argument may not reference
// a function-local variable (GCC rejects it; Clang happens to fold the
// constexpr), so the local kFrames the test body uses for its arrays cannot be
// named there.
constexpr int kDefaultRoutingFrames = 64;

void TestCallbackPassthrough() {
  constexpr double kRate = 48000.0;
  constexpr int kFrames = 64;
  constexpr int kBlock = 512;

  OpenAxeGraph* graph = MakePassthroughGraph(kRate, kBlock);
  openaxe_desktop::RtCallbackState state;
  state.graph = graph;
  state.graph_ready.store(true, std::memory_order_release);
  // Untouched stereo passthrough (the non-default routing mode).
  state.input_channel_mode.store(static_cast<int>(openaxe_desktop::InputChannelMode::kStereo),
                                 std::memory_order_relaxed);

  float in0[kFrames], in1[kFrames], out0[kFrames], out1[kFrames];
  for (int i = 0; i < kFrames; ++i) {
    in0[i] = static_cast<float>(i) * 0.001f;
    in1[i] = -static_cast<float>(i) * 0.001f;
    out0[i] = 0.0f;
    out1[i] = 0.0f;
  }
  float* in[2] = {in0, in1};
  float* out[2] = {out0, out1};

  openaxe_desktop::RtProcessCallback(out, in, kFrames, &state);

  CHECK(state.callbacks.load() == 1);
  CHECK(state.frames_processed.load() == static_cast<unsigned int>(kFrames));
  for (int i = 0; i < kFrames; ++i) {
    CHECK(out0[i] == in0[i]);
    CHECK(out1[i] == in1[i]);
  }

  openaxe_graph_destroy(graph);
}

// Issue #115: the input TRIM scales the signal before the graph AND before the
// monitor tap, so the input meter/tuner read post-trim exactly as they do on
// the web path (where they hang off the input GainNode's output).
void TestCallbackAppliesInputGain() {
  constexpr double kRate = 48000.0;
  constexpr int kFrames = 64;
  constexpr int kBlock = 512;
  constexpr float kGain = 0.5f;

  OpenAxeGraph* graph = MakePassthroughGraph(kRate, kBlock);
  openaxe_desktop::RtCallbackState state;
  for (auto& ch : state.tap_in) ch.assign(openaxe_desktop::RtCallbackState::kTapCapacity, 0.0f);
  for (auto& ch : state.tap_out) ch.assign(openaxe_desktop::RtCallbackState::kTapCapacity, 0.0f);
  for (auto& ch : state.in_scratch) ch.assign(kBlock, 0.0f);
  state.graph = graph;
  state.graph_ready.store(true, std::memory_order_release);
  state.input_gain.store(kGain, std::memory_order_relaxed);
  // Per-channel expectations below need the untouched stereo passthrough.
  state.input_channel_mode.store(static_cast<int>(openaxe_desktop::InputChannelMode::kStereo),
                                 std::memory_order_relaxed);

  float in0[kFrames], in1[kFrames], out0[kFrames], out1[kFrames];
  for (int i = 0; i < kFrames; ++i) {
    in0[i] = 0.5f;
    in1[i] = -0.25f;
    out0[i] = out1[i] = 0.0f;
  }
  float* in[2] = {in0, in1};
  float* out[2] = {out0, out1};

  openaxe_desktop::RtProcessCallback(out, in, kFrames, &state);

  for (int i = 0; i < kFrames; ++i) {
    CHECK(out0[i] == 0.5f * kGain);
    CHECK(out1[i] == -0.25f * kGain);
    // The backend's own input buffers must never be written to - only the
    // scratch copy is scaled.
    CHECK(in0[i] == 0.5f);
    CHECK(in1[i] == -0.25f);
  }

  const openaxe_desktop::TapFrame tap = openaxe_desktop::ReadTap(state, /*input=*/true, kFrames);
  CHECK(tap.frames == static_cast<unsigned int>(kFrames));
  for (unsigned int i = 0; i < tap.frames; ++i) {
    CHECK(tap.l[i] == 0.5f * kGain);
    CHECK(tap.r[i] == -0.25f * kGain);
  }

  openaxe_graph_destroy(graph);
}

// Unity gain must not route through the scratch buffers at all, and an
// unsized scratch (a block bigger than SetGraph armed for) must fall back to
// the untrimmed signal rather than allocate on the audio thread.
void TestCallbackInputGainEdgeCases() {
  constexpr double kRate = 48000.0;
  constexpr int kFrames = 64;
  constexpr int kBlock = 512;

  OpenAxeGraph* graph = MakePassthroughGraph(kRate, kBlock);
  openaxe_desktop::RtCallbackState state;
  state.graph = graph;
  state.graph_ready.store(true, std::memory_order_release);

  float in0[kFrames], out0[kFrames];
  for (int i = 0; i < kFrames; ++i) {
    in0[i] = 0.5f;
    out0[i] = 0.0f;
  }
  float* in[1] = {in0};
  float* out[1] = {out0};
  state.input_channels = 1;
  state.output_channels = 1;

  // Unity: scratch is empty, but unity never needs it.
  openaxe_desktop::RtProcessCallback(out, in, kFrames, &state);
  for (int i = 0; i < kFrames; ++i) CHECK(out0[i] == 0.5f);

  // Non-unity with a scratch too small for this block: untrimmed, not crashed.
  state.input_gain.store(0.25f, std::memory_order_relaxed);
  for (auto& ch : state.in_scratch) ch.assign(kFrames / 2, 0.0f);
  for (int i = 0; i < kFrames; ++i) out0[i] = 0.0f;
  openaxe_desktop::RtProcessCallback(out, in, kFrames, &state);
  for (int i = 0; i < kFrames; ++i) CHECK(out0[i] == 0.5f);

  openaxe_graph_destroy(graph);
}

void TestCallbackSilenceWhenNoGraph() {
  constexpr int kFrames = 32;
  openaxe_desktop::RtCallbackState state;  // graph_ready defaults to false

  float out0[kFrames], out1[kFrames];
  for (int i = 0; i < kFrames; ++i) out0[i] = out1[i] = 1.0f;
  float* out[2] = {out0, out1};

  openaxe_desktop::RtProcessCallback(out, nullptr, kFrames, &state);

  for (int i = 0; i < kFrames; ++i) {
    CHECK(out0[i] == 0.0f);
    CHECK(out1[i] == 0.0f);
  }
}

// Issue #43: hammer the tap's writer (CaptureTap, via RtProcessCallback) and
// its seqlock reader (ReadTap) concurrently for a bounded time. The writer
// must never block (no locks anywhere in its path) and the reader must never
// observe a torn snapshot.
//
// Each simulated callback stamps its whole buffer with one value `v` on the
// left channel and `2v` on the right (a passthrough graph carries that
// straight to the output tap too), so `r[i] == 2 * l[i]` at every index is an
// invariant that holds for any single completed write - and is exactly what a
// torn read (mixing two different writes within one snapshot) would break.
void TestTapConcurrentReadWrite() {
  constexpr double kRate = 48000.0;
  constexpr int kFrames = 128;
  constexpr int kBlock = 512;

  OpenAxeGraph* graph = MakePassthroughGraph(kRate, kBlock);
  openaxe_desktop::RtCallbackState state;
  for (auto& ch : state.tap_in) ch.assign(openaxe_desktop::RtCallbackState::kTapCapacity, 0.0f);
  for (auto& ch : state.tap_out) ch.assign(openaxe_desktop::RtCallbackState::kTapCapacity, 0.0f);
  state.graph = graph;
  state.graph_ready.store(true, std::memory_order_release);
  // The r == 2*l tap invariant below needs the untouched stereo passthrough.
  state.input_channel_mode.store(static_cast<int>(openaxe_desktop::InputChannelMode::kStereo),
                                 std::memory_order_relaxed);

  std::atomic<bool> stop{false};
  std::atomic<bool> reader_failed{false};
  std::atomic<unsigned int> reads_done{0};
  std::atomic<unsigned int> callbacks_done{0};

  std::thread writer([&] {
    float in0[kFrames], in1[kFrames], out0[kFrames], out1[kFrames];
    float* in[2] = {in0, in1};
    float* out[2] = {out0, out1};
    unsigned int k = 0;
    while (!stop.load(std::memory_order_relaxed)) {
      const float value = static_cast<float>(k % 1000);
      for (int i = 0; i < kFrames; ++i) {
        in0[i] = value;
        in1[i] = value * 2.0f;
      }
      openaxe_desktop::RtProcessCallback(out, in, kFrames, &state);
      ++k;
      callbacks_done.fetch_add(1, std::memory_order_relaxed);
    }
  });

  std::thread reader([&] {
    while (!stop.load(std::memory_order_relaxed)) {
      for (const bool input : {true, false}) {
        const openaxe_desktop::TapFrame tap = openaxe_desktop::ReadTap(state, input, kFrames * 4);
        for (unsigned int i = 0; i < tap.frames; ++i) {
          if (tap.r[i] != tap.l[i] * 2.0f) reader_failed.store(true, std::memory_order_relaxed);
        }
      }
      reads_done.fetch_add(1, std::memory_order_relaxed);
    }
  });

  std::this_thread::sleep_for(std::chrono::milliseconds(300));
  stop.store(true, std::memory_order_relaxed);
  writer.join();
  reader.join();

  CHECK(!reader_failed.load());
  CHECK(callbacks_done.load() > 0);
  CHECK(reads_done.load() > 0);
  std::printf("  TestTapConcurrentReadWrite: %u callbacks, %u reads, no torn read\n",
              callbacks_done.load(), reads_done.load());

  openaxe_graph_destroy(graph);
}

// A second process touching the same shared audio device (e.g. a browser tab
// also open on the built-in mic/speakers) can force the OS to reconfigure the
// device mid-stream. Once AudioIO's device error callback observes that (see
// AudioIO::HandleStreamError), RtProcessCallback must stop touching
// input_channels/output_channels against buffers whose real shape may have
// just changed - checked here without needing real hardware, since the
// callback takes RtCallbackState directly.
void TestCallbackHoldsSilenceOnStreamError() {
  constexpr double kRate = 48000.0;
  constexpr int kFrames = 32;
  constexpr int kBlock = 512;

  OpenAxeGraph* graph = MakePassthroughGraph(kRate, kBlock);
  openaxe_desktop::RtCallbackState state;
  state.graph = graph;
  state.graph_ready.store(true, std::memory_order_release);
  state.stream_error.store(true, std::memory_order_release);

  // Sentinel values the callback must never touch - not zeroed (that would
  // still mean it read/wrote the buffer, just not through openaxe_process)
  // and not passed through either.
  float in0[kFrames], in1[kFrames], out0[kFrames], out1[kFrames];
  for (int i = 0; i < kFrames; ++i) {
    in0[i] = 1.0f;
    in1[i] = 1.0f;
    out0[i] = -1.0f;
    out1[i] = -1.0f;
  }
  float* in[2] = {in0, in1};
  float* out[2] = {out0, out1};

  const unsigned int callbacks_before = state.callbacks.load();
  openaxe_desktop::RtProcessCallback(out, in, kFrames, &state);

  // Still counted as a callback (diagnostics keep working)...
  CHECK(state.callbacks.load() == callbacks_before + 1);
  // ...but the output buffer is untouched - proof openaxe_process was
  // never called with it, and nothing else wrote to it either.
  for (int i = 0; i < kFrames; ++i) {
    CHECK(out0[i] == -1.0f);
    CHECK(out1[i] == -1.0f);
  }

  openaxe_graph_destroy(graph);
}

// A fresh AudioIO (or one that just reopened successfully) must report no
// pending stream error - otherwise the JS layer's poll would immediately
// treat a perfectly healthy stream as broken.
void TestTakeStreamErrorDefaultsToNoError() {
  openaxe_desktop::AudioIO io;
  std::string message;
  CHECK(!io.TakeStreamError(&message));
  CHECK(message.empty());
}

void TestDeviceEnumeration() {
  openaxe_desktop::AudioIO io;
  std::vector<openaxe_desktop::AudioDeviceInfo> devices = io.ListDevices();
  // Hosts without audio hardware (e.g. CI) legitimately return an empty
  // list; only assert the call itself never throws.
  std::printf("  AudioIO::ListDevices: %zu device(s)\n", devices.size());
  for (size_t i = 0; i < devices.size(); ++i) {
    const auto& d = devices[i];
    std::printf("    [%zu] name='%s' id=%u default=%d in=%d out=%d inCh=%d outCh=%d api=%s\n",
                i, d.name.c_str(), d.id, d.is_default ? 1 : 0, d.is_input ? 1 : 0,
                d.is_output ? 1 : 0, d.input_channels, d.output_channels, d.api.c_str());
  }
}

// Opens a real duplex stream on a single device that offers 2 in / 2 out and
// verifies the real-time callback actually fires. Skips silently when the
// host has no such device.
//
// Open() rejects two independent physical devices outright (an unfixable
// acoustic feedback loop from mic straight into open speakers - see Open()'s
// comment) - so this deliberately looks for one device that can serve both
// directions, rather than picking the best input and the best output
// independently. This test previously reproduced a RtAudio CoreAudio-backend
// crash (garbage input pointer on the very first callback(s) during its
// internal duplex bridging) on this exact single-device setup - it's now the
// regression test for the swap to miniaudio's own from-scratch CoreAudio
// backend.
void TestOpenStartStop() {
  openaxe_desktop::AudioIO io;
  const std::vector<openaxe_desktop::AudioDeviceInfo> devices = io.ListDevices();
  if (devices.empty()) {
    std::printf("  Skipping open/start/stop: no audio devices on this host\n");
    return;
  }

  unsigned int duplex_device = 0xFFFFFFFFu;
  for (const auto& d : devices) {
    if (d.input_channels >= 2 && d.output_channels >= 2) {
      duplex_device = d.id;
      if (d.is_default) break;  // prefer a default duplex device if one exists
    }
  }
  if (duplex_device == 0xFFFFFFFFu) {
    std::printf(
        "  Skipping open/start/stop: no single device offers 2-channel in+out on this host\n");
    return;
  }

  const bool opened = io.Open(duplex_device, duplex_device, 48000.0, 128);
  if (!opened) {
    std::printf("  Skipping open/start/stop: stream open failed (%s)\n", io.LastError().c_str());
    return;
  }
  CHECK(io.IsOpen());
  CHECK(io.BufferFrames() <= 256);

  OpenAxeGraph* graph = MakePassthroughGraph(io.SampleRate(), io.BufferFrames());
  io.SetGraph(graph, io.SampleRate(), io.BufferFrames());
  CHECK(io.Start());

  // Give the device a moment to run a few callbacks.
  std::this_thread::sleep_for(std::chrono::milliseconds(200));
  CHECK(io.CallbackCount() > 0);
  CHECK(io.FramesProcessed() >= io.CallbackCount());

  CHECK(io.Stop());
  CHECK(!io.IsRunning());
  io.Close();
  CHECK(!io.IsOpen());

  openaxe_graph_destroy(graph);
}

// Two independent physical devices for input/output cause an acoustic
// feedback loop the app has no way to fix - Open() must refuse the pairing
// outright rather than let it happen.
void TestOpenAcceptsSplitDevices() {
  openaxe_desktop::AudioIO io;
  const std::vector<openaxe_desktop::AudioDeviceInfo> devices = io.ListDevices();
  if (devices.size() < 2) {
    std::printf("  Skipping split-device test: fewer than 2 devices on this host\n");
    return;
  }

  const unsigned int a = devices[0].id;
  const unsigned int b = devices[1].id;
  // Open() no longer refuses different input/output endpoints outright - it
  // lets miniaudio's duplex device bridge them (needed for interfaces like the
  // FM3 that CoreAudio exposes under separate input/output names). It may still
  // fail for genuine hardware reasons, but the old "must be the same audio
  // device" rejection is gone, so that specific error must never appear.
  io.Open(a, b, 48000.0, 128);
  const std::string err = io.LastError();
  CHECK(err.find("must be the same audio device") == std::string::npos);
  io.Close();
}

// The ioStore strings map to routing modes exactly like the web's
// buildChannelRouter and the VST3's InputChannelModeFromName. Unknown names
// degrade to stereo passthrough rather than silence.
void TestInputChannelModeFromName() {
  using openaxe_desktop::InputChannelMode;
  using openaxe_desktop::InputChannelModeFromName;
  CHECK(InputChannelModeFromName("l") == InputChannelMode::kLeft);
  CHECK(InputChannelModeFromName("r") == InputChannelMode::kRight);
  CHECK(InputChannelModeFromName("sum") == InputChannelMode::kSum);
  CHECK(InputChannelModeFromName("stereo") == InputChannelMode::kStereo);
  CHECK(InputChannelModeFromName("") == InputChannelMode::kStereo);
  CHECK(InputChannelModeFromName("bogus") == InputChannelMode::kStereo);
}

// Input channel routing: a guitar is one cable on a stereo pair, so the
// desktop reduces stereo live input to the selected mono source before the
// graph - the core then duplicates it to centered stereo out. kStereo keeps
// the untouched passthrough. The monitor tap mirrors the routed signal on
// both channels, so meters/tuner agree with what the rig processes.
void TestCallbackInputChannelRouting() {
  using openaxe_desktop::InputChannelMode;
  constexpr double kRate = 48000.0;
  constexpr int kFrames = 64;
  constexpr int kBlock = 512;

  auto run_mode = [&](InputChannelMode mode, int in_ch, float* in_bufs[2], float* out_bufs[2],
                      openaxe_desktop::TapFrame* tap, int frames = kDefaultRoutingFrames) {
    OpenAxeGraph* graph = MakePassthroughGraph(kRate, kBlock);
    openaxe_desktop::RtCallbackState state;
    for (auto& ch : state.tap_in)
      ch.assign(openaxe_desktop::RtCallbackState::kTapCapacity, 0.0f);
    for (auto& ch : state.tap_out)
      ch.assign(openaxe_desktop::RtCallbackState::kTapCapacity, 0.0f);
    for (auto& ch : state.in_scratch) ch.assign(kBlock, 0.0f);
    state.graph = graph;
    state.graph_ready.store(true, std::memory_order_release);
    state.input_channels = in_ch;
    state.output_channels = 2;
    state.input_channel_mode.store(static_cast<int>(mode), std::memory_order_relaxed);

    openaxe_desktop::RtProcessCallback(out_bufs, in_bufs, frames, &state);
    if (tap) *tap = openaxe_desktop::ReadTap(state, /*input=*/true, frames);

    openaxe_graph_destroy(graph);
  };

  // Default mode is Ch 1 (mirrors the web's inputChannel 'l'): stereo in
  // comes out dual-mono from channel 0 - the reported "mono in, mono out"
  // case now lands centered instead of left-only.
  {
    float in0[kFrames], in1[kFrames], out0[kFrames], out1[kFrames];
    for (int i = 0; i < kFrames; ++i) {
      in0[i] = 0.5f;
      in1[i] = -0.25f;
      out0[i] = out1[i] = 0.0f;
    }
    float* in[2] = {in0, in1};
    float* out[2] = {out0, out1};
    openaxe_desktop::RtCallbackState fresh;  // assert the shipped default
    CHECK(fresh.input_channel_mode.load() == static_cast<int>(InputChannelMode::kLeft));
    openaxe_desktop::TapFrame tap;
    run_mode(InputChannelMode::kLeft, 2, in, out, &tap);
    for (int i = 0; i < kFrames; ++i) {
      CHECK(out0[i] == 0.5f);
      CHECK(out1[i] == 0.5f);
      CHECK(in0[i] == 0.5f);  // backend buffers never written, only scratch
      CHECK(in1[i] == -0.25f);
    }
    CHECK(tap.frames == static_cast<unsigned int>(kFrames));
    for (unsigned int i = 0; i < tap.frames; ++i) {
      CHECK(tap.l[i] == 0.5f);
      CHECK(tap.r[i] == 0.5f);
    }
  }

  // Ch 2 takes channel 1 as mono.
  {
    float in0[kFrames], in1[kFrames], out0[kFrames], out1[kFrames];
    for (int i = 0; i < kFrames; ++i) {
      in0[i] = 0.5f;
      in1[i] = -0.25f;
      out0[i] = out1[i] = 0.0f;
    }
    float* in[2] = {in0, in1};
    float* out[2] = {out0, out1};
    run_mode(InputChannelMode::kRight, 2, in, out, nullptr);
    for (int i = 0; i < kFrames; ++i) {
      CHECK(out0[i] == -0.25f);
      CHECK(out1[i] == -0.25f);
    }
  }

  // Ch 1+2 averages (halved, matching the web down-mix and the plugin).
  {
    float in0[kFrames], in1[kFrames], out0[kFrames], out1[kFrames];
    for (int i = 0; i < kFrames; ++i) {
      in0[i] = 0.5f;
      in1[i] = -0.25f;
      out0[i] = out1[i] = 0.0f;
    }
    float* in[2] = {in0, in1};
    float* out[2] = {out0, out1};
    run_mode(InputChannelMode::kSum, 2, in, out, nullptr);
    for (int i = 0; i < kFrames; ++i) {
      CHECK(out0[i] == 0.125f);
      CHECK(out1[i] == 0.125f);
    }
  }

  // Stereo keeps the untouched passthrough.
  {
    float in0[kFrames], in1[kFrames], out0[kFrames], out1[kFrames];
    for (int i = 0; i < kFrames; ++i) {
      in0[i] = 0.5f;
      in1[i] = -0.25f;
      out0[i] = out1[i] = 0.0f;
    }
    float* in[2] = {in0, in1};
    float* out[2] = {out0, out1};
    run_mode(InputChannelMode::kStereo, 2, in, out, nullptr);
    for (int i = 0; i < kFrames; ++i) {
      CHECK(out0[i] == 0.5f);
      CHECK(out1[i] == -0.25f);
    }
  }

  // A genuinely mono source is already mono: routing is a no-op whatever the
  // mode, and the core duplicates it to both outputs.
  {
    float in0[kFrames], out0[kFrames], out1[kFrames];
    for (int i = 0; i < kFrames; ++i) {
      in0[i] = 0.5f;
      out0[i] = out1[i] = 0.0f;
    }
    float* in[2] = {in0, nullptr};
    float* out[2] = {out0, out1};
    run_mode(InputChannelMode::kRight, 1, in, out, nullptr);
    for (int i = 0; i < kFrames; ++i) {
      CHECK(out0[i] == 0.5f);
      CHECK(out1[i] == 0.5f);
    }
  }

  // Routing must still apply when the callback block exactly fills the
  // in_scratch capacity - the boundary the DataCallback chunk cap guarantees
  // (native periods larger than the requested block used to silently degrade
  // the routing/DI/TRIM guards to passthrough).
  {
    constexpr int kScratchFull = kBlock;  // in_scratch is sized kBlock above
    float in0[kScratchFull], in1[kScratchFull], out0[kScratchFull], out1[kScratchFull];
    for (int i = 0; i < kScratchFull; ++i) {
      in0[i] = 0.5f;
      in1[i] = -0.25f;
      out0[i] = out1[i] = 0.0f;
    }
    float* in[2] = {in0, in1};
    float* out[2] = {out0, out1};
    run_mode(InputChannelMode::kLeft, 2, in, out, nullptr, kScratchFull);
    for (int i = 0; i < kScratchFull; ++i) {
      CHECK(out0[i] == 0.5f);
      CHECK(out1[i] == 0.5f);
    }
  }
}

// SetInputChannelMode round-trips through AudioIO (safe headless - it only
// touches the routing atomic), including the unknown-mode fallback.
void TestAudioIOInputChannelMode() {
  openaxe_desktop::AudioIO io;
  CHECK(io.InputChannelModeName() == "l");  // shipped default mirrors the web
  io.SetInputChannelMode("r");
  CHECK(io.InputChannelModeName() == "r");
  io.SetInputChannelMode("sum");
  CHECK(io.InputChannelModeName() == "sum");
  io.SetInputChannelMode("stereo");
  CHECK(io.InputChannelModeName() == "stereo");
  io.SetInputChannelMode("bogus");
  CHECK(io.InputChannelModeName() == "stereo");
}

}  // namespace

int main() {
  TestCallbackPassthrough();
  TestCallbackAppliesInputGain();
  TestCallbackInputGainEdgeCases();
  TestCallbackSilenceWhenNoGraph();
  TestCallbackHoldsSilenceOnStreamError();
  TestTakeStreamErrorDefaultsToNoError();
  TestTapConcurrentReadWrite();
  TestDeviceEnumeration();
  TestOpenStartStop();
  TestOpenAcceptsSplitDevices();
  TestInputChannelModeFromName();
  TestCallbackInputChannelRouting();
  TestAudioIOInputChannelMode();

  if (g_failures > 0) {
    std::fprintf(stderr, "%d failure(s)\n", g_failures);
    return 1;
  }
  std::printf("audio_io_test: all checks passed\n");
  return 0;
}