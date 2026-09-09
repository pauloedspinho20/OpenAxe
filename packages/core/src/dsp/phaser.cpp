#include "openaxe/dsp/phaser.h"

#include "Effects/Phaser.h"
#include "internal/dspark_wrapper.h"

namespace openaxe::dsp {

namespace {

constexpr int kRateParam = 0;
constexpr int kScriptParam = 1;
constexpr int kParamCount = 2;

// Generated from packages/core/param_schema.json (issue #51) - run
// scripts/gen-param-schema.mjs after editing the schema.
const DsparkParamInfo kParamInfo[kParamCount] = {
#include "generated/phaser_params.inc"
};

// An MXR Phase 90 (the EVH pedal is the same circuit with a Script/Block
// switch) is a 4-stage cascaded-allpass phaser with a single Speed knob: no
// depth, no stage count, no sweep-range controls. The FET stages sweep a
// fixed ~200 Hz-2.8 kHz band - the guitar mids where the two moving notches
// read as a vocal "whoosh" rather than a low-mid wobble - driven by a
// triangle-ish LFO that traverses the band evenly instead of dwelling at the
// extremes the way a sine does. The Script switch selects the feedback
// voicing: Script (vintage script-logo) runs light regeneration for a soft,
// chewy sweep; Block (modern block-logo) runs hotter feedback for sharper,
// more resonant peaks. Deliberately fewer knobs than the previous surface
// (rate/depth/feedback/stages): the fixed voicing is the sound, and the
// dropped params only made it easier to dial in a bad one. `rate` keeps its
// symbol so existing presets keep their speed; depth/feedback/stages keys in
// old presets are ignored (unknown symbols never fail a load).
//
// This intentionally does NOT expose dspark::Phaser's centre/range/waveform/
// spread setters as params (the direction issue #317 originally proposed).
// They are set once in Configure() to the pedal values below - a studio
// phaser with six sweep knobs is a different effect from a Phase 90.
constexpr float kDefaults[kParamCount] = {
    0.5f,  // rate: the EVH sweet spot (slow swirl, ~9 o'clock on the pedal)
    1.0f,  // script: Script voice on (the vintage EVH sound), Block when off
};

// Fixed 4-stage cascade: the Phase 90's four FET allpass sections (two
// notches). Matches the pedal; not a param.
constexpr int kPhase90Stages = 4;

// Fixed sweep endpoints. dspark::Phaser sweeps logMin..logMax geometrically
// at full depth, so these ARE the sweep: 200 Hz-2.8 kHz, ~3.8 octaves centred
// near 750 Hz. Same territory the previous hand-rolled sweep covered
// (175 Hz-2.8 kHz at full depth), now fixed the way the pedal fixes it.
constexpr float kSweepMinHz = 200.0f;
constexpr float kSweepMaxHz = 2800.0f;

// Feedback per Script-switch position. Script runs light regeneration (soft
// notches, the "chewy" vintage sweep); Block runs hotter (sharper peaks, the
// modern aggressive sweep). Both sit well clear of self-oscillation -
// dspark::Phaser additionally soft-clips the loop with fastTanh, the way the
// pedal's FET stages saturate instead of blowing up.
constexpr float kScriptFeedback = 0.3f;
constexpr float kBlockFeedback = 0.6f;

using Waveform = dspark::Oscillator<float>::Waveform;

// The policy DsparkEffect<> needs: param table, defaults, one-time pedal
// voicing, and how each param index maps onto dspark::Phaser's setters.
struct PhaserTraits {
  static constexpr int kParamCount = 2;
  static constexpr const DsparkParamInfo* kInfo = kParamInfo;
  static constexpr const float* kDefaults = openaxe::dsp::kDefaults;

  // One-time pedal voicing, applied on top of dspark::Phaser's own defaults
  // before any param is seeded (the adapter calls Configure() first). All
  // atomic publishes, safe before prepare().
  static void Configure(dspark::Phaser<float>& proc) {
    proc.setStages(kPhase90Stages);
    proc.setLfoWaveform(Waveform::Triangle);
    proc.setFrequencyRange(kSweepMinHz, kSweepMaxHz);
    // Full sweep, always: the pedal has no depth knob, and narrowing the
    // range around the centre is what the old `depth` param did least
    // musically (it parked the notches in the low mids).
    proc.setDepth(1.0f);
    // Mono sweep: the pedal is a mono circuit, and both channels sharing one
    // LFO keeps the stereo image put instead of swirling it. (This also
    // halves the per-sample LFO/coefficient work versus the old per-channel
    // sine - the issue's CPU note, for free.)
    proc.setStereoSpread(0.0f);
    // Wet-only: the engine owns the dry/wet blend via its own mix knob (see
    // phaser.h), so the internal mixer stays fully wet.
    proc.setMix(1.0f);
  }

  static void Apply(dspark::Phaser<float>& proc, const float* values, int index, float value) {
    (void)values;
    switch (index) {
      case kRateParam:
        proc.setRate(value);
        break;
      case kScriptParam:
        // The Script switch is discrete on the pedal; the >= 0.5 threshold
        // keeps it a switch while staying automation-smooth (dspark::Phaser
        // one-pole-smooths feedback internally, so crossing the threshold
        // morphs instead of clicking).
        proc.setFeedback(value >= 0.5f ? kScriptFeedback : kBlockFeedback);
        break;
      default:
        break;
    }
  }
};

}  // namespace

// Pimpl so the vendored dspark:: types stay out of the public header.
struct Phaser::Impl {
  DsparkEffect<dspark::Phaser<float>, PhaserTraits> dsp;
};

Phaser::Phaser() : impl_(std::make_unique<Impl>()) {}
Phaser::~Phaser() = default;

// Re-prepare for a new sample rate (the LFO and smoothing coefficients are
// derived from it) - dspark::Phaser keeps its params across prepare(), so the
// pedal voicing and knob positions survive. Allocates; not real-time safe.
void Phaser::Reset(double sample_rate) { impl_->dsp.Reset(sample_rate); }

// MXR Phase 90 voice: dspark::Phaser's series first-order-allpass chain at 4
// stages, swept by its triangle LFO over the fixed 200 Hz-2.8 kHz band, with
// tanh-saturated feedback per the Script switch. Output is 100%-wet; the
// engine's block staging owns the dry/wet blend. Real-time safe.
void Phaser::Process(const float* const* input, float* const* output, int num_frames) {
  impl_->dsp.Process(input, output, num_frames);
}

// Param surface: rate (Hz, the pedal's Speed knob), script (0 = Block voice,
// 1 = Script voice - the EVH default). Indices are the kParamInfo order,
// which is generated from packages/core/param_schema.json - never
// hand-reorder them.
int Phaser::ParamCount() {
  return DsparkEffect<dspark::Phaser<float>, PhaserTraits>::ParamCount();
}

// Name/symbol/range/unit for one param index.
const Phaser::ParamInfo& Phaser::GetParamInfo(int index) {
  return DsparkEffect<dspark::Phaser<float>, PhaserTraits>::GetParamInfo(index);
}

// Current value of one param, from DsparkEffect's mirror of what it pushed
// into the processor (the vendored types expose no getters).
float Phaser::GetParam(int index) const { return impl_->dsp.GetParam(index); }

// Store one param and push it into the processor. Real-time safe.
void Phaser::SetParam(int index, float value) { impl_->dsp.SetParam(index, value); }

}  // namespace openaxe::dsp
