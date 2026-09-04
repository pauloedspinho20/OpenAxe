#include "openaxe/api.h"

#include <algorithm>
#include <cstring>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "openaxe/dsp/fingerprint.h"
#include "openaxe/dsp/note_utils.h"
#include "openaxe/dsp/pitch_detect.h"
#include "openaxe/engine.h"
#include "openaxe/generated/enabled_blocks.h"
#include "openaxe/midi.h"
#include "openaxe/rig_switch.h"
#include "serialization/rig_state.h"

namespace {

// Explicit switches (not ordinal-identity casts) so openaxe::graph's own
// enums stay free to reorder/extend independently of this public C surface.
openaxe::graph::BlockKind ToBlockKind(OpenAxeBlockKind kind) {
  using openaxe::graph::BlockKind;
  switch (kind) {
    case OPENAXE_BLOCK_NOISE_GATE:
      return BlockKind::kNoiseGate;
    case OPENAXE_BLOCK_COMPRESSOR:
      return BlockKind::kCompressor;
    case OPENAXE_BLOCK_EQ:
      return BlockKind::kEq;
    case OPENAXE_BLOCK_CHORUS:
      return BlockKind::kChorus;
    case OPENAXE_BLOCK_FLANGER:
      return BlockKind::kFlanger;
    case OPENAXE_BLOCK_PHASER:
      return BlockKind::kPhaser;
    case OPENAXE_BLOCK_TREMOLO:
      return BlockKind::kTremolo;
    case OPENAXE_BLOCK_DELAY:
      return BlockKind::kDelay;
    case OPENAXE_BLOCK_REVERB:
      return BlockKind::kReverb;
    case OPENAXE_BLOCK_AMP:
      return BlockKind::kAmp;
    case OPENAXE_BLOCK_AMP_CAB:
      return BlockKind::kAmpCab;
    case OPENAXE_BLOCK_PEDAL:
      return BlockKind::kPedal;
    case OPENAXE_BLOCK_OUTBOARD:
      return BlockKind::kOutboard;
    case OPENAXE_BLOCK_SPACE:
      return BlockKind::kSpace;
    case OPENAXE_BLOCK_CAB:
      return BlockKind::kCab;
    case OPENAXE_BLOCK_MIXER:
      return BlockKind::kMixer;
    case OPENAXE_BLOCK_RING_MOD:
      return BlockKind::kRingMod;
    case OPENAXE_BLOCK_FILTER:
      return BlockKind::kFilter;
    case OPENAXE_BLOCK_PITCH_SHIFTER:
      return BlockKind::kPitchShifter;
    case OPENAXE_BLOCK_GRANULAR_DELAY:
      return BlockKind::kGranularDelay;
    case OPENAXE_BLOCK_ROTARY:
      return BlockKind::kRotary;
    case OPENAXE_BLOCK_SEND_1:
      return BlockKind::kSend1;
    case OPENAXE_BLOCK_RETURN_1:
      return BlockKind::kReturn1;
    case OPENAXE_BLOCK_SEND_2:
      return BlockKind::kSend2;
    case OPENAXE_BLOCK_RETURN_2:
      return BlockKind::kReturn2;
  }
  return BlockKind::kCab;  // unreachable for a valid enum value
}

// ABI enum -> engine enum. The two are kept separate deliberately: the C enum
// is a stable wire format for JS/FFI callers, so the engine's own enum can be
// reordered without breaking anyone.
openaxe::engine::ReverbAlgorithm ToReverbAlgorithm(OpenAxeReverbAlgorithm algorithm) {
  using openaxe::engine::ReverbAlgorithm;
  switch (algorithm) {
    case OPENAXE_REVERB_HALL:
      return ReverbAlgorithm::kHall;
    case OPENAXE_REVERB_ROOM:
      return ReverbAlgorithm::kRoom;
    case OPENAXE_REVERB_PLATE:
      return ReverbAlgorithm::kPlate;
    case OPENAXE_REVERB_EARLY_REFLECTIONS:
      return ReverbAlgorithm::kEarlyReflections;
    case OPENAXE_REVERB_SPRING:
      return ReverbAlgorithm::kSpring;
  }
  return ReverbAlgorithm::kHall;  // unreachable for a valid enum value
}

// Engine load error -> ABI result code. std::nullopt (success) becomes
// OPENAXE_LOAD_OK, since exceptions can't cross extern "C".
OpenAxeLoadResult ToLoadResult(std::optional<openaxe::dsp::NamLoadError> error) {
  if (!error) return OPENAXE_LOAD_OK;
  switch (*error) {
    case openaxe::dsp::NamLoadError::kFileNotFound:
      return OPENAXE_LOAD_FILE_NOT_FOUND;
    case openaxe::dsp::NamLoadError::kInvalidFormat:
      return OPENAXE_LOAD_INVALID_FORMAT;
  }
  return OPENAXE_LOAD_INVALID_FORMAT;  // unreachable for a valid enum value
}

}  // namespace

