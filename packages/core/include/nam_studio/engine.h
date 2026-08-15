#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <optional>
#include <unordered_map>
#include <vector>

#include "nam_studio/block.h"
#include "nam_studio/dsp/nam_amp.h"
#include "nam_studio/graph_rig.h"

// The real-time audio wiring layer graph_rig.h's own doc comment defers to a
// "separate later concern" - this is that layer. GraphRig stays exactly as
// merged in #28 (topology bookkeeping only, string ids); AudioEngine wraps
// one, adding a live DSP object per block, pre-allocated per-block buffers,
// and the actual sample-by-sample signal routing extern "C" needs.
//
// Only two DSP families are wrapped anywhere in this codebase yet: NamAmp
// (backs the 5 structurally-identical "gear" kinds) and the 4 Dragonfly
// reverb algorithms (all back the single kReverb kind - algorithm choice is
// a new per-block setting this layer owns, see SetReverbAlgorithm). Every
// other kind passes audio through unchanged rather than erroring, so a full
// rig is buildable/testable today; wiring in real DSP as those libraries
// get wrapped (AnalogTapeModel, BYOD, LSP) is purely additive later.
namespace nam_studio::engine {

// Int ids only at this layer - portable across C/WASM/FFI, no string
// ownership questions crossing the extern "C" boundary. Translated to
// GraphRig's string ids internally via std::to_string.
using BlockId = int32_t;
using EdgeId = int32_t;

// Reserved sentinels for the two rail endpoints (never real block ids -
// AddBlock never returns these).
inline constexpr BlockId kInRailId = -1;
inline constexpr BlockId kOutRailId = -2;

enum class ReverbAlgorithm {
  kHall,
  kRoom,
  kPlate,
  kEarlyReflections,
};

struct ParamDescriptor {
  const char* name;
  const char* symbol;
  float min_value;
  float max_value;
  const char* unit;
};

struct ConnectOutcome {
  bool ok = false;
  EdgeId id = -1;  // valid iff ok
};

// Not real-time safe: constructs/destroys DSP objects, allocates buffers,
// parses model files. Callers must not invoke these concurrently with
// Process() - there is no real host driving this from an audio thread yet
// (native tests only), so full lock-free topology mutation is a documented
// follow-up, not attempted here.
//
// Process() itself IS real-time safe once Reset() has been called: no
// allocation, only atomic param loads and buffer copies/DSP calls.
class AudioEngine {
 public:
  AudioEngine();
  ~AudioEngine();
  AudioEngine(const AudioEngine&) = delete;
  AudioEngine& operator=(const AudioEngine&) = delete;

  // ── Topology ──────────────────────────────────────────────────────────
  BlockId AddBlock(graph::BlockKind kind, int row, int col);
  void RemoveBlock(BlockId id);                       // no-op if unknown
  void MoveBlock(BlockId id, int row, int col);        // no-op if unknown
  ConnectOutcome Connect(BlockId from_block, int from_port, BlockId to_block, int to_port);
  void Disconnect(EdgeId id);                          // no-op if unknown

  // ── Lifecycle / processing ───────────────────────────────────────────
  // (Re)allocates every block's scratch buffers and resets every live DSP
  // object. Must be called at least once before Process(), and again
  // whenever sample_rate/max_block_size change or the topology changes.
  void Reset(double sample_rate, int max_block_size);

  // Real-time safe. input/output are `channels`-length arrays of
  // num_frames-sample buffers; channels may be 1 or 2 regardless of the
  // graph's internal (always-stereo) representation - mono input duplicates
  // to both internal channels, mono output averages the internal stereo
  // down. num_frames must be <= the max_block_size passed to Reset().
  void Process(const float* const* input, int input_channels, float* const* output,
               int output_channels, int num_frames);

  // ── Params (generic, lock-free) ──────────────────────────────────────
  int ParamCount(BlockId id) const;
  std::optional<ParamDescriptor> ParamInfo(BlockId id, int index) const;
  float GetParam(BlockId id, int index) const;
  void SetParam(BlockId id, int index, float value);

  // ── NAM model management (off the audio thread) ─────────────────────
  std::optional<dsp::NamLoadError> LoadNamModel(BlockId id, const std::string& file_path);
  void UnloadNamModel(BlockId id);
  bool BlockHasModel(BlockId id) const;

  // Only meaningful for kReverb blocks; no-op otherwise. Not real-time
  // safe - reconstructs the underlying wrapper instance.
  void SetReverbAlgorithm(BlockId id, ReverbAlgorithm algorithm);

  // ── Metering ──────────────────────────────────────────────────────────
  float GetMeter(BlockId id) const;   // peak |sample| over the last Process() call, 0 if unknown
  float GetCpuLoad() const;           // fraction of real-time budget the last Process() call used

 private:
  struct BlockState;  // defined in engine.cpp (holds the live-DSP variant)

  // A flattened, pre-resolved copy of one GraphRig edge (int ids instead of
  // Jack/string), rebuilt by RecomputeRouting() whenever topology changes so
  // Process() only ever reads it - no GraphRig lookups or allocation on the
  // real-time path.
  struct RoutingEdge {
    BlockId from;
    int from_port;
    BlockId to;
    int to_port;
  };

  BlockState* FindBlock(BlockId id);
  const BlockState* FindBlock(BlockId id) const;
  void EnsureBuffers(BlockState& state);
  void SeedParamsFromDsp(BlockState& state);
  void ApplyRealtimeParams(BlockState& state);
  void RunDsp(BlockState& state, int num_frames);

  // Rebuilds exec_order_ (blocks sorted by column) and routing_ (flattened
  // edges) from rig_'s current topology. Called after every topology
  // mutation; never called from Process().
  void RecomputeRouting();
  int ColumnOfBlock(BlockId id) const;
  static BlockId ParseGraphId(const std::string& graph_id);
  static std::string GraphIdOf(BlockId id);

  graph::GraphRig rig_;
  std::unordered_map<BlockId, std::unique_ptr<BlockState>> block_states_;
  BlockId next_block_id_ = 0;
  EdgeId next_edge_id_ = 0;
  double sample_rate_ = 48000.0;
  int max_block_size_ = 0;
  std::atomic<float> cpu_load_{0.0f};

  std::vector<BlockId> exec_order_;
  std::vector<RoutingEdge> routing_;
  std::vector<float> ext_in_l_;
  std::vector<float> ext_in_r_;
};

}  // namespace nam_studio::engine
