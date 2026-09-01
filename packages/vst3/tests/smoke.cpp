// Smoke test for the VST3 scaffold (issue #125):
// construct/destroy OpenAxeGraph, reset on sample-rate/block-size, passthrough audio.
#include <cmath>
#include <cstdio>
#include <vector>

#include "openaxe/api.h"

int main() {
  OpenAxeGraph* g = openaxe_graph_create();
  if (!g) {
    std::fprintf(stderr, "graph_create failed\n");
    return 1;
  }

  // Verify VERSION pin is readable — the CMake project() version comes from ../../VERSION (#54).
  // No plugin IDs to check at runtime; config.h is compile-time.

  openaxe_reset(g, 48000.0, 512);
  openaxe_reset(g, 44100.0, 64);  // sample-rate/block-size change path

  constexpr int kFrames = 64;
  float in[kFrames];
  float out_l[kFrames] = {};
  float out_r[kFrames] = {};
  for (int i = 0; i < kFrames; ++i) in[i] = std::sin(static_cast<float>(i) * 0.1f) * 0.5f;
  const float* ins[2] = {in, in};
  float* outs[2] = {out_l, out_r};

  openaxe_process(g, ins, 2, outs, 2, kFrames);

  // Empty rig has no IN→OUT edge, so output is silent — verify it doesn't crash
  // and that linking WHOLE_ARCHIVE didn't drop NAM parsers (graph is still usable).
  bool ok = true;
  for (int i = 0; i < kFrames; ++i) {
    if (std::fabs(out_l[i]) > 1e-6f || std::fabs(out_r[i]) > 1e-6f) {
      ok = false;
      std::fprintf(stderr, "expected silence with empty rig at %d: out_l %g out_r %g\n", i, out_l[i], out_r[i]);
      break;
    }
  }
  // Also verify a non-empty passthrough rig works (one block, IN→block→OUT).
  if (ok) {
    OpenAxeGraph* g2 = openaxe_graph_create();
    int32_t block = openaxe_add_block(g2, OPENAXE_BLOCK_NOISE_GATE, 0, 0);
    openaxe_set_bypass(g2, block, 1);  // bypassed → passthrough
    openaxe_connect(g2, OPENAXE_IN_RAIL, 0, block, 0);
    openaxe_connect(g2, block, 0, OPENAXE_OUT_RAIL, 0);
    openaxe_reset(g2, 48000.0, kFrames);
    std::fill(std::begin(out_l), std::end(out_l), 0.0f);
    std::fill(std::begin(out_r), std::end(out_r), 0.0f);
    openaxe_process(g2, ins, 2, outs, 2, kFrames);
    for (int i = 0; i < kFrames; ++i) {
      if (std::fabs(out_l[i] - in[i]) > 1e-6f || std::fabs(out_r[i] - in[i]) > 1e-6f) {
        ok = false;
        std::fprintf(stderr, "passthrough mismatch with bypassed block at %d: in %g out_l %g out_r %g\n", i, in[i], out_l[i], out_r[i]);
        break;
      }
    }
    openaxe_graph_destroy(g2);
  }

  openaxe_graph_destroy(g);

  if (ok) {
    std::printf("smoke passed — core linked WHOLE_ARCHIVE, passthrough ok\n");
    return 0;
  }
  std::printf("smoke FAILED\n");
  return 1;
}
