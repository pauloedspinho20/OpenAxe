// CTest for real-time safety of the audio thread (issue #130).
// Mirrors #43/#53: the process callback must not allocate, lock or syscall.
// Two layers:
//  1) When built with -fsanitize=realtime (RealtimeSanitizer, Clang 18+),
//     the sanitizer itself traps any non-RT-safe call. This test just drives
//     the callback hot so violations surface.
//  2) Fallback allocator hook: override global operator new/delete and count
//     any heap allocation while g_check_rt is set. C DSP that mallocs would
//     escape this hook, but the core's hot path is C++ (NAM/permissive-reverb/DSPark)
//     and the plugin's own ProcessBlock never mallocs — so a new-count of
//     zero is the right invariant. A TSan build separately catches races.

#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

#include "openaxe/api.h"
#include "../config.h"

static int g_failures = 0;
#define CHECK(cond) do { if(!(cond)){ std::fprintf(stderr,"CHECK failed: %s (%s:%d)\n",#cond,__FILE__,__LINE__); ++g_failures; } } while(0)

// ── Minimal allocator hook (C++ new/delete only) ──────────────────────────
// When g_check_rt is true, any C++ heap allocation increments g_alloc_count
// and the test fails. This is intentionally not a full malloc interposer —
// the core's RT path doesn't malloc after the initial reset's pre-allocation,
// and a full interposer (LD_PRELOAD / __wrap_malloc) would require linker
// flags that complicate the offline ctest harness. RealtimeSanitizer is the
// stronger, syscall+lock-aware check; this hook is the always-on baseline.
// We keep the hook trivial and avoid recursion by using malloc/free directly
// inside the replacement operators (they are not themselves counted).

static std::atomic<bool> g_check_rt{false};
static std::atomic<int> g_alloc_count{0};
static std::atomic<int> g_free_count{0};

void* operator new(std::size_t n) {
  if (g_check_rt.load(std::memory_order_relaxed)) g_alloc_count.fetch_add(1, std::memory_order_relaxed);
  if (void* p = std::malloc(n)) return p;
  throw std::bad_alloc{};
}
void operator delete(void* p) noexcept {
  // Don't count frees — only allocs are RT-unsafe; frees during process would
  // also be a bug but are rarer and this keeps the assertion minimal.
  (void)g_free_count.fetch_add(1, std::memory_order_relaxed);
  std::free(p);
}
void* operator new[](std::size_t n) {
  if (g_check_rt.load(std::memory_order_relaxed)) g_alloc_count.fetch_add(1, std::memory_order_relaxed);
  if (void* p = std::malloc(n)) return p;
  throw std::bad_alloc{};
}
void operator delete[](void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }
void operator delete[](void* p, std::size_t) noexcept { std::free(p); }

// Optional: if the toolchain supports RealtimeSanitizer, enable its scope.
// __has_feature(realtime) is Clang-specific; GCC has no RTSan.
#if defined(__has_feature)
#if __has_feature(realtime_sanitizer)
#include <sanitizer/realtime_sanitizer.h>
#define OPENAXE_HAS_RTSAN 1
#endif
#endif

