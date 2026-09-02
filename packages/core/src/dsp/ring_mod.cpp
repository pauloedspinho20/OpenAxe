#include "openaxe/dsp/ring_mod.h"

#include <algorithm>
#include <cmath>
#include <vector>

#include "Core/AudioBuffer.h"
#include "Core/AudioSpec.h"
#include "Core/Oversampling.h"

namespace openaxe::dsp {

namespace {

constexpr int kFrequencyParam = 0;
constexpr int kDriveParam = 1;
constexpr int kParamCount = 2;

const DsparkParamInfo kParamInfo[kParamCount] = {
#include "generated/ring_mod_params.inc"
};

constexpr float kFrequencyMin = 20.0f;
constexpr float kFrequencyMax = 2000.0f;
constexpr float kDriveMin = 0.0f;
constexpr float kDriveMax = 1.0f;

constexpr int kChannels = 2;

// Slices whatever the engine hands us so the oversampler's prepared block
// size is respected regardless of the engine's max_block_size.
constexpr int kMaxBlock = 512;

// 4x with the 63-tap half-band pair: ~-60 dB of stopband rejection for 48
// samples (1 ms at 48 kHz) of group delay. Ring modulation puts its products
// at full amplitude, so weak rejection is audible as a hash floor - and 1 ms
// is two orders of magnitude below the 40 ms #268 already rejected.
constexpr int kOversampleFactor = 4;

// Slight asymmetry between the two channels' carriers, so a mono source
// doesn't collapse to a single correlated sideband pair. This is the +/-0.3 rad
// offset the pre-DSPark implementation had; the migration dropped it and the
// golden's stereo correlation went to 1.0 on every stimulus.
constexpr float kCarrierStereoOffset = 0.3f;

constexpr float kTwoPi = 6.28318530717958647692f;

}  // namespace

// Ring modulator: a sine carrier multiplies the input, then a tanh stage adds
// the diode/transformer grit, both evaluated at 4x and filtered back down.
//
// Issue #318 asked whether this block actually aliases audibly before doing
// anything about it. Measured, at the base rate with a 2 kHz carrier: the
// spurious floor sat at -9.2 dBc with drive at maximum, because the sum
// product of any input above (Nyquist - fc) folds straight back into the band
// and the tanh then widens the spectrum further. That is a real defect and it
// is what this file now fixes.
//
// It was briefly migrated to dspark::RingModulator instead. That was reverted,
// measured rather than assumed:
//   - dspark::RingModulator has no oversampling either (processBlock is a bare
//     per-sample multiply), so the folding was unchanged;
//   - its fastSin carrier approximation measured 26.8 dB dirtier than
//     std::sin on a clean carrier (-81.8 dBc total spurious against -108.6);
//   - `soar` - which `drive` had been mapped onto - is only read in the
//     GeometricMean branch, and the wrapper selected Mode::Classic, so the
//     drive knob was a bit-exact no-op (drive 0 vs 1: max sample difference
//     0.000000000).
// Oversampling the hand-rolled stage addresses the actual complaint; the
// library swap did not.
struct RingMod::Impl {
  float params[kParamCount] = {400.0f, 0.3f};

  double sample_rate = 48000.0;
  // Carrier phase in cycles [0,1), advanced at the oversampled rate.
  double phase = 0.0;

  dspark::Oversampling<float> os{kOversampleFactor,
                                 dspark::Oversampling<float>::Quality::Medium};
  // Scratch the oversampler reads from and writes back into, so Process never
  // touches the caller's buffers before the round trip completes.
  std::vector<float> scratch[kChannels];
  float* scratch_ptr[kChannels] = {nullptr, nullptr};

