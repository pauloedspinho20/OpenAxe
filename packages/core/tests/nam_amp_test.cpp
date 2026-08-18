// Real end-to-end test: loads an actual .nam model bundled with the
// NeuralAmpModelerCore submodule and runs it through Process(). Only built
// if NAM_STUDIO_HAS_NAM_CORE (see tests/CMakeLists.txt).
#include "nam_studio/dsp/nam_amp.h"

#include <cmath>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "test_harness.h"

using nam_studio::dsp::NamAmp;

namespace {

void TestLoadResetProcessUnload() {
  NamAmp amp;
  NAM_EXPECT(!amp.HasModel());

  const std::string model_path = std::string(NAM_CORE_EXAMPLE_MODELS_DIR) + "/lstm.nam";
  auto load_error = amp.LoadModel(model_path);
  NAM_EXPECT(!load_error.has_value());
  NAM_EXPECT(amp.HasModel());

  amp.Reset(48000.0, 512);

  std::vector<float> input(512, 0.0f);
  input[0] = 1.0f;  // impulse
  std::vector<float> output(512, 0.0f);
  amp.Process(input.data(), output.data(), 512);

  bool all_finite = true;
  for (float sample : output) {
    if (!std::isfinite(sample)) {
      all_finite = false;
      break;
    }
  }
  NAM_EXPECT(all_finite);

  amp.UnloadModel();
  NAM_EXPECT(!amp.HasModel());
}

// Loading the same capture from its JSON content must be indistinguishable from
// loading it by path - this is the entry point the browser and a plugin use, so
// a divergence here would mean the web and desktop apps run different amps.
void TestLoadFromJsonMatchesLoadFromPath() {
  const std::string model_path = std::string(NAM_CORE_EXAMPLE_MODELS_DIR) + "/lstm.nam";
  std::ifstream ifs(model_path, std::ios::binary);
  NAM_EXPECT(ifs.good());
  const std::string json((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
  NAM_EXPECT(!json.empty());

  // Same impulse through both, sample for sample.
  const auto run = [](NamAmp& amp) {
    amp.Reset(48000.0, 512);
    std::vector<float> input(512, 0.0f);
    input[0] = 1.0f;
    std::vector<float> output(512, 0.0f);
    amp.Process(input.data(), output.data(), 512);
    return output;
  };

  NamAmp from_path;
  NAM_EXPECT(!from_path.LoadModel(model_path).has_value());
  const auto path_output = run(from_path);

  NamAmp from_json;
  NAM_EXPECT(!from_json.LoadModelFromJson(json).has_value());
  NAM_EXPECT(from_json.HasModel());
  const auto json_output = run(from_json);

  for (size_t i = 0; i < path_output.size(); ++i) {
    NAM_EXPECT(path_output[i] == json_output[i]);
  }

  // Metadata is snapshotted by the shared tail, so both agree about it too.
  NAM_EXPECT(from_json.ModelInfo().sample_rate == from_path.ModelInfo().sample_rate);
  NAM_EXPECT(from_json.ModelInfo().has_loudness == from_path.ModelInfo().has_loudness);
  NAM_EXPECT(from_json.ModelInfo().is_slimmable == from_path.ModelInfo().is_slimmable);
}

// A slimmable capture reports its breakpoints either way round.
void TestSlimmableFromJsonReportsBreakpoints() {
  const std::string model_path =
      std::string(NAM_CORE_EXAMPLE_MODELS_DIR) + "/slimmable_wavenet.nam";
  std::ifstream ifs(model_path, std::ios::binary);
  NAM_EXPECT(ifs.good());
  const std::string json((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());

  NamAmp amp;
  NAM_EXPECT(!amp.LoadModelFromJson(json).has_value());
  NAM_EXPECT(amp.ModelInfo().is_slimmable);
  NAM_EXPECT(!amp.ModelInfo().slim_size_breakpoints.empty());
}

// Malformed JSON, and well-formed JSON that isn't a model, are both format
// errors rather than crashes or exceptions escaping towards the ABI.
void TestBadJsonReturnsInvalidFormat() {
  NamAmp amp;
  NAM_EXPECT(amp.LoadModelFromJson("not json at all").has_value());
  NAM_EXPECT(!amp.HasModel());
  NAM_EXPECT(amp.LoadModelFromJson("{}").has_value());
  NAM_EXPECT(!amp.HasModel());
  NAM_EXPECT(amp.LoadModelFromJson("").has_value());
  NAM_EXPECT(!amp.HasModel());
}

void TestLoadMissingFileReturnsError() {
  NamAmp amp;
  auto load_error = amp.LoadModel(std::string(NAM_CORE_EXAMPLE_MODELS_DIR) + "/does-not-exist.nam");
  NAM_EXPECT(load_error.has_value());
  NAM_EXPECT(!amp.HasModel());
}

}  // namespace

int main() {
  TestLoadResetProcessUnload();
  TestLoadFromJsonMatchesLoadFromPath();
  TestSlimmableFromJsonReportsBreakpoints();
  TestBadJsonReturnsInvalidFormat();
  TestLoadMissingFileReturnsError();

  return nam_studio::test::g_failures == 0 ? 0 : 1;
}
