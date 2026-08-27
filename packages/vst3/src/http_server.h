#pragma once

#include <atomic>
#include <string>
#include <thread>

namespace openaxe_vst3 {

// ── Request/response helpers, exposed for tests ────────────────────────
// These are pure string/path logic, so CTest can pin their behaviour without
// opening a socket (see tests/ui_serving_test.cpp).

// Splices `script` into `html` as an inline <script> just before </head> (or
// after <head...> when there is no close tag, or at the start as a last
// resort). Vite emits <script type="module"> in <head>; that module is
// deferred and ours is not, so being inside <head> is enough to run first.
std::string InjectHeadScript(const std::string& html, const std::string& script);

// True when `full` is genuinely inside `root`. A bare prefix compare has no
// separator check, so root "…/dist" would also admit "…/dist-private/secret"
// (issue #300 G2).
bool IsPathUnderRoot(const std::string& full, const std::string& root);

// Minimal loopback HTTP server for the VST webview — mirrors
// apps/desktop/src/http_server.h but in the plugin's namespace so the VST
// can serve its bundled React UI without pulling in the desktop target.
// WKWebView sandboxes file:// subresources, so we serve over
// http://127.0.0.1:<ephemeral>/index.html instead (same reason as desktop).

class HttpServer {
 public:
  HttpServer() = default;
  ~HttpServer();
  HttpServer(const HttpServer&) = delete;
  HttpServer& operator=(const HttpServer&) = delete;

  // `inject_head_script` (optional) is spliced into index.html as an inline
  // <script> immediately before </head>, so it runs BEFORE the SPA's own
  // module scripts. That ordering is the whole point (issue #300 A1): the
  // React app decides web-vs-native once, at module load
  // (apps/web/src/hooks/useAudioEngine.ts), so window.openAxe must already
  // exist by then. Injecting from the webview's OnWebContentLoaded fires too
  // late and the app silently takes the Web Audio path — which is what
  // triggered the host's microphone permission prompt.
  bool Start(const std::string& root, unsigned short& out_port,
             std::string inject_head_script = {});
  void Stop();

 private:
  void ServeLoop(const std::string& root);
  int listen_fd_ = -1;
  // Self-pipe write/read ends used to wake a blocked accept() on Stop()
  // (issue #300 G1). POSIX does not guarantee that closing a listening socket
  // returns from an accept() already in progress on another thread. In
  // practice macOS 14 does interrupt it — measured, see
  // tests/ui_serving_test.cpp — so this is hardening against a platform we
  // have not tested rather than a fix for an observed hang. It is worth having
  // because Stop() runs from ~OpenAxePlugin, on the host's main thread: a hang
  // there freezes the DAW on plugin delete or project close.
  int wake_fds_[2] = {-1, -1};
  std::thread thread_;
  std::atomic<bool> running_{false};
  std::string inject_head_script_;
};

}  // namespace openaxe_vst3
