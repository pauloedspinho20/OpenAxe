#pragma once

#include <memory>
#include <optional>
#include <string>
#include <vector>

// Forward-declared only - defined in NeuralAmpModelerCore's NAM/dsp.h.
// Consumers of nam_studio_core never need Eigen/nlohmann on their own
// include path because of this: those stay PRIVATE to this library's CMake
// target (see packages/core/CMakeLists.txt).
namespace nam {
class DSP;
struct dspData;
}  // namespace nam

namespace nam_studio::dsp {

enum class NamLoadError {
  kFileNotFound,
  kInvalidFormat,
};

struct NamModelInfo {
  std::string version;
  double sample_rate = -1.0;  // model's expected/trained rate, -1 if unknown
  bool has_loudness = false;
  double loudness_db = 0.0;
  bool has_input_level = false;
  double input_level_dbu = 0.0;
  bool has_output_level = false;
  double output_level_dbu = 0.0;
  bool is_slimmable = false;
  std::vector<double> slim_size_breakpoints;
};

// Wraps NeuralAmpModelerCore's nam::DSP, exposing NAM model loading and its
// full parameter surface (level calibration, loudness, slim-size quality
// control) as a clean C++ API.
//
// Real-time safety split: LoadModel/UnloadModel/Reset/SetSlimSize are NOT
// real-time safe (allocate, parse JSON, may run prewarm - call them off the
// audio thread). Process is real-time safe once a model is loaded and
// Reset() has been called with a large enough max_buffer_size.
class NamAmp {
 public:
  NamAmp();
  ~NamAmp();
  NamAmp(const NamAmp&) = delete;
  NamAmp& operator=(const NamAmp&) = delete;

  // Loads a .nam model from a file path. Catches NAMCore's internal
  // exceptions and translates them to NamLoadError rather than propagating
  // C++ exceptions across what will eventually be an extern "C" boundary.
  std::optional<NamLoadError> LoadModel(const std::string& nam_file_path);

  // Same, from the .nam file's JSON content already in memory. This is the form
  // every non-desktop front end needs: a browser has no filesystem to hand a
  // path to (the model arrives over fetch or out of IndexedDB), and a plugin
  // restoring host state has bytes, not a file. kInvalidFormat covers
  // unparseable JSON, a document missing the fields a .nam file requires, and
  // an architecture NAMCore has no parser for.
  std::optional<NamLoadError> LoadModelFromJson(const std::string& json_text);
  void UnloadModel();
  bool HasModel() const;
  const NamModelInfo& ModelInfo() const { return info_; }

  // The .nam JSON this model was loaded from - the path load reads the file
  // itself and retains the same text, so both entry points are
  // indistinguishable here (issue #120: state serialization embeds this as
  // the block's model payload). Empty when no model is loaded. Deliberately a
  // full copy of the source: a few MB per amp block, traded for a saved rig
  // that can carry its own captures.
  const std::string& SourceJson() const { return source_json_; }

  // Must be called before Process(), and whenever sample rate or max block
  // size changes. Not real-time safe.
  void Reset(double sample_rate, int max_buffer_size);

  // Real-time safe. input/output are mono buffers of num_frames samples;
  // no-op (silence untouched) if no model is loaded.
  void Process(const float* input, float* output, int num_frames);

  // Only meaningful if ModelInfo().is_slimmable; no-op otherwise, mirroring
  // NAMCore's own "check Has...() first" convention. Not real-time safe.
  void SetSlimSize(double value);
  double SlimSize() const { return slim_size_; }

  // Calibration overrides (dBu) - independent of whether the model itself
  // defines these (see ModelInfo().has_input_level / has_output_level).
  void SetInputLevel(double dbu);
  void SetOutputLevel(double dbu);

 private:
  // Shared tail of both load paths: adopt the parsed model and snapshot its
  // metadata into info_.
  void AdoptModel(std::unique_ptr<nam::DSP> loaded, const nam::dspData& config);

  std::unique_ptr<nam::DSP> dsp_;
  NamModelInfo info_;
  double slim_size_ = 1.0;
  // The exact .nam JSON the current model came from (see SourceJson).
  std::string source_json_;
};

}  // namespace nam_studio::dsp
