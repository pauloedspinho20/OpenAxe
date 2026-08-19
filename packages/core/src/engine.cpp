#include "nam_studio/engine.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstring>
#include <mutex>
#include <span>
#include <type_traits>
#include <variant>

#include "nam_studio/dsp/chorus.h"
#include "nam_studio/dsp/convolver.h"
#include "nam_studio/dsp/compressor.h"
#include "nam_studio/dsp/delay.h"
#include "nam_studio/dsp/dragonfly_early_reflections.h"
#include "nam_studio/dsp/dragonfly_hall_reverb.h"
#include "nam_studio/dsp/dragonfly_plate_reverb.h"
#include "nam_studio/dsp/dragonfly_room_reverb.h"
#include "nam_studio/dsp/equalizer.h"
#include "nam_studio/dsp/flanger.h"
#include "nam_studio/dsp/noise_gate.h"
#include "nam_studio/dsp/phaser.h"
#include "nam_studio/dsp/ping_pong_delay.h"
#include "nam_studio/dsp/tone_stack.h"
#include "nam_studio/dsp/tremolo.h"
#include "nam_studio/dsp/wav.h"

namespace nam_studio::engine {
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
// (nam_studio_block_model_info reports it), not of the param surface.
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

// Splitter blocks expose a per-output level for each of their
// kSplitterOutputCount independent output jacks (out{p}_level at index p),
// applied when an edge routes out of the splitter at that port - the core
// replacement for the web SplitterBlock's per-output GainNode.
constexpr int kSplitterParamCount = graph::kSplitterOutputCount;

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
// than one; a splitter's several *outputs* are edges from its single output, so
// it needs no extra buffers.
int PortCountFor(graph::BlockKind kind) {
  return kind == graph::BlockKind::kMixer ? graph::kMixerInputCount : 1;
}

// The closed set of DSP objects a block can hold. std::monostate is a block
// with no DSP at all (cab/mixer/splitter, or an amp with no model loaded yet),
// which Process() treats as passthrough. A variant rather than virtual
// dispatch: every alternative is known here, so RunDsp's std::visit inlines
// instead of paying an indirect call per block per buffer.
using DspVariant = std::variant<std::monostate, dsp::NamAmp, dsp::DragonflyHallReverb,
                                 dsp::DragonflyRoomReverb, dsp::DragonflyPlateReverb,
                                 dsp::DragonflyEarlyReflections, dsp::Chorus, dsp::Flanger,
                                 dsp::Phaser, dsp::Delay, dsp::PingPongDelay, dsp::Compressor,
                                 dsp::Equalizer, dsp::NoiseGate, dsp::Tremolo>;

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
  int param_count = 0;  // logical count; dynamic for Amp-family (see LoadNamModel)
  std::array<std::atomic<float>, kMaxParamsPerBlock> params{};

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
  std::visit(
      [&](auto& d) {
        using T = std::decay_t<decltype(d)>;
        if constexpr (!std::is_same_v<T, std::monostate> && !std::is_same_v<T, dsp::NamAmp>) {
          for (int i = 0; i < state.param_count; ++i) {
            state.params[static_cast<size_t>(i)].store(d.GetParam(i), std::memory_order_relaxed);
          }
        }
      },
      state.dsp);
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

// Rebuild the two things Process() walks: exec_order_ (blocks sorted by
// column, so a block always runs after whatever feeds it) and routing_ (the
// edge list flattened into int ids). Called after every topology change rather
// than resolved per buffer - Process() must not touch the string-keyed rig or
// allocate.
void AudioEngine::RecomputeRouting() {
  exec_order_.clear();
  for (const auto& [id, state] : block_states_) exec_order_.push_back(id);
  std::sort(exec_order_.begin(), exec_order_.end(),
            [this](BlockId a, BlockId b) { return ColumnOfBlock(a) < ColumnOfBlock(b); });

  routing_.clear();
  for (const auto& edge_graph_id : rig_.ListEdgeIds()) {
    const graph::EdgeRecord* edge = rig_.GetEdge(edge_graph_id);
    if (!edge) continue;
    routing_.push_back(RoutingEdge{ParseGraphId(edge->from.block_id), edge->from.port,
                                    ParseGraphId(edge->to.block_id), edge->to.port});
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
  const BlockId id = next_block_id_++;
  rig_.AddBlock(kind, row, col, GraphIdOf(id));

  auto state = std::make_unique<BlockState>();
  state->kind = kind;
  if (IsAmpFamily(kind)) {
    state->dsp.emplace<dsp::NamAmp>();
    state->param_count = kAmpParamCount;
  } else if (kind == graph::BlockKind::kReverb) {
    state->dsp.emplace<dsp::DragonflyHallReverb>();  // default algorithm; see SetReverbAlgorithm
    state->param_count = dsp::DragonflyHallReverb::ParamCount();
    SeedParamsFromDsp(*state);
  } else if (kind == graph::BlockKind::kChorus) {
    state->dsp.emplace<dsp::Chorus>();
    state->param_count = dsp::Chorus::ParamCount();
    SeedParamsFromDsp(*state);
  } else if (kind == graph::BlockKind::kFlanger) {
    state->dsp.emplace<dsp::Flanger>();
    state->param_count = dsp::Flanger::ParamCount();
    SeedParamsFromDsp(*state);
  } else if (kind == graph::BlockKind::kPhaser) {
    state->dsp.emplace<dsp::Phaser>();
    state->param_count = dsp::Phaser::ParamCount();
    SeedParamsFromDsp(*state);
  } else if (kind == graph::BlockKind::kDelay) {
    state->dsp.emplace<dsp::Delay>();
    state->param_count = dsp::Delay::ParamCount();
    SeedParamsFromDsp(*state);
  } else if (kind == graph::BlockKind::kPingPongDelay) {
    state->dsp.emplace<dsp::PingPongDelay>();
    state->param_count = dsp::PingPongDelay::ParamCount();
    SeedParamsFromDsp(*state);
  } else if (kind == graph::BlockKind::kCompressor) {
    state->dsp.emplace<dsp::Compressor>();
    state->param_count = dsp::Compressor::ParamCount();
    SeedParamsFromDsp(*state);
  } else if (kind == graph::BlockKind::kEq) {
    state->dsp.emplace<dsp::Equalizer>();
    state->param_count = dsp::Equalizer::ParamCount();
    SeedParamsFromDsp(*state);
  } else if (kind == graph::BlockKind::kNoiseGate) {
    state->dsp.emplace<dsp::NoiseGate>();
    state->param_count = dsp::NoiseGate::ParamCount();
    SeedParamsFromDsp(*state);
  } else if (kind == graph::BlockKind::kTremolo) {
    state->dsp.emplace<dsp::Tremolo>();
    state->param_count = dsp::Tremolo::ParamCount();
    SeedParamsFromDsp(*state);
  }
  if (kind == graph::BlockKind::kCab) {
    // Cab stays std::monostate - its DSP is the pair of convolvers above, not a
    // DspVariant alternative - but it does have a param, and its blend starts
    // fully wet so loading an IR is immediately audible.
    state->param_count = kCabParamCount;
    state->params[kCabMixParam].store(1.0f, std::memory_order_relaxed);
  }
  if (kind == graph::BlockKind::kMixer) {
    // Mixer and splitter stay std::monostate - neither is a DSP effect kind -
    // but both now expose per-port level/pan params the engine's Process()
    // applies during routing. Unity level, centre pan by default.
    state->param_count = kMixerParamCount;
    for (int i = 0; i < kMixerParamCount; ++i) {
      const bool is_pan = (i % kMixerParamsPerInput) == 1;
      state->params[static_cast<size_t>(i)].store(is_pan ? 0.0f : 1.0f,
                                                  std::memory_order_relaxed);
    }
  }
  if (kind == graph::BlockKind::kSplitter) {
    state->param_count = kSplitterParamCount;
    for (int i = 0; i < kSplitterParamCount; ++i) {
      state->params[static_cast<size_t>(i)].store(1.0f, std::memory_order_relaxed);
    }
  }
  // kMixer/kSplitter are handled above - they keep std::monostate but now carry
  // the per-port level/pan params, unlike the original design where neither was
  // a DSP effect kind and both had param_count 0.

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

// Remove a block and, through the rig, every edge that touched it. Not
// real-time safe: it frees the DSP object and rewrites the routing tables.
void AudioEngine::RemoveBlock(BlockId id) {
  rig_.RemoveBlock(GraphIdOf(id));
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
            d.SetInputLevel(state.params[kAmpInputLevelParam].load(std::memory_order_relaxed));
          }
          if (state.amp_output_level_active.load(std::memory_order_relaxed)) {
            d.SetOutputLevel(state.params[kAmpOutputLevelParam].load(std::memory_order_relaxed));
          }
          // Slim size deliberately NOT reapplied here - NamAmp::SetSlimSize
          // is documented as not real-time safe (NAMCore may reallocate).
          // SetParam() below applies it synchronously and immediately
          // instead, off this hot path.
          //
          // The tone stack is real-time safe, so it is driven from here like
          // any other param: SetGainDb early-returns when a band's value
          // hasn't changed, so re-asserting all four per buffer is free.
          for (int band = 0; band < kAmpToneBandCount; ++band) {
            state.tone.SetGainDb(
                static_cast<dsp::ToneStack::Band>(band),
                state.params[static_cast<size_t>(kAmpBassParam + band)].load(
                    std::memory_order_relaxed));
          }
        } else if constexpr (!std::is_same_v<T, std::monostate>) {
          for (int i = 0; i < state.param_count; ++i) {
            d.SetParam(i, state.params[static_cast<size_t>(i)].load(std::memory_order_relaxed));
          }
        }
      },
      state.dsp);
}

