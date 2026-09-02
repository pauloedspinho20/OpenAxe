#include "openaxe/engine.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <mutex>
#include <span>
#include <system_error>
#include <type_traits>
#include <unordered_set>
#include <variant>

// Which block kinds this build contains is decided by
// packages/core/effects.config.json (issue #313); enabled_blocks.h turns
// that into the OPENAXE_BLOCK_* macros guarding every call site below, and
// generated/block_sources.cmake decides what reaches the compiler at all.
#include "openaxe/generated/enabled_blocks.h"
#if OPENAXE_BLOCK_CHORUS_COMPILED
#include "openaxe/dsp/chorus.h"
#endif
#include "openaxe/dsp/convolver.h"
#if OPENAXE_BLOCK_COMPRESSOR_COMPILED
#include "openaxe/dsp/compressor.h"
#endif
#if OPENAXE_BLOCK_DELAY_COMPILED
#include "openaxe/dsp/delay.h"
#endif
#if OPENAXE_BLOCK_REVERB_COMPILED
#include "openaxe/dsp/dragonfly_early_reflections.h"
#endif
#if OPENAXE_BLOCK_REVERB_COMPILED
#include "openaxe/dsp/dragonfly_hall_reverb.h"
#endif
#if OPENAXE_BLOCK_REVERB_COMPILED
#include "openaxe/dsp/dragonfly_plate_reverb.h"
#endif
#if OPENAXE_BLOCK_REVERB_COMPILED
#include "openaxe/dsp/dragonfly_room_reverb.h"
#endif
#if OPENAXE_BLOCK_EQ_COMPILED
#include "openaxe/dsp/equalizer.h"
#endif
#if OPENAXE_BLOCK_FILTER_COMPILED
#include "openaxe/dsp/filter.h"
#endif
#if OPENAXE_BLOCK_FLANGER_COMPILED
#include "openaxe/dsp/flanger.h"
#endif
#if OPENAXE_BLOCK_GRANULAR_DELAY_COMPILED
#include "openaxe/dsp/granular_delay.h"
#endif
#if OPENAXE_BLOCK_NOISE_GATE_COMPILED
#include "openaxe/dsp/noise_gate.h"
#endif
#if OPENAXE_BLOCK_PHASER_COMPILED
#include "openaxe/dsp/phaser.h"
#endif
#if OPENAXE_BLOCK_PITCH_SHIFTER_COMPILED
#include "openaxe/dsp/pitch_shifter.h"
#endif
#if OPENAXE_BLOCK_RING_MOD_COMPILED
#include "openaxe/dsp/ring_mod.h"
#endif
#if OPENAXE_BLOCK_ROTARY_COMPILED
#include "openaxe/dsp/rotary.h"
#endif
#include "openaxe/dsp/smoothing.h"
#include "openaxe/dsp/tone_stack.h"
#if OPENAXE_BLOCK_TREMOLO_COMPILED
#include "openaxe/dsp/tremolo.h"
#endif
#include "openaxe/dsp/wav.h"

namespace openaxe::engine {
namespace {

// Largest ParamCount() among the wrapped DSP families (DragonflyHallReverb's
// 18) - every block gets a fixed-size atomic param array this big regardless
// of kind, so BlockState never needs to resize a container of atomics
// (std::atomic isn't move/copy-constructible, so a resizable one is awkward
// for no benefit here - 18 floats per block is nothing).
constexpr int kMaxParamsPerBlock = 18;

constexpr int kAmpInputLevelParam = 0;
constexpr int kAmpOutputLevelParam = 1;
constexpr int kAmpSlimSizeParam = 2;
// The 4-band tone stack the engine runs after the model - contiguous so
// Process() can loop them (see ApplyRealtimeParams).
constexpr int kAmpBassParam = 3;
constexpr int kAmpToneBandCount = 4;
// Every amp-family block exposes the same 7: two calibration values, slim size,
// and the four tone bands. Fixed rather than growing with the loaded model -
// whether slim size does anything is a property of the capture
// (openaxe_block_model_info reports it), not of the param surface.
constexpr int kAmpParamCount = 7;

// Cab blocks: a single wet/dry blend over the convolved signal. 1 = fully wet
// (the IR alone), which is what a cabinet normally wants and what the web app's
// ConvolverNode wiring defaulted to.
constexpr int kCabMixParam = 0;
constexpr int kCabParamCount = 1;

// Mixer blocks expose per-input level and stereo pan for each of their
// kMixerInputCount independent input jacks (interleaved: in{p}_level at p*2,
// in{p}_pan at p*2+1), applied before the ports are summed into port 0 - the
// core replacement for the web MixerBlock's per-input GainNode + StereoPanner.
constexpr int kMixerParamsPerInput = 2;
constexpr int kMixerParamCount = graph::kMixerInputCount * kMixerParamsPerInput;


// ── Engine-level wet/dry mix (hybrid dry/wet, issue #263) ─────────────────
// The 8 wet-only effects below are 100% wet out of their DSP; the engine owns
// a single 0..1 mix that blends dry input with wet output post-DSP. Compressor,
// reverb and cab keep their native mix params and are excluded. Stored as the
// last param index for the kind, so ParamInfo/GetParam/SetParam see it as a
// regular param and automation/presets persist it without engine-specific API.
inline bool NeedsEngineMix(graph::BlockKind kind) {
  switch (kind) {
#if OPENAXE_BLOCK_NOISE_GATE_COMPILED
    case graph::BlockKind::kNoiseGate:
#endif
#if OPENAXE_BLOCK_EQ_COMPILED
    case graph::BlockKind::kEq:
#endif
#if OPENAXE_BLOCK_CHORUS_COMPILED
    case graph::BlockKind::kChorus:
#endif
#if OPENAXE_BLOCK_FLANGER_COMPILED
    case graph::BlockKind::kFlanger:
#endif
#if OPENAXE_BLOCK_PHASER_COMPILED
    case graph::BlockKind::kPhaser:
#endif
#if OPENAXE_BLOCK_TREMOLO_COMPILED
    case graph::BlockKind::kTremolo:
#endif
#if OPENAXE_BLOCK_DELAY_COMPILED
    case graph::BlockKind::kDelay:
#endif
#if OPENAXE_BLOCK_RING_MOD_COMPILED
    case graph::BlockKind::kRingMod:
#endif
#if OPENAXE_BLOCK_FILTER_COMPILED
    case graph::BlockKind::kFilter:
#endif
#if OPENAXE_BLOCK_PITCH_SHIFTER_COMPILED
    case graph::BlockKind::kPitchShifter:
#endif
#if OPENAXE_BLOCK_GRANULAR_DELAY_COMPILED
    case graph::BlockKind::kGranularDelay:
#endif
#if OPENAXE_BLOCK_ROTARY_COMPILED
    case graph::BlockKind::kRotary:
#endif
      return true;
    default:
      return false;
  }
}
inline int DspParamCountFor(graph::BlockKind kind) {
  switch (kind) {
#if OPENAXE_BLOCK_NOISE_GATE_COMPILED
    case graph::BlockKind::kNoiseGate: return dsp::NoiseGate::ParamCount();
#endif
#if OPENAXE_BLOCK_EQ_COMPILED
    case graph::BlockKind::kEq: return dsp::Equalizer::ParamCount();
#endif
#if OPENAXE_BLOCK_CHORUS_COMPILED
    case graph::BlockKind::kChorus: return dsp::Chorus::ParamCount();
#endif
#if OPENAXE_BLOCK_FLANGER_COMPILED
    case graph::BlockKind::kFlanger: return dsp::Flanger::ParamCount();
#endif
#if OPENAXE_BLOCK_PHASER_COMPILED
    case graph::BlockKind::kPhaser: return dsp::Phaser::ParamCount();
#endif
#if OPENAXE_BLOCK_TREMOLO_COMPILED
    case graph::BlockKind::kTremolo: return dsp::Tremolo::ParamCount();
#endif
#if OPENAXE_BLOCK_DELAY_COMPILED
    case graph::BlockKind::kDelay: return dsp::Delay::ParamCount();
#endif
#if OPENAXE_BLOCK_RING_MOD_COMPILED
    case graph::BlockKind::kRingMod: return dsp::RingMod::ParamCount();
#endif
#if OPENAXE_BLOCK_FILTER_COMPILED
    case graph::BlockKind::kFilter: return dsp::Filter::ParamCount();
#endif
#if OPENAXE_BLOCK_PITCH_SHIFTER_COMPILED
    case graph::BlockKind::kPitchShifter: return dsp::PitchShifter::ParamCount();
#endif
#if OPENAXE_BLOCK_GRANULAR_DELAY_COMPILED
    case graph::BlockKind::kGranularDelay: return dsp::GranularDelay::ParamCount();
#endif
#if OPENAXE_BLOCK_ROTARY_COMPILED
    case graph::BlockKind::kRotary: return dsp::Rotary::ParamCount();
#endif
    default: return 0;
  }
}
inline int EngineMixIndexFor(graph::BlockKind kind) {
  return DspParamCountFor(kind);  // mix is appended after the DSP's table
}
constexpr dsp::ParamSmoothing kEngineMixSmoothing{dsp::SmoothingMode::kExponential, 0.03f, 0.0f, 1.0f};
constexpr ParamDescriptor kEngineMixDescriptor{"Mix", "mix", 0.0f, 1.0f, "x"};
constexpr dsp::ParamSmoothing kEngineLevelSmoothing{dsp::SmoothingMode::kExponential, 0.03f, 0.0f, 1.5f};
constexpr ParamDescriptor kEngineLevelDescriptor{"Level", "level", 0.0f, 1.5f, "x"};
inline bool NeedsEngineLevel(graph::BlockKind kind) {
#if OPENAXE_BLOCK_DELAY_COMPILED
  if (kind == graph::BlockKind::kDelay) return true;
#endif
  (void)kind;
  return false;
}
inline int EngineLevelIndexFor(graph::BlockKind kind) {
  return DspParamCountFor(kind) + 1; // after mix
}

// The five block kinds backed by a NAM capture. They are structurally
// identical - only the UI's gear category and labelling differ - so everything
// model-related in this file keys off this rather than a specific kind.
bool IsAmpFamily(graph::BlockKind kind) {
  switch (kind) {
    case graph::BlockKind::kAmp:
    case graph::BlockKind::kAmpCab:
    case graph::BlockKind::kPedal:
    case graph::BlockKind::kOutboard:
    case graph::BlockKind::kSpace:
      return true;
    default:
      return false;
  }
}

// How many independent input ports a kind exposes. Only the mixer has more
// than one; several *outputs* are edges from a block's single output, so
// it needs no extra buffers.
int PortCountFor(graph::BlockKind kind) {
  return kind == graph::BlockKind::kMixer ? graph::kMixerInputCount : 1;
}

// Send/Return pairs (issue #274). A Send N relays its single input straight
// through into the implicit link; a Return N relays that link's signal out to
// cables. Neither has DSP, params or bypass - both are std::monostate
// passthrough blocks whose only quirk is that the routing layer links the pair.
bool IsSendKind(graph::BlockKind kind) {
  return kind == graph::BlockKind::kSend1 || kind == graph::BlockKind::kSend2;
}
bool IsReturnKind(graph::BlockKind kind) {
  return kind == graph::BlockKind::kReturn1 || kind == graph::BlockKind::kReturn2;
}
// The other half of a send/return pair, or nullopt for any other kind.
std::optional<graph::BlockKind> SendReturnPairOf(graph::BlockKind kind) {
  switch (kind) {
    case graph::BlockKind::kSend1: return graph::BlockKind::kReturn1;
    case graph::BlockKind::kReturn1: return graph::BlockKind::kSend1;
    case graph::BlockKind::kSend2: return graph::BlockKind::kReturn2;
    case graph::BlockKind::kReturn2: return graph::BlockKind::kSend2;
    default: return std::nullopt;
  }
}

// The closed set of DSP objects a block can hold. std::monostate is a block
// with no DSP at all (cab/mixer, or an amp with no model loaded yet),
// which Process() treats as passthrough. A variant rather than virtual
// dispatch: every alternative is known here, so RunDsp's std::visit inlines
// instead of paying an indirect call per block per buffer.
// A kind compiled out by effects.config.json drops its alternative here too -
// in that build its type does not exist. The variant is only ever reached
// through std::visit, so shrinking it changes nothing for the kinds that stay.
using DspVariant = std::variant<std::monostate, dsp::NamAmp
#if OPENAXE_BLOCK_REVERB_COMPILED
                                , dsp::DragonflyHallReverb, dsp::DragonflyRoomReverb
                                , dsp::DragonflyPlateReverb, dsp::DragonflyEarlyReflections
#endif
#if OPENAXE_BLOCK_NOISE_GATE_COMPILED
                                , dsp::NoiseGate
#endif
#if OPENAXE_BLOCK_COMPRESSOR_COMPILED
                                , dsp::Compressor
#endif
#if OPENAXE_BLOCK_EQ_COMPILED
                                , dsp::Equalizer
#endif
#if OPENAXE_BLOCK_CHORUS_COMPILED
                                , dsp::Chorus
#endif
#if OPENAXE_BLOCK_FLANGER_COMPILED
                                , dsp::Flanger
#endif
#if OPENAXE_BLOCK_PHASER_COMPILED
                                , dsp::Phaser
#endif
#if OPENAXE_BLOCK_TREMOLO_COMPILED
                                , dsp::Tremolo
#endif
#if OPENAXE_BLOCK_DELAY_COMPILED
                                , dsp::Delay
#endif
#if OPENAXE_BLOCK_RING_MOD_COMPILED
                                , dsp::RingMod
#endif
#if OPENAXE_BLOCK_FILTER_COMPILED
                                , dsp::Filter
#endif
#if OPENAXE_BLOCK_PITCH_SHIFTER_COMPILED
                                , dsp::PitchShifter
#endif
#if OPENAXE_BLOCK_GRANULAR_DELAY_COMPILED
                                , dsp::GranularDelay
#endif
#if OPENAXE_BLOCK_ROTARY_COMPILED
                                , dsp::Rotary
#endif
                                >;

// Per-param smoothing policies, generated from param_schema.json by
// scripts/gen-param-schema.mjs (issue #122). These are the schema-derived,
// runtime-immutable ramp descriptors; the live, per-block ramp *state* lives in
// BlockState::smoothed and is re-seeded from these tables whenever the block's
// param surface changes (AddBlock / reverb algorithm switch / model load).
//
// kNone params snap to their target each block (discrete/enum/selector params,
// and the Dragonfly reverbs, which already smooth internally - double-smoothing
// those would just waste the ramp). kExponential/kLinear params ramp toward the
// target the host/UI wrote into the atomic mirror.
constexpr dsp::ParamSmoothing kAmpSmoothing[] = {
#include "dsp/generated/engine_amp_smoothing.inc"
};
constexpr dsp::ParamSmoothing kCabSmoothing[] = {
#include "dsp/generated/engine_cab_smoothing.inc"
};
constexpr dsp::ParamSmoothing kMixerSmoothing[] = {
#include "dsp/generated/engine_mixer_smoothing.inc"
};
#if OPENAXE_BLOCK_COMPRESSOR_COMPILED
constexpr dsp::ParamSmoothing kCompressorSmoothing[] = {
#include "dsp/generated/compressor_smoothing.inc"
};
#endif
#if OPENAXE_BLOCK_EQ_COMPILED
constexpr dsp::ParamSmoothing kEqualizerSmoothing[] = {
#include "dsp/generated/equalizer_smoothing.inc"
};
#endif
#if OPENAXE_BLOCK_NOISE_GATE_COMPILED
constexpr dsp::ParamSmoothing kNoiseGateSmoothing[] = {
#include "dsp/generated/noise_gate_smoothing.inc"
};
#endif
#if OPENAXE_BLOCK_CHORUS_COMPILED
constexpr dsp::ParamSmoothing kChorusSmoothing[] = {
#include "dsp/generated/chorus_smoothing.inc"
};
#endif
#if OPENAXE_BLOCK_FLANGER_COMPILED
constexpr dsp::ParamSmoothing kFlangerSmoothing[] = {
#include "dsp/generated/flanger_smoothing.inc"
};
#endif
#if OPENAXE_BLOCK_PHASER_COMPILED
constexpr dsp::ParamSmoothing kPhaserSmoothing[] = {
#include "dsp/generated/phaser_smoothing.inc"
};
#endif
#if OPENAXE_BLOCK_TREMOLO_COMPILED
constexpr dsp::ParamSmoothing kTremoloSmoothing[] = {
#include "dsp/generated/tremolo_smoothing.inc"
};
#endif
#if OPENAXE_BLOCK_DELAY_COMPILED
constexpr dsp::ParamSmoothing kDelaySmoothing[] = {
#include "dsp/generated/delay_smoothing.inc"
};
#endif
#if OPENAXE_BLOCK_REVERB_COMPILED
constexpr dsp::ParamSmoothing kDragonflyHallReverbSmoothing[] = {
#include "dsp/generated/dragonfly_hall_reverb_smoothing.inc"
};
#endif
#if OPENAXE_BLOCK_REVERB_COMPILED
constexpr dsp::ParamSmoothing kDragonflyRoomReverbSmoothing[] = {
#include "dsp/generated/dragonfly_room_reverb_smoothing.inc"
};
#endif
#if OPENAXE_BLOCK_REVERB_COMPILED
constexpr dsp::ParamSmoothing kDragonflyPlateReverbSmoothing[] = {
#include "dsp/generated/dragonfly_plate_reverb_smoothing.inc"
};
#endif
#if OPENAXE_BLOCK_REVERB_COMPILED
constexpr dsp::ParamSmoothing kDragonflyEarlyReflectionsSmoothing[] = {
#include "dsp/generated/dragonfly_early_reflections_smoothing.inc"
};
#endif
#if OPENAXE_BLOCK_RING_MOD_COMPILED
constexpr dsp::ParamSmoothing kRingModSmoothing[] = {
#include "dsp/generated/ring_mod_smoothing.inc"
};
#endif
#if OPENAXE_BLOCK_FILTER_COMPILED
constexpr dsp::ParamSmoothing kFilterSmoothing[] = {
#include "dsp/generated/filter_smoothing.inc"
};
#endif
#if OPENAXE_BLOCK_PITCH_SHIFTER_COMPILED
constexpr dsp::ParamSmoothing kPitchShifterSmoothing[] = {
#include "dsp/generated/pitch_shifter_smoothing.inc"
};
#endif
#if OPENAXE_BLOCK_GRANULAR_DELAY_COMPILED
constexpr dsp::ParamSmoothing kGranularDelaySmoothing[] = {
#include "dsp/generated/granular_delay_smoothing.inc"
};
#endif
#if OPENAXE_BLOCK_ROTARY_COMPILED
constexpr dsp::ParamSmoothing kRotarySmoothing[] = {
#include "dsp/generated/rotary_smoothing.inc"
};
#endif

}  // namespace

// Every placeable block's live state: which DSP object (if any) backs it,
// the atomic param mirror Process() applies from, and its pre-allocated
// scratch buffers. Kept as a heap-allocated, never-moved object (owned via
// unique_ptr in block_states_) specifically so DspVariant's alternatives
// (NamAmp, DragonflyHallReverb, ...) never need to be move/copy-constructed
// - both delete their copy ops and neither declares a move op, so a variant
// holding them can only ever be constructed in place (emplace), never moved.
struct AudioEngine::BlockState {
  graph::BlockKind kind = graph::BlockKind::kReverb;
  DspVariant dsp;
  // Logical param count; dynamic for Amp-family blocks (grows on model load)
  // and for the per-algorithm reverb tables. Atomic because SetParam/
  // GetParam/ParamInfo read it for bounds checks from threads that may run
  // concurrently with the Tier-2 writes that change it (the desktop webview
  // thread vs the control thread's model/algorithm swaps - issue #211); the
  // audio thread reads it through the same atomics in Process().
  std::atomic<int> param_count{0};
  std::array<std::atomic<float>, kMaxParamsPerBlock> params{};

