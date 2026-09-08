// Gapless staged switching (issue #367), driven through the C ABI: commit
// mechanics, output continuity across the switch, session-state carryover,
// validation/busy paths, drain timing, staged discard, and a two-thread
// process-vs-control stress (also run under ThreadSanitizer).
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

#include "openaxe/api.h"

#include "test_harness.h"

namespace {

constexpr double kSampleRate = 48000.0;
constexpr int kBlockSize = 128;
constexpr int kMaxBlock = 512;

// Phase-continuous sine stimulus.
struct Sine {
  double phase = 0.0;
  void fill(float* out, int n, double freq = 440.0, float amp = 0.5f) {
    for (int i = 0; i < n; ++i) {
      out[i] = amp * static_cast<float>(std::sin(phase));
      phase += 2.0 * 3.141592653589793 * freq / kSampleRate;
    }
  }
};

struct StereoBuffers {
  std::vector<float> in_l, in_r, out_l, out_r;
  StereoBuffers() : in_l(kMaxBlock), in_r(kMaxBlock), out_l(kMaxBlock), out_r(kMaxBlock) {}

  void process(OpenAxeGraph* graph, Sine& sine, int n = kBlockSize) {
    sine.fill(in_l.data(), n);
    std::copy(in_l.begin(), in_l.begin() + n, in_r.begin());
    const float* ins[2] = {in_l.data(), in_r.data()};
    float* outs[2] = {out_l.data(), out_r.data()};
    openaxe_process(graph, ins, 2, outs, 2, n);
  }
};

std::string Serialize(OpenAxeGraph* graph) {
  const int32_t needed = openaxe_serialize_state(graph, nullptr, 0);
  std::string doc(static_cast<size_t>(needed), '\0');
  openaxe_serialize_state(graph, doc.data(), needed);
  return doc;
}

// IN -> block -> OUT wiring used by every test rig here.
int32_t AddWiredBlock(OpenAxeGraph* graph, OpenAxeBlockKind kind) {
  const int32_t id = openaxe_add_block(graph, kind, 0, 0);
  if (id < 0) return id;
  openaxe_connect(graph, OPENAXE_IN_RAIL, 0, id, 0);
  openaxe_connect(graph, id, 0, OPENAXE_OUT_RAIL, 0);
  return id;
}

void RunUntilIdle(OpenAxeGraph* graph, Sine& sine, StereoBuffers& bufs, int max_buffers = 4096) {
  // Process first, then check: active_ only goes true at commit pickup
  // (inside the first process call), so a check-first loop would exit
  // immediately with the switch never picked up.
  for (int i = 0; i < max_buffers; ++i) {
    bufs.process(graph, sine);
    if (!openaxe_switch_active(graph)) break;
  }
}

bool Finite(float v) { return std::isfinite(v); }

}  // namespace

// Basic commit: staged rig takes over, observable through the serialized
// document (block kinds), with no NaN/Inf anywhere.
static void TestBasicCommit() {
  OpenAxeGraph* parent = openaxe_graph_create();
  OPENAXE_EXPECT(parent != nullptr);
  AddWiredBlock(parent, OPENAXE_BLOCK_EQ);
  openaxe_reset(parent, kSampleRate, kMaxBlock);

  OpenAxeGraph* staged = openaxe_staged_graph_create(parent);
  OPENAXE_EXPECT(staged != nullptr);
  AddWiredBlock(staged, OPENAXE_BLOCK_DELAY);
  openaxe_reset(staged, kSampleRate, kMaxBlock);

  OPENAXE_EXPECT(openaxe_switch_active(parent) == 0);
  OPENAXE_EXPECT(openaxe_staged_graph_commit(parent, staged, 25, 200) == 1);

  Sine sine;
  StereoBuffers bufs;
  for (int i = 0; i < 200; ++i) {
    bufs.process(parent, sine);
    for (int s = 0; s < kBlockSize; ++s) {
      OPENAXE_EXPECT(Finite(bufs.out_l[s]));
      OPENAXE_EXPECT(Finite(bufs.out_r[s]));
    }
  }
  OPENAXE_EXPECT(openaxe_switch_active(parent) == 0);

  const std::string doc = Serialize(parent);
  OPENAXE_EXPECT(doc.find("\"kind\": \"delay\"") != std::string::npos);
  OPENAXE_EXPECT(doc.find("\"kind\": \"eq\"") == std::string::npos);

  openaxe_graph_destroy(parent);
}