struct OpenAxeGraph {
  // Live-engine ownership lives in the switcher (issue #367): the current
  // engine rotates on commit, and retired engines park in its freelist for
  // reuse rather than being freed where another thread might still hold the
  // pointer - see rig_switch.cpp's ownership comment. Every call below that
  // used to touch a by-value engine now resolves through LiveEngine().
  std::unique_ptr<openaxe::switcher::RigSwitch> switch_;
  // Staged handles only (see openaxe_staged_graph_create): the engine under
  // construction, consumed by openaxe_staged_graph_commit. Null on parents.
  std::unique_ptr<openaxe::engine::AudioEngine> engine;
  // The missing-asset list (#120) from the most recent load_state, kept for
  // the query ABI below. Control-thread data like everything else here.
  std::vector<std::string> missing_assets;
  // Likewise the unsupported-kind list (#313) - kinds the document named that
  // this build cannot place.
  std::vector<std::string> unsupported_blocks;
  // Non-null on staged handles: the parent this handle stages for. Commit
  // verifies it, so a foreign handle can never be smuggled in.
  OpenAxeGraph* staged_parent = nullptr;
  // Sample rate / max block size from the last openaxe_reset on THIS handle,
  // plus whether openaxe_reset was ever called on it. Commit requires parent
  // and staged to agree - the fade mixes their outputs sample-wise, so a
  // rate/size mismatch (or a staged engine that was never reset, whose
  // blocks have no buffers) would be wrong, not just degraded.
  double sample_rate = 48000.0;
  int max_block_size = 0;
  bool did_reset = false;
};

// Resolves the engine an API call targets: a staged handle's engine under
// construction (stable, owned by the handle), or the parent's current live
// engine (atomic load - always dereferenceable, see rig_switch.cpp).
// Every Tier-1 call routes through here so param/meter/mute writes land on
// the engine that is actually rendering - including right after a commit.
openaxe::engine::AudioEngine* LiveEngine(OpenAxeGraph* graph) {
  if (graph->engine) return graph->engine.get();  // staged handle
  return graph->switch_->Current();
}