  // ── Threading discipline for the plain fields below (issue #211) ──────
  // `dsp`, `smoothing[]`, `smoothed[]`, `ramp_*`, `tone`, `cab` and the
  // per-block buffers are written by the control thread ONLY under the
  // Tier-2 protocol (no Process() running) and read by Process() on the audio
  // thread; Process() never writes them concurrently with a control-thread
  // write. `kind` is set once at AddBlock and never changes. The asset-source
  // strings/bytes are control-thread data Process() never reads. The atomics
  // (params, trims, bypass, meter, the amp calibration gates, param_count,
  // reverb_control_slots) are the only fields shared across threads without
  // the protocol.

  // Reverb blocks only (issue #211): the resolved (param index, clamp range)
  // for each user-facing ReverbControl under the currently installed
  // algorithm. Refreshed by RefreshReverbControlSlots under the Tier-2
  // protocol; read by SetReverbControl from any thread - including the audio
  // thread on the web - without touching the live DspVariant, which is never
  // safely readable concurrently with an emplace. index < 0 = this algorithm
  // doesn't expose the control (a no-op).
  struct ReverbControlSlot {
    std::atomic<int32_t> index{-1};
    std::atomic<float> min{0.0f};
    std::atomic<float> max{0.0f};
  };
  std::array<ReverbControlSlot, kReverbControlCount> reverb_control_slots{};

  // Smoothing policy per param (schema-derived, immutable at runtime) and the
  // live ramp state the audio thread advances. `smoothed[i]` is the value
  // actually fed to the DSP / scalar multiply this sub-block - it eases toward
  // params[i] (the atomic target a UI/host wrote) per issue #122's ramp. Plain
  // float, not atomic: only Process() touches it, and it is re-seeded from the
  // policy + the param mirror on the control thread (AddBlock / reverb switch /
  // model load) so the first block after a change never sweeps from zero. The
  // control-thread seeding happens under the Tier-2 protocol, so it never
  // races the audio thread's advances (issue #211).
  std::array<dsp::ParamSmoothing, kMaxParamsPerBlock> smoothing{};
  // Live ramp state for issue #122. Held as double (not float) so the one-pole
  // ramp can actually reach its target: a float32 accumulator stalls ~1 ULP
  // before the value (e.g. at ~4e-5 from 0.5) because the per-sample step
  // rounds to zero, which would make "sample-accurate smoothing" never settle.
  std::array<double, kMaxParamsPerBlock> smoothed{};


  // Amp-family only: whether the input/output-level "param" should actually
  // be reasserted onto the live NamAmp each Process() call. Without this,
  // ApplyRealtimeParams would unconditionally call NamAmp::SetInputLevel(0)
  // on every block that never had a calibration override, which - because
  // SetInputLevel unconditionally flips NamAmp's own has_input_level to true
  // - would silently fabricate a calibration value for models that never
  // defined one. Only true once the loaded model itself defines that level,
  // or the caller explicitly set it via engine-level SetParam.
  std::atomic<bool> amp_input_level_active{false};
  std::atomic<bool> amp_output_level_active{false};

  // Real-time safe: when true, Process() skips ApplyRealtimeParams/RunDsp
  // for this block entirely and passes port-0 input straight to output.
  std::atomic<bool> bypassed{false};

  // Per-block I/O staging gain (see SetInputTrim). Unity by default, and
  // Process() skips the multiply entirely at exactly 1.0f so an untouched
  // block costs nothing.
  std::atomic<float> input_trim{1.0f};
  std::atomic<float> output_trim{1.0f};

  // Amp-family only: the 4-band tone stack that runs after the model, driven
  // from the bass/mid/treble/presence params. Held here rather than inside
  // DspVariant because it is not an alternative to NamAmp - it is always in
  // series with one (and it stays flat, and free, until a knob moves).
  dsp::ToneStack tone;

  // Cab blocks only: one convolver per channel (the IR is mono, but the two
  // channels carry independent audio and so need independent tails). Same
  // reasoning as the tone stack for living here rather than in DspVariant - a
  // cab is convolution plus a dry blend, not a single DSP object.
  std::array<dsp::Convolver, 2> cab;

  // ── Asset-source retention (issue #120) ────────────────────────────────
  // What a saved rig needs so it can carry its own assets. The IR keeps its
  // original WAV bytes (a synthesized one when the caller installed raw
  // samples); both families keep whatever display name / source path travelled
  // with the asset. Costs a few MB per loaded model - traded deliberately for
  // a serialized rig that restores self-contained on a machine that has never
  // seen the files.
  std::vector<uint8_t> ir_source_wav;  // cab only
  std::string model_name;              // amp family: explicit name, may be empty
  std::string model_path;              // amp family: source path, empty for JSON loads
  std::string ir_name;                 // cab
  std::string ir_path;                 // cab

  // input_l/input_r[port][frame]; most kinds use only port 0. kMixer uses
  // kMixerInputCount independent ports, summed together into port 0 right
  // before RunDsp (see AudioEngine::Process) - the block's single logical
  // output is that sum, matching MixerBlock.ts's several-independent-inputs
  // Web Audio topology.
  std::vector<std::vector<float>> input_l;
  std::vector<std::vector<float>> input_r;
  std::vector<float> output_l;
  std::vector<float> output_r;

