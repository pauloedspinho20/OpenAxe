// Real end-to-end test of the extern "C" real-time ABI (issue #14): builds
// an IN -> Amp -> Reverb -> OUT rig, loads an actual .nam model bundled with
// the NeuralAmpModelerCore submodule, and processes real audio through it,
// through the full extern "C" surface, not just the C++ class directly or
// the engine layer (see engine_test.cpp). Only built if
// OPENAXE_HAS_NAM_CORE && OPENAXE_HAS_DRAGONFLY (see
// tests/CMakeLists.txt) - same WHOLE_ARCHIVE link requirement as
// nam_amp_test (NAMCore's architecture parsers self-register via static
// initializers with no other symbol referenced, so a plain static-archive
// link silently drops those object files otherwise).
#include "openaxe/api.h"

#include <algorithm>
#include <cmath>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "test_harness.h"

namespace {

constexpr double kSampleRate = 48000.0;
constexpr int32_t kBlockSize = 512;

void TestEndToEndAmpAndReverbRig() {
  NamStudioGraph* graph = nam_studio_graph_create();

  const int32_t amp = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_AMP, 0, 0);
  const int32_t reverb = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_REVERB, 0, 1);
  OPENAXE_EXPECT(nam_studio_connect(graph, NAM_STUDIO_IN_RAIL, 0, amp, 0) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(graph, amp, 0, reverb, 0) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(graph, reverb, 0, NAM_STUDIO_OUT_RAIL, 0) >= 0);

  nam_studio_reset(graph, kSampleRate, kBlockSize);

  const std::string model_path = std::string(NAM_CORE_EXAMPLE_MODELS_DIR) + "/lstm.nam";
  OPENAXE_EXPECT(nam_studio_load_nam_model(graph, amp, model_path.c_str()) == NAM_STUDIO_LOAD_OK);
  OPENAXE_EXPECT(nam_studio_block_has_model(graph, amp) == 1);

  std::vector<float> input(kBlockSize, 0.0f);
  input[0] = 1.0f;  // impulse
  std::vector<float> output(kBlockSize, 0.0f);
  const float* in_ptrs[1] = {input.data()};
  float* out_ptrs[1] = {output.data()};

  bool any_nonzero = false;
  bool all_finite = true;
  for (int i = 0; i < 8; ++i) {  // several buffers - a reverb tail outlasts one impulse block
    nam_studio_process(graph, in_ptrs, 1, out_ptrs, 1, kBlockSize);
    input[0] = 0.0f;  // impulse only on the very first buffer
    for (float sample : output) {
      if (!std::isfinite(sample)) all_finite = false;
      if (sample != 0.0f) any_nonzero = true;
    }
  }
  OPENAXE_EXPECT(all_finite);
  OPENAXE_EXPECT(any_nonzero);
  OPENAXE_EXPECT(nam_studio_get_meter(graph, amp) >= 0.0f);
  OPENAXE_EXPECT(nam_studio_get_cpu_load(graph) >= 0.0f);

  nam_studio_unload_nam_model(graph, amp);
  OPENAXE_EXPECT(nam_studio_block_has_model(graph, amp) == 0);

  nam_studio_graph_destroy(graph);
}

void TestUnwrappedKindPassesAudioThrough() {
  NamStudioGraph* graph = nam_studio_graph_create();

  const int32_t cab = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_CAB, 0, 0);
  // One param (the IR wet/dry blend); with no IR loaded the block still passes
  // audio straight through, which is what the rest of this test checks.
  OPENAXE_EXPECT(nam_studio_block_param_count(graph, cab) == 1);
  OPENAXE_EXPECT(nam_studio_block_ir_length(graph, cab) == 0);
  OPENAXE_EXPECT(nam_studio_connect(graph, NAM_STUDIO_IN_RAIL, 0, cab, 0) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(graph, cab, 0, NAM_STUDIO_OUT_RAIL, 0) >= 0);
  nam_studio_reset(graph, kSampleRate, kBlockSize);

  std::vector<float> input(kBlockSize, 0.3f);
  std::vector<float> output(kBlockSize, 0.0f);
  const float* in_ptrs[1] = {input.data()};
  float* out_ptrs[1] = {output.data()};
  nam_studio_process(graph, in_ptrs, 1, out_ptrs, 1, kBlockSize);

  for (float sample : output) OPENAXE_EXPECT(sample == 0.3f);

  nam_studio_graph_destroy(graph);
}

