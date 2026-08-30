#include "http_server.h"

#include "openaxe/app_storage.h"
#include "openaxe/storage_bridge.h"

#include <array>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <functional>
#include <string>
#include <utility>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
typedef int socklen_t;
#else
#include <arpa/inet.h>
#include <cerrno>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>
#endif

namespace openaxe_vst3 {

std::string InjectHeadScript(const std::string& html, const std::string& script) {
  const std::string tag = "<script>" + script + "</script>";
  // Case-insensitive search for the head tags.
  std::string lower;
  lower.reserve(html.size());
  for (char c : html) lower.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
  size_t pos = lower.find("</head>");
  if (pos != std::string::npos) return html.substr(0, pos) + tag + html.substr(pos);
  pos = lower.find("<head");
  if (pos != std::string::npos) {
    const size_t close = html.find('>', pos);
    if (close != std::string::npos) {
      return html.substr(0, close + 1) + tag + html.substr(close + 1);
    }
  }
  return tag + html;
}

bool IsAllowedHost(const std::string& request_head, unsigned short port) {
  // Case-insensitive scan of the header block for "Host:".
  std::string lower;
  lower.reserve(request_head.size());
  for (char c : request_head) lower.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
  size_t pos = lower.find("\r\nhost:");
  size_t skip = 7;  // strlen("\r\nhost:")
  if (pos == std::string::npos) {
    pos = lower.find("\nhost:");
    skip = 6;
    if (pos == std::string::npos) return true;  // no Host header at all (HTTP/1.0)
  }
  size_t start = pos + skip;
  while (start < lower.size() && (lower[start] == ' ' || lower[start] == '\t')) ++start;
  size_t end = lower.find_first_of("\r\n", start);
  if (end == std::string::npos) end = lower.size();
  const std::string host = lower.substr(start, end - start);

  const std::string p = ":" + std::to_string(port);
  for (const char* h : {"127.0.0.1", "localhost", "[::1]"}) {
    if (host == std::string(h) + p) return true;
  }
  return false;
}

std::string CacheControlFor(const std::string& path) {
  // Vite fingerprints assets (index-B6MdcQhV.js), so their contents can never
  // change under a given name — cache them hard. index.html is the opposite:
  // it names the current hashes, so caching it would pin the browser to a
  // stale build after every rebuild.
  const std::string ext = std::filesystem::path(path).extension().string();
  if (ext == ".html" || ext.empty()) return "no-cache";
  const std::string stem = std::filesystem::path(path).stem().string();
  // "name-<hash>" where the hash is Vite's 8+ char base64url. Anything without
  // that shape gets a short TTL rather than immutable.
  const size_t dash = stem.rfind('-');
  if (dash != std::string::npos && stem.size() - dash - 1 >= 8) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=300";
}

bool WantsKeepAlive(const std::string& request_head) {
  std::string lower;
  lower.reserve(request_head.size());
  for (char c : request_head) lower.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
  const bool http11 = lower.find("http/1.1") != std::string::npos;
  const size_t conn = lower.find("connection:");
  if (conn != std::string::npos) {
    const size_t eol = lower.find_first_of("\r\n", conn);
    const std::string value = lower.substr(conn, eol == std::string::npos ? std::string::npos : eol - conn);
    if (value.find("close") != std::string::npos) return false;
    if (value.find("keep-alive") != std::string::npos) return true;
  }
  return http11;  // HTTP/1.1 keeps alive by default, 1.0 does not
}

bool IsPathUnderRoot(const std::string& full, const std::string& root) {
  const auto rel = std::filesystem::path(full).lexically_relative(std::filesystem::path(root));
  if (rel.empty()) return false;
  const std::string s = rel.generic_string();
  if (s == "..") return false;
  return !s.starts_with("../");
}

namespace {

constexpr size_t kMaxRequest = 8192;

#ifdef _WIN32
int CloseSocket(int fd) { return closesocket(fd); }
#else
int CloseSocket(int fd) { return close(fd); }
#endif

void SetContentType(const std::string& path, std::string& out) {
  const std::string ext = std::filesystem::path(path).extension().string();
  if (ext == ".html") out = "text/html; charset=utf-8";
  else if (ext == ".js" || ext == ".mjs") out = "application/javascript; charset=utf-8";
  else if (ext == ".css") out = "text/css; charset=utf-8";
  else if (ext == ".wasm") out = "application/wasm";
  else if (ext == ".json") out = "application/json; charset=utf-8";
  else if (ext == ".png") out = "image/png";
  else if (ext == ".svg") out = "image/svg+xml";
  else if (ext == ".woff2") out = "font/woff2";
  else if (ext == ".woff") out = "font/woff";
  else if (ext == ".ttf") out = "font/ttf";
  else out = "application/octet-stream";
}

bool SendAll(int fd, const char* data, size_t len) {
  size_t sent = 0;
  while (sent < len) {
#ifdef _WIN32
    const int n = send(fd, data + sent, static_cast<int>(len - sent), 0);
#else
    const ssize_t n = ::send(fd, data + sent, len - sent, 0);
#endif
    if (n <= 0) return false;
    sent += static_cast<size_t>(n);
  }
  return true;
}

bool SendHeader(int fd, int status, const char* reason, size_t content_length,
                const std::string& content_type, const std::string& cache_control = {},
                bool keep_alive = false) {
  std::string head = "HTTP/1.1 " + std::to_string(status) + " " + reason +
                     "\r\nContent-Type: " + content_type +
                     "\r\nContent-Length: " + std::to_string(content_length);
  if (!cache_control.empty()) head += "\r\nCache-Control: " + cache_control;
  head += keep_alive ? "\r\nConnection: keep-alive" : "\r\nConnection: close";
  head += "\r\n\r\n";
  return SendAll(fd, head.data(), head.size());
}

// Reads a full HTTP request head. A single recv() can return a partial request
// line when it straddles TCP segments — likely with the several parallel
// connections a browser opens for a JS bundle — which used to parse as a
// truncated target and 404 (issue #300 G4).
bool RecvRequestHead(int fd, std::string& out) {
  std::array<char, 2048> buf;
  out.clear();
  while (out.size() < kMaxRequest) {
#ifdef _WIN32
    const int n = recv(fd, buf.data(), static_cast<int>(buf.size()), 0);
#else
    const ssize_t n = recv(fd, buf.data(), buf.size(), 0);
#endif
    if (n <= 0) return !out.empty();
    out.append(buf.data(), static_cast<size_t>(n));
    if (out.find("\r\n\r\n") != std::string::npos) return true;
    // Tolerate bare-LF clients (curl -0, hand-typed requests).
    if (out.find("\n\n") != std::string::npos) return true;
  }
  return true;
}

// Serves one request. Returns true when the connection should stay open for
// another (issue #300 G5).
// Percent-decoding for the asset key in a /__asset/<key> path. Keys are
// Tone3000 ids and similar, so this only has to undo what encodeURIComponent
// did on the way out.
std::string UrlDecode(const std::string& in) {
  const auto hex = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  };
  std::string out;
  out.reserve(in.size());
  for (size_t i = 0; i < in.size(); ++i) {
    if (in[i] == '%' && i + 2 < in.size()) {
      const int hi = hex(in[i + 1]), lo = hex(in[i + 2]);
      if (hi >= 0 && lo >= 0) { out.push_back(static_cast<char>(hi * 16 + lo)); i += 2; continue; }
    }
    out.push_back(in[i]);
  }
  return out;
}

// Sends one asset blob. The record file carries the key on its first line, so
// the payload starts at the offset app_storage reports — sending from byte 0
// would prefix every capture the UI loads with its own key.
bool ServeAsset(int fd, const std::string& key, bool keep_alive) {
  const std::string path = openaxe::app_storage::PathFor(openaxe::storage_bridge::kAssetStore, key);
  const auto offset = openaxe::app_storage::ValueOffsetInFile(
      openaxe::storage_bridge::kAssetStore, key);
  if (path.empty() || !offset) {
    SendHeader(fd, 404, "Not Found", 0, "text/plain", {}, keep_alive);
    return keep_alive;
  }
  std::error_code ec;
  const auto file_size = std::filesystem::file_size(path, ec);
  if (ec || file_size < *offset) {
    SendHeader(fd, 404, "Not Found", 0, "text/plain", {}, keep_alive);
    return keep_alive;
  }
  std::ifstream ifs(path, std::ios::binary);
  if (!ifs) {
    SendHeader(fd, 404, "Not Found", 0, "text/plain", {}, keep_alive);
    return keep_alive;
  }
  ifs.seekg(static_cast<std::streamoff>(*offset));
  std::string body((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
  std::string type =
      openaxe::app_storage::Get(openaxe::storage_bridge::kAssetTypeStore, key).value_or("");
  if (type.empty()) type = "application/octet-stream";
  // Not immutable: an asset id can be re-downloaded and overwritten, and the
  // fetch is loopback anyway, so revalidation costs nothing worth saving.
  if (!SendHeader(fd, 200, "OK", body.size(), type, "no-cache", keep_alive)) return false;
  if (!SendAll(fd, body.data(), body.size())) return false;
  return keep_alive;
}

bool HandleOneRequest(int fd, const std::string& root, const std::string& inject_head_script,
                      unsigned short port) {
  std::string req;
  if (!RecvRequestHead(fd, req)) return false;
  const bool keep_alive = WantsKeepAlive(req);
  // Reject cross-origin requests aimed at our loopback port before doing any
  // filesystem work (issue #300 G3).
  if (!IsAllowedHost(req, port)) {
    SendHeader(fd, 403, "Forbidden", 0, "text/plain");
    return false;
  }
  const size_t sp1 = req.find(' ');
  if (req.compare(0, 4, "GET ") != 0 || sp1 == std::string::npos) {
    SendHeader(fd, 405, "Method Not Allowed", 0, "text/plain");
    return false;
  }
  const size_t sp2 = req.find(' ', sp1 + 1);
  const std::string target = req.substr(sp1 + 1, sp2 == std::string::npos ? std::string::npos : sp2 - sp1 - 1);
  std::string path = target.substr(0, target.find('?'));
  if (path.empty() || path == "/") path = "/index.html";

  // /__asset/<key> streams a blob out of the shared on-disk library rather
  // than out of the UI root (issue #300 follow-up). Going through the bridge
  // instead would mean base64, which inflates every capture by a third and
  // hands the webview one giant string; a plain GET streams and lets the
  // webview turn the response straight into a Blob.
  if (path.rfind("/__asset/", 0) == 0) {
    return ServeAsset(fd, UrlDecode(path.substr(9)), keep_alive);
  }
  std::error_code ec;
  const std::filesystem::path root_norm = std::filesystem::path(root).lexically_normal();
  std::filesystem::path full = (root_norm / path.substr(1)).lexically_normal();
  const bool inside = IsPathUnderRoot(full.string(), root_norm.string());
  if (!inside) {
    SendHeader(fd, 404, "Not Found", 0, "text/plain", {}, keep_alive);
    return keep_alive;
  }
  if (!std::filesystem::is_regular_file(full, ec)) {
    // SPA fallback: a client-side route ("/presets", "/tuner") is not a file on
    // disk, and 404ing it meant a deep link or a reload on any route but "/"
    // showed nothing (issue #300 G6). Only for extensionless paths, so a
    // genuinely missing asset still 404s instead of being served HTML.
    if (full.extension().empty() && std::filesystem::is_regular_file(root_norm / "index.html", ec)) {
      full = root_norm / "index.html";
    } else {
      SendHeader(fd, 404, "Not Found", 0, "text/plain", {}, keep_alive);
      return keep_alive;
    }
  }
  std::ifstream ifs(full, std::ios::binary);
  if (!ifs) { SendHeader(fd, 404, "Not Found", 0, "text/plain", {}, keep_alive); return keep_alive; }
  std::string body((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
  std::string content_type; SetContentType(full.string(), content_type);
  // Bridge polyfill goes into the HTML document itself, ahead of the SPA's
  // module scripts — see HttpServer::Start's contract (issue #300 A1).
  if (!inject_head_script.empty() && content_type.starts_with("text/html")) {
    body = InjectHeadScript(body, inject_head_script);
  }
  if (!SendHeader(fd, 200, "OK", body.size(), content_type, CacheControlFor(path), keep_alive)) {
    return false;
  }
  if (!SendAll(fd, body.data(), body.size())) return false;
  return keep_alive;
}

// Drives one connection to completion. Bounded by an idle timeout so a client
// that opens a keep-alive connection and goes quiet cannot hold a worker
// forever, and by a request cap so one connection cannot monopolise one.
void HandleConnection(int fd, const std::string& root, const std::string& inject_head_script,
                      unsigned short port, const std::function<bool()>& others_waiting) {
  constexpr int kMaxRequestsPerConnection = 100;
  constexpr int kIdleTimeoutMs = 2000;
  for (int i = 0; i < kMaxRequestsPerConnection; ++i) {
#ifndef _WIN32
    if (i > 0) {  // the first request is already waiting; later ones may not come
      // Do not idle here while someone else is queued for a worker. Without
      // this, a browser holding its per-origin connections open would park
      // every worker on an idle poll and the next connection would wait out
      // the timeout before being served.
      if (others_waiting && others_waiting()) break;
      struct pollfd pfd { fd, POLLIN, 0 };
      const int ready = poll(&pfd, 1, kIdleTimeoutMs);
      if (ready <= 0) break;  // idle or error: close
    }
#endif
    if (!HandleOneRequest(fd, root, inject_head_script, port)) break;
  }
}

}  // namespace

bool HttpServer::Start(const std::string& root, unsigned short& out_port,
                       std::string inject_head_script) {
  inject_head_script_ = std::move(inject_head_script);
#ifdef _WIN32
  WSADATA wsa; if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return false;
#endif
  listen_fd_ = static_cast<int>(socket(AF_INET, SOCK_STREAM, 0));
  if (listen_fd_ < 0) return false;
  sockaddr_in addr{}; addr.sin_family = AF_INET; addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK); addr.sin_port = 0;
  if (bind(listen_fd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0 || listen(listen_fd_, 8) != 0) {
    CloseSocket(listen_fd_); listen_fd_ = -1; return false;
  }
  sockaddr_in bound{}; socklen_t len = sizeof(bound);
  getsockname(listen_fd_, reinterpret_cast<sockaddr*>(&bound), &len);
  out_port = ntohs(bound.sin_port);
  port_ = out_port;
#ifndef _WIN32
  if (pipe(wake_fds_) != 0) {
    wake_fds_[0] = wake_fds_[1] = -1;  // degrade to the old behaviour, don't fail
  }
#endif
  running_.store(true, std::memory_order_release);
  workers_.reserve(kWorkerCount);
  for (int i = 0; i < kWorkerCount; ++i) {
    workers_.emplace_back(&HttpServer::WorkerLoop, this, root);
  }
  thread_ = std::thread(&HttpServer::ServeLoop, this, root);
  return true;
}

void HttpServer::ServeLoop(const std::string& root) {
  while (running_.load(std::memory_order_acquire)) {
#ifndef _WIN32
    // Wait for either a connection or the self-pipe going readable, rather
    // than blocking in accept() where Stop() cannot reach us (issue #300 G1).
    if (wake_fds_[0] >= 0) {
      struct pollfd fds[2];
      fds[0] = {listen_fd_, POLLIN, 0};
      fds[1] = {wake_fds_[0], POLLIN, 0};
      const int ready = poll(fds, 2, -1);
      if (ready < 0) {
        if (errno == EINTR) continue;
        break;
      }
      // Stop() wrote to the pipe: leave before touching listen_fd_, which it
      // is about to close.
      if (fds[1].revents & POLLIN) break;
      if (!(fds[0].revents & POLLIN)) continue;
    }
#endif
#ifdef _WIN32
    SOCKET client = accept(listen_fd_, nullptr, nullptr); if (client == INVALID_SOCKET) break; const int fd = static_cast<int>(client);
#else
    const int fd = accept(listen_fd_, nullptr, nullptr);
    if (fd < 0) {
      if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) continue;
      break;
    }
#endif
    {
      std::lock_guard<std::mutex> lock(queue_mutex_);
      pending_.push_back(fd);
    }
    queue_cv_.notify_one();
  }
}

void HttpServer::WorkerLoop(const std::string& root) {
  for (;;) {
    int fd = -1;
    {
      std::unique_lock<std::mutex> lock(queue_mutex_);
      queue_cv_.wait(lock, [&] {
        return !pending_.empty() || !running_.load(std::memory_order_acquire);
      });
      if (pending_.empty()) return;  // shutting down and nothing left to serve
      fd = pending_.front();
      pending_.pop_front();
    }
    HandleConnection(fd, root, inject_head_script_, port_, [this] { return HasQueuedConnections(); });
    CloseSocket(fd);
  }
}

bool HttpServer::HasQueuedConnections() {
  std::lock_guard<std::mutex> lock(queue_mutex_);
  return !pending_.empty();
}

void HttpServer::Stop() {
  running_.store(false, std::memory_order_release);
  // Wake the serve thread first, then join, then close. Closing before the
  // join is what could deadlock: a thread already inside accept() is not
  // guaranteed to return when its descriptor is closed from underneath it.
#ifndef _WIN32
  if (wake_fds_[1] >= 0) {
    const char byte = 1;
    (void)!write(wake_fds_[1], &byte, 1);
  }
#else
  // No self-pipe on Windows: closesocket() does interrupt a blocked accept()
  // there, so the original ordering is correct.
  if (listen_fd_ >= 0) { CloseSocket(listen_fd_); listen_fd_ = -1; }
#endif
  if (thread_.joinable()) thread_.join();

  // The acceptor has stopped, so nothing new is queued. Wake every worker and
  // let them finish; then close whatever is still queued but unserved.
  queue_cv_.notify_all();
  for (auto& w : workers_) {
    if (w.joinable()) w.join();
  }
  workers_.clear();
  {
    std::lock_guard<std::mutex> lock(queue_mutex_);
    for (int fd : pending_) CloseSocket(fd);
    pending_.clear();
  }

  if (listen_fd_ >= 0) { CloseSocket(listen_fd_); listen_fd_ = -1; }
#ifndef _WIN32
  for (int& fd : wake_fds_) {
    if (fd >= 0) { close(fd); fd = -1; }
  }
#endif
}

HttpServer::~HttpServer() { Stop(); }

}  // namespace openaxe_vst3
