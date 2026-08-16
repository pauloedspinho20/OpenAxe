#include "nam_studio/dsp/phaser.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

namespace nam_studio::dsp {

namespace {

constexpr int kRateParam = 0;
constexpr int kDepthParam = 1;
constexpr int kFeedbackParam = 2;
constexpr int kStagesParam = 3;
constexpr int kParamCount = 4;

const Phaser::ParamInfo kParamInfo[kParamCount] = {
    {"Rate", "rate", 0.1f, 5.0f, "Hz"},
    {"Depth", "depth", 0.1f, 1.0f, "%"},
    {"Feedback", "feedback", 0.0f, 0.9f, "%"},
    {"Stages", "stages", 2.0f, 8.0f, ""},
};

constexpr int kMaxStages = 8;
constexpr float kLowFreq = 150.0f;       // minimum sweep frequency (Hz)
constexpr float kHighFreq = 3000.0f;     // maximum sweep frequency (Hz)
constexpr float kStereoOffset = 1.57079632679f;  // π/2

struct AllPassStage {
  float x1 = 0.0f;  // previous input
  float y1 = 0.0f;  // previous output

  float Process(float x, float a) {
    const float y = a * x + x1 - a * y1;
    x1 = x;
    y1 = y;
    return y;
  }

  void Reset() {
    x1 = 0.0f;
    y1 = 0.0f;
  }
};

float ComputeCoeff(float freq, float sample_rate) {
  const float w0 = 6.28318530718f * freq / sample_rate;
  const float t = std::tan(w0 * 0.5f);
  return (1.0f - t) / (1.0f + t);
}

struct Channel {
  std::array<AllPassStage, kMaxStages> stages;
  float phase = 0.0f;

  void Reset() {
    for (auto& s : stages) s.Reset();
  }
};

}  // namespace

struct Phaser::Impl {
  std::array<Channel, 2> channels;
  float rate = 0.3f;
  float depth = 0.7f;
  float feedback = 0.5f;
  int stages = 4;
  float sample_rate = 48000.0f;
};

Phaser::Phaser() : impl_(std::make_unique<Impl>()) {}

Phaser::~Phaser() = default;

void Phaser::Reset(double sample_rate) {
  impl_->sample_rate = static_cast<float>(sample_rate);
  for (auto& ch : impl_->channels) ch.Reset();
}

void Phaser::Process(const float* const* input, float* const* output, int num_frames) {
  const float sr = impl_->sample_rate;
  const float fb = impl_->feedback;
  const float depth = impl_->depth;
  const float phase_step = impl_->rate / sr;
  const int num_stages = impl_->stages;
  const float freq_ratio = kHighFreq / kLowFreq;

  for (int ch = 0; ch < 2; ++ch) {
    Channel& chan = impl_->channels[static_cast<size_t>(ch)];
    const float lfo_base = chan.phase + (ch == 1 ? kStereoOffset : 0.0f);
    for (int i = 0; i < num_frames; ++i) {
      const float lfo = std::sin(lfo_base + static_cast<float>(i) * phase_step * 6.28318530718f);
      const float t = 0.5f + 0.5f * lfo;                                    // [0, 1]
      const float freq = kLowFreq * std::pow(freq_ratio, t * depth);        // exponential sweep
      const float a = ComputeCoeff(freq, sr);

      float x = input[ch][i] + fb * chan.stages[static_cast<size_t>(num_stages - 1)].y1;
      for (int s = 0; s < num_stages; ++s) {
        x = chan.stages[static_cast<size_t>(s)].Process(x, a);
      }
      output[ch][i] = x;
    }
    chan.phase = std::fmod(chan.phase + phase_step * static_cast<float>(num_frames) * 6.28318530718f,
                           6.28318530718f);
  }
}

int Phaser::ParamCount() { return kParamCount; }

const Phaser::ParamInfo& Phaser::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}

float Phaser::GetParam(int index) const {
  switch (index) {
    case kRateParam:
      return impl_->rate;
    case kDepthParam:
      return impl_->depth;
    case kFeedbackParam:
      return impl_->feedback;
    case kStagesParam:
      return static_cast<float>(impl_->stages);
    default:
      return 0.0f;
  }
}

void Phaser::SetParam(int index, float value) {
  switch (index) {
    case kRateParam:
      impl_->rate = value;
      break;
    case kDepthParam:
      impl_->depth = value;
      break;
    case kFeedbackParam:
      impl_->feedback = value;
      break;
    case kStagesParam: {
      int stages = std::clamp(static_cast<int>(std::round(value)), 2, kMaxStages);
      if (stages != impl_->stages) {
        impl_->stages = stages;
        for (auto& ch : impl_->channels) ch.Reset();
      }
      break;
    }
    default:
      return;
  }
}

}  // namespace nam_studio::dsp
