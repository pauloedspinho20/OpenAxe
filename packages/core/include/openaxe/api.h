#pragma once

// ── ABI naming (issue #311) ────────────────────────────────────────────
// Product-prefixed identifiers are `openaxe_*` / `OpenAxe*` / `OPENAXE_*`
// (renamed from `openaxe_*` in #311). They are baked into the committed
// WASM artifacts (`apps/web/public/wasm-core/openaxe_core.{js,wasm}` +
// `openAxeRigWorklet.js`), so any future rename must be atomic: api.h +
// `EXPORTED_FUNCTIONS` + `scripts/check-wasm-exports.mjs` + WASM rebuild +
// recommit. Genuine Neural Amp Modeler names (`NamAmp`, `NamLoadError`,
// `NamModelInfo`, `.nam`, `third_party/nam-core`, `NAM_SAMPLE_FLOAT`, …)
// keep their spelling — use anchored patterns (`openaxe_`, `OPENAXE_`,
// `OpenAxe`, `openAxe`), never bare `nam`.

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Opaque handle wrapping a openaxe::engine::AudioEngine (topology +
// live DSP + real-time processing). This is the public C ABI every platform
// target (#15 desktop, #16 VST3, #17 mobile, #22 web/WASM) links against.
typedef struct OpenAxeGraph OpenAxeGraph;

// ── Threading contract (issue #211) ──────────────────────────────────────
// Every function here is exactly one of two tiers, stated on the declaration:
//
//   Tier 1 - safe to call from ANY thread, concurrently with
//   openaxe_process, lock-free: openaxe_get_param /
//   openaxe_set_param (EXCEPT the Amp-family slim-size param, which is
//   Tier 2), openaxe_block_param_count / _param_info (only where those
//   read the DSP's param table, and those are control-thread calls - see the
//   notes on them), openaxe_set_reverb_control, the bypass/trim/master-bus
//   calls, metering, and the automation-slot param get/set.
//
//   Tier 2 - structural / DSP-swapping: everything else that builds or
//   replaces a block's DSP, rewrites its param table, loads a model/IR, or
//   changes the topology. These mutate shared non-atomic BlockState fields,
//   so the caller MUST ensure openaxe_process is not running when it
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
OpenAxeGraph* openaxe_graph_create(void);
// NULL is a no-op.
void openaxe_graph_destroy(OpenAxeGraph* graph);

// Mirrors openaxe::graph::BlockKind (block.h) 1:1 - kept as its own C
// enum (rather than exposing the C++ enum class directly) so this header
// has no C++-only dependency. api.cpp translates via an explicit switch,
// not ordinal identity, so block.h stays free to reorder its own enum.
typedef enum OpenAxeBlockKind {
  OPENAXE_BLOCK_NOISE_GATE,
  OPENAXE_BLOCK_COMPRESSOR,
  OPENAXE_BLOCK_EQ,
  OPENAXE_BLOCK_CHORUS,
  OPENAXE_BLOCK_FLANGER,
  OPENAXE_BLOCK_PHASER,
  OPENAXE_BLOCK_TREMOLO,
  OPENAXE_BLOCK_DELAY,
  OPENAXE_BLOCK_REVERB,
  OPENAXE_BLOCK_AMP,
  OPENAXE_BLOCK_AMP_CAB,
  OPENAXE_BLOCK_PEDAL,
  OPENAXE_BLOCK_OUTBOARD,
  OPENAXE_BLOCK_SPACE,
  OPENAXE_BLOCK_CAB,
  OPENAXE_BLOCK_MIXER,
  OPENAXE_BLOCK_RING_MOD,
  OPENAXE_BLOCK_FILTER,
  OPENAXE_BLOCK_PITCH_SHIFTER,
  OPENAXE_BLOCK_GRANULAR_DELAY,
  OPENAXE_BLOCK_ROTARY,
  // Send/Return pairs (issue #274) - appended (never re-ordered) so the web
  // worklet's ordinal KIND_TO_CORE map and any persisted kind ordinals keep
  // their meaning. Send N routes implicitly into Return N.
  OPENAXE_BLOCK_SEND_1,
  OPENAXE_BLOCK_RETURN_1,
  OPENAXE_BLOCK_SEND_2,
  OPENAXE_BLOCK_RETURN_2,
} OpenAxeBlockKind;

// Only meaningful for OPENAXE_BLOCK_REVERB blocks - selects which of the
// 4 wrapped Dragonfly Reverb algorithms (plus the hand-rolled spring tank)
// backs the block. New reverb blocks default to Hall.
typedef enum OpenAxeReverbAlgorithm {
  OPENAXE_REVERB_HALL,
  OPENAXE_REVERB_ROOM,
  OPENAXE_REVERB_PLATE,
  OPENAXE_REVERB_EARLY_REFLECTIONS,
  OPENAXE_REVERB_SPRING,
} OpenAxeReverbAlgorithm;

// Only meaningful for OPENAXE_BLOCK_DELAY blocks - selects which delay
// character backs the block. New delay blocks default to
// OPENAXE_DELAY_DIGITAL.
typedef enum OpenAxeDelayModel {
  OPENAXE_DELAY_DIGITAL,
  OPENAXE_DELAY_ANALOG,
  OPENAXE_DELAY_TAPE,
} OpenAxeDelayModel;

// openaxe_load_nam_model's result - mirrors openaxe::dsp::NamLoadError.
typedef enum OpenAxeLoadResult {
  OPENAXE_LOAD_OK = 0,
  OPENAXE_LOAD_FILE_NOT_FOUND = 1,
  OPENAXE_LOAD_INVALID_FORMAT = 2,
} OpenAxeLoadResult;

// Reserved block-id sentinels for the two fixed rail endpoints - never real
// block ids (openaxe_add_block never returns these). Pass these directly
// as from_block/to_block to openaxe_connect to wire the graph's external
// input/output.
#define OPENAXE_IN_RAIL (-1)
#define OPENAXE_OUT_RAIL (-2)

// ── Topology ────────────────────────────────────────────────────────────
// Not real-time safe: constructs/destroys live DSP objects and (re)allocates
// buffers. Do not call concurrently with openaxe_process.

// Returns the new block's id (>= 0).
// Canonical wire name for a block kind, e.g. "noise-gate" for
// OPENAXE_BLOCK_NOISE_GATE. Returns nullptr for an unknown value.
//
// These strings are the contract between the C++ core and every front end: the
// web app, the desktop bridge and the plugin bridge all speak them. They lived
// as a hand-maintained table in each bridge (issue #300 J3), so adding a block
// kind meant editing the same 27 rows in two places — and the plugin's copy had
// been rewritten as a 27-branch if/else chain besides. Mobile would have made
// it four copies.
const char* openaxe_block_kind_name(OpenAxeBlockKind kind);

// Inverse of the above. Returns 0 on success and fills *out_kind; returns
// non-zero for an unknown name, leaving *out_kind untouched.
int32_t openaxe_block_kind_from_name(const char* name, OpenAxeBlockKind* out_kind);

int32_t openaxe_add_block(OpenAxeGraph* graph, OpenAxeBlockKind kind, int32_t row, int32_t col);
// No-op if block_id is unknown.
void openaxe_remove_block(OpenAxeGraph* graph, int32_t block_id);
// No-op if block_id is unknown. May silently drop edges left-to-right
// ordering no longer permits, mirroring GraphRig.ts's moveBlock.
void openaxe_move_block(OpenAxeGraph* graph, int32_t block_id, int32_t row, int32_t col);
// Returns the new edge's id (>= 0), or -1 if the connection was rejected
// (self-jack, wrong column order, port out of range, or target already
// connected - see graph_validation.h for exact rules).
int32_t openaxe_connect(OpenAxeGraph* graph, int32_t from_block, int32_t from_port,
                            int32_t to_block, int32_t to_port);
// No-op if edge_id is unknown.
void openaxe_disconnect(OpenAxeGraph* graph, int32_t edge_id);

// ── Lifecycle / processing ─────────────────────────────────────────────

// Not real-time safe. Must be called at least once before
// openaxe_process, and again whenever sample_rate/max_block_size change
// or the topology changes (add/remove/connect/disconnect).
void openaxe_reset(OpenAxeGraph* graph, double sample_rate, int32_t max_block_size);

// Real-time safe once openaxe_reset has been called. input/output are
// arrays of input_channels/output_channels buffers, each num_frames samples
// (num_frames must be <= the max_block_size passed to openaxe_reset).
// input_channels/output_channels may be 1 or 2 regardless of the graph's
// internal stereo representation: mono input duplicates to both internal
// channels; mono output averages the internal stereo pair down.
void openaxe_process(OpenAxeGraph* graph, const float* const* input, int32_t input_channels,
                         float* const* output, int32_t output_channels, int32_t num_frames);

// ── Gapless staged switching (issue #367) ───────────────────────────────
// A/B rig switching without silence gaps, clicks, or audio-thread stalls:
//
//   1. openaxe_staged_graph_create(parent) returns a second graph handle.
//      Build the next rig into it with the ordinary entry points above
//      (add blocks, set params, load models/IRs, connect, reset, even
//      openaxe_load_state) - they resolve to the staged engine, which is
//      never processed before the commit, so staging needs no audio
//      suspension and needs no Tier-2 exclusion against openaxe_process on
//      the parent (it must still be serialized against other control-thread
//      calls, like every Tier-2 call). NULL when parent is null.
//   2. openaxe_staged_graph_commit(parent, staged, fade_ms, drain_ms) makes
//      the staged rig live: the next openaxe_process buffer picks it up and
//      crossfades old->new (equal-power, fade_ms, clamped 0..500) while the
//      old rig's input fades to silence, then keeps the old rig rendering
//      silent-input tails under the new rig for drain_ms (clamped 0..5000)
//      before retiring it - reverb/delay tails ring out instead of cutting.
//      Session-level state (master bus, tuner mute, automation slots, MIDI
//      mappings) carries over; block params/bypass/trims do not (the staged
//      preset defines its own rig). The commit itself is lock-free with
//      respect to openaxe_process (a single atomic publish).
//      Returns 1 on success, 0 when rejected (null/foreign handle, staged
//      never reset, or sample-rate/block-size mismatch between staged and
//      parent - reset the staged handle with the parent's values), -1 when
//      busy (a previous switch is still fading/draining - retry).
//      On success the staged handle is CONSUMED (deleted) - do not touch it
//      again. On 0/-1 the caller still owns it: destroy it to abandon the
//      stage, or fix up / retry and commit again.
//   3. openaxe_switch_active(parent) reports 1 while a fade or tail drain is
//      in flight, else 0.
//
// Destroying a staged handle without committing (openaxe_graph_destroy)
// abandons the stage and leaves the parent untouched. openaxe_reset on the
// parent abandons any in-flight switch. openaxe_process on a staged handle
// runs its engine standalone (harmless, pointless) - process the parent.
OpenAxeGraph* openaxe_staged_graph_create(OpenAxeGraph* parent);
int32_t openaxe_staged_graph_commit(OpenAxeGraph* parent, OpenAxeGraph* staged, int32_t fade_ms,
                                    int32_t drain_ms);
int32_t openaxe_switch_active(OpenAxeGraph* graph);

// ── Params (generic across every block kind; Tier 1, lock-free) ────────
// param_count/param_info read the block's atomic count and live DSP table:
// they are safe from any thread for the count itself (issue #211), and the
// info read visits the DSP's param table, so it must not race a Tier-2
// algorithm/model swap (the desktop routes it through its control thread).

// 0 for an unknown block or a kind with no wrapped DSP yet.
int32_t openaxe_block_param_count(OpenAxeGraph* graph, int32_t block_id);
// Returns 0 (false) and leaves outputs untouched if block_id/index is invalid.
int32_t openaxe_block_param_info(OpenAxeGraph* graph, int32_t block_id, int32_t index,
                                     const char** out_name, const char** out_symbol, float* out_min,
                                     float* out_max, const char** out_unit);
// 0.0 for an unknown block/index.
float openaxe_get_param(OpenAxeGraph* graph, int32_t block_id, int32_t index);
// No-op for an unknown block/index. Lock-free (safe from any thread) for
// every param except an Amp-family block's Slim Size, which synchronously
// forwards to NamAmp::SetSlimSize - that one is Tier 2 (not real-time safe,
// NAMCore may reallocate), so it must not run concurrently with
// openaxe_process; the desktop bridge routes it through its suspend
// handshake (issue #211).
void openaxe_set_param(OpenAxeGraph* graph, int32_t block_id, int32_t index, float value);

// ── NAM model management (off the audio thread) ────────────────────────

OpenAxeLoadResult openaxe_load_nam_model(OpenAxeGraph* graph, int32_t block_id,
                                               const char* file_path);
// Same, from the .nam file's JSON content in memory rather than a path. This is
// the entry point a browser needs (no filesystem) and the one a plugin uses when
// restoring host state; the desktop app uses it too, so its webview never has to
// stage a temp file. Same non-real-time contract as the path form.
OpenAxeLoadResult openaxe_load_nam_model_json(OpenAxeGraph* graph, int32_t block_id,
                                                   const char* json);

void openaxe_unload_nam_model(OpenAxeGraph* graph, int32_t block_id);
// Returns 0/1; 0 for an unknown or non-Amp-family block.
int32_t openaxe_block_has_model(OpenAxeGraph* graph, int32_t block_id);

// Metadata of the capture loaded into a block: 1 on success, 0 for an unknown
// block, a non-amp kind, or no model loaded. Every out-param is optional (pass
// null to skip). Flags are 0/1; `sample_rate` is the model's trained rate (-1 if
// it doesn't declare one); `loudness_db` and the two dBu levels are only
// meaningful when their has_* flag is 1. A slimmable capture can trade fidelity
// for CPU at `slim_breakpoint_count` discrete sizes - read them with
// openaxe_block_model_slim_breakpoints.
int32_t openaxe_block_model_info(OpenAxeGraph* graph, int32_t block_id, double* out_sample_rate,
                                    int32_t* out_has_loudness, double* out_loudness_db,
                                    int32_t* out_has_input_level, double* out_input_level_dbu,
                                    int32_t* out_has_output_level, double* out_output_level_dbu,
                                    int32_t* out_is_slimmable, int32_t* out_slim_breakpoint_count);

// Copies up to `max_count` slim-size breakpoints into `out_values` and returns
// how many were written (0 when the block has no slimmable model). Split from
// openaxe_block_model_info so the ABI never has to hand back a pointer into
// engine-owned storage.
int32_t openaxe_block_model_slim_breakpoints(OpenAxeGraph* graph, int32_t block_id,
                                                double* out_values, int32_t max_count);

// ── Reverb algorithm choice ─────────────────────────────────────────────

// No-op if block_id is unknown or not a OPENAXE_BLOCK_REVERB block. Tier
// 2 - reconstructs the underlying wrapper instance (destroying and rebuilding
// the DSP object openaxe_process visits), so it must not run concurrently
// with openaxe_process; suspend audio around it.
void openaxe_set_reverb_algorithm(OpenAxeGraph* graph, int32_t block_id,
                                      OpenAxeReverbAlgorithm algorithm);

// ── Delay model choice ──────────────────────────────────────────────────

// No-op if block_id is unknown or not a OPENAXE_BLOCK_DELAY block. Tier 2
// - rewrites the block's param table and re-seeds its smoothing/ramp state,
// so it must not run concurrently with openaxe_process.
// ── Cab impulse responses ──────────────────────────────────────────────
// Install an IR on a OPENAXE_BLOCK_CAB block: `samples` is mono float audio
// at the graph's own sample rate, `frames` its length. Nothing is resampled here,
// so a caller with a 44.1kHz IR in a 48kHz graph should resample first. Passing
// null/0 clears it (the block returns to passthrough), and it is a no-op for
// every other block kind. The samples are copied, so the caller may free them
// immediately.
//
// Not real-time safe - it allocates and transforms the IR - so suspend audio
// around it, exactly like model loading. Convolution itself adds no latency.
void openaxe_load_ir(OpenAxeGraph* graph, int32_t block_id, const float* samples,
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
int32_t openaxe_load_ir_wav(OpenAxeGraph* graph, int32_t block_id, const uint8_t* bytes,
                               int32_t size);
void openaxe_unload_ir(OpenAxeGraph* graph, int32_t block_id);
// Length in samples of the IR installed on the block, 0 if none.
int32_t openaxe_block_ir_length(OpenAxeGraph* graph, int32_t block_id);

// The user-facing reverb controls (see openaxe::engine::ReverbControl):
// room size and damping are abstractions over the current algorithm's decay
// and high cut, and the rest resolve to whichever symbol that algorithm uses
// (Hall's pre-delay is `delay`, Room's is `predelay`, ...). No-op for
// non-reverb blocks and for controls the current algorithm lacks. Tier 1:
// resolves through a per-block atomic cache installed with the algorithm, so
// it is safe from any thread and never races a set_reverb_algorithm on
// another thread (issue #211). Every front end should drive reverb through
// this rather than reimplementing the per-algorithm mapping over
// openaxe_set_param.
typedef enum {
  OPENAXE_REVERB_ROOM_SIZE = 0,   // 0..0.97
  OPENAXE_REVERB_DAMPING = 1,     // 0..1
  OPENAXE_REVERB_WIDTH = 2,       // percent
  OPENAXE_REVERB_PREDELAY = 3,    // ms
  OPENAXE_REVERB_SPIN = 4,        // Hz
  OPENAXE_REVERB_WANDER = 5,      // ms
  OPENAXE_REVERB_EARLY_SEND = 6,  // percent
  OPENAXE_REVERB_DRY_LEVEL = 7,   // percent
} OpenAxeReverbControl;

void openaxe_set_reverb_control(OpenAxeGraph* graph, int32_t block_id,
                                  OpenAxeReverbControl control, float value);

void openaxe_set_delay_model(OpenAxeGraph* graph, int32_t block_id,
                                 OpenAxeDelayModel model);

// ── Bypass / master bus ─────────────────────────────────────────────────
// Real-time safe (lock-free atomics) - no graph mutation, safe to call from
// any thread including concurrently with openaxe_process.

// No-op if block_id is unknown. While bypassed, the block's DSP is skipped
// and its port-0 input passes through to its output unchanged.
void openaxe_set_bypass(OpenAxeGraph* graph, int32_t block_id, int32_t bypassed);
int32_t openaxe_is_bypassed(OpenAxeGraph* graph, int32_t block_id);

// Per-block Input/Output trim, 1.0 = unity, no-op if block_id is unknown.
// This is what a UI's per-block Input/Output level knobs should drive on
// every block kind. Do NOT use the Amp family's input_level/output_level
// params for that: those carry the loaded NAM model's own dBu calibration
// (openaxe_load_nam_model seeds them from the model file), so writing a
// volume value there silently recalibrates the amp instead of trimming it.
// Applied whether or not the block is bypassed.
void openaxe_set_block_input_trim(OpenAxeGraph* graph, int32_t block_id, float gain);
float openaxe_get_block_input_trim(OpenAxeGraph* graph, int32_t block_id);
void openaxe_set_block_output_trim(OpenAxeGraph* graph, int32_t block_id, float gain);
float openaxe_get_block_output_trim(OpenAxeGraph* graph, int32_t block_id);

// Scales the final output bus (post-graph, pre-host). 1.0 = unity.
void openaxe_set_master_level(OpenAxeGraph* graph, float level);
float openaxe_get_master_level(OpenAxeGraph* graph);
// Independent of master level and of the tuner mute below - the output bus
// is silent while either mute source is set, so toggling one off doesn't
// clobber the other's state.
void openaxe_set_master_muted(OpenAxeGraph* graph, int32_t muted);
int32_t openaxe_is_master_muted(OpenAxeGraph* graph);
void openaxe_set_tuner_muted(OpenAxeGraph* graph, int32_t muted);
int32_t openaxe_is_tuner_muted(OpenAxeGraph* graph);

// ── Metering ────────────────────────────────────────────────────────────

// Peak |sample| over the last openaxe_process call, 0 for an unknown block.
float openaxe_get_meter(OpenAxeGraph* graph, int32_t block_id);
// Fraction of real-time budget the last openaxe_process call used.
float openaxe_get_cpu_load(OpenAxeGraph* graph);
// Compressor (and gate) gain reduction in dB (≤0, 0 = no reduction), 0 for unknown/non-dynamics blocks. Tier 1.
float openaxe_get_gain_reduction(OpenAxeGraph* graph, int32_t block_id);
// Noise-gate openness 0..1 (1 = fully open), 0 for unknown/non-gate blocks. Tier 1.
float openaxe_get_gate_gain(OpenAxeGraph* graph, int32_t block_id);

// ── Automation slot map (issue #121) ─────────────────────────────────────
// VST3/AU/CLAP hosts need a fixed, session-stable parameter list; rigs are
// dynamic grids addressed by (block_id, index). A fixed pool of
// OPENAXE_AUTOMATION_SLOT_COUNT slots mediates: slot 0 is permanently the
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

#define OPENAXE_AUTOMATION_SLOT_COUNT 16
#define OPENAXE_AUTOMATION_PARAMS_PER_SLOT 20

// Binds `slot` to `block_id` and returns 1. Slot values already written
// through that slot re-apply onto the new target through its own ranges;
// untouched entries leave the block alone. Returns 0 for slot 0 (permanently
// the master bus), out-of-range slots, and unknown blocks. Not real-time safe.
int32_t openaxe_bind_automation_slot(OpenAxeGraph* graph, int32_t slot,
                                        int32_t block_id);
// Clears a binding (remembered values survive a later rebind). Returns 1 on
// success, 0 for slot 0 / out-of-range / already-unbound. Not real-time safe.
int32_t openaxe_unbind_automation_slot(OpenAxeGraph* graph, int32_t slot);

// The block bound to `slot`: its id, or -1 if unbound, -2 if out of range,
// -3 for slot 0 (exists, permanently something else).
int32_t openaxe_automation_slot_block(OpenAxeGraph* graph, int32_t slot);

// Number of live entries `slot` exposes: 2 for the master slot, the frozen
// stride (OPENAXE_AUTOMATION_PARAMS_PER_SLOT) for block slots, 0 otherwise.
int32_t openaxe_automation_slot_param_count(OpenAxeGraph* graph, int32_t slot);

// Dynamic descriptor of one entry: the bound block's param table row (name/
// symbol/min/max/unit), or the master slot's fixed descriptors. Returns 0 and
// leaves outputs untouched when the entry resolves to nothing - unbound slot,
// entry beyond the block's own table, bad indices. Optional out-params (pass
// NULL to skip), mirroring openaxe_block_param_info.
int32_t openaxe_automation_slot_param_info(OpenAxeGraph* graph, int32_t slot,
                                              int32_t entry, const char** out_name,
                                              const char** out_symbol, float* out_min,
                                              float* out_max, const char** out_unit);

// Write one entry, normalized 0..1 (clamped). Applies to the bound target
// where one resolves; always updates what the slot remembers either way.
void openaxe_set_automation_param_normalized(OpenAxeGraph* graph, int32_t slot,
                                                int32_t entry, float normalized);
// Read one entry as 0..1: live from the bound target where one resolves, else
// the last value written through the slot. 0.0 for invalid indices.
float openaxe_get_automation_param_normalized(OpenAxeGraph* graph, int32_t slot,
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
//   int32_t needed = openaxe_serialize_state(g, NULL, 0);
//   char* buf = malloc(needed);
//   openaxe_serialize_state(g, buf, needed);
//
// Returns -1 if capacity is too small (the required size still holds) or
// out_json is non-NULL with capacity <= 0. Not real-time safe.
int32_t openaxe_serialize_state(OpenAxeGraph* graph, char* out_json, int32_t capacity);

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
int32_t openaxe_serialize_state_ex(OpenAxeGraph* graph, int32_t embed_assets,
                                      char* out_json, int32_t capacity);

// Names of the assets a load could not resolve (issue #120): neither an
// embedded payload nor the recorded source path produced a usable asset for
// some block. Count is 0 when everything restored (or nothing was loaded
// yet); entries are the assets' display names, "(unnamed model)" /
// "(unnamed IR)" when a block carried none. A UI offers relinking here -
// matching by content hash is what the document suggests. The list reflects
// the most recent openaxe_load_state call on this graph and stays valid
// until the next one.
int32_t openaxe_state_missing_asset_count(OpenAxeGraph* graph);
const char* openaxe_state_missing_asset(OpenAxeGraph* graph, int32_t index);

// Block kinds the most recent openaxe_load_state could not place (#313),
// de-duped: either this build was compiled without the kind
// (packages/core/effects.config.json marked it compiled:false), or the
// document names a kind from a newer OpenAxe. Either way the block is dropped
// and the rest of the rig still restores, so a UI should tell the user which
// pedals went missing rather than silently losing them. Entries are the wire
// kind strings ("ring-mod", ...). Same lifetime rule as the missing-asset
// list: valid until the next load on this graph.
int32_t openaxe_state_unsupported_block_count(OpenAxeGraph* graph);
const char* openaxe_state_unsupported_block(OpenAxeGraph* graph, int32_t index);

// Whether this build contains the DSP for `kind` - the runtime view of
// effects.config.json. A front end asserts its own generated block list
// against this at startup, which is what stops a stale prebuilt WASM from
// silently disagreeing with the checked-in config. Returns 1 or 0; an
// out-of-range kind is 0.
int32_t openaxe_block_kind_compiled(OpenAxeBlockKind kind);

// ── Tone fingerprint (issue #288) ──────────────────────────────────────
// Probe a NAM model JSON and return its gain (dB) + brightness (0..1).
// Returns 1 on success, 0 if the JSON is not a valid NAM model or any
// required out-pointer is null. Probe runs off the audio thread and is not
// real-time safe.
int32_t openaxe_compute_fingerprint(const char* json, float* out_gain_db,
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
float openaxe_detect_pitch(const float* samples, int32_t count, double sample_rate);

// Hz → note/cents mapping so all four front ends display the same reading.
// `frequency` must be > 0. `reference_a4` is the A4 concert pitch (440).
// Returns 1 on success, 0 if frequency <= 0 or any required out pointer is
// null. `out_name` points at static storage (one of "C","C#",...,"B") and
// stays valid forever; `out_octave` is the octave number; `out_cents` is
// -50..50, 0 = dead on.
int32_t openaxe_frequency_to_note(float frequency, double reference_a4,
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

typedef enum OpenAxeMidiMessageType {
  OPENAXE_MIDI_NOTEON = 0,
  OPENAXE_MIDI_CC = 1,
  OPENAXE_MIDI_PC = 2,
} OpenAxeMidiMessageType;

typedef enum OpenAxeMidiActionKind {
  OPENAXE_MIDI_ACTION_SLOT = 0,        // slot 0-7, whatever scene is current
  OPENAXE_MIDI_ACTION_SCENE = 1,       // scene 0-63, absolute jump
  OPENAXE_MIDI_ACTION_NEXT_SCENE = 2,
  OPENAXE_MIDI_ACTION_PREV_SCENE = 3,
} OpenAxeMidiActionKind;

// How many mappings are stored.
int32_t openaxe_midi_mapping_count(OpenAxeGraph* graph);
// One mapping by index. Returns 1 on success, 0 for out-of-range. Every
// out-param is optional (pass NULL to skip).
int32_t openaxe_midi_get_mapping(OpenAxeGraph* graph, int32_t index,
                                    OpenAxeMidiMessageType* out_type,
                                    int32_t* out_channel, int32_t* out_number,
                                    OpenAxeMidiActionKind* out_kind,
                                    int32_t* out_slot, int32_t* out_scene);
// Adds a binding, deduping like the web's midiStore.completeLearn: any
// existing mapping whose action key == the new action's key, or whose match
// key == the new match's key, is removed first. Returns 1 on success, 0 for
// invalid match/action. Control-thread only.
int32_t openaxe_midi_add_mapping(OpenAxeGraph* graph,
                                    OpenAxeMidiMessageType type,
                                    int32_t channel, int32_t number,
                                    OpenAxeMidiActionKind kind,
                                    int32_t slot, int32_t scene);
// Removes the mapping at `index`; returns 1 on success, 0 for out-of-range. Control-thread only.
int32_t openaxe_midi_remove_mapping(OpenAxeGraph* graph, int32_t index);
// Removes every mapping and cancels any active learn. Control-thread only.
void openaxe_midi_clear_mappings(OpenAxeGraph* graph);

// Arms learn for `action`; returns 1 on success, 0 for invalid action. Control-thread only.
int32_t openaxe_midi_arm_learn(OpenAxeGraph* graph, OpenAxeMidiActionKind kind,
                                  int32_t slot, int32_t scene);
void openaxe_midi_cancel_learn(OpenAxeGraph* graph);
int32_t openaxe_midi_is_learning(OpenAxeGraph* graph);
// The action currently being learned, or 0 if none. Every out-param optional.
int32_t openaxe_midi_get_learn_target(OpenAxeGraph* graph,
                                         OpenAxeMidiActionKind* out_kind,
                                         int32_t* out_slot, int32_t* out_scene);

// Pure helpers, no graph — mirrors message.ts / actions.ts.
int32_t openaxe_midi_parse_message(const uint8_t* data, int32_t size,
                                      OpenAxeMidiMessageType* out_type,
                                      int32_t* out_channel, int32_t* out_number,
                                      int32_t* out_value);
int32_t openaxe_midi_is_trigger_edge(OpenAxeMidiMessageType type, int32_t value);
int32_t openaxe_midi_message_matches(OpenAxeMidiMessageType msg_type,
                                        int32_t msg_channel, int32_t msg_number,
                                        OpenAxeMidiMessageType match_type,
                                        int32_t match_channel, int32_t match_number);

// Feeds raw MIDI bytes through the mapping. `sample_offset` is the per-event
// offset within the current audio block (0 = block start). Currently
// dispatched immediately; a future build may schedule per offset without ABI
// change. Returns 0 for "no match / not trigger / not parseable", 1 for
// "dispatched a bound action", 2 for "learn completed" (the message was
// consumed to create a binding, not dispatched). When it returns 1 or 2,
// out params (all optional) echo what fired or was learned.
int32_t openaxe_midi_handle_message(OpenAxeGraph* graph,
                                       const uint8_t* data, int32_t size,
                                       int32_t sample_offset,
                                       OpenAxeMidiActionKind* out_kind,
                                       int32_t* out_slot, int32_t* out_scene,
                                       OpenAxeMidiMessageType* out_match_type,
                                       int32_t* out_match_channel,
                                       int32_t* out_match_number);

// openaxe_load_state's result.
typedef enum OpenAxeLoadStateResult {
  OPENAXE_LOAD_STATE_OK = 0,
  // Not valid JSON.
  OPENAXE_LOAD_STATE_PARSE_ERROR = 1,
  // schemaVersion newer than this build knows - never guessed at.
  OPENAXE_LOAD_STATE_UNSUPPORTED_VERSION = 2,
  // Wrong root shape / missing required fields.
  OPENAXE_LOAD_STATE_BAD_DOCUMENT = 3,
} OpenAxeLoadStateResult;

// Rebuilds the graph from a previously serialized document. Clears the
// existing topology first. Returns 0 on success, non-zero for a malformed or
// unsupported-version document (in which cases the existing graph is left
// untouched). Malformed individual entries inside an otherwise valid document
// are NOT failures: they are skipped with a warning and the rest restores -
// mirroring applyPreset's partial-failure tolerance (#64). Unknown param
// symbols and dangling edges skip the same way. Block assets (models/IRs)
// restore from their embedded payload first, then their recorded path; ones
// that resolve neither leave their block empty and are reported through
// openaxe_state_missing_asset_count / _missing_asset. Not real-time safe -
// suspend audio around it.
OpenAxeLoadStateResult openaxe_load_state(OpenAxeGraph* graph, const char* json);

#ifdef __cplusplus
}
#endif
