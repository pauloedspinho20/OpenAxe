#include "plugin_state.h"

#include <cstdio>
#include <fstream>
#include <vector>

#include "openaxe/api.h"

namespace openaxe_vst3::state {

std::string Serialize(NamStudioGraph* graph, bool embed_assets) {
  if (!graph) return {};
  const int32_t needed = nam_studio_serialize_state_ex(graph, embed_assets ? 1 : 0, nullptr, 0);
  if (needed <= 0) return {};
  std::vector<char> buf(static_cast<size_t>(needed));
  const int32_t written =
      nam_studio_serialize_state_ex(graph, embed_assets ? 1 : 0, buf.data(), needed);
  if (written != needed) return {};
  // buf is NUL-terminated; strip the terminator for std::string (hosts that
  // use PutStr will encode the length anyway).
  return std::string(buf.data());
}

int Restore(NamStudioGraph* graph, const std::string& json, double sample_rate,
            int max_block_size) {
  if (!graph) return NAM_STUDIO_LOAD_STATE_BAD_DOCUMENT;
  const auto result = nam_studio_load_state(graph, json.c_str());
  if (result == NAM_STUDIO_LOAD_STATE_OK) {
    // Single reset after the topology has been rebuilt — not one per block
    // (#62). The caller already holds the suspend handshake, so this is safe.
    if (max_block_size <= 0) max_block_size = 512;
    if (sample_rate <= 0) sample_rate = 48000.0;
    nam_studio_reset(graph, sample_rate, max_block_size);
  }
  return static_cast<int>(result);
}

std::vector<std::string> MissingAssets(NamStudioGraph* graph) {
  std::vector<std::string> out;
  if (!graph) return out;
  const int32_t n = nam_studio_state_missing_asset_count(graph);
  out.reserve(static_cast<size_t>(n));
  for (int32_t i = 0; i < n; ++i) {
    const char* s = nam_studio_state_missing_asset(graph, i);
    out.emplace_back(s ? s : "");
  }
  return out;
}

bool SavePortableJson(NamStudioGraph* graph, const std::string& path) {
  const std::string doc = Serialize(graph, true);
  if (doc.empty()) return false;
  std::ofstream out(path, std::ios::binary);
  if (!out) return false;
  out.write(doc.data(), static_cast<std::streamsize>(doc.size()));
  return out.good();
}

int LoadPortableJson(NamStudioGraph* graph, const std::string& path, double sample_rate,
                     int max_block_size) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return NAM_STUDIO_LOAD_STATE_PARSE_ERROR;
  std::string doc((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
  if (doc.empty()) return NAM_STUDIO_LOAD_STATE_BAD_DOCUMENT;
  return Restore(graph, doc, sample_rate, max_block_size);
}

}  // namespace openaxe_vst3::state
