#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <optional>
#include <shared_mutex>
#include <unordered_map>
#include <vector>

#include "nam_studio/block.h"
#include "nam_studio/dsp/delay.h"
#include "nam_studio/dsp/nam_amp.h"
#include "nam_studio/graph_rig.h"

// The real-time audio wiring layer graph_rig.h's own doc comment defers to a
// "separate later concern" - this is that layer. GraphRig stays exactly as
// merged in #28 (topology bookkeeping only, string ids); AudioEngine wraps
// one, adding a live DSP object per block, pre-allocated per-block buffers,
// and the actual sample-by-sample signal routing extern "C" needs.
//
// Four DSP families are wrapped anywhere in this codebase yet: NamAmp
// (backs the 5 structurally-identical "gear" kinds), the 4 Dragonfly reverb
// algorithms (all back the single kReverb kind - algorithm choice is a
// per-block setting this layer owns, see SetReverbAlgorithm), the
// hand-written modulation/delay wrappers (kChorus/kFlanger/kPhaser/kDelay/
// kPingPongDelay), and the DSPark-based dynamics/EQ wrappers (kCompressor/
// kEq/kNoiseGate/kTremolo - issue #22's last four still-native effect
// kinds). kCab/kMixer/kSplitter pass audio through unchanged rather than
// erroring - none of them are a DSP effect kind, so a full rig is
// buildable/testable today with no gap to fill in.
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

// The user-facing reverb controls, as a UI presents them - deliberately not a
// 1:1 view of any single algorithm's param table. Dragonfly's four algorithms
// expose overlapping but differently-named and differently-shaped controls
// (Hall's pre-delay is `delay`, Room's is `predelay`, Early Reflections has
// none; damping is `high_cut` on Hall/Plate/ER but `in_high_cut` on Room),
// and two of the controls are abstractions with no core symbol at all
// (kRoomSize maps onto decay time, kDamping onto the high cut). Resolving all
// of that lives here, in one place, so every front end - the web worklet, the
// desktop bridge, a future VST3 editor - drives the same mapping instead of
// each reimplementing it. Controls an algorithm doesn't have are no-ops.
enum class ReverbControl {
  kRoomSize,   // 0..0.97, mapped onto the algorithm's decay time (0.1..10s)
  kDamping,    // 0..1, mapped onto the algorithm's high cut (16000..1000Hz)
  kWidth,      // percent
  kPredelay,   // ms
  kSpin,       // Hz
  kWander,     // ms
  kEarlySend,  // percent
  kDryLevel,   // percent
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

  // Same, from the .nam file's JSON content in memory - the form a browser or a
  // plugin restoring host state has (see dsp::NamAmp::LoadModelFromJson).
  std::optional<dsp::NamLoadError> LoadNamModelJson(BlockId id, const std::string& json_text);
  void UnloadNamModel(BlockId id);
  bool BlockHasModel(BlockId id) const;

  // Metadata of the capture loaded into an amp-family block, or nullopt for
  // unknown blocks, non-amp kinds and blocks with no model. Returned by value:
  // the caller may outlive the next load, and this crosses into the ABI layer.
  std::optional<dsp::NamModelInfo> BlockModelInfo(BlockId id) const;

  // Install an impulse response on a kCab block: mono float samples at the
  // engine's own sample rate (nothing is resampled here - a caller holding a
  // 44.1kHz IR for a 48kHz graph should resample first). Passing nullptr or
  // length <= 0 clears it, which returns the block to passthrough. No-op for
  // every other kind. Not real-time safe: it allocates and transforms the IR.
  void LoadIr(BlockId id, const float* samples, int length);

  // Install an IR from the bytes of a WAV file, decoding and - if the file's rate
  // differs from the engine's - resampling it first. Returns the number of
  // samples installed, or 0 if the block isn't a cab or the file can't be
  // decoded. This is the entry point for every platform without an
  // AudioContext.decodeAudioData to lean on (desktop, plugin, mobile). Not
  // real-time safe.
  int LoadIrWav(BlockId id, const uint8_t* bytes, size_t size);
  void UnloadIr(BlockId id);
  // Length of the IR installed on the block, 0 if none (or not a cab).
  int IrLength(BlockId id) const;

  // Only meaningful for kReverb blocks; no-op otherwise. Not real-time
  // safe - reconstructs the underlying wrapper instance.
  void SetReverbAlgorithm(BlockId id, ReverbAlgorithm algorithm);

  // Apply one user-facing reverb control to whichever algorithm currently
  // backs the block (see ReverbControl). No-op for non-reverb blocks and for
  // controls the current algorithm doesn't have. Real-time safe: it resolves
  // to the same atomic param store SetParam writes.
  void SetReverbControl(BlockId id, ReverbControl control, float value);

  // Only meaningful for kDelay blocks; no-op otherwise. Not real-time safe.
  void SetDelayModel(BlockId id, dsp::Delay::Model model);

  // ── Bypass / master bus (real-time safe, lock-free) ──────────────────
  // No-op if id is unknown. While bypassed, the block's DSP is skipped and
  // its port-0 input passes through to its output unchanged.
  void SetBypass(BlockId id, bool bypassed);
  bool IsBypassed(BlockId id) const;

  // Per-block I/O staging gain, 1.0 = unity. These are the user-facing
  // Input/Output trims every block kind shows in the UI - deliberately NOT
  // the Amp family's input_level/output_level params, which carry the NAM
  // model's own dBu calibration and must not be repurposed as a volume
  // control. Applied to the block's summed port-0 input and to its output
  // whether or not the block is bypassed, since they stage what enters and
  // leaves the block rather than what its DSP does.
  void SetInputTrim(BlockId id, float gain);
  float GetInputTrim(BlockId id) const;
  void SetOutputTrim(BlockId id, float gain);
  float GetOutputTrim(BlockId id) const;

  // Scales the final output bus (post-graph, pre-host). 1.0 = unity.
  void SetMasterLevel(float level);
  float GetMasterLevel() const;
  // Independent of master level and of SetTunerMuted - the output bus is
  // silent while either mute source is set, so toggling one off doesn't
  // clobber the other's state.
  void SetMasterMuted(bool muted);
  bool IsMasterMuted() const;
  void SetTunerMuted(bool muted);
  bool IsTunerMuted() const;

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

  // Unguarded: only for Process()'s routing loop (the audio thread), which
  // relies on the suspend handshake around AddBlock/RemoveBlock (not this
  // mutex) to guarantee block_states_ never mutates while Process() runs.
  BlockState* FindBlock(BlockId id);
  const BlockState* FindBlock(BlockId id) const;
  // Guarded by block_states_mutex_: for the generic param/meter accessors
  // (ParamCount/ParamInfo/GetParam/SetParam/GetMeter), which the bridge calls
  // directly from the webview thread - bypassing the control-thread executor
  // entirely for latency - so they need their own protection against
  // AddBlock/RemoveBlock running concurrently on the control thread (issue
  // #52: found by a stress test hammering both at once under ThreadSanitizer).
  // Only guards the map lookup itself (a shared/read lock either way); the
  // returned pointer's atomic members are safe to mutate concurrently on
  // their own.
  BlockState* FindBlockThreadSafe(BlockId id);
  const BlockState* FindBlockThreadSafe(BlockId id) const;
  void EnsureBuffers(BlockState& state);
  void SeedParamsFromDsp(BlockState& state);
  // Shared tail of LoadNamModel/LoadNamModelJson - see the definition.
  void AdoptLoadedModel(BlockState& state, dsp::NamAmp& amp);
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
  // Guards block_states_ against AddBlock/RemoveBlock (control thread, write)
  // racing FindBlockThreadSafe (webview thread, read) - see its doc comment.
  // Never taken by Process()/FindBlock() on the audio thread.
  mutable std::shared_mutex block_states_mutex_;
  BlockId next_block_id_ = 0;
  EdgeId next_edge_id_ = 0;
  double sample_rate_ = 48000.0;
  int max_block_size_ = 0;
  std::atomic<float> cpu_load_{0.0f};
  std::atomic<float> master_level_{1.0f};
  std::atomic<bool> master_muted_{false};
  std::atomic<bool> tuner_muted_{false};

  std::vector<BlockId> exec_order_;
  std::vector<RoutingEdge> routing_;
  std::vector<float> ext_in_l_;
  std::vector<float> ext_in_r_;
};

}  // namespace nam_studio::engine
