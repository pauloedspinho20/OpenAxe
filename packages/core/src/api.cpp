#include "openaxe/api.h"

#include <algorithm>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

#include "openaxe/dsp/fingerprint.h"
#include "openaxe/dsp/note_utils.h"
#include "openaxe/dsp/pitch_detect.h"
#include "openaxe/engine.h"
#include "openaxe/generated/enabled_blocks.h"
#include "openaxe/midi.h"
#include "serialization/rig_state.h"

namespace {

// Explicit switches (not ordinal-identity casts) so openaxe::graph's own
// enums stay free to reorder/extend independently of this public C surface.
openaxe::graph::BlockKind ToBlockKind(NamStudioBlockKind kind) {
  using openaxe::graph::BlockKind;
  switch (kind) {
    case NAM_STUDIO_BLOCK_NOISE_GATE:
      return BlockKind::kNoiseGate;
    case NAM_STUDIO_BLOCK_COMPRESSOR:
      return BlockKind::kCompressor;
    case NAM_STUDIO_BLOCK_EQ:
      return BlockKind::kEq;
    case NAM_STUDIO_BLOCK_CHORUS:
      return BlockKind::kChorus;
    case NAM_STUDIO_BLOCK_FLANGER:
      return BlockKind::kFlanger;
    case NAM_STUDIO_BLOCK_PHASER:
      return BlockKind::kPhaser;
    case NAM_STUDIO_BLOCK_TREMOLO:
      return BlockKind::kTremolo;
    case NAM_STUDIO_BLOCK_DELAY:
      return BlockKind::kDelay;
    case NAM_STUDIO_BLOCK_PING_PONG_DELAY:
      return BlockKind::kPingPongDelay;
    case NAM_STUDIO_BLOCK_REVERB:
      return BlockKind::kReverb;
    case NAM_STUDIO_BLOCK_AMP:
      return BlockKind::kAmp;
    case NAM_STUDIO_BLOCK_AMP_CAB:
      return BlockKind::kAmpCab;
    case NAM_STUDIO_BLOCK_PEDAL:
      return BlockKind::kPedal;
    case NAM_STUDIO_BLOCK_OUTBOARD:
      return BlockKind::kOutboard;
    case NAM_STUDIO_BLOCK_SPACE:
      return BlockKind::kSpace;
    case NAM_STUDIO_BLOCK_CAB:
      return BlockKind::kCab;
    case NAM_STUDIO_BLOCK_MIXER:
      return BlockKind::kMixer;
    case NAM_STUDIO_BLOCK_SPLITTER:
      return BlockKind::kSplitter;
    case NAM_STUDIO_BLOCK_RING_MOD:
      return BlockKind::kRingMod;
    case NAM_STUDIO_BLOCK_FILTER:
      return BlockKind::kFilter;
    case NAM_STUDIO_BLOCK_PITCH_SHIFTER:
      return BlockKind::kPitchShifter;
    case NAM_STUDIO_BLOCK_GRANULAR_DELAY:
      return BlockKind::kGranularDelay;
    case NAM_STUDIO_BLOCK_ROTARY:
      return BlockKind::kRotary;
    case NAM_STUDIO_BLOCK_SEND_1:
      return BlockKind::kSend1;
    case NAM_STUDIO_BLOCK_RETURN_1:
      return BlockKind::kReturn1;
    case NAM_STUDIO_BLOCK_SEND_2:
      return BlockKind::kSend2;
    case NAM_STUDIO_BLOCK_RETURN_2:
      return BlockKind::kReturn2;
  }
  return BlockKind::kCab;  // unreachable for a valid enum value
}

// ABI enum -> engine enum. The two are kept separate deliberately: the C enum
// is a stable wire format for JS/FFI callers, so the engine's own enum can be
// reordered without breaking anyone.
openaxe::engine::ReverbAlgorithm ToReverbAlgorithm(NamStudioReverbAlgorithm algorithm) {
  using openaxe::engine::ReverbAlgorithm;
  switch (algorithm) {
    case NAM_STUDIO_REVERB_HALL:
      return ReverbAlgorithm::kHall;
    case NAM_STUDIO_REVERB_ROOM:
      return ReverbAlgorithm::kRoom;
    case NAM_STUDIO_REVERB_PLATE:
      return ReverbAlgorithm::kPlate;
    case NAM_STUDIO_REVERB_EARLY_REFLECTIONS:
      return ReverbAlgorithm::kEarlyReflections;
  }
  return ReverbAlgorithm::kHall;  // unreachable for a valid enum value
}

// Engine load error -> ABI result code. std::nullopt (success) becomes
// NAM_STUDIO_LOAD_OK, since exceptions can't cross extern "C".
NamStudioLoadResult ToLoadResult(std::optional<openaxe::dsp::NamLoadError> error) {
  if (!error) return NAM_STUDIO_LOAD_OK;
  switch (*error) {
    case openaxe::dsp::NamLoadError::kFileNotFound:
      return NAM_STUDIO_LOAD_FILE_NOT_FOUND;
    case openaxe::dsp::NamLoadError::kInvalidFormat:
      return NAM_STUDIO_LOAD_INVALID_FORMAT;
  }
  return NAM_STUDIO_LOAD_INVALID_FORMAT;  // unreachable for a valid enum value
}

}  // namespace

