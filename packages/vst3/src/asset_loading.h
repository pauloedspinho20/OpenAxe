#pragma once

// Asset loading for the plugin — issue #129.
// Native dialogs for .nam / .wav, control-thread with suspend, in-memory
// preferred forms, size/type guards (#69), model-info surfacing, readable
// errors and last-dir memory.
//
// This header is SDK-free (no iPlug dep) so CTests can exercise the guards
// and core interactions offline. The `Pick*` helpers optionally pull in
// `portable-file-dialogs` when `OPENAXE_HAS_PFD` is set (plugin CMake does),
// but tests that don't have the dep simply don't call them.

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

struct NamStudioGraph;

namespace openaxe_vst3::assets {

// Mirror core's hard ceilings (#69) so every front end inherits the same check
// before bytes reach the DSP core.
inline constexpr size_t kMaxNamModelBytes = 32u * 1024u * 1024u;
inline constexpr size_t kMaxIrWavBytes = 8u * 1024u * 1024u;

enum class LoadResult {
  Ok = 0,
  FileNotFound,
  InvalidFormat,
  TooLarge,
  Cancelled,
  UnknownBlock,
  NotWav,
};

// Human-readable string for a LoadResult (for UI toast / test diagnostics).
const char* ToString(LoadResult r);

// Decodes standard base64 (no URL-safe alphabet, tolerates whitespace and
// stops at padding). Returns {} on any invalid character rather than silently
// truncating — a half-decoded WAV would reach the core as garbage.
//
// Lives here rather than in the bridge because the bridge pulls in plugin.h
// (and therefore the iPlug SDK), which CTest cannot link; cab IRs arrive from
// the UI as base64 (see openaxe.ts's loadIrWav), so this is asset-loading
// concern anyway.
std::vector<uint8_t> DecodeBase64(const std::string& in);

// ── File-backed loads (preferred: read file, then call in-memory core entry) ──
// All three are Tier 2 (not real-time safe) — caller must hold the suspend
// handshake (Plugin::WithSuspend) around them. They return the mapped
// LoadResult and optionally fill *error with a readable message.

LoadResult LoadNamModelFromPath(NamStudioGraph* graph, int32_t block_id,
                                const std::string& file_path, std::string* error = nullptr);

LoadResult LoadIrWavFromPath(NamStudioGraph* graph, int32_t block_id,
                             const std::string& file_path, std::string* error = nullptr);

// ── In-memory loads (what the webview bridge and state restore use) ──
// `json` is the .nam file's JSON text; `wav_bytes` are the raw WAV file bytes.
// Same guards, same Tier-2 contract, but no filesystem.

LoadResult LoadNamModelFromJson(NamStudioGraph* graph, int32_t block_id,
                                const std::string& json, std::string* error = nullptr);

LoadResult LoadIrWavFromBytes(NamStudioGraph* graph, int32_t block_id,
                              const uint8_t* wav_bytes, size_t wav_size,
                              std::string* error = nullptr);

// ── Model info surfaced to the editor (so users can trade fidelity for CPU) ──
struct ModelInfo {
  bool has_model = false;
  double sample_rate = -1;  // -1 when unknown
  bool has_loudness = false;
  double loudness_db = 0;
  bool has_input_level = false;
  double input_level_dbu = 0;
  bool has_output_level = false;
  double output_level_dbu = 0;
  bool is_slimmable = false;
  int slim_breakpoint_count = 0;
  std::vector<double> slim_breakpoints;
  std::string name;  // display name from last load, if any
};

std::optional<ModelInfo> GetModelInfo(NamStudioGraph* graph, int32_t block_id);
std::optional<int> GetIrLength(NamStudioGraph* graph, int32_t block_id);

// ── Last-used directory memory (per asset type) ──
void SetLastNamDirectory(const std::string& dir);
void SetLastIrDirectory(const std::string& dir);
std::string GetLastNamDirectory();
std::string GetLastIrDirectory();

// ── Native dialogs (optional dep: portable-file-dialogs) ──
// Returns empty optional on cancel. When pfd is unavailable (offline tests)
// they return nullopt and the caller can inject a path directly via the
// *FromPath helpers above. Remembering last dir is done here.
std::optional<std::string> PickNamFile();
std::optional<std::string> PickIrWavFile();

}  // namespace openaxe_vst3::assets
