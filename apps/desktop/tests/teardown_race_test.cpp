// Regression test for the exit-time SIGABRT (free_list_checksum_botch /
// std::terminate in ~cocoa_wkwebview_engine): a "JS poll" thread that calls
// into the AudioIO (the React UI polls getTap every ~50ms) must NEVER touch
// RtCallbackState after it has been destroyed. The real app fixes this by
// tearing the webview (and its dispatch queue) down *before* the bridge /
// AudioIO (main.cpp now constructs the bridge first, so it destructs last),
// and by declaring RtCallbackState last in AudioIO (audio.h) so it outlives
// the audio thread.
//
// This unit test asserts the same contract at the AudioIO level: the poller
// thread is fully stopped (joined) *before* the AudioIO is destroyed. Run it
// under AddressSanitizer - a UAF here means some call path still reaches
// state_ after teardown. (To see the original bug, move `delete io` above
// `poller.join()`; ASan then reports a heap-use-after-free in GetTap.)
#include <atomic>
#include <chrono>
#include <cstdio>
#include <thread>

#include "audio.h"
#include "openaxe/api.h"

namespace {

OpenAxeGraph* MakePassthroughGraph(double sample_rate, int block_size) {
  OpenAxeGraph* graph = openaxe_graph_create();
  const int32_t mixer = openaxe_add_block(graph, OPENAXE_BLOCK_MIXER, 0, 0);
  openaxe_connect(graph, OPENAXE_IN_RAIL, 0, mixer, 0);
  openaxe_connect(graph, mixer, 0, OPENAXE_OUT_RAIL, 0);
  openaxe_reset(graph, sample_rate, block_size);
  return graph;
}

}  // namespace

int main() {
  openaxe_desktop::AudioIO io;
  const auto devices = io.ListDevices();
  if (devices.empty()) {
    std::printf("  Skipping: no audio devices on this host\n");
    return 0;
  }

  unsigned int duplex = 0xFFFFFFFFu;
  for (const auto& d : devices)
    if (d.input_channels >= 1 && d.output_channels >= 1) { duplex = d.id; break; }
  if (duplex == 0xFFFFFFFFu) {
    std::printf("  Skipping: no usable device\n");
    return 0;
  }

  if (!io.Open(duplex, duplex, 48000.0, 128)) {
    std::printf("  Skipping: open failed (%s)\n", io.LastError().c_str());
    return 0;
  }
  OpenAxeGraph* graph = MakePassthroughGraph(io.SampleRate(), io.BufferFrames());
  io.SetGraph(graph, io.SampleRate(), io.BufferFrames());
  io.Start();
  std::this_thread::sleep_for(std::chrono::milliseconds(150));

  std::atomic<bool> stop{false};
  // Mimics the React UI's webview thread polling the bridge (getTap).
  std::thread poller([&] {
    while (!stop.load(std::memory_order_relaxed)) {
      io.GetTap(/*input=*/true, 4096);
      io.GetTap(/*input=*/false, 4096);
    }
  });

  io.Stop();
  io.Close();

  // Correct contract: stop the poller (and thus all access to state_) BEFORE
  // the AudioIO is destroyed. The destructor must run with no live accessor.
  stop.store(true, std::memory_order_relaxed);
  poller.join();
  // `io` destructs here, freeing state_ with no thread still referencing it.

  openaxe_graph_destroy(graph);
  std::printf("teardown_race_test: completed (no use-after-free)\n");
  return 0;
}