struct NamStudioGraph {
  openaxe::engine::AudioEngine engine;
  // The missing-asset list (#120) from the most recent load_state, kept for
  // the query ABI below. Control-thread data like everything else here.
  std::vector<std::string> missing_assets;
  // Likewise the unsupported-kind list (#313) - kinds the document named that
  // this build cannot place.
  std::vector<std::string> unsupported_blocks;
};

extern "C" {

NamStudioGraph* nam_studio_graph_create(void) { return new NamStudioGraph(); }

void nam_studio_graph_destroy(NamStudioGraph* graph) { delete graph; }

// ── Topology ────────────────────────────────────────────────────────────
// Thin forwarders onto AudioEngine (see engine.h for the semantics and
// api.h for the caller-facing contract). None of them are real-time safe:
// they allocate and rewrite the routing tables, so the host must suspend
// audio around them - which is precisely why they are grouped and labelled
// here rather than mixed in with the lock-free calls further down.
//
// Returns the new block's id, which is never reused - or -1 if this build has
// no DSP for `kind` (effects.config.json's compiled:false; ask
// nam_studio_block_kind_compiled first, or just don't offer the kind).
int32_t nam_studio_add_block(NamStudioGraph* graph, NamStudioBlockKind kind, int32_t row, int32_t col) {
  return graph->engine.AddBlock(ToBlockKind(kind), row, col);
}

// Removes the block and every edge touching it. Unknown ids are a no-op.
void nam_studio_remove_block(NamStudioGraph* graph, int32_t block_id) {
  graph->engine.RemoveBlock(block_id);
}

// Moves a block; a move that would make an existing cable run right-to-left
// silently drops that cable (query the edges afterwards to resync a UI).
void nam_studio_move_block(NamStudioGraph* graph, int32_t block_id, int32_t row, int32_t col) {
  graph->engine.MoveBlock(block_id, row, col);
}

int32_t nam_studio_connect(NamStudioGraph* graph, int32_t from_block, int32_t from_port,
                            int32_t to_block, int32_t to_port) {
  const auto outcome = graph->engine.Connect(from_block, from_port, to_block, to_port);
  return outcome.ok ? outcome.id : -1;
}

void nam_studio_disconnect(NamStudioGraph* graph, int32_t edge_id) { graph->engine.Disconnect(edge_id); }

// ── Lifecycle / processing ─────────────────────────────────────────────
// Arms the whole graph for a sample rate and maximum block size. Allocates;
// call before the first nam_studio_process and after any change to either.
void nam_studio_reset(NamStudioGraph* graph, double sample_rate, int32_t max_block_size) {
  graph->engine.Reset(sample_rate, max_block_size);
}

void nam_studio_process(NamStudioGraph* graph, const float* const* input, int32_t input_channels,
                         float* const* output, int32_t output_channels, int32_t num_frames) {
  graph->engine.Process(input, input_channels, output, output_channels, num_frames);
}

// ── Params ──────────────────────────────────────────────────────────────
// Param count for a block, 0 if unknown. Can change at runtime: loading a
// slimmable NAM model adds a param, and each reverb algorithm has its own
// table, so re-read this after either.
int32_t nam_studio_block_param_count(NamStudioGraph* graph, int32_t block_id) {
  return graph->engine.ParamCount(block_id);
}

int32_t nam_studio_block_param_info(NamStudioGraph* graph, int32_t block_id, int32_t index,
                                     const char** out_name, const char** out_symbol, float* out_min,
                                     float* out_max, const char** out_unit) {
  const auto info = graph->engine.ParamInfo(block_id, index);
  if (!info) return 0;
  if (out_name) *out_name = info->name;
  if (out_symbol) *out_symbol = info->symbol;
  if (out_min) *out_min = info->min_value;
  if (out_max) *out_max = info->max_value;
  if (out_unit) *out_unit = info->unit;
  return 1;
}

// Reads/writes one param by index. Both are lock-free and safe to call from
// any thread, including concurrently with nam_studio_process - the one
// exception being the amp family's slim-size param, which reallocates inside
// NAMCore (see AudioEngine::SetParam).
float nam_studio_get_param(NamStudioGraph* graph, int32_t block_id, int32_t index) {
  return graph->engine.GetParam(block_id, index);
}

// Writes one param (see the note on nam_studio_get_param above).
void nam_studio_set_param(NamStudioGraph* graph, int32_t block_id, int32_t index, float value) {
  graph->engine.SetParam(block_id, index, value);
}

NamStudioLoadResult nam_studio_load_nam_model(NamStudioGraph* graph, int32_t block_id,
                                               const char* file_path) {
  return ToLoadResult(graph->engine.LoadNamModel(block_id, file_path));
}

// Loads from the model's JSON content instead of a path - see api.h.
NamStudioLoadResult nam_studio_load_nam_model_json(NamStudioGraph* graph, int32_t block_id,
                                                   const char* json) {
  if (!json) return NAM_STUDIO_LOAD_INVALID_FORMAT;
  return ToLoadResult(graph->engine.LoadNamModelJson(block_id, json));
}

// Drops the block's model (it becomes a passthrough). Frees; suspend audio.
void nam_studio_unload_nam_model(NamStudioGraph* graph, int32_t block_id) {
  graph->engine.UnloadNamModel(block_id);
}

// 1 if an amp-family block currently has a capture loaded, else 0.
int32_t nam_studio_block_has_model(NamStudioGraph* graph, int32_t block_id) {
  return graph->engine.BlockHasModel(block_id) ? 1 : 0;
}

void nam_studio_set_reverb_algorithm(NamStudioGraph* graph, int32_t block_id,
                                      NamStudioReverbAlgorithm algorithm) {
  graph->engine.SetReverbAlgorithm(block_id, ToReverbAlgorithm(algorithm));
}

// Installs / clears / reports a cab block's impulse response - see api.h.
void nam_studio_load_ir(NamStudioGraph* graph, int32_t block_id, const float* samples,
                        int32_t frames) {
  graph->engine.LoadIr(block_id, samples, frames);
}

int32_t nam_studio_load_ir_wav(NamStudioGraph* graph, int32_t block_id, const uint8_t* bytes,
                               int32_t size) {
  if (!bytes || size <= 0) return 0;
  return graph->engine.LoadIrWav(block_id, bytes, static_cast<size_t>(size));
}

void nam_studio_unload_ir(NamStudioGraph* graph, int32_t block_id) {
  graph->engine.UnloadIr(block_id);
}

int32_t nam_studio_block_ir_length(NamStudioGraph* graph, int32_t block_id) {
  return graph->engine.IrLength(block_id);
}

void nam_studio_set_reverb_control(NamStudioGraph* graph, int32_t block_id,
                                   NamStudioReverbControl control, float value) {
  using openaxe::engine::ReverbControl;
  ReverbControl mapped = ReverbControl::kRoomSize;
  switch (control) {
    case NAM_STUDIO_REVERB_ROOM_SIZE: mapped = ReverbControl::kRoomSize; break;
    case NAM_STUDIO_REVERB_DAMPING: mapped = ReverbControl::kDamping; break;
    case NAM_STUDIO_REVERB_WIDTH: mapped = ReverbControl::kWidth; break;
    case NAM_STUDIO_REVERB_PREDELAY: mapped = ReverbControl::kPredelay; break;
    case NAM_STUDIO_REVERB_SPIN: mapped = ReverbControl::kSpin; break;
    case NAM_STUDIO_REVERB_WANDER: mapped = ReverbControl::kWander; break;
    case NAM_STUDIO_REVERB_EARLY_SEND: mapped = ReverbControl::kEarlySend; break;
    case NAM_STUDIO_REVERB_DRY_LEVEL: mapped = ReverbControl::kDryLevel; break;
    default: return;
  }
  graph->engine.SetReverbControl(block_id, mapped, value);
}

void nam_studio_set_delay_model(NamStudioGraph* graph, int32_t block_id,
                                 NamStudioDelayModel model) {
  using openaxe::dsp::Delay;
  Delay::Model m = Delay::Model::kDigital;
  switch (model) {
    case NAM_STUDIO_DELAY_DIGITAL: m = Delay::Model::kDigital; break;
    case NAM_STUDIO_DELAY_ANALOG:  m = Delay::Model::kAnalog; break;
    case NAM_STUDIO_DELAY_TAPE:    m = Delay::Model::kTape; break;
  }
  graph->engine.SetDelayModel(block_id, m);
}

// Metadata of the block's loaded capture; every out-param is optional. See
// api.h for what each field means and when it is meaningful.
int32_t nam_studio_block_model_info(NamStudioGraph* graph, int32_t block_id, double* out_sample_rate,
                                    int32_t* out_has_loudness, double* out_loudness_db,
                                    int32_t* out_has_input_level, double* out_input_level_dbu,
                                    int32_t* out_has_output_level, double* out_output_level_dbu,
                                    int32_t* out_is_slimmable, int32_t* out_slim_breakpoint_count) {
  const auto info = graph->engine.BlockModelInfo(block_id);
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
int32_t nam_studio_block_model_slim_breakpoints(NamStudioGraph* graph, int32_t block_id,
                                                double* out_values, int32_t max_count) {
  const auto info = graph->engine.BlockModelInfo(block_id);
  if (!info || !out_values || max_count <= 0) return 0;
  const int32_t count =
      std::min(static_cast<int32_t>(info->slim_size_breakpoints.size()), max_count);
  for (int32_t i = 0; i < count; ++i) out_values[i] = info->slim_size_breakpoints[static_cast<size_t>(i)];
  return count;
}

// ── Bypass / trims / master bus ────────────────────────────────────────
// Everything below is lock-free and callable from any thread, including
// concurrently with nam_studio_process.
void nam_studio_set_bypass(NamStudioGraph* graph, int32_t block_id, int32_t bypassed) {
  graph->engine.SetBypass(block_id, bypassed != 0);
}

// 1 while the block is bypassed, else 0.
int32_t nam_studio_is_bypassed(NamStudioGraph* graph, int32_t block_id) {
  return graph->engine.IsBypassed(block_id) ? 1 : 0;
}

// Input-side trim, applied to the block's summed input. 1.0 = unity.
void nam_studio_set_block_input_trim(NamStudioGraph* graph, int32_t block_id, float gain) {
  graph->engine.SetInputTrim(block_id, gain);
}

// The per-block I/O trims - see api.h for why these are not the amp family's
// input_level/output_level params.
float nam_studio_get_block_input_trim(NamStudioGraph* graph, int32_t block_id) {
  return graph->engine.GetInputTrim(block_id);
}

// Output-side trim, applied after the block's DSP (or its bypass copy).
void nam_studio_set_block_output_trim(NamStudioGraph* graph, int32_t block_id, float gain) {
  graph->engine.SetOutputTrim(block_id, gain);
}

// Current output trim, 1.0 for unknown blocks.
float nam_studio_get_block_output_trim(NamStudioGraph* graph, int32_t block_id) {
  return graph->engine.GetOutputTrim(block_id);
}

// The output bus: level, master mute, and the independent tuner mute.
void nam_studio_set_master_level(NamStudioGraph* graph, float level) {
  graph->engine.SetMasterLevel(level);
}

float nam_studio_get_master_level(NamStudioGraph* graph) { return graph->engine.GetMasterLevel(); }

// Master mute; independent of the tuner mute below.
void nam_studio_set_master_muted(NamStudioGraph* graph, int32_t muted) {
  graph->engine.SetMasterMuted(muted != 0);
}

// 1 while the master mute is engaged, else 0.
int32_t nam_studio_is_master_muted(NamStudioGraph* graph) {
  return graph->engine.IsMasterMuted() ? 1 : 0;
}

// Tuner mute - a second mute source, so a tuner overlay can silence the
// output without disturbing the user's master mute.
void nam_studio_set_tuner_muted(NamStudioGraph* graph, int32_t muted) {
  graph->engine.SetTunerMuted(muted != 0);
}

// 1 while the tuner mute is engaged, else 0.
int32_t nam_studio_is_tuner_muted(NamStudioGraph* graph) {
  return graph->engine.IsTunerMuted() ? 1 : 0;
}

// ── Metering ────────────────────────────────────────────────────────────
// Peak |sample| over the block's last processed buffer, 0 for unknown ids.
float nam_studio_get_meter(NamStudioGraph* graph, int32_t block_id) {
  return graph->engine.GetMeter(block_id);
}

float nam_studio_get_cpu_load(NamStudioGraph* graph) { return graph->engine.GetCpuLoad(); }

// ── MIDI mapping (issue #124) ─────────────────────────────────────────
// Thin forwarders onto the MIDI model. Helpers are pure functions; the rest
// delegates to AudioEngine's MIDI state (see engine.h for the threading
// contract — mutations are control-thread only, Handle is any-thread).

namespace {

openaxe::midi::MessageType ToMidiMessageType(NamStudioMidiMessageType t) {
  switch (t) {
    case NAM_STUDIO_MIDI_NOTEON: return openaxe::midi::MessageType::kNoteOn;
    case NAM_STUDIO_MIDI_CC: return openaxe::midi::MessageType::kCc;
    case NAM_STUDIO_MIDI_PC: return openaxe::midi::MessageType::kPc;
  }
  return openaxe::midi::MessageType::kCc;
}
NamStudioMidiMessageType FromMidiMessageType(openaxe::midi::MessageType t) {
  switch (t) {
    case openaxe::midi::MessageType::kNoteOn: return NAM_STUDIO_MIDI_NOTEON;
    case openaxe::midi::MessageType::kCc: return NAM_STUDIO_MIDI_CC;
    case openaxe::midi::MessageType::kPc: return NAM_STUDIO_MIDI_PC;
  }
  return NAM_STUDIO_MIDI_CC;
}
openaxe::midi::ActionKind ToMidiActionKind(NamStudioMidiActionKind k) {
  switch (k) {
    case NAM_STUDIO_MIDI_ACTION_SLOT: return openaxe::midi::ActionKind::kSlot;
    case NAM_STUDIO_MIDI_ACTION_SCENE: return openaxe::midi::ActionKind::kScene;
    case NAM_STUDIO_MIDI_ACTION_NEXT_SCENE: return openaxe::midi::ActionKind::kNextScene;
    case NAM_STUDIO_MIDI_ACTION_PREV_SCENE: return openaxe::midi::ActionKind::kPrevScene;
  }
  return openaxe::midi::ActionKind::kSlot;
}
NamStudioMidiActionKind FromMidiActionKind(openaxe::midi::ActionKind k) {
  switch (k) {
    case openaxe::midi::ActionKind::kSlot: return NAM_STUDIO_MIDI_ACTION_SLOT;
    case openaxe::midi::ActionKind::kScene: return NAM_STUDIO_MIDI_ACTION_SCENE;
    case openaxe::midi::ActionKind::kNextScene: return NAM_STUDIO_MIDI_ACTION_NEXT_SCENE;
    case openaxe::midi::ActionKind::kPrevScene: return NAM_STUDIO_MIDI_ACTION_PREV_SCENE;
  }
  return NAM_STUDIO_MIDI_ACTION_SLOT;
}

}  // namespace

int32_t nam_studio_midi_mapping_count(NamStudioGraph* graph) {
  return static_cast<int32_t>(graph->engine.MidiMappingCount());
}

int32_t nam_studio_midi_get_mapping(NamStudioGraph* graph, int32_t index,
                                    NamStudioMidiMessageType* out_type,
                                    int32_t* out_channel, int32_t* out_number,
                                    NamStudioMidiActionKind* out_kind,
                                    int32_t* out_slot, int32_t* out_scene) {
  const auto m = graph->engine.MidiMappingAt(static_cast<size_t>(index));
  if (!m) return 0;
  if (out_type) *out_type = FromMidiMessageType(m->match.type);
  if (out_channel) *out_channel = m->match.channel;
  if (out_number) *out_number = m->match.number;
  if (out_kind) *out_kind = FromMidiActionKind(m->action.kind);
  if (out_slot) *out_slot = m->action.slot;
  if (out_scene) *out_scene = m->action.scene;
  return 1;
}

int32_t nam_studio_midi_add_mapping(NamStudioGraph* graph,
                                    NamStudioMidiMessageType type,
                                    int32_t channel, int32_t number,
                                    NamStudioMidiActionKind kind,
                                    int32_t slot, int32_t scene) {
  openaxe::midi::MidiMatch match{ToMidiMessageType(type), channel, number};
  openaxe::midi::MidiAction action;
  action.kind = ToMidiActionKind(kind);
  action.slot = slot;
  action.scene = scene;
  return graph->engine.AddMidiMapping(match, action) ? 1 : 0;
}

int32_t nam_studio_midi_remove_mapping(NamStudioGraph* graph, int32_t index) {
  return graph->engine.RemoveMidiMapping(static_cast<size_t>(index)) ? 1 : 0;
}

void nam_studio_midi_clear_mappings(NamStudioGraph* graph) { graph->engine.ClearMidiMappings(); }

int32_t nam_studio_midi_arm_learn(NamStudioGraph* graph, NamStudioMidiActionKind kind,
                                  int32_t slot, int32_t scene) {
  openaxe::midi::MidiAction action;
  action.kind = ToMidiActionKind(kind);
  action.slot = slot;
  action.scene = scene;
  return graph->engine.ArmMidiLearn(action) ? 1 : 0;
}

void nam_studio_midi_cancel_learn(NamStudioGraph* graph) { graph->engine.CancelMidiLearn(); }

int32_t nam_studio_midi_is_learning(NamStudioGraph* graph) {
  return graph->engine.IsMidiLearning() ? 1 : 0;
}

int32_t nam_studio_midi_get_learn_target(NamStudioGraph* graph,
                                         NamStudioMidiActionKind* out_kind,
                                         int32_t* out_slot, int32_t* out_scene) {
  const auto target = graph->engine.MidiLearnTarget();
  if (!target) return 0;
  if (out_kind) *out_kind = FromMidiActionKind(target->kind);
  if (out_slot) *out_slot = target->slot;
  if (out_scene) *out_scene = target->scene;
  return 1;
}

int32_t nam_studio_midi_parse_message(const uint8_t* data, int32_t size,
                                      NamStudioMidiMessageType* out_type,
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

int32_t nam_studio_midi_is_trigger_edge(NamStudioMidiMessageType type, int32_t value) {
  openaxe::midi::MessageType t = ToMidiMessageType(type);
  openaxe::midi::MidiMessage m{t, 0, 0, value};
  return openaxe::midi::IsTriggerEdge(m) ? 1 : 0;
}

int32_t nam_studio_midi_message_matches(NamStudioMidiMessageType msg_type,
                                        int32_t msg_channel, int32_t msg_number,
                                        NamStudioMidiMessageType match_type,
                                        int32_t match_channel, int32_t match_number) {
  openaxe::midi::MidiMessage msg{ToMidiMessageType(msg_type), msg_channel, msg_number, 0};
  openaxe::midi::MidiMatch match{ToMidiMessageType(match_type), match_channel, match_number};
  return openaxe::midi::MessageMatches(msg, match) ? 1 : 0;
}

int32_t nam_studio_midi_handle_message(NamStudioGraph* graph,
                                       const uint8_t* data, int32_t size,
                                       int32_t sample_offset,
                                       NamStudioMidiActionKind* out_kind,
                                       int32_t* out_slot, int32_t* out_scene,
                                       NamStudioMidiMessageType* out_match_type,
                                       int32_t* out_match_channel,
                                       int32_t* out_match_number) {
  if (!data || size <= 0) return 0;
  const auto result = graph->engine.HandleMidiMessage(data, static_cast<size_t>(size), sample_offset);
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

int32_t nam_studio_bind_automation_slot(NamStudioGraph* graph, int32_t slot,
                                        int32_t block_id) {
  return graph->engine.BindAutomationSlot(slot, block_id) ? 1 : 0;
}

int32_t nam_studio_unbind_automation_slot(NamStudioGraph* graph, int32_t slot) {
  return graph->engine.UnbindAutomationSlot(slot) ? 1 : 0;
}

int32_t nam_studio_automation_slot_block(NamStudioGraph* graph, int32_t slot) {
  return graph->engine.AutomationSlotBlock(slot);
}

int32_t nam_studio_automation_slot_param_count(NamStudioGraph* graph, int32_t slot) {
  return graph->engine.AutomationSlotParamCount(slot);
}

int32_t nam_studio_automation_slot_param_info(NamStudioGraph* graph, int32_t slot,
                                              int32_t entry, const char** out_name,
                                              const char** out_symbol, float* out_min,
                                              float* out_max, const char** out_unit) {
  const auto info = graph->engine.AutomationParamInfo(slot, entry);
  if (!info) return 0;
  if (out_name != nullptr) *out_name = info->name;
  if (out_symbol != nullptr) *out_symbol = info->symbol;
  if (out_min != nullptr) *out_min = info->min_value;
  if (out_max != nullptr) *out_max = info->max_value;
  if (out_unit != nullptr) *out_unit = info->unit;
  return 1;
}

void nam_studio_set_automation_param_normalized(NamStudioGraph* graph, int32_t slot,
                                                int32_t entry, float normalized) {
  graph->engine.SetAutomationParamNormalized(slot, entry, normalized);
}

float nam_studio_get_automation_param_normalized(NamStudioGraph* graph, int32_t slot,
                                                 int32_t entry) {
  return graph->engine.GetAutomationParamNormalized(slot, entry);
}

// ── Rig state (de)serialization (issue #119) ────────────────────────────
// Thin forwarders onto openaxe::state, keeping the JSON machinery out of
// this file entirely. Both are control-thread calls - see api.h for the
// contracts and packages/core/README.md for the wire format.

int32_t nam_studio_serialize_state(NamStudioGraph* graph, char* out_json, int32_t capacity) {
  return nam_studio_serialize_state_ex(graph, 0, out_json, capacity);
}

// Shared body of both serialize entry points: the two-call sizing pattern over
// the state layer's document (embedding assets when asked - see api.h).
int32_t nam_studio_serialize_state_ex(NamStudioGraph* graph, int32_t embed_assets,
                                      char* out_json, int32_t capacity) {
  const std::string document =
      openaxe::state::SerializeState(graph->engine, embed_assets != 0);
  const int32_t required = static_cast<int32_t>(document.size()) + 1;  // + NUL
  if (out_json == nullptr) return required;
  if (capacity < required) return -1;
  std::memcpy(out_json, document.c_str(), static_cast<size_t>(required));
  return required;
}

NamStudioLoadStateResult nam_studio_load_state(NamStudioGraph* graph, const char* json) {
  const auto outcome = openaxe::state::LoadState(graph->engine, json);
  // Publish the missing-asset list (#120) for the query ABI below - replaced
  // wholesale on every load, hard failures included (they restore nothing).
  graph->missing_assets = std::move(outcome.missing_assets);
  graph->unsupported_blocks = std::move(outcome.unsupported_blocks);
  switch (outcome.error) {
    case openaxe::state::LoadError::kNone: return NAM_STUDIO_LOAD_STATE_OK;
    case openaxe::state::LoadError::kParseError: return NAM_STUDIO_LOAD_STATE_PARSE_ERROR;
    case openaxe::state::LoadError::kUnsupportedVersion:
      return NAM_STUDIO_LOAD_STATE_UNSUPPORTED_VERSION;
    case openaxe::state::LoadError::kBadDocument: return NAM_STUDIO_LOAD_STATE_BAD_DOCUMENT;
  }
  return NAM_STUDIO_LOAD_STATE_BAD_DOCUMENT;  // unreachable for a valid enum value
}

// ── Tuner — pitch detection + note mapping (issue #123) ───────────────
// Pure functions — no graph, no state, safe from any thread. The web tuner
// forwards through these via WASM; native code calls them directly.

float nam_studio_detect_pitch(const float* samples, int32_t count, double sample_rate) {
  const auto result = openaxe::dsp::DetectPitch(samples, count, sample_rate);
  return result ? result->frequency : 0.0f;
}

int32_t nam_studio_frequency_to_note(float frequency, double reference_a4,
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

int32_t nam_studio_compute_fingerprint(const char* json, float* out_gain_db,
                                       float* out_brightness) {
  if (!json || !out_gain_db || !out_brightness) return 0;
  auto fp = openaxe::dsp::ComputeFingerprint(json);
  if (!fp) return 0;
  *out_gain_db = fp->gain_db;
  *out_brightness = fp->brightness;
  return 1;
}

// ── Missing-asset queries (issue #120) ──────────────────────────────────

int32_t nam_studio_state_missing_asset_count(NamStudioGraph* graph) {
  return static_cast<int32_t>(graph->missing_assets.size());
}

const char* nam_studio_state_missing_asset(NamStudioGraph* graph, int32_t index) {
  if (index < 0 || static_cast<size_t>(index) >= graph->missing_assets.size()) return nullptr;
  return graph->missing_assets[static_cast<size_t>(index)].c_str();
}

int32_t nam_studio_state_unsupported_block_count(NamStudioGraph* graph) {
  return static_cast<int32_t>(graph->unsupported_blocks.size());
}

const char* nam_studio_state_unsupported_block(NamStudioGraph* graph, int32_t index) {
  if (index < 0 || static_cast<size_t>(index) >= graph->unsupported_blocks.size()) return nullptr;
  return graph->unsupported_blocks[static_cast<size_t>(index)].c_str();
}

// Graph-free: it answers a property of the build, not of a rig, so a front end
// can ask before it has created one.
int32_t nam_studio_block_kind_compiled(NamStudioBlockKind kind) {
  if (kind < 0 || kind > NAM_STUDIO_BLOCK_RETURN_2) return 0;
  return openaxe::blocks::IsCompiled(ToBlockKind(kind)) ? 1 : 0;
}


namespace {
// The canonical wire names. Kept adjacent to NamStudioBlockKind so a new kind
// is one edit, not one per front end (issue #300 J3).
struct BlockKindName {
  const char* name;
  NamStudioBlockKind kind;
};
constexpr BlockKindName kBlockKindNames[] = {
    {"noise-gate", NAM_STUDIO_BLOCK_NOISE_GATE},
    {"compressor", NAM_STUDIO_BLOCK_COMPRESSOR},
    {"eq", NAM_STUDIO_BLOCK_EQ},
    {"chorus", NAM_STUDIO_BLOCK_CHORUS},
    {"flanger", NAM_STUDIO_BLOCK_FLANGER},
    {"phaser", NAM_STUDIO_BLOCK_PHASER},
    {"tremolo", NAM_STUDIO_BLOCK_TREMOLO},
    {"ring-mod", NAM_STUDIO_BLOCK_RING_MOD},
    {"filter", NAM_STUDIO_BLOCK_FILTER},
    {"pitch-shifter", NAM_STUDIO_BLOCK_PITCH_SHIFTER},
    {"granular-delay", NAM_STUDIO_BLOCK_GRANULAR_DELAY},
    {"rotary", NAM_STUDIO_BLOCK_ROTARY},
    {"delay", NAM_STUDIO_BLOCK_DELAY},
    {"ping-pong-delay", NAM_STUDIO_BLOCK_PING_PONG_DELAY},
    {"reverb", NAM_STUDIO_BLOCK_REVERB},
    {"amp", NAM_STUDIO_BLOCK_AMP},
    {"amp-cab", NAM_STUDIO_BLOCK_AMP_CAB},
    {"pedal", NAM_STUDIO_BLOCK_PEDAL},
    {"outboard", NAM_STUDIO_BLOCK_OUTBOARD},
    {"space", NAM_STUDIO_BLOCK_SPACE},
    {"cab", NAM_STUDIO_BLOCK_CAB},
    {"mixer", NAM_STUDIO_BLOCK_MIXER},
    {"splitter", NAM_STUDIO_BLOCK_SPLITTER},
    {"send-1", NAM_STUDIO_BLOCK_SEND_1},
    {"return-1", NAM_STUDIO_BLOCK_RETURN_1},
    {"send-2", NAM_STUDIO_BLOCK_SEND_2},
    {"return-2", NAM_STUDIO_BLOCK_RETURN_2},
};
}  // namespace

const char* nam_studio_block_kind_name(NamStudioBlockKind kind) {
  for (const auto& e : kBlockKindNames) {
    if (e.kind == kind) return e.name;
  }
  return nullptr;
}

int32_t nam_studio_block_kind_from_name(const char* name, NamStudioBlockKind* out_kind) {
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
