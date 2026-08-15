#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Opaque handle wrapping a nam_studio::engine::AudioEngine (topology +
// live DSP + real-time processing). This is the public C ABI every platform
// target (#15 desktop, #16 VST3, #17 mobile, #22 web/WASM) links against.
typedef struct NamStudioGraph NamStudioGraph;

// Never returns NULL.
NamStudioGraph* nam_studio_graph_create(void);
// NULL is a no-op.
void nam_studio_graph_destroy(NamStudioGraph* graph);

// Mirrors nam_studio::graph::BlockKind (block.h) 1:1 - kept as its own C
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

// nam_studio_load_nam_model's result - mirrors nam_studio::dsp::NamLoadError.
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

// ── Params (generic across every block kind; lock-free) ────────────────

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
// forwards to NamAmp::SetSlimSize - not real-time safe, matching that
// method's own documented contract (NAMCore may reallocate).
void nam_studio_set_param(NamStudioGraph* graph, int32_t block_id, int32_t index, float value);

// ── NAM model management (off the audio thread) ────────────────────────

NamStudioLoadResult nam_studio_load_nam_model(NamStudioGraph* graph, int32_t block_id,
                                               const char* file_path);
void nam_studio_unload_nam_model(NamStudioGraph* graph, int32_t block_id);
// Returns 0/1; 0 for an unknown or non-Amp-family block.
int32_t nam_studio_block_has_model(NamStudioGraph* graph, int32_t block_id);

// ── Reverb algorithm choice ─────────────────────────────────────────────

// No-op if block_id is unknown or not a NAM_STUDIO_BLOCK_REVERB block. Not
// real-time safe - reconstructs the underlying wrapper instance.
void nam_studio_set_reverb_algorithm(NamStudioGraph* graph, int32_t block_id,
                                      NamStudioReverbAlgorithm algorithm);

// ── Metering ────────────────────────────────────────────────────────────

// Peak |sample| over the last nam_studio_process call, 0 for an unknown block.
float nam_studio_get_meter(NamStudioGraph* graph, int32_t block_id);
// Fraction of real-time budget the last nam_studio_process call used.
float nam_studio_get_cpu_load(NamStudioGraph* graph);

#ifdef __cplusplus
}
#endif
