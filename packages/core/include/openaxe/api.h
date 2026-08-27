#pragma once

// ── ABI naming note (issue #151) ─────────────────────────────────────────
// Every identifier in this header keeps its historical `nam_studio` /
// `NamStudio` / `NAM_STUDIO_` spelling on purpose: these names are baked into
// the prebuilt, committed WASM artifacts the web app ships
// (apps/web/public/wasm-core/nam_studio_core.{js,wasm} +
// namStudioRigWorklet.js export/call `_nam_studio_*` string symbols), and
// regenerating those binaries requires Emscripten. Renaming the extern "C"
// surface must therefore be one atomic change: update every identifier here,
// rebuild via scripts/build-core-wasm.sh, re-commit the regenerated
// artifacts, and update scripts/check-wasm-exports.mjs in the same commit.
// Everything *around* this header (include tree, namespaces, CMake targets)
// was rebranded to `openaxe` without touching it.
//
// The desktop bridge and tests keep using these spellings because they link
// this exact header; do not rename call sites piecemeal.

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Opaque handle wrapping a openaxe::engine::AudioEngine (topology +
// live DSP + real-time processing). This is the public C ABI every platform
// target (#15 desktop, #16 VST3, #17 mobile, #22 web/WASM) links against.
typedef struct NamStudioGraph NamStudioGraph;

// ── Threading contract (issue #211) ──────────────────────────────────────
// Every function here is exactly one of two tiers, stated on the declaration:
//
//   Tier 1 - safe to call from ANY thread, concurrently with
//   nam_studio_process, lock-free: nam_studio_get_param /
//   nam_studio_set_param (EXCEPT the Amp-family slim-size param, which is
//   Tier 2), nam_studio_block_param_count / _param_info (only where those
//   read the DSP's param table, and those are control-thread calls - see the
//   notes on them), nam_studio_set_reverb_control, the bypass/trim/master-bus
//   calls, metering, and the automation-slot param get/set.
//
//   Tier 2 - structural / DSP-swapping: everything else that builds or
//   replaces a block's DSP, rewrites its param table, loads a model/IR, or
//   changes the topology. These mutate shared non-atomic BlockState fields,
//   so the caller MUST ensure nam_studio_process is not running when it
//   calls them - no process() call in flight and none starting until they
//   return. The audio path itself stays lock-free; the exclusion is the
//   caller's job. The two shipping shells each do it in their own way:
//     - the desktop app wraps every Tier-2 call in its suspend handshake
//       (StudioBridge::Mutate -> AudioIO::BeginSuspend/EndSuspend);
//     - the web app runs inside the AudioWorklet, where control messages
//       and process() share one thread and so can never race.
//   A future shell must provide an equivalent handshake before calling any
//   Tier-2 function.

// Never returns NULL.
NamStudioGraph* nam_studio_graph_create(void);
// NULL is a no-op.
void nam_studio_graph_destroy(NamStudioGraph* graph);

// Mirrors openaxe::graph::BlockKind (block.h) 1:1 - kept as its own C
// enum (rather than exposing the C++ enum class directly) so this header
// has no C++-only dependency. api.cpp translates via an explicit switch,
// not ordinal identity, so block.h stays free to reorder its own enum.
typedef enum NamStudioBlockKind {
  NAM_STUDIO_BLOCK_NOISE_GATE,
  NAM_STUDIO_BLOCK_COMPRESSOR,
  NAM_STUDIO_BLOCK_EQ,
  NAM_STUDIO_BLOCK_CHORUS,
  NAM_STUDIO_BLOCK_FLANGER,
  NAM_STUDIO_BLOCK_PHASER,
  NAM_STUDIO_BLOCK_TREMOLO,
  NAM_STUDIO_BLOCK_DELAY,
  NAM_STUDIO_BLOCK_PING_PONG_DELAY,
  NAM_STUDIO_BLOCK_REVERB,
  NAM_STUDIO_BLOCK_AMP,
  NAM_STUDIO_BLOCK_AMP_CAB,
  NAM_STUDIO_BLOCK_PEDAL,
  NAM_STUDIO_BLOCK_OUTBOARD,
  NAM_STUDIO_BLOCK_SPACE,
  NAM_STUDIO_BLOCK_CAB,
  NAM_STUDIO_BLOCK_MIXER,
  NAM_STUDIO_BLOCK_SPLITTER,
  NAM_STUDIO_BLOCK_RING_MOD,
  NAM_STUDIO_BLOCK_FILTER,
  NAM_STUDIO_BLOCK_PITCH_SHIFTER,
  NAM_STUDIO_BLOCK_GRANULAR_DELAY,
  NAM_STUDIO_BLOCK_ROTARY,
  // Send/Return pairs (issue #274) - appended (never re-ordered) so the web
  // worklet's ordinal KIND_TO_CORE map and any persisted kind ordinals keep
  // their meaning. Send N routes implicitly into Return N.
  NAM_STUDIO_BLOCK_SEND_1,
  NAM_STUDIO_BLOCK_RETURN_1,
  NAM_STUDIO_BLOCK_SEND_2,
  NAM_STUDIO_BLOCK_RETURN_2,
} NamStudioBlockKind;

// Only meaningful for NAM_STUDIO_BLOCK_REVERB blocks - selects which of the
// 4 wrapped Dragonfly Reverb algorithms backs the block. New reverb blocks
// default to Hall.
typedef enum NamStudioReverbAlgorithm {
  NAM_STUDIO_REVERB_HALL,
  NAM_STUDIO_REVERB_ROOM,
  NAM_STUDIO_REVERB_PLATE,
  NAM_STUDIO_REVERB_EARLY_REFLECTIONS,
} NamStudioReverbAlgorithm;

// Only meaningful for NAM_STUDIO_BLOCK_DELAY blocks - selects which delay
// character backs the block. New delay blocks default to
// NAM_STUDIO_DELAY_DIGITAL.
typedef enum NamStudioDelayModel {
  NAM_STUDIO_DELAY_DIGITAL,
  NAM_STUDIO_DELAY_ANALOG,
  NAM_STUDIO_DELAY_TAPE,
} NamStudioDelayModel;

// nam_studio_load_nam_model's result - mirrors openaxe::dsp::NamLoadError.
typedef enum NamStudioLoadResult {
  NAM_STUDIO_LOAD_OK = 0,
  NAM_STUDIO_LOAD_FILE_NOT_FOUND = 1,
  NAM_STUDIO_LOAD_INVALID_FORMAT = 2,
} NamStudioLoadResult;

// Reserved block-id sentinels for the two fixed rail endpoints - never real
// block ids (nam_studio_add_block never returns these). Pass these directly
// as from_block/to_block to nam_studio_connect to wire the graph's external
// input/output.
#define NAM_STUDIO_IN_RAIL (-1)
#define NAM_STUDIO_OUT_RAIL (-2)

// ── Topology ────────────────────────────────────────────────────────────
// Not real-time safe: constructs/destroys live DSP objects and (re)allocates
// buffers. Do not call concurrently with nam_studio_process.

// Returns the new block's id (>= 0).
int32_t nam_studio_add_block(NamStudioGraph* graph, NamStudioBlockKind kind, int32_t row, int32_t col);
// No-op if block_id is unknown.
void nam_studio_remove_block(NamStudioGraph* graph, int32_t block_id);
// No-op if block_id is unknown. May silently drop edges left-to-right
// ordering no longer permits, mirroring GraphRig.ts's moveBlock.
void nam_studio_move_block(NamStudioGraph* graph, int32_t block_id, int32_t row, int32_t col);
// Returns the new edge's id (>= 0), or -1 if the connection was rejected
// (self-jack, wrong column order, port out of range, or target already
// connected - see graph_validation.h for exact rules).
int32_t nam_studio_connect(NamStudioGraph* graph, int32_t from_block, int32_t from_port,
                            int32_t to_block, int32_t to_port);
// No-op if edge_id is unknown.
void nam_studio_disconnect(NamStudioGraph* graph, int32_t edge_id);

// ── Lifecycle / processing ─────────────────────────────────────────────

// Not real-time safe. Must be called at least once before
// nam_studio_process, and again whenever sample_rate/max_block_size change
// or the topology changes (add/remove/connect/disconnect).
void nam_studio_reset(NamStudioGraph* graph, double sample_rate, int32_t max_block_size);

// Real-time safe once nam_studio_reset has been called. input/output are
// arrays of input_channels/output_channels buffers, each num_frames samples
// (num_frames must be <= the max_block_size passed to nam_studio_reset).
// input_channels/output_channels may be 1 or 2 regardless of the graph's
// internal stereo representation: mono input duplicates to both internal
// channels; mono output averages the internal stereo pair down.
void nam_studio_process(NamStudioGraph* graph, const float* const* input, int32_t input_channels,
                         float* const* output, int32_t output_channels, int32_t num_frames);

// ── Params (generic across every block kind; Tier 1, lock-free) ────────
// param_count/param_info read the block's atomic count and live DSP table:
// they are safe from any thread for the count itself (issue #211), and the
// info read visits the DSP's param table, so it must not race a Tier-2
// algorithm/model swap (the desktop routes it through its control thread).

// 0 for an unknown block or a kind with no wrapped DSP yet.
int32_t nam_studio_block_param_count(NamStudioGraph* graph, int32_t block_id);
// Returns 0 (false) and leaves outputs untouched if block_id/index is invalid.
int32_t nam_studio_block_param_info(NamStudioGraph* graph, int32_t block_id, int32_t index,
                                     const char** out_name, const char** out_symbol, float* out_min,
                                     float* out_max, const char** out_unit);
// 0.0 for an unknown block/index.
float nam_studio_get_param(NamStudioGraph* graph, int32_t block_id, int32_t index);
// No-op for an unknown block/index. Lock-free (safe from any thread) for
// every param except an Amp-family block's Slim Size, which synchronously
// forwards to NamAmp::SetSlimSize - that one is Tier 2 (not real-time safe,
// NAMCore may reallocate), so it must not run concurrently with
// nam_studio_process; the desktop bridge routes it through its suspend
// handshake (issue #211).
void nam_studio_set_param(NamStudioGraph* graph, int32_t block_id, int32_t index, float value);

// ── NAM model management (off the audio thread) ────────────────────────

NamStudioLoadResult nam_studio_load_nam_model(NamStudioGraph* graph, int32_t block_id,
                                               const char* file_path);
// Same, from the .nam file's JSON content in memory rather than a path. This is
// the entry point a browser needs (no filesystem) and the one a plugin uses when
// restoring host state; the desktop app uses it too, so its webview never has to
// stage a temp file. Same non-real-time contract as the path form.
NamStudioLoadResult nam_studio_load_nam_model_json(NamStudioGraph* graph, int32_t block_id,
                                                   const char* json);

void nam_studio_unload_nam_model(NamStudioGraph* graph, int32_t block_id);
// Returns 0/1; 0 for an unknown or non-Amp-family block.
int32_t nam_studio_block_has_model(NamStudioGraph* graph, int32_t block_id);

// Metadata of the capture loaded into a block: 1 on success, 0 for an unknown
// block, a non-amp kind, or no model loaded. Every out-param is optional (pass
// null to skip). Flags are 0/1; `sample_rate` is the model's trained rate (-1 if
// it doesn't declare one); `loudness_db` and the two dBu levels are only
// meaningful when their has_* flag is 1. A slimmable capture can trade fidelity
// for CPU at `slim_breakpoint_count` discrete sizes - read them with
// nam_studio_block_model_slim_breakpoints.
int32_t nam_studio_block_model_info(NamStudioGraph* graph, int32_t block_id, double* out_sample_rate,
                                    int32_t* out_has_loudness, double* out_loudness_db,
                                    int32_t* out_has_input_level, double* out_input_level_dbu,
                                    int32_t* out_has_output_level, double* out_output_level_dbu,
                                    int32_t* out_is_slimmable, int32_t* out_slim_breakpoint_count);

// Copies up to `max_count` slim-size breakpoints into `out_values` and returns
// how many were written (0 when the block has no slimmable model). Split from
// nam_studio_block_model_info so the ABI never has to hand back a pointer into
// engine-owned storage.
int32_t nam_studio_block_model_slim_breakpoints(NamStudioGraph* graph, int32_t block_id,
                                                double* out_values, int32_t max_count);

// ── Reverb algorithm choice ─────────────────────────────────────────────

// No-op if block_id is unknown or not a NAM_STUDIO_BLOCK_REVERB block. Tier
// 2 - reconstructs the underlying wrapper instance (destroying and rebuilding
// the DSP object nam_studio_process visits), so it must not run concurrently
// with nam_studio_process; suspend audio around it.
void nam_studio_set_reverb_algorithm(NamStudioGraph* graph, int32_t block_id,
                                      NamStudioReverbAlgorithm algorithm);

// ── Delay model choice ──────────────────────────────────────────────────

// No-op if block_id is unknown or not a NAM_STUDIO_BLOCK_DELAY block. Tier 2
// - rewrites the block's param table and re-seeds its smoothing/ramp state,
// so it must not run concurrently with nam_studio_process.
// ── Cab impulse responses ──────────────────────────────────────────────
// Install an IR on a NAM_STUDIO_BLOCK_CAB block: `samples` is mono float audio
// at the graph's own sample rate, `frames` its length. Nothing is resampled here,
// so a caller with a 44.1kHz IR in a 48kHz graph should resample first. Passing
// null/0 clears it (the block returns to passthrough), and it is a no-op for
// every other block kind. The samples are copied, so the caller may free them
// immediately.
//
// Not real-time safe - it allocates and transforms the IR - so suspend audio
// around it, exactly like model loading. Convolution itself adds no latency.
void nam_studio_load_ir(NamStudioGraph* graph, int32_t block_id, const float* samples,
                        int32_t frames);
// Install an IR from the bytes of a WAV file. The core decodes it (8/16/24/32-bit
// PCM or 32/64-bit float, any channel count, folded to mono) and resamples it to
// the graph's rate when they differ, so every front end gets the same result from
// the same file. Returns the number of samples installed, or 0 if the block isn't
// a cab or the file can't be decoded - which is also how an unsupported or
// corrupt file reports itself, rather than by throwing.
//
// This is what a desktop app or plugin uses: only a browser has
// AudioContext.decodeAudioData to hand it float samples instead. Not real-time
// safe; suspend audio around it.
int32_t nam_studio_load_ir_wav(NamStudioGraph* graph, int32_t block_id, const uint8_t* bytes,
                               int32_t size);
void nam_studio_unload_ir(NamStudioGraph* graph, int32_t block_id);
// Length in samples of the IR installed on the block, 0 if none.
int32_t nam_studio_block_ir_length(NamStudioGraph* graph, int32_t block_id);

// The user-facing reverb controls (see openaxe::engine::ReverbControl):
// room size and damping are abstractions over the current algorithm's decay
// and high cut, and the rest resolve to whichever symbol that algorithm uses
// (Hall's pre-delay is `delay`, Room's is `predelay`, ...). No-op for
// non-reverb blocks and for controls the current algorithm lacks. Tier 1:
// resolves through a per-block atomic cache installed with the algorithm, so
// it is safe from any thread and never races a set_reverb_algorithm on
// another thread (issue #211). Every front end should drive reverb through
// this rather than reimplementing the per-algorithm mapping over
// nam_studio_set_param.
typedef enum {
  NAM_STUDIO_REVERB_ROOM_SIZE = 0,   // 0..0.97
  NAM_STUDIO_REVERB_DAMPING = 1,     // 0..1
  NAM_STUDIO_REVERB_WIDTH = 2,       // percent
  NAM_STUDIO_REVERB_PREDELAY = 3,    // ms
  NAM_STUDIO_REVERB_SPIN = 4,        // Hz
  NAM_STUDIO_REVERB_WANDER = 5,      // ms
  NAM_STUDIO_REVERB_EARLY_SEND = 6,  // percent
  NAM_STUDIO_REVERB_DRY_LEVEL = 7,   // percent
} NamStudioReverbControl;

void nam_studio_set_reverb_control(NamStudioGraph* graph, int32_t block_id,
                                  NamStudioReverbControl control, float value);

void nam_studio_set_delay_model(NamStudioGraph* graph, int32_t block_id,
                                 NamStudioDelayModel model);

// ── Bypass / master bus ─────────────────────────────────────────────────
// Real-time safe (lock-free atomics) - no graph mutation, safe to call from
// any thread including concurrently with nam_studio_process.

// No-op if block_id is unknown. While bypassed, the block's DSP is skipped
// and its port-0 input passes through to its output unchanged.
void nam_studio_set_bypass(NamStudioGraph* graph, int32_t block_id, int32_t bypassed);
int32_t nam_studio_is_bypassed(NamStudioGraph* graph, int32_t block_id);

// Per-block Input/Output trim, 1.0 = unity, no-op if block_id is unknown.
// This is what a UI's per-block Input/Output level knobs should drive on
// every block kind. Do NOT use the Amp family's input_level/output_level
// params for that: those carry the loaded NAM model's own dBu calibration
// (nam_studio_load_nam_model seeds them from the model file), so writing a
// volume value there silently recalibrates the amp instead of trimming it.
// Applied whether or not the block is bypassed.
void nam_studio_set_block_input_trim(NamStudioGraph* graph, int32_t block_id, float gain);
float nam_studio_get_block_input_trim(NamStudioGraph* graph, int32_t block_id);
void nam_studio_set_block_output_trim(NamStudioGraph* graph, int32_t block_id, float gain);
float nam_studio_get_block_output_trim(NamStudioGraph* graph, int32_t block_id);

// Scales the final output bus (post-graph, pre-host). 1.0 = unity.
void nam_studio_set_master_level(NamStudioGraph* graph, float level);
float nam_studio_get_master_level(NamStudioGraph* graph);
// Independent of master level and of the tuner mute below - the output bus
// is silent while either mute source is set, so toggling one off doesn't
// clobber the other's state.
void nam_studio_set_master_muted(NamStudioGraph* graph, int32_t muted);
int32_t nam_studio_is_master_muted(NamStudioGraph* graph);
void nam_studio_set_tuner_muted(NamStudioGraph* graph, int32_t muted);
int32_t nam_studio_is_tuner_muted(NamStudioGraph* graph);

// ── Metering ────────────────────────────────────────────────────────────

// Peak |sample| over the last nam_studio_process call, 0 for an unknown block.
float nam_studio_get_meter(NamStudioGraph* graph, int32_t block_id);
// Fraction of real-time budget the last nam_studio_process call used.
float nam_studio_get_cpu_load(NamStudioGraph* graph);

// ── Automation slot map (issue #121) ─────────────────────────────────────
// VST3/AU/CLAP hosts need a fixed, session-stable parameter list; rigs are
// dynamic grids addressed by (block_id, index). A fixed pool of
// NAM_STUDIO_AUTOMATION_SLOT_COUNT slots mediates: slot 0 is permanently the
// master bus (level/mute), slots 1..15 bind to live blocks. Host parameter id
// <-> slot addressing is laid out in
// packages/vst3/generated/automation_param_map.h (generated from
// param_schema.json's "pluginAutomation" section); bindings ride the rig
// state document ("automationSlots") and survive save/load.
//
// Values cross every function here normalized 0..1 and map linearly onto the
// resolved param's [min, max] - native units never leave core. Bind/unbind
// are control-thread calls; param get/set are lock-free like their
// (block_id, index) counterparts.

#define NAM_STUDIO_AUTOMATION_SLOT_COUNT 16
#define NAM_STUDIO_AUTOMATION_PARAMS_PER_SLOT 20

// Binds `slot` to `block_id` and returns 1. Slot values already written
// through that slot re-apply onto the new target through its own ranges;
// untouched entries leave the block alone. Returns 0 for slot 0 (permanently
// the master bus), out-of-range slots, and unknown blocks. Not real-time safe.
int32_t nam_studio_bind_automation_slot(NamStudioGraph* graph, int32_t slot,
                                        int32_t block_id);
// Clears a binding (remembered values survive a later rebind). Returns 1 on
// success, 0 for slot 0 / out-of-range / already-unbound. Not real-time safe.
int32_t nam_studio_unbind_automation_slot(NamStudioGraph* graph, int32_t slot);

// The block bound to `slot`: its id, or -1 if unbound, -2 if out of range,
// -3 for slot 0 (exists, permanently something else).
int32_t nam_studio_automation_slot_block(NamStudioGraph* graph, int32_t slot);

// Number of live entries `slot` exposes: 2 for the master slot, the frozen
// stride (NAM_STUDIO_AUTOMATION_PARAMS_PER_SLOT) for block slots, 0 otherwise.
int32_t nam_studio_automation_slot_param_count(NamStudioGraph* graph, int32_t slot);

// Dynamic descriptor of one entry: the bound block's param table row (name/
// symbol/min/max/unit), or the master slot's fixed descriptors. Returns 0 and
// leaves outputs untouched when the entry resolves to nothing - unbound slot,
// entry beyond the block's own table, bad indices. Optional out-params (pass
// NULL to skip), mirroring nam_studio_block_param_info.
int32_t nam_studio_automation_slot_param_info(NamStudioGraph* graph, int32_t slot,
                                              int32_t entry, const char** out_name,
                                              const char** out_symbol, float* out_min,
                                              float* out_max, const char** out_unit);

// Write one entry, normalized 0..1 (clamped). Applies to the bound target
// where one resolves; always updates what the slot remembers either way.
void nam_studio_set_automation_param_normalized(NamStudioGraph* graph, int32_t slot,
                                                int32_t entry, float normalized);
// Read one entry as 0..1: live from the bound target where one resolves, else
// the last value written through the slot. 0.0 for invalid indices.
float nam_studio_get_automation_param_normalized(NamStudioGraph* graph, int32_t slot,
                                                 int32_t entry);

// ── Rig state (de)serialization (issue #119) ─────────────────────────────
// The one preset/scene model for host chunks, preset files, and (eventually)
// IndexedDB - see packages/core/README.md's "Rig state wire format" for the
// schema and versioning policy. Both are control-thread calls: they allocate,
// and load rebuilds the topology. Suspend audio around them.

// Serializes the entire graph: blocks (kind, row/col, every param by SYMBOL,
// bypass, in/out trim, reverb algorithm, delay model), edges, master
// level/mute. Writes a NUL-terminated JSON document into out_json (capacity
// bytes) and returns the number of bytes written INCLUDING the terminator.
// When out_json is NULL, returns the required capacity instead and writes
// nothing - the usual two-call sizing pattern:
//
//   int32_t needed = nam_studio_serialize_state(g, NULL, 0);
//   char* buf = malloc(needed);
//   nam_studio_serialize_state(g, buf, needed);
//
// Returns -1 if capacity is too small (the required size still holds) or
// out_json is non-NULL with capacity <= 0. Not real-time safe.
int32_t nam_studio_serialize_state(NamStudioGraph* graph, char* out_json, int32_t capacity);

// Same document, with control over asset embedding (issue #120). With
// embed_assets non-zero, every loaded NAM capture and cab IR is embedded into
// the document as base64, making it self-contained: loading it on a machine
// that has never seen the source files restores the rig bit-identically. With
// zero, blocks record only each asset's name, content hash and source path,
// and loading falls back to those paths - smaller documents for callers that
// keep a model library alongside their presets. A plugin writing a host chunk
// wants embedding; a desktop app writing a small .preset next to a model
// library may not. Same two-call pattern and return conventions as above;
// not real-time safe.
int32_t nam_studio_serialize_state_ex(NamStudioGraph* graph, int32_t embed_assets,
                                      char* out_json, int32_t capacity);

// Names of the assets a load could not resolve (issue #120): neither an
// embedded payload nor the recorded source path produced a usable asset for
// some block. Count is 0 when everything restored (or nothing was loaded
// yet); entries are the assets' display names, "(unnamed model)" /
// "(unnamed IR)" when a block carried none. A UI offers relinking here -
// matching by content hash is what the document suggests. The list reflects
// the most recent nam_studio_load_state call on this graph and stays valid
// until the next one.
int32_t nam_studio_state_missing_asset_count(NamStudioGraph* graph);
const char* nam_studio_state_missing_asset(NamStudioGraph* graph, int32_t index);

// ── Tone fingerprint (issue #288) ──────────────────────────────────────
// Probe a NAM model JSON and return its gain (dB) + brightness (0..1).
// Returns 1 on success, 0 if the JSON is not a valid NAM model or any
// required out-pointer is null. Probe runs off the audio thread and is not
// real-time safe.
int32_t nam_studio_compute_fingerprint(const char* json, float* out_gain_db,
                                       float* out_brightness);

// ── Tuner — pitch detection + note mapping (issue #123) ────────────────
// Pure functions over a buffer — no graph, no state. Safe from any thread.
// These are the one detector every front end shares: web, desktop, plugin,
// mobile. The web tuner's previous TS autocorrelation (apps/web/src/tuner/)
// now forwards to these through WASM; the native path calls them directly.

// Returns the detected fundamental in Hz, or 0 when no confident pitch was
// found (silence, noise, chord). `samples` is mono float audio at
// `sample_rate`. Returns 0 for null/empty buffers or invalid rates. The
// searched range is 25..1500 Hz — a 5-string bass's low B up to past a
// guitar's high frets — matching the TS defaults pitchDetect.ts used.
float nam_studio_detect_pitch(const float* samples, int32_t count, double sample_rate);

// Hz → note/cents mapping so all four front ends display the same reading.
// `frequency` must be > 0. `reference_a4` is the A4 concert pitch (440).
// Returns 1 on success, 0 if frequency <= 0 or any required out pointer is
// null. `out_name` points at static storage (one of "C","C#",...,"B") and
// stays valid forever; `out_octave` is the octave number; `out_cents` is
// -50..50, 0 = dead on.
int32_t nam_studio_frequency_to_note(float frequency, double reference_a4,
                                     const char** out_name, int32_t* out_octave,
                                     int32_t* out_cents);

// ── MIDI mapping (issue #124) ──────────────────────────────────────────
// The mapping model moved from TypeScript (apps/web/src/midi/*) into core
// so every front end reuses it. Front ends supply only the transport (Web
// MIDI on web, the host's event list in a plugin, CoreMIDI/ALSA on desktop).
// Bindings ride the rig state document ("midiMappings") and survive a DAW
// project reload (#119). Channel filtering is per-mapping (the match includes
// the channel); `selectedInputId` remains a front-end-only preference.
//
// Mutation (add/remove/clear, arm/cancel learn) is control-thread only
// (Tier 2): it mutates the mapping vector. Handle is safe from any thread
// (takes a shared lock) — a host's process callback forwards raw MIDI bytes
// plus a per-event sample offset and lets core resolve and apply the binding.
// `sample_offset` is accepted for sample-accurate scheduling; this build
// dispatches immediately (offset unused, since slot/scene actions are
// control-thread work — a future build can queue per offset without changing
// the ABI).

typedef enum NamStudioMidiMessageType {
  NAM_STUDIO_MIDI_NOTEON = 0,
  NAM_STUDIO_MIDI_CC = 1,
  NAM_STUDIO_MIDI_PC = 2,
} NamStudioMidiMessageType;

typedef enum NamStudioMidiActionKind {
  NAM_STUDIO_MIDI_ACTION_SLOT = 0,        // slot 0-7, whatever scene is current
  NAM_STUDIO_MIDI_ACTION_SCENE = 1,       // scene 0-63, absolute jump
  NAM_STUDIO_MIDI_ACTION_NEXT_SCENE = 2,
  NAM_STUDIO_MIDI_ACTION_PREV_SCENE = 3,
} NamStudioMidiActionKind;

// How many mappings are stored.
int32_t nam_studio_midi_mapping_count(NamStudioGraph* graph);
// One mapping by index. Returns 1 on success, 0 for out-of-range. Every
// out-param is optional (pass NULL to skip).
int32_t nam_studio_midi_get_mapping(NamStudioGraph* graph, int32_t index,
                                    NamStudioMidiMessageType* out_type,
                                    int32_t* out_channel, int32_t* out_number,
                                    NamStudioMidiActionKind* out_kind,
                                    int32_t* out_slot, int32_t* out_scene);
// Adds a binding, deduping like the web's midiStore.completeLearn: any
// existing mapping whose action key == the new action's key, or whose match
// key == the new match's key, is removed first. Returns 1 on success, 0 for
// invalid match/action. Control-thread only.
int32_t nam_studio_midi_add_mapping(NamStudioGraph* graph,
                                    NamStudioMidiMessageType type,
                                    int32_t channel, int32_t number,
                                    NamStudioMidiActionKind kind,
                                    int32_t slot, int32_t scene);
// Removes the mapping at `index`; returns 1 on success, 0 for out-of-range. Control-thread only.
int32_t nam_studio_midi_remove_mapping(NamStudioGraph* graph, int32_t index);
// Removes every mapping and cancels any active learn. Control-thread only.
void nam_studio_midi_clear_mappings(NamStudioGraph* graph);

// Arms learn for `action`; returns 1 on success, 0 for invalid action. Control-thread only.
int32_t nam_studio_midi_arm_learn(NamStudioGraph* graph, NamStudioMidiActionKind kind,
                                  int32_t slot, int32_t scene);
void nam_studio_midi_cancel_learn(NamStudioGraph* graph);
int32_t nam_studio_midi_is_learning(NamStudioGraph* graph);
// The action currently being learned, or 0 if none. Every out-param optional.
int32_t nam_studio_midi_get_learn_target(NamStudioGraph* graph,
                                         NamStudioMidiActionKind* out_kind,
                                         int32_t* out_slot, int32_t* out_scene);

// Pure helpers, no graph — mirrors message.ts / actions.ts.
int32_t nam_studio_midi_parse_message(const uint8_t* data, int32_t size,
                                      NamStudioMidiMessageType* out_type,
                                      int32_t* out_channel, int32_t* out_number,
                                      int32_t* out_value);
int32_t nam_studio_midi_is_trigger_edge(NamStudioMidiMessageType type, int32_t value);
int32_t nam_studio_midi_message_matches(NamStudioMidiMessageType msg_type,
                                        int32_t msg_channel, int32_t msg_number,
                                        NamStudioMidiMessageType match_type,
                                        int32_t match_channel, int32_t match_number);

// Feeds raw MIDI bytes through the mapping. `sample_offset` is the per-event
// offset within the current audio block (0 = block start). Currently
// dispatched immediately; a future build may schedule per offset without ABI
// change. Returns 0 for "no match / not trigger / not parseable", 1 for
// "dispatched a bound action", 2 for "learn completed" (the message was
// consumed to create a binding, not dispatched). When it returns 1 or 2,
// out params (all optional) echo what fired or was learned.
int32_t nam_studio_midi_handle_message(NamStudioGraph* graph,
                                       const uint8_t* data, int32_t size,
                                       int32_t sample_offset,
                                       NamStudioMidiActionKind* out_kind,
                                       int32_t* out_slot, int32_t* out_scene,
                                       NamStudioMidiMessageType* out_match_type,
                                       int32_t* out_match_channel,
                                       int32_t* out_match_number);

// nam_studio_load_state's result.
typedef enum NamStudioLoadStateResult {
  NAM_STUDIO_LOAD_STATE_OK = 0,
  // Not valid JSON.
  NAM_STUDIO_LOAD_STATE_PARSE_ERROR = 1,
  // schemaVersion newer than this build knows - never guessed at.
  NAM_STUDIO_LOAD_STATE_UNSUPPORTED_VERSION = 2,
  // Wrong root shape / missing required fields.
  NAM_STUDIO_LOAD_STATE_BAD_DOCUMENT = 3,
} NamStudioLoadStateResult;

// Rebuilds the graph from a previously serialized document. Clears the
// existing topology first. Returns 0 on success, non-zero for a malformed or
// unsupported-version document (in which cases the existing graph is left
// untouched). Malformed individual entries inside an otherwise valid document
// are NOT failures: they are skipped with a warning and the rest restores -
// mirroring applyPreset's partial-failure tolerance (#64). Unknown param
// symbols and dangling edges skip the same way. Block assets (models/IRs)
// restore from their embedded payload first, then their recorded path; ones
// that resolve neither leave their block empty and are reported through
// nam_studio_state_missing_asset_count / _missing_asset. Not real-time safe -
// suspend audio around it.
NamStudioLoadStateResult nam_studio_load_state(NamStudioGraph* graph, const char* json);

#ifdef __cplusplus
}
#endif
