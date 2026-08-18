#include "nam_studio/api.h"

#include "nam_studio/engine.h"

namespace {

// Explicit switches (not ordinal-identity casts) so nam_studio::graph's own
// enums stay free to reorder/extend independently of this public C surface.
nam_studio::graph::BlockKind ToBlockKind(NamStudioBlockKind kind) {
  using nam_studio::graph::BlockKind;
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
  }
  return BlockKind::kCab;  // unreachable for a valid enum value
}

nam_studio::engine::ReverbAlgorithm ToReverbAlgorithm(NamStudioReverbAlgorithm algorithm) {
  using nam_studio::engine::ReverbAlgorithm;
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

NamStudioLoadResult ToLoadResult(std::optional<nam_studio::dsp::NamLoadError> error) {
  if (!error) return NAM_STUDIO_LOAD_OK;
  switch (*error) {
    case nam_studio::dsp::NamLoadError::kFileNotFound:
      return NAM_STUDIO_LOAD_FILE_NOT_FOUND;
    case nam_studio::dsp::NamLoadError::kInvalidFormat:
      return NAM_STUDIO_LOAD_INVALID_FORMAT;
  }
  return NAM_STUDIO_LOAD_INVALID_FORMAT;  // unreachable for a valid enum value
}

}  // namespace

struct NamStudioGraph {
  nam_studio::engine::AudioEngine engine;
};

extern "C" {

NamStudioGraph* nam_studio_graph_create(void) { return new NamStudioGraph(); }

void nam_studio_graph_destroy(NamStudioGraph* graph) { delete graph; }

int32_t nam_studio_add_block(NamStudioGraph* graph, NamStudioBlockKind kind, int32_t row, int32_t col) {
  return graph->engine.AddBlock(ToBlockKind(kind), row, col);
}

void nam_studio_remove_block(NamStudioGraph* graph, int32_t block_id) {
  graph->engine.RemoveBlock(block_id);
}

void nam_studio_move_block(NamStudioGraph* graph, int32_t block_id, int32_t row, int32_t col) {
  graph->engine.MoveBlock(block_id, row, col);
}

int32_t nam_studio_connect(NamStudioGraph* graph, int32_t from_block, int32_t from_port,
                            int32_t to_block, int32_t to_port) {
  const auto outcome = graph->engine.Connect(from_block, from_port, to_block, to_port);
  return outcome.ok ? outcome.id : -1;
}

void nam_studio_disconnect(NamStudioGraph* graph, int32_t edge_id) { graph->engine.Disconnect(edge_id); }

void nam_studio_reset(NamStudioGraph* graph, double sample_rate, int32_t max_block_size) {
  graph->engine.Reset(sample_rate, max_block_size);
}

void nam_studio_process(NamStudioGraph* graph, const float* const* input, int32_t input_channels,
                         float* const* output, int32_t output_channels, int32_t num_frames) {
  graph->engine.Process(input, input_channels, output, output_channels, num_frames);
}

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

float nam_studio_get_param(NamStudioGraph* graph, int32_t block_id, int32_t index) {
  return graph->engine.GetParam(block_id, index);
}

void nam_studio_set_param(NamStudioGraph* graph, int32_t block_id, int32_t index, float value) {
  graph->engine.SetParam(block_id, index, value);
}

NamStudioLoadResult nam_studio_load_nam_model(NamStudioGraph* graph, int32_t block_id,
                                               const char* file_path) {
  return ToLoadResult(graph->engine.LoadNamModel(block_id, file_path));
}

void nam_studio_unload_nam_model(NamStudioGraph* graph, int32_t block_id) {
  graph->engine.UnloadNamModel(block_id);
}

int32_t nam_studio_block_has_model(NamStudioGraph* graph, int32_t block_id) {
  return graph->engine.BlockHasModel(block_id) ? 1 : 0;
}

void nam_studio_set_reverb_algorithm(NamStudioGraph* graph, int32_t block_id,
                                      NamStudioReverbAlgorithm algorithm) {
  graph->engine.SetReverbAlgorithm(block_id, ToReverbAlgorithm(algorithm));
}

void nam_studio_set_delay_model(NamStudioGraph* graph, int32_t block_id,
                                 NamStudioDelayModel model) {
  using nam_studio::dsp::Delay;
  Delay::Model m = Delay::Model::kDigital;
  switch (model) {
    case NAM_STUDIO_DELAY_DIGITAL: m = Delay::Model::kDigital; break;
    case NAM_STUDIO_DELAY_ANALOG:  m = Delay::Model::kAnalog; break;
    case NAM_STUDIO_DELAY_TAPE:    m = Delay::Model::kTape; break;
  }
  graph->engine.SetDelayModel(block_id, m);
}

void nam_studio_set_bypass(NamStudioGraph* graph, int32_t block_id, int32_t bypassed) {
  graph->engine.SetBypass(block_id, bypassed != 0);
}

int32_t nam_studio_is_bypassed(NamStudioGraph* graph, int32_t block_id) {
  return graph->engine.IsBypassed(block_id) ? 1 : 0;
}

void nam_studio_set_master_level(NamStudioGraph* graph, float level) {
  graph->engine.SetMasterLevel(level);
}

float nam_studio_get_master_level(NamStudioGraph* graph) { return graph->engine.GetMasterLevel(); }

void nam_studio_set_master_muted(NamStudioGraph* graph, int32_t muted) {
  graph->engine.SetMasterMuted(muted != 0);
}

int32_t nam_studio_is_master_muted(NamStudioGraph* graph) {
  return graph->engine.IsMasterMuted() ? 1 : 0;
}

void nam_studio_set_tuner_muted(NamStudioGraph* graph, int32_t muted) {
  graph->engine.SetTunerMuted(muted != 0);
}

int32_t nam_studio_is_tuner_muted(NamStudioGraph* graph) {
  return graph->engine.IsTunerMuted() ? 1 : 0;
}

float nam_studio_get_meter(NamStudioGraph* graph, int32_t block_id) {
  return graph->engine.GetMeter(block_id);
}

float nam_studio_get_cpu_load(NamStudioGraph* graph) { return graph->engine.GetCpuLoad(); }

}  // extern "C"
