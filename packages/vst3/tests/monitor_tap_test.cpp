// Monitor tap: the audio thread writes, the UI thread reads (issue #300 E4c).
//
// The plugin's getTap returned empty arrays, so the meters, scope and tuner all
// read flat inside a DAW. The ring is guarded by a seqlock rather than a mutex
// because the audio thread must never block on anything a non-real-time thread
// could hold (issue #43), which makes the concurrency the interesting part to
// test — case 6 below hammers both sides at once and asserts the reader always
// terminates and always returns a self-consistent window.

#include "openaxe/monitor_tap.h"
#include <atomic>
#include <cmath>
#include <cstdio>
#include <thread>
#include <vector>
int fails = 0;
#define CHECK(c) do { if(!(c)) { std::fprintf(stderr, "FAIL: %s (line %d)\n", #c, __LINE__); ++fails; } } while(0)

int main() {
  // 1. Basic ordering: the window is oldest-to-newest and holds the tail.
  {
    openaxe::MonitorTap t;
    std::vector<float> l(100), r(100);
    for (int i = 0; i < 100; ++i) { l[i] = float(i); r[i] = float(-i); }
    const float* in[2] = {l.data(), r.data()};
    const float* out[2] = {l.data(), r.data()};
    t.Write(in, out, 100);
    auto f = t.Read(false, 10);
    CHECK(f.frames == 10);
    // Most recent 10 of 0..99 is 90..99, oldest first.
    for (int i = 0; i < 10; ++i) CHECK(f.l[i] == float(90 + i));
    CHECK(f.r[0] == -90.0f);
  }
  // 2. Fewer frames written than asked for.
  {
    openaxe::MonitorTap t;
    std::vector<float> v(5, 7.0f);
    const float* p[2] = {v.data(), v.data()};
    t.Write(p, p, 5);
    auto f = t.Read(true, 4096);
    CHECK(f.frames == 5);
  }
  // 3. More frames than capacity in one call: keep the tail, do not corrupt.
  {
    openaxe::MonitorTap t;
    const unsigned n = openaxe::MonitorTap::kCapacity * 2 + 123;
    std::vector<float> v(n);
    for (unsigned i = 0; i < n; ++i) v[i] = float(i);
    const float* p[2] = {v.data(), v.data()};
    t.Write(p, p, n);
    auto f = t.Read(false, openaxe::MonitorTap::kCapacity);
    CHECK(f.frames == openaxe::MonitorTap::kCapacity);
    CHECK(f.l.back() == float(n - 1));
  }
  // 4. Clear drops the window.
  {
    openaxe::MonitorTap t;
    std::vector<float> v(64, 1.0f);
    const float* p[2] = {v.data(), v.data()};
    t.Write(p, p, 64);
    CHECK(t.Read(false, 64).frames == 64);
    t.Clear();
    CHECK(t.Read(false, 64).frames == 0);
  }
  // 5. Mono bus: a null right channel must not crash.
  {
    openaxe::MonitorTap t;
    std::vector<float> v(32, 0.5f);
    const float* p[2] = {v.data(), nullptr};
    t.Write(p, p, 32);
    CHECK(t.Read(false, 32).frames == 32);
  }
  // 6. The point of the seqlock: hammer it from two threads. The reader must
  //    always terminate and always return a self-consistent length; the writer
  //    must never be blocked by it.
  {
    openaxe::MonitorTap t;
    std::atomic<bool> stop{false};
    std::atomic<long> writes{0}, reads{0};
    std::thread w([&] {
      std::vector<float> v(256);
      const float* p[2] = {v.data(), v.data()};
      while (!stop.load()) {
        static float phase = 0;
        for (auto& s : v) { s = std::sin(phase); phase += 0.01f; }
        t.Write(p, p, 256);
        writes.fetch_add(1);
      }
    });
    std::thread rd([&] {
      while (!stop.load()) {
        auto f = t.Read(false, 2048);
        if (f.l.size() != f.frames || f.r.size() != f.frames) { ++fails; }
        reads.fetch_add(1);
      }
    });
    std::this_thread::sleep_for(std::chrono::milliseconds(700));
    stop.store(true);
    w.join(); rd.join();
    std::printf("  contention: %ld writes, %ld reads\n", writes.load(), reads.load());
    CHECK(writes.load() > 100);
    CHECK(reads.load() > 100);
  }
  if (!fails) std::printf("monitor_tap: all checks passed\n");
  return fails ? 1 : 0;
}
