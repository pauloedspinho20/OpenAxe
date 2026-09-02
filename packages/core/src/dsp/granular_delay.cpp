#include "openaxe/dsp/granular_delay.h"

#include <algorithm>
#include <cmath>
#include <vector>

#include "Effects/GranularProcessor.h"
#include "internal/dspark_wrapper.h"
#include "internal/variable_delay.h"

namespace openaxe::dsp {

namespace {

constexpr int kTimeParam = 0;
constexpr int kGrainSizeParam = 1;
constexpr int kDensityParam = 2;
constexpr int kPitchParam = 3;
constexpr int kJitterParam = 4;
constexpr int kFeedbackParam = 5;
constexpr int kSpreadParam = 6;
constexpr int kCharacterParam = 7;
constexpr int kFreezeParam = 8;
constexpr int kParamCount = 9;

const DsparkParamInfo kParamInfo[kParamCount] = {
#include "generated/granular_delay_params.inc"
};

// density: dspark spawns `density * grainSize` concurrent grains, so the old
// 8 Hz default against an 80 ms grain gave 0.64 - less than one grain alive at
// a time. Measured at that setting: 37% of output samples were hard zero and
// the block ran 9.9 dB below its input; at the schema minimum of 1 Hz it was
// 92% silence. 25 Hz (dspark's own default) gives an overlap of 2.0 and a
// continuous output.
//
// jitter: dspark's jitter is a random read-back of up to
// jitter * 0.5 * (ringSize - lead) samples, and ringSize is the power of two
// at or above 4 s - so 0.2 scattered grains up to 538 ms into the past and
// pushed the first output of a 300 ms `time` setting out to 912 ms. Defaulting
// to 0 keeps `time` meaning what it says; the knob still reaches the full
// range for anyone who wants the smear.
constexpr float kLocalDefaults[kParamCount] = {
    400.0f,  // time (ms)
    80.0f,   // grain_size (ms)
    25.0f,   // density (Hz)
    0.0f,    // pitch (st)
    0.0f,    // jitter
    0.3f,    // feedback
    0.5f,    // spread
    0.0f,    // character
    0.0f,    // freeze
};

using GranularProc = dspark::GranularProcessor<float>;

struct GranularTraits {
  static constexpr int kParamCount = 9;
  static constexpr const DsparkParamInfo* kInfo = kParamInfo;
  static constexpr const float* kDefaults = kLocalDefaults;
  static void Configure(GranularProc& p) { p.setMix(1.0f); }
  static void Apply(GranularProc& p, const float* v, int, float) {
    p.setGrainSize(v[kGrainSizeParam]);
    p.setDensity(v[kDensityParam]);
    p.setJitter(v[kJitterParam]);
    p.setPitch(v[kPitchParam]);
    p.setSpread(v[kSpreadParam]);
    p.setFreeze(v[kFreezeParam] >= 0.5f);
  }
};

struct OnePoleLP {
  float y = 0.0f;
  float Process(float x, float c) {
    y += c * (x - y);
    return y;
  }
  void Reset() { y = 0.0f; }
};

// Longest delay the schema allows, plus slack for the interpolator.
constexpr float kMaxTimeMs = 2000.0f;

constexpr int kMaxBlock = 512;

}  // namespace

// A delay line whose output is granulated: the line supplies the repeats and
// the regeneration, dspark::GranularProcessor turns each repeat into a grain
// cloud. Issue #321 asked for exactly this shape - migrate the grain engine,
// keep the feedback path, the stereo cross-feed and the `character` lo-fi
// colouring around it, since DSPark has no equivalent for those.
//
// The feedback tap is the one deliberate deviation. A per-sample grain-output
// feedback is not expressible here: GranularProcessor is block-based, so the
// grains for a block are only available after the whole block's delay reads
// have happened, and `time` can be shorter than one block (10 ms = 480 samples
// against a 512-sample block). The line therefore regenerates from its own
// output, and the cloud sits across the loop rather than inside it. Noted
// because granular_delay.h used to claim the opposite.
struct GranularDelay::Impl {
  DsparkEffect<GranularProc, GranularTraits> dsp;
  float time_ms = 400.0f;
  float feedback = 0.3f;
  float character = 0.0f;
  float sr = 48000.0f;

  // Lagrange3 through the shared line, matching what the header claims and
  // what every other modulated delay in the tree uses. The previous version
  // hand-rolled a 2-point linear read while still including lagrange3.h.
  internal::VariableDelay line_l, line_r;
  OnePoleLP lp_l, lp_r;
  float fb_l = 0.0f, fb_r = 0.0f;

  // Pre-allocated: Process used to construct two std::vectors per call, i.e.
  // two heap allocations per render quantum on the audio thread (measured 200
  // allocations across 100 128-frame blocks).
  std::vector<float> temp_l, temp_r;