namespace {

void RunProcessHotLoop(OpenAxeGraph* g, int frames, int iterations, const char* label) {
  std::vector<float> in0(frames, 0.2f), in1(frames, 0.2f);
  std::vector<float> out0(frames, 0.0f), out1(frames, 0.0f);
  for (int i = 0; i < frames; ++i) { in0[i] = std::sin(float(i) * 0.07f) * 0.3f; in1[i] = in0[i]; }
  const float* in[2] = {in0.data(), in1.data()};
  float* out[2] = {out0.data(), out1.data()};

  // Warmup: one call outside the checked region so any lazy first-process
  // allocation happens before we start counting (mirrors host warmup).
  openaxe_process(g, in, 2, out, 2, frames);
  for (int i = 0; i < frames; ++i) CHECK(std::isfinite(out0[i]) && std::isfinite(out1[i]));

  g_alloc_count.store(0, std::memory_order_relaxed);
  g_free_count.store(0, std::memory_order_relaxed);
  g_check_rt.store(true, std::memory_order_release);

#ifdef OPENAXE_HAS_RTSAN
  __rtsan_realtime_enter();
#endif

  for (int iter = 0; iter < iterations; ++iter) {
    // Vary input slightly so the compiler can't elide the call.
    in0[0] = float(iter) * 1e-4f;
    openaxe_process(g, in, 2, out, 2, frames);
  }

#ifdef OPENAXE_HAS_RTSAN
  __rtsan_realtime_exit();
#endif

  g_check_rt.store(false, std::memory_order_release);

  const int allocs = g_alloc_count.load(std::memory_order_relaxed);
  CHECK(allocs == 0);
  if (allocs == 0) std::printf("  %s: %d iterations @ %d frames — 0 allocs (RT-safe)\n", label, iterations, frames);
  else std::fprintf(stderr, "  %s: FAILED — %d C++ allocations during process\n", label, allocs);

  // Output must remain finite (denormal/NaN guard from #126 still applies).
  for (int i = 0; i < frames; ++i) {
    CHECK(std::isfinite(out0[i]) && std::isfinite(out1[i]));
    CHECK(std::fabs(out0[i]) < 1e6f && std::fabs(out1[i]) < 1e6f);
  }
}

} // namespace

int main() {
  std::printf("realtime_safety: checking openaxe_process does not allocate/lock\n");
#ifdef OPENAXE_HAS_RTSAN
  std::printf("  RealtimeSanitizer active — will trap non-RT-safe calls\n");
#else
  std::printf("  RealtimeSanitizer not enabled — using C++ new hook (build with -fsanitize=realtime for syscall/lock coverage)\n");
#endif

  // 1) Passthrough (mixer) — baseline, no DSP state.
  {
    OpenAxeGraph* g = openaxe_graph_create();
    int32_t mixer = openaxe_add_block(g, OPENAXE_BLOCK_MIXER, 0, 0);
    openaxe_connect(g, OPENAXE_IN_RAIL, 0, mixer, 0);
    openaxe_connect(g, mixer, 0, OPENAXE_OUT_RAIL, 0);
    openaxe_reset(g, 48000.0, 128);
    RunProcessHotLoop(g, 128, 512, "passthrough");
    openaxe_graph_destroy(g);
  }

  // 2) With reverb (tail = denormal territory) — the plugin's FTZ/DAZ guard
  // must already be on, but the DSP itself must not allocate for tail buffers.
  {
    OpenAxeGraph* g = openaxe_graph_create();
    int32_t mixer = openaxe_add_block(g, OPENAXE_BLOCK_MIXER, 0, 0);
    int32_t rev = openaxe_add_block(g, OPENAXE_BLOCK_REVERB, 0, 1);
    openaxe_connect(g, OPENAXE_IN_RAIL, 0, mixer, 0);
    openaxe_connect(g, mixer, 0, rev, 0);
    openaxe_connect(g, rev, 0, OPENAXE_OUT_RAIL, 0);
    openaxe_reset(g, 48000.0, 256);
    RunProcessHotLoop(g, 256, 256, "reverb tail");
    openaxe_graph_destroy(g);
  }

  // 3) Multiple block sizes (chunking contract from #126) — plugin chunks
  // rather than re-resetting on the audio thread, so each size must be RT-safe.
  for (int bs : {64, 128, 512, 1024}) {
    OpenAxeGraph* g = openaxe_graph_create();
    int32_t gate = openaxe_add_block(g, OPENAXE_BLOCK_NOISE_GATE, 0, 0);
    openaxe_connect(g, OPENAXE_IN_RAIL, 0, gate, 0);
    openaxe_connect(g, gate, 0, OPENAXE_OUT_RAIL, 0);
    openaxe_reset(g, 48000.0, bs);
    char label[64]; std::snprintf(label, sizeof(label), "block-size %d", bs);
    RunProcessHotLoop(g, bs, 128, label);
    openaxe_graph_destroy(g);
  }

  CHECK(PLUG_LATENCY == 0);

  if (g_failures > 0) {
    std::fprintf(stderr, "%d failure(s) — process callback is not RT-safe\n", g_failures);
    return 1;
  }
  std::printf("realtime_safety: all checks passed\n");
  return 0;
}
