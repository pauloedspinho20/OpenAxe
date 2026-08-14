#include "nam_studio/dsp/nam_amp.h"

#include <filesystem>

#include "NAM/dsp.h"
#include "NAM/get_dsp.h"
#include "NAM/slimmable.h"

namespace nam_studio::dsp {

NamAmp::NamAmp() = default;
NamAmp::~NamAmp() = default;

std::optional<NamLoadError> NamAmp::LoadModel(const std::string& nam_file_path) {
  if (!std::filesystem::exists(nam_file_path)) return NamLoadError::kFileNotFound;

  std::unique_ptr<nam::DSP> loaded;
  nam::dspData config;
  try {
    loaded = nam::get_dsp(std::filesystem::path(nam_file_path), config);
  } catch (const std::exception&) {
    // NAMCore throws NamFileValidationError (a std::runtime_error) for both
    // unreadable and malformed files - existence was already ruled out
    // above, so anything caught here is a format problem.
    return NamLoadError::kInvalidFormat;
  }
  if (!loaded) return NamLoadError::kInvalidFormat;

  dsp_ = std::move(loaded);
  slim_size_ = 1.0;

  info_ = NamModelInfo{};
  info_.version = config.version;
  info_.sample_rate = dsp_->GetExpectedSampleRate();
  info_.has_loudness = dsp_->HasLoudness();
  if (info_.has_loudness) info_.loudness_db = dsp_->GetLoudness();
  info_.has_input_level = dsp_->HasInputLevel();
  if (info_.has_input_level) info_.input_level_dbu = dsp_->GetInputLevel();
  info_.has_output_level = dsp_->HasOutputLevel();
  if (info_.has_output_level) info_.output_level_dbu = dsp_->GetOutputLevel();

  if (auto* slimmable = dynamic_cast<nam::SlimmableModel*>(dsp_.get())) {
    info_.is_slimmable = true;
    info_.slim_size_breakpoints = slimmable->GetSlimmableSizeBreakpoints();
  }

  return std::nullopt;
}

void NamAmp::UnloadModel() {
  dsp_.reset();
  info_ = NamModelInfo{};
  slim_size_ = 1.0;
}

bool NamAmp::HasModel() const { return dsp_ != nullptr; }

void NamAmp::Reset(double sample_rate, int max_buffer_size) {
  if (dsp_) dsp_->Reset(sample_rate, max_buffer_size);
}

void NamAmp::Process(const float* input, float* output, int num_frames) {
  if (!dsp_) return;
  // NAMCore's process() takes channel-indexed pointers even for mono, and
  // doesn't const-qualify the input pointee.
  float* in_ptrs[1] = {const_cast<float*>(input)};
  float* out_ptrs[1] = {output};
  dsp_->process(in_ptrs, out_ptrs, num_frames);
}

void NamAmp::SetSlimSize(double value) {
  if (!dsp_ || !info_.is_slimmable) return;
  if (auto* slimmable = dynamic_cast<nam::SlimmableModel*>(dsp_.get())) {
    slimmable->SetSlimmableSize(value);
    slim_size_ = value;
  }
}

void NamAmp::SetInputLevel(double dbu) {
  if (!dsp_) return;
  dsp_->SetInputLevel(dbu);
  info_.has_input_level = true;
  info_.input_level_dbu = dbu;
}

void NamAmp::SetOutputLevel(double dbu) {
  if (!dsp_) return;
  dsp_->SetOutputLevel(dbu);
  info_.has_output_level = true;
  info_.output_level_dbu = dbu;
}

}  // namespace nam_studio::dsp
