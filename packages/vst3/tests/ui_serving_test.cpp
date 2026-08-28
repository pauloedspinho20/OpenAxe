// Regression tests for how the plugin serves and wires up the React UI
// (issue #300 sections A, F and G).
//
// These cover the parts that are pure logic and therefore testable without a
// host, a webview or a live socket:
//   - the bridge polyfill's message-channel contract (A2/A3),
//   - HTML head injection ordering (A1),
//   - HTTP path containment (G2),
//   - bundle-relative UI root resolution (F1).

#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <vector>

#include "http_server.h"
#include "openaxe/ui_url.h"
#include "ui_root.h"
#include "bridge_polyfill.h"

namespace fs = std::filesystem;

namespace {

// setenv/unsetenv are POSIX; MSVC has _putenv_s instead (an empty value
// removes the variable there).
void SetEnv(const char* name, const char* value) {
#ifdef _WIN32
  _putenv_s(name, value);
#else
  setenv(name, value, 1);
#endif
}
void UnsetEnv(const char* name) {
#ifdef _WIN32
  _putenv_s(name, "");
#else
  unsetenv(name);
#endif
}

// Thin adapter so the containment assertions below read as paths.
bool Under(const fs::path& full, const fs::path& root) {
  return openaxe_vst3::IsPathUnderRoot(full.string(), root.string());
}

int failures = 0;

void Check(bool cond, const char* what) {
  if (!cond) {
    std::fprintf(stderr, "FAIL: %s\n", what);
    ++failures;
  }
}

// ── A2/A3: the polyfill's message channel ────────────────────────────
void TestPolyfillContract() {
  const std::string js = openaxe_vst3::BridgePolyfillJs();

  // A2: must go through iPlug2's own IPlugSendMsg, and must NOT name the
  // handler "IPlugWebView" — iPlug2 registers it as "callback", so that name
  // threw TypeError on every single call.
  Check(js.find("IPlugSendMsg") != std::string::npos, "polyfill uses IPlugSendMsg");
  Check(js.find("messageHandlers.IPlugWebView") == std::string::npos,
        "polyfill does not post to the nonexistent IPlugWebView handler");

  // A3: the payload must be an object literal, not a JSON string. The macOS
  // handler runs message.body through +dataWithJSONObject:, which rejects a
  // non-container top level and yields OnMessageFromWebView(nullptr).
  Check(js.find("post({method:") != std::string::npos,
        "polyfill posts an object, not a stringified payload");
  Check(js.find("JSON.stringify({method") == std::string::npos,
        "polyfill does not stringify the outgoing payload");

  // The resolver the C++ side calls back into must exist, and the shell probe
  // the React app uses (window['openAxe.version']) must be bound.
  Check(js.find("IPlugWebViewResolve") != std::string::npos, "polyfill defines the resolver");
  Check(js.find("\"version\"") != std::string::npos, "polyfill binds openAxe.version");
  Check(js.find("__openAxePolyfilled") != std::string::npos, "polyfill is idempotent");
}

// ── A1: injection must land before the SPA's module scripts ──────────
void TestHeadInjection() {
  const std::string vite_html =
      "<!doctype html><html><head><meta charset=\"utf-8\">"
      "<script type=\"module\" crossorigin src=\"/assets/index-abc.js\"></script>"
      "</head><body><div id=\"root\"></div></body></html>";

  const std::string out = openaxe_vst3::InjectHeadScript(vite_html, "window.__probe=1;");
  const size_t injected = out.find("window.__probe=1;");
  const size_t module_script = out.find("type=\"module\"");
  Check(injected != std::string::npos, "script is injected");
  // This ordering assertion is the whole point of A1: useAudioEngine.ts
  // decides web-vs-native at module scope, so the polyfill has to be ahead of
  // the module script in document order.
  Check(injected > module_script, "injected script sits after the module tag but inside <head>");
  Check(out.find("</head>") > injected, "injected script is still inside head");

  // Uppercase tags (some templates) and missing </head> must both work.
  const std::string upper = openaxe_vst3::InjectHeadScript("<HTML><HEAD></HEAD><BODY></BODY></HTML>", "x=1;");
  Check(upper.find("x=1;") != std::string::npos, "uppercase </HEAD> handled");
  const std::string no_close = openaxe_vst3::InjectHeadScript("<html><head><body>hi</body></html>", "y=1;");
  Check(no_close.find("y=1;") != std::string::npos, "missing </head> still injects");
  const std::string no_head = openaxe_vst3::InjectHeadScript("<div>bare fragment</div>", "z=1;");
  Check(no_head.starts_with("<script>z=1;</script>"), "headless document prepends");
}

// ── G2: path containment ─────────────────────────────────────────────
void TestPathContainment() {
  const fs::path root = "/srv/openaxe/dist";
  Check(Under("/srv/openaxe/dist/index.html", root), "file directly under root is allowed");
  Check(Under("/srv/openaxe/dist/assets/app.js", root), "nested file is allowed");

  // The bug this replaced: a bare starts_with() admitted any sibling whose
  // name merely extended the root.
  Check(!Under("/srv/openaxe/dist-private/secret.env", root),
        "sibling directory sharing the root prefix is rejected");
  Check(!Under("/srv/openaxe/other/x", root), "unrelated sibling is rejected");
  Check(!Under("/etc/passwd", root), "absolute escape is rejected");
  Check(!Under(fs::path("/srv/openaxe/dist/../secret").lexically_normal(), root),
        "traversal out of root is rejected");
}

// ── F1: bundle-relative UI root ──────────────────────────────────────
// Assertions match on the tail of each candidate rather than the whole
// absolute path: UiRootCandidates canonicalises the binary path (so a host
// that dlopens the plugin through a symlink still resolves), and on macOS that
// rewrites /home to /System/Volumes/Data/home via a firmlink. The property
// that matters is the layout *relative* to the binary.
void TestUiRootCandidates() {
  auto has_suffix = [](const std::vector<std::string>& v, std::string_view suffix) {
    for (const auto& c : v) {
      if (std::string_view(c).ends_with(suffix)) return true;
    }
    return false;
  };

  // macOS plugin bundle: Contents/MacOS/<bin> -> Contents/Resources/ui
  const auto mac = openaxe_vst3::UiRootCandidates(
      "/Library/Audio/Plug-Ins/VST3/OpenAxe.vst3/Contents/MacOS/OpenAxe");
  Check(has_suffix(mac, "OpenAxe.vst3/Contents/Resources/ui"),
        "macOS bundle resolves Contents/Resources/ui");

  // Linux VST3: Contents/x86_64-linux/<bin> -> Contents/Resources/ui.
  // The arch subdirectory means the walk-up must climb more than one level.
  const auto lin = openaxe_vst3::UiRootCandidates(
      "/usr/lib/vst3/OpenAxe.vst3/Contents/x86_64-linux/OpenAxe.so");
  Check(has_suffix(lin, "OpenAxe.vst3/Contents/Resources/ui"),
        "Linux bundle resolves Contents/Resources/ui from the arch subdir");

  // Windows VST3 uses the same Contents layout with a different arch dir.
  const auto win = openaxe_vst3::UiRootCandidates(
      "/c/Program Files/Common Files/VST3/OpenAxe.vst3/Contents/x86_64-win/OpenAxe.vst3");
  Check(has_suffix(win, "OpenAxe.vst3/Contents/Resources/ui"),
        "Windows bundle layout resolves Contents/Resources/ui");

  // Bare module (a .clap sitting in a plain directory): sibling ui/, plus the
  // shared support directory. The CLAP target builds as a bare Mach-O/so file,
  // not a directory bundle, so there is no Contents/Resources inside it — an
  // installed .clap found no UI at all and opened an empty editor.
  const auto bare = openaxe_vst3::UiRootCandidates("/home/u/.clap/OpenAxe.clap");
  Check(has_suffix(bare, "/.clap/ui"), "bare module offers a sibling ui/ directory");
  Check(has_suffix(bare, "OpenAxe/ui"), "bare module falls back to the shared support dir");

  // Ordering matters: a real bundle's own Resources/ui must win over the
  // shared directory, or a stale shared copy would shadow the shipped one.
  const auto ordered = openaxe_vst3::UiRootCandidates(
      "/Library/Audio/Plug-Ins/VST3/OpenAxe.vst3/Contents/MacOS/OpenAxe");
  int bundle_at = -1, shared_at = -1;
  for (size_t i = 0; i < ordered.size(); ++i) {
    if (std::string_view(ordered[i]).ends_with("OpenAxe.vst3/Contents/Resources/ui")) {
      if (bundle_at < 0) bundle_at = static_cast<int>(i);
    }
    if (ordered[i].find("Application Support") != std::string::npos ||
        ordered[i].find("/usr/share/OpenAxe") != std::string::npos) {
      if (shared_at < 0) shared_at = static_cast<int>(i);
    }
  }
  Check(bundle_at >= 0, "bundle candidate present");
  Check(shared_at < 0 || bundle_at < shared_at, "bundle Resources/ui precedes the shared dir");

  Check(openaxe_vst3::UiRootCandidates("").empty(), "empty binary path yields no candidates");

  // No candidate may be derived from the build machine's source tree — that
  // was the __FILE__ bug (F1): it worked in-tree and shipped broken.
  for (const auto& c : mac) {
    Check(c.find("/apps/web/dist") == std::string::npos,
          "no candidate points at the source checkout");
  }
}

// ── J1: the one UI-URL trust check ───────────────────────────────────
// This existed in four places (desktop bridge, vst3 editor, an inline lambda in
// plugin.cpp, and a header decl) and the copies had already drifted: desktop
// stripped userinfo and would have trusted "http://evil.example@127.0.0.1/",
// while the vst3 copy rejected any '@'. Now one implementation, pinned here.
void TestTrustedUiUrl() {
  using openaxe::IsTrustedUiUrl;

  // The origins we actually serve the bridge from.
  Check(IsTrustedUiUrl("http://127.0.0.1:5173"), "loopback ipv4 with port");
  Check(IsTrustedUiUrl("http://127.0.0.1/"), "loopback ipv4 without port");
  Check(IsTrustedUiUrl("https://localhost:3000"), "localhost over https");
  Check(IsTrustedUiUrl("http://[::1]:5173"), "ipv6 literal with port");
  Check(IsTrustedUiUrl("HTTP://LocalHost:5173"), "scheme and host are case-insensitive");

  // Anything that is not our own loopback origin.
  Check(!IsTrustedUiUrl("https://evil.example"), "remote host refused");
  Check(!IsTrustedUiUrl("http://192.168.1.10:5173"), "LAN address refused");
  Check(!IsTrustedUiUrl("file:///etc/passwd"), "file scheme refused");
  Check(!IsTrustedUiUrl("javascript:alert(1)"), "javascript scheme refused");
  Check(!IsTrustedUiUrl(""), "empty string refused");
  Check(!IsTrustedUiUrl("127.0.0.1:5173"), "scheme is required");

  // The case the two copies disagreed on. Userinfo is refused outright: a URL
  // shaped to make a reader misjudge the host has no business reaching a
  // bridge that can touch the filesystem and the keychain.
  Check(!IsTrustedUiUrl("http://evil.example@127.0.0.1/"), "userinfo before a loopback host refused");
  Check(!IsTrustedUiUrl("http://127.0.0.1@evil.example/"), "loopback as userinfo refused");
}

// ── G3: Host header validation (DNS rebinding) ───────────────────────
void TestHostValidation() {
  using openaxe_vst3::IsAllowedHost;
  const unsigned short kPort = 51234;
  auto req = [](const char* host) {
    return std::string("GET /index.html HTTP/1.1\r\nHost: ") + host + "\r\n\r\n";
  };

  Check(IsAllowedHost(req("127.0.0.1:51234"), kPort), "our own loopback host is allowed");
  Check(IsAllowedHost(req("localhost:51234"), kPort), "localhost with our port is allowed");
  Check(IsAllowedHost(req("[::1]:51234"), kPort), "ipv6 loopback with our port is allowed");
  Check(IsAllowedHost("GET / HTTP/1.1\r\nhOsT: 127.0.0.1:51234\r\n\r\n", kPort),
        "header name match is case-insensitive");

  // The attack this exists for: a page on some site resolves its own hostname
  // to 127.0.0.1 and fetches our port. The browser sends that site's Host.
  Check(!IsAllowedHost(req("evil.example.com"), kPort), "foreign host is refused");
  Check(!IsAllowedHost(req("evil.example.com:51234"), kPort),
        "foreign host with our port is refused");
  // A different port means it is not our listener.
  Check(!IsAllowedHost(req("127.0.0.1:9999"), kPort), "wrong port is refused");
  Check(!IsAllowedHost(req("127.0.0.1"), kPort), "portless host is refused");

  // HTTP/1.0 clients may omit Host entirely; browsers never do.
  Check(IsAllowedHost("GET / HTTP/1.0\r\n\r\n", kPort), "absent Host is tolerated");
}

// ── G1: Stop() must not hang while the serve thread sits in accept() ──
void TestServerShutdown() {
  const fs::path tmp = fs::temp_directory_path() / "openaxe_http_stop_test";
  fs::remove_all(tmp);
  fs::create_directories(tmp);
  std::ofstream(tmp / "index.html") << "<html><head></head><body>x</body></html>";

  // Start and stop repeatedly with no client ever connecting, so the serve
  // thread is parked waiting for a connection every time. This is the state in
  // which POSIX does not guarantee that closing the listening socket from
  // another thread returns from accept(); the self-pipe in Stop() removes the
  // dependency on that being true.
  //
  // Measured on macOS 14 (Darwin 23), close() DOES interrupt the blocked
  // accept(), so this test also passes with the self-pipe disabled — it is a
  // guard against regressions in shutdown, not a reproduction of a hang we
  // observed. Keep it: the ordering it pins (wake, join, then close) is what
  // makes the behaviour portable, and Stop() runs on the host's main thread
  // from ~OpenAxePlugin, where a hang would freeze the DAW.
  for (int i = 0; i < 20; ++i) {
    openaxe_vst3::HttpServer server;
    unsigned short port = 0;
    if (!server.Start(tmp.string(), port, "window.__t=1;")) {
      Check(false, "server starts on an ephemeral loopback port");
      break;
    }
    Check(port != 0, "server reports the bound port");
    server.Stop();
  }

  // Stop() must also be safe to call twice, and safe on a never-started
  // server: ~OpenAxePlugin calls it after an explicit Stop().
  {
    openaxe_vst3::HttpServer server;
    unsigned short port = 0;
    Check(server.Start(tmp.string(), port), "start without an injected script");
    server.Stop();
    server.Stop();
  }
  {
    openaxe_vst3::HttpServer never_started;
    never_started.Stop();
  }
  Check(true, "repeated Stop() and Stop() on an unstarted server both return");

  fs::remove_all(tmp);
}

// FindBundledUiRoot honours the dev override, and only when index.html is
// really there.
void TestUiRootOverride() {
  const fs::path tmp = fs::temp_directory_path() / "openaxe_ui_root_test";
  fs::remove_all(tmp);
  fs::create_directories(tmp);

  SetEnv("OPENAXE_UI_DIR", tmp.string().c_str());
  Check(openaxe_vst3::FindBundledUiRoot() != tmp.string(),
        "override without index.html is not accepted");

  std::ofstream(tmp / "index.html") << "<html></html>";
  Check(openaxe_vst3::FindBundledUiRoot() == tmp.lexically_normal().string(),
        "override with index.html wins");

  UnsetEnv("OPENAXE_UI_DIR");
  fs::remove_all(tmp);
}

}  // namespace

int main() {
  TestPolyfillContract();
  TestHeadInjection();
  TestPathContainment();
  TestUiRootCandidates();
  TestUiRootOverride();
  TestTrustedUiUrl();
  TestHostValidation();
  TestServerShutdown();
  if (failures == 0) std::printf("ui_serving_test: all checks passed\n");
  return failures == 0 ? 0 : 1;
}