// Continuity: a sine switched mid-stream must not gap, click, or drop out.
// Bounds: max sample step across the boundary and post-switch RMS vs
// pre-switch RMS (a silence gap would collapse it).
static void TestContinuity() {
  OpenAxeGraph* parent = openaxe_graph_create();
  AddWiredBlock(parent, OPENAXE_BLOCK_EQ);
  openaxe_reset(parent, kSampleRate, kMaxBlock);

  OpenAxeGraph* staged = openaxe_staged_graph_create(parent);
  AddWiredBlock(staged, OPENAXE_BLOCK_DELAY);
  openaxe_reset(staged, kSampleRate, kMaxBlock);

  Sine sine;
  StereoBuffers bufs;
  std::vector<float> captured;
  captured.reserve(256 * kBlockSize);
  for (int i = 0; i < 20; ++i) {  // settle smoothing ramps
    bufs.process(parent, sine);
  }
  OPENAXE_EXPECT(openaxe_staged_graph_commit(parent, staged, 25, 500) == 1);
  for (int i = 0; i < 236; ++i) {
    bufs.process(parent, sine);
    captured.insert(captured.end(), bufs.out_l.begin(), bufs.out_l.begin() + kBlockSize);
  }
  RunUntilIdle(parent, sine, bufs);

  float max_step = 0.0f;
  double sum_pre = 0.0, sum_post = 0.0;
  const size_t boundary = 20 * kBlockSize;
  for (size_t i = 1; i < captured.size(); ++i) {
    OPENAXE_EXPECT(Finite(captured[i]));
    max_step = std::max(max_step, std::fabs(captured[i] - captured[i - 1]));
    const double sq = captured[i] * captured[i];
    if (i < boundary) {
      sum_pre += sq;
    } else {
      sum_post += sq;
    }
  }
  // 440 Hz sine at 0.5 amplitude steps ~0.03/sample; the equal-power crossfade
  // of two such signals stays far below 0.2 anywhere, while a hard cut or a
  // zeroed buffer would spike to ~1.0.
  OPENAXE_EXPECT(max_step < 0.2f);
  const double rms_pre = std::sqrt(sum_pre / boundary);
  const double rms_post = std::sqrt(sum_post / (captured.size() - boundary));
  OPENAXE_EXPECT(rms_pre > 0.1);
  OPENAXE_EXPECT(rms_post > 0.5 * rms_pre);  // no silence gap

  openaxe_graph_destroy(parent);
}