// Run one block's DSP over its input buffers into its output buffers. The
// std::visit inlines to a switch over the variant's alternatives - no virtual
// dispatch on the audio path. Real-time safe.
void AudioEngine::RunDsp(BlockState& state, int num_frames) {
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
            d.Process(state.input_l[0].data(), state.output_l.data(), num_frames);
          } else {
            std::copy_n(state.input_l[0].data(), num_frames, state.output_l.data());
          }
          state.tone.Process(state.output_l.data(), num_frames);
          std::copy_n(state.output_l.data(), num_frames, state.output_r.data());
        } else if constexpr (std::is_same_v<T, std::monostate>) {
          std::copy_n(state.input_l[0].data(), num_frames, state.output_l.data());
          std::copy_n(state.input_r[0].data(), num_frames, state.output_r.data());
          if (state.kind == graph::BlockKind::kCab && state.cab[0].HasImpulseResponse()) {
            // Convolve into the output buffers and blend the dry signal back in.
            // Skipping the blend entirely at mix == 1 keeps the common
            // fully-wet case free of a pointless pass over the buffer.
            const float mix =
                std::clamp(state.params[kCabMixParam].load(std::memory_order_relaxed), 0.0f, 1.0f);
            state.cab[0].Process(state.output_l.data(), num_frames);
            state.cab[1].Process(state.output_r.data(), num_frames);
            if (mix != 1.0f) {
              const float dry = 1.0f - mix;
              for (int i = 0; i < num_frames; ++i) {
                state.output_l[static_cast<size_t>(i)] =
                    mix * state.output_l[static_cast<size_t>(i)] +
                    dry * state.input_l[0][static_cast<size_t>(i)];
                state.output_r[static_cast<size_t>(i)] =
                    mix * state.output_r[static_cast<size_t>(i)] +
                    dry * state.input_r[0][static_cast<size_t>(i)];
              }
            }
          }
          // Every other monostate kind (unwrapped effects, Mixer - already summed
          // into port 0 by the caller - and Splitter) is a plain passthrough.
        } else {
          const float* in_ptrs[2] = {state.input_l[0].data(), state.input_r[0].data()};
          float* out_ptrs[2] = {state.output_l.data(), state.output_r.data()};
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

  for (const BlockId id : exec_order_) {
    BlockState& state = *block_states_.at(id);
    if (static_cast<int>(state.output_l.size()) < num_frames) continue;  // not yet Reset - stay silent

    const int ports = static_cast<int>(state.input_l.size());
    for (int p = 0; p < ports; ++p) {
      std::fill_n(state.input_l[static_cast<size_t>(p)].begin(), num_frames, 0.0f);
      std::fill_n(state.input_r[static_cast<size_t>(p)].begin(), num_frames, 0.0f);
    }

    for (const RoutingEdge& edge : routing_) {
      if (edge.to != id) continue;
      const float* src_l = nullptr;
      const float* src_r = nullptr;
      float src_gain = 1.0f;  // a splitter's per-output level, applied per fan-out port
      if (edge.from == kInRailId) {
        src_l = ext_in_l_.data();
        src_r = ext_in_r_.data();
      } else {
        const BlockState* source = FindBlock(edge.from);
        if (!source || static_cast<int>(source->output_l.size()) < num_frames) continue;
        src_l = source->output_l.data();
        src_r = source->output_r.data();
        if (source->kind == graph::BlockKind::kSplitter) {
          const int out_port = std::clamp(edge.from_port, 0, kSplitterParamCount - 1);
          src_gain =
              source->params[static_cast<size_t>(out_port)].load(std::memory_order_relaxed);
        }
      }
      const int port = std::clamp(edge.to_port, 0, ports - 1);
      if (src_gain == 1.0f) {
        for (int i = 0; i < num_frames; ++i) {
          state.input_l[static_cast<size_t>(port)][static_cast<size_t>(i)] += src_l[i];
          state.input_r[static_cast<size_t>(port)][static_cast<size_t>(i)] += src_r[i];
        }
      } else {
        for (int i = 0; i < num_frames; ++i) {
          state.input_l[static_cast<size_t>(port)][static_cast<size_t>(i)] += src_l[i] * src_gain;
          state.input_r[static_cast<size_t>(port)][static_cast<size_t>(i)] += src_r[i] * src_gain;
        }
      }
    }

    if (state.kind == graph::BlockKind::kMixer) {
      // Per-input level and equal-power pan (unity at centre), matching the
      // web MixerBlock's per-input GainNode + StereoPanner and giving both
      // paths identical DSP. Applied to each independent input jack before
      // they're summed into port 0.
      constexpr float kPanScale = 1.41421356f;  // sqrt(2) - normalises the equal-power law to unity at pan=0
      for (int p = 0; p < ports; ++p) {
        const int base = p * kMixerParamsPerInput;
        const float level = state.params[static_cast<size_t>(base)].load(std::memory_order_relaxed);
        const float pan = state.params[static_cast<size_t>(base + 1)].load(std::memory_order_relaxed);
        if (level == 1.0f && pan == 0.0f) continue;  // untouched port - free
        const float a = (pan + 1.0f) * 0.78539816f;  // (pan+1) * pi/4
        const float gl = std::cos(a) * kPanScale;
        const float gr = std::sin(a) * kPanScale;
        for (int i = 0; i < num_frames; ++i) {
          state.input_l[static_cast<size_t>(p)][static_cast<size_t>(i)] *= level * gl;
          state.input_r[static_cast<size_t>(p)][static_cast<size_t>(i)] *= level * gr;
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
    // level staging.
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
      ApplyRealtimeParams(state);
      RunDsp(state, num_frames);
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
int AudioEngine::ParamCount(BlockId id) const {
  const BlockState* state = FindBlockThreadSafe(id);
  return state ? state->param_count : 0;
}

// Name/symbol/range/unit for one param, or nullopt for an unknown block, an
// out-of-range index, or a block with no DSP. The descriptor's strings are
// static storage owned by the DSP wrappers, so they outlive any caller - which
// is what lets them cross the extern "C" boundary as bare const char*.
std::optional<ParamDescriptor> AudioEngine::ParamInfo(BlockId id, int index) const {
  const BlockState* state = FindBlockThreadSafe(id);
  if (!state || index < 0 || index >= state->param_count) return std::nullopt;

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
          if (state->kind == graph::BlockKind::kCab) {
            // Generated from packages/core/param_schema.json (issue #51) - run
            // scripts/gen-param-schema.mjs after editing the schema.
            static constexpr ParamDescriptor kCabParams[kCabParamCount] = {
#include "dsp/generated/engine_cab_params.inc"
            };
            return kCabParams[index];
          }
          if (state->kind == graph::BlockKind::kMixer) {
            static constexpr ParamDescriptor kMixerParams[kMixerParamCount] = {
#include "dsp/generated/engine_mixer_params.inc"
            };
            return kMixerParams[index];
          }
          if (state->kind == graph::BlockKind::kSplitter) {
            static constexpr ParamDescriptor kSplitterParams[kSplitterParamCount] = {
#include "dsp/generated/engine_splitter_params.inc"
            };
            return kSplitterParams[index];
          }
          return std::nullopt;
        } else {
          const auto& info = T::GetParamInfo(index);
          return ParamDescriptor{info.name, info.symbol, info.min_value, info.max_value, info.unit};
        }
      },
      state->dsp);
}

// Read one param from the atomic mirror (not from the DSP object, which may
// have transformed it). Real-time safe, callable from any thread.
float AudioEngine::GetParam(BlockId id, int index) const {
  const BlockState* state = FindBlockThreadSafe(id);
  if (!state || index < 0 || index >= state->param_count) return 0.0f;
  return state->params[static_cast<size_t>(index)].load(std::memory_order_relaxed);
}

// Write one param into the atomic mirror; Process() applies it to the DSP on
// the next buffer. Real-time safe and callable from any thread - with one
// documented exception, the amp's slim size, which reallocates inside NAMCore
// and is therefore applied here, synchronously, instead of on the audio thread.
// (That one call must not be made concurrently with Process; the bridge routes
// it through its suspend handshake.)
//
// Out-of-range indices and unknown blocks are silently ignored: param tables
// change shape when a model loads or a reverb algorithm switches, so a UI can
// legitimately be one message behind.
void AudioEngine::SetParam(BlockId id, int index, float value) {
  BlockState* state = FindBlockThreadSafe(id);
  if (!state || index < 0 || index >= state->param_count) return;
  state->params[static_cast<size_t>(index)].store(value, std::memory_order_relaxed);

  if (IsAmpFamily(state->kind)) {
    if (index == kAmpInputLevelParam) {
      state->amp_input_level_active.store(true, std::memory_order_relaxed);
    } else if (index == kAmpOutputLevelParam) {
      state->amp_output_level_active.store(true, std::memory_order_relaxed);
    } else if (index == kAmpSlimSizeParam) {
      // Not real-time safe - matches NamAmp::SetSlimSize's own contract.
      // Applied synchronously here rather than deferred to Process().
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

  if (auto err = amp->LoadModel(file_path)) return err;
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

  if (auto err = amp->LoadModelFromJson(json_text)) return err;
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
void AudioEngine::LoadIr(BlockId id, const float* samples, int length) {
  BlockState* state = FindBlock(id);
  if (!state || state->kind != graph::BlockKind::kCab) return;
  for (auto& conv : state->cab) conv.SetImpulseResponse(samples, length);
}

// Decode a WAV file, match it to the engine's sample rate, and install it. The
// decode and the resample both happen here rather than in each front end so a
// 44.1kHz cab IR in a 48kHz session sounds the same everywhere.
int AudioEngine::LoadIrWav(BlockId id, const uint8_t* bytes, size_t size) {
  BlockState* state = FindBlock(id);
  if (!state || state->kind != graph::BlockKind::kCab) return 0;

  const auto decoded = dsp::DecodeWav(bytes, size);
  if (!decoded || decoded->samples.empty()) return 0;

  const std::vector<float> samples =
      sample_rate_ > 0.0 ? dsp::ResampleMono(decoded->samples, decoded->sample_rate, sample_rate_)
                         : decoded->samples;
  if (samples.empty()) return 0;

  for (auto& conv : state->cab) {
    conv.SetImpulseResponse(samples.data(), static_cast<int>(samples.size()));
  }
  return static_cast<int>(samples.size());
}

// Drop the IR; the block goes back to passing audio through.
void AudioEngine::UnloadIr(BlockId id) {
  BlockState* state = FindBlock(id);
  if (!state || state->kind != graph::BlockKind::kCab) return;
  for (auto& conv : state->cab) conv.Clear();
}

// Length of the installed IR in samples, 0 when there is none.
int AudioEngine::IrLength(BlockId id) const {
  const BlockState* state = FindBlockThreadSafe(id);
  if (!state || state->kind != graph::BlockKind::kCab) return 0;
  return state->cab[0].ImpulseResponseLength();
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

// Apply one user-facing reverb control to whatever algorithm currently backs
// the block: scale the two abstractions (room size -> decay, damping -> high
// cut) and then resolve the control to the first symbol this algorithm actually
// has, clamped into that param's declared range. Real-time safe - it ends in
// the same atomic SetParam a raw index write would.
void AudioEngine::SetReverbControl(BlockId id, ReverbControl control, float value) {
  const BlockState* state = FindBlockThreadSafe(id);
  if (!state || state->kind != graph::BlockKind::kReverb) return;

  float scaled = value;
  if (control == ReverbControl::kRoomSize) {
    const float t = std::clamp(value, 0.0f, kRoomSizeMax) / kRoomSizeMax;
    scaled = kDecayMinSeconds + t * (kDecayMaxSeconds - kDecayMinSeconds);
  } else if (control == ReverbControl::kDamping) {
    const float t = std::clamp(value, 0.0f, 1.0f);
    scaled = kHighCutMaxHz - t * (kHighCutMaxHz - kHighCutMinHz);
  }

  for (const char* symbol : ReverbControlSymbols(control)) {
    for (int i = 0; i < state->param_count; ++i) {
      const std::optional<ParamDescriptor> info = ParamInfo(id, i);
      if (!info || !info->symbol || std::strcmp(info->symbol, symbol) != 0) continue;
      SetParam(id, i, std::clamp(scaled, info->min_value, info->max_value));
      return;
    }
  }
}

// Swap which Dragonfly algorithm backs a reverb block. This *replaces* the DSP
// object, so it allocates and is not real-time safe - algorithm choice is a
// deliberate user action, not automation. The new object is re-prepared at the
// engine's current sample rate and its own defaults are seeded into the param
// mirror, because each algorithm has a different param table (which is also why
// a UI should drive reverb through SetReverbControl rather than raw indices).
void AudioEngine::SetReverbAlgorithm(BlockId id, ReverbAlgorithm algorithm) {
  BlockState* state = FindBlock(id);
  if (!state || state->kind != graph::BlockKind::kReverb) return;

  switch (algorithm) {
    case ReverbAlgorithm::kHall:
      state->dsp.emplace<dsp::DragonflyHallReverb>();
      state->param_count = dsp::DragonflyHallReverb::ParamCount();
      break;
    case ReverbAlgorithm::kRoom:
      state->dsp.emplace<dsp::DragonflyRoomReverb>();
      state->param_count = dsp::DragonflyRoomReverb::ParamCount();
      break;
    case ReverbAlgorithm::kPlate:
      state->dsp.emplace<dsp::DragonflyPlateReverb>();
      state->param_count = dsp::DragonflyPlateReverb::ParamCount();
      break;
    case ReverbAlgorithm::kEarlyReflections:
      state->dsp.emplace<dsp::DragonflyEarlyReflections>();
      state->param_count = dsp::DragonflyEarlyReflections::ParamCount();
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

  delay->SetModel(model);
  // Reset param_count in case it changes (it doesn't currently — same count
  // for all models — but kept for parity with other model-switch methods).
  state->param_count = dsp::Delay::ParamCount();
  SeedParamsFromDsp(*state);
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

}  // namespace nam_studio::engine
