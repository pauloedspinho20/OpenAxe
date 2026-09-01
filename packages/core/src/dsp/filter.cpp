#include "openaxe/dsp/filter.h"

#include <algorithm>
#include <cmath>
#include <vector>

#include "internal/biquad.h"
#include "internal/envelope_follower.h"
#include "internal/svf_tpt.h"

namespace openaxe::dsp {

namespace {
constexpr int kTypeParam = 0;
constexpr int kFrequencyParam = 1;
constexpr int kQParam = 2;
constexpr int kDriveParam = 3;
constexpr int kSensitivityParam = 4;
constexpr int kModeParam = 5;
constexpr int kLfoRateParam = 6;
constexpr int kParamCount = 7;

const Filter::ParamInfo kParamInfo[kParamCount] = {
#include "generated/filter_params.inc"
};

// 4-pole lowpass: two cascaded TPT SVF sections (issue #268's "ladder").
// Each section is 2nd order with the shared `q` as its resonance, and the
// SVF keeps the response stable up to the Nyquist guard in SvfTPT::SetLowpass.
struct Ladder {
  internal::SvfTPT stage[2];
  void Reset() {
    stage[0].Reset();
    stage[1].Reset();
  }
  void Set(float freq, float qq, float sr) {
    for (auto& st : stage) st.SetLowpass(freq, qq, sr);
  }
  float Process(float x) { return stage[1].ProcessLow(stage[0].ProcessLow(x)); }
};

struct ChannelState {
  internal::Biquad bq;
  Ladder ladder;
  internal::EnvelopeFollower env;
  float lfo_phase = 0.0f;
};

} // namespace

struct Filter::Impl {
  float type = 0; // 0 wah, 1 env, 2 ladder
  float frequency = 800;
  float q = 2.0f;
  float drive = 0.0f;
  float sensitivity = 0.5f;
  float mode = 0; // 0 pedal, 1 env, 2 lfo
  float lfo_rate = 1.0f;
  float sr = 48000;
  ChannelState ch[2];

  void ResetState() {
    for (auto& c : ch) {
      c.bq.Reset();
      c.ladder.Reset();
      c.env.Prepare(sr, 5.0f, 50.0f);
      c.env.Reset();
      c.lfo_phase = 0.0f;
    }
  }
};

Filter::Filter() : impl_(std::make_unique<Impl>()) {}
Filter::~Filter() = default;

void Filter::Reset(double sample_rate) {
  impl_->sr = static_cast<float>(sample_rate);
  impl_->ResetState();
}

void Filter::Process(const float* const* input, float* const* output, int num_frames) {
  const float sr = impl_->sr;
  const int type = static_cast<int>(impl_->type);
  const float base_freq = impl_->frequency;
  const float q = std::clamp(impl_->q, 0.5f, 10.0f);
  const float drive = impl_->drive;
  const float sens = impl_->sensitivity;
  const float lfo_rate = impl_->lfo_rate;
  const int mode = static_cast<int>(impl_->mode);

  for (int ch = 0; ch < 2; ++ch) {
    ChannelState& c = impl_->ch[ch];
    float lfo_phase = c.lfo_phase;

    for (int i = 0; i < num_frames; ++i) {
      const float in = input[ch][i];

      // LFO
      const float lfo = std::sin(lfo_phase);
      lfo_phase += 6.28318530718f * lfo_rate / sr;
      if (lfo_phase >= 6.28318530718f) lfo_phase -= 6.28318530718f;

      // Determine cutoff modulation
      float mod_freq = base_freq;
      if (type == 0) { // Wah: mode selects modulation
        if (mode == 1) { // envelope
          mod_freq = 350.0f + c.env.Process(in) * sens * 1850.0f;
        } else if (mode == 2) { // lfo
          mod_freq = base_freq + lfo * 600.0f * sens;
        } else { // pedal: base_freq directly (expression pedal drives frequency param)
          mod_freq = base_freq;
        }
      } else if (type == 1) { // Envelope filter always env driven
        mod_freq = 350.0f + c.env.Process(in) * sens * 1850.0f;
        if (mode == 2) mod_freq += lfo * 300.0f;
      }
      mod_freq = std::clamp(mod_freq, 20.0f, 5000.0f);

      // Apply drive saturation pre-filter
      float driven = in;
      if (drive > 0.001f) {
        driven = std::tanh(driven * (1.0f + drive * 4.0f));
      }

      float out;
      if (type == 2) { // ladder lowpass
        c.ladder.Set(mod_freq, q, sr);
        out = c.ladder.Process(driven);
      } else {
        // Wah/Envelope as bandpass; biquad per-sample is inherent to wah
        c.bq.SetBandpass(mod_freq, q, sr);
        out = c.bq.Process(driven);
      }
      output[ch][i] = out;
    }
    c.lfo_phase = lfo_phase;
  }
}

int Filter::ParamCount() { return kParamCount; }
const Filter::ParamInfo& Filter::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}
float Filter::GetParam(int index) const {
  switch (index) {
    case kTypeParam: return impl_->type;
    case kFrequencyParam: return impl_->frequency;
    case kQParam: return impl_->q;
    case kDriveParam: return impl_->drive;
    case kSensitivityParam: return impl_->sensitivity;
    case kModeParam: return impl_->mode;
    case kLfoRateParam: return impl_->lfo_rate;
    default: return 0;
  }
}
void Filter::SetParam(int index, float value) {
  switch (index) {
    case kTypeParam: impl_->type = std::clamp(std::round(value), 0.0f, 2.0f); break;
    case kFrequencyParam: impl_->frequency = std::clamp(value, 350.0f, 2200.0f); break;
    case kQParam: impl_->q = std::clamp(value, 0.5f, 10.0f); break;
    case kDriveParam: impl_->drive = std::clamp(value, 0.0f, 1.0f); break;
    case kSensitivityParam: impl_->sensitivity = std::clamp(value, 0.0f, 1.0f); break;
    case kModeParam: impl_->mode = std::clamp(std::round(value), 0.0f, 2.0f); break;
    case kLfoRateParam: impl_->lfo_rate = std::clamp(value, 0.1f, 10.0f); break;
    default: break;
  }
}

} // namespace openaxe::dsp