// Session state (master bus, tuner mute, automation lanes, MIDI) carries to
// the staged rig; block-level state does not.
static void TestSessionCarryover() {
  OpenAxeGraph* parent = openaxe_graph_create();
  const int32_t eq = AddWiredBlock(parent, OPENAXE_BLOCK_EQ);
  openaxe_reset(parent, kSampleRate, kMaxBlock);

  openaxe_set_master_level(parent, 0.5f);
  openaxe_set_tuner_muted(parent, 1);
  OPENAXE_EXPECT(openaxe_bind_automation_slot(parent, 1, eq) == 1);
  openaxe_set_automation_param_normalized(parent, 1, 0, 0.5f);
  OPENAXE_EXPECT(openaxe_midi_add_mapping(parent, OPENAXE_MIDI_CC, 0, 74,
                                          OPENAXE_MIDI_ACTION_SLOT, 3, 0) == 1);
  OPENAXE_EXPECT(openaxe_midi_arm_learn(parent, OPENAXE_MIDI_ACTION_NEXT_SCENE, 0, 0) == 1);

  OpenAxeGraph* staged = openaxe_staged_graph_create(parent);
  // Same kind at the same id: the binding must survive the switch.
  const int32_t staged_eq = AddWiredBlock(staged, OPENAXE_BLOCK_EQ);
  OPENAXE_EXPECT(staged_eq == eq);
  // A different slot target kind would unbind - covered implicitly below.
  openaxe_reset(staged, kSampleRate, kMaxBlock);

  OPENAXE_EXPECT(openaxe_staged_graph_commit(parent, staged, 10, 50) == 1);
  Sine sine;
  StereoBuffers bufs;
  RunUntilIdle(parent, sine, bufs);

  OPENAXE_EXPECT(std::fabs(openaxe_get_master_level(parent) - 0.5f) < 1e-6f);
  OPENAXE_EXPECT(openaxe_is_tuner_muted(parent) == 1);
  OPENAXE_EXPECT(openaxe_automation_slot_block(parent, 1) == eq);
  OPENAXE_EXPECT(std::fabs(openaxe_get_automation_param_normalized(parent, 1, 0) - 0.5f) < 0.05f);
  OPENAXE_EXPECT(openaxe_midi_mapping_count(parent) == 1);
  OPENAXE_EXPECT(openaxe_midi_is_learning(parent) == 1);

  // Master level audibly applies on the new rig: measure energy at the
  // carried 0.5 level, then at 1.0 - the ratio must be ~4x regardless of the
  // EQ block's own curve (robust to whatever the default EQ sounds like).
  openaxe_set_tuner_muted(parent, 0);
  auto measure = [&](int buffers) {
    double energy = 0.0;
    for (int i = 0; i < buffers; ++i) {
      bufs.process(parent, sine);
      for (int s = 0; s < kBlockSize; ++s) energy += bufs.out_l[s] * bufs.out_l[s];
    }
    return energy;
  };
  const double e_half = measure(40);
  OPENAXE_EXPECT(e_half > 1e-6);
  openaxe_set_master_level(parent, 1.0f);
  const double e_full = measure(40);
  OPENAXE_EXPECT(e_full / e_half > 3.0 && e_full / e_half < 5.0);

  openaxe_graph_destroy(parent);
}

// A binding to a block whose kind changed (or is missing) unbinds but keeps
// the lane memory, mirroring Unbind semantics.
static void TestBindingMismatchUnbinds() {
  OpenAxeGraph* parent = openaxe_graph_create();
  const int32_t eq = AddWiredBlock(parent, OPENAXE_BLOCK_EQ);
  openaxe_reset(parent, kSampleRate, kMaxBlock);
  OPENAXE_EXPECT(openaxe_bind_automation_slot(parent, 2, eq) == 1);
  openaxe_set_automation_param_normalized(parent, 2, 0, 0.75f);

  OpenAxeGraph* staged = openaxe_staged_graph_create(parent);
  AddWiredBlock(staged, OPENAXE_BLOCK_DELAY);  // same id 0, different kind
  openaxe_reset(staged, kSampleRate, kMaxBlock);

  OPENAXE_EXPECT(openaxe_staged_graph_commit(parent, staged, 5, 20) == 1);
  Sine sine;
  StereoBuffers bufs;
  RunUntilIdle(parent, sine, bufs);

  OPENAXE_EXPECT(openaxe_automation_slot_block(parent, 2) == -1);
  OPENAXE_EXPECT(std::fabs(openaxe_get_automation_param_normalized(parent, 2, 0) - 0.75f) < 1e-6f);

  openaxe_graph_destroy(parent);
}