  std::atomic<float> meter{0.0f};
};


// How many sub-blocks to split the buffer into for the SetParam-style ramp
// (generic DSP wrappers and the amp tone stack). Pure-passthrough/monostate
// blocks ramp their scalar levels per-sample in their own loops, so they never
// need sub-blocking. The count is bounded: enough sub-blocks that even the
// fastest time constant ramps in small steps, but never so many that the
// per-sub-block SetParam + Process overhead regresses the CPU load. Real-time
// safe.
int AudioEngine::SubBlocksForSmoothing(int num_frames, double sample_rate, const BlockState& state) {
  bool need = false;
  float min_tau = 1e9f;
  const int pc = state.param_count.load(std::memory_order_relaxed);
  for (int i = 0; i < pc; ++i) {
    if (state.smoothing[i].mode != dsp::SmoothingMode::kNone) {
      need = true;
      min_tau = std::min(min_tau, state.smoothing[i].time_constant_s);
    }
  }
  if (!need) return 1;
  const float block_s = num_frames > 0 ? num_frames / static_cast<float>(sample_rate) : 0.0f;
  float target_s = std::min(min_tau / 4.0f, 0.004f);
  // A schema row marked linear/exponential but missing (or carrying a
  // non-positive) time constant would make target_s <= 0 and the division
  // below +inf, whose int cast is UB before the clamp ever runs. The
  // generator now rejects such rows; this keeps the audio path safe even if
  // one slips through.
  if (!(target_s > 0.0f)) target_s = 0.004f;
  int n = static_cast<int>(std::ceil(block_s / target_s));
  return std::clamp(n, 1, 64);
}

AudioEngine::AudioEngine() = default;
AudioEngine::~AudioEngine() = default;

// This layer speaks int ids (portable across C/WASM/FFI); GraphRig speaks
// strings. These two convert between them, mapping the rail sentinels onto
// GraphRig's reserved rail names.
std::string AudioEngine::GraphIdOf(BlockId id) {
  if (id == kInRailId) return graph::kInRail;
  if (id == kOutRailId) return graph::kOutRail;
  return std::to_string(id);
}

// The inverse: a GraphRig string id back to this layer's int id.
BlockId AudioEngine::ParseGraphId(const std::string& graph_id) {
  if (graph_id == graph::kInRail) return kInRailId;
  if (graph_id == graph::kOutRail) return kOutRailId;
  return static_cast<BlockId>(std::stoi(graph_id));
}

// Look up a block without locking. Only safe on the control thread while no
// mutation is in flight - Process() and the public API use the ThreadSafe
// variants below instead.
AudioEngine::BlockState* AudioEngine::FindBlock(BlockId id) {
  auto it = block_states_.find(id);
  return it != block_states_.end() ? it->second.get() : nullptr;
}

// const overload of the unlocked lookup above.
const AudioEngine::BlockState* AudioEngine::FindBlock(BlockId id) const {
  auto it = block_states_.find(id);
  return it != block_states_.end() ? it->second.get() : nullptr;
}

// Look up a block under a shared (reader) lock, so a concurrent AddBlock /
// RemoveBlock can't rehash the map underneath us (issue #52). Returns a raw
// pointer: BlockStates are heap-allocated and never moved, and removal only
// happens on the control thread, which takes the unique lock.
AudioEngine::BlockState* AudioEngine::FindBlockThreadSafe(BlockId id) {
  std::shared_lock lock(block_states_mutex_);
  auto it = block_states_.find(id);
  return it != block_states_.end() ? it->second.get() : nullptr;
}

// const overload of the locked lookup above.
const AudioEngine::BlockState* AudioEngine::FindBlockThreadSafe(BlockId id) const {
  std::shared_lock lock(block_states_mutex_);
  auto it = block_states_.find(id);
  return it != block_states_.end() ? it->second.get() : nullptr;
}

// (Re)allocate a block's scratch buffers for the current max_block_size_ and
// its port count. Called from AddBlock and Reset - never from Process(), which
// is what keeps the audio path allocation-free.
void AudioEngine::EnsureBuffers(BlockState& state) {
  const int ports = PortCountFor(state.kind);
  state.input_l.assign(ports, std::vector<float>(static_cast<size_t>(max_block_size_), 0.0f));
  state.input_r.assign(ports, std::vector<float>(static_cast<size_t>(max_block_size_), 0.0f));
  state.output_l.assign(static_cast<size_t>(max_block_size_), 0.0f);
  state.output_r.assign(static_cast<size_t>(max_block_size_), 0.0f);
}

// Copy a freshly-constructed DSP object's own defaults into the atomic param
// mirror, so GetParam reports real values before anything is set and
// ApplyRealtimeParams doesn't overwrite good defaults with zeroes on the first
// block. Skipped for NamAmp, whose "params" are model calibration seeded by
// LoadNamModel instead (and whose param count isn't even known until a model
// loads).
void AudioEngine::SeedParamsFromDsp(BlockState& state) {
  const int count = state.param_count.load(std::memory_order_relaxed);
  // Engine-level mix (issue #263) is not a DSP param — don't overwrite it with
  // the DSP's GetParam (which would return 0 for that index).
  int limit = count;
  if (NeedsEngineMix(state.kind)) limit = std::min(limit, DspParamCountFor(state.kind));
  std::visit(
      [&](auto& d) {
        using T = std::decay_t<decltype(d)>;
        if constexpr (!std::is_same_v<T, std::monostate> && !std::is_same_v<T, dsp::NamAmp>) {
          for (int i = 0; i < limit; ++i) {
            state.params[static_cast<size_t>(i)].store(d.GetParam(i), std::memory_order_relaxed);
          }
        }
      },
      state.dsp);
}

// Copy the schema-derived smoothing policy for a block's current param surface
// into its BlockState, and seed the live ramp state from the param mirror so
// the next Process() eases from the *current* value rather than from zero
// (issue #122). Called on the control thread only - AddBlock, reverb algorithm
// switch, and model load - never from the audio path, and never concurrently
// with Process() (issue #211: the ramp state this writes is plain data read by
// the audio thread).
void AudioEngine::SeedSmoothing(BlockState& state) {
  const int pc = state.param_count.load(std::memory_order_relaxed);
  const dsp::ParamSmoothing* table = nullptr;
  int count = 0;
  switch (state.kind) {
    case graph::BlockKind::kAmp:
    case graph::BlockKind::kAmpCab:
    case graph::BlockKind::kPedal:
    case graph::BlockKind::kOutboard:
    case graph::BlockKind::kSpace:
      table = kAmpSmoothing;
      count = kAmpParamCount;
      break;
    case graph::BlockKind::kCab:
      table = kCabSmoothing;
      count = kCabParamCount;
      break;
    case graph::BlockKind::kMixer:
      table = kMixerSmoothing;
      count = kMixerParamCount;
      break;
#if OPENAXE_BLOCK_REVERB_COMPILED
    case graph::BlockKind::kReverb: {
      if (std::holds_alternative<dsp::DragonflyHallReverb>(state.dsp)) {
        table = kDragonflyHallReverbSmoothing;
      } else if (std::holds_alternative<dsp::DragonflyRoomReverb>(state.dsp)) {
        table = kDragonflyRoomReverbSmoothing;
      } else if (std::holds_alternative<dsp::DragonflyPlateReverb>(state.dsp)) {
        table = kDragonflyPlateReverbSmoothing;
      } else {
        table = kDragonflyEarlyReflectionsSmoothing;
      }
      count = pc;
      break;
    }
#endif
#if OPENAXE_BLOCK_CHORUS_COMPILED
    case graph::BlockKind::kChorus:
      table = kChorusSmoothing;
      count = dsp::Chorus::ParamCount();
      break;
#endif
#if OPENAXE_BLOCK_FLANGER_COMPILED
    case graph::BlockKind::kFlanger:
      table = kFlangerSmoothing;
      count = dsp::Flanger::ParamCount();
      break;
#endif
#if OPENAXE_BLOCK_PHASER_COMPILED
    case graph::BlockKind::kPhaser:
      table = kPhaserSmoothing;
      count = dsp::Phaser::ParamCount();
      break;
#endif
#if OPENAXE_BLOCK_DELAY_COMPILED
    case graph::BlockKind::kDelay:
      table = kDelaySmoothing;
      count = dsp::Delay::ParamCount();
      break;
#endif
#if OPENAXE_BLOCK_COMPRESSOR_COMPILED
    case graph::BlockKind::kCompressor:
      table = kCompressorSmoothing;
      count = dsp::Compressor::ParamCount();
      break;
#endif
#if OPENAXE_BLOCK_EQ_COMPILED
    case graph::BlockKind::kEq:
      table = kEqualizerSmoothing;
      count = dsp::Equalizer::ParamCount();
      break;
#endif
#if OPENAXE_BLOCK_NOISE_GATE_COMPILED
    case graph::BlockKind::kNoiseGate:
      table = kNoiseGateSmoothing;
      count = dsp::NoiseGate::ParamCount();
      break;
#endif
#if OPENAXE_BLOCK_TREMOLO_COMPILED
    case graph::BlockKind::kTremolo:
      table = kTremoloSmoothing;
      count = dsp::Tremolo::ParamCount();
      break;
#endif
#if OPENAXE_BLOCK_RING_MOD_COMPILED
    case graph::BlockKind::kRingMod:
      table = kRingModSmoothing;
      count = dsp::RingMod::ParamCount();
      break;
#endif
#if OPENAXE_BLOCK_FILTER_COMPILED
    case graph::BlockKind::kFilter:
      table = kFilterSmoothing;
      count = dsp::Filter::ParamCount();
      break;
#endif
#if OPENAXE_BLOCK_PITCH_SHIFTER_COMPILED
    case graph::BlockKind::kPitchShifter:
      table = kPitchShifterSmoothing;
      count = dsp::PitchShifter::ParamCount();
      break;
#endif
#if OPENAXE_BLOCK_GRANULAR_DELAY_COMPILED
    case graph::BlockKind::kGranularDelay:
      table = kGranularDelaySmoothing;
      count = dsp::GranularDelay::ParamCount();
      break;
#endif
#if OPENAXE_BLOCK_ROTARY_COMPILED
    case graph::BlockKind::kRotary:
      table = kRotarySmoothing;
      count = dsp::Rotary::ParamCount();
      break;
#endif
    default:
      break;
  }
  if (table) {
    for (int i = 0; i < count && i < pc && i < kMaxParamsPerBlock; ++i) {
      state.smoothing[static_cast<size_t>(i)] = table[i];
    }
  }
  if (NeedsEngineMix(state.kind)) {
    const int mixIdx = EngineMixIndexFor(state.kind);
    if (mixIdx < pc && mixIdx < kMaxParamsPerBlock) state.smoothing[static_cast<size_t>(mixIdx)] = kEngineMixSmoothing;
    if (NeedsEngineLevel(state.kind)) {
      const int levelIdx = EngineLevelIndexFor(state.kind);
      if (levelIdx < pc && levelIdx < kMaxParamsPerBlock) state.smoothing[static_cast<size_t>(levelIdx)] = kEngineLevelSmoothing;
    }
  }
  // Seed the live ramp state from the current param mirror.
  for (int i = 0; i < pc; ++i) {
    state.smoothed[static_cast<size_t>(i)] =
        state.params[static_cast<size_t>(i)].load(std::memory_order_relaxed);
  }
}

// Grid column of a block, with the rails placed outside the grid on either
// side (IN before column 0, OUT after the last). That ordering is the whole
// cycle-prevention story: signal only ever flows to a higher column, so a
// left-to-right execution order is always a valid topological order and no
// cycle can exist to detect.
int AudioEngine::ColumnOfBlock(BlockId id) const {
  if (id == kInRailId) return -1;
  if (id == kOutRailId) return graph::kGridCols;
  const auto pos = rig_.GetBlockPosition(GraphIdOf(id));
  return pos ? pos->col : graph::kGridCols;
}

// Rebuild the two things Process() walks: exec_order_ (the execution order -
// normally blocks sorted by column, see RebuildExecOrder for the one
// exception) and routing_ (the edge list flattened into int ids). Called after
// every topology change rather than resolved per buffer - Process() must not
// touch the string-keyed rig or allocate.
void AudioEngine::RecomputeRouting() {
  exec_order_.clear();
  for (const auto& [id, state] : block_states_) exec_order_.push_back(id);

  routing_.clear();
  for (const auto& edge_graph_id : rig_.ListEdgeIds()) {
    const graph::EdgeRecord* edge = rig_.GetEdge(edge_graph_id);
    if (!edge) continue;
    routing_.push_back(RoutingEdge{ParseGraphId(edge->from.block_id), edge->from.port,
                                    ParseGraphId(edge->to.block_id), edge->to.port});
  }

  // Synthesize the implicit Send -> Return links (issue #274): every Send N
  // block routes into every Return N block, with no cable between them. The
  // pair is column-order-exempt, so the execution order must be a topological
  // sort (RebuildExecOrder), not a plain column sort. An unpaired block simply
  // goes nowhere - a Send with no Return drops its signal at the Send, a
  // Return with no Send stays silent, exactly like an unplugged bus.
  for (const auto& [send_id, send] : block_states_) {
    if (!IsSendKind(send->kind)) continue;
    const auto pair = SendReturnPairOf(send->kind);
    for (const auto& [ret_id, ret] : block_states_) {
      if (ret->kind == pair) routing_.push_back(RoutingEdge{send_id, 0, ret_id, 0, true});
    }
  }

  RebuildExecOrder();

  // Group edges by destination block so Process() only walks the edges that
  // actually feed each block (issue #66). OUT_RAIL is a sentinel not present
  // in exec_order_, so its edge falls out of incoming_ here - that's fine, it
  // is consumed separately when summing into the output bus. Implicit links
  // target a real Return block, so they land in the Return's incoming_ bucket.
  std::unordered_map<BlockId, size_t> index_of;
  index_of.reserve(exec_order_.size());
  for (size_t i = 0; i < exec_order_.size(); ++i) index_of.emplace(exec_order_[i], i);

  incoming_.assign(exec_order_.size(), {});
  for (const RoutingEdge& edge : routing_) {
    const auto it = index_of.find(edge.to);
    if (it != index_of.end()) incoming_[it->second].push_back(edge);
  }
}

// Topological sort of the blocks in exec_order_ honoring every routing_ edge
// (cables + implicit Send->Return links). Cables are always left-to-right by
// column, so the only edges that can fight the column order are the implicit
// pair links - a Return placed left of its Send still runs after it. Ready
// nodes are picked in ascending column (ties: Send before Return, then by id)
// so the result stays deterministic and as close to the old column sort as the
// links allow. The Send-before-Return tie-break covers a Send and its Return
// sharing a column - the Return must not read a stale Send output.
std::vector<BlockId> AudioEngine::TopologicalOrder() const {
  const size_t n = exec_order_.size();
  std::vector<std::vector<size_t>> adj(n);
  std::vector<int> indeg(n, 0);
  std::unordered_map<BlockId, size_t> index_of;
  index_of.reserve(n);
  for (size_t i = 0; i < n; ++i) index_of.emplace(exec_order_[i], i);
  std::unordered_map<BlockId, bool> is_send;
  is_send.reserve(n);
  for (const auto& [id, state] : block_states_) is_send[id] = IsSendKind(state->kind);
  for (const RoutingEdge& edge : routing_) {
    const auto a = index_of.find(edge.from);
    const auto b = index_of.find(edge.to);
    if (a == index_of.end() || b == index_of.end()) continue;  // IN/OUT rails
    adj[a->second].push_back(b->second);
    ++indeg[b->second];
  }
  std::vector<char> placed(n, 0);
  std::vector<BlockId> ordered;
  ordered.reserve(n);
  while (ordered.size() < n) {
    int best = -1;
    for (size_t i = 0; i < n; ++i) {
      if (placed[i] || indeg[i] != 0) continue;
      if (best == -1) {
        best = static_cast<int>(i);
      } else {
        const int a_col = ColumnOfBlock(exec_order_[i]);
        const int b_col = ColumnOfBlock(exec_order_[static_cast<size_t>(best)]);
        bool prefer = false;
        if (a_col != b_col) {
          prefer = a_col < b_col;
        } else if (is_send[exec_order_[i]] != is_send[exec_order_[best]]) {
          prefer = is_send[exec_order_[i]];
        } else if (exec_order_[i] != exec_order_[best]) {
          prefer = exec_order_[i] < exec_order_[best];
        }
        if (prefer) best = static_cast<int>(i);
      }
    }
    if (best == -1) break;  // cycle
    placed[static_cast<size_t>(best)] = 1;
    ordered.push_back(exec_order_[static_cast<size_t>(best)]);
    for (size_t v : adj[static_cast<size_t>(best)]) --indeg[v];
  }
  return ordered;
}

// Set exec_order_ to the topological order of the current routing_. If a user
// wired a cable from a Return back around into the same pair's Send, that
// implicit link completes a cycle and no full order exists - cables alone are
// always acyclic (column rule), so the cycle must contain an implicit link, and
// breaking it (dropping the link and retrying) restores a valid order. The
// affected pair then behaves as if unpaired - the Send's signal goes nowhere -
// rather than deadlocking the whole grid.
void AudioEngine::RebuildExecOrder() {
  std::vector<BlockId> ordered = TopologicalOrder();
  while (ordered.size() < exec_order_.size()) {
    std::unordered_set<BlockId> placed(ordered.begin(), ordered.end());
    const size_t before = routing_.size();
    routing_.erase(
        std::remove_if(routing_.begin(), routing_.end(),
                       [&](const RoutingEdge& edge) {
                         return edge.implicit && placed.count(edge.to) == 0;
                       }),
        routing_.end());
    if (routing_.size() == before) break;  // nothing implicit to drop - safety net
    ordered = TopologicalOrder();
  }
  if (ordered.size() == exec_order_.size()) {
    exec_order_ = std::move(ordered);
  } else {
    // Unreachable for a well-formed graph; fall back to the plain column sort
    // so Process() never sees a partially-ordered exec_order_.
    std::sort(exec_order_.begin(), exec_order_.end(),
              [this](BlockId a, BlockId b) { return ColumnOfBlock(a) < ColumnOfBlock(b); });
  }
}

// ── Topology ────────────────────────────────────────────────────────────

// Place a block on the grid and construct the DSP object its kind calls for.
// Ids are handed out monotonically and never reused, so a stale id from a UI
// can only ever miss, never hit the wrong block.
//
// Not real-time safe (it allocates the DSP object and the block's buffers) and
// it mutates block_states_/routing, so callers suspend the audio thread around
// it - see StudioBridge::Mutate for the handshake.
BlockId AudioEngine::AddBlock(graph::BlockKind kind, int row, int col) {
  // A kind effects.config.json marked compiled:false has no DSP in this build,
  // so placing it would leave a permanently silent block on the grid. Refuse
  // it instead. The palette is generated from the same config and never offers
  // one, so this is the defence-in-depth path: a preset from a fuller build,
  // or a caller that bypasses the palette. state::LoadState checks the same
  // predicate and reports what it dropped rather than failing the document.
  if (!blocks::IsCompiled(kind)) return kInvalidBlockId;

  const BlockId id = next_block_id_++;
  rig_.AddBlock(kind, row, col, GraphIdOf(id));

  auto state = std::make_unique<BlockState>();
  state->kind = kind;
  if (IsAmpFamily(kind)) {
    state->dsp.emplace<dsp::NamAmp>();
    state->param_count.store(kAmpParamCount, std::memory_order_relaxed);
  }
#if OPENAXE_BLOCK_REVERB_COMPILED
  else if (kind == graph::BlockKind::kReverb) {
    state->dsp.emplace<dsp::DragonflyHallReverb>();  // default algorithm; see SetReverbAlgorithm
    state->param_count.store(dsp::DragonflyHallReverb::ParamCount(), std::memory_order_relaxed);
    SeedParamsFromDsp(*state);
    RefreshReverbControlSlots(*state);
  }
#endif
#if OPENAXE_BLOCK_CHORUS_COMPILED
  else if (kind == graph::BlockKind::kChorus) {
    state->dsp.emplace<dsp::Chorus>();
    state->param_count.store(dsp::Chorus::ParamCount(), std::memory_order_relaxed);
    SeedParamsFromDsp(*state);
  }
#endif
#if OPENAXE_BLOCK_FLANGER_COMPILED
  else if (kind == graph::BlockKind::kFlanger) {
    state->dsp.emplace<dsp::Flanger>();
    state->param_count.store(dsp::Flanger::ParamCount(), std::memory_order_relaxed);
    SeedParamsFromDsp(*state);
  }
#endif
#if OPENAXE_BLOCK_PHASER_COMPILED
  else if (kind == graph::BlockKind::kPhaser) {
    state->dsp.emplace<dsp::Phaser>();
    state->param_count.store(dsp::Phaser::ParamCount(), std::memory_order_relaxed);
    SeedParamsFromDsp(*state);
  }
#endif
#if OPENAXE_BLOCK_DELAY_COMPILED
  else if (kind == graph::BlockKind::kDelay) {
    state->dsp.emplace<dsp::Delay>();
    state->param_count.store(dsp::Delay::ParamCount(), std::memory_order_relaxed);
    SeedParamsFromDsp(*state);
  }
#endif
#if OPENAXE_BLOCK_COMPRESSOR_COMPILED
  else if (kind == graph::BlockKind::kCompressor) {
    state->dsp.emplace<dsp::Compressor>();
    state->param_count.store(dsp::Compressor::ParamCount(), std::memory_order_relaxed);
    SeedParamsFromDsp(*state);
  }
#endif
#if OPENAXE_BLOCK_EQ_COMPILED
  else if (kind == graph::BlockKind::kEq) {
    state->dsp.emplace<dsp::Equalizer>();
    state->param_count.store(dsp::Equalizer::ParamCount(), std::memory_order_relaxed);
    SeedParamsFromDsp(*state);
  }
#endif
#if OPENAXE_BLOCK_NOISE_GATE_COMPILED
  else if (kind == graph::BlockKind::kNoiseGate) {
    state->dsp.emplace<dsp::NoiseGate>();
    state->param_count.store(dsp::NoiseGate::ParamCount(), std::memory_order_relaxed);
    SeedParamsFromDsp(*state);
  }
#endif
#if OPENAXE_BLOCK_TREMOLO_COMPILED
  else if (kind == graph::BlockKind::kTremolo) {
    state->dsp.emplace<dsp::Tremolo>();
    state->param_count.store(dsp::Tremolo::ParamCount(), std::memory_order_relaxed);
    SeedParamsFromDsp(*state);
  }
#endif
#if OPENAXE_BLOCK_RING_MOD_COMPILED
  else if (kind == graph::BlockKind::kRingMod) {
    state->dsp.emplace<dsp::RingMod>();
    state->param_count.store(dsp::RingMod::ParamCount(), std::memory_order_relaxed);
    SeedParamsFromDsp(*state);
  }
#endif
#if OPENAXE_BLOCK_FILTER_COMPILED
  else if (kind == graph::BlockKind::kFilter) {
    state->dsp.emplace<dsp::Filter>();
    state->param_count.store(dsp::Filter::ParamCount(), std::memory_order_relaxed);
    SeedParamsFromDsp(*state);
  }
#endif
#if OPENAXE_BLOCK_PITCH_SHIFTER_COMPILED
  else if (kind == graph::BlockKind::kPitchShifter) {
    state->dsp.emplace<dsp::PitchShifter>();
    state->param_count.store(dsp::PitchShifter::ParamCount(), std::memory_order_relaxed);
    SeedParamsFromDsp(*state);
  }
#endif
#if OPENAXE_BLOCK_GRANULAR_DELAY_COMPILED
  else if (kind == graph::BlockKind::kGranularDelay) {
    state->dsp.emplace<dsp::GranularDelay>();
    state->param_count.store(dsp::GranularDelay::ParamCount(), std::memory_order_relaxed);
    SeedParamsFromDsp(*state);
  }
#endif
#if OPENAXE_BLOCK_ROTARY_COMPILED
  else if (kind == graph::BlockKind::kRotary) {
    state->dsp.emplace<dsp::Rotary>();
    state->param_count.store(dsp::Rotary::ParamCount(), std::memory_order_relaxed);
    SeedParamsFromDsp(*state);
  }
#endif
  // Engine-level mix for the wet-only effects (hybrid, issue #263): append a
  // 0..1 mix after the DSP's own table. Chorus/flanger/phaser/tremolo/eq/gate
  // default 40% wet for a subtle effect, delay 10% per user feedback.
  // Delay also gets an additional level (volume) param after mix.
  if (NeedsEngineMix(kind)) {
    const int dspCount = DspParamCountFor(kind);
    const int mixIdx = EngineMixIndexFor(kind);
    const int total = dspCount + 1 + (NeedsEngineLevel(kind) ? 1 : 0);
    state->param_count.store(total, std::memory_order_relaxed);
    float defaultMix = 0.4f;
    if (NeedsEngineLevel(kind)) defaultMix = 0.1f;  // delay family, per user feedback
    // A phaser's notches only exist where the allpass cascade's output cancels
    // against the dry path, so their depth is set entirely by this blend: at
    // 0.4 the deepest null is about -9.5 dB, which is a gentle swirl rather
    // than the pedal's swoosh. Equal dry/wet nulls completely.
    if (kind == graph::BlockKind::kPhaser) defaultMix = 0.5f;
    state->params[static_cast<size_t>(mixIdx)].store(defaultMix, std::memory_order_relaxed);
    if (NeedsEngineLevel(kind)) {
      const int levelIdx = EngineLevelIndexFor(kind);
      state->params[static_cast<size_t>(levelIdx)].store(1.0f, std::memory_order_relaxed);
    }
  }
  if (kind == graph::BlockKind::kCab) {
    // Cab stays std::monostate - its DSP is the pair of convolvers above, not a
    // DspVariant alternative - but it does have a param, and its blend starts
    // fully wet so loading an IR is immediately audible.
    state->param_count.store(kCabParamCount, std::memory_order_relaxed);
    state->params[kCabMixParam].store(1.0f, std::memory_order_relaxed);
  }
  if (kind == graph::BlockKind::kMixer) {
    // The mixer stays std::monostate - it is not a DSP effect kind -
    // but both now expose per-port level/pan params the engine's Process()
    // applies during routing. Unity level, centre pan by default.
    state->param_count.store(kMixerParamCount, std::memory_order_relaxed);
    for (int i = 0; i < kMixerParamCount; ++i) {
      const bool is_pan = (i % kMixerParamsPerInput) == 1;
      state->params[static_cast<size_t>(i)].store(is_pan ? 0.0f : 1.0f,
                                                  std::memory_order_relaxed);
    }
  }
  // kMixer is handled above - it keeps std::monostate but now carries
  // the per-port level/pan params, unlike the original design where neither was
  // a DSP effect kind and both had param_count 0.

  // New blocks added after the engine has been Reset (the worklet's normal
  // path: Reset at startup before any blocks exist, then AddBlock) need their
  // DSP prepared (e.g. Equalizer's dspark::Equalizer::prepare), otherwise
  // Process reads uninitialised state and produces silence/NaNs — EQ was
  // silent in the worklet for this reason.
  if (sample_rate_ > 0.0 && max_block_size_ > 0) {
    std::visit(
        [&](auto& d) {
          using T = std::decay_t<decltype(d)>;
          if constexpr (!std::is_same_v<T, std::monostate> && !std::is_same_v<T, dsp::NamAmp>) {
            d.Reset(sample_rate_);
          }
        },
        state->dsp);
  }

  // Seed the smoothing policy + live ramp state from the just-initialised param
  // mirror (issue #122) so the first Process() eases from the current value.
  SeedSmoothing(*state);

  if (max_block_size_ > 0) EnsureBuffers(*state);
  {
    // Excludes FindBlockThreadSafe's readers (issue #52) - never the audio
    // thread, which is excluded from touching block_states_ at all here by
    // the suspend handshake around this call (see StudioBridge::Mutate).
    std::unique_lock lock(block_states_mutex_);
    block_states_.emplace(id, std::move(state));
  }
  RecomputeRouting();
  return id;
}

// Remove a block and, through the rig, every edge that touched it. Any
// automation slot bound to it unbinds with it - a slot never dangles (#121).
// Not real-time safe: it frees the DSP object and rewrites the routing tables.
void AudioEngine::RemoveBlock(BlockId id) {
  rig_.RemoveBlock(GraphIdOf(id));
  for (auto& slot : automation_slots_) {
    if (slot.bound && slot.block == id) {
      slot.bound = false;
      slot.block = -1;
    }
  }
  {
    std::unique_lock lock(block_states_mutex_);
    block_states_.erase(id);
  }
  RecomputeRouting();
}

// Move a block on the grid. Column changes are what make this more than
// cosmetic: they change execution order, hence the RecomputeRouting. Not
// real-time safe.
void AudioEngine::MoveBlock(BlockId id, int row, int col) {
  rig_.MoveBlock(GraphIdOf(id), row, col);
  RecomputeRouting();
}

// Wire one jack to another, subject to the rig's validation rules (left to
// right by column, one cable per input jack). Returns {false, 0} when the rig
// rejects the connection, and only then does the edge id counter stay put, so
// ids stay dense across rejected attempts. Not real-time safe.
ConnectOutcome AudioEngine::Connect(BlockId from_block, int from_port, BlockId to_block, int to_port) {
  const graph::Jack from{GraphIdOf(from_block), from_port};
  const graph::Jack to{GraphIdOf(to_block), to_port};
  const EdgeId id = next_edge_id_;
  const auto result = rig_.Connect(from, to, GraphIdOf(id));
  if (!result.ok) return ConnectOutcome{};
  ++next_edge_id_;
  RecomputeRouting();
  return ConnectOutcome{true, id};
}

// Drop one edge by id; unknown ids are a no-op. Not real-time safe.
void AudioEngine::Disconnect(EdgeId id) {
  rig_.Disconnect(GraphIdOf(id));
  RecomputeRouting();
}

// ── Rig-state enumeration / clearing (issue #119) ────────────────────────

// Every block as a flat snapshot, sorted by id so serialized output is
// deterministic regardless of unordered_map iteration order.
std::vector<BlockSnapshot> AudioEngine::ListBlocks() const {
  std::vector<BlockSnapshot> out;
  out.reserve(block_states_.size());
  for (const auto& [id, state] : block_states_) {
    const graph::BlockRecord* record = rig_.GetBlock(GraphIdOf(id));
    // Can't legitimately miss - block_states_ and the rig are mutated
    // together on the control thread.
    if (!record) continue;
    out.push_back(BlockSnapshot{id, record->kind, record->row, record->col});
  }
  std::sort(out.begin(), out.end(), [](const BlockSnapshot& a, const BlockSnapshot& b) {
    return a.id < b.id;
  });
  return out;
}

// Every edge as a flat snapshot, sorted by id (same determinism argument).
std::vector<EdgeSnapshot> AudioEngine::ListEdges() const {
  std::vector<EdgeSnapshot> out;
  out.reserve(rig_.ListEdgeIds().size());
  for (const auto& edge_graph_id : rig_.ListEdgeIds()) {
    const graph::EdgeRecord* edge = rig_.GetEdge(edge_graph_id);
    if (!edge) continue;
    out.push_back(EdgeSnapshot{static_cast<EdgeId>(std::stoi(edge_graph_id)),
                               ParseGraphId(edge->from.block_id), edge->from.port,
                               ParseGraphId(edge->to.block_id), edge->to.port});
  }
  std::sort(out.begin(), out.end(),
            [](const EdgeSnapshot& a, const EdgeSnapshot& b) { return a.id < b.id; });
  return out;
}

// Clear the whole topology: remove each block through the ordinary path (so
// edges touching them go too and routing is rebuilt once at the end). Ids keep
// counting; the engine never reuses one. Every automation slot binding dies
// with its block - LoadState re-binds from the document it is loading (#121).
// Not real-time safe.
void AudioEngine::ClearTopology() {
  for (auto& slot : automation_slots_) {
    slot.bound = false;
    slot.block = -1;
  }
  for (const auto& [id, state] : block_states_) {
    (void)state;
    rig_.RemoveBlock(GraphIdOf(id));
  }
  {
    std::unique_lock lock(block_states_mutex_);
    block_states_.clear();
  }
  RecomputeRouting();
}

// ── Lifecycle / processing ─────────────────────────────────────────────

// Arm the engine for a given sample rate and maximum block size: re-prepare
// every block's DSP, re-allocate all scratch buffers, and rebuild the routing.
// Must be called at least once before Process(), and again whenever either
// value changes. Allocates - not real-time safe.
void AudioEngine::Reset(double sample_rate, int max_block_size) {
  sample_rate_ = sample_rate;
  max_block_size_ = max_block_size;

  for (auto& [id, state] : block_states_) {
    EnsureBuffers(*state);
    if (IsAmpFamily(state->kind)) state->tone.Reset(sample_rate);
    if (state->kind == graph::BlockKind::kCab) {
      // The IR itself is rate-independent data the caller supplied; only the
      // tail state has to go.
      for (auto& conv : state->cab) conv.ResetState();
    }
    std::visit(
        [&](auto& d) {
          using T = std::decay_t<decltype(d)>;
          if constexpr (std::is_same_v<T, dsp::NamAmp>) {
            d.Reset(sample_rate, max_block_size);
          } else if constexpr (!std::is_same_v<T, std::monostate>) {
            d.Reset(sample_rate);
          }
        },
        state->dsp);
  }

  ext_in_l_.assign(static_cast<size_t>(max_block_size), 0.0f);
  ext_in_r_.assign(static_cast<size_t>(max_block_size), 0.0f);
  RecomputeRouting();
}

// Push the block's atomic param mirror into its DSP object. Called from
// Process() (i.e. on the audio thread) every buffer, which is why params are
// stored as plain atomics that any thread may write: the write itself is
// lock-free, and this is where it actually reaches the DSP.
//
// Reapplying every param every buffer sounds wasteful but is deliberate - it
// keeps the audio thread from needing a "which params changed" structure
// (which would need its own synchronization), and the setters are cheap
// arithmetic. The two exceptions that aren't cheap are handled above: the amp
// calibration levels are gated on having a real value, and slim size is
// applied synchronously by SetParam instead, because it can reallocate.
void AudioEngine::ApplyRealtimeParams(BlockState& state) {
  std::visit(
      [&](auto& d) {
        using T = std::decay_t<decltype(d)>;
        if constexpr (std::is_same_v<T, dsp::NamAmp>) {
          if (state.amp_input_level_active.load(std::memory_order_relaxed)) {
            d.SetInputLevel(state.smoothed[kAmpInputLevelParam]);
          }
          if (state.amp_output_level_active.load(std::memory_order_relaxed)) {
            d.SetOutputLevel(state.smoothed[kAmpOutputLevelParam]);
          }
          // Slim size deliberately NOT reapplied here - NamAmp::SetSlimSize
          // is documented as not real-time safe (NAMCore may reallocate).
          // SetParam() below applies it synchronously and immediately
          // instead, off this hot path.
          //
          // The tone stack is real-time safe, so it is driven from here like
          // any other param. state.smoothed[kAmpBassParam+band] already holds
          // the eased value for this sub-block (ramped in Process), so this
          // is sample-accurate rather than a per-block step (issue #122).
          for (int band = 0; band < kAmpToneBandCount; ++band) {
            state.tone.SetGainDb(static_cast<dsp::ToneStack::Band>(band),
                                 state.smoothed[static_cast<size_t>(kAmpBassParam + band)]);
          }
        } else if constexpr (!std::is_same_v<T, std::monostate>) {
          // state.smoothed[i] is the eased value for this sub-block; feeding it
          // (not the raw atomic target) is what removes the zipper noise a host
          // automating a gain param would otherwise produce (issue #122).
          // Engine-level mix (issue #263) is not a DSP param — skip it.
          const int pc = state.param_count.load(std::memory_order_relaxed);
          int limit = pc;
          if (NeedsEngineMix(state.kind)) limit = std::min(limit, DspParamCountFor(state.kind));
          for (int i = 0; i < limit; ++i) {
            d.SetParam(i, state.smoothed[static_cast<size_t>(i)]);
          }
        }
      },
      state.dsp);
}

// Run one block's DSP over the [start, start+num_frames) slice of its buffers
// into its output buffers. The std::visit inlines to a switch over the
// variant's alternatives - no virtual dispatch on the audio path. Real-time
// safe. `start`/`num_frames` slice the pre-allocated per-block buffers so the
// caller can ramp params per sub-block (issue #122) without reallocating.
void AudioEngine::RunDsp(BlockState& state, int start, int num_frames) {
  std::visit(
      [&](auto& d) {
        using T = std::decay_t<decltype(d)>;
        if constexpr (std::is_same_v<T, dsp::NamAmp>) {
          // Mono model, stereo internal representation: process channel 0, run
          // the tone stack over that same mono signal (where a real amp's tone
          // controls sit - after the amp, before the speaker), then duplicate to
          // both output channels. Mono for the same reason the web app's Web
          // Audio chain was mono here: the model's output is.
          //
          // With no model loaded the block passes audio through instead, like
          // every other DSP-less kind. NamAmp::Process leaves the output buffer
          // untouched in that case, so without this copy the block would repeat
          // whatever it produced on the previous buffer.
          if (d.HasModel()) {
            d.Process(&state.input_l[0][static_cast<size_t>(start)],
                      &state.output_l[static_cast<size_t>(start)], num_frames);
          } else {
            std::copy_n(&state.input_l[0][static_cast<size_t>(start)], num_frames,
                        &state.output_l[static_cast<size_t>(start)]);
          }
          state.tone.Process(&state.output_l[static_cast<size_t>(start)], num_frames);
          std::copy_n(&state.output_l[static_cast<size_t>(start)], num_frames,
                      &state.output_r[static_cast<size_t>(start)]);
        } else if constexpr (std::is_same_v<T, std::monostate>) {
          std::copy_n(&state.input_l[0][static_cast<size_t>(start)], num_frames,
                      &state.output_l[static_cast<size_t>(start)]);
          std::copy_n(&state.input_r[0][static_cast<size_t>(start)], num_frames,
                      &state.output_r[static_cast<size_t>(start)]);
          if (state.kind == graph::BlockKind::kCab && state.cab[0].HasImpulseResponse()) {
            // Convolve into the output buffers and blend the dry signal back in.
            // The wet/dry blend (ir_mix) is ramped per-sample below so a host
            // automating the cab level gets no zipper noise (issue #122); the
            // fully-wet common case skips the per-sample blend entirely.
            state.cab[0].Process(&state.output_l[static_cast<size_t>(start)], num_frames);
            state.cab[1].Process(&state.output_r[static_cast<size_t>(start)], num_frames);
            double& smoothed_mix = state.smoothed[kCabMixParam];
            const float target =
                state.params[kCabMixParam].load(std::memory_order_relaxed);
            const float inv_sr = 1.0f / static_cast<float>(sample_rate_);
            const double m0 = std::clamp(smoothed_mix, 0.0, 1.0);
            if (m0 >= 1.0 && target >= 1.0f) {
              // Fully wet and staying there - the convolver already produced the
              // wet signal and nothing needs advancing.
            } else {
              for (int i = 0; i < num_frames; ++i) {
                smoothed_mix =
                    dsp::RampStep(smoothed_mix, target, state.smoothing[kCabMixParam], inv_sr);
                const double m = std::clamp(smoothed_mix, 0.0, 1.0);
                const float dry = 1.0f - m;
                state.output_l[static_cast<size_t>(start + i)] =
                    m * state.output_l[static_cast<size_t>(start + i)] +
                    dry * state.input_l[0][static_cast<size_t>(start + i)];
                state.output_r[static_cast<size_t>(start + i)] =
                    m * state.output_r[static_cast<size_t>(start + i)] +
                    dry * state.input_r[0][static_cast<size_t>(start + i)];
              }
            }
          }
          // Every other monostate kind (unwrapped effects, Mixer - already summed
          // into port 0 by the caller) is a plain passthrough.
        } else {
          const float* in_ptrs[2] = {&state.input_l[0][static_cast<size_t>(start)],
                                     &state.input_r[0][static_cast<size_t>(start)]};
          float* out_ptrs[2] = {&state.output_l[static_cast<size_t>(start)],
                                &state.output_r[static_cast<size_t>(start)]};
          d.Process(in_ptrs, out_ptrs, num_frames);
        }
      },
      state.dsp);
}

// The audio callback. Runs the whole graph for one buffer and must stay
// real-time safe end to end: no allocation, no locking, no file or system IO.
// Everything it reads was prepared by Reset()/RecomputeRouting() on the control
// thread, and every value a UI can change reaches it through a plain atomic.
//
// Per buffer:
//   1. Fan the host's input into the IN rail's stereo scratch (mono is
//      duplicated to both sides).
//   2. Walk exec_order_ - blocks sorted by grid column, so a block always runs
//      after everything feeding it. For each: clear its input ports, sum every
//      incoming edge into them, fold a mixer's extra ports into port 0, apply
//      the input trim, run the DSP (or copy through when bypassed), apply the
//      output trim, and store the block's peak for metering.
//   3. Take whatever edge feeds the OUT rail, apply master level/mute, and
//      write the host's output (folding to mono if it only wants one channel).
//   4. Record how much of the buffer's real-time budget this took (cpu_load_).
//
// num_frames is clamped to max_block_size_ rather than trusted: every scratch
// buffer was sized for that maximum, and a host handing us a larger block must
// not become an out-of-bounds write.
void AudioEngine::Process(const float* const* input, int input_channels, float* const* output,
                           int output_channels, int num_frames) {
  const auto start = std::chrono::steady_clock::now();
  if (num_frames > max_block_size_) num_frames = max_block_size_;  // defensive clamp, no OOB writes
  if (num_frames < 0) num_frames = 0;

  for (int i = 0; i < num_frames; ++i) {
    float l = 0.0f, r = 0.0f;
    if (input_channels == 1 && input && input[0]) {
      l = r = input[0][i];
    } else if (input_channels >= 2 && input && input[0] && input[1]) {
      l = input[0][i];
      r = input[1][i];
    }
    ext_in_l_[static_cast<size_t>(i)] = l;
    ext_in_r_[static_cast<size_t>(i)] = r;
  }

  for (size_t bi = 0; bi < exec_order_.size(); ++bi) {
    const BlockId id = exec_order_[bi];
    BlockState& state = *block_states_.at(id);
    if (static_cast<int>(state.output_l.size()) < num_frames) continue;  // not yet Reset - stay silent

    const int ports = static_cast<int>(state.input_l.size());
    for (int p = 0; p < ports; ++p) {
      std::fill_n(state.input_l[static_cast<size_t>(p)].begin(), num_frames, 0.0f);
      std::fill_n(state.input_r[static_cast<size_t>(p)].begin(), num_frames, 0.0f);
    }

    const float inv_sr = 1.0f / static_cast<float>(sample_rate_);
    for (const RoutingEdge& edge : incoming_[bi]) {
      BlockState* source = nullptr;
      const float* src_l = nullptr;
      const float* src_r = nullptr;
      if (edge.from == kInRailId) {
        src_l = ext_in_l_.data();
        src_r = ext_in_r_.data();
      } else {
        source = FindBlock(edge.from);
        if (!source || static_cast<int>(source->output_l.size()) < num_frames) continue;
        src_l = source->output_l.data();
        src_r = source->output_r.data();
      }
      const int port = std::clamp(edge.to_port, 0, ports - 1);
      for (int i = 0; i < num_frames; ++i) {
        state.input_l[static_cast<size_t>(port)][static_cast<size_t>(i)] += src_l[i];
        state.input_r[static_cast<size_t>(port)][static_cast<size_t>(i)] += src_r[i];
      }
    }

    if (state.kind == graph::BlockKind::kMixer) {
      // Per-input level and equal-power pan (unity at centre), matching the
      // web MixerBlock's per-input GainNode + StereoPanner and giving both
      // paths identical DSP. Applied to each independent input jack before
      // they're summed into port 0. The level and pan are ramped per-sample
      // (issue #122) so automating a mixer control is zipper-free.
      constexpr float kPanScale = 1.41421356f;  // sqrt(2) - normalises the equal-power law to unity at pan=0
      for (int p = 0; p < ports; ++p) {
        const int base = p * kMixerParamsPerInput;
        double& smoothed_level = state.smoothed[static_cast<size_t>(base)];
        double& smoothed_pan = state.smoothed[static_cast<size_t>(base + 1)];
        const float target_level = state.params[static_cast<size_t>(base)].load(std::memory_order_relaxed);
        const float target_pan = state.params[static_cast<size_t>(base + 1)].load(std::memory_order_relaxed);
        // Fast path: untouched port whose ramp state has already settled.
        if (target_level == 1.0f && target_pan == 0.0f &&
            smoothed_level == 1.0f && smoothed_pan == 0.0f) {
          continue;
        }
        const dsp::ParamSmoothing& ls = state.smoothing[static_cast<size_t>(base)];
        const dsp::ParamSmoothing& ps = state.smoothing[static_cast<size_t>(base + 1)];
        for (int i = 0; i < num_frames; ++i) {
          smoothed_level = dsp::RampStep(smoothed_level, target_level, ls, inv_sr);
          smoothed_pan = dsp::RampStep(smoothed_pan, target_pan, ps, inv_sr);
          const float a = (smoothed_pan + 1.0f) * 0.78539816f;  // (pan+1) * pi/4
          const float gl = std::cos(a) * kPanScale;
          const float gr = std::sin(a) * kPanScale;
          state.input_l[static_cast<size_t>(p)][static_cast<size_t>(i)] *= smoothed_level * gl;
          state.input_r[static_cast<size_t>(p)][static_cast<size_t>(i)] *= smoothed_level * gr;
        }
      }
      for (int p = 1; p < ports; ++p) {
        for (int i = 0; i < num_frames; ++i) {
          state.input_l[0][static_cast<size_t>(i)] += state.input_l[static_cast<size_t>(p)][static_cast<size_t>(i)];
          state.input_r[0][static_cast<size_t>(i)] += state.input_r[static_cast<size_t>(p)][static_cast<size_t>(i)];
        }
      }
    }

    // I/O trims stage what enters and leaves the block, so they apply on the
    // bypassed path too - the DSP is what bypass skips, not the block's
    // level staging. Trims aren't part of the param schema, so they snap.
    if (const float in_trim = state.input_trim.load(std::memory_order_relaxed); in_trim != 1.0f) {
      for (int i = 0; i < num_frames; ++i) {
        state.input_l[0][static_cast<size_t>(i)] *= in_trim;
        state.input_r[0][static_cast<size_t>(i)] *= in_trim;
      }
    }

    if (state.bypassed.load(std::memory_order_relaxed)) {
      std::copy_n(state.input_l[0].data(), num_frames, state.output_l.data());
      std::copy_n(state.input_r[0].data(), num_frames, state.output_r.data());
    } else {
      // Sample-accurate parameter smoothing (issue #122): rather than applying
      // the atomic param mirror once per block - which a host automating a gain
      // param would turn into a per-buffer step (zipper noise) - we ramp
      // smoothed[] toward the target and feed the eased value to the DSP.
      //
      // monostate blocks (cab/mixer/passthrough) ramp their scalar
      // levels per-sample inside their own loops above / in RunDsp, so they
      // don't sub-block. The SetParam-style wrappers and the amp tone stack
      // ramp per sub-block and re-apply the DSP, keeping reverb tails and
      // one-pole state continuous across the slice boundaries.
      if (std::holds_alternative<std::monostate>(state.dsp)) {
        ApplyRealtimeParams(state);
        RunDsp(state, 0, num_frames);
      } else {
        const int n_sub = SubBlocksForSmoothing(num_frames, sample_rate_, state);
        const int sub_len = num_frames / n_sub;
        for (int sb = 0; sb < n_sub; ++sb) {
          const int start = sb * sub_len;
          const int end = (sb == n_sub - 1) ? num_frames : start + sub_len;
          const int len = end - start;
          const float dt = len / static_cast<float>(sample_rate_);
          // Advance the SetParam-style ramp state for this sub-block. kNone
          // params snap to target; the rest ease toward it.
          const int pc = state.param_count.load(std::memory_order_relaxed);
          for (int i = 0; i < pc; ++i) {
            state.smoothed[static_cast<size_t>(i)] = dsp::RampStep(
                state.smoothed[static_cast<size_t>(i)],
                state.params[static_cast<size_t>(i)].load(std::memory_order_relaxed),
                state.smoothing[static_cast<size_t>(i)], dt);
          }
          ApplyRealtimeParams(state);
          RunDsp(state, start, len);
          // Engine-level wet/dry mix (hybrid dry/wet, issue #263): blend dry
          // input with wet DSP output per sub-block using the smoothed mix for
          // this slice. Bypass already dominates above, so this only runs on
          // the wet path. Fully wet (mix==1) is the common case and keeps the
          // fast path; fully dry copies input.
          if (NeedsEngineMix(state.kind)) {
            const int mixIdx = EngineMixIndexFor(state.kind);
            const double mix = std::clamp(state.smoothed[static_cast<size_t>(mixIdx)], 0.0, 1.0);
            if (mix < 1.0) {
              if (mix <= 0.0) {
                std::copy_n(&state.input_l[0][static_cast<size_t>(start)], len,
                            &state.output_l[static_cast<size_t>(start)]);
                std::copy_n(&state.input_r[0][static_cast<size_t>(start)], len,
                            &state.output_r[static_cast<size_t>(start)]);
              } else {
                const float dryGain = 1.0f - static_cast<float>(mix);
                const float wetGain = static_cast<float>(mix);
                for (int i = 0; i < len; ++i) {
                  const int idx = start + i;
                  state.output_l[static_cast<size_t>(idx)] =
                      state.input_l[0][static_cast<size_t>(idx)] * dryGain +
                      state.output_l[static_cast<size_t>(idx)] * wetGain;
                  state.output_r[static_cast<size_t>(idx)] =
                      state.input_r[0][static_cast<size_t>(idx)] * dryGain +
                      state.output_r[static_cast<size_t>(idx)] * wetGain;
                }
              }
            }
          }
          // Engine-level level (volume) for delay after mix
          if (NeedsEngineLevel(state.kind)) {
            const int levelIdx = EngineLevelIndexFor(state.kind);
            const double level = std::clamp(state.smoothed[static_cast<size_t>(levelIdx)], 0.0, 1.5);
            if (level != 1.0) {
              const float gain = static_cast<float>(level);
              for (int i = 0; i < len; ++i) {
                const int idx = start + i;
                state.output_l[static_cast<size_t>(idx)] *= gain;
                state.output_r[static_cast<size_t>(idx)] *= gain;
              }
            }
          }
        }
      }
    }

    if (const float out_trim = state.output_trim.load(std::memory_order_relaxed); out_trim != 1.0f) {
      for (int i = 0; i < num_frames; ++i) {
        state.output_l[static_cast<size_t>(i)] *= out_trim;
        state.output_r[static_cast<size_t>(i)] *= out_trim;
      }
    }

    float peak = 0.0f;
    for (int i = 0; i < num_frames; ++i) {
      peak = std::max({peak, std::fabs(state.output_l[static_cast<size_t>(i)]),
                        std::fabs(state.output_r[static_cast<size_t>(i)])});
    }
    state.meter.store(peak, std::memory_order_relaxed);
  }

  const float* final_l = nullptr;
  const float* final_r = nullptr;
  for (const RoutingEdge& edge : routing_) {
    if (edge.to != kOutRailId) continue;  // at most one edge targets OUT_RAIL, enforced by validation
    if (edge.from == kInRailId) {
      final_l = ext_in_l_.data();
      final_r = ext_in_r_.data();
    } else if (const BlockState* source = FindBlock(edge.from);
               source && static_cast<int>(source->output_l.size()) >= num_frames) {
      final_l = source->output_l.data();
      final_r = source->output_r.data();
    }
    break;
  }

  const bool silent = master_muted_.load(std::memory_order_relaxed) ||
                      tuner_muted_.load(std::memory_order_relaxed);
  const float master_gain = silent ? 0.0f : master_level_.load(std::memory_order_relaxed);

  for (int i = 0; i < num_frames; ++i) {
    const float l = (final_l ? final_l[i] : 0.0f) * master_gain;
    const float r = (final_r ? final_r[i] : 0.0f) * master_gain;
    if (output_channels == 1 && output && output[0]) {
      output[0][i] = 0.5f * (l + r);
    } else if (output_channels >= 2 && output && output[0] && output[1]) {
      output[0][i] = l;
      output[1][i] = r;
    }
  }

  const auto elapsed = std::chrono::steady_clock::now() - start;
  const double elapsed_s = std::chrono::duration<double>(elapsed).count();
  const double budget_s = sample_rate_ > 0.0 && num_frames > 0 ? num_frames / sample_rate_ : -1.0;
  cpu_load_.store(budget_s > 0.0 ? static_cast<float>(elapsed_s / budget_s) : 0.0f,
                   std::memory_order_relaxed);
}

// ── Params ──────────────────────────────────────────────────────────────

// How many params the block currently exposes. "Currently" matters for the amp
// family: loading a slimmable model adds the slim-size param, so this can grow
// (see LoadNamModel). 0 for unknown blocks and for the kinds with no DSP.
// Atomic read (issue #211): this changes under Tier-2 writes on the control
// thread, which may run concurrently with this caller on another thread.
int AudioEngine::ParamCount(BlockId id) const {
  const BlockState* state = FindBlockThreadSafe(id);
  return state ? state->param_count.load(std::memory_order_relaxed) : 0;
}

// Name/symbol/range/unit for one param, or nullopt for an unknown block, an
// out-of-range index, or a block with no DSP. The descriptor's strings are
// static storage owned by the DSP wrappers, so they outlive any caller - which
// is what lets them cross the extern "C" boundary as bare const char*.
//
// Reads the live DspVariant (ParamInfoOf), so like every variant read it must
// not race a Tier-2 emplace. On the desktop this is only ever called from the
// control thread (the bridge resolves param keys inside Call()), which is
// serialized against the Tier-2 writes; on the web it runs on the same thread
// as everything else. SetReverbControl no longer uses this for that reason.
std::optional<ParamDescriptor> AudioEngine::ParamInfo(BlockId id, int index) const {
  const BlockState* state = FindBlockThreadSafe(id);
  if (!state || index < 0 || index >= state->param_count.load(std::memory_order_relaxed)) {
    return std::nullopt;
  }
  return ParamInfoOf(*state, index);
}

// The shared std::visit over a block's live DSP for a valid index.
std::optional<ParamDescriptor> AudioEngine::ParamInfoOf(const BlockState& state, int index) {
  // Engine-level mix is the last index for the 8 wet-only effects (issue #263).
  if (NeedsEngineMix(state.kind) && index == EngineMixIndexFor(state.kind)) {
    return kEngineMixDescriptor;
  }
  if (NeedsEngineLevel(state.kind) && index == EngineLevelIndexFor(state.kind)) {
    return kEngineLevelDescriptor;
  }
  return std::visit(
      [&](const auto& d) -> std::optional<ParamDescriptor> {
        using T = std::decay_t<decltype(d)>;
        if constexpr (std::is_same_v<T, dsp::NamAmp>) {
          // Approximate/normalized ranges - NamAmp's own calibration units
          // are dBu/x, not a fixed hardware surface with published bounds.
          // Generated from packages/core/param_schema.json (issue #51) - run
          // scripts/gen-param-schema.mjs after editing the schema.
          static constexpr ParamDescriptor kAmpParams[kAmpParamCount] = {
#include "dsp/generated/engine_amp_params.inc"
          };
          return kAmpParams[index];
        } else if constexpr (std::is_same_v<T, std::monostate>) {
          if (state.kind == graph::BlockKind::kCab) {
            // Generated from packages/core/param_schema.json (issue #51) - run
            // scripts/gen-param-schema.mjs after editing the schema.
            static constexpr ParamDescriptor kCabParams[kCabParamCount] = {
#include "dsp/generated/engine_cab_params.inc"
            };
            return kCabParams[index];
          }
          if (state.kind == graph::BlockKind::kMixer) {
            static constexpr ParamDescriptor kMixerParams[kMixerParamCount] = {
#include "dsp/generated/engine_mixer_params.inc"
            };
            return kMixerParams[index];
          }
          return std::nullopt;
        } else {
          const auto& info = T::GetParamInfo(index);
          return ParamDescriptor{info.name, info.symbol, info.min_value, info.max_value, info.unit};
        }
      },
      state.dsp);
}

// Read one param from the atomic mirror (not from the DSP object, which may
// have transformed it). Real-time safe, callable from any thread.
float AudioEngine::GetParam(BlockId id, int index) const {
  const BlockState* state = FindBlockThreadSafe(id);
  if (!state || index < 0 || index >= state->param_count.load(std::memory_order_relaxed)) {
    return 0.0f;
  }
  return state->params[static_cast<size_t>(index)].load(std::memory_order_relaxed);
}

// Write one param into the atomic mirror; Process() applies it to the DSP on
// the next buffer. Real-time safe and callable from any thread - with one
// documented exception, the amp's slim size, which reallocates inside NAMCore
// and is therefore applied here, synchronously, instead of on the audio thread.
// (That one call is Tier 2: it must not be made concurrently with Process; the
// desktop bridge routes it through its suspend handshake - see issue #211.)
//
// The bounds check reads param_count atomically so it can't tear against the
// control thread's model/algorithm swaps (issue #211). Out-of-range indices
// and unknown blocks are silently ignored: param tables change shape when a
// model loads or a reverb algorithm switches, so a UI can legitimately be one
// message behind.
void AudioEngine::SetParam(BlockId id, int index, float value) {
  BlockState* state = FindBlockThreadSafe(id);
  if (!state || index < 0 || index >= state->param_count.load(std::memory_order_relaxed)) return;
  state->params[static_cast<size_t>(index)].store(value, std::memory_order_relaxed);

  if (IsAmpFamily(state->kind)) {
    if (index == kAmpInputLevelParam) {
      state->amp_input_level_active.store(true, std::memory_order_relaxed);
    } else if (index == kAmpOutputLevelParam) {
      state->amp_output_level_active.store(true, std::memory_order_relaxed);
    } else if (index == kAmpSlimSizeParam) {
      // Tier 2 - matches NamAmp::SetSlimSize's own contract: NAMCore may
      // reallocate, so the caller must not run this concurrently with
      // Process() (the desktop bridge's suspend handshake covers it). The
      // std::get_if here is a read of the variant's active alternative, which
      // for amp-family blocks is always NamAmp and never reconstructed, so
      // the read itself is safe.
      if (auto* amp = std::get_if<dsp::NamAmp>(&state->dsp)) amp->SetSlimSize(value);
    }
  }
}

// ── NAM model management ───────────────────────────────────────────────

// Load a .nam capture into an amp-family block and re-arm it at the engine's
// current rate/block size. Returns an error code on failure (kFileNotFound also
// covers "no such block" and "block isn't an amp kind" - the caller can't act
// differently on those anyway), std::nullopt on success.
//
// The model's own calibration and slim-size surface become the block's params
// here, which is why param_count can grow after a load. Not real-time safe:
// file IO plus allocation inside NAMCore, so the caller suspends audio first.
std::optional<dsp::NamLoadError> AudioEngine::LoadNamModel(BlockId id, const std::string& file_path) {
  BlockState* state = FindBlock(id);
  if (!state) return dsp::NamLoadError::kFileNotFound;
  auto* amp = std::get_if<dsp::NamAmp>(&state->dsp);
  if (!amp) return dsp::NamLoadError::kFileNotFound;

  // Issue #69's ceiling, enforced in-core: an oversized user file is rejected
  // before NamAmp reads it, whatever front end let it through.
  std::error_code size_error;
  const auto file_size = std::filesystem::file_size(file_path, size_error);
  if (!size_error && file_size > kMaxModelBytes) return dsp::NamLoadError::kInvalidFormat;

  if (auto err = amp->LoadModel(file_path)) return err;
  // Record where this capture came from (serialization's relink field) and
  // drop any name a previous asset carried - a fresh path load has none.
  state->model_path = file_path;
  state->model_name.clear();
  AdoptLoadedModel(*state, *amp);
  return std::nullopt;
}

// Same, from the model's JSON content rather than a path. Identical contract to
// LoadNamModel - including not being real-time safe, since NAMCore parses and
// allocates either way.
std::optional<dsp::NamLoadError> AudioEngine::LoadNamModelJson(BlockId id,
                                                               const std::string& json_text) {
  BlockState* state = FindBlock(id);
  if (!state) return dsp::NamLoadError::kFileNotFound;
  auto* amp = std::get_if<dsp::NamAmp>(&state->dsp);
  if (!amp) return dsp::NamLoadError::kFileNotFound;

  // Same in-core ceiling as the path form; this is also the entry point the
  // state loader feeds embedded payloads through (#120 - untrusted bytes).
  if (json_text.size() > kMaxModelBytes) return dsp::NamLoadError::kInvalidFormat;

  if (auto err = amp->LoadModelFromJson(json_text)) return err;
  // No path or display name travels with raw JSON - forget any the previous
  // asset had rather than mislabelling the new one.
  state->model_path.clear();
  state->model_name.clear();
  AdoptLoadedModel(*state, *amp);
  return std::nullopt;
}

// Re-arm a block around its newly loaded model: prepare the DSP at the engine's
// current rate/block size, seed the calibration params from the model's own
// metadata, and grow the param surface if the capture is slimmable. Shared by
// both load paths so a model loaded from JSON behaves exactly like one loaded
// from a file.
void AudioEngine::AdoptLoadedModel(BlockState& state, dsp::NamAmp& amp) {
  if (max_block_size_ > 0) amp.Reset(sample_rate_, max_block_size_);

  const auto& info = amp.ModelInfo();
  state.amp_input_level_active.store(info.has_input_level, std::memory_order_relaxed);
  state.amp_output_level_active.store(info.has_output_level, std::memory_order_relaxed);
  state.params[kAmpInputLevelParam].store(
      info.has_input_level ? static_cast<float>(info.input_level_dbu) : 0.0f, std::memory_order_relaxed);
  state.params[kAmpOutputLevelParam].store(
      info.has_output_level ? static_cast<float>(info.output_level_dbu) : 0.0f,
      std::memory_order_relaxed);
  if (info.is_slimmable) {
    state.params[kAmpSlimSizeParam].store(static_cast<float>(amp.SlimSize()), std::memory_order_relaxed);
  }
  // Re-seed the smoothing policy (unchanged for amp) and the live ramp state so
  // the freshly-loaded calibration eases in rather than from a stale value.
  SeedSmoothing(state);
}

// Drop the block's model; it becomes a passthrough and its param surface
// shrinks back to the two calibration slots. Frees - not real-time safe.
void AudioEngine::UnloadNamModel(BlockId id) {
  BlockState* state = FindBlock(id);
  if (!state) return;
  auto* amp = std::get_if<dsp::NamAmp>(&state->dsp);
  if (!amp) return;
  amp->UnloadModel();
  state->amp_input_level_active.store(false, std::memory_order_relaxed);
  state->amp_output_level_active.store(false, std::memory_order_relaxed);
  state->model_name.clear();
  state->model_path.clear();
}

// Whether an amp-family block currently has a capture loaded. False for every
// other kind and for unknown ids. Control-thread only (unlocked lookup).
bool AudioEngine::BlockHasModel(BlockId id) const {
  const BlockState* state = FindBlock(id);
  if (!state) return false;
  const auto* amp = std::get_if<dsp::NamAmp>(&state->dsp);
  return amp && amp->HasModel();
}

// Metadata of the block's loaded capture, or nullopt when there is none. A copy
// rather than a reference: the next load replaces it, and the ABI layer hands
// the values out one by one anyway.
std::optional<dsp::NamModelInfo> AudioEngine::BlockModelInfo(BlockId id) const {
  const BlockState* state = FindBlockThreadSafe(id);
  if (!state) return std::nullopt;
  const auto* amp = std::get_if<dsp::NamAmp>(&state->dsp);
  if (!amp || !amp->HasModel()) return std::nullopt;
  return amp->ModelInfo();
}

// ── Cab impulse responses ──────────────────────────────────────────────

// Install one IR on both of a cab block's channels. The two convolvers share the
// same IR data but keep independent tails, since the channels carry different
// audio. Not real-time safe (allocates and transforms); the caller suspends
// audio, as with model loading.
//
// Raw samples carry no file bytes, so a 32-bit-float WAV is synthesized at the
// engine's rate and kept as the block's retained IR source (#120) -
// serialization embeds it, and DecodeWav hands the exact samples back.
void AudioEngine::LoadIr(BlockId id, const float* samples, int length) {
  BlockState* state = FindBlock(id);
  if (!state || state->kind != graph::BlockKind::kCab) return;
  for (auto& conv : state->cab) conv.SetImpulseResponse(samples, length);
  if (samples != nullptr && length > 0) {
    state->ir_source_wav =
        dsp::EncodeWavF32(std::vector<float>(samples, samples + length), sample_rate_);
    state->ir_name.clear();
    state->ir_path.clear();
  } else {
    // A clearing call - forget the retained source along with the IR.
    state->ir_source_wav.clear();
    state->ir_name.clear();
    state->ir_path.clear();
  }
}

// Decode a WAV file, match it to the engine's sample rate, and install it. The
// decode and the resample both happen here rather than in each front end so a
// 44.1kHz cab IR in a 48kHz session sounds the same everywhere. The original
// bytes are retained verbatim as the block's IR source (#120): restoration
// re-runs this exact pipeline from them.
int AudioEngine::LoadIrWav(BlockId id, const uint8_t* bytes, size_t size) {
  BlockState* state = FindBlock(id);
  if (!state || state->kind != graph::BlockKind::kCab) return 0;
  // Issue #69's ceiling, enforced in-core (#120 loads embedded payloads here).
  if (size > kMaxIrBytes) return 0;

  const auto decoded = dsp::DecodeWav(bytes, size);
  if (!decoded || decoded->samples.empty()) return 0;

  const std::vector<float> samples =
      sample_rate_ > 0.0 ? dsp::ResampleMono(decoded->samples, decoded->sample_rate, sample_rate_)
                         : decoded->samples;
  if (samples.empty()) return 0;

  for (auto& conv : state->cab) {
    conv.SetImpulseResponse(samples.data(), static_cast<int>(samples.size()));
  }
  state->ir_source_wav.assign(bytes, bytes + size);
  state->ir_name.clear();
  state->ir_path.clear();
  return static_cast<int>(samples.size());
}

// Drop the IR; the block goes back to passing audio through. The retained
// source and its metadata go with it.
void AudioEngine::UnloadIr(BlockId id) {
  BlockState* state = FindBlock(id);
  if (!state || state->kind != graph::BlockKind::kCab) return;
  for (auto& conv : state->cab) conv.Clear();
  state->ir_source_wav.clear();
  state->ir_name.clear();
  state->ir_path.clear();
}

// Length of the installed IR in samples, 0 when there is none.
int AudioEngine::IrLength(BlockId id) const {
  const BlockState* state = FindBlockThreadSafe(id);
  if (!state || state->kind != graph::BlockKind::kCab) return 0;
  return state->cab[0].ImpulseResponseLength();
}

// ── Asset-source retention (issue #120) ────────────────────────────────

// Copy out an amp-family block's retained model source plus its recorded
// name/path. Nullopt for unknown ids, non-amp kinds, and blocks with no model.
std::optional<ModelAssetSource> AudioEngine::BlockModelAsset(BlockId id) const {
  const BlockState* state = FindBlock(id);
  if (!state || !IsAmpFamily(state->kind)) return std::nullopt;
  const auto* amp = std::get_if<dsp::NamAmp>(&state->dsp);
  if (!amp || !amp->HasModel()) return std::nullopt;
  return ModelAssetSource{amp->SourceJson(), state->model_name, state->model_path};
}

// Same for a cab block's retained WAV bytes. Nullopt unless the block is a cab
// with an IR installed (LoadIr synthesizes bytes for raw-sample installs, so
// every loaded IR has them).
std::optional<IrAssetSource> AudioEngine::BlockIrAsset(BlockId id) const {
  const BlockState* state = FindBlock(id);
  if (!state || state->kind != graph::BlockKind::kCab) return std::nullopt;
  if (state->ir_source_wav.empty()) return std::nullopt;
  return IrAssetSource{state->ir_source_wav, state->ir_name, state->ir_path};
}

// Record display name / source path alongside the current asset - the state
// loader's bookkeeping so re-serializing a restored rig reproduces the
// document byte for byte (#120). No-ops for unknown/wrong-kind blocks.
void AudioEngine::SetModelSourceInfo(BlockId id, const std::string& name,
                                     const std::string& path) {
  BlockState* state = FindBlock(id);
  if (!state || !IsAmpFamily(state->kind)) return;
  state->model_name = name;
  state->model_path = path;
}

void AudioEngine::SetIrSourceInfo(BlockId id, const std::string& name, const std::string& path) {
  BlockState* state = FindBlock(id);
  if (!state || state->kind != graph::BlockKind::kCab) return;
  state->ir_name = name;
  state->ir_path = path;
}

// ── Automation slots (issue #121) ──────────────────────────────────────

namespace {

// Normalized 0..1 <-> native range. Degenerate ranges (max <= min - a pinned
// param) normalize to 0 and denormalize to min: the entry stays addressable
// but moves nothing.
float NormalizeTo(float value, float min, float max) {
  if (!(max > min)) return 0.0f;
  return std::clamp((value - min) / (max - min), 0.0f, 1.0f);
}

float DenormalizeFrom(float normalized, float min, float max) {
  if (!(max > min)) return min;
  return min + (max - min) * normalized;
}

// Whether `slot` names one of the bindable block slots (slot 0 is the master
// bus and plays by its own rules everywhere below).
bool IsBlockSlot(int slot) { return slot >= 1 && slot < kAutomationSlotCount; }

}  // namespace

bool AudioEngine::BindAutomationSlot(int slot, BlockId block) {
  if (!IsBlockSlot(slot)) return false;
  BlockState* state = FindBlock(block);
  if (!state) return false;

  auto& s = automation_slots_[slot];
  s.bound = true;
  s.block = block;
  // Carry whatever this slot had automated onto its new target through the
  // new target's own ranges. Only entries actually written through the slot
  // apply, so a first-time binding never stomps the block's existing values.
  ApplySlotMirror(s);
  return true;
}

bool AudioEngine::UnbindAutomationSlot(int slot) {
  if (!IsBlockSlot(slot)) return false;  // includes slot 0: never unbindable
  auto& s = automation_slots_[slot];
  if (!s.bound) return false;
  s.bound = false;
  s.block = -1;
  // Mirror/dirty deliberately survive: rebinding later still carries the
  // lane's position.
  return true;
}

// -3 for slot 0 says "exists, permanently something else" - distinct from
// plain "unbound" (-1) so a UI can grey the master slot out rather than offer
// it as free.
BlockId AudioEngine::AutomationSlotBlock(int slot) const {
  if (slot == kMasterAutomationSlot) return -3;
  if (!IsBlockSlot(slot)) return -2;
  const auto& s = automation_slots_[slot];
  return s.bound ? s.block : -1;
}

int AudioEngine::AutomationSlotParamCount(int slot) const {
  if (slot == kMasterAutomationSlot) return kMasterAutomationParamCount;
  if (IsBlockSlot(slot)) return kAutomationParamsPerSlot;
  return 0;
}

std::optional<ParamDescriptor> AudioEngine::AutomationParamInfo(int slot, int entry) const {
  if (entry < 0) return std::nullopt;
  if (slot == kMasterAutomationSlot) {
    if (entry >= kMasterAutomationParamCount) return std::nullopt;
    return ParamDescriptor{kMasterAutomationLabels[entry], kMasterAutomationSymbols[entry],
                          kMasterAutomationMin[entry], kMasterAutomationMax[entry],
                          kMasterAutomationUnits[entry]};
  }
  if (!IsBlockSlot(slot)) return std::nullopt;
  const auto& s = automation_slots_[slot];
  if (!s.bound) return std::nullopt;
  return ParamInfo(s.block, entry);  // nullopt past the block's own table
}

void AudioEngine::ApplySlotMirror(AutomationSlotState& state) {
  if (!state.bound) return;
  const int count = ParamCount(state.block);
  for (int i = 0; i < kAutomationParamsPerSlot && i < count; ++i) {
    if (!state.dirty[i]) continue;
    const auto info = ParamInfo(state.block, i);
    if (!info) continue;
    SetParam(state.block, i, DenormalizeFrom(state.mirror[i], info->min_value, info->max_value));
  }
}

void AudioEngine::SetAutomationParamNormalized(int slot, int entry, float value) {
  if (entry < 0) return;
  const float clamped = std::clamp(value, 0.0f, 1.0f);

  if (slot == kMasterAutomationSlot) {
    if (entry >= kMasterAutomationParamCount) return;
    if (entry == 0) {
      SetMasterLevel(DenormalizeFrom(clamped, kMasterAutomationMin[0], kMasterAutomationMax[0]));
    } else {
      SetMasterMuted(clamped >= 0.5f);
    }
    return;
  }
  if (!IsBlockSlot(slot)) return;

  auto& s = automation_slots_[slot];
  if (entry >= kAutomationParamsPerSlot) return;
  s.mirror[entry] = clamped;
  s.dirty[entry] = true;
  if (!s.bound) return;
  ApplySlotMirror(s);
}

float AudioEngine::GetAutomationParamNormalized(int slot, int entry) const {
  if (entry < 0) return 0.0f;
  if (slot == kMasterAutomationSlot) {
    if (entry >= kMasterAutomationParamCount) return 0.0f;
    if (entry == 0) {
      return NormalizeTo(GetMasterLevel(), kMasterAutomationMin[0], kMasterAutomationMax[0]);
    }
    return IsMasterMuted() ? 1.0f : 0.0f;
  }
  if (!IsBlockSlot(slot) || entry >= kAutomationParamsPerSlot) return 0.0f;

  const auto& s = automation_slots_[slot];
  if (s.bound && entry < ParamCount(s.block)) {
    // Live read: a knob moved outside the slot surface (web UI, desktop
    // bridge) is what the host sees. The mirror follows along (it's a cache,
    // hence mutable) so a later rebind carries the current truth, not a stale
    // write. Dirty is deliberately untouched - observing isn't automating.
    if (const auto info = ParamInfo(s.block, entry)) {
      const float normalized =
          NormalizeTo(GetParam(s.block, entry), info->min_value, info->max_value);
      s.mirror[entry] = normalized;
      return normalized;
    }
  }
  return s.mirror[entry];
}

std::vector<AudioEngine::AutomationSlotSnapshot> AudioEngine::ListBoundAutomationSlots() const {
  std::vector<AutomationSlotSnapshot> out;
  for (int slot = 1; slot < kAutomationSlotCount; ++slot) {
    if (automation_slots_[slot].bound) {
      out.push_back(AutomationSlotSnapshot{slot, automation_slots_[slot].block});
    }
  }
  return out;
}

// ── MIDI mapping (issue #124) ──────────────────────────────────────────

std::vector<midi::MidiMapping> AudioEngine::ListMidiMappings() const {
  std::shared_lock lock(midi_mutex_);
  return midi_mappings_;
}

size_t AudioEngine::MidiMappingCount() const {
  std::shared_lock lock(midi_mutex_);
  return midi_mappings_.size();
}

std::optional<midi::MidiMapping> AudioEngine::MidiMappingAt(size_t index) const {
  std::shared_lock lock(midi_mutex_);
  if (index >= midi_mappings_.size()) return std::nullopt;
  return midi_mappings_[index];
}

bool AudioEngine::AddMidiMapping(const midi::MidiMatch& match, const midi::MidiAction& action) {
  if (!midi::IsValidMatch(match) || !midi::IsValidAction(action)) return false;
  std::unique_lock lock(midi_mutex_);
  const std::string action_key = midi::ActionKey(action);
  const std::string match_key = midi::MatchKey(match);
  // Dedup like midiStore.completeLearn: remove any mapping that shares the
  // same action key or the same match key, then append.
  midi_mappings_.erase(
      std::remove_if(midi_mappings_.begin(), midi_mappings_.end(),
                     [&](const midi::MidiMapping& m) {
                       return midi::ActionKey(m.action) == action_key ||
                              midi::MatchKey(m.match) == match_key;
                     }),
      midi_mappings_.end());
  midi_mappings_.push_back(midi::MidiMapping{match, action});
  return true;
}

bool AudioEngine::RemoveMidiMapping(size_t index) {
  std::unique_lock lock(midi_mutex_);
  if (index >= midi_mappings_.size()) return false;
  midi_mappings_.erase(midi_mappings_.begin() + static_cast<std::ptrdiff_t>(index));
  return true;
}

void AudioEngine::ClearMidiMappings() {
  std::unique_lock lock(midi_mutex_);
  midi_mappings_.clear();
  midi_learn_target_.reset();
}

bool AudioEngine::ArmMidiLearn(const midi::MidiAction& action) {
  if (!midi::IsValidAction(action)) return false;
  std::unique_lock lock(midi_mutex_);
  midi_learn_target_ = action;
  return true;
}

void AudioEngine::CancelMidiLearn() {
  std::unique_lock lock(midi_mutex_);
  midi_learn_target_.reset();
}

bool AudioEngine::IsMidiLearning() const {
  std::shared_lock lock(midi_mutex_);
  return midi_learn_target_.has_value();
}

std::optional<midi::MidiAction> AudioEngine::MidiLearnTarget() const {
  std::shared_lock lock(midi_mutex_);
  return midi_learn_target_;
}

AudioEngine::MidiHandleResult AudioEngine::HandleMidiMessage(const uint8_t* data, size_t size,
                                                             int32_t sample_offset) {
  (void)sample_offset;  // accepted for ABI-level sample-accurate scheduling; dispatched immediately today
  MidiHandleResult result;
  const auto maybe_msg = midi::ParseMidiMessage(data, size);
  if (!maybe_msg) return result;
  if (!midi::IsTriggerEdge(*maybe_msg)) return result;

  // Take shared lock to read learn target + mappings. If learning, we need to
  // upgrade to exclusive to bind — do it by releasing shared and taking unique.
  {
    std::shared_lock lock(midi_mutex_);
    if (midi_learn_target_.has_value()) {
      const midi::MidiAction target = *midi_learn_target_;
      // Copy needed keys before releasing lock; the bind will dedup under exclusive.
      lock.unlock();
      std::unique_lock ulock(midi_mutex_);
      if (!midi_learn_target_.has_value() || midi::ActionKey(*midi_learn_target_) != midi::ActionKey(target)) {
        // Lost race — another thread cancelled or re-armed.
        return result;
      }
      const midi::MidiMatch match{maybe_msg->type, maybe_msg->channel, maybe_msg->number};
      const std::string action_key = midi::ActionKey(target);
      const std::string match_key = midi::MatchKey(match);
      midi_mappings_.erase(
          std::remove_if(midi_mappings_.begin(), midi_mappings_.end(),
                         [&](const midi::MidiMapping& m) {
                           return midi::ActionKey(m.action) == action_key ||
                                  midi::MatchKey(m.match) == match_key;
                         }),
          midi_mappings_.end());
      midi_mappings_.push_back(midi::MidiMapping{match, target});
      midi_learn_target_.reset();
      result.kind = MidiHandleResult::kLearnCompleted;
      result.action = target;
      result.match = match;
      return result;
    }

    for (const auto& mapping : midi_mappings_) {
      if (midi::MessageMatches(*maybe_msg, mapping.match)) {
        result.kind = MidiHandleResult::kDispatched;
        result.action = mapping.action;
        result.match = mapping.match;
        return result;
      }
    }
  }
  return result;
}

// ── Reverb algorithm choice ─────────────────────────────────────────────

namespace {

// Room size (0..0.97) -> decay seconds, and damping (0..1) -> high-cut Hz.
// These two ranges are the whole definition of the kRoomSize/kDamping
// abstractions; they were previously duplicated as literals inside the web
// app's reverb worklet, which is why the desktop path had no room size or
// damping control at all.
constexpr float kDecayMinSeconds = 0.1f;
constexpr float kDecayMaxSeconds = 10.0f;
constexpr float kRoomSizeMax = 0.97f;
constexpr float kHighCutMinHz = 1000.0f;
constexpr float kHighCutMaxHz = 16000.0f;

// Ordered symbol candidates per control: the first symbol the current
// algorithm's param table actually has wins, and nothing happens when it has
// none of them (Early Reflections has no pre-delay, decay or spin).
std::span<const char* const> ReverbControlSymbols(ReverbControl control) {
  static constexpr const char* kRoomSize[] = {"decay"};
  static constexpr const char* kDamping[] = {"high_cut", "in_high_cut"};
  static constexpr const char* kWidth[] = {"width"};
  static constexpr const char* kPredelay[] = {"predelay", "delay"};
  static constexpr const char* kSpin[] = {"spin"};
  static constexpr const char* kWander[] = {"wander"};
  static constexpr const char* kEarlySend[] = {"early_send"};
  static constexpr const char* kDryLevel[] = {"dry_level"};
  switch (control) {
    case ReverbControl::kRoomSize: return kRoomSize;
    case ReverbControl::kDamping: return kDamping;
    case ReverbControl::kWidth: return kWidth;
    case ReverbControl::kPredelay: return kPredelay;
    case ReverbControl::kSpin: return kSpin;
    case ReverbControl::kWander: return kWander;
    case ReverbControl::kEarlySend: return kEarlySend;
    case ReverbControl::kDryLevel: return kDryLevel;
  }
  return {};
}

}  // namespace

// Re-resolve every user-facing ReverbControl onto the algorithm currently
// installed on `state` (issue #211): for each control, the first symbol the
// algorithm's own param table exposes (ReverbControlSymbols) is located and
// its index + clamp range published into the block's atomic
// reverb_control_slots; the index stays -1 when the algorithm has none of the
// candidate symbols (a no-op). Tier 2 - only called from AddBlock and
// SetReverbAlgorithm, both under the no-concurrent-Process protocol, so the
// std::visit here (via ParamInfoOf) never races Process()'s own visit. This is
// what lets SetReverbControl run on any thread without ever touching the live
// DspVariant.
void AudioEngine::RefreshReverbControlSlots(BlockState& state) {
  for (auto& slot : state.reverb_control_slots) {
    slot.index.store(-1, std::memory_order_relaxed);
    slot.min.store(0.0f, std::memory_order_relaxed);
    slot.max.store(0.0f, std::memory_order_relaxed);
  }
  const int pc = state.param_count.load(std::memory_order_relaxed);
  for (int c = 0; c < kReverbControlCount; ++c) {
    const ReverbControl control = static_cast<ReverbControl>(c);
    auto& slot = state.reverb_control_slots[static_cast<size_t>(c)];
    for (const char* symbol : ReverbControlSymbols(control)) {
      for (int i = 0; i < pc; ++i) {
        const std::optional<ParamDescriptor> info = ParamInfoOf(state, i);
        if (!info || !info->symbol || std::strcmp(info->symbol, symbol) != 0) continue;
        slot.index.store(i, std::memory_order_relaxed);
        slot.min.store(info->min_value, std::memory_order_relaxed);
        slot.max.store(info->max_value, std::memory_order_relaxed);
        break;
      }
      if (slot.index.load(std::memory_order_relaxed) >= 0) break;
    }
  }
}

// Apply one user-facing reverb control to whatever algorithm currently backs
// the block: scale the two abstractions (room size -> decay, damping -> high
// cut) and then write the resolved param through the block's atomic control
// cache (RefreshReverbControlSlots), clamped into that param's declared range.
// Real-time safe and callable from any thread - it reads only atomics and ends
// in the same atomic SetParam a raw index write would, so it can't race an
// algorithm swap (issue #211).
void AudioEngine::SetReverbControl(BlockId id, ReverbControl control, float value) {
  const BlockState* state = FindBlockThreadSafe(id);
  if (!state || state->kind != graph::BlockKind::kReverb) return;
  if (static_cast<int>(control) < 0 || static_cast<int>(control) >= kReverbControlCount) return;

  float scaled = value;
  if (control == ReverbControl::kRoomSize) {
    const float t = std::clamp(value, 0.0f, kRoomSizeMax) / kRoomSizeMax;
    scaled = kDecayMinSeconds + t * (kDecayMaxSeconds - kDecayMinSeconds);
  } else if (control == ReverbControl::kDamping) {
    const float t = std::clamp(value, 0.0f, 1.0f);
    scaled = kHighCutMaxHz - t * (kHighCutMaxHz - kHighCutMinHz);
  }

  const auto& slot = state->reverb_control_slots[static_cast<size_t>(control)];
  const int index = slot.index.load(std::memory_order_relaxed);
  if (index < 0) return;  // this algorithm doesn't expose the control
  const float min = slot.min.load(std::memory_order_relaxed);
  const float max = slot.max.load(std::memory_order_relaxed);
  SetParam(id, index, std::clamp(scaled, min, max));
}

// Swap which Dragonfly algorithm backs a reverb block. This *replaces* the DSP
// object, so it allocates and is Tier 2 (must not run concurrently with
// Process()) - algorithm choice is a deliberate user action, not automation.
// The new object is re-prepared at the engine's current sample rate and its own
// defaults are seeded into the param mirror, because each algorithm has a
// different param table (which is also why a UI should drive reverb through
// SetReverbControl rather than raw indices).
void AudioEngine::SetReverbAlgorithm(BlockId id, ReverbAlgorithm algorithm) {
  BlockState* state = FindBlock(id);
  if (!state || state->kind != graph::BlockKind::kReverb) return;

  switch (algorithm) {
    case ReverbAlgorithm::kHall:
      state->dsp.emplace<dsp::DragonflyHallReverb>();
      state->param_count.store(dsp::DragonflyHallReverb::ParamCount(), std::memory_order_relaxed);
      break;
    case ReverbAlgorithm::kRoom:
      state->dsp.emplace<dsp::DragonflyRoomReverb>();
      state->param_count.store(dsp::DragonflyRoomReverb::ParamCount(), std::memory_order_relaxed);
      break;
    case ReverbAlgorithm::kPlate:
      state->dsp.emplace<dsp::DragonflyPlateReverb>();
      state->param_count.store(dsp::DragonflyPlateReverb::ParamCount(), std::memory_order_relaxed);
      break;
    case ReverbAlgorithm::kEarlyReflections:
      state->dsp.emplace<dsp::DragonflyEarlyReflections>();
      state->param_count.store(dsp::DragonflyEarlyReflections::ParamCount(),
                               std::memory_order_relaxed);
      break;
  }

  if (max_block_size_ > 0) {
    std::visit(
        [&](auto& d) {
          using T = std::decay_t<decltype(d)>;
          if constexpr (!std::is_same_v<T, std::monostate> && !std::is_same_v<T, dsp::NamAmp>) {
            d.Reset(sample_rate_);
          }
        },
        state->dsp);
  }
  SeedParamsFromDsp(*state);
  // The new algorithm has its own param table, hence its own smoothing policy
  // and reverb-control resolution.
  SeedSmoothing(*state);
  RefreshReverbControlSlots(*state);
}

// ── Delay model choice ──────────────────────────────────────────────────

// Switch a delay block's model (Digital / Tape / Analog). Unlike the reverb
// algorithms this keeps the same DSP object - only what happens inside the
// feedback loop changes - so the delay buffer's contents survive and a repeat
// in flight isn't cut off. No-op for other kinds.
void AudioEngine::SetDelayModel(BlockId id, dsp::Delay::Model model) {
  BlockState* state = FindBlock(id);
  if (!state || state->kind != graph::BlockKind::kDelay) return;

  auto* delay = std::get_if<dsp::Delay>(&state->dsp);
  if (!delay) return;

  // Preserve engine mix/level across model switches (hybrid dry/wet, #263).
  float savedMix = 1.0f;
  float savedLevel = 1.0f;
  bool hadMix = false;
  bool hadLevel = false;
  if (NeedsEngineMix(state->kind)) {
    const int mixIdx = EngineMixIndexFor(state->kind);
    if (mixIdx < state->param_count.load(std::memory_order_relaxed)) {
      savedMix = state->params[static_cast<size_t>(mixIdx)].load(std::memory_order_relaxed);
      hadMix = true;
    }
    if (NeedsEngineLevel(state->kind)) {
      const int levelIdx = EngineLevelIndexFor(state->kind);
      if (levelIdx < state->param_count.load(std::memory_order_relaxed)) {
        savedLevel = state->params[static_cast<size_t>(levelIdx)].load(std::memory_order_relaxed);
        hadLevel = true;
      }
    }
  }
  delay->SetModel(model);
  // Reset param_count in case it changes (it doesn't currently — same count
  // for all models — but kept for parity with other model-switch methods).
  // Include the engine mix/level if present.
  if (NeedsEngineMix(state->kind)) {
    const int total = dsp::Delay::ParamCount() + 1 + (NeedsEngineLevel(state->kind) ? 1 : 0);
    state->param_count.store(total, std::memory_order_relaxed);
  } else {
    state->param_count.store(dsp::Delay::ParamCount(), std::memory_order_relaxed);
  }
  SeedParamsFromDsp(*state);
  if (hadMix) {
    const int mixIdx = EngineMixIndexFor(state->kind);
    state->params[static_cast<size_t>(mixIdx)].store(savedMix, std::memory_order_relaxed);
  }
  if (hadLevel) {
    const int levelIdx = EngineLevelIndexFor(state->kind);
    state->params[static_cast<size_t>(levelIdx)].store(savedLevel, std::memory_order_relaxed);
  }
  // Same param table across delay models, so the policy is unchanged - this
  // just re-seeds the live ramp state from the (re-defaulted) mirror.
  SeedSmoothing(*state);
}

// ── Per-block state readers for serialization (issue #119) ──────────────

// Which Dragonfly algorithm currently backs a reverb block. The choice isn't
// stored as a field - it IS which alternative the DSP variant holds - so the
// getter recovers it from there. kHall for anything else (the default every
// new reverb block starts on).
ReverbAlgorithm AudioEngine::GetReverbAlgorithm(BlockId id) const {
  const BlockState* state = FindBlockThreadSafe(id);
  if (!state || state->kind != graph::BlockKind::kReverb) return ReverbAlgorithm::kHall;
  if (std::holds_alternative<dsp::DragonflyRoomReverb>(state->dsp)) {
    return ReverbAlgorithm::kRoom;
  }
  if (std::holds_alternative<dsp::DragonflyPlateReverb>(state->dsp)) {
    return ReverbAlgorithm::kPlate;
  }
  if (std::holds_alternative<dsp::DragonflyEarlyReflections>(state->dsp)) {
    return ReverbAlgorithm::kEarlyReflections;
  }
  return ReverbAlgorithm::kHall;  // includes the kHall case above
}

// Which delay character the block plays through. Read from the atomic param
// MIRROR rather than the DSP object: a SetParam('model', n) write lands in
// the mirror immediately but reaches the DSP only on the next Process()
// buffer, and serialization must capture what the user set, not what the DSP
// object last heard. The mirror is seeded from the DSP on every
// re-seed/re-prepare, so the two agree except inside that window - and the
// mirror is the authoritative side of it. kDigital for anything that isn't a
// kDelay block or whose table somehow lacks the symbol.
dsp::Delay::Model AudioEngine::GetDelayModel(BlockId id) const {
  const BlockState* state = FindBlockThreadSafe(id);
  if (!state || state->kind != graph::BlockKind::kDelay) return dsp::Delay::Model::kDigital;
  const int pc = state->param_count.load(std::memory_order_relaxed);
  for (int i = 0; i < pc; ++i) {
    const std::optional<ParamDescriptor> info = ParamInfo(id, i);
    if (info && info->symbol && std::strcmp(info->symbol, "model") == 0) {
      const int value = static_cast<int>(std::lround(GetParam(id, i)));
      if (value >= 0 && value <= 2) {
        return static_cast<dsp::Delay::Model>(value);
      }
      break;
    }
  }
  return dsp::Delay::Model::kDigital;
}

// The amp calibration gates - true once the model defined the level or the
// caller wrote the param explicitly (see BlockState's doc comment).
bool AudioEngine::IsAmpInputLevelActive(BlockId id) const {
  const BlockState* state = FindBlockThreadSafe(id);
  if (!state || !IsAmpFamily(state->kind)) return false;
  return state->amp_input_level_active.load(std::memory_order_relaxed);
}

bool AudioEngine::IsAmpOutputLevelActive(BlockId id) const {
  const BlockState* state = FindBlockThreadSafe(id);
  if (!state || !IsAmpFamily(state->kind)) return false;
  return state->amp_output_level_active.load(std::memory_order_relaxed);
}

// ── Bypass / master bus ────────────────────────────────────────────────

// Skip a block's DSP, passing its port-0 input through to its output. The
// block's I/O trims still apply (they stage the block, not its DSP), and the
// DSP object keeps its state, so unbypassing doesn't re-prepare anything.
// Real-time safe, callable from any thread.
void AudioEngine::SetBypass(BlockId id, bool bypassed) {
  BlockState* state = FindBlock(id);
  if (state) state->bypassed.store(bypassed, std::memory_order_relaxed);
}

// Per-block I/O staging gain, 1.0 = unity. These four are the user-facing
// Input/Output knobs for every block kind, and are deliberately separate from
// the amp family's input_level/output_level params, which carry the loaded NAM
// capture's dBu calibration (see engine.h). Lock-free; any thread.
void AudioEngine::SetInputTrim(BlockId id, float gain) {
  BlockState* state = FindBlockThreadSafe(id);
  if (state) state->input_trim.store(gain, std::memory_order_relaxed);
}

// Current input trim, 1.0 (unity) for unknown blocks.
float AudioEngine::GetInputTrim(BlockId id) const {
  const BlockState* state = FindBlockThreadSafe(id);
  return state ? state->input_trim.load(std::memory_order_relaxed) : 1.0f;
}

// Output-side trim, applied after the block's DSP (or after the bypass copy).
void AudioEngine::SetOutputTrim(BlockId id, float gain) {
  BlockState* state = FindBlockThreadSafe(id);
  if (state) state->output_trim.store(gain, std::memory_order_relaxed);
}

// Current output trim, 1.0 (unity) for unknown blocks.
float AudioEngine::GetOutputTrim(BlockId id) const {
  const BlockState* state = FindBlockThreadSafe(id);
  return state ? state->output_trim.load(std::memory_order_relaxed) : 1.0f;
}

// Whether a block is bypassed; false for unknown ids.
bool AudioEngine::IsBypassed(BlockId id) const {
  const BlockState* state = FindBlock(id);
  return state && state->bypassed.load(std::memory_order_relaxed);
}

// The output bus, applied after the graph and before the host's buffers.
// All four of these are lock-free and callable from any thread.
void AudioEngine::SetMasterLevel(float level) {
  master_level_.store(level, std::memory_order_relaxed);
}

// Current master level.
float AudioEngine::GetMasterLevel() const { return master_level_.load(std::memory_order_relaxed); }

// Master mute - independent of the tuner mute, so neither clears the other.
void AudioEngine::SetMasterMuted(bool muted) {
  master_muted_.store(muted, std::memory_order_relaxed);
}

// Whether the master mute is engaged.
bool AudioEngine::IsMasterMuted() const { return master_muted_.load(std::memory_order_relaxed); }

// A second, independent mute source, so a tuner overlay can silence the output
// without disturbing whatever the user set the master mute to.
void AudioEngine::SetTunerMuted(bool muted) { tuner_muted_.store(muted, std::memory_order_relaxed); }

// Whether the tuner mute is engaged.
bool AudioEngine::IsTunerMuted() const { return tuner_muted_.load(std::memory_order_relaxed); }

// ── Metering ────────────────────────────────────────────────────────────

// Peak |sample| across the block's output over the last Process() call, 0 for
// unknown ids. Peak rather than RMS because this drives clip-aware level
// meters; a UI that wants ballistics smooths it itself.
float AudioEngine::GetMeter(BlockId id) const {
  const BlockState* state = FindBlockThreadSafe(id);
  return state ? state->meter.load(std::memory_order_relaxed) : 0.0f;
}

// What fraction of one buffer's real-time budget the last Process() call used
// (0.5 = half the available time). Measured with a steady_clock read at each
// end of Process, so it includes everything the audio thread did, and it is the
// number a UI should surface as "CPU" - not a process-wide figure.
float AudioEngine::GetCpuLoad() const { return cpu_load_.load(std::memory_order_relaxed); }

// Compressor gain reduction in dB (≤0), 0 if unknown or not a compressor/gate. Tier 1.
float AudioEngine::GetGainReduction(BlockId id) const {
  const BlockState* state = FindBlockThreadSafe(id);
  if (!state) return 0.0f;
  return std::visit(
      [](auto& dsp) -> float {
        using T = std::decay_t<decltype(dsp)>;
#if OPENAXE_BLOCK_COMPRESSOR
        if constexpr (std::is_same_v<T, dsp::Compressor>) return dsp.GetGainReductionDb();
#endif
#if OPENAXE_BLOCK_NOISE_GATE
        if constexpr (std::is_same_v<T, dsp::NoiseGate>) return dsp.GetGainReductionDb();
#endif
        return 0.0f;
      },
      state->dsp);
}

// Gate openness 0..1 (1 = open), 0 if unknown or not a gate. Tier 1.
float AudioEngine::GetGateGain(BlockId id) const {
  const BlockState* state = FindBlockThreadSafe(id);
  if (!state) return 0.0f;
  return std::visit(
      [](auto& dsp) -> float {
        using T = std::decay_t<decltype(dsp)>;
#if OPENAXE_BLOCK_NOISE_GATE
        if constexpr (std::is_same_v<T, dsp::NoiseGate>) return dsp.GetGateGain();
#endif
        return 0.0f;
      },
      state->dsp);
}

}  // namespace openaxe::engine
