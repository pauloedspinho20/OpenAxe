#include "asset_loading.h"

#include <algorithm>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <sstream>

#include "openaxe/api.h"

#ifdef OPENAXE_HAS_PFD
#include "portable-file-dialogs.h"
#endif

namespace openaxe_vst3::assets {

const char* ToString(LoadResult r) {
  switch (r) {
    case LoadResult::Ok: return "OK";
    case LoadResult::FileNotFound: return "file not found";
    case LoadResult::InvalidFormat: return "invalid format";
    case LoadResult::TooLarge: return "file too large";
    case LoadResult::Cancelled: return "cancelled";
    case LoadResult::UnknownBlock: return "unknown block";
    case LoadResult::NotWav: return "not a WAV file";
  }
  return "unknown";
}

namespace {
std::mutex g_dir_mutex;
std::string g_last_nam_dir;
std::string g_last_ir_dir;

LoadResult MapNamResult(OpenAxeLoadResult core) {
  switch (core) {
    case OPENAXE_LOAD_OK: return LoadResult::Ok;
    case OPENAXE_LOAD_FILE_NOT_FOUND: return LoadResult::FileNotFound;
    case OPENAXE_LOAD_INVALID_FORMAT: return LoadResult::InvalidFormat;
    default: return LoadResult::InvalidFormat;
  }
}

bool IsWavHeader(const uint8_t* b, size_t n) {
  if (n < 12) return false;
  return std::memcmp(b, "RIFF", 4) == 0 && std::memcmp(b + 8, "WAVE", 4) == 0;
}

std::string ReadFileAsString(const std::string& path, size_t max_bytes, LoadResult* out) {
  std::error_code ec;
  const auto sz = std::filesystem::file_size(path, ec);
  if (ec) {
    if (out) *out = LoadResult::FileNotFound;
    return {};
  }
  if (sz > max_bytes) {
    if (out) *out = LoadResult::TooLarge;
    return {};
  }
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    if (out) *out = LoadResult::FileNotFound;
    return {};
  }
  std::string s;
  s.resize(static_cast<size_t>(sz));
  in.read(s.data(), static_cast<std::streamsize>(sz));
  if (!in && !in.eof()) {
    if (out) *out = LoadResult::InvalidFormat;
    return {};
  }
  if (out) *out = LoadResult::Ok;
  return s;
}

std::vector<uint8_t> ReadFileAsBytes(const std::string& path, size_t max_bytes, LoadResult* out) {
  std::error_code ec;
  const auto sz = std::filesystem::file_size(path, ec);
  if (ec) {
    if (out) *out = LoadResult::FileNotFound;
    return {};
  }
  if (sz > max_bytes) {
    if (out) *out = LoadResult::TooLarge;
    return {};
  }
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    if (out) *out = LoadResult::FileNotFound;
    return {};
  }
  std::vector<uint8_t> bytes(static_cast<size_t>(sz));
  in.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(sz));
  if (!in && !in.eof()) {
    if (out) *out = LoadResult::InvalidFormat;
    return {};
  }
  if (out) *out = LoadResult::Ok;
  return bytes;
}
}  // namespace

void SetLastNamDirectory(const std::string& dir) {
  std::lock_guard<std::mutex> l(g_dir_mutex);
  g_last_nam_dir = dir;
}
void SetLastIrDirectory(const std::string& dir) {
  std::lock_guard<std::mutex> l(g_dir_mutex);
  g_last_ir_dir = dir;
}
std::string GetLastNamDirectory() {
  std::lock_guard<std::mutex> l(g_dir_mutex);
  return g_last_nam_dir;
}
std::string GetLastIrDirectory() {
  std::lock_guard<std::mutex> l(g_dir_mutex);
  return g_last_ir_dir;
}

namespace {
bool BlockExists(OpenAxeGraph* g, int32_t id) {
  // Every current block kind has at least one param (cab=1, amp=7, mixer=8,
  // etc.), so param_count==0 is a reliable sentinel for "unknown" without
  // exposing FindBlock. Note: GetInputTrim returns 1.0 for unknown, so we
  // can't use trims as sentinel.
  return openaxe_block_param_count(g, id) != 0;
}
}  // namespace

