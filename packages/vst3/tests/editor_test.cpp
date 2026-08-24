// CTest for the webview editor shell — issue #132.
// Covers URL trust, size clamping/persistence, theme, open/close not
// disturbing audio, and cheap meter/cpu polling.

#include <cstdio>
#include <string>
#include <vector>

#include "../src/editor.h"
#include "openaxe/api.h"

static int g_failures = 0;
#define CHECK(cond) do { if(!(cond)){ std::fprintf(stderr,"CHECK failed: %s (%s:%d)\n",#cond,__FILE__,__LINE__); ++g_failures; } } while(0)

namespace {

void TestIsTrustedUiUrl() {
  using openaxe_vst3::editor::IsTrustedUiUrl;
  CHECK(IsTrustedUiUrl("http://127.0.0.1:5173"));
  CHECK(IsTrustedUiUrl("http://127.0.0.1:5173/index.html"));
  CHECK(IsTrustedUiUrl("http://localhost:5173"));
  CHECK(IsTrustedUiUrl("https://localhost:5173/foo?bar=1"));
  CHECK(IsTrustedUiUrl("http://[::1]:5173"));
  CHECK(!IsTrustedUiUrl("http://192.168.1.10:5173"));
  CHECK(!IsTrustedUiUrl("http://evil.com"));
  CHECK(!IsTrustedUiUrl("file:///tmp/index.html"));
  CHECK(!IsTrustedUiUrl("https://127.0.0.1.evil.com"));
  CHECK(!IsTrustedUiUrl(""));
  CHECK(!IsTrustedUiUrl("http://example.com@127.0.0.1"));
  std::printf("  IsTrustedUiUrl: ok\n");
}

void TestResolveUiUrl() {
  using openaxe_vst3::editor::ResolveUiUrl;
  CHECK(ResolveUiUrl("http://127.0.0.1:5173", "/tmp/ui/index.html") == "http://127.0.0.1:5173");
  CHECK(ResolveUiUrl("http://evil.com", "/tmp/ui/index.html") == "file:///tmp/ui/index.html");
  CHECK(ResolveUiUrl(nullptr, "/tmp/ui/index.html") == "file:///tmp/ui/index.html");
  CHECK(ResolveUiUrl("", "") == "");
  CHECK(ResolveUiUrl("http://localhost:3000", "") == "http://localhost:3000");
  std::printf("  ResolveUiUrl: ok\n");
}

void TestClampSize() {
  using openaxe_vst3::editor::ClampSize;
  using openaxe_vst3::editor::kMinWidth;
  using openaxe_vst3::editor::kMaxWidth;
  using openaxe_vst3::editor::kMinHeight;
  using openaxe_vst3::editor::kMaxHeight;
  auto s = ClampSize(800, 600);
  CHECK(s.width == 800 && s.height == 600);
  s = ClampSize(100, 100);
  CHECK(s.width == kMinWidth && s.height == kMinHeight);
  s = ClampSize(5000, 5000);
  CHECK(s.width == kMaxWidth && s.height == kMaxHeight);
  s = ClampSize(640, 480);
  CHECK(s.width == 640 && s.height == 480);
  std::printf("  ClampSize: ok\n");
}

void TestSizePersistence() {
  using openaxe_vst3::editor::EditorSize;
  using openaxe_vst3::editor::SizeFromStateJson;
  using openaxe_vst3::editor::SizeToStateJson;
  using openaxe_vst3::editor::DefaultSize;

  // Round-trip with base rig JSON
  const std::string base = "{\"schemaVersion\":1,\"blocks\":[]}";
  EditorSize sz{1024, 768};
  std::string with = SizeToStateJson(sz, base);
  CHECK(with.find("\"editorWidth\":1024") != std::string::npos);
  CHECK(with.find("\"editorHeight\":768") != std::string::npos);
  EditorSize back = SizeFromStateJson(with);
  CHECK(back.width == 1024 && back.height == 768);

  // Missing keys -> defaults
  EditorSize def = DefaultSize();
  EditorSize missing = SizeFromStateJson(base);
  CHECK(missing == def);

  // Clamping on restore
  std::string big = "{\"editorWidth\":9999,\"editorHeight\":9999}";
  EditorSize clamped = SizeFromStateJson(big);
  CHECK(clamped.width == openaxe_vst3::editor::kMaxWidth);
  CHECK(clamped.height == openaxe_vst3::editor::kMaxHeight);

  // Replace existing keys
  std::string existing = "{\"editorWidth\":800,\"editorHeight\":600,\"blocks\":[]}";
  std::string replaced = SizeToStateJson(EditorSize{900, 700}, existing);
  CHECK(replaced.find("\"editorWidth\":900") != std::string::npos);
  CHECK(replaced.find("\"editorHeight\":700") != std::string::npos);
  std::printf("  Size persistence: ok\n");
}

void TestTheme() {
  using openaxe_vst3::editor::Theme;
  using openaxe_vst3::editor::ThemeFromString;
  using openaxe_vst3::editor::ThemeToString;
  CHECK(ThemeFromString("dark") == Theme::Dark);
  CHECK(ThemeFromString("Dark") == Theme::Dark);
  CHECK(ThemeFromString("light") == Theme::Light);
  CHECK(ThemeFromString("Light") == Theme::Light);
  CHECK(ThemeFromString("aluminum") == Theme::Light);
  CHECK(ThemeFromString("unknown") == Theme::Dark);
  CHECK(ThemeToString(Theme::Dark) == "dark");
  CHECK(ThemeToString(Theme::Light) == "light");
  std::printf("  Theme: ok\n");
}

void TestOpenCloseDoesNotDisturbAudio() {
  NamStudioGraph* g = nam_studio_graph_create();
  const int32_t gate = nam_studio_add_block(g, NAM_STUDIO_BLOCK_NOISE_GATE, 0, 0);
  nam_studio_connect(g, NAM_STUDIO_IN_RAIL, 0, gate, 0);
  nam_studio_connect(g, gate, 0, NAM_STUDIO_OUT_RAIL, 0);
  nam_studio_reset(g, 48000.0, 128);

  openaxe_vst3::editor::Editor ed(g);
  CHECK(!ed.IsOpen());
  // Open/close must not allocate or disturb the graph — just UI state.
  ed.Open(nullptr);
  CHECK(ed.IsOpen());
  ed.Close();
  CHECK(!ed.IsOpen());
  ed.Open((void*)0x1234);
  ed.Close();
  CHECK(!ed.IsOpen());

  // Audio still processes fine after open/close
  float in[64], outL[64], outR[64];
  for (int i = 0; i < 64; ++i) in[i] = 0.1f;
  const float* ins[2] = {in, in};
  float* outs[2] = {outL, outR};
  nam_studio_process(g, ins, 2, outs, 2, 64);
  for (int i = 0; i < 64; ++i) {
    CHECK(outL[i] == outL[i]); // not NaN
    CHECK(outR[i] == outR[i]);
  }
  std::printf("  Open/close not disturbing audio: ok\n");
  nam_studio_graph_destroy(g);
}

void TestPollingCheap() {
  NamStudioGraph* g = nam_studio_graph_create();
  const int32_t mix = nam_studio_add_block(g, NAM_STUDIO_BLOCK_MIXER, 0, 0);
  nam_studio_connect(g, NAM_STUDIO_IN_RAIL, 0, mix, 0);
  nam_studio_connect(g, mix, 0, NAM_STUDIO_OUT_RAIL, 0);
  nam_studio_reset(g, 48000.0, 128);
  // Poll many times — must stay finite and not allocate (the editor's 60fps timer)
  for (int i = 0; i < 1000; ++i) {
    const float m = openaxe_vst3::editor::GetMeter(g, mix);
    const float cpu = openaxe_vst3::editor::GetCpuLoad(g);
    CHECK(m == m);
    CHECK(cpu == cpu);
    CHECK(m >= 0.0f && m <= 10.0f);
    CHECK(cpu >= 0.0f && cpu <= 100.0f);
  }
  CHECK(openaxe_vst3::editor::BundledFontName() != nullptr);
  CHECK(openaxe_vst3::editor::BundledFontLicenseName() != nullptr);
  std::printf("  Polling cheap (meter/cpu): ok\n");
  nam_studio_graph_destroy(g);
}

} // namespace

int main() {
  TestIsTrustedUiUrl();
  TestResolveUiUrl();
  TestClampSize();
  TestSizePersistence();
  TestTheme();
  TestOpenCloseDoesNotDisturbAudio();
  TestPollingCheap();
  if (g_failures > 0) {
    std::fprintf(stderr, "%d failure(s)\n", g_failures);
    return 1;
  }
  std::printf("editor_test: all checks passed\n");
  return 0;
}