extern "C" {

OpenAxeGraph* openaxe_graph_create(void) {
  auto* graph = new (std::nothrow) OpenAxeGraph();
  if (!graph) return nullptr;
  graph->switch_ = std::make_unique<openaxe::switcher::RigSwitch>();
  return graph;
}

void openaxe_graph_destroy(OpenAxeGraph* graph) { delete graph; }

// ── Topology ────────────────────────────────────────────────────────────
// Thin forwarders onto AudioEngine (see engine.h for the semantics and
// api.h for the caller-facing contract). None of them are real-time safe:
// they allocate and rewrite the routing tables, so the host must suspend
// audio around them - which is precisely why they are grouped and labelled
// here rather than mixed in with the lock-free calls further down.
//
// Returns the new block's id, which is never reused - or -1 if this build has
// no DSP for `kind` (effects.config.json's compiled:false; ask
// openaxe_block_kind_compiled first, or just don't offer the kind).
int32_t openaxe_add_block(OpenAxeGraph* graph, OpenAxeBlockKind kind, int32_t row, int32_t col) {
  return LiveEngine(graph)->AddBlock(ToBlockKind(kind), row, col);
}

// Removes the block and every edge touching it. Unknown ids are a no-op.
void openaxe_remove_block(OpenAxeGraph* graph, int32_t block_id) {
  LiveEngine(graph)->RemoveBlock(block_id);
}

// Moves a block; a move that would make an existing cable run right-to-left
// silently drops that cable (query the edges afterwards to resync a UI).
void openaxe_move_block(OpenAxeGraph* graph, int32_t block_id, int32_t row, int32_t col) {
  LiveEngine(graph)->MoveBlock(block_id, row, col);
}

int32_t openaxe_connect(OpenAxeGraph* graph, int32_t from_block, int32_t from_port,
                            int32_t to_block, int32_t to_port) {
  const auto outcome = LiveEngine(graph)->Connect(from_block, from_port, to_block, to_port);
  return outcome.ok ? outcome.id : -1;
}

void openaxe_disconnect(OpenAxeGraph* graph, int32_t edge_id) { LiveEngine(graph)->Disconnect(edge_id); }

// ── Lifecycle / processing ─────────────────────────────────────────────
// Arms the whole graph for a sample rate and maximum block size. Allocates;
// call before the first openaxe_process and after any change to either. On
// the parent handle this also abandons any in-flight switch (pending commit
// and draining engine park in the freelist) - Tier-2 context required, like
// every other structural call.
void openaxe_reset(OpenAxeGraph* graph, double sample_rate, int32_t max_block_size) {
  graph->sample_rate = sample_rate;
  graph->max_block_size = max_block_size;
  graph->did_reset = true;
  if (graph->switch_) graph->switch_->Clear();
  LiveEngine(graph)->Reset(sample_rate, max_block_size);
}

void openaxe_process(OpenAxeGraph* graph, const float* const* input, int32_t input_channels,
                         float* const* output, int32_t output_channels, int32_t num_frames) {
  if (graph->switch_) {
    graph->switch_->Process(input, input_channels, output, output_channels, num_frames);
  } else {
    LiveEngine(graph)->Process(input, input_channels, output, output_channels, num_frames);
  }
}

// ── Gapless staged switching (issue #367) ───────────────────────────────
// See api.h for the contract. The staged build reuses every existing entry
// point above (add/remove/connect, params, model/IR loads, reset,
// load_state) - they resolve to the staged engine through LiveEngine().

OpenAxeGraph* openaxe_staged_graph_create(OpenAxeGraph* parent) {
  if (!parent || !parent->switch_) return nullptr;
  auto* staged = new (std::nothrow) OpenAxeGraph();
  if (!staged) return nullptr;
  staged->engine = parent->switch_->TakeStagedEngine();
  staged->staged_parent = parent;
  staged->sample_rate = parent->sample_rate;
  staged->max_block_size = parent->max_block_size;
  return staged;
}

int32_t openaxe_staged_graph_commit(OpenAxeGraph* parent, OpenAxeGraph* staged, int32_t fade_ms,
                                    int32_t drain_ms) {
  // 1 = committed (the staged handle is consumed - do not touch it again);
  // 0 = rejected, staged still yours (null/foreign/unreset/rate mismatch);
  // -1 = busy, a switch is already in flight (staged still yours - retry).
  if (!parent || !staged || !staged->engine || staged->staged_parent != parent) return 0;
  if (!parent->switch_) return 0;  // cannot commit onto a staged handle
  if (!staged->did_reset || staged->max_block_size <= 0) return 0;
  if (staged->sample_rate != parent->sample_rate) return 0;
  if (staged->max_block_size != parent->max_block_size) return 0;
  if (!parent->switch_->Commit(staged->engine, parent->sample_rate, parent->max_block_size,
                               fade_ms, drain_ms)) {
    return -1;
  }
  delete staged;
  return 1;
}

int32_t openaxe_switch_active(OpenAxeGraph* graph) {
  return (graph && graph->switch_ && graph->switch_->Active()) ? 1 : 0;
}

// ── Params ──────────────────────────────────────────────────────────────
// Param count for a block, 0 if unknown. Can change at runtime: loading a
// slimmable NAM model adds a param, and each reverb algorithm has its own
// table, so re-read this after either.
int32_t openaxe_block_param_count(OpenAxeGraph* graph, int32_t block_id) {
  return LiveEngine(graph)->ParamCount(block_id);
}

int32_t openaxe_block_param_info(OpenAxeGraph* graph, int32_t block_id, int32_t index,
                                     const char** out_name, const char** out_symbol, float* out_min,
                                     float* out_max, const char** out_unit) {
  const auto info = LiveEngine(graph)->ParamInfo(block_id, index);
  if (!info) return 0;
  if (out_name) *out_name = info->name;
  if (out_symbol) *out_symbol = info->symbol;
  if (out_min) *out_min = info->min_value;
  if (out_max) *out_max = info->max_value;
  if (out_unit) *out_unit = info->unit;
  return 1;
}

// Reads/writes one param by index. Both are lock-free and safe to call from
// any thread, including concurrently with openaxe_process - the one
// exception being the amp family's slim-size param, which reallocates inside
// NAMCore (see AudioEngine::SetParam).
float openaxe_get_param(OpenAxeGraph* graph, int32_t block_id, int32_t index) {
  return LiveEngine(graph)->GetParam(block_id, index);
}

// Writes one param (see the note on openaxe_get_param above).
void openaxe_set_param(OpenAxeGraph* graph, int32_t block_id, int32_t index, float value) {
  LiveEngine(graph)->SetParam(block_id, index, value);
}

OpenAxeLoadResult openaxe_load_nam_model(OpenAxeGraph* graph, int32_t block_id,
                                               const char* file_path) {
  return ToLoadResult(LiveEngine(graph)->LoadNamModel(block_id, file_path));
}

// Loads from the model's JSON content instead of a path - see api.h.
OpenAxeLoadResult openaxe_load_nam_model_json(OpenAxeGraph* graph, int32_t block_id,
                                                   const char* json) {
  if (!json) return OPENAXE_LOAD_INVALID_FORMAT;
  return ToLoadResult(LiveEngine(graph)->LoadNamModelJson(block_id, json));
}

// Drops the block's model (it becomes a passthrough). Frees; suspend audio.
void openaxe_unload_nam_model(OpenAxeGraph* graph, int32_t block_id) {
  LiveEngine(graph)->UnloadNamModel(block_id);
}

// 1 if an amp-family block currently has a capture loaded, else 0.
int32_t openaxe_block_has_model(OpenAxeGraph* graph, int32_t block_id) {
  return LiveEngine(graph)->BlockHasModel(block_id) ? 1 : 0;
}

void openaxe_set_reverb_algorithm(OpenAxeGraph* graph, int32_t block_id,
                                      OpenAxeReverbAlgorithm algorithm) {
  LiveEngine(graph)->SetReverbAlgorithm(block_id, ToReverbAlgorithm(algorithm));
}

// Installs / clears / reports a cab block's impulse response - see api.h.
void openaxe_load_ir(OpenAxeGraph* graph, int32_t block_id, const float* samples,
                        int32_t frames) {
  LiveEngine(graph)->LoadIr(block_id, samples, frames);
}

int32_t openaxe_load_ir_wav(OpenAxeGraph* graph, int32_t block_id, const uint8_t* bytes,
                               int32_t size) {
  if (!bytes || size <= 0) return 0;
  return LiveEngine(graph)->LoadIrWav(block_id, bytes, static_cast<size_t>(size));
}

void openaxe_unload_ir(OpenAxeGraph* graph, int32_t block_id) {
  LiveEngine(graph)->UnloadIr(block_id);
}

int32_t openaxe_block_ir_length(OpenAxeGraph* graph, int32_t block_id) {
  return LiveEngine(graph)->IrLength(block_id);
}

void openaxe_set_reverb_control(OpenAxeGraph* graph, int32_t block_id,
                                   OpenAxeReverbControl control, float value) {
  using openaxe::engine::ReverbControl;
  ReverbControl mapped = ReverbControl::kRoomSize;
  switch (control) {
    case OPENAXE_REVERB_ROOM_SIZE: mapped = ReverbControl::kRoomSize; break;
    case OPENAXE_REVERB_DAMPING: mapped = ReverbControl::kDamping; break;
    case OPENAXE_REVERB_WIDTH: mapped = ReverbControl::kWidth; break;
    case OPENAXE_REVERB_PREDELAY: mapped = ReverbControl::kPredelay; break;
    case OPENAXE_REVERB_SPIN: mapped = ReverbControl::kSpin; break;
    case OPENAXE_REVERB_WANDER: mapped = ReverbControl::kWander; break;
    case OPENAXE_REVERB_EARLY_SEND: mapped = ReverbControl::kEarlySend; break;
    case OPENAXE_REVERB_DRY_LEVEL: mapped = ReverbControl::kDryLevel; break;
    default: return;
  }
  LiveEngine(graph)->SetReverbControl(block_id, mapped, value);
}

void openaxe_set_delay_model(OpenAxeGraph* graph, int32_t block_id,
                                 OpenAxeDelayModel model) {
  using openaxe::dsp::Delay;
  Delay::Model m = Delay::Model::kDigital;
  switch (model) {
    case OPENAXE_DELAY_DIGITAL: m = Delay::Model::kDigital; break;
    case OPENAXE_DELAY_ANALOG:  m = Delay::Model::kAnalog; break;
    case OPENAXE_DELAY_TAPE:    m = Delay::Model::kTape; break;
  }
  LiveEngine(graph)->SetDelayModel(block_id, m);
}

// Metadata of the block's loaded capture; every out-param is optional. See
// api.h for what each field means and when it is meaningful.
int32_t openaxe_block_model_info(OpenAxeGraph* graph, int32_t block_id, double* out_sample_rate,
                                    int32_t* out_has_loudness, double* out_loudness_db,
                                    int32_t* out_has_input_level, double* out_input_level_dbu,
                                    int32_t* out_has_output_level, double* out_output_level_dbu,
                                    int32_t* out_is_slimmable, int32_t* out_slim_breakpoint_count) {
  const auto info = LiveEngine(graph)->BlockModelInfo(block_id);
  if (!info) return 0;
  if (out_sample_rate) *out_sample_rate = info->sample_rate;
  if (out_has_loudness) *out_has_loudness = info->has_loudness ? 1 : 0;
  if (out_loudness_db) *out_loudness_db = info->loudness_db;
  if (out_has_input_level) *out_has_input_level = info->has_input_level ? 1 : 0;
  if (out_input_level_dbu) *out_input_level_dbu = info->input_level_dbu;
  if (out_has_output_level) *out_has_output_level = info->has_output_level ? 1 : 0;
  if (out_output_level_dbu) *out_output_level_dbu = info->output_level_dbu;
  if (out_is_slimmable) *out_is_slimmable = info->is_slimmable ? 1 : 0;
  if (out_slim_breakpoint_count) {
    *out_slim_breakpoint_count = static_cast<int32_t>(info->slim_size_breakpoints.size());
  }
  return 1;
}

// Copies the slim-size breakpoints out into caller-owned storage; returns how
// many were written.
int32_t openaxe_block_model_slim_breakpoints(OpenAxeGraph* graph, int32_t block_id,
                                                double* out_values, int32_t max_count) {
  const auto info = LiveEngine(graph)->BlockModelInfo(block_id);
  if (!info || !out_values || max_count <= 0) return 0;
  const int32_t count =
      std::min(static_cast<int32_t>(info->slim_size_breakpoints.size()), max_count);
  for (int32_t i = 0; i < count; ++i) out_values[i] = info->slim_size_breakpoints[static_cast<size_t>(i)];
  return count;
}

// ── Bypass / trims / master bus ────────────────────────────────────────
// Everything below is lock-free and callable from any thread, including
// concurrently with openaxe_process.
void openaxe_set_bypass(OpenAxeGraph* graph, int32_t block_id, int32_t bypassed) {
  LiveEngine(graph)->SetBypass(block_id, bypassed != 0);
}

// 1 while the block is bypassed, else 0.
int32_t openaxe_is_bypassed(OpenAxeGraph* graph, int32_t block_id) {
  return LiveEngine(graph)->IsBypassed(block_id) ? 1 : 0;
}

// Input-side trim, applied to the block's summed input. 1.0 = unity.
void openaxe_set_block_input_trim(OpenAxeGraph* graph, int32_t block_id, float gain) {
  LiveEngine(graph)->SetInputTrim(block_id, gain);
}

// The per-block I/O trims - see api.h for why these are not the amp family's
// input_level/output_level params.
float openaxe_get_block_input_trim(OpenAxeGraph* graph, int32_t block_id) {
  return LiveEngine(graph)->GetInputTrim(block_id);
}

// Output-side trim, applied after the block's DSP (or its bypass copy).
void openaxe_set_block_output_trim(OpenAxeGraph* graph, int32_t block_id, float gain) {
  LiveEngine(graph)->SetOutputTrim(block_id, gain);
}

// Current output trim, 1.0 for unknown blocks.
float openaxe_get_block_output_trim(OpenAxeGraph* graph, int32_t block_id) {
  return LiveEngine(graph)->GetOutputTrim(block_id);
}

// The output bus: level, master mute, and the independent tuner mute.
void openaxe_set_master_level(OpenAxeGraph* graph, float level) {
  LiveEngine(graph)->SetMasterLevel(level);
}

float openaxe_get_master_level(OpenAxeGraph* graph) { return LiveEngine(graph)->GetMasterLevel(); }

// Master mute; independent of the tuner mute below.
void openaxe_set_master_muted(OpenAxeGraph* graph, int32_t muted) {
  LiveEngine(graph)->SetMasterMuted(muted != 0);
}

// 1 while the master mute is engaged, else 0.
int32_t openaxe_is_master_muted(OpenAxeGraph* graph) {
  return LiveEngine(graph)->IsMasterMuted() ? 1 : 0;
}

// Tuner mute - a second mute source, so a tuner overlay can silence the
// output without disturbing the user's master mute.
void openaxe_set_tuner_muted(OpenAxeGraph* graph, int32_t muted) {
  LiveEngine(graph)->SetTunerMuted(muted != 0);
}

// 1 while the tuner mute is engaged, else 0.
int32_t openaxe_is_tuner_muted(OpenAxeGraph* graph) {
  return LiveEngine(graph)->IsTunerMuted() ? 1 : 0;
}

// ── Metering ────────────────────────────────────────────────────────────
// Peak |sample| over the block's last processed buffer, 0 for unknown ids.
float openaxe_get_meter(OpenAxeGraph* graph, int32_t block_id) {
  return LiveEngine(graph)->GetMeter(block_id);
}

float openaxe_get_cpu_load(OpenAxeGraph* graph) { return LiveEngine(graph)->GetCpuLoad(); }

float openaxe_get_gain_reduction(OpenAxeGraph* graph, int32_t block_id) {
  return LiveEngine(graph)->GetGainReduction(block_id);
}

float openaxe_get_gate_gain(OpenAxeGraph* graph, int32_t block_id) {
  return LiveEngine(graph)->GetGateGain(block_id);
}

// ── MIDI mapping (issue #124) ─────────────────────────────────────────
// Thin forwarders onto the MIDI model. Helpers are pure functions; the rest
// delegates to AudioEngine's MIDI state (see engine.h for the threading
// contract — mutations are control-thread only, Handle is any-thread).

namespace {

openaxe::midi::MessageType ToMidiMessageType(OpenAxeMidiMessageType t) {
  switch (t) {
    case OPENAXE_MIDI_NOTEON: return openaxe::midi::MessageType::kNoteOn;
    case OPENAXE_MIDI_CC: return openaxe::midi::MessageType::kCc;
    case OPENAXE_MIDI_PC: return openaxe::midi::MessageType::kPc;
  }
  return openaxe::midi::MessageType::kCc;
}
OpenAxeMidiMessageType FromMidiMessageType(openaxe::midi::MessageType t) {
  switch (t) {
    case openaxe::midi::MessageType::kNoteOn: return OPENAXE_MIDI_NOTEON;
    case openaxe::midi::MessageType::kCc: return OPENAXE_MIDI_CC;
    case openaxe::midi::MessageType::kPc: return OPENAXE_MIDI_PC;
  }
  return OPENAXE_MIDI_CC;
}
openaxe::midi::ActionKind ToMidiActionKind(OpenAxeMidiActionKind k) {
  switch (k) {
    case OPENAXE_MIDI_ACTION_SLOT: return openaxe::midi::ActionKind::kSlot;
    case OPENAXE_MIDI_ACTION_SCENE: return openaxe::midi::ActionKind::kScene;
    case OPENAXE_MIDI_ACTION_NEXT_SCENE: return openaxe::midi::ActionKind::kNextScene;
    case OPENAXE_MIDI_ACTION_PREV_SCENE: return openaxe::midi::ActionKind::kPrevScene;
  }
  return openaxe::midi::ActionKind::kSlot;
}
OpenAxeMidiActionKind FromMidiActionKind(openaxe::midi::ActionKind k) {
  switch (k) {
    case openaxe::midi::ActionKind::kSlot: return OPENAXE_MIDI_ACTION_SLOT;
    case openaxe::midi::ActionKind::kScene: return OPENAXE_MIDI_ACTION_SCENE;
    case openaxe::midi::ActionKind::kNextScene: return OPENAXE_MIDI_ACTION_NEXT_SCENE;
    case openaxe::midi::ActionKind::kPrevScene: return OPENAXE_MIDI_ACTION_PREV_SCENE;
  }
  return OPENAXE_MIDI_ACTION_SLOT;
}

}  // namespace

int32_t openaxe_midi_mapping_count(OpenAxeGraph* graph) {
  return static_cast<int32_t>(LiveEngine(graph)->MidiMappingCount());
}

int32_t openaxe_midi_get_mapping(OpenAxeGraph* graph, int32_t index,
                                    OpenAxeMidiMessageType* out_type,
                                    int32_t* out_channel, int32_t* out_number,
                                    OpenAxeMidiActionKind* out_kind,
                                    int32_t* out_slot, int32_t* out_scene) {
  const auto m = LiveEngine(graph)->MidiMappingAt(static_cast<size_t>(index));
  if (!m) return 0;
  if (out_type) *out_type = FromMidiMessageType(m->match.type);
  if (out_channel) *out_channel = m->match.channel;
  if (out_number) *out_number = m->match.number;
  if (out_kind) *out_kind = FromMidiActionKind(m->action.kind);
  if (out_slot) *out_slot = m->action.slot;
  if (out_scene) *out_scene = m->action.scene;
  return 1;
}

int32_t openaxe_midi_add_mapping(OpenAxeGraph* graph,
                                    OpenAxeMidiMessageType type,
                                    int32_t channel, int32_t number,
                                    OpenAxeMidiActionKind kind,
                                    int32_t slot, int32_t scene) {
  openaxe::midi::MidiMatch match{ToMidiMessageType(type), channel, number};
  openaxe::midi::MidiAction action;
  action.kind = ToMidiActionKind(kind);
  action.slot = slot;
  action.scene = scene;
  return LiveEngine(graph)->AddMidiMapping(match, action) ? 1 : 0;
}

int32_t openaxe_midi_remove_mapping(OpenAxeGraph* graph, int32_t index) {
  return LiveEngine(graph)->RemoveMidiMapping(static_cast<size_t>(index)) ? 1 : 0;
}

void openaxe_midi_clear_mappings(OpenAxeGraph* graph) { LiveEngine(graph)->ClearMidiMappings(); }

int32_t openaxe_midi_arm_learn(OpenAxeGraph* graph, OpenAxeMidiActionKind kind,
                                  int32_t slot, int32_t scene) {
  openaxe::midi::MidiAction action;
  action.kind = ToMidiActionKind(kind);
  action.slot = slot;
  action.scene = scene;
  return LiveEngine(graph)->ArmMidiLearn(action) ? 1 : 0;
}

void openaxe_midi_cancel_learn(OpenAxeGraph* graph) { LiveEngine(graph)->CancelMidiLearn(); }

int32_t openaxe_midi_is_learning(OpenAxeGraph* graph) {
  return LiveEngine(graph)->IsMidiLearning() ? 1 : 0;
}

int32_t openaxe_midi_get_learn_target(OpenAxeGraph* graph,
                                         OpenAxeMidiActionKind* out_kind,
                                         int32_t* out_slot, int32_t* out_scene) {
  const auto target = LiveEngine(graph)->MidiLearnTarget();
  if (!target) return 0;
  if (out_kind) *out_kind = FromMidiActionKind(target->kind);
  if (out_slot) *out_slot = target->slot;
  if (out_scene) *out_scene = target->scene;
  return 1;
}

int32_t openaxe_midi_parse_message(const uint8_t* data, int32_t size,
                                      OpenAxeMidiMessageType* out_type,
                                      int32_t* out_channel, int32_t* out_number,
                                      int32_t* out_value) {
  if (!data || size <= 0) return 0;
  const auto msg = openaxe::midi::ParseMidiMessage(data, static_cast<size_t>(size));
  if (!msg) return 0;
  if (out_type) *out_type = FromMidiMessageType(msg->type);
  if (out_channel) *out_channel = msg->channel;
  if (out_number) *out_number = msg->number;
  if (out_value) *out_value = msg->value;
  return 1;
}

int32_t openaxe_midi_is_trigger_edge(OpenAxeMidiMessageType type, int32_t value) {
  openaxe::midi::MessageType t = ToMidiMessageType(type);
  openaxe::midi::MidiMessage m{t, 0, 0, value};
  return openaxe::midi::IsTriggerEdge(m) ? 1 : 0;
}

int32_t openaxe_midi_message_matches(OpenAxeMidiMessageType msg_type,
                                        int32_t msg_channel, int32_t msg_number,
                                        OpenAxeMidiMessageType match_type,
                                        int32_t match_channel, int32_t match_number) {
  openaxe::midi::MidiMessage msg{ToMidiMessageType(msg_type), msg_channel, msg_number, 0};
  openaxe::midi::MidiMatch match{ToMidiMessageType(match_type), match_channel, match_number};
  return openaxe::midi::MessageMatches(msg, match) ? 1 : 0;
}

int32_t openaxe_midi_handle_message(OpenAxeGraph* graph,
                                       const uint8_t* data, int32_t size,
                                       int32_t sample_offset,
                                       OpenAxeMidiActionKind* out_kind,
                                       int32_t* out_slot, int32_t* out_scene,
                                       OpenAxeMidiMessageType* out_match_type,
                                       int32_t* out_match_channel,
                                       int32_t* out_match_number) {
  if (!data || size <= 0) return 0;
  const auto result = LiveEngine(graph)->HandleMidiMessage(data, static_cast<size_t>(size), sample_offset);
  if (result.kind == openaxe::engine::AudioEngine::MidiHandleResult::kNone) return 0;
  if (result.action) {
    if (out_kind) *out_kind = FromMidiActionKind(result.action->kind);
    if (out_slot) *out_slot = result.action->slot;
    if (out_scene) *out_scene = result.action->scene;
  }
  if (result.match) {
    if (out_match_type) *out_match_type = FromMidiMessageType(result.match->type);
    if (out_match_channel) *out_match_channel = result.match->channel;
    if (out_match_number) *out_match_number = result.match->number;
  }
  return result.kind == openaxe::engine::AudioEngine::MidiHandleResult::kDispatched ? 1 : 2;
}

// ── Automation slot map (issue #121) ────────────────────────────────────
// Thin forwarders onto AudioEngine's slot machinery - see api.h for the
// caller-facing contracts and packages/vst3/README.md for the design.

int32_t openaxe_bind_automation_slot(OpenAxeGraph* graph, int32_t slot,
                                        int32_t block_id) {
  return LiveEngine(graph)->BindAutomationSlot(slot, block_id) ? 1 : 0;
}

int32_t openaxe_unbind_automation_slot(OpenAxeGraph* graph, int32_t slot) {
  return LiveEngine(graph)->UnbindAutomationSlot(slot) ? 1 : 0;
}

int32_t openaxe_automation_slot_block(OpenAxeGraph* graph, int32_t slot) {
  return LiveEngine(graph)->AutomationSlotBlock(slot);
}

int32_t openaxe_automation_slot_param_count(OpenAxeGraph* graph, int32_t slot) {
  return LiveEngine(graph)->AutomationSlotParamCount(slot);
}

int32_t openaxe_automation_slot_param_info(OpenAxeGraph* graph, int32_t slot,
                                              int32_t entry, const char** out_name,
                                              const char** out_symbol, float* out_min,
                                              float* out_max, const char** out_unit) {
  const auto info = LiveEngine(graph)->AutomationParamInfo(slot, entry);
  if (!info) return 0;
  if (out_name != nullptr) *out_name = info->name;
  if (out_symbol != nullptr) *out_symbol = info->symbol;
  if (out_min != nullptr) *out_min = info->min_value;
  if (out_max != nullptr) *out_max = info->max_value;
  if (out_unit != nullptr) *out_unit = info->unit;
  return 1;
}

void openaxe_set_automation_param_normalized(OpenAxeGraph* graph, int32_t slot,
                                                int32_t entry, float normalized) {
  LiveEngine(graph)->SetAutomationParamNormalized(slot, entry, normalized);
}

float openaxe_get_automation_param_normalized(OpenAxeGraph* graph, int32_t slot,
                                                 int32_t entry) {
  return LiveEngine(graph)->GetAutomationParamNormalized(slot, entry);
}

// ── Rig state (de)serialization (issue #119) ────────────────────────────
// Thin forwarders onto openaxe::state, keeping the JSON machinery out of
// this file entirely. Both are control-thread calls - see api.h for the
// contracts and packages/core/README.md for the wire format.

int32_t openaxe_serialize_state(OpenAxeGraph* graph, char* out_json, int32_t capacity) {
  return openaxe_serialize_state_ex(graph, 0, out_json, capacity);
}

// Shared body of both serialize entry points: the two-call sizing pattern over
// the state layer's document (embedding assets when asked - see api.h).
int32_t openaxe_serialize_state_ex(OpenAxeGraph* graph, int32_t embed_assets,
                                      char* out_json, int32_t capacity) {
  const std::string document =
      openaxe::state::SerializeState(*LiveEngine(graph), embed_assets != 0);
  const int32_t required = static_cast<int32_t>(document.size()) + 1;  // + NUL
  if (out_json == nullptr) return required;
  if (capacity < required) return -1;
  std::memcpy(out_json, document.c_str(), static_cast<size_t>(required));
  return required;
}

OpenAxeLoadStateResult openaxe_load_state(OpenAxeGraph* graph, const char* json) {
  const auto outcome = openaxe::state::LoadState(*LiveEngine(graph), json);
  // Publish the missing-asset list (#120) for the query ABI below - replaced
  // wholesale on every load, hard failures included (they restore nothing).
  graph->missing_assets = std::move(outcome.missing_assets);
  graph->unsupported_blocks = std::move(outcome.unsupported_blocks);
  switch (outcome.error) {
    case openaxe::state::LoadError::kNone: return OPENAXE_LOAD_STATE_OK;
    case openaxe::state::LoadError::kParseError: return OPENAXE_LOAD_STATE_PARSE_ERROR;
    case openaxe::state::LoadError::kUnsupportedVersion:
      return OPENAXE_LOAD_STATE_UNSUPPORTED_VERSION;
    case openaxe::state::LoadError::kBadDocument: return OPENAXE_LOAD_STATE_BAD_DOCUMENT;
  }
  return OPENAXE_LOAD_STATE_BAD_DOCUMENT;  // unreachable for a valid enum value
}

// ── Tuner — pitch detection + note mapping (issue #123) ───────────────
// Pure functions — no graph, no state, safe from any thread. The web tuner
// forwards through these via WASM; native code calls them directly.

float openaxe_detect_pitch(const float* samples, int32_t count, double sample_rate) {
  const auto result = openaxe::dsp::DetectPitch(samples, count, sample_rate);
  return result ? result->frequency : 0.0f;
}

int32_t openaxe_frequency_to_note(float frequency, double reference_a4,
                                     const char** out_name, int32_t* out_octave,
                                     int32_t* out_cents) {
  if (frequency <= 0.0f || !out_name || !out_octave || !out_cents) return 0;
  if (reference_a4 <= 0.0) reference_a4 = 440.0;
  const auto note = openaxe::dsp::FrequencyToNote(frequency, reference_a4);
  *out_name = note.name;
  *out_octave = note.octave;
  *out_cents = note.cents;
  return 1;
}

int32_t openaxe_compute_fingerprint(const char* json, float* out_gain_db,
                                       float* out_brightness) {
  if (!json || !out_gain_db || !out_brightness) return 0;
  auto fp = openaxe::dsp::ComputeFingerprint(json);
  if (!fp) return 0;
  *out_gain_db = fp->gain_db;
  *out_brightness = fp->brightness;
  return 1;
}

// ── Missing-asset queries (issue #120) ──────────────────────────────────

int32_t openaxe_state_missing_asset_count(OpenAxeGraph* graph) {
  return static_cast<int32_t>(graph->missing_assets.size());
}

const char* openaxe_state_missing_asset(OpenAxeGraph* graph, int32_t index) {
  if (index < 0 || static_cast<size_t>(index) >= graph->missing_assets.size()) return nullptr;
  return graph->missing_assets[static_cast<size_t>(index)].c_str();
}

int32_t openaxe_state_unsupported_block_count(OpenAxeGraph* graph) {
  return static_cast<int32_t>(graph->unsupported_blocks.size());
}

const char* openaxe_state_unsupported_block(OpenAxeGraph* graph, int32_t index) {
  if (index < 0 || static_cast<size_t>(index) >= graph->unsupported_blocks.size()) return nullptr;
  return graph->unsupported_blocks[static_cast<size_t>(index)].c_str();
}

// Graph-free: it answers a property of the build, not of a rig, so a front end
// can ask before it has created one.
int32_t openaxe_block_kind_compiled(OpenAxeBlockKind kind) {
  if (kind < 0 || kind > OPENAXE_BLOCK_RETURN_2) return 0;
  return openaxe::blocks::IsCompiled(ToBlockKind(kind)) ? 1 : 0;
}


namespace {
// The canonical wire names. Kept adjacent to OpenAxeBlockKind so a new kind
// is one edit, not one per front end (issue #300 J3).
struct BlockKindName {
  const char* name;
  OpenAxeBlockKind kind;
};
constexpr BlockKindName kBlockKindNames[] = {
    {"noise-gate", OPENAXE_BLOCK_NOISE_GATE},
    {"compressor", OPENAXE_BLOCK_COMPRESSOR},
    {"eq", OPENAXE_BLOCK_EQ},
    {"chorus", OPENAXE_BLOCK_CHORUS},
    {"flanger", OPENAXE_BLOCK_FLANGER},
    {"phaser", OPENAXE_BLOCK_PHASER},
    {"tremolo", OPENAXE_BLOCK_TREMOLO},
    {"ring-mod", OPENAXE_BLOCK_RING_MOD},
    {"filter", OPENAXE_BLOCK_FILTER},
    {"pitch-shifter", OPENAXE_BLOCK_PITCH_SHIFTER},
    {"granular-delay", OPENAXE_BLOCK_GRANULAR_DELAY},
    {"rotary", OPENAXE_BLOCK_ROTARY},
    {"delay", OPENAXE_BLOCK_DELAY},
    {"reverb", OPENAXE_BLOCK_REVERB},
    {"amp", OPENAXE_BLOCK_AMP},
    {"amp-cab", OPENAXE_BLOCK_AMP_CAB},
    {"pedal", OPENAXE_BLOCK_PEDAL},
    {"outboard", OPENAXE_BLOCK_OUTBOARD},
    {"space", OPENAXE_BLOCK_SPACE},
    {"cab", OPENAXE_BLOCK_CAB},
    {"mixer", OPENAXE_BLOCK_MIXER},
    {"send-1", OPENAXE_BLOCK_SEND_1},
    {"return-1", OPENAXE_BLOCK_RETURN_1},
    {"send-2", OPENAXE_BLOCK_SEND_2},
    {"return-2", OPENAXE_BLOCK_RETURN_2},
};
}  // namespace

const char* openaxe_block_kind_name(OpenAxeBlockKind kind) {
  for (const auto& e : kBlockKindNames) {
    if (e.kind == kind) return e.name;
  }
  return nullptr;
}

int32_t openaxe_block_kind_from_name(const char* name, OpenAxeBlockKind* out_kind) {
  if (!name || !out_kind) return 1;
  for (const auto& e : kBlockKindNames) {
    if (std::strcmp(e.name, name) == 0) {
      *out_kind = e.kind;
      return 0;
    }
  }
  return 1;
}

}  // extern "C"