LoadResult LoadNamModelFromJson(OpenAxeGraph* graph, int32_t block_id,
                                const std::string& json, std::string* error) {
  if (!graph || block_id < 0 || !BlockExists(graph, block_id)) {
    if (error) *error = "unknown block";
    return LoadResult::UnknownBlock;
  }
  if (json.size() > kMaxNamModelBytes) {
    if (error) *error = "loadModel: file too large (max 32 MB)";
    return LoadResult::TooLarge;
  }
  if (!openaxe_block_has_model(graph, block_id) && openaxe_block_param_count(graph, block_id) == 0) {
    // Cheap check: block kind without DSP still has param table? But for non-amp kinds the load is no-op; let core decide.
  }
  const auto r = openaxe_load_nam_model_json(graph, block_id, json.c_str());
  if (r != OPENAXE_LOAD_OK) {
    if (error) *error = std::string("loadModel: ") + ToString(MapNamResult(r));
    return MapNamResult(r);
  }
  return LoadResult::Ok;
}

LoadResult LoadNamModelFromPath(OpenAxeGraph* graph, int32_t block_id,
                                const std::string& file_path, std::string* error) {
  if (!graph || block_id < 0 || !BlockExists(graph, block_id)) {
    if (error) *error = "unknown block";
    return LoadResult::UnknownBlock;
  }
  LoadResult pre = LoadResult::Ok;
  std::string json = ReadFileAsString(file_path, kMaxNamModelBytes, &pre);
  if (pre != LoadResult::Ok) {
    if (error) {
      if (pre == LoadResult::TooLarge) *error = "loadModel: file too large (max 32 MB)";
      else if (pre == LoadResult::FileNotFound) *error = "loadModel: file not found: " + file_path;
      else *error = "loadModel: could not read file";
    }
    return pre;
  }
  // Prefer JSON entry (no temp file) — mirrors desktop's move after #47
  auto r = LoadNamModelFromJson(graph, block_id, json, error);
  if (r == LoadResult::Ok) {
    SetLastNamDirectory(std::filesystem::path(file_path).parent_path().string());
  }
  return r;
}

LoadResult LoadIrWavFromBytes(OpenAxeGraph* graph, int32_t block_id,
                              const uint8_t* wav_bytes, size_t wav_size,
                              std::string* error) {
  if (!graph || block_id < 0 || !BlockExists(graph, block_id)) {
    if (error) *error = "unknown block";
    return LoadResult::UnknownBlock;
  }
  if (wav_size > kMaxIrWavBytes) {
    if (error) *error = "loadIrWav: file too large (max 8 MB)";
    return LoadResult::TooLarge;
  }
  if (wav_size == 0 || !IsWavHeader(wav_bytes, wav_size)) {
    if (error) *error = "loadIrWav: not a WAV file";
    return LoadResult::NotWav;
  }
  const int32_t n = openaxe_load_ir_wav(graph, block_id, wav_bytes, static_cast<int32_t>(wav_size));
  if (n == 0) {
    if (error) *error = "loadIrWav: the core could not decode this file";
    return LoadResult::InvalidFormat;
  }
  return LoadResult::Ok;
}

LoadResult LoadIrWavFromPath(OpenAxeGraph* graph, int32_t block_id,
                             const std::string& file_path, std::string* error) {
  if (!graph || block_id < 0 || !BlockExists(graph, block_id)) {
    if (error) *error = "unknown block";
    return LoadResult::UnknownBlock;
  }
  LoadResult pre = LoadResult::Ok;
  auto bytes = ReadFileAsBytes(file_path, kMaxIrWavBytes, &pre);
  if (pre != LoadResult::Ok) {
    if (error) {
      if (pre == LoadResult::TooLarge) *error = "loadIrWav: file too large (max 8 MB)";
      else if (pre == LoadResult::FileNotFound) *error = "loadIrWav: file not found: " + file_path;
      else *error = "loadIrWav: could not read file";
    }
    return pre;
  }
  auto r = LoadIrWavFromBytes(graph, block_id, bytes.data(), bytes.size(), error);
  if (r == LoadResult::Ok) SetLastIrDirectory(std::filesystem::path(file_path).parent_path().string());
  return r;
}