void TestEndToEndDsparkRig() {
  // The four DSPark-backed kinds (issue #22's last still-native effect
  // blocks) wired IN -> Compressor -> EQ -> NoiseGate -> Tremolo -> OUT
  // through the full extern "C" surface. Every block must report its DSP
  // param table and the chain must pass real audio finitely.
  NamStudioGraph* graph = nam_studio_graph_create();

  const int32_t compressor = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_COMPRESSOR, 0, 0);
  const int32_t eq = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_EQ, 0, 1);
  const int32_t gate = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_NOISE_GATE, 0, 2);
  const int32_t tremolo = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_TREMOLO, 0, 3);

  OPENAXE_EXPECT(nam_studio_block_param_count(graph, compressor) == 8);
  // eq / gate / tremolo now have an extra engine mix (hybrid dry/wet, #263)
  OPENAXE_EXPECT(nam_studio_block_param_count(graph, eq) == 13);
  OPENAXE_EXPECT(nam_studio_block_param_count(graph, gate) == 7);
  OPENAXE_EXPECT(nam_studio_block_param_count(graph, tremolo) == 4);

  const char* name = nullptr;
  OPENAXE_EXPECT(nam_studio_block_param_info(graph, compressor, 0, &name, nullptr, nullptr, nullptr,
                                          nullptr) == 1);
  OPENAXE_EXPECT(name != nullptr);

  OPENAXE_EXPECT(nam_studio_connect(graph, NAM_STUDIO_IN_RAIL, 0, compressor, 0) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(graph, compressor, 0, eq, 0) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(graph, eq, 0, gate, 0) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(graph, gate, 0, tremolo, 0) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(graph, tremolo, 0, NAM_STUDIO_OUT_RAIL, 0) >= 0);
  nam_studio_reset(graph, kSampleRate, kBlockSize);

  // Aggressive compressor: pin a loud sine down so the "is any DSP actually
  // running?" check can't pass on a silent passthrough.
  nam_studio_set_param(graph, compressor, 0 /* threshold */, -60.0f);
  nam_studio_set_param(graph, compressor, 1 /* ratio */, 20.0f);
  nam_studio_set_param(graph, compressor, 2 /* attack */, 0.1f);

  std::vector<float> input(kBlockSize);
  for (int32_t i = 0; i < kBlockSize; ++i) {
    input[static_cast<size_t>(i)] =
        1.0f * std::sin(static_cast<float>(i) / static_cast<float>(kSampleRate) * 200.0f * 6.283185307179586f);
  }
  std::vector<float> output(kBlockSize, 0.0f);
  const float* in_ptrs[1] = {input.data()};
  float* out_ptrs[1] = {output.data()};

  bool all_finite = true;
  float max_abs_out = 0.0f;
  for (int pass = 0; pass < 8; ++pass) {
    nam_studio_process(graph, in_ptrs, 1, out_ptrs, 1, kBlockSize);
    for (float sample : output) {
      if (!std::isfinite(sample)) all_finite = false;
      max_abs_out = std::max(max_abs_out, std::fabs(sample));
    }
  }
  OPENAXE_EXPECT(all_finite);
  OPENAXE_EXPECT(max_abs_out > 0.0f);
  OPENAXE_EXPECT(max_abs_out < 0.5f);

  nam_studio_graph_destroy(graph);
}

