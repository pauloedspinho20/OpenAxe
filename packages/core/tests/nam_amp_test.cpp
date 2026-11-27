// Real end-to-end test: loads an actual .nam model bundled with the
// NeuralAmpModelerCore submodule and runs it through Process(). Only built
// if OPENAXE_HAS_NAM_CORE (see tests/CMakeLists.txt).
#include "openaxe/dsp/nam_amp.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "test_harness.h"

using openaxe::dsp::NamAmp;

namespace {

void TestLoadResetProcessUnload() {
  NamAmp amp;
  OPENAXE_EXPECT(!amp.HasModel());

  const std::string model_path = std::string(NAM_CORE_EXAMPLE_MODELS_DIR) + "/lstm.nam";
  auto load_error = amp.LoadModel(model_path);
  OPENAXE_EXPECT(!load_error.has_value());
  OPENAXE_EXPECT(amp.HasModel());

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
  OPENAXE_EXPECT(all_finite);

  amp.UnloadModel();
  OPENAXE_EXPECT(!amp.HasModel());
}

// Loading the same capture from its JSON content must be indistinguishable from
// loading it by path - this is the entry point the browser and a plugin use, so
// a divergence here would mean the web and desktop apps run different amps.
void TestLoadFromJsonMatchesLoadFromPath() {
  const std::string model_path = std::string(NAM_CORE_EXAMPLE_MODELS_DIR) + "/lstm.nam";
  std::ifstream ifs(model_path, std::ios::binary);
  OPENAXE_EXPECT(ifs.good());
  const std::string json((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
  OPENAXE_EXPECT(!json.empty());

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
  OPENAXE_EXPECT(!from_path.LoadModel(model_path).has_value());
  const auto path_output = run(from_path);

  NamAmp from_json;
  OPENAXE_EXPECT(!from_json.LoadModelFromJson(json).has_value());
  OPENAXE_EXPECT(from_json.HasModel());
  const auto json_output = run(from_json);

  for (size_t i = 0; i < path_output.size(); ++i) {
    OPENAXE_EXPECT(path_output[i] == json_output[i]);
  }

  // Metadata is snapshotted by the shared tail, so both agree about it too.
  OPENAXE_EXPECT(from_json.ModelInfo().sample_rate == from_path.ModelInfo().sample_rate);
  OPENAXE_EXPECT(from_json.ModelInfo().has_loudness == from_path.ModelInfo().has_loudness);
  OPENAXE_EXPECT(from_json.ModelInfo().is_slimmable == from_path.ModelInfo().is_slimmable);
}

// A slimmable capture reports its breakpoints either way round.
void TestSlimmableFromJsonReportsBreakpoints() {
  const std::string model_path =
      std::string(NAM_CORE_EXAMPLE_MODELS_DIR) + "/slimmable_wavenet.nam";
  std::ifstream ifs(model_path, std::ios::binary);
  OPENAXE_EXPECT(ifs.good());
  const std::string json((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());

  NamAmp amp;
  OPENAXE_EXPECT(!amp.LoadModelFromJson(json).has_value());
  OPENAXE_EXPECT(amp.ModelInfo().is_slimmable);
  OPENAXE_EXPECT(!amp.ModelInfo().slim_size_breakpoints.empty());
}

// Malformed JSON, and well-formed JSON that isn't a model, are both format
// errors rather than crashes or exceptions escaping towards the ABI.
void TestBadJsonReturnsInvalidFormat() {
  NamAmp amp;
  OPENAXE_EXPECT(amp.LoadModelFromJson("not json at all").has_value());
  OPENAXE_EXPECT(!amp.HasModel());
  OPENAXE_EXPECT(amp.LoadModelFromJson("{}").has_value());
  OPENAXE_EXPECT(!amp.HasModel());
  OPENAXE_EXPECT(amp.LoadModelFromJson("").has_value());
  OPENAXE_EXPECT(!amp.HasModel());
}

std::string ReadModelJson(const char* name) {
  std::ifstream ifs(std::string(NAM_CORE_EXAMPLE_MODELS_DIR) + "/" + name, std::ios::binary);
  return std::string((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
}

// Rewrite (or, with new_rate <= 0, drop) a capture's top-level "sample_rate"
// - nested child models of a container are left alone; wavenet.nam has none.
std::string WithSampleRate(std::string json, double new_rate) {
  const std::string key = "\"sample_rate\"";
  const size_t at = json.rfind(key);
  if (at == std::string::npos) return json;
  size_t end = json.find_first_of(",}", at);
  if (new_rate > 0.0) {
    json.replace(at, end - at, key + ": " + std::to_string(new_rate));
  } else {
    // Drop the key along with the comma before it.
    const size_t comma = json.rfind(',', at);
    json.erase(comma, end - comma);
  }
  return json;
}

// Amplitude of `freq` in `signal` (single-bin DFT over a whole number of
// cycles' worth of samples).
double ToneAmplitude(const std::vector<float>& signal, size_t start, double freq, double rate) {
  double re = 0.0, im = 0.0;
  const size_t n = signal.size() - start;
  for (size_t i = 0; i < n; ++i) {
    const double phase = 2.0 * M_PI * freq * static_cast<double>(i) / rate;
    re += signal[start + i] * std::cos(phase);
    im -= signal[start + i] * std::sin(phase);
  }
  return 2.0 * std::sqrt(re * re + im * im) / static_cast<double>(n);
}

// Gain in dB the amp gives a quiet sine at `freq`, running at `rate` in
// blocks of `block` (an awkward size, to exercise the converter's carry-over).
double SineGainDb(NamAmp& amp, double rate, double freq) {
  constexpr int kBlock = 333;
  amp.Reset(rate, kBlock);
  const size_t total = static_cast<size_t>(rate * 0.5);
  const size_t settle = static_cast<size_t>(rate * 0.2);
  std::vector<float> input(total), output(total, 0.0f);
  const double amplitude = 0.01;  // small: keeps the capture near-linear
  for (size_t i = 0; i < total; ++i) {
    input[i] = static_cast<float>(amplitude * std::sin(2.0 * M_PI * freq * i / rate));
  }
  for (size_t pos = 0; pos < total; pos += kBlock) {
    const int n = static_cast<int>(std::min<size_t>(kBlock, total - pos));
    amp.Process(&input[pos], &output[pos], n);
  }
  return 20.0 * std::log10(ToneAmplitude(output, settle, freq, rate) / amplitude);
}

// At the capture's own rate nothing is put in front of it.
void TestNativeRateHasNoConverter() {
  NamAmp amp;
  OPENAXE_EXPECT(!amp.LoadModelFromJson(ReadModelJson("wavenet.nam")).has_value());
  OPENAXE_EXPECT(amp.ModelInfo().sample_rate == 48000.0);
  amp.Reset(48000.0, 512);
  OPENAXE_EXPECT(!amp.IsResampling());
  OPENAXE_EXPECT(amp.ResamplingLatency() == 0);
  OPENAXE_EXPECT(amp.ProcessingSampleRate() == 48000.0);
}

// At any other engine rate the capture runs at 48 kHz behind a converter,
// across odd block sizes, and Reset() back to the native rate removes it.
void TestOtherRatesRunBehindConverter() {
  NamAmp amp;
  OPENAXE_EXPECT(!amp.LoadModelFromJson(ReadModelJson("wavenet.nam")).has_value());
  for (const double rate : {44100.0, 88200.0, 96000.0, 22050.0}) {
    amp.Reset(rate, 512);
    OPENAXE_EXPECT(amp.IsResampling());
    OPENAXE_EXPECT(amp.ProcessingSampleRate() == 48000.0);
    OPENAXE_EXPECT(amp.ResamplingLatency() > 0);

    std::vector<float> input(4096), output(4096, 0.0f);
    for (size_t i = 0; i < input.size(); ++i) {
      input[i] = static_cast<float>(0.1 * std::sin(2.0 * M_PI * 220.0 * i / rate));
    }
    size_t pos = 0;
    for (const int n : {1, 512, 37, 128, 511, 2, 300}) {
      amp.Process(&input[pos], &output[pos], n);
      pos += static_cast<size_t>(n);
    }
    bool finite = true;
    double energy = 0.0;
    for (size_t i = 0; i < pos; ++i) {
      finite = finite && std::isfinite(output[i]);
      energy += static_cast<double>(output[i]) * output[i];
    }
    OPENAXE_EXPECT(finite);
    OPENAXE_EXPECT(energy > 0.0);
  }
  amp.Reset(48000.0, 512);
  OPENAXE_EXPECT(!amp.IsResampling());
}

// The point of the converter: at 44.1 kHz the capture should respond the way
// it does at its native 48 kHz. "Naive" is the pre-fix behaviour, reproduced
// by telling NamAmp the capture is a 44.1 kHz one so it feeds it directly.
void TestConvertedResponseMatchesNativeRate() {
  const std::string json = ReadModelJson("wavenet.nam");
  NamAmp native, converted, naive;
  OPENAXE_EXPECT(!native.LoadModelFromJson(json).has_value());
  OPENAXE_EXPECT(!converted.LoadModelFromJson(json).has_value());
  OPENAXE_EXPECT(!naive.LoadModelFromJson(WithSampleRate(json, 44100.0)).has_value());
  OPENAXE_EXPECT(naive.ModelInfo().sample_rate == 44100.0);

  double worst_converted = 0.0, worst_naive = 0.0;
  for (const double freq : {100.0, 400.0, 1000.0, 3000.0, 6000.0, 10000.0}) {
    const double reference = SineGainDb(native, 48000.0, freq);
    const double with_converter = SineGainDb(converted, 44100.0, freq);
    const double without = SineGainDb(naive, 44100.0, freq);
    OPENAXE_EXPECT(converted.IsResampling());
    OPENAXE_EXPECT(!naive.IsResampling());
    std::printf("  %6.0f Hz: native %+6.2f dB  converted %+6.2f dB  naive %+6.2f dB\n", freq,
                reference, with_converter, without);
    worst_converted = std::max(worst_converted, std::abs(with_converter - reference));
    worst_naive = std::max(worst_naive, std::abs(without - reference));
  }
  OPENAXE_EXPECT(worst_converted < 0.25);
  OPENAXE_EXPECT(worst_naive > worst_converted);
}

// A capture with no recorded rate is taken to be 48 kHz.
void TestUnknownRateAssumes48k() {
  NamAmp amp;
  OPENAXE_EXPECT(!amp.LoadModelFromJson(WithSampleRate(ReadModelJson("wavenet.nam"), 0.0)).has_value());
  OPENAXE_EXPECT(amp.ModelInfo().sample_rate < 0.0);
  amp.Reset(48000.0, 256);
  OPENAXE_EXPECT(!amp.IsResampling());
  amp.Reset(44100.0, 256);
  OPENAXE_EXPECT(amp.IsResampling());
  OPENAXE_EXPECT(amp.ProcessingSampleRate() == openaxe::dsp::kNamAssumedSampleRate);
}

// Linear models resample their own impulse response (NAMCore 0.6), so they
// get the engine rate directly rather than a second converter.
void TestLinearModelAdaptsItself() {
  const std::string linear =
      R"({"version": "0.5.4", "architecture": "Linear",
          "config": {"receptive_field": 4, "bias": false},
          "weights": [1.0, 0.5, 0.25, 0.125], "sample_rate": 48000})";
  NamAmp amp;
  OPENAXE_EXPECT(!amp.LoadModelFromJson(linear).has_value());
  amp.Reset(44100.0, 256);
  OPENAXE_EXPECT(!amp.IsResampling());
  OPENAXE_EXPECT(amp.ProcessingSampleRate() == 44100.0);
  std::vector<float> input(256, 0.0f), output(256, 0.0f);
  input[0] = 1.0f;
  amp.Process(input.data(), output.data(), 256);
  OPENAXE_EXPECT(std::isfinite(output[0]) && output[0] != 0.0f);
}

// Loading another capture drops the converter built for the previous one.
void TestReloadDropsConverter() {
  NamAmp amp;
  OPENAXE_EXPECT(!amp.LoadModelFromJson(ReadModelJson("wavenet.nam")).has_value());
  amp.Reset(44100.0, 256);
  OPENAXE_EXPECT(amp.IsResampling());
  OPENAXE_EXPECT(!amp.LoadModelFromJson(WithSampleRate(ReadModelJson("wavenet.nam"), 44100.0))
                      .has_value());
  OPENAXE_EXPECT(!amp.IsResampling());
  amp.Reset(44100.0, 256);
  OPENAXE_EXPECT(!amp.IsResampling());
  amp.UnloadModel();
  OPENAXE_EXPECT(!amp.IsResampling());
  OPENAXE_EXPECT(amp.ProcessingSampleRate() == 0.0);
}

void TestLoadMissingFileReturnsError() {
  NamAmp amp;
  auto load_error = amp.LoadModel(std::string(NAM_CORE_EXAMPLE_MODELS_DIR) + "/does-not-exist.nam");
  OPENAXE_EXPECT(load_error.has_value());
  OPENAXE_EXPECT(!amp.HasModel());
}

}  // namespace

int main() {
  TestLoadResetProcessUnload();
  TestLoadFromJsonMatchesLoadFromPath();
  TestSlimmableFromJsonReportsBreakpoints();
  TestBadJsonReturnsInvalidFormat();
  TestLoadMissingFileReturnsError();
  TestNativeRateHasNoConverter();
  TestOtherRatesRunBehindConverter();
  TestConvertedResponseMatchesNativeRate();
  TestUnknownRateAssumes48k();
  TestLinearModelAdaptsItself();
  TestReloadDropsConverter();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}
