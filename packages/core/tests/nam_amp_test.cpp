// Real end-to-end test: loads an actual .nam model bundled with the
// NeuralAmpModelerCore submodule and runs it through Process(). Only built
// if NAM_STUDIO_HAS_NAM_CORE (see tests/CMakeLists.txt).
#include "nam_studio/dsp/nam_amp.h"

#include <cmath>
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

void TestLoadMissingFileReturnsError() {
  NamAmp amp;
  auto load_error = amp.LoadModel(std::string(NAM_CORE_EXAMPLE_MODELS_DIR) + "/does-not-exist.nam");
  NAM_EXPECT(load_error.has_value());
  NAM_EXPECT(!amp.HasModel());
}

}  // namespace

int main() {
  TestLoadResetProcessUnload();
  TestLoadMissingFileReturnsError();

  return nam_studio::test::g_failures == 0 ? 0 : 1;
}
