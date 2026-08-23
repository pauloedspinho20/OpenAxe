#include "latency.h"

#include <vector>

#include "openaxe/api.h"

namespace openaxe_desktop {

int MeasureDspLatencyFrames(double sample_rate, int block_size, int impulse_pos) {
  (void)sample_rate;
  NamStudioGraph* graph = nam_studio_graph_create();
  const int32_t mixer = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_MIXER, 0, 0);
  nam_studio_connect(graph, NAM_STUDIO_IN_RAIL, 0, mixer, 0);
  nam_studio_connect(graph, mixer, 0, NAM_STUDIO_OUT_RAIL, 0);
  nam_studio_reset(graph, sample_rate, block_size);

  std::vector<float> in0(block_size, 0.0f), in1(block_size, 0.0f);
  std::vector<float> out0(block_size, 0.0f), out1(block_size, 0.0f);
  in0[impulse_pos] = 1.0f;
  in1[impulse_pos] = 1.0f;

  const float* in[2] = {in0.data(), in1.data()};
  float* out[2] = {out0.data(), out1.data()};
  nam_studio_process(graph, in, 2, out, 2, block_size);
  nam_studio_graph_destroy(graph);

  int peak = 0;
  float peak_value = -1.0f;
  for (int i = 0; i < block_size; ++i) {
    if (out0[static_cast<size_t>(i)] > peak_value) {
      peak_value = out0[static_cast<size_t>(i)];
      peak = i;
    }
  }
  return peak - impulse_pos;
}

double LatencyMs(int frames, double sample_rate) {
  return sample_rate > 0.0 ? static_cast<double>(frames) / sample_rate * 1000.0 : -1.0;
}

}  // namespace openaxe_desktop