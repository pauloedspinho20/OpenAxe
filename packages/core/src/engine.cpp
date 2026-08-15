#include "nam_studio/engine.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <type_traits>
#include <variant>

#include "nam_studio/dsp/diode_clipper.h"
#include "nam_studio/dsp/dragonfly_early_reflections.h"
#include "nam_studio/dsp/dragonfly_hall_reverb.h"
#include "nam_studio/dsp/dragonfly_plate_reverb.h"
#include "nam_studio/dsp/dragonfly_room_reverb.h"

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

int PortCountFor(graph::BlockKind kind) {
  return kind == graph::BlockKind::kMixer ? graph::kMixerInputCount : 1;
}

using DspVariant = std::variant<std::monostate, dsp::NamAmp, dsp::DragonflyHallReverb,
                                 dsp::DragonflyRoomReverb, dsp::DragonflyPlateReverb,
                                 dsp::DragonflyEarlyReflections, dsp::DiodeClipper>;

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

std::string AudioEngine::GraphIdOf(BlockId id) {
  if (id == kInRailId) return graph::kInRail;
  if (id == kOutRailId) return graph::kOutRail;
  return std::to_string(id);
}

BlockId AudioEngine::ParseGraphId(const std::string& graph_id) {
  if (graph_id == graph::kInRail) return kInRailId;
  if (graph_id == graph::kOutRail) return kOutRailId;
  return static_cast<BlockId>(std::stoi(graph_id));
}

AudioEngine::BlockState* AudioEngine::FindBlock(BlockId id) {
  auto it = block_states_.find(id);
  return it != block_states_.end() ? it->second.get() : nullptr;
}

const AudioEngine::BlockState* AudioEngine::FindBlock(BlockId id) const {
  auto it = block_states_.find(id);
  return it != block_states_.end() ? it->second.get() : nullptr;
}

void AudioEngine::EnsureBuffers(BlockState& state) {
  const int ports = PortCountFor(state.kind);
  state.input_l.assign(ports, std::vector<float>(static_cast<size_t>(max_block_size_), 0.0f));
  state.input_r.assign(ports, std::vector<float>(static_cast<size_t>(max_block_size_), 0.0f));
  state.output_l.assign(static_cast<size_t>(max_block_size_), 0.0f);
  state.output_r.assign(static_cast<size_t>(max_block_size_), 0.0f);
}

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

int AudioEngine::ColumnOfBlock(BlockId id) const {
  if (id == kInRailId) return -1;
  if (id == kOutRailId) return graph::kGridCols;
  const auto pos = rig_.GetBlockPosition(GraphIdOf(id));
  return pos ? pos->col : graph::kGridCols;
}

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

BlockId AudioEngine::AddBlock(graph::BlockKind kind, int row, int col) {
  const BlockId id = next_block_id_++;
  rig_.AddBlock(kind, row, col, GraphIdOf(id));

  auto state = std::make_unique<BlockState>();
  state->kind = kind;
  if (IsAmpFamily(kind)) {
    state->dsp.emplace<dsp::NamAmp>();
    state->param_count = 2;  // input level, output level; +1 (slim size) once a slimmable model loads
  } else if (kind == graph::BlockKind::kReverb) {
    state->dsp.emplace<dsp::DragonflyHallReverb>();  // default algorithm; see SetReverbAlgorithm
    state->param_count = dsp::DragonflyHallReverb::ParamCount();
    SeedParamsFromDsp(*state);
  } else if (kind == graph::BlockKind::kDrive) {
    state->dsp.emplace<dsp::DiodeClipper>();  // default model; see SetDriveModel
    state->param_count = dsp::DiodeClipper::ParamCount();
    SeedParamsFromDsp(*state);
  }
  // Every other kind stays std::monostate (passthrough) with param_count 0 -
  // LSP/AnalogTapeModel/BYOD's other 43+ effects aren't wrapped yet (see
  // packages/core/README.md).

  if (max_block_size_ > 0) EnsureBuffers(*state);
  block_states_.emplace(id, std::move(state));
  RecomputeRouting();
  return id;
}

