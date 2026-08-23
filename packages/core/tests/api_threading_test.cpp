// Concurrent stress for the Tier-1 ("safe from any thread") core surface
// (issue #211): one thread runs nam_studio_process continuously while several
// others hammer the calls documented as real-time safe / callable from any
// thread - set_param/get_param/param_count, set_reverb_control (which now
// resolves through a per-block atomic cache rather than reading the live
// DspVariant), bypass, I/O trims, the master bus, meters. Success is
// completing without a crash or hang with finite output; under ThreadSanitizer
// it additionally proves those calls never read the shared non-atomic
// BlockState fields Process() owns.
//
// The Tier-2 calls (algorithm/model swaps, topology edits) are deliberately
// absent: the engine's contract is that those must not run concurrently with
// nam_studio_process, and the handshake that makes that safe lives in the
// desktop shell - see bridge_test.cpp's TestConcurrentMutationsWhileStreamRunning,
// which is the mutate-during-process stress this complements.
#include "nam_studio/api.h"

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <thread>
#include <vector>

#include "test_harness.h"

namespace {

constexpr double kSampleRate = 48000.0;
constexpr int32_t kBlockSize = 128;
constexpr int kBlocksPerBurst = 40;
constexpr int kReverbControlCount = 8;

void TestTier1ConcurrentSurfaceAgainstProcess() {
  NamStudioGraph* graph = nam_studio_graph_create();

  const int32_t mixer = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_MIXER, 0, 0);
  const int32_t amp = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_AMP, 0, 1);
  const int32_t reverb = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_REVERB, 0, 2);
  const int32_t delay = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_DELAY, 0, 3);
  NAM_EXPECT(nam_studio_connect(graph, NAM_STUDIO_IN_RAIL, 0, mixer, 0) >= 0);
  NAM_EXPECT(nam_studio_connect(graph, mixer, 0, amp, 0) >= 0);
  NAM_EXPECT(nam_studio_connect(graph, amp, 0, reverb, 0) >= 0);
  NAM_EXPECT(nam_studio_connect(graph, reverb, 0, delay, 0) >= 0);
  NAM_EXPECT(nam_studio_connect(graph, delay, 0, NAM_STUDIO_OUT_RAIL, 0) >= 0);
  nam_studio_reset(graph, kSampleRate, kBlockSize);

  const int32_t blocks[4] = {amp, reverb, delay, mixer};

  std::atomic<bool> stop{false};
  std::atomic<long> calls{0};
  std::atomic<bool> output_finite{true};

  // The "audio thread": process real buffers continuously.
  std::vector<float> in_l(kBlockSize, 0.0f), in_r(kBlockSize, 0.0f);
  std::vector<float> out_l(kBlockSize, 0.0f), out_r(kBlockSize, 0.0f);
  const float* in_ptrs[2] = {in_l.data(), in_r.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};
  std::thread audio([&] {
    while (!stop.load(std::memory_order_relaxed)) {
      for (int b = 0; b < kBlocksPerBurst; ++b) {
        in_l[0] = in_r[0] = 0.5f;
        nam_studio_process(graph, in_ptrs, 2, out_ptrs, 2, kBlockSize);
        in_l[0] = in_r[0] = 0.0f;
        for (int i = 0; i < kBlockSize; ++i) {
          if (!std::isfinite(out_l[static_cast<size_t>(i)]) ||
              !std::isfinite(out_r[static_cast<size_t>(i)])) {
            output_finite.store(false, std::memory_order_relaxed);
            return;
          }
        }
      }
    }
  });

  // The "UI/host threads": hammer the Tier-1 surface.
  auto tier1_worker = [&](int seed) {
    int i = 0;
    while (!stop.load(std::memory_order_relaxed)) {
      const int32_t block = blocks[(seed + i) % 4];
      const int count = nam_studio_block_param_count(graph, block);
      if (count > 0) {
        const int param = i % count;
        // The amp's slim-size param is Tier 2 (forwards into NAMCore) - the
        // no-model case is benign, but this test exercises only the Tier-1
        // surface, so skip it.
        if (!(block == amp && param == 2)) {
          nam_studio_set_param(graph, block, param, (i % 100) * 0.01f);
        }
        const float v = nam_studio_get_param(graph, block, param);
        (void)v;
      }
      // Reverb controls resolve through the per-block atomic control cache -
      // no DspVariant read, so this is safe racing Process().
      nam_studio_set_reverb_control(
          graph, reverb, static_cast<NamStudioReverbControl>(i % kReverbControlCount), 0.5f);
      nam_studio_set_bypass(graph, block, (i % 3) == 0 ? 1 : 0);
      nam_studio_set_block_input_trim(graph, block, 1.0f);
      nam_studio_set_block_output_trim(graph, block, 1.0f);
      nam_studio_set_master_level(graph, 1.0f);
      nam_studio_set_master_muted(graph, 0);
      nam_studio_set_tuner_muted(graph, 0);
      nam_studio_get_meter(graph, block);
      calls.fetch_add(1, std::memory_order_relaxed);
      ++i;
    }
  };

  std::vector<std::thread> workers;
  for (int t = 0; t < 4; ++t) workers.emplace_back(tier1_worker, t);
  std::this_thread::sleep_for(std::chrono::milliseconds(1500));
  stop.store(true, std::memory_order_relaxed);
  audio.join();
  for (auto& w : workers) w.join();

  NAM_EXPECT(output_finite.load());
  NAM_EXPECT(calls.load() > 0);

  nam_studio_graph_destroy(graph);
}

}  // namespace

int main() {
  TestTier1ConcurrentSurfaceAgainstProcess();
  return nam_studio::test::g_failures == 0 ? 0 : 1;
}