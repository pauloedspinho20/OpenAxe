#include "http_server.h"

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
                const std::string& content_type) {
  const std::string head = "HTTP/1.1 " + std::to_string(status) + " " + reason +
                           "\r\nContent-Type: " + content_type +
                           "\r\nContent-Length: " + std::to_string(content_length) +
                           "\r\nConnection: close\r\n\r\n";
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

void HandleClient(int fd, const std::string& root, const std::string& inject_head_script,
                  unsigned short port) {
  std::string req;
  if (!RecvRequestHead(fd, req)) return;
  // Reject cross-origin requests aimed at our loopback port before doing any
  // filesystem work (issue #300 G3).
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
  const std::string target = req.substr(sp1 + 1, sp2 == std::string::npos ? std::string::npos : sp2 - sp1 - 1);
  std::string path = target.substr(0, target.find('?'));
  if (path.empty() || path == "/") path = "/index.html";
  std::error_code ec;
  const std::filesystem::path root_norm = std::filesystem::path(root).lexically_normal();
  std::filesystem::path full = (root_norm / path.substr(1)).lexically_normal();
  const bool inside = IsPathUnderRoot(full.string(), root_norm.string());
  if (!inside) {
    SendHeader(fd, 404, "Not Found", 0, "text/plain");
    return;
  }
  if (!std::filesystem::is_regular_file(full, ec)) {
    // SPA fallback: a client-side route ("/presets", "/tuner") is not a file on
    // disk, and 404ing it meant a deep link or a reload on any route but "/"
    // showed nothing (issue #300 G6). Only for extensionless paths, so a
    // genuinely missing asset still 404s instead of being served HTML.
    if (full.extension().empty() && std::filesystem::is_regular_file(root_norm / "index.html", ec)) {
      full = root_norm / "index.html";
    } else {
      SendHeader(fd, 404, "Not Found", 0, "text/plain");
      return;
    }
  }
  std::ifstream ifs(full, std::ios::binary);
  if (!ifs) { SendHeader(fd, 404, "Not Found", 0, "text/plain"); return; }
  std::string body((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
  std::string content_type; SetContentType(full.string(), content_type);
  // Bridge polyfill goes into the HTML document itself, ahead of the SPA's
  // module scripts — see HttpServer::Start's contract (issue #300 A1).
  if (!inject_head_script.empty() && content_type.starts_with("text/html")) {
    body = InjectHeadScript(body, inject_head_script);
  }
  if (!SendHeader(fd, 200, "OK", body.size(), content_type)) return;
  SendAll(fd, body.data(), body.size());
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
    HandleClient(fd, root, inject_head_script_, port_);
    CloseSocket(fd);
  }
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
  if (listen_fd_ >= 0) { CloseSocket(listen_fd_); listen_fd_ = -1; }
#ifndef _WIN32
  for (int& fd : wake_fds_) {
    if (fd >= 0) { close(fd); fd = -1; }
  }
#endif
}

HttpServer::~HttpServer() { Stop(); }

}  // namespace openaxe_vst3
