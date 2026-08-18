// Real end-to-end test of the extern "C" real-time ABI (issue #14): builds
// an IN -> Amp -> Reverb -> OUT rig, loads an actual .nam model bundled with
// the NeuralAmpModelerCore submodule, and processes real audio through it,
// through the full extern "C" surface, not just the C++ class directly or
// the engine layer (see engine_test.cpp). Only built if
// NAM_STUDIO_HAS_NAM_CORE && NAM_STUDIO_HAS_DRAGONFLY (see
// tests/CMakeLists.txt) - same WHOLE_ARCHIVE link requirement as
// nam_amp_test (NAMCore's architecture parsers self-register via static
// initializers with no other symbol referenced, so a plain static-archive
// link silently drops those object files otherwise).
#include "nam_studio/api.h"

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
  NAM_EXPECT(nam_studio_connect(graph, NAM_STUDIO_IN_RAIL, 0, amp, 0) >= 0);
  NAM_EXPECT(nam_studio_connect(graph, amp, 0, reverb, 0) >= 0);
  NAM_EXPECT(nam_studio_connect(graph, reverb, 0, NAM_STUDIO_OUT_RAIL, 0) >= 0);

  nam_studio_reset(graph, kSampleRate, kBlockSize);

  const std::string model_path = std::string(NAM_CORE_EXAMPLE_MODELS_DIR) + "/lstm.nam";
  NAM_EXPECT(nam_studio_load_nam_model(graph, amp, model_path.c_str()) == NAM_STUDIO_LOAD_OK);
  NAM_EXPECT(nam_studio_block_has_model(graph, amp) == 1);

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
  NAM_EXPECT(all_finite);
  NAM_EXPECT(any_nonzero);
  NAM_EXPECT(nam_studio_get_meter(graph, amp) >= 0.0f);
  NAM_EXPECT(nam_studio_get_cpu_load(graph) >= 0.0f);

  nam_studio_unload_nam_model(graph, amp);
  NAM_EXPECT(nam_studio_block_has_model(graph, amp) == 0);

  nam_studio_graph_destroy(graph);
}

void TestUnwrappedKindPassesAudioThrough() {
  NamStudioGraph* graph = nam_studio_graph_create();

  const int32_t cab = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_CAB, 0, 0);
  NAM_EXPECT(nam_studio_block_param_count(graph, cab) == 0);  // no wrapped DSP behind Cab
  NAM_EXPECT(nam_studio_connect(graph, NAM_STUDIO_IN_RAIL, 0, cab, 0) >= 0);
  NAM_EXPECT(nam_studio_connect(graph, cab, 0, NAM_STUDIO_OUT_RAIL, 0) >= 0);
  nam_studio_reset(graph, kSampleRate, kBlockSize);

  std::vector<float> input(kBlockSize, 0.3f);
  std::vector<float> output(kBlockSize, 0.0f);
  const float* in_ptrs[1] = {input.data()};
  float* out_ptrs[1] = {output.data()};
  nam_studio_process(graph, in_ptrs, 1, out_ptrs, 1, kBlockSize);

  for (float sample : output) NAM_EXPECT(sample == 0.3f);

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

  NAM_EXPECT(nam_studio_block_param_count(graph, compressor) == 8);
  NAM_EXPECT(nam_studio_block_param_count(graph, eq) == 12);
  NAM_EXPECT(nam_studio_block_param_count(graph, gate) == 6);
  NAM_EXPECT(nam_studio_block_param_count(graph, tremolo) == 3);

  const char* name = nullptr;
  NAM_EXPECT(nam_studio_block_param_info(graph, compressor, 0, &name, nullptr, nullptr, nullptr,
                                          nullptr) == 1);
  NAM_EXPECT(name != nullptr);

  NAM_EXPECT(nam_studio_connect(graph, NAM_STUDIO_IN_RAIL, 0, compressor, 0) >= 0);
  NAM_EXPECT(nam_studio_connect(graph, compressor, 0, eq, 0) >= 0);
  NAM_EXPECT(nam_studio_connect(graph, eq, 0, gate, 0) >= 0);
  NAM_EXPECT(nam_studio_connect(graph, gate, 0, tremolo, 0) >= 0);
  NAM_EXPECT(nam_studio_connect(graph, tremolo, 0, NAM_STUDIO_OUT_RAIL, 0) >= 0);
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
  NAM_EXPECT(all_finite);
  NAM_EXPECT(max_abs_out > 0.0f);
  NAM_EXPECT(max_abs_out < 0.5f);

  nam_studio_graph_destroy(graph);
}

