#include "openaxe/dsp/nam_amp.h"

#include <filesystem>
#include <fstream>
#include <iterator>

// NAMCore's own bundled nlohmann (Dependencies/nlohmann, a PRIVATE include dir
// on this target) - matching how NAM/dsp.h itself includes it, so there is only
// ever one nlohmann in the translation unit.
#include "json.hpp"

#include <cmath>
#include <mutex>

#include "NAM/dsp.h"
#include "NAM/get_dsp.h"
#include "NAM/slimmable.h"

// AudioDSPTools' resampling headers read `iplug::PI` and `DEFAULT_BLOCK_SIZE`,
// which they expect their includer to supply (the code came out of iPlug2,
// where IPlugConstants.h does). Namespace-scope constexprs have internal
// linkage, so these can't collide with iPlug2's own definitions when
// packages/vst3 links both. The block size is only a default argument we
// never use - NamAmp::Reset always passes the real one.
namespace iplug {
constexpr double PI = 3.14159265358979323846;
}  // namespace iplug
namespace dsp {
constexpr int DEFAULT_BLOCK_SIZE = 512;
}  // namespace dsp
#include "dsp/ResamplingContainer/ResamplingContainer.h"

namespace openaxe::dsp {

namespace {

// Rates closer than this are the same rate - no converter.
constexpr double kSameRateTolerance = 0.5;

// LanczosResampler fills its shared kernel tables in its first constructor
// call with no synchronisation, and two engines (two plugin instances, or the
// engine's own load thread vs. a host-driven Reset) can construct one at once.
// Every construction happens under this lock; Reset is off the audio thread,
// so the lock never reaches Process.
std::mutex& ResamplerConstructionMutex() {
  static std::mutex mutex;
  return mutex;
}

}  // namespace

// Mono, filter half-width 12 - the NAM plugin's own choice (A=12): about a
// millisecond of combined latency at 44.1 kHz, with a stop band well clear of
// the audible range. Each direction keeps a fixed 2x128k-sample float ring
// (1 MB each), allocated only while a converter is actually needed.
struct NamResampler {
  explicit NamResampler(double model_rate) : container(model_rate) {}
  ::dsp::ResamplingContainer<float, 1, 12> container;
};

NamAmp::NamAmp() = default;
NamAmp::~NamAmp() = default;

// Load a .nam capture and cache everything the rest of the system needs to
// know about it. Returns an error code instead of throwing, since this crosses
// the extern "C" ABI; std::nullopt means success.
//
// Reads the file's text itself and delegates to LoadModelFromJson rather than
// handing NAMCore the path: both entry points then share one parse path (so
// they can never disagree about what a file contains) and one source
// retention (#120 - serialization needs the original JSON either way).
//
// NAMCore picks the architecture parser (WaveNet / LSTM / ConvNet / Linear)
// itself from the file's contents - which is exactly why openaxe_core must be
// linked whole-archive: those parsers self-register through static
// initializers, and a plain static link drops them, making every load fail.
//
// Not real-time safe (file IO, allocation, and it replaces the live DSP object).
// The caller suspends audio around it - see the engine's LoadNamModel.
std::optional<NamLoadError> NamAmp::LoadModel(const std::string& nam_file_path) {
  if (!std::filesystem::exists(nam_file_path)) return NamLoadError::kFileNotFound;

  std::ifstream ifs(nam_file_path, std::ios::binary);
  if (!ifs.good()) return NamLoadError::kFileNotFound;
  const std::string json_text((std::istreambuf_iterator<char>(ifs)),
                              std::istreambuf_iterator<char>());
  if (json_text.empty()) return NamLoadError::kInvalidFormat;

  return LoadModelFromJson(json_text);
}

// Load from the .nam file's JSON content instead of a path - see the header for
// why every front end other than the desktop app needs this form. NAMCore can
// parse a nlohmann::json document directly, so nothing is staged to disk.
// Not real-time safe (parses and allocates), same as LoadModel.
std::optional<NamLoadError> NamAmp::LoadModelFromJson(const std::string& json_text) {
  nlohmann::json parsed;
  try {
    parsed = nlohmann::json::parse(json_text);
  } catch (const std::exception&) {
    return NamLoadError::kInvalidFormat;
  }

  // NAMCore validates a .nam document only on its file-path entry point
  // (nam::validate_nam_file); get_dsp(const nlohmann::json&) trusts what it is
  // handed and indexes required keys directly, so an arbitrary document trips an
  // assertion inside nlohmann instead of throwing. Apply the same minimum checks
  // here first - deliberately mirroring nam_file.cpp's own required_keys list.
  if (!parsed.is_object()) return NamLoadError::kInvalidFormat;
  for (const char* key : {"version", "architecture", "config", "weights"}) {
    if (parsed.find(key) == parsed.end()) return NamLoadError::kInvalidFormat;
  }

  std::unique_ptr<nam::DSP> loaded;
  nam::dspData config;
  try {
    loaded = nam::get_dsp(parsed, config);
  } catch (const std::exception&) {
    // Well-formed JSON that isn't a NAM model, or whose architecture has no
    // registered parser (see the whole-archive note on LoadModel).
    return NamLoadError::kInvalidFormat;
  }
  if (!loaded) return NamLoadError::kInvalidFormat;

  AdoptModel(std::move(loaded), config);
  // Retain only once the model is genuinely adopted - a failed load must not
  // leave a stale source behind for serialization to embed (#120).
  source_json_ = json_text;
  return std::nullopt;
}

// Take ownership of a freshly-parsed model and snapshot the metadata the rest
// of the system reads. Shared by both load entry points so they can never
// disagree about what a loaded model reports.
void NamAmp::AdoptModel(std::unique_ptr<nam::DSP> loaded, const nam::dspData& config) {
  dsp_ = std::move(loaded);
  // A converter sized for the previous capture's rate is wrong for this one;
  // the caller's Reset() (required after every load) builds the right one.
  resampler_.reset();
  processing_sample_rate_ = 0.0;
  slim_size_ = 1.0;

  // Snapshot the model's own metadata. `input_level`/`output_level` are the
  // capture's dBu calibration figures, not user gain: the engine seeds its amp
  // params from them, and a UI's Input/Output knobs go to the block trims
  // instead (see openaxe_set_block_input_trim).
  info_ = NamModelInfo{};
  info_.version = config.version;
  info_.sample_rate = dsp_->GetExpectedSampleRate();
  info_.has_loudness = dsp_->HasLoudness();
  if (info_.has_loudness) info_.loudness_db = dsp_->GetLoudness();
  info_.has_input_level = dsp_->HasInputLevel();
  if (info_.has_input_level) info_.input_level_dbu = dsp_->GetInputLevel();
  info_.has_output_level = dsp_->HasOutputLevel();
  if (info_.has_output_level) info_.output_level_dbu = dsp_->GetOutputLevel();

  // Slimmable captures can trade fidelity for CPU at a set of discrete sizes;
  // report the breakpoints so a UI can offer them (see SetSlimSize).
  if (auto* slimmable = dynamic_cast<nam::SlimmableModel*>(dsp_.get())) {
    info_.is_slimmable = true;
    info_.slim_size_breakpoints = slimmable->GetSlimmableSizeBreakpoints();
  }
}

// Drop the model and forget its metadata and retained source; the block then
// passes audio through unchanged. Frees - not real-time safe.
void NamAmp::UnloadModel() {
  dsp_.reset();
  resampler_.reset();
  processing_sample_rate_ = 0.0;
  info_ = NamModelInfo{};
  slim_size_ = 1.0;
  source_json_.clear();
}

// Whether a capture is currently loaded (a block with none is a passthrough).
bool NamAmp::HasModel() const { return dsp_ != nullptr; }

// Prepare the loaded model for a sample rate and maximum block size.
// NAMCore's Reset() does NOT resample: a WaveNet/LSTM/ConvNet capture fed
// 44.1 kHz audio still treats each sample as 1/48000 s, which shifts its whole
// frequency response (by ~8% here, ~2x at 96 kHz). Linear models are the one
// kind that adapt themselves (SupportsArbitrarySampleRate), so those get the
// engine rate directly; everything else runs at its own rate behind a
// converter. Allocates; not real-time safe. No-op without a model.
void NamAmp::Reset(double sample_rate, int max_buffer_size) {
  resampler_.reset();
  processing_sample_rate_ = 0.0;
  if (!dsp_) return;

  const double model_rate =
      info_.sample_rate > 0.0 ? info_.sample_rate : kNamAssumedSampleRate;
  const bool needs_converter = sample_rate > 0.0 && max_buffer_size > 0 &&
                               std::abs(model_rate - sample_rate) >= kSameRateTolerance &&
                               !dsp_->SupportsArbitrarySampleRate();
  if (!needs_converter) {
    dsp_->Reset(sample_rate, max_buffer_size);
    processing_sample_rate_ = sample_rate;
    return;
  }

  auto resampler = std::make_unique<NamResampler>(model_rate);
  {
    std::lock_guard<std::mutex> lock(ResamplerConstructionMutex());
    resampler->container.Reset(sample_rate, max_buffer_size);
  }
  // The converter hands the model at most ceil(block * model/engine) samples
  // per call (ResamplingContainer::MaxEncapsulatedBlockSize); +1 for rounding.
  const int model_max_block =
      static_cast<int>(std::ceil(static_cast<double>(max_buffer_size) * model_rate / sample_rate)) +
      1;
  dsp_->Reset(model_rate, model_max_block);
  resampler_ = std::move(resampler);
  processing_sample_rate_ = model_rate;
}

int NamAmp::ResamplingLatency() const {
  return resampler_ ? resampler_->container.GetLatency() : 0;
}

// Run `num_frames` of mono audio through the model in place of the input.
// Mono because a NAM capture models one amp channel; the engine's stereo path
// runs the same model over both channels. Real-time safe, and a no-op (leaving
// `output` untouched) when no model is loaded - the engine treats that as
// passthrough. num_frames must not exceed the size passed to Reset.
void NamAmp::Process(const float* input, float* output, int num_frames) {
  if (!dsp_) return;
  // NAMCore's process() takes channel-indexed pointers even for mono, and
  // doesn't const-qualify the input pointee.
  float* in_ptrs[1] = {const_cast<float*>(input)};
  float* out_ptrs[1] = {output};
  if (resampler_) {
    // Up/down-convert around the model. The callback captures one pointer, so
    // the container's std::function holds it inline (no allocation), and the
    // container's buffers were all sized in Reset().
    nam::DSP* model = dsp_.get();
    resampler_->container.ProcessBlock(
        in_ptrs, out_ptrs, num_frames,
        [model](float** in, float** out, int n) { model->process(in, out, n); });
    return;
  }
  dsp_->process(in_ptrs, out_ptrs, num_frames);
}

// Pick a slimmed variant of a slimmable capture (see
// info_.slim_size_breakpoints). Rebuilds internal state, so it is NOT
// real-time safe - the engine applies it outside Process(), and it is a no-op
// for models that aren't slimmable.
void NamAmp::SetSlimSize(double value) {
  if (!dsp_ || !info_.is_slimmable) return;
  if (auto* slimmable = dynamic_cast<nam::SlimmableModel*>(dsp_.get())) {
    slimmable->SetSlimmableSize(value);
    slim_size_ = value;
  }
}

// Override the capture's input calibration, in dBu. Note NAMCore flips its own
// "has input level" flag as a side effect, which is why the engine only forwards
// this when the value is genuinely the model's or was explicitly set - see
// BlockState::amp_input_level_active. This is calibration, not a volume knob.
void NamAmp::SetInputLevel(double dbu) {
  if (!dsp_) return;
  dsp_->SetInputLevel(dbu);
  info_.has_input_level = true;
  info_.input_level_dbu = dbu;
}

// Override the capture's output calibration, in dBu. Same caveat as
// SetInputLevel: calibration, not a level control.
void NamAmp::SetOutputLevel(double dbu) {
  if (!dsp_) return;
  dsp_->SetOutputLevel(dbu);
  info_.has_output_level = true;
  info_.output_level_dbu = dbu;
}

}  // namespace openaxe::dsp
