#pragma once

#include <atomic>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

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

// True when a request's Host header names our own loopback listener. Anything
// else is refused: without this check any web page the user visits can have
// their browser fetch http://127.0.0.1:<port>/… and read whatever we serve
// (DNS rebinding). Accepts 127.0.0.1/localhost/[::1] with our exact port, and
// tolerates a missing Host only for HTTP/1.0-style clients, which browsers are
// not (issue #300 G3).
bool IsAllowedHost(const std::string& request_head, unsigned short port);

// Cache-Control value for a served path (issue #300 G5). Vite emits hashed
// asset names (index-<hash>.js), so those are immutable and can be cached hard;
// index.html must not be, or a rebuilt UI would never be picked up.
std::string CacheControlFor(const std::string& path);

// True when the request asks to keep the connection open. HTTP/1.1 defaults to
// keep-alive unless "Connection: close"; HTTP/1.0 is the reverse.
bool WantsKeepAlive(const std::string& request_head);

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

  // Ports tried, in order, before falling back to an ephemeral one. A stable
  // port means a stable webview origin, which stops every launch creating a
  // fresh per-origin WebKit data directory — this machine had accumulated 15
  // of them under com.openaxe.desktop and 20 under com.cockos.reaper before
  // the shared on-disk store made the contents irrelevant (issue #300).
  // Deliberately outside the ephemeral range so the OS does not hand one of
  // these to some other process as a client port.
  static constexpr unsigned short kPreferredPorts[] = {47821, 47822, 47823, 47824, 47825,
                                                       47826, 47827, 47828, 47829, 47830};

 private:
  void ServeLoop(const std::string& root);
  // Connections are handled on worker threads, not inline in the accept loop.
  // Serial handling was tolerable only because every response closed the
  // connection; with keep-alive a single held connection would starve every
  // other one, and a browser opens several at once for a JS bundle
  // (issue #300 G5).
  void WorkerLoop(const std::string& root);
  // True when a connection is waiting for a worker. A keep-alive connection
  // gives up its worker rather than idling while someone else queues.
  bool HasQueuedConnections();

  // Comfortably above a browser's per-origin connection limit (6 in Chrome and
  // Safari). A keep-alive connection occupies a worker while it waits for the
  // next request, so with 4 workers a single browser could park all of them and
  // the next connection would wait out an idle timeout before being served.
  static constexpr int kWorkerCount = 8;
  std::vector<std::thread> workers_;
  std::deque<int> pending_;
  std::mutex queue_mutex_;
  std::condition_variable queue_cv_;

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
  // Our bound port, so each request's Host header can be checked against it.
  unsigned short port_ = 0;
  std::thread thread_;
  std::atomic<bool> running_{false};
  std::string inject_head_script_;
};

// One UI server per process, shared by every plugin instance in it.
//
// Each instance used to start its own: a project with eight instances of the
// plugin meant eight listening sockets and, since the worker pool landed,
// eight times kWorkerCount threads — all serving byte-identical files out of
// the same bundle. They also each took a different port, so each got its own
// webview origin.
//
// Acquire() starts the server on first use and hands back the port; every
// later caller gets the same one. Release() shuts it down when the last
// instance goes away. Root and polyfill come from the first caller — every
// instance in a process is the same build serving the same directory, so
// there is nothing to disagree about.
class SharedUiServer {
 public:
  // Returns the bound port, or 0 if the server could not start. Pair every
  // non-zero return with exactly one Release().
  static unsigned short Acquire(const std::string& root, const std::string& inject_head_script);
  static void Release();
};

}  // namespace openaxe_vst3
