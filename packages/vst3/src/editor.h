#pragma once

// Webview editor shell for the plugin — issue #132.
// Hosts the shared React app (apps/web SPA, same as apps/desktop via
// webview.h) instead of an IGraphics/IControl fork. The bridge is a thin
// openaxe ABI translation layer (like desktop's bridge.cpp) — audio / state
// via packages/core, never reimplemented here.
//
// This header is SDK-free (no iPlug/webview dep) so CTests can exercise the
// shell's contract offline: URL trust, size clamping/persistence, theme,
// and the 60fps poll that must never block the audio thread.
//
// When OPENAXE_HAS_WEBVIEW is defined (plugin CMake fetches webview/webview
// 0.12), editor.cpp's Editor class wires up the real webview window and
// window.openAxe* bindings. Otherwise it compiles as a stub that still
// exposes the pure-logic helpers below.

#include <cstdint>
#include <string>

// Plain macros, no SDK dependency — keeps this header usable from the
// SDK-free CTests while making config.h the single source of truth for the
// editor's size (see the constants below).
#include "config.h"

struct OpenAxeGraph;

namespace openaxe_vst3::editor {

// ── Constants ──────────────────────────────────────────────────────────
// Derived from config.h rather than restated, so the host and IGraphics can
// never disagree about the editor's size. They did: config.h declared
// PLUG_WIDTH x PLUG_HEIGHT to the host while these constants independently said
// 800x600, and once mMakeGraphicsFunc started honouring the persisted size
// (issue #300 B4) the context was created at a size the host had not been told
// about. ClampSize's bounds have to match PLUG_MIN/MAX_* for the same reason —
// otherwise a restored size is clamped to something outside the range the host
// negotiated.
//
inline constexpr int kDefaultWidth = PLUG_WIDTH;
inline constexpr int kDefaultHeight = PLUG_HEIGHT;
inline constexpr int kMinWidth = PLUG_MIN_WIDTH;
inline constexpr int kMinHeight = PLUG_MIN_HEIGHT;
inline constexpr int kMaxWidth = PLUG_MAX_WIDTH;
inline constexpr int kMaxHeight = PLUG_MAX_HEIGHT;
inline constexpr int kFps = PLUG_FPS;

// ── URL trust (issue #71, same as apps/desktop/src/bridge.cpp) ───────
// Only loopback http(s) origins are allowed for OPENAXE_UI_URL. Anything
// else is refused and the editor falls back to the bundled UI.
bool IsTrustedUiUrl(const std::string& url);

// Resolve the URL the editor should navigate to:
//  - if OPENAXE_UI_URL is set and trusted, return it (dev server)
//  - else if bundledIndexPath exists (e.g. <bundle>/Resources/ui/index.html),
//    return file:// or http://127.0.0.1 handling is done by the caller
//  - else return empty (placeholder)
std::string ResolveUiUrl(const char* env_url, const std::string& bundled_index_path);

// ── Size ───────────────────────────────────────────────────────────────
struct EditorSize {
  int width = kDefaultWidth;
  int height = kDefaultHeight;
  bool operator==(const EditorSize& o) const { return width == o.width && height == o.height; }
};

EditorSize ClampSize(int width, int height);
EditorSize DefaultSize();

// Persisted in plugin state JSON alongside the rig (so hosts that save the
// chunk also save the window size). Stored as {"editorWidth": 800, "editorHeight": 600}
// at the top level of the document — ignored when absent (defaults).
EditorSize SizeFromStateJson(const std::string& json);
std::string SizeToStateJson(EditorSize sz, const std::string& base_json);

// ── Theme (light/dark via React, same token palettes as web/desktop) ──
enum class Theme { Dark, Light };
Theme ThemeFromString(const std::string& s);
std::string ThemeToString(Theme t);
Theme DefaultTheme();

// ── Polling (60fps, never blocks audio thread) ────────────────────────
// openaxe_get_meter / openaxe_get_cpu_load are cheap reads — no
// allocation, no lock. The editor polls them on a timer; audio thread never
// waits for the UI.
float GetMeter(OpenAxeGraph* graph, int32_t block_id);
float GetCpuLoad(OpenAxeGraph* graph);

// ── Font resource ──────────────────────────────────────────────────────
// Monospace display font used by the web UI (JetBrains Mono / SF Mono
// fallback). Bundled as a plugin resource with license.
const char* BundledFontName();
const char* BundledFontLicenseName();

// ── Editor lifetime (stub when webview unavailable) ────────────────────
// Real webview wiring lives in editor.cpp under OPENAXE_HAS_WEBVIEW.
// For offline builds and CTests we expose a lightweight shim so the plugin
// can construct/destroy the editor without pulling in the webview headers.
class Editor {
 public:
  explicit Editor(OpenAxeGraph* graph);
  ~Editor();

  Editor(const Editor&) = delete;
  Editor& operator=(const Editor&) = delete;

  // Host calls these when it opens/closes the editor window. They must NOT
  // disturb audio: no graph reset, no suspend, no allocation on the audio
  // thread. The graph pointer is borrowed (owned by the plugin).
  void Open(void* parent_window_handle);
  void Close();
  bool IsOpen() const;

  // Size persistence — caller (plugin_state) stores/loads this via
  // SizeToStateJson / SizeFromStateJson.
  EditorSize GetSize() const;
  void SetSize(int width, int height);

  // Theme — caller may persist via preferences; defaults to Dark (Carbon).
  Theme GetTheme() const;
  void SetTheme(Theme t);

 private:
  struct Impl;
  Impl* impl_ = nullptr;
};

}  // namespace openaxe_vst3::editor