  void Prepare(double sr) {
    sample_rate = sr;
    os.prepare(dspark::AudioSpec{sr, kMaxBlock, kChannels});
    for (int ch = 0; ch < kChannels; ++ch) {
      scratch[ch].assign(static_cast<size_t>(kMaxBlock), 0.0f);
      scratch_ptr[ch] = scratch[ch].data();
    }
    phase = 0.0;
  }
};

RingMod::RingMod() : impl_(std::make_unique<Impl>()) { impl_->Prepare(48000.0); }

RingMod::~RingMod() = default;

void RingMod::Reset(double sample_rate) { impl_->Prepare(sample_rate); }

void RingMod::Process(const float* const* input, float* const* output, int num_frames) {
  if (num_frames <= 0) return;

  const float freq = std::clamp(impl_->params[kFrequencyParam], kFrequencyMin, kFrequencyMax);
  const float drive = std::clamp(impl_->params[kDriveParam], kDriveMin, kDriveMax);
  // Normalised so the knob changes character, not level.
  const float drive_gain = 1.0f + drive * 4.0f;
  const float drive_norm = std::tanh(drive_gain);

  const int factor = impl_->os.getFactor();
  // The carrier advances once per *oversampled* sample.
  const double phase_step = static_cast<double>(freq) / (impl_->sample_rate * factor);

  for (int offset = 0; offset < num_frames; offset += kMaxBlock) {
    const int n = std::min(kMaxBlock, num_frames - offset);

    for (int ch = 0; ch < kChannels; ++ch)
      std::copy_n(input[ch] + offset, n, impl_->scratch[ch].data());

    dspark::AudioBufferView<const float> in_view(
        const_cast<const float* const*>(impl_->scratch_ptr), kChannels, n);
    dspark::AudioBufferView<float> up = impl_->os.upsample(in_view);

    const int up_n = n * factor;
    double phase = impl_->phase;
    for (int i = 0; i < up_n; ++i) {
      const float carrier_l = std::sin(kTwoPi * static_cast<float>(phase));
      const float carrier_r =
          std::sin(kTwoPi * static_cast<float>(phase) + kCarrierStereoOffset);
      float* l = up.getChannel(0);
      float* r = up.getChannel(1);
      // Multiply, then saturate - in that order, so the tanh shapes the
      // modulated signal the way a diode ring does, but at 4x where the
      // products it generates land above the base-rate Nyquist and get
      // filtered out on the way down instead of folding back.
      const float wet_l = l[i] * carrier_l;
      const float wet_r = r[i] * carrier_r;
      l[i] = drive > 0.001f ? std::tanh(wet_l * drive_gain) / drive_norm : wet_l;
      r[i] = drive > 0.001f ? std::tanh(wet_r * drive_gain) / drive_norm : wet_r;
      phase += phase_step;
      if (phase >= 1.0) phase -= 1.0;
    }
    impl_->phase = phase;

    dspark::AudioBufferView<float> out_view(impl_->scratch_ptr, kChannels, n);
    impl_->os.downsample(out_view);

    for (int ch = 0; ch < kChannels; ++ch)
      std::copy_n(impl_->scratch[ch].data(), n, output[ch] + offset);
  }
}

int RingMod::ParamCount() { return kParamCount; }

const RingMod::ParamInfo& RingMod::GetParamInfo(int index) {
  return kParamInfo[static_cast<size_t>(index)];
}

float RingMod::GetParam(int index) const {
  if (index < 0 || index >= kParamCount) return 0.0f;
  return impl_->params[index];
}

// Clamped, not stored raw. The DSPark migration had dropped the clamp, and
// nothing downstream restores it: AudioEngine::SetParam stores what it is
// given, the smoothing ramp uses min/max only for its slew rate, and the C ABI
// does not clamp at all - so automation, a VST3 host or a preset load could
// push the carrier to 30 kHz or negative. The UI knob was the only guard.
void RingMod::SetParam(int index, float value) {
  switch (index) {
    case kFrequencyParam:
      impl_->params[kFrequencyParam] = std::clamp(value, kFrequencyMin, kFrequencyMax);
      break;
    case kDriveParam:
      impl_->params[kDriveParam] = std::clamp(value, kDriveMin, kDriveMax);
      break;
    default:
      break;
  }
}

}  // namespace openaxe::dsp
