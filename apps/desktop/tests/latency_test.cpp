#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

#include "audio.h"
#include "latency.h"
#include "nam_studio/api.h"

// Issue #15 M5: latency validation against the <5ms target.
//
// The DSP processing path's added latency is under the shell's control and is
// asserted strictly (a sample-accurate passthrough adds 0 frames). Device I/O
// latency depends on the host hardware + buffer size, so it's measured and
// reported against the target rather than hard-asserted (and skipped entirely
// on hosts without audio devices, keeping CI green headless).

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

void TestDspPassthroughLatency() {
  constexpr double kRate = 48000.0;
  constexpr int kBlock = 256;
  constexpr int kImpulse = 8;

  const int added = nam_desktop::MeasureDspLatencyFrames(kRate, kBlock, kImpulse);
  const double ms = nam_desktop::LatencyMs(added, kRate);

  // Passthrough is sample-accurate - the shell's processing must add no
  // latency, and certainly well under the 5ms budget.
  CHECK(added == 0);
  CHECK(ms < 5.0);
  std::printf("  passthrough DSP added latency: %d frames (%.3f ms) [target <5ms]\n", added, ms);
}

// A Delay with a known time must reproduce that delay with negligible extra
// overhead - validates we can measure DSP delay and that routing adds ~nothing.
void TestDelayLatency() {
  constexpr double kRate = 48000.0;
  constexpr int kBlock = 512;
  constexpr double kTimeMs = 100.0;
  const int expected = static_cast<int>(kTimeMs / 1000.0 * kRate);  // 4800 @48k

  NamStudioGraph* graph = nam_studio_graph_create();
  const int32_t delay = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_DELAY, 0, 0);
  nam_studio_connect(graph, NAM_STUDIO_IN_RAIL, 0, delay, 0);
  nam_studio_connect(graph, delay, 0, NAM_STUDIO_OUT_RAIL, 0);
  nam_studio_reset(graph, kRate, kBlock);
  // Delay time is param index 0 (ms).
  nam_studio_set_param(graph, delay, 0, static_cast<float>(kTimeMs));

  const int window = expected + kBlock * 2;
  std::vector<float> out(static_cast<size_t>(window), 0.0f);
  float in_buf[kBlock] = {0.0f};
  in_buf[0] = 1.0f;  // impulse at the start of the first chunk

  int global = 0;
  for (int off = 0; off < window; off += kBlock) {
    const int n = std::min(kBlock, window - off);
    float out0[kBlock] = {0.0f}, out1[kBlock] = {0.0f};
    const float* in[2] = {in_buf, in_buf};
    float* o[2] = {out0, out1};
    nam_studio_process(graph, in, 2, o, 2, n);
    for (int i = 0; i < n; ++i) out[static_cast<size_t>(global + i)] = out0[i];
    global += n;
    for (int i = 0; i < kBlock; ++i) in_buf[i] = 0.0f;  // subsequent chunks: silence
  }
  nam_studio_graph_destroy(graph);

  // Find the delayed impulse (ignore the pre-delay region).
  int peak = 0;
  float peak_value = -1.0f;
  for (int i = expected / 2; i < window; ++i) {
    if (out[static_cast<size_t>(i)] > peak_value) {
      peak_value = out[static_cast<size_t>(i)];
      peak = i;
    }
  }
  const int overhead = peak - expected;
  const double overhead_ms = nam_desktop::LatencyMs(overhead, kRate);
  // Routing + block processing should add far less than the 5ms budget.
  CHECK(std::abs(overhead) < 128);
  CHECK(overhead_ms < 5.0);
  std::printf("  delay 100ms: measured %d frames (%.2f ms), overhead %d frames (%.3f ms)\n",
              peak, nam_desktop::LatencyMs(peak, kRate), overhead, overhead_ms);
}

// Report the real device round-trip latency when a duplex device is available.
void TestDeviceLatency() {
  nam_desktop::AudioIO io;
  if (io.ListDevices().empty()) {
    std::printf("  device latency: skipped (no audio devices on this host)\n");
    return;
  }
  if (!io.Open(0xFFFFFFFFu, 0xFFFFFFFFu, 48000.0, 128)) {
    std::printf("  device latency: skipped (stream open failed: %s)\n", io.LastError().c_str());
    return;
  }
  if (!io.Start()) {
    std::printf("  device latency: skipped (start failed: %s)\n", io.LastError().c_str());
    io.Close();
    return;
  }

  const long frames = io.StreamLatencyFrames();
  const double one_way_ms = nam_desktop::LatencyMs(static_cast<int>(std::max(0L, frames)), 48000.0);
  const double round_trip_ms = 2.0 * one_way_ms;
  const double buffer_ms = 128.0 / 48000.0 * 1000.0;  // one-way buffer-derived
  std::printf(
      "  device latency: reported %ld frames (%.2f ms one-way, %.2f ms round-trip); "
      "buffer-derived one-way %.2f ms; DSP added 0 ms\n",
      frames, one_way_ms, round_trip_ms, buffer_ms);
  std::printf("  => vs <5ms target: %s (buffer-derived one-way needs a 128-frame buffer or less)\n",
              round_trip_ms < 5.0 ? "meets target" : "above target (host/buffer dependent)");

  io.Stop();
  io.Close();
}

}  // namespace

int main() {
  TestDspPassthroughLatency();
  TestDelayLatency();
  TestDeviceLatency();

  if (g_failures > 0) {
    std::fprintf(stderr, "%d failure(s)\n", g_failures);
    return 1;
  }
  std::printf("latency_test: all checks passed\n");
  return 0;
}