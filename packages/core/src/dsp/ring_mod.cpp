#include "openaxe/dsp/ring_mod.h"

#include <algorithm>
#include <cmath>

namespace openaxe::dsp {

namespace {
constexpr int kFrequencyParam = 0;
constexpr int kDriveParam = 1;
constexpr int kParamCount = 2;

const RingMod::ParamInfo kParamInfo[kParamCount] = {
#include "generated/ring_mod_params.inc"
};

inline float SoftClip(float x) { return std::tanh(x); }

}  // namespace

struct RingMod::Impl {
  float frequency = 400.0f;
  float drive = 0.3f;
  float sample_rate = 48000.0f;
  float phase = 0.0f;
};

RingMod::RingMod() : impl_(std::make_unique<Impl>()) {}
RingMod::~RingMod() = default;

void RingMod::Reset(double sample_rate) {
  impl_->sample_rate = static_cast<float>(sample_rate);
  impl_->phase = 0.0f;
}

void RingMod::Process(const float* const* input, float* const* output, int num_frames) {
  const float sr = impl_->sample_rate;
  const float freq = impl_->frequency;
  const float drive = impl_->drive;
  float phase = impl_->phase;
  const float inc = 6.28318530718f * freq / sr;
  // drive scaling: 1 + drive*4 gives up to 5x pre-gain into tanh
  const float drive_gain = 1.0f + drive * 4.0f;

  for (int ch = 0; ch < 2; ++ch) {
    float ph = phase + (ch == 1 ? 0.3f : 0.0f); // slight stereo decorrelation
    for (int i = 0; i < num_frames; ++i) {
      float carrier = std::sin(ph);
      // sine carrier only; vintage diode flavor via drive saturation
      float x = input[ch][i] * carrier;
      if (drive > 0.001f) {
        x = SoftClip(x * drive_gain) / drive_gain * (1.0f + drive * 0.5f);
        // blend drive: at drive 0 it's clean ring mod, at 1 adds saturation
      }
      output[ch][i] = x;
      ph += inc;
      if (ph >= 6.28318530718f) ph -= 6.28318530718f;
    }
  }
  impl_->phase = std::fmod(phase + inc * num_frames, 6.28318530718f);
}

int RingMod::ParamCount() { return kParamCount; }
const RingMod::ParamInfo& RingMod::GetParamInfo(int index) { return kParamInfo[static_cast<size_t>(index)]; }
float RingMod::GetParam(int index) const {
  switch (index) {
    case kFrequencyParam: return impl_->frequency;
    case kDriveParam: return impl_->drive;
    default: return 0.0f;
  }
}
void RingMod::SetParam(int index, float value) {
  switch (index) {
    case kFrequencyParam: impl_->frequency = std::clamp(value, 20.0f, 2000.0f); break;
    case kDriveParam: impl_->drive = std::clamp(value, 0.0f, 1.0f); break;
    default: break;
  }
}

}  // namespace openaxe::dsp