void AudioEngine::RemoveBlock(BlockId id) {
  rig_.RemoveBlock(GraphIdOf(id));
  block_states_.erase(id);
  RecomputeRouting();
}

void AudioEngine::MoveBlock(BlockId id, int row, int col) {
  rig_.MoveBlock(GraphIdOf(id), row, col);
  RecomputeRouting();
}

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

void AudioEngine::Disconnect(EdgeId id) {
  rig_.Disconnect(GraphIdOf(id));
  RecomputeRouting();
}

// ── Lifecycle / processing ─────────────────────────────────────────────

void AudioEngine::Reset(double sample_rate, int max_block_size) {
  sample_rate_ = sample_rate;
  max_block_size_ = max_block_size;

  for (auto& [id, state] : block_states_) {
    EnsureBuffers(*state);
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
        } else if constexpr (!std::is_same_v<T, std::monostate>) {
          for (int i = 0; i < state.param_count; ++i) {
            d.SetParam(i, state.params[static_cast<size_t>(i)].load(std::memory_order_relaxed));
          }
        }
      },
      state.dsp);
}

void AudioEngine::RunDsp(BlockState& state, int num_frames) {
  std::visit(
      [&](auto& d) {
        using T = std::decay_t<decltype(d)>;
        if constexpr (std::is_same_v<T, dsp::NamAmp>) {
          // Mono model, stereo internal representation: process channel 0,
          // duplicate to both output channels.
          d.Process(state.input_l[0].data(), state.output_l.data(), num_frames);
          std::copy_n(state.output_l.data(), num_frames, state.output_r.data());
        } else if constexpr (std::is_same_v<T, std::monostate>) {
          // Passthrough: unwrapped effect kinds, Mixer (already summed into
          // port 0 by the caller), Splitter, Cab.
          std::copy_n(state.input_l[0].data(), num_frames, state.output_l.data());
          std::copy_n(state.input_r[0].data(), num_frames, state.output_r.data());
        } else {
          const float* in_ptrs[2] = {state.input_l[0].data(), state.input_r[0].data()};
          float* out_ptrs[2] = {state.output_l.data(), state.output_r.data()};
          d.Process(in_ptrs, out_ptrs, num_frames);
        }
      },
      state.dsp);
}

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
      if (edge.from == kInRailId) {
        src_l = ext_in_l_.data();
        src_r = ext_in_r_.data();
      } else {
        const BlockState* source = FindBlock(edge.from);
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
      for (int p = 1; p < ports; ++p) {
        for (int i = 0; i < num_frames; ++i) {
          state.input_l[0][static_cast<size_t>(i)] += state.input_l[static_cast<size_t>(p)][static_cast<size_t>(i)];
          state.input_r[0][static_cast<size_t>(i)] += state.input_r[static_cast<size_t>(p)][static_cast<size_t>(i)];
        }
      }
    }

    ApplyRealtimeParams(state);
    RunDsp(state, num_frames);

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

  for (int i = 0; i < num_frames; ++i) {
    const float l = final_l ? final_l[i] : 0.0f;
    const float r = final_r ? final_r[i] : 0.0f;
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

int AudioEngine::ParamCount(BlockId id) const {
  const BlockState* state = FindBlock(id);
  return state ? state->param_count : 0;
}

std::optional<ParamDescriptor> AudioEngine::ParamInfo(BlockId id, int index) const {
  const BlockState* state = FindBlock(id);
  if (!state || index < 0 || index >= state->param_count) return std::nullopt;

  return std::visit(
      [&](const auto& d) -> std::optional<ParamDescriptor> {
        using T = std::decay_t<decltype(d)>;
        if constexpr (std::is_same_v<T, dsp::NamAmp>) {
          // Approximate/normalized ranges - NamAmp's own calibration units
          // are dBu/x, not a fixed hardware surface with published bounds.
          static constexpr ParamDescriptor kAmpParams[3] = {
              {"Input Level", "input_level", -100.0f, 100.0f, "dBu"},
              {"Output Level", "output_level", -100.0f, 100.0f, "dBu"},
              {"Slim Size", "slim_size", 0.0f, 1.0f, "x"},
          };
          return kAmpParams[index];
        } else if constexpr (std::is_same_v<T, std::monostate>) {
          return std::nullopt;
        } else {
          const auto& info = T::GetParamInfo(index);
          return ParamDescriptor{info.name, info.symbol, info.min_value, info.max_value, info.unit};
        }
      },
      state->dsp);
}

float AudioEngine::GetParam(BlockId id, int index) const {
  const BlockState* state = FindBlock(id);
  if (!state || index < 0 || index >= state->param_count) return 0.0f;
  return state->params[static_cast<size_t>(index)].load(std::memory_order_relaxed);
}

void AudioEngine::SetParam(BlockId id, int index, float value) {
  BlockState* state = FindBlock(id);
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

std::optional<dsp::NamLoadError> AudioEngine::LoadNamModel(BlockId id, const std::string& file_path) {
  BlockState* state = FindBlock(id);
  if (!state) return dsp::NamLoadError::kFileNotFound;
  auto* amp = std::get_if<dsp::NamAmp>(&state->dsp);
  if (!amp) return dsp::NamLoadError::kFileNotFound;

  if (auto err = amp->LoadModel(file_path)) return err;
  if (max_block_size_ > 0) amp->Reset(sample_rate_, max_block_size_);

  const auto& info = amp->ModelInfo();
  state->amp_input_level_active.store(info.has_input_level, std::memory_order_relaxed);
  state->amp_output_level_active.store(info.has_output_level, std::memory_order_relaxed);
  state->params[kAmpInputLevelParam].store(
      info.has_input_level ? static_cast<float>(info.input_level_dbu) : 0.0f, std::memory_order_relaxed);
  state->params[kAmpOutputLevelParam].store(
      info.has_output_level ? static_cast<float>(info.output_level_dbu) : 0.0f,
      std::memory_order_relaxed);
  state->param_count = info.is_slimmable ? 3 : 2;
  if (info.is_slimmable) {
    state->params[kAmpSlimSizeParam].store(static_cast<float>(amp->SlimSize()), std::memory_order_relaxed);
  }
  return std::nullopt;
}

void AudioEngine::UnloadNamModel(BlockId id) {
  BlockState* state = FindBlock(id);
  if (!state) return;
  auto* amp = std::get_if<dsp::NamAmp>(&state->dsp);
  if (!amp) return;
  amp->UnloadModel();
  state->param_count = 2;
  state->amp_input_level_active.store(false, std::memory_order_relaxed);
  state->amp_output_level_active.store(false, std::memory_order_relaxed);
}

bool AudioEngine::BlockHasModel(BlockId id) const {
  const BlockState* state = FindBlock(id);
  if (!state) return false;
  const auto* amp = std::get_if<dsp::NamAmp>(&state->dsp);
  return amp && amp->HasModel();
}

// ── Reverb algorithm choice ─────────────────────────────────────────────

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

// ── Drive model choice ──────────────────────────────────────────────────

void AudioEngine::SetDriveModel(BlockId id, DriveModel model) {
  BlockState* state = FindBlock(id);
  if (!state || state->kind != graph::BlockKind::kDrive) return;

  switch (model) {
    case DriveModel::kDiodeClipper:
      state->dsp.emplace<dsp::DiodeClipper>();
      state->param_count = dsp::DiodeClipper::ParamCount();
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

// ── Metering ────────────────────────────────────────────────────────────

float AudioEngine::GetMeter(BlockId id) const {
  const BlockState* state = FindBlock(id);
  return state ? state->meter.load(std::memory_order_relaxed) : 0.0f;
}

float AudioEngine::GetCpuLoad() const { return cpu_load_.load(std::memory_order_relaxed); }

}  // namespace nam_studio::engine