void TestReverbAlgorithmSwitchOnlyAffectsThatBlock() {
  NamStudioGraph* graph = nam_studio_graph_create();

  const int32_t reverb_a = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_REVERB, 0, 0);
  const int32_t reverb_b = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_REVERB, 1, 0);
  const int32_t hall_param_count = nam_studio_block_param_count(graph, reverb_a);
  NAM_EXPECT(hall_param_count == nam_studio_block_param_count(graph, reverb_b));

  nam_studio_set_reverb_algorithm(graph, reverb_a, NAM_STUDIO_REVERB_EARLY_REFLECTIONS);
  NAM_EXPECT(nam_studio_block_param_count(graph, reverb_a) != hall_param_count);
  NAM_EXPECT(nam_studio_block_param_count(graph, reverb_b) == hall_param_count);  // untouched

  const char* name = nullptr;
  const char* symbol = nullptr;
  float min_value = 0.0f, max_value = 0.0f;
  const char* unit = nullptr;
  NAM_EXPECT(nam_studio_block_param_info(graph, reverb_a, 0, &name, &symbol, &min_value, &max_value,
                                          &unit) == 1);
  NAM_EXPECT(name != nullptr);

  nam_studio_graph_destroy(graph);
}

// The JSON load path and the model-info accessors, over the ABI a browser and a
// plugin actually call (the web app has no filesystem to hand a path to).
void TestLoadModelJsonAndModelInfoOverAbi() {
  NamStudioGraph* graph = nam_studio_graph_create();
  const int32_t amp = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_AMP, 0, 0);
  NAM_EXPECT(nam_studio_connect(graph, NAM_STUDIO_IN_RAIL, 0, amp, 0) >= 0);
  NAM_EXPECT(nam_studio_connect(graph, amp, 0, NAM_STUDIO_OUT_RAIL, 0) >= 0);
  nam_studio_reset(graph, 48000.0, 512);

  // No model yet: model info reports nothing rather than stale values.
  NAM_EXPECT(nam_studio_block_model_info(graph, amp, nullptr, nullptr, nullptr, nullptr, nullptr,
                                         nullptr, nullptr, nullptr, nullptr) == 0);

  std::ifstream ifs(std::string(NAM_CORE_EXAMPLE_MODELS_DIR) + "/lstm.nam", std::ios::binary);
  NAM_EXPECT(ifs.good());
  const std::string json((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());

  NAM_EXPECT(nam_studio_load_nam_model_json(graph, amp, json.c_str()) == NAM_STUDIO_LOAD_OK);
  NAM_EXPECT(nam_studio_block_has_model(graph, amp) == 1);

  double sample_rate = 0.0;
  int32_t has_loudness = -1;
  int32_t is_slimmable = -1;
  int32_t breakpoints = -1;
  NAM_EXPECT(nam_studio_block_model_info(graph, amp, &sample_rate, &has_loudness, nullptr, nullptr,
                                         nullptr, nullptr, nullptr, &is_slimmable,
                                         &breakpoints) == 1);
  NAM_EXPECT(sample_rate > 0.0);
  NAM_EXPECT(has_loudness == 0 || has_loudness == 1);
  NAM_EXPECT(is_slimmable == 0);       // lstm.nam is not a slimmable capture
  NAM_EXPECT(breakpoints == 0);

  // And it actually produces audio through the graph.
  std::vector<float> in_l(64, 0.0f), in_r(64, 0.0f), out_l(64, 0.0f), out_r(64, 0.0f);
  in_l[0] = in_r[0] = 0.5f;
  const float* in_ptrs[2] = {in_l.data(), in_r.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};
  nam_studio_process(graph, in_ptrs, 2, out_ptrs, 2, 64);
  bool finite = true;
  for (float sample : out_l) finite = finite && std::isfinite(sample);
  NAM_EXPECT(finite);

  // Bad JSON is a format error, not a crash, and leaves the previous model be.
  NAM_EXPECT(nam_studio_load_nam_model_json(graph, amp, "{}") == NAM_STUDIO_LOAD_INVALID_FORMAT);
  NAM_EXPECT(nam_studio_load_nam_model_json(graph, amp, nullptr) == NAM_STUDIO_LOAD_INVALID_FORMAT);
  NAM_EXPECT(nam_studio_block_has_model(graph, amp) == 1);

  nam_studio_unload_nam_model(graph, amp);
  NAM_EXPECT(nam_studio_block_model_info(graph, amp, nullptr, nullptr, nullptr, nullptr, nullptr,
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
  NAM_EXPECT(ifs.good());
  const std::string json((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
  NAM_EXPECT(nam_studio_load_nam_model_json(graph, amp, json.c_str()) == NAM_STUDIO_LOAD_OK);

  int32_t is_slimmable = 0;
  int32_t count = 0;
  NAM_EXPECT(nam_studio_block_model_info(graph, amp, nullptr, nullptr, nullptr, nullptr, nullptr,
                                         nullptr, nullptr, &is_slimmable, &count) == 1);
  NAM_EXPECT(is_slimmable == 1);
  NAM_EXPECT(count > 0);

  std::vector<double> values(static_cast<size_t>(count), 0.0);
  NAM_EXPECT(nam_studio_block_model_slim_breakpoints(graph, amp, values.data(), count) == count);
  for (double v : values) NAM_EXPECT(v > 0.0);

  // A smaller buffer is truncated, not overrun.
  NAM_EXPECT(nam_studio_block_model_slim_breakpoints(graph, amp, values.data(), 1) == 1);
  // The amp param surface is fixed at 7 (two calibration values, slim size, and
  // the four tone-stack bands) whether or not the capture is slimmable -
  // "is this slimmable?" is model metadata, not a param-count change.
  NAM_EXPECT(nam_studio_block_param_count(graph, amp) == 7);

  nam_studio_graph_destroy(graph);
}

void TestUnknownBlockCallsAreSafeNoOps() {
  NamStudioGraph* graph = nam_studio_graph_create();

  NAM_EXPECT(nam_studio_block_param_count(graph, 999) == 0);
  NAM_EXPECT(nam_studio_get_param(graph, 999, 0) == 0.0f);
  nam_studio_set_param(graph, 999, 0, 1.0f);  // must not crash
  NAM_EXPECT(nam_studio_get_meter(graph, 999) == 0.0f);
  NAM_EXPECT(nam_studio_block_has_model(graph, 999) == 0);
  NAM_EXPECT(nam_studio_load_nam_model(graph, 999, "/does/not/matter.nam") ==
             NAM_STUDIO_LOAD_FILE_NOT_FOUND);
  NAM_EXPECT(nam_studio_load_nam_model_json(graph, 999, "{}") == NAM_STUDIO_LOAD_FILE_NOT_FOUND);
  NAM_EXPECT(nam_studio_block_model_info(graph, 999, nullptr, nullptr, nullptr, nullptr, nullptr,
                                         nullptr, nullptr, nullptr, nullptr) == 0);
  NAM_EXPECT(nam_studio_block_model_slim_breakpoints(graph, 999, nullptr, 0) == 0);
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
  TestUnknownBlockCallsAreSafeNoOps();

  return nam_studio::test::g_failures == 0 ? 0 : 1;
}
