#include "editor.h"

#include <algorithm>
#include <cctype>
#include <cstring>
#include <string>

#include "openaxe/api.h"

namespace openaxe_vst3::editor {

bool IsTrustedUiUrl(const std::string& url) {
  std::string lower;
  lower.reserve(url.size());
  for (char c : url) lower.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
  const size_t scheme_end = lower.find("://");
  if (scheme_end == std::string::npos) return false;
  const std::string scheme = lower.substr(0, scheme_end);
  if (scheme != "http" && scheme != "https") return false;
  std::string host = lower.substr(scheme_end + 3);
  const size_t slash = host.find('/');
  if (slash != std::string::npos) host = host.substr(0, slash);
  // Reject userinfo (user:pass@host) — a loopback host hidden behind
  // credentials (http://evil.com@127.0.0.1) must not be trusted.
  if (host.find('@') != std::string::npos) return false;
  const size_t colon = host.rfind(':');
  if (colon != std::string::npos) host = host.substr(0, colon);
  return host == "127.0.0.1" || host == "localhost" || host == "[::1]" || host == "::1";
}

std::string ResolveUiUrl(const char* env_url, const std::string& bundled_index_path) {
  if (env_url && *env_url && IsTrustedUiUrl(env_url)) return std::string(env_url);
  if (!bundled_index_path.empty()) return std::string("file://") + bundled_index_path;
  return {};
}

EditorSize ClampSize(int w, int h) {
  EditorSize s;
  s.width = std::clamp(w, kMinWidth, kMaxWidth);
  s.height = std::clamp(h, kMinHeight, kMaxHeight);
  return s;
}
EditorSize DefaultSize() { return EditorSize{kDefaultWidth, kDefaultHeight}; }

Theme ThemeFromString(const std::string& s) {
  std::string lower;
  lower.reserve(s.size());
  for (char c : s) lower.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
  if (lower == "light" || lower == "aluminum" || lower == "aluminium") return Theme::Light;
  return Theme::Dark;
}
std::string ThemeToString(Theme t) { return t == Theme::Light ? "light" : "dark"; }
Theme DefaultTheme() { return Theme::Dark; }

EditorSize SizeFromStateJson(const std::string& json) {
  EditorSize def = DefaultSize();
  // Minimal JSON parsing without nlohmann/json (keeps this TU SDK-free).
  // Looks for "editorWidth" and "editorHeight" integers at top level.
  auto findInt = [&](const char* key) -> int {
    const std::string k = std::string("\"") + key + "\"";
    const size_t pos = json.find(k);
    if (pos == std::string::npos) return -1;
    const size_t colon = json.find(':', pos + k.size());
    if (colon == std::string::npos) return -1;
    size_t i = colon + 1;
    while (i < json.size() && std::isspace(static_cast<unsigned char>(json[i]))) ++i;
    const size_t start = i;
    if (i < json.size() && (json[i] == '-' || std::isdigit(static_cast<unsigned char>(json[i])))) ++i;
    while (i < json.size() && std::isdigit(static_cast<unsigned char>(json[i]))) ++i;
    if (i == start) return -1;
    try { return std::stoi(json.substr(start, i - start)); } catch (...) { return -1; }
  };
  const int w = findInt("editorWidth");
  const int h = findInt("editorHeight");
  if (w > 0 && h > 0) return ClampSize(w, h);
  return def;
}

std::string SizeToStateJson(EditorSize sz, const std::string& base_json) {
  // Inject or replace editorWidth/editorHeight at top level. If base_json is
  // empty or not an object, produce a minimal object.
  const EditorSize clamped = ClampSize(sz.width, sz.height);
  if (base_json.empty() || base_json.find('{') == std::string::npos) {
    return "{\"editorWidth\":" + std::to_string(clamped.width) + ",\"editorHeight\":" + std::to_string(clamped.height) + "}";
  }
  // If keys already exist, replace them; else insert before the final }.
  std::string out = base_json;
  auto replaceOrInsert = [&](const char* key, int value) {
    const std::string k = std::string("\"") + key + "\"";
    const size_t pos = out.find(k);
    if (pos != std::string::npos) {
      const size_t colon = out.find(':', pos + k.size());
      if (colon == std::string::npos) return;
      size_t i = colon + 1;
      while (i < out.size() && std::isspace(static_cast<unsigned char>(out[i]))) ++i;
      const size_t start = i;
      if (i < out.size() && (out[i] == '-' || std::isdigit(static_cast<unsigned char>(out[i])))) ++i;
      while (i < out.size() && std::isdigit(static_cast<unsigned char>(out[i]))) ++i;
      out.replace(start, i - start, std::to_string(value));
    } else {
      // Insert before final }
      const size_t end = out.rfind('}');
      if (end == std::string::npos) return;
      const bool needs_comma = out.find(':') != std::string::npos && out.substr(0, end).find_first_not_of(" \t\n\r{") != std::string::npos;
      const std::string ins = (needs_comma ? "," : "") + std::string("\"") + key + "\":" + std::to_string(value);
      out.insert(end, ins);
    }
  };
  replaceOrInsert("editorWidth", clamped.width);
  replaceOrInsert("editorHeight", clamped.height);
  return out;
}

float GetMeter(NamStudioGraph* graph, int32_t block_id) {
  if (!graph || block_id < 0) return 0.0f;
  return nam_studio_get_meter(graph, block_id);
}
float GetCpuLoad(NamStudioGraph* graph) {
  if (!graph) return 0.0f;
  return nam_studio_get_cpu_load(graph);
}

const char* BundledFontName() { return "JetBrainsMono-Regular.ttf"; }
const char* BundledFontLicenseName() { return "JetBrainsMono-OFL.txt"; }

// ── Editor shim ────────────────────────────────────────────────────────
struct Editor::Impl {
  NamStudioGraph* graph = nullptr;
  EditorSize size = DefaultSize();
  Theme theme = DefaultTheme();
  bool open = false;
  void* parent = nullptr;
};

Editor::Editor(NamStudioGraph* graph) : impl_(new Impl()) { impl_->graph = graph; }
Editor::~Editor() { delete impl_; }

void Editor::Open(void* parent_window_handle) {
  // Real webview wiring under OPENAXE_HAS_WEBVIEW would:
  //  - create webview with parent_window_handle,
  //  - bind window.openAxe.* handlers (bridge),
  //  - start 60fps timer polling GetMeter/GetCpuLoad,
  //  - navigate to ResolveUiUrl(OPENAXE_UI_URL, bundled_path).
  // For now we just mark open — audio thread never touched.
  impl_->parent = parent_window_handle;
  impl_->open = true;
}
void Editor::Close() {
  impl_->open = false;
  impl_->parent = nullptr;
}
bool Editor::IsOpen() const { return impl_->open; }
EditorSize Editor::GetSize() const { return impl_->size; }
void Editor::SetSize(int w, int h) { impl_->size = ClampSize(w, h); }
Theme Editor::GetTheme() const { return impl_->theme; }
void Editor::SetTheme(Theme t) { impl_->theme = t; }

}  // namespace openaxe_vst3::editor
