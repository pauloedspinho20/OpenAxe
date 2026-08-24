#include "openaxe/dsp/pitch_shifter.h"

#include <algorithm>
#include <cmath>
#include <vector>

#include "internal/lagrange3.h"

namespace openaxe::dsp {

namespace {
constexpr int kModeParam = 0;
constexpr int kPitchParam = 1;
constexpr int kDetuneParam = 2;
constexpr int kParamCount = 3;

// Crossfade pitch shifter (Eventide-style, issue #268). A single read head
// advances at `pitch_factor` samples per sample relative to the write head;
// the lag between them therefore drifts by (1 - pitch_factor) per sample.
// When the lag leaves [min_lag, max_lag] the head is jumped back by one grain
// and the discontinuity is masked by a raised-cosine crossfade to a second,
// post-jump head that runs alongside it for the next grain. Unity pitch never
// jumps, so a 0-st whammy is an exact ~30 ms delay, not a granular warble.
// RT-safe: Process allocates nothing.
constexpr float kGrainMs = 30.0f;
constexpr float kMinLagMs = 5.0f;

struct Voice {
  // Primary read head, as a lag (samples) behind the write head.
  float lag = 0.0f;
  // Secondary head used during a crossfade.
  float lag2 = 0.0f;
  // Fade progress in samples; >= kGrainMs means no crossfade is active.
  float fade = kGrainMs;
};

const PitchShifter::ParamInfo kParamInfo[kParamCount] = {
#include "generated/pitch_shifter_params.inc"
};

} // namespace

struct PitchShifter::Impl {
  float mode = 1; // 0 detune, 1 whammy
  float pitch = 0; // semitones
  float detune_cents = 5;
  float sr = 48000;
  std::vector<float> buf[2];
  int buf_size = 0;
  struct ChannelState {
    int write_pos = 0;
    Voice voices[2]; // whammy uses [0]; detune uses both, ±cents
  } ch[2];
  float grain_samps = 0.0f;
  float min_lag = 0.0f;

  void Resize(float s) {
    sr = s;
    buf_size = static_cast<int>(s * 2.5f) + 2048;
    grain_samps = kGrainMs * s / 1000.0f;
    min_lag = kMinLagMs * s / 1000.0f;
    for (int c = 0; c < 2; ++c) {
      buf[c].assign(static_cast<size_t>(buf_size), 0.0f);
      ch[c].write_pos = 0;
      for (auto& v : ch[c].voices) {
        v.lag = 0.03f * s;
        v.lag2 = v.lag;
        v.fade = grain_samps;
      }
    }
  }

  // Lagrange3-interpolated fractional read at `pos` samples behind-or-ahead of
  // the write head (negative positions wrap forward, i.e. read history).
  float Read(int channel, float pos) const {
    return internal::ReadLagrange3(buf[channel], pos);
  }
};

PitchShifter::PitchShifter() : impl_(std::make_unique<Impl>()) { impl_->Resize(48000); }
PitchShifter::~PitchShifter() = default;

void PitchShifter::Reset(double sample_rate) {
  impl_->Resize(static_cast<float>(sample_rate));
}

void PitchShifter::Process(const float* const* input, float* const* output, int num_frames) {
  const float sr = impl_->sr;
  const int mode = static_cast<int>(impl_->mode);
  const float grain = impl_->grain_samps;
  const float min_lag = impl_->min_lag;
  const float max_lag = min_lag + grain;

  // Whammy: one voice at `pitch` semitones. Detune: two voices at ±`cents`,
  // which is a genuine pitch offset (not an LFO-modulated delay).
  const float whammy_factor = std::pow(2.0f, impl_->pitch / 12.0f);
  const float detune_factor = std::pow(2.0f, impl_->detune_cents / 1200.0f);
  const float factors[2] = {detune_factor, 1.0f / detune_factor};

  for (int c = 0; c < 2; ++c) {
    auto& buf = impl_->buf[c];
    auto& st = impl_->ch[c];
    const int voice_count = (mode == 0) ? 2 : 1;

    for (int i = 0; i < num_frames; ++i) {
      buf[st.write_pos] = input[c][i];

      float out = 0.0f;
      for (int v = 0; v < voice_count; ++v) {
        const float factor = (mode == 0) ? factors[v] : whammy_factor;
        Voice& voice = st.voices[v];

        // Write head advances 1, read head advances `factor`, so the lag
        // changes by (1 - factor) per sample. Bounded, so rphase-style
        // float stall (issue #268 review) is impossible by construction.
        voice.lag += 1.0f - factor;
        const bool fading = voice.fade < grain;
        if (fading) voice.lag2 += 1.0f - factor;

        // Keep the read head inside [min_lag, max_lag]; jump and crossfade.
        if (factor >= 1.0f && voice.lag < min_lag) {
          if (!fading) voice.lag2 = voice.lag;
          voice.lag += grain;
          voice.fade = 0.0f;
        } else if (factor < 1.0f && voice.lag > max_lag) {
          if (!fading) voice.lag2 = voice.lag;
          voice.lag -= grain;
          voice.fade = 0.0f;
        }

        float s = impl_->Read(c, static_cast<float>(st.write_pos) - voice.lag);
        if (voice.fade < grain) {
          // Raised-cosine crossfade: old head out, new head in. Both heads are
          // windowed to ~0 at their jump, so the ~30 ms handoff is click-free.
          const float u = voice.fade / grain;
          const float w_old = 0.5f + 0.5f * std::cos(3.14159265359f * u);
          const float w_new = 1.0f - w_old;
          const float s_old = impl_->Read(c, static_cast<float>(st.write_pos) - voice.lag2);
          s = s_old * w_old + s * w_new;
          voice.fade += 1.0f;
          if (voice.fade >= grain) voice.fade = grain;
        }
        out += s;
      }
      if (mode == 0) out *= 0.5f; // two detune voices sum to ~unity

      output[c][i] = out;
      st.write_pos = (st.write_pos + 1) % impl_->buf_size;
    }
  }
}

int PitchShifter::ParamCount() { return kParamCount; }
const PitchShifter::ParamInfo& PitchShifter::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}
float PitchShifter::GetParam(int index) const {
  switch (index) {
    case kModeParam: return impl_->mode;
    case kPitchParam: return impl_->pitch;
    case kDetuneParam: return impl_->detune_cents;
    default: return 0;
  }
}
void PitchShifter::SetParam(int index, float value) {
  switch (index) {
    case kModeParam: impl_->mode = std::clamp(std::round(value), 0.0f, 1.0f); break;
    case kPitchParam: impl_->pitch = std::clamp(value, -12.0f, 12.0f); break;
    case kDetuneParam: impl_->detune_cents = std::clamp(value, -15.0f, 15.0f); break;
    default: break;
  }
}

} // namespace openaxe::dsp