void TestReverbAlgorithmSwitchOnlyAffectsThatBlock() {
  NamStudioGraph* graph = nam_studio_graph_create();

  const int32_t reverb_a = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_REVERB, 0, 0);
  const int32_t reverb_b = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_REVERB, 1, 0);
  const int32_t hall_param_count = nam_studio_block_param_count(graph, reverb_a);
  OPENAXE_EXPECT(hall_param_count == nam_studio_block_param_count(graph, reverb_b));

  nam_studio_set_reverb_algorithm(graph, reverb_a, NAM_STUDIO_REVERB_EARLY_REFLECTIONS);
  OPENAXE_EXPECT(nam_studio_block_param_count(graph, reverb_a) != hall_param_count);
  OPENAXE_EXPECT(nam_studio_block_param_count(graph, reverb_b) == hall_param_count);  // untouched

  const char* name = nullptr;
  const char* symbol = nullptr;
  float min_value = 0.0f, max_value = 0.0f;
  const char* unit = nullptr;
  OPENAXE_EXPECT(nam_studio_block_param_info(graph, reverb_a, 0, &name, &symbol, &min_value, &max_value,
                                          &unit) == 1);
  OPENAXE_EXPECT(name != nullptr);

  nam_studio_graph_destroy(graph);
}

// The JSON load path and the model-info accessors, over the ABI a browser and a
// plugin actually call (the web app has no filesystem to hand a path to).
void TestLoadModelJsonAndModelInfoOverAbi() {
  NamStudioGraph* graph = nam_studio_graph_create();
  const int32_t amp = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_AMP, 0, 0);
  OPENAXE_EXPECT(nam_studio_connect(graph, NAM_STUDIO_IN_RAIL, 0, amp, 0) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(graph, amp, 0, NAM_STUDIO_OUT_RAIL, 0) >= 0);
  nam_studio_reset(graph, 48000.0, 512);

  // No model yet: model info reports nothing rather than stale values.
  OPENAXE_EXPECT(nam_studio_block_model_info(graph, amp, nullptr, nullptr, nullptr, nullptr, nullptr,
                                         nullptr, nullptr, nullptr, nullptr) == 0);

  std::ifstream ifs(std::string(NAM_CORE_EXAMPLE_MODELS_DIR) + "/lstm.nam", std::ios::binary);
  OPENAXE_EXPECT(ifs.good());
  const std::string json((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());

  OPENAXE_EXPECT(nam_studio_load_nam_model_json(graph, amp, json.c_str()) == NAM_STUDIO_LOAD_OK);
  OPENAXE_EXPECT(nam_studio_block_has_model(graph, amp) == 1);

  double sample_rate = 0.0;
  int32_t has_loudness = -1;
  int32_t is_slimmable = -1;
  int32_t breakpoints = -1;
  OPENAXE_EXPECT(nam_studio_block_model_info(graph, amp, &sample_rate, &has_loudness, nullptr, nullptr,
                                         nullptr, nullptr, nullptr, &is_slimmable,
                                         &breakpoints) == 1);
  OPENAXE_EXPECT(sample_rate > 0.0);
  OPENAXE_EXPECT(has_loudness == 0 || has_loudness == 1);
  OPENAXE_EXPECT(is_slimmable == 0);       // lstm.nam is not a slimmable capture
  OPENAXE_EXPECT(breakpoints == 0);

  // And it actually produces audio through the graph.
  std::vector<float> in_l(64, 0.0f), in_r(64, 0.0f), out_l(64, 0.0f), out_r(64, 0.0f);
  in_l[0] = in_r[0] = 0.5f;
  const float* in_ptrs[2] = {in_l.data(), in_r.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};
  nam_studio_process(graph, in_ptrs, 2, out_ptrs, 2, 64);
  bool finite = true;
  for (float sample : out_l) finite = finite && std::isfinite(sample);
  OPENAXE_EXPECT(finite);

  // Bad JSON is a format error, not a crash, and leaves the previous model be.
  OPENAXE_EXPECT(nam_studio_load_nam_model_json(graph, amp, "{}") == NAM_STUDIO_LOAD_INVALID_FORMAT);
  OPENAXE_EXPECT(nam_studio_load_nam_model_json(graph, amp, nullptr) == NAM_STUDIO_LOAD_INVALID_FORMAT);
  OPENAXE_EXPECT(nam_studio_block_has_model(graph, amp) == 1);

  nam_studio_unload_nam_model(graph, amp);
  OPENAXE_EXPECT(nam_studio_block_model_info(graph, amp, nullptr, nullptr, nullptr, nullptr, nullptr,
                                         nullptr, nullptr, nullptr, nullptr) == 0);
  nam_studio_graph_destroy(graph);
}

