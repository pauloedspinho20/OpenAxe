#pragma once

#include <atomic>
#include <string>
#include <thread>

namespace openaxe_desktop {

// Fixed port registered with Tone3000 as the desktop app's OAuth
// redirect_uri (http://127.0.0.1:54010/callback - see
// apps/web/src/tone3000/config.ts's DESKTOP_OAUTH_REDIRECT_PORT, which MUST
// be kept equal to this). Deliberately not the UI server's own ephemeral
// port - see HttpServer::StartOAuthRedirect below for why a fixed port is
// needed at all. Changing this value requires re-registering the new URI
// with Tone3000 and updating config.ts to match.
constexpr unsigned short kOAuthRedirectPort = 54010;

// A minimal local HTTP server that serves a static directory (the bundled
// React UI) over 127.0.0.1 on an OS-assigned port. The webview navigates to
// it instead of a file:// URL because WKWebView sandboxes file:// subresources
// (webview 0.12 navigates via loadRequest, which never grants read access to
// referenced local files). Serves only GET, Connection: close, single file at
// a time - plenty for a bundled SPA, and never exposed beyond loopback.
class HttpServer {
 public:
  HttpServer() = default;
  ~HttpServer();
  HttpServer(const HttpServer&) = delete;
  HttpServer& operator=(const HttpServer&) = delete;

  // Serve `root` on 127.0.0.1:0 (ephemeral port). Returns true and sets
  // out_port on success. Stop() joins the serve thread.
  bool Start(const std::string& root, unsigned short& out_port);

  // Ports tried, in order, before falling back to an ephemeral one. A stable
  // port keeps the webview's origin stable across launches, so the app stops
  // leaving a fresh per-origin WebKit data directory behind every time it
  // starts (issue #300). Mirrors the plugin's list in
  // packages/vst3/src/http_server.h.
  static constexpr unsigned short kPreferredPorts[] = {47821, 47822, 47823, 47824, 47825,
                                                       47826, 47827, 47828, 47829, 47830};

  // Binds a FIXED port instead of an ephemeral one - the only job of this
  // mode is bouncing a Tone3000 OAuth redirect back to wherever the bundled
  // UI's own (ephemeral, unregisterable) port actually ended up this launch.
  // Responds to any GET with a 302 to http://127.0.0.1:<*target_ui_port>/
  // plus the incoming request's query string. `target_ui_port` is read
  // fresh per request (so it's fine to call this before the UI server has
  // picked its port) and must outlive this instance. Returns false if the
  // port is already taken (e.g. by Vite's dev server) - Tone3000 login just
  // won't complete in that case, everything else keeps working.
  bool StartOAuthRedirect(unsigned short port, const unsigned short* target_ui_port);

  void Stop();

 private:
  void ServeLoop(const std::string& root);
  void OAuthRedirectLoop();

  int listen_fd_ = -1;
  // Our bound port, so each request's Host header can be checked against it
  // (issue #415). Set by Start before the serve thread begins.
  unsigned short port_ = 0;
  std::thread thread_;
  std::atomic<bool> running_{false};
  const unsigned short* oauth_target_port_ = nullptr;
};

}  // namespace openaxe_desktop