  void Resize(float s) {
    sr = s;
    line_l.Prepare(s, kMaxTimeMs + 50.0f);
    line_r.Prepare(s, kMaxTimeMs + 50.0f);
    lp_l.Reset();
    lp_r.Reset();
    fb_l = fb_r = 0.0f;
    temp_l.assign(static_cast<size_t>(kMaxBlock), 0.0f);
    temp_r.assign(static_cast<size_t>(kMaxBlock), 0.0f);
  }
};

GranularDelay::GranularDelay() : impl_(std::make_unique<Impl>()) { impl_->Resize(48000.0f); }
GranularDelay::~GranularDelay() = default;

void GranularDelay::Reset(double sr) {
  impl_->Resize(static_cast<float>(sr));
  impl_->dsp.Reset(sr);
}

void GranularDelay::Process(const float* const* in, float* const* out, int n) {
  if (n <= 0) return;
  const float sr = impl_->sr;
  const float fb = impl_->feedback;
  const float character = std::clamp(impl_->character, 0.0f, 1.0f);
  const float spread = std::clamp(impl_->dsp.GetParam(kSpreadParam), 0.0f, 1.0f);
  const float delay_samps = std::max(impl_->time_ms * sr / 1000.0f, 4.0f);
  const bool frozen = impl_->dsp.GetParam(kFreezeParam) >= 0.5f;

  // `character` is the lo-fi repeat colouring: a lowpass in the regeneration
  // path plus a soft saturation, so successive repeats get darker and grittier
  // the way a bucket-brigade line does. The migration had dropped the
  // saturation and left only the filter, which measured a 0.024 max sample
  // difference between character 0 and 1 - the knob had effectively stopped
  // working while its description still promised "saturation and response".
  const float cutoff = 12000.0f - character * 10500.0f;
  const float coeff = 1.0f - std::exp(-6.28318530718f * cutoff / sr);
  const float grit = 1.0f + character * 3.0f;
  const float grit_norm = std::tanh(grit);

  for (int offset = 0; offset < n; offset += kMaxBlock) {
    const int len = std::min(kMaxBlock, n - offset);

    for (int i = 0; i < len; ++i) {
      const float in_l = in[0][offset + i];
      const float in_r = in[1][offset + i];

      const float d_l = impl_->line_l.ReadSamples(delay_samps);
      const float d_r = impl_->line_r.ReadSamples(delay_samps);

      float fb_l = impl_->lp_l.Process(impl_->fb_l, coeff);
      float fb_r = impl_->lp_r.Process(impl_->fb_r, coeff);
      if (character > 0.001f) {
        fb_l = std::tanh(fb_l * grit) / grit_norm;
        fb_r = std::tanh(fb_r * grit) / grit_norm;
      }

      // Stereo cross-feed in the regeneration path, restored: `spread` sends a
      // share of each channel's feedback into the other so the repeats walk
      // across the image instead of staying in their own channel. Issue #321
      // listed keeping this explicitly; the migration had dropped it.
      const float send_l = fb_l * (1.0f - spread * 0.5f) + fb_r * (spread * 0.5f);
      const float send_r = fb_r * (1.0f - spread * 0.5f) + fb_l * (spread * 0.5f);

      if (!frozen) {
        impl_->line_l.Write(in_l + send_l * fb);
        impl_->line_r.Write(in_r + send_r * fb);
      } else {
        // Frozen: keep circulating what is already in the line, at unity, so
        // the held texture neither decays nor takes new input.
        impl_->line_l.Write(d_l);
        impl_->line_r.Write(d_r);
      }

      impl_->temp_l[static_cast<size_t>(i)] = d_l;
      impl_->temp_r[static_cast<size_t>(i)] = d_r;
      impl_->fb_l = d_l;
      impl_->fb_r = d_r;
    }

    const float* tin[2] = {impl_->temp_l.data(), impl_->temp_r.data()};
    float* tout[2] = {out[0] + offset, out[1] + offset};
    impl_->dsp.Process(tin, tout, len);
  }
}

int GranularDelay::ParamCount() { return kParamCount; }

const GranularDelay::ParamInfo& GranularDelay::GetParamInfo(int i) {
  return kParamInfo[static_cast<size_t>(i)];
}

float GranularDelay::GetParam(int i) const {
  switch (i) {
    case kTimeParam: return impl_->time_ms;
    case kGrainSizeParam: return impl_->dsp.GetParam(kGrainSizeParam);
    case kDensityParam: return impl_->dsp.GetParam(kDensityParam);
    case kPitchParam: return impl_->dsp.GetParam(kPitchParam);
    case kJitterParam: return impl_->dsp.GetParam(kJitterParam);
    case kFeedbackParam: return impl_->feedback;
    case kSpreadParam: return impl_->dsp.GetParam(kSpreadParam);
    case kCharacterParam: return impl_->character;
    case kFreezeParam: return impl_->dsp.GetParam(kFreezeParam) >= 0.5f ? 1.0f : 0.0f;
    default: return 0.0f;
  }
}

void GranularDelay::SetParam(int i, float v) {
  switch (i) {
    case kTimeParam: impl_->time_ms = std::clamp(v, 10.0f, kMaxTimeMs); break;
    case kGrainSizeParam: impl_->dsp.SetParam(kGrainSizeParam, std::clamp(v, 10.0f, 500.0f)); break;
    case kDensityParam: impl_->dsp.SetParam(kDensityParam, std::clamp(v, 1.0f, 50.0f)); break;
    case kPitchParam: impl_->dsp.SetParam(kPitchParam, std::clamp(v, -12.0f, 12.0f)); break;
    case kJitterParam: impl_->dsp.SetParam(kJitterParam, std::clamp(v, 0.0f, 1.0f)); break;
    case kFeedbackParam: impl_->feedback = std::clamp(v, 0.0f, 0.9f); break;
    case kSpreadParam: impl_->dsp.SetParam(kSpreadParam, std::clamp(v, 0.0f, 1.0f)); break;
    case kCharacterParam: impl_->character = std::clamp(v, 0.0f, 1.0f); break;
    case kFreezeParam: impl_->dsp.SetParam(kFreezeParam, v >= 0.5f ? 1.0f : 0.0f); break;
    default: break;
  }
}

}  // namespace openaxe::dsp