// A slimmable capture's breakpoints come back through the two-call accessor.
void TestSlimBreakpointsOverAbi() {
  NamStudioGraph* graph = nam_studio_graph_create();
  const int32_t amp = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_AMP, 0, 0);
  nam_studio_reset(graph, 48000.0, 512);

  std::ifstream ifs(std::string(NAM_CORE_EXAMPLE_MODELS_DIR) + "/slimmable_wavenet.nam",
                    std::ios::binary);
  OPENAXE_EXPECT(ifs.good());
  const std::string json((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
  OPENAXE_EXPECT(nam_studio_load_nam_model_json(graph, amp, json.c_str()) == NAM_STUDIO_LOAD_OK);

  int32_t is_slimmable = 0;
  int32_t count = 0;
  OPENAXE_EXPECT(nam_studio_block_model_info(graph, amp, nullptr, nullptr, nullptr, nullptr, nullptr,
                                         nullptr, nullptr, &is_slimmable, &count) == 1);
  OPENAXE_EXPECT(is_slimmable == 1);
  OPENAXE_EXPECT(count > 0);

  std::vector<double> values(static_cast<size_t>(count), 0.0);
  OPENAXE_EXPECT(nam_studio_block_model_slim_breakpoints(graph, amp, values.data(), count) == count);
  for (double v : values) OPENAXE_EXPECT(v > 0.0);

  // A smaller buffer is truncated, not overrun.
  OPENAXE_EXPECT(nam_studio_block_model_slim_breakpoints(graph, amp, values.data(), 1) == 1);
  // The amp param surface is fixed at 7 (two calibration values, slim size, and
  // the four tone-stack bands) whether or not the capture is slimmable -
  // "is this slimmable?" is model metadata, not a param-count change.
  OPENAXE_EXPECT(nam_studio_block_param_count(graph, amp) == 7);

  nam_studio_graph_destroy(graph);
}

// Cab IR convolution over the ABI: the feature that existed only as a Web Audio
// ConvolverNode in the web app, so desktop cab blocks passed audio through.
void TestCabIrConvolutionOverAbi() {
  NamStudioGraph* graph = nam_studio_graph_create();
  const int32_t cab = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_CAB, 0, 0);
  OPENAXE_EXPECT(nam_studio_connect(graph, NAM_STUDIO_IN_RAIL, 0, cab, 0) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(graph, cab, 0, NAM_STUDIO_OUT_RAIL, 0) >= 0);
  nam_studio_reset(graph, 48000.0, 128);

  // A two-tap IR: unity plus a half-strength echo 64 samples later. Easy to read
  // in the output, and it spans a partition boundary.
  std::vector<float> ir(65, 0.0f);
  ir[0] = 1.0f;
  ir[64] = 0.5f;
  nam_studio_load_ir(graph, cab, ir.data(), static_cast<int32_t>(ir.size()));
  OPENAXE_EXPECT(nam_studio_block_ir_length(graph, cab) == 65);

  const auto render = [&](float first_sample) {
    std::vector<float> in_l(128, 0.0f), in_r(128, 0.0f), out_l(128, 0.0f), out_r(128, 0.0f);
    in_l[0] = in_r[0] = first_sample;
    const float* in_ptrs[2] = {in_l.data(), in_r.data()};
    float* out_ptrs[2] = {out_l.data(), out_r.data()};
    nam_studio_process(graph, in_ptrs, 2, out_ptrs, 2, 128);
    return out_l;
  };

  const auto wet = render(1.0f);
  OPENAXE_EXPECT(std::fabs(wet[0] - 1.0f) < 1e-4f);    // dry tap, no latency
  OPENAXE_EXPECT(std::fabs(wet[64] - 0.5f) < 1e-4f);   // the echo, on time
  OPENAXE_EXPECT(std::fabs(wet[32]) < 1e-4f);          // nothing in between

  // Mix at 0 is fully dry: the impulse survives, the echo doesn't. The cab's
  // ir_mix is smoothed (exponential, 30 ms per the schema) per issue #122, so settle a few
  // buffers after the change before asserting the steady state.
  nam_studio_set_param(graph, cab, 0, 0.0f);
  for (int i = 0; i < 200; ++i) render(1.0f);
  const auto dry = render(1.0f);
  OPENAXE_EXPECT(std::fabs(dry[0] - 1.0f) < 1e-4f);
  OPENAXE_EXPECT(std::fabs(dry[64]) < 1e-4f);

  // Half wet halves the echo.
  nam_studio_set_param(graph, cab, 0, 0.5f);
  for (int i = 0; i < 200; ++i) render(1.0f);
  const auto half = render(1.0f);
  OPENAXE_EXPECT(std::fabs(half[64] - 0.25f) < 1e-4f);

  // Unloading returns the block to passthrough.
  nam_studio_unload_ir(graph, cab);
  OPENAXE_EXPECT(nam_studio_block_ir_length(graph, cab) == 0);
  nam_studio_set_param(graph, cab, 0, 1.0f);
  const auto cleared = render(0.25f);
  OPENAXE_EXPECT(std::fabs(cleared[0] - 0.25f) < 1e-4f);
  OPENAXE_EXPECT(std::fabs(cleared[64]) < 1e-4f);

  // Loading an IR onto a non-cab block is a no-op, not a crash.
  const int32_t delay = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_DELAY, 1, 0);
  nam_studio_load_ir(graph, delay, ir.data(), static_cast<int32_t>(ir.size()));
  OPENAXE_EXPECT(nam_studio_block_ir_length(graph, delay) == 0);

  nam_studio_graph_destroy(graph);
}

void TestUnknownBlockCallsAreSafeNoOps() {
  NamStudioGraph* graph = nam_studio_graph_create();

  OPENAXE_EXPECT(nam_studio_block_param_count(graph, 999) == 0);
  OPENAXE_EXPECT(nam_studio_get_param(graph, 999, 0) == 0.0f);
  nam_studio_set_param(graph, 999, 0, 1.0f);  // must not crash
  OPENAXE_EXPECT(nam_studio_get_meter(graph, 999) == 0.0f);
  OPENAXE_EXPECT(nam_studio_block_has_model(graph, 999) == 0);
  OPENAXE_EXPECT(nam_studio_load_nam_model(graph, 999, "/does/not/matter.nam") ==
             NAM_STUDIO_LOAD_FILE_NOT_FOUND);
  OPENAXE_EXPECT(nam_studio_load_nam_model_json(graph, 999, "{}") == NAM_STUDIO_LOAD_FILE_NOT_FOUND);
  OPENAXE_EXPECT(nam_studio_block_model_info(graph, 999, nullptr, nullptr, nullptr, nullptr, nullptr,
                                         nullptr, nullptr, nullptr, nullptr) == 0);
  OPENAXE_EXPECT(nam_studio_block_model_slim_breakpoints(graph, 999, nullptr, 0) == 0);
  nam_studio_load_ir(graph, 999, nullptr, 0);  // must not crash
  nam_studio_unload_ir(graph, 999);
  OPENAXE_EXPECT(nam_studio_block_ir_length(graph, 999) == 0);
  nam_studio_remove_block(graph, 999);       // must not crash
  nam_studio_disconnect(graph, 999);         // must not crash

  nam_studio_graph_destroy(graph);
}

}  // namespace

int main() {
  TestEndToEndAmpAndReverbRig();
  TestUnwrappedKindPassesAudioThrough();
  TestReverbAlgorithmSwitchOnlyAffectsThatBlock();
  TestEndToEndDsparkRig();
  TestLoadModelJsonAndModelInfoOverAbi();
  TestSlimBreakpointsOverAbi();
  TestCabIrConvolutionOverAbi();
  TestUnknownBlockCallsAreSafeNoOps();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}