// Validation paths: null/foreign/unreset/mismatched commits reject (0) and
// leave the staged handle committable; a second commit while one is in
// flight is busy (-1).
static void TestValidationAndBusy() {
  OpenAxeGraph* parent = openaxe_graph_create();
  AddWiredBlock(parent, OPENAXE_BLOCK_EQ);
  openaxe_reset(parent, kSampleRate, kMaxBlock);
  OpenAxeGraph* other = openaxe_graph_create();
  openaxe_reset(other, kSampleRate, kMaxBlock);

  OPENAXE_EXPECT(openaxe_staged_graph_create(nullptr) == nullptr);
  OPENAXE_EXPECT(openaxe_staged_graph_commit(nullptr, nullptr, 25, 100) == 0);
  OPENAXE_EXPECT(openaxe_staged_graph_commit(parent, nullptr, 25, 100) == 0);
  OPENAXE_EXPECT(openaxe_staged_graph_commit(parent, parent, 25, 100) == 0);  // not a staged handle
  OPENAXE_EXPECT(openaxe_staged_graph_commit(parent, other, 25, 100) == 0);   // foreign handle

  OpenAxeGraph* foreign_staged = openaxe_staged_graph_create(other);
  OPENAXE_EXPECT(openaxe_staged_graph_commit(parent, foreign_staged, 25, 100) == 0);  // staged for `other`
  openaxe_graph_destroy(foreign_staged);

  OpenAxeGraph* unreset = openaxe_staged_graph_create(parent);
  AddWiredBlock(unreset, OPENAXE_BLOCK_DELAY);
  OPENAXE_EXPECT(openaxe_staged_graph_commit(parent, unreset, 25, 100) == 0);  // never reset
  openaxe_reset(unreset, kSampleRate, kMaxBlock);
  OPENAXE_EXPECT(openaxe_staged_graph_commit(parent, unreset, 25, 100) == 1);  // now fine

  OpenAxeGraph* wrong_rate = openaxe_staged_graph_create(parent);
  AddWiredBlock(wrong_rate, OPENAXE_BLOCK_DELAY);
  openaxe_reset(wrong_rate, 44100.0, kMaxBlock);
  OPENAXE_EXPECT(openaxe_staged_graph_commit(parent, wrong_rate, 25, 100) == 0);
  openaxe_graph_destroy(wrong_rate);

  OpenAxeGraph* wrong_size = openaxe_staged_graph_create(parent);
  AddWiredBlock(wrong_size, OPENAXE_BLOCK_DELAY);
  openaxe_reset(wrong_size, kSampleRate, 256);
  OPENAXE_EXPECT(openaxe_staged_graph_commit(parent, wrong_size, 25, 100) == 0);
  openaxe_graph_destroy(wrong_size);

  // Busy: the commit above is published but no buffer has run yet (no
  // process call since), so a second commit must report busy.
  OpenAxeGraph* second = openaxe_staged_graph_create(parent);
  AddWiredBlock(second, OPENAXE_BLOCK_DELAY);
  openaxe_reset(second, kSampleRate, kMaxBlock);
  OPENAXE_EXPECT(openaxe_staged_graph_commit(parent, second, 25, 100) == -1);
  Sine sine;
  StereoBuffers bufs;
  RunUntilIdle(parent, sine, bufs);
  OPENAXE_EXPECT(openaxe_staged_graph_commit(parent, second, 25, 100) == 1);
  RunUntilIdle(parent, sine, bufs);

  openaxe_graph_destroy(other);
  openaxe_graph_destroy(parent);
}

// Drain timing: active spans fade + drain in buffer counts.
static void TestDrainTiming() {
  OpenAxeGraph* parent = openaxe_graph_create();
  AddWiredBlock(parent, OPENAXE_BLOCK_EQ);
  openaxe_reset(parent, kSampleRate, kMaxBlock);
  OpenAxeGraph* staged = openaxe_staged_graph_create(parent);
  AddWiredBlock(staged, OPENAXE_BLOCK_DELAY);
  openaxe_reset(staged, kSampleRate, kMaxBlock);

  // fade 10 ms (480 samples) + drain 200 ms (9600 samples) at 128/buffer:
  // fade retires after 4 buffers, drain after 75 more -> 79 total.
  OPENAXE_EXPECT(openaxe_staged_graph_commit(parent, staged, 10, 200) == 1);
  Sine sine;
  StereoBuffers bufs;
  int active_buffers = 0;
  for (int i = 0; i < 200; ++i) {
    bufs.process(parent, sine);
    if (openaxe_switch_active(parent)) {
      active_buffers = i + 1;
    } else {
      break;
    }
  }
  OPENAXE_EXPECT(active_buffers >= 77 && active_buffers <= 81);
  OPENAXE_EXPECT(openaxe_switch_active(parent) == 0);

  openaxe_graph_destroy(parent);
}

// Abandoning a staged handle leaves the parent untouched.
static void TestStagedDiscard() {
  OpenAxeGraph* parent = openaxe_graph_create();
  AddWiredBlock(parent, OPENAXE_BLOCK_EQ);
  openaxe_reset(parent, kSampleRate, kMaxBlock);
  const std::string before = Serialize(parent);

  OpenAxeGraph* staged = openaxe_staged_graph_create(parent);
  AddWiredBlock(staged, OPENAXE_BLOCK_DELAY);
  openaxe_reset(staged, kSampleRate, kMaxBlock);
  openaxe_graph_destroy(staged);

  OPENAXE_EXPECT(Serialize(parent) == before);
  OPENAXE_EXPECT(openaxe_switch_active(parent) == 0);

  // And a fresh stage still commits afterwards (freelist reuse path).
  OpenAxeGraph* staged2 = openaxe_staged_graph_create(parent);
  AddWiredBlock(staged2, OPENAXE_BLOCK_DELAY);
  openaxe_reset(staged2, kSampleRate, kMaxBlock);
  OPENAXE_EXPECT(openaxe_staged_graph_commit(parent, staged2, 5, 20) == 1);
  Sine sine;
  StereoBuffers bufs;
  RunUntilIdle(parent, sine, bufs);
  OPENAXE_EXPECT(Serialize(parent).find("\"kind\": \"delay\"") != std::string::npos);

  openaxe_graph_destroy(parent);
}

// Two threads: audio (process) vs control (Tier-1 writes + one commit).
// Mirrors api_threading_test's pattern; run this binary under TSan too.
static void TestConcurrentProcessAndControl() {
  OpenAxeGraph* parent = openaxe_graph_create();
  AddWiredBlock(parent, OPENAXE_BLOCK_EQ);
  openaxe_reset(parent, kSampleRate, kMaxBlock);

  std::atomic<bool> stop{false};
  std::atomic<int> buffers{0};
  std::vector<float> tail(4 * kBlockSize, 0.0f);
  std::thread audio([&] {
    Sine sine;
    StereoBuffers bufs;
    while (!stop.load(std::memory_order_relaxed)) {
      bufs.process(parent, sine);
      ++buffers;
      if (buffers.load(std::memory_order_relaxed) > 120) {
        std::copy(bufs.out_l.begin(), bufs.out_l.begin() + kBlockSize, tail.begin());
        std::copy(bufs.out_l.begin(), bufs.out_l.begin() + kBlockSize,
                  tail.begin() + kBlockSize);
      }
    }
  });

  // Control thread: Tier-1 traffic, then a commit mid-stream.
  for (int i = 0; i < 50; ++i) {
    openaxe_set_param(parent, 0, 0, 0.5f);
    (void)openaxe_get_param(parent, 0, 0);
    (void)openaxe_get_meter(parent, 0);
    (void)openaxe_switch_active(parent);
    std::this_thread::yield();
  }
  OpenAxeGraph* staged = openaxe_staged_graph_create(parent);
  AddWiredBlock(staged, OPENAXE_BLOCK_DELAY);
  openaxe_reset(staged, kSampleRate, kMaxBlock);
  int32_t commit_result = openaxe_staged_graph_commit(parent, staged, 25, 100);
  if (commit_result == -1) {
    // Extremely unlikely (no switch in flight), but a retry is the
    // documented caller protocol.
    commit_result = openaxe_staged_graph_commit(parent, staged, 25, 100);
  }
  OPENAXE_EXPECT(commit_result == 1);
  // Let the audio thread run the switch to completion: 500 buffers far
  // exceeds the 25 ms fade + 100 ms drain. Tier-1 traffic continues
  // throughout (master writes must land on the new rig once picked up).
  while (buffers.load(std::memory_order_relaxed) < 500) {
    openaxe_set_master_level(parent, 1.0f);
    std::this_thread::yield();
  }
  stop.store(true, std::memory_order_relaxed);
  audio.join();

  OPENAXE_EXPECT(buffers.load() > 150);
  for (float v : tail) OPENAXE_EXPECT(Finite(v));

  openaxe_graph_destroy(parent);
}

int main() {
  TestBasicCommit();
  TestContinuity();
  TestSessionCarryover();
  TestBindingMismatchUnbinds();
  TestValidationAndBusy();
  TestDrainTiming();
  TestStagedDiscard();
  TestConcurrentProcessAndControl();

  if (openaxe::test::g_failures == 0) std::printf("rig_switch_test: all passed\n");
  return openaxe::test::g_failures == 0 ? 0 : 1;
}
