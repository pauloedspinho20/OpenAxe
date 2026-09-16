#include "http_server.h"

#include "openaxe/app_storage.h"
#include "openaxe/storage_bridge.h"

#include <array>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
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
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>
#endif

namespace openaxe_desktop {

namespace {

constexpr size_t kMaxRequest = 8192;

#ifdef _WIN32
int CloseSocket(int fd) {
  return closesocket(fd);
}
#else
int CloseSocket(int fd) {
  return close(fd);
}
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
  else if (ext == ".wav") out = "audio/wav";
  else out = "application/octet-stream";
}

// Sends a minimal HTTP/1.1 response; returns false on write error.
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
                const std::string& content_type) {
  const std::string head = "HTTP/1.1 " + std::to_string(status) + " " + reason +
                           "\r\nContent-Type: " + content_type +
                           "\r\nContent-Length: " + std::to_string(content_length) +
                           "\r\nConnection: close\r\n\r\n";
  return SendAll(fd, head.data(), head.size());
}

// Undoes encodeURIComponent for the key in a /__asset/<key> path.
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

// The record file keeps its key on the first line, so the payload starts at
// the offset app_storage reports rather than at byte 0.
void ServeAsset(int fd, const std::string& key) {
  const std::string path = openaxe::app_storage::PathFor(openaxe::storage_bridge::kAssetStore, key);
  const auto offset =
      openaxe::app_storage::ValueOffsetInFile(openaxe::storage_bridge::kAssetStore, key);
  if (path.empty() || !offset) {
    SendHeader(fd, 404, "Not Found", 0, "text/plain");
    return;
  }
  std::ifstream ifs(path, std::ios::binary);
  if (!ifs) {
    SendHeader(fd, 404, "Not Found", 0, "text/plain");
    return;
  }
  ifs.seekg(static_cast<std::streamoff>(*offset));
  std::string body((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
  std::string type =
      openaxe::app_storage::Get(openaxe::storage_bridge::kAssetTypeStore, key).value_or("");
  if (type.empty()) type = "application/octet-stream";
  if (!SendHeader(fd, 200, "OK", body.size(), type)) return;
  SendAll(fd, body.data(), body.size());
}

// True when `full` is genuinely inside `root`. A bare prefix compare has no
// separator check, so root "…/ui" would also admit "…/ui-secrets/secret" — a
// sibling directory whose name merely extends the root's. Same logic as the
// plugin's server (packages/vst3/src/http_server.cpp), ported here because the
// desktop shell never got the fix (issue #415).
bool IsPathUnderRoot(const std::string& full, const std::string& root) {
  const auto rel = std::filesystem::path(full).lexically_relative(std::filesystem::path(root));
  if (rel.empty()) return false;
  const std::string s = rel.generic_string();
  if (s == "..") return false;
  return !s.starts_with("../");
}

// True when a request's Host header names our own loopback listener. Anything
// else is refused: without this check any web page the user visits can have its
// browser fetch http://127.0.0.1:<port>/… and read whatever we serve (DNS
// rebinding). Accepts 127.0.0.1/localhost/[::1] with our exact port, and
// tolerates a missing Host only for HTTP/1.0-style clients, which browsers are
// not. Mirrors the plugin's server (issue #415).
bool IsAllowedHost(const std::string& request_head, unsigned short port) {
  // Case-insensitive scan of the header block for "Host:".
  std::string lower;
  lower.reserve(request_head.size());
  for (char c : request_head)
    lower.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
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

void HandleClient(int fd, const std::string& root, unsigned short port) {
  std::array<char, kMaxRequest> buf;
#ifdef _WIN32
  const int n = recv(fd, buf.data(), static_cast<int>(buf.size()) - 1, 0);
#else
  const ssize_t n = recv(fd, buf.data(), buf.size() - 1, 0);
#endif
  if (n <= 0) return;
  buf[static_cast<size_t>(n)] = '\0';

  // Parse the request target from the request line: "GET <path> HTTP/1.x".
  std::string req(buf.data());
  // Reject cross-origin requests aimed at our loopback port before doing any
  // filesystem work (issue #415) - a malicious page must not be able to read
  // the UI tree or the /__asset/ library through a DNS-rebinding request.
  if (!IsAllowedHost(req, port)) {
    SendHeader(fd, 403, "Forbidden", 0, "text/plain");
    return;
  }
  const size_t sp1 = req.find(' ');
  if (req.compare(0, 4, "GET ") != 0 || sp1 == std::string::npos) {
    SendHeader(fd, 405, "Method Not Allowed", 0, "text/plain");
    return;
  }
  const size_t sp2 = req.find(' ', sp1 + 1);
  const std::string target = req.substr(sp1 + 1, sp2 == std::string::npos ? std::string::npos
                                                                          : sp2 - sp1 - 1);
  // Keep only the path (strip query), default to index.html.
  // UrlDecode handles %20 etc. so `fender%20strat.wav` on the wire maps to
  // `fender strat.wav` on disk. Do it here for static files too — not only
  // /__asset/ — so DI samples and any other public asset with spaces work in
  // the desktop shell (the browser always percent-encodes them).
  std::string path = target.substr(0, target.find('?'));
  if (path.empty() || path == "/") path = "/index.html";
  path = UrlDecode(path);

  // /__asset/<key> serves a blob out of the shared on-disk library, which
  // lives outside the UI root — the plugin serves the identical route, so the
  // React app fetches its captures and IRs the same way in both shells
  // (issue #300 follow-up). A plain GET streams; the bridge alternative would
  // mean base64 and a third more bytes.
  if (path.rfind("/__asset/", 0) == 0) {
    // Already decoded once; avoid double-decode if someone double-encodes.
    ServeAsset(fd, path.substr(9));
    return;
  }

  // Resolve under root, rejecting traversal and non-files.
  std::error_code ec;
  const std::filesystem::path root_norm = std::filesystem::path(root).lexically_normal();
  const std::filesystem::path full = (root_norm / path.substr(1)).lexically_normal();
  if (!IsPathUnderRoot(full.string(), root_norm.string()) ||
      !std::filesystem::is_regular_file(full, ec)) {
    SendHeader(fd, 404, "Not Found", 0, "text/plain");
    return;
  }

  std::ifstream ifs(full, std::ios::binary);
  if (!ifs) {
    SendHeader(fd, 404, "Not Found", 0, "text/plain");
    return;
  }
  std::string body((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
  std::string content_type;
  SetContentType(full.string(), content_type);
  if (!SendHeader(fd, 200, "OK", body.size(), content_type)) return;
  SendAll(fd, body.data(), body.size());
}

// Extracts the raw query string (including the leading '?', or "" if none)
// from a request line's target, e.g. "/callback?code=abc&state=xyz".
std::string QueryStringOf(const std::string& target) {
  const size_t q = target.find('?');
  return q == std::string::npos ? std::string() : target.substr(q);
}

void HandleOAuthRedirectClient(int fd, unsigned short target_ui_port) {
  std::array<char, kMaxRequest> buf;
#ifdef _WIN32
  const int n = recv(fd, buf.data(), static_cast<int>(buf.size()) - 1, 0);
#else
  const ssize_t n = recv(fd, buf.data(), buf.size() - 1, 0);
#endif
  if (n <= 0) return;
  buf[static_cast<size_t>(n)] = '\0';

  const std::string req(buf.data());
  const size_t sp1 = req.find(' ');
  const size_t sp2 = sp1 == std::string::npos ? std::string::npos : req.find(' ', sp1 + 1);
  const std::string target =
      sp1 == std::string::npos
          ? std::string()
          : req.substr(sp1 + 1, sp2 == std::string::npos ? std::string::npos : sp2 - sp1 - 1);

  // The UI server hadn't picked a port yet (shouldn't happen in practice -
  // this listener only starts after it has) - nothing sane to redirect to.
  if (target_ui_port == 0) {
    SendHeader(fd, 503, "Service Unavailable", 0, "text/plain");
    return;
  }

  const std::string location =
      "http://127.0.0.1:" + std::to_string(target_ui_port) + "/" + QueryStringOf(target);
  const std::string head = "HTTP/1.1 302 Found\r\nLocation: " + location +
                           "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
  SendAll(fd, head.data(), head.size());
}

}  // namespace

bool HttpServer::StartOAuthRedirect(unsigned short port, const unsigned short* target_ui_port) {
#ifdef _WIN32
  WSADATA wsa;
  if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return false;
#endif
  listen_fd_ = static_cast<int>(socket(AF_INET, SOCK_STREAM, 0));
  if (listen_fd_ < 0) return false;

  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  addr.sin_port = htons(port);
  if (bind(listen_fd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0 ||
      listen(listen_fd_, 8) != 0) {
    CloseSocket(listen_fd_);
    listen_fd_ = -1;
    return false;
  }

  oauth_target_port_ = target_ui_port;
  running_.store(true, std::memory_order_release);
  thread_ = std::thread(&HttpServer::OAuthRedirectLoop, this);
  return true;
}

void HttpServer::OAuthRedirectLoop() {
  while (running_.load(std::memory_order_acquire)) {
#ifdef _WIN32
    SOCKET client = accept(listen_fd_, nullptr, nullptr);
    if (client == INVALID_SOCKET) break;
    const int fd = static_cast<int>(client);
#else
    const int fd = accept(listen_fd_, nullptr, nullptr);
    if (fd < 0) break;
#endif
    HandleOAuthRedirectClient(fd, oauth_target_port_ ? *oauth_target_port_ : 0);
    CloseSocket(fd);
  }
}

bool HttpServer::Start(const std::string& root, unsigned short& out_port) {
#ifdef _WIN32
  WSADATA wsa;
  if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return false;
#endif
  listen_fd_ = static_cast<int>(socket(AF_INET, SOCK_STREAM, 0));
  if (listen_fd_ < 0) return false;

#ifndef _WIN32
  // Required now the port is fixed: reopening the app inside the TIME_WAIT
  // window would otherwise fail to bind and fall back to a random port.
  const int reuse = 1;
  setsockopt(listen_fd_, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
#endif

  // Prefer a stable port so the webview origin stops changing every launch;
  // fall back to ephemeral if they are all taken, so a squatted port costs
  // the stability rather than the UI.
  bool bound_preferred = false;
  for (unsigned short candidate : kPreferredPorts) {
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = htons(candidate);
    if (bind(listen_fd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == 0) {
      bound_preferred = true;
      break;
    }
  }
  if (!bound_preferred) {
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = 0;  // ephemeral
    if (bind(listen_fd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
      CloseSocket(listen_fd_);
      listen_fd_ = -1;
      return false;
    }
  }
  if (listen(listen_fd_, 8) != 0) {
    CloseSocket(listen_fd_);
    listen_fd_ = -1;
    return false;
  }

  sockaddr_in bound{};
  socklen_t len = sizeof(bound);
  getsockname(listen_fd_, reinterpret_cast<sockaddr*>(&bound), &len);
  out_port = ntohs(bound.sin_port);
  // Kept so each request's Host header can be checked against the port we
  // actually bound (issue #415) - Start's preferred-port walk means it is not
  // always the first candidate.
  port_ = out_port;

  running_.store(true, std::memory_order_release);
  thread_ = std::thread(&HttpServer::ServeLoop, this, root);
  return true;
}

void HttpServer::ServeLoop(const std::string& root) {
  while (running_.load(std::memory_order_acquire)) {
#ifdef _WIN32
    SOCKET client = accept(listen_fd_, nullptr, nullptr);
    if (client == INVALID_SOCKET) break;
    const int fd = static_cast<int>(client);
#else
    const int fd = accept(listen_fd_, nullptr, nullptr);
    if (fd < 0) break;
#endif
    HandleClient(fd, root, port_);
    CloseSocket(fd);
  }
}

void HttpServer::Stop() {
  running_.store(false, std::memory_order_release);
  if (listen_fd_ >= 0) {
    CloseSocket(listen_fd_);
    listen_fd_ = -1;
  }
  if (thread_.joinable()) thread_.join();
}

HttpServer::~HttpServer() {
  Stop();
}

}  // namespace openaxe_desktop