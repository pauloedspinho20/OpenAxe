#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <shared_mutex>
#include <string>
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

// Hard ceilings on user-supplied asset bytes reaching the DSP core - issue
// #69's numbers, now enforced here so every front end (and above all the
// state loader, whose embedded payloads arrive from untrusted project files,
// #120) inherits them rather than re-deriving them. A .nam model JSON may be
// 32 MiB; a cab IR WAV 8 MiB. Loaders reject anything larger.
inline constexpr size_t kMaxModelBytes = 32u * 1024u * 1024u;
inline constexpr size_t kMaxIrBytes = 8u * 1024u * 1024u;

// ── Automation slot map (issue #121) ─────────────────────────────────────
// VST3/AU/CLAP hosts require a fixed parameter list declared once at
// construction with ids that persist across sessions, but rigs are dynamic
// grids addressed by (block_id, index). A fixed pool of slots mediates:
// hosts automate (slot, entry) pairs whose meaning resolves through whatever
// block is currently bound to that slot. The numbers below mirror
// packages/core/param_schema.json's "pluginAutomation" section - the single
// source of truth, from which packages/vst3/generated/automation_param_map.h
// is generated and static_asserts these very constants agree.
//
// Both numbers are frozen API surface: changing either remaps every host
// parameter id (a saved DAW project's lanes would land elsewhere). See
// packages/vst3/README.md's design note before touching them.
inline constexpr int kAutomationSlotCount = 16;
// Frozen stride with headroom over today's widest table (reverb-hall, 18).
inline constexpr int kAutomationParamsPerSlot = 20;
// Slot 0 is permanently the master bus - it never binds to a block.
inline constexpr int kMasterAutomationSlot = 0;

// Slot 0's fixed descriptors, verbatim copies of the schema section's
// masterSlot.params (the generated header asserts they agree element-wise).
// Values cross the ABI normalized 0..1 and map linearly onto [min, max].
inline constexpr int kMasterAutomationParamCount = 2;
inline constexpr const char* kMasterAutomationSymbols[kMasterAutomationParamCount] = {"level",
                                                                                       "muted"};
inline constexpr const char* kMasterAutomationLabels[kMasterAutomationParamCount] = {
    "Master Level", "Master Mute"};
inline constexpr float kMasterAutomationMin[kMasterAutomationParamCount] = {0.0f, 0.0f};
inline constexpr float kMasterAutomationMax[kMasterAutomationParamCount] = {1.5f, 1.0f};
inline constexpr const char* kMasterAutomationUnits[kMasterAutomationParamCount] = {"x", ""};

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

// One block's placeable state, copied out for callers that enumerate the rig
// (state serialization today; anything else tomorrow) without touching the
// engine's internals. id is the engine's own int id.
struct BlockSnapshot {
  BlockId id;
  graph::BlockKind kind;
  int row;
  int col;
};

// One edge's endpoints as int ids (rails use their kInRailId/kOutRailId
// sentinels), same purpose as BlockSnapshot.
struct EdgeSnapshot {
  EdgeId id;
  BlockId from_block;
  int from_port;
  BlockId to_block;
  int to_port;
};

// A block's retained asset source, copied out for state serialization (#120):
// the exact bytes the current asset was loaded from, plus whatever name/path
// metadata travelled with it. `json` is the .nam document for amp-family
// blocks, `wav_bytes` the WAV file bytes for cab blocks; name is a display
// label and path the best-effort source location (both empty when unknown -
// e.g. anything loaded through nam_studio_load_nam_model_json). Returned by
// value: multi-megabyte copies, but serialization is a control-thread call
// and the alternative hands out pointers into engine-owned storage.
struct ModelAssetSource {
  std::string json;
  std::string name;
  std::string path;
};

struct IrAssetSource {
  std::vector<uint8_t> wav_bytes;
  std::string name;
  std::string path;
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

  // ── Rig-state enumeration / clearing (issue #119) ─────────────────────
  // Everything state (de)serialization needs that isn't already reachable
  // through the per-block accessors below. All control-thread only - none of
  // it is real-time safe (ListBlocks/ListEdges allocate; ClearTopology frees).
  // Every block, sorted by id for deterministic output. Rails are never
  // included.
  std::vector<BlockSnapshot> ListBlocks() const;
  // Every edge, sorted by id for deterministic output.
  std::vector<EdgeSnapshot> ListEdges() const;
  // Removes every block (and with them every edge). Ids keep counting - they
  // are never reused within an engine's lifetime. LoadState uses this to
  // rebuild the rig from a document, mirroring applyPreset's clear-first
  // behaviour.
  void ClearTopology();

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

  // ── Per-block state readers for serialization (issue #119) ───────────
  // The algorithm/model choices are not params - they decide which DSP object
  // backs the block - so they need their own getters. Defaults (kHall /
  // kDigital) for unknown ids and for blocks of other kinds, mirroring how
  // AddBlock seeds new blocks.
  ReverbAlgorithm GetReverbAlgorithm(BlockId id) const;
  dsp::Delay::Model GetDelayModel(BlockId id) const;

  // Whether an amp-family block's input/output-level param currently holds a
  // value worth serializing: true when the loaded model itself defined the
  // calibration or the caller wrote it explicitly, false when the slot is
  // empty. Serialization skips these two symbols while inactive, because
  // restoring them would flip the active flag and fabricate a dBu override
  // over whatever model gets loaded later.
  bool IsAmpInputLevelActive(BlockId id) const;
  bool IsAmpOutputLevelActive(BlockId id) const;

  // ── Asset-source retention for state embedding (issue #120) ──────────
  // What serialization needs to make a saved rig self-contained. Both are
  // control-thread reads that copy out retained source bytes (see the struct
  // comments); nullopt when the block doesn't exist, is the wrong kind, or
  // has no asset loaded.
  std::optional<ModelAssetSource> BlockModelAsset(BlockId id) const;
  std::optional<IrAssetSource> BlockIrAsset(BlockId id) const;

  // Record display name / source path metadata alongside a block's current
  // asset. The state loader calls these after restoring from a document so a
  // re-serialization reproduces it byte for byte (a payload-restored model
  // keeps the name/path the document recorded, not nothing). No-op for
  // unknown ids or wrong kinds; not real-time safe.
  void SetModelSourceInfo(BlockId id, const std::string& name, const std::string& path);
  void SetIrSourceInfo(BlockId id, const std::string& name, const std::string& path);

  // ── Automation slots (issue #121) ──────────────────────────────────────
  // The stable (slot, entry) surface plugin hosts automate instead of raw
  // (block_id, index). See the constants above and packages/vst3/README.md's
  // design note for the full model; in short:
  //
  //  - Slot 0 is permanently the master bus: its kMasterAutomationParamCount
  //    entries are level/mute, resolved against the master bus itself.
  //  - Slots 1..kAutomationSlotCount-1 bind to one live block each. Entry i of
  //    a bound slot IS index i of that block's param table - display name,
  //    range and unit resolve dynamically via ParamInfo, so hosts get generic
  //    "Param N" placeholders at construction and real titles once bound
  //    (formats' title-change notifications cover the swap).
  //  - Values cross this boundary normalized 0..1 and map linearly onto the
  //    resolved param's [min, max]. Writes go through to the bound block
  //    immediately; reads resolve live from it, so web/bridge knob moves show
  //    up on the host side too.
  //  - Each slot remembers the last normalized value written through it. On
  //    rebind, only those remembered entries are applied onto the new target
  //    through ITS ranges - an automation lane's value survives rebinding to
  //    a different kind without jumping, and untouched params keep whatever
  //    the newly-bound block already had.
  //
  // Bind/unbind/list are control-thread calls (they mutate slot bookkeeping,
  // which Process() never touches); param get/set are lock-free like their
  // (block, index) counterparts and safe from host parameter threads.

  // Binds `slot` to `block` and returns true. Rejects the master slot
  // (permanently the bus), out-of-range slots, and unknown blocks.
  bool BindAutomationSlot(int slot, BlockId block);
  // Clears a binding. The slot's remembered values survive for a later
  // rebind. Refuses slot 0; false for out-of-range slots and slot 0.
  bool UnbindAutomationSlot(int slot);
  // Block currently bound to `slot`, or -1 if unbound / -2 if the slot is
  // out of range. Slot 0 reports -3: not bindable, not "unbound".
  BlockId AutomationSlotBlock(int slot) const;
  // How many live entries `slot` exposes: the master slot's fixed count, the
  // frozen stride for block slots (entries beyond the bound block's own param
  // count resolve to nothing), 0 for out-of-range slots.
  int AutomationSlotParamCount(int slot) const;
  // Dynamic descriptor for one entry - the bound block's ParamInfo, or the
  // master slot's fixed descriptors, or nullopt when the entry resolves to
  // nothing (unbound slot, entry beyond the block's table, bad indices).
  std::optional<ParamDescriptor> AutomationParamInfo(int slot, int entry) const;
  // Write one entry, normalized 0..1 (clamped). Goes through to the bound
  // target immediately where one resolves; always updates the slot's
  // remembered value either way.
  void SetAutomationParamNormalized(int slot, int entry, float value);
  // Read one entry as 0..1: live from the bound target where one resolves,
  // otherwise the slot's remembered value.
  float GetAutomationParamNormalized(int slot, int entry) const;

  // Every currently-bound block slot (never the master slot), ascending by
  // slot number - what serialization walks. Control-thread only.
  struct AutomationSlotSnapshot {
    int slot;
    BlockId block;
  };
  std::vector<AutomationSlotSnapshot> ListBoundAutomationSlots() const;

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
  void RunDsp(BlockState& state, int start, int num_frames);
  // Copy the schema-derived smoothing policy + the live ramp state for `state`
  // from its current param mirror (issue #122). Called on the control thread
  // whenever the param surface changes - AddBlock, reverb algorithm switch,
  // model load - so the first block after a change eases from the current
  // value rather than from zero.
  void SeedSmoothing(BlockState& state);
  // How many sub-blocks to split a buffer into for the SetParam-style ramp
  // (generic DSP wrappers and the amp tone stack). See definition in engine.cpp.
  static int SubBlocksForSmoothing(int num_frames, double sample_rate, const BlockState& state);
  // Advance a splitter's fan-out ramps by one buffer and freeze the snapshot
  // its consumers replay from (issue #122). See definition in engine.cpp.
  static void PublishSplitterRamps(BlockState& state, int num_frames, double sample_rate);

  // One automation slot's bookkeeping (issue #121). `mirror` holds this
  // slot's last known normalized value per entry - written through the slot,
  // or refreshed from the bound block when read (hence mutable: it's a
  // cache of observable truth, not part of the engine's logical const state).
  // `dirty` flags entries actually written through the slot, and ONLY those
  // re-apply onto a newly bound target - so rebinding carries an automation
  // lane's position without stomping untouched params of the new block.
  // Process() never reads any of this - control-thread data.
  struct AutomationSlotState {
    bool bound = false;
    BlockId block = -1;
    mutable float mirror[kAutomationParamsPerSlot] = {};
    bool dirty[kAutomationParamsPerSlot] = {};
  };
  // Pushes the slot's remembered values into its bound block (no-op entries:
  // unbound, param index beyond the block's table). Shared by Bind and Set.
  void ApplySlotMirror(AutomationSlotState& state);

  // Rebuilds exec_order_ (blocks sorted by column) and routing_ (flattened
  // edges) from rig_'s current topology. Called after every topology
  // mutation; never called from Process().
  void RecomputeRouting();
  int ColumnOfBlock(BlockId id) const;
  static BlockId ParseGraphId(const std::string& graph_id);
  static std::string GraphIdOf(BlockId id);

  graph::GraphRig rig_;
  std::unordered_map<BlockId, std::unique_ptr<BlockState>> block_states_;  // Guards block_states_ against AddBlock/RemoveBlock (control thread, write)
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
  // Incoming edges grouped per exec_order_ block (incoming_[i] holds every
  // edge whose destination is exec_order_[i]), built alongside routing_ in
  // RecomputeRouting(). Process()'s per-block hot loop iterates only
  // incoming_[bi] instead of rescanning the whole flat routing_ (issue #66),
  // turning the routing walk from O(B·E) into O(E). Same lifecycle/threading
  // guarantees as routing_: only ever read by Process(), rebuilt under the
  // suspend handshake on every topology change.
  std::vector<std::vector<RoutingEdge>> incoming_;
  std::vector<float> ext_in_l_;
  std::vector<float> ext_in_r_;

  // The automation slot pool (issue #121), index == slot number. Slot 0 is
  // the master bus and stays permanently unbound - its entries resolve
  // against master level/mute without touching this state's block field.
  std::array<AutomationSlotState, kAutomationSlotCount> automation_slots_;
};

}  // namespace nam_studio::engine