std::optional<ModelInfo> GetModelInfo(OpenAxeGraph* graph, int32_t block_id) {
  if (!graph || block_id < 0) return std::nullopt;
  if (!openaxe_block_has_model(graph, block_id)) return std::nullopt;
  ModelInfo mi;
  mi.has_model = true;
  double sr = -1;
  int32_t has_l = 0, has_in = 0, has_out = 0, is_slim = 0, bp_count = 0;
  double loud = 0, in_dbu = 0, out_dbu = 0;
  if (!openaxe_block_model_info(graph, block_id, &sr, &has_l, &loud, &has_in, &in_dbu, &has_out, &out_dbu, &is_slim, &bp_count)) {
    return std::nullopt;
  }
  mi.sample_rate = sr;
  mi.has_loudness = has_l != 0;
  mi.loudness_db = loud;
  mi.has_input_level = has_in != 0;
  mi.input_level_dbu = in_dbu;
  mi.has_output_level = has_out != 0;
  mi.output_level_dbu = out_dbu;
  mi.is_slimmable = is_slim != 0;
  mi.slim_breakpoint_count = bp_count;
  if (bp_count > 0) {
    mi.slim_breakpoints.resize(static_cast<size_t>(bp_count));
    const int got = openaxe_block_model_slim_breakpoints(graph, block_id, mi.slim_breakpoints.data(), bp_count);
    mi.slim_breakpoints.resize(static_cast<size_t>(got));
  }
  return mi;
}

std::optional<int> GetIrLength(OpenAxeGraph* graph, int32_t block_id) {
  if (!graph || block_id < 0) return std::nullopt;
  const int n = openaxe_block_ir_length(graph, block_id);
  if (n < 0) return std::nullopt;
  return n;
}

std::optional<std::string> PickNamFile() {
#ifdef OPENAXE_HAS_PFD
  const std::string dir = GetLastNamDirectory();
  pfd::open_file dlg("Load NAM model", dir, {"NAM model", "*.nam"});
  auto res = dlg.result();
  if (res.empty()) return std::nullopt;
  SetLastNamDirectory(std::filesystem::path(res.front()).parent_path().string());
  return res.front();
#else
  return std::nullopt;
#endif
}

std::optional<std::string> PickIrWavFile() {
#ifdef OPENAXE_HAS_PFD
  const std::string dir = GetLastIrDirectory();
  pfd::open_file dlg("Load IR WAV", dir, {"WAV", "*.wav *.WAV"});
  auto res = dlg.result();
  if (res.empty()) return std::nullopt;
  SetLastIrDirectory(std::filesystem::path(res.front()).parent_path().string());
  return res.front();
#else
  return std::nullopt;
#endif
}


std::vector<uint8_t> DecodeBase64(const std::string& in) {
  static constexpr signed char kInvalid = -1;
  auto value = [](unsigned char c) -> signed char {
    if (c >= 'A' && c <= 'Z') return static_cast<signed char>(c - 'A');
    if (c >= 'a' && c <= 'z') return static_cast<signed char>(c - 'a' + 26);
    if (c >= '0' && c <= '9') return static_cast<signed char>(c - '0' + 52);
    if (c == '+') return 62;
    if (c == '/') return 63;
    return kInvalid;
  };
  std::vector<uint8_t> out;
  out.reserve(in.size() / 4 * 3);
  uint32_t buf = 0;
  int bits = 0;
  for (unsigned char c : in) {
    if (c == '=') break;
    if (c == '\n' || c == '\r' || c == ' ' || c == '\t') continue;
    const signed char v = value(c);
    if (v == kInvalid) return {};
    buf = (buf << 6) | static_cast<uint32_t>(v);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push_back(static_cast<uint8_t>((buf >> bits) & 0xFFu));
    }
  }
  return out;
}

}  // namespace openaxe_vst3::assets
