// CTest for the plugin suspend handshake (issue #126 / #43/#59 shape).
// Hammers Tier-2 mutations from a control thread while a simulated audio
// thread loops openaxe_process, with the suspend handshake serialization
// that plugin.h exposes (BeginSuspend/EndSuspend). Under ThreadSanitizer this
// must produce zero data races; without TSan it must not crash and must
// produce finite output.

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <thread>
#include <vector>

#include "openaxe/api.h"

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

// Minimal handshake simulator mirroring OpenAxePlugin's atomics (plugin.h).
struct Handshake {
  std::atomic<bool> suspend_requested{false};
  std::atomic<unsigned> suspend_ack{0};

  bool BeginSuspend() {
    const unsigned before = suspend_ack.load(std::memory_order_acquire);
    suspend_requested.store(true, std::memory_order_release);
    for (int i = 0; i < 2000; ++i) {
      if (suspend_ack.load(std::memory_order_acquire) > before) return true;
      if (i < 20) std::this_thread::yield();
      else std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    return false;
  }
  void EndSuspend() { suspend_requested.store(false, std::memory_order_release); }
};

bool IsFinite(float v) { return std::isfinite(v); }

}  // namespace

int main() {
  constexpr double kRate = 48000.0;
  constexpr int kBlock = 128;
  OpenAxeGraph* g = openaxe_graph_create();
  // Start with a passthrough rig; the control thread will mutate it.
  {
    const int32_t mixer = openaxe_add_block(g, OPENAXE_BLOCK_MIXER, 0, 0);
    openaxe_connect(g, OPENAXE_IN_RAIL, 0, mixer, 0);
    openaxe_connect(g, mixer, 0, OPENAXE_OUT_RAIL, 0);
  }
  openaxe_reset(g, kRate, kBlock);

  Handshake hs;
  std::atomic<bool> stop{false};
  std::atomic<bool> audio_failed{false};
  std::atomic<unsigned> process_calls{0};

  // Audio thread: loops openaxe_process, observing the suspend flag like
  // OpenAxePlugin::ProcessBlock does (silence + ack when suspended).
  std::thread audio([&] {
    float in_buf[kBlock];
    float out_l[kBlock], out_r[kBlock];
    for (int i = 0; i < kBlock; ++i) in_buf[i] = std::sin(float(i) * 0.07f) * 0.2f;
    const float* in[2] = {in_buf, in_buf};
    float* out[2] = {out_l, out_r};
    while (!stop.load(std::memory_order_relaxed)) {
      if (hs.suspend_requested.load(std::memory_order_acquire)) {
        hs.suspend_ack.fetch_add(1, std::memory_order_release);
        // Spin while suspended (host would keep calling ProcessBlock with
        // silence). Yield so control thread makes progress.
        std::this_thread::yield();
        continue;
      }
      openaxe_process(g, in, 2, out, 2, kBlock);
      for (int i = 0; i < kBlock; ++i) {
        if (!IsFinite(out_l[i]) || !IsFinite(out_r[i])) {
          audio_failed.store(true, std::memory_order_relaxed);
        }
      }
      process_calls.fetch_add(1, std::memory_order_relaxed);
    }
  });

  // Control thread (this thread): hammer Tier-2 mutations through the
  // handshake, interleaved with Tier-1 param writes that are safe without it.
  // This is the #43/#59 shape: many topology edits + param writes while
  // processing runs.
  std::vector<int32_t> blocks;
  for (int iter = 0; iter < 80; ++iter) {
    // Cheap Tier-1 param writes without suspend (exercise the lock-free path).
    for (int32_t id : blocks) {
      openaxe_set_param(g, id, 0, float(iter % 10) * 0.1f);
    }

    // Tier-2 mutation: add/remove/connect/disconnect + reset under handshake.
    hs.BeginSuspend();
    // Add a block, wire it, or remove one at random.
    if (blocks.size() < 6 && (iter % 3 == 0)) {
      const OpenAxeBlockKind kinds[] = {
          OPENAXE_BLOCK_COMPRESSOR, OPENAXE_BLOCK_EQ, OPENAXE_BLOCK_DELAY,
          OPENAXE_BLOCK_REVERB, OPENAXE_BLOCK_NOISE_GATE};
      const auto k = kinds[iter % 5];
      const int32_t id = openaxe_add_block(g, k, 0, static_cast<int32_t>(blocks.size()));
      // Connect incrementally; failures are expected (validation may reject).
      blocks.push_back(id);
    } else if (!blocks.empty() && (iter % 5 == 0)) {
      const int32_t id = blocks.back();
      blocks.pop_back();
      openaxe_remove_block(g, id);
    }
    if (!blocks.empty()) {
      // Try wiring first block IN->block and last block -> OUT (idempotent).
      openaxe_connect(g, OPENAXE_IN_RAIL, 0, blocks.front(), 0);
      openaxe_connect(g, blocks.back(), 0, OPENAXE_OUT_RAIL, 0);
    }
    openaxe_reset(g, kRate, kBlock);
    hs.EndSuspend();

    // Small pause to let audio thread interleave.
    std::this_thread::sleep_for(std::chrono::milliseconds(2));
  }

  stop.store(true, std::memory_order_relaxed);
  audio.join();

  CHECK(!audio_failed.load());
  CHECK(process_calls.load() > 0);
  std::printf("  suspend stress: %u process calls, %zu blocks final, no NaN/race\n",
              process_calls.load(), blocks.size());

  openaxe_graph_destroy(g);

  if (g_failures > 0) {
    std::fprintf(stderr, "%d failure(s)\n", g_failures);
    return 1;
  }
  std::printf("suspend_test: all checks passed\n");
  return 0;
}
