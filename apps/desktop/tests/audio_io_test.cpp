#include <RtAudio.h>

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <thread>

#include "audio.h"
#include "nam_studio/api.h"

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
NamStudioGraph* MakePassthroughGraph(double sample_rate, int block_size) {
  NamStudioGraph* graph = nam_studio_graph_create();
  const int32_t mixer = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_MIXER, 0, 0);
  nam_studio_connect(graph, NAM_STUDIO_IN_RAIL, 0, mixer, 0);
  nam_studio_connect(graph, mixer, 0, NAM_STUDIO_OUT_RAIL, 0);
  nam_studio_reset(graph, sample_rate, block_size);
  return graph;
}

void TestCallbackPassthrough() {
  constexpr double kRate = 48000.0;
  constexpr int kFrames = 64;
  constexpr int kBlock = 512;

  NamStudioGraph* graph = MakePassthroughGraph(kRate, kBlock);
  nam_desktop::RtCallbackState state;
  state.graph = graph;
  state.graph_ready.store(true, std::memory_order_release);

  float in0[kFrames], in1[kFrames], out0[kFrames], out1[kFrames];
  for (int i = 0; i < kFrames; ++i) {
    in0[i] = static_cast<float>(i) * 0.001f;
    in1[i] = -static_cast<float>(i) * 0.001f;
    out0[i] = 0.0f;
    out1[i] = 0.0f;
  }
  float* in[2] = {in0, in1};
  float* out[2] = {out0, out1};

  nam_desktop::RtProcessCallback(out, in, kFrames, 0.0, RtAudioErrorType::RTAUDIO_NO_ERROR,
                                 &state);

  CHECK(state.callbacks.load() == 1);
  CHECK(state.frames_processed.load() == static_cast<unsigned int>(kFrames));
  for (int i = 0; i < kFrames; ++i) {
    CHECK(out0[i] == in0[i]);
    CHECK(out1[i] == in1[i]);
  }

  nam_studio_graph_destroy(graph);
}

void TestCallbackSilenceWhenNoGraph() {
  constexpr int kFrames = 32;
  nam_desktop::RtCallbackState state;  // graph_ready defaults to false

  float out0[kFrames], out1[kFrames];
  for (int i = 0; i < kFrames; ++i) out0[i] = out1[i] = 1.0f;
  float* out[2] = {out0, out1};

  nam_desktop::RtProcessCallback(out, nullptr, kFrames, 0.0,
                                 RtAudioErrorType::RTAUDIO_NO_ERROR, &state);

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

  NamStudioGraph* graph = MakePassthroughGraph(kRate, kBlock);
  nam_desktop::RtCallbackState state;
  for (auto& ch : state.tap_in) ch.assign(nam_desktop::RtCallbackState::kTapCapacity, 0.0f);
  for (auto& ch : state.tap_out) ch.assign(nam_desktop::RtCallbackState::kTapCapacity, 0.0f);
  state.graph = graph;
  state.graph_ready.store(true, std::memory_order_release);

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
      nam_desktop::RtProcessCallback(out, in, kFrames, 0.0, RtAudioErrorType::RTAUDIO_NO_ERROR,
                                     &state);
      ++k;
      callbacks_done.fetch_add(1, std::memory_order_relaxed);
    }
  });

  std::thread reader([&] {
    while (!stop.load(std::memory_order_relaxed)) {
      for (const bool input : {true, false}) {
        const nam_desktop::TapFrame tap = nam_desktop::ReadTap(state, input, kFrames * 4);
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

  nam_studio_graph_destroy(graph);
}

void TestDeviceEnumeration() {
  nam_desktop::AudioIO io;
  std::vector<nam_desktop::AudioDeviceInfo> devices = io.ListDevices();
  // Hosts without audio hardware (e.g. CI) legitimately return an empty
  // list; only assert the call itself never throws.
  std::printf("  AudioIO::ListDevices: %zu device(s)\n", devices.size());
}

// Opens a real duplex stream (preferring devices that support 2 in / 2 out)
// and verifies the real-time callback actually fires. Skips silently when
// the host has no audio devices.
void TestOpenStartStop() {
  nam_desktop::AudioIO io;
  const std::vector<nam_desktop::AudioDeviceInfo> devices = io.ListDevices();
  if (devices.empty()) {
    std::printf("  Skipping open/start/stop: no audio devices on this host\n");
    return;
  }

  unsigned int input_device = 0xFFFFFFFFu;
  unsigned int output_device = 0xFFFFFFFFu;
  for (const auto& d : devices) {
    if (d.is_default && d.input_channels >= 2) input_device = d.id;
    if (d.is_default && d.output_channels >= 2) output_device = d.id;
  }
  for (const auto& d : devices) {
    if (input_device == 0xFFFFFFFFu && d.input_channels >= 2) input_device = d.id;
    if (output_device == 0xFFFFFFFFu && d.output_channels >= 2) output_device = d.id;
  }
  if (input_device == 0xFFFFFFFFu || output_device == 0xFFFFFFFFu) {
    std::printf("  Skipping open/start/stop: no 2-channel in/out device on this host\n");
    return;
  }

  const bool opened = io.Open(input_device, output_device, 48000.0, 128);
  if (!opened) {
    std::printf("  Skipping open/start/stop: stream open failed (%s)\n", io.LastError().c_str());
    return;
  }
  CHECK(io.IsOpen());
  CHECK(io.BufferFrames() <= 256);

  NamStudioGraph* graph = MakePassthroughGraph(io.SampleRate(), io.BufferFrames());
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

  nam_studio_graph_destroy(graph);
}

}  // namespace

int main() {
  TestCallbackPassthrough();
  TestCallbackSilenceWhenNoGraph();
  TestTapConcurrentReadWrite();
  TestDeviceEnumeration();
  TestOpenStartStop();

  if (g_failures > 0) {
    std::fprintf(stderr, "%d failure(s)\n", g_failures);
    return 1;
  }
  std::printf("audio_io_test: all checks passed\n");
  return 0;
}