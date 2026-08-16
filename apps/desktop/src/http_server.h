#pragma once

#include <atomic>
#include <string>
#include <thread>

namespace nam_desktop {

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
  void Stop();

 private:
  void ServeLoop(const std::string& root);

  int listen_fd_ = -1;
  std::thread thread_;
  std::atomic<bool> running_{false};
};

}  // namespace nam_desktop