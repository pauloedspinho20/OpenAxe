// Regression tests for the desktop loopback UI server's request hardening
// (issue #415): path containment (a sibling directory whose name merely
// extends the root's must not be served) and the Host-header allowlist
// (DNS rebinding).
//
// These drive the real server over a loopback socket rather than calling the
// helpers directly, so they also pin that the Host check runs on the request
// path and that a legitimate request still succeeds.

#include <array>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>

#include "http_server.h"

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

namespace fs = std::filesystem;

namespace {

int failures = 0;

void Check(bool cond, const char* what) {
  if (!cond) {
    std::fprintf(stderr, "FAIL: %s\n", what);
    ++failures;
  }
}

#ifdef _WIN32
int CloseSocket(int fd) { return closesocket(fd); }
#else
int CloseSocket(int fd) { return close(fd); }
#endif

// Opens one loopback connection to `port`, sends `request` whole, and reads the
// response to EOF (the server always answers Connection: close). Returns "" if
// the connection could not be made.
std::string Exchange(unsigned short port, const std::string& request) {
  const int fd = static_cast<int>(socket(AF_INET, SOCK_STREAM, 0));
  if (fd < 0) return {};
  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  addr.sin_port = htons(port);
  if (connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
    CloseSocket(fd);
    return {};
  }
  size_t sent = 0;
  while (sent < request.size()) {
#ifdef _WIN32
    const int n = send(fd, request.data() + sent, static_cast<int>(request.size() - sent), 0);
#else
    const ssize_t n = send(fd, request.data() + sent, request.size() - sent, 0);
#endif
    if (n <= 0) break;
    sent += static_cast<size_t>(n);
  }
  std::string response;
  std::array<char, 4096> buf;
  for (;;) {
#ifdef _WIN32
    const int n = recv(fd, buf.data(), static_cast<int>(buf.size()), 0);
#else
    const ssize_t n = recv(fd, buf.data(), buf.size(), 0);
#endif
    if (n <= 0) break;
    response.append(buf.data(), static_cast<size_t>(n));
  }
  CloseSocket(fd);
  return response;
}

bool HasStatus(const std::string& response, const char* status) {
  return response.find(status) != std::string::npos;
}

}  // namespace

int main() {
#ifdef _WIN32
  WSADATA wsa;
  WSAStartup(MAKEWORD(2, 2), &wsa);
#endif

  const fs::path tmp = fs::temp_directory_path() / "openaxe_http_server_test";
  fs::remove_all(tmp);
  const fs::path root = tmp / "ui";
  fs::create_directories(root);
  {
    std::ofstream(root / "index.html") << "<html><body>OPENAXE_HAPPY</body></html>";
  }
  // A sibling whose name shares the root's "ui" prefix - the exact case a bare
  // starts_with() admitted.
  const fs::path sibling = tmp / "ui-secrets";
  fs::create_directories(sibling);
  {
    std::ofstream(sibling / "secret.txt") << "TOPSECRET";
  }

  openaxe_desktop::HttpServer server;
  unsigned short port = 0;
  if (!server.Start(root.string(), port)) {
    std::fprintf(stderr, "FAIL: server did not start\n");
    fs::remove_all(tmp);
    return 1;
  }

  const std::string good_host = "127.0.0.1:" + std::to_string(port);
  auto request = [&](const char* target, const char* host) {
    std::string req = std::string("GET ") + target + " HTTP/1.1\r\n";
    if (host) { req += "Host: "; req += host; req += "\r\n"; }
    req += "\r\n";
    return Exchange(port, req);
  };

  // Happy path: a real file under root with our own Host still serves.
  const std::string ok = request("/index.html", good_host.c_str());
  Check(HasStatus(ok, "200 OK"), "a normal request for a real file succeeds");
  Check(ok.find("OPENAXE_HAPPY") != std::string::npos, "the happy-path body is served");

  // Path traversal into the sibling whose name extends the root's.
  const std::string traverse = request("/../ui-secrets/secret.txt", good_host.c_str());
  Check(HasStatus(traverse, "404"), "traversal into a root-prefixed sibling is rejected");
  Check(traverse.find("TOPSECRET") == std::string::npos, "the secret body never leaks");

  // Same, spelled with an inner directory that normalizes back out of root.
  const std::string traverse2 = request("/assets/../../ui-secrets/secret.txt", good_host.c_str());
  Check(HasStatus(traverse2, "404"), "normalized traversal out of root is rejected");
  Check(traverse2.find("TOPSECRET") == std::string::npos, "the secret body never leaks (nested)");

  // An absolute-looking path is joined under root (so it 404s here) rather than
  // escaping to the real filesystem root.
  const std::string absolute = request("/etc/passwd", good_host.c_str());
  Check(HasStatus(absolute, "404"), "an absolute path stays inside root");

  // DNS rebinding: a foreign Host must be refused before any path handling.
  const std::string foreign = request("/index.html", "evil.example.com");
  Check(HasStatus(foreign, "403"), "a foreign Host is rejected");
  Check(foreign.find("OPENAXE_HAPPY") == std::string::npos, "a foreign Host gets no body");

  const std::string wrong_port = request("/index.html", "127.0.0.1:1");
  Check(HasStatus(wrong_port, "403"), "a loopback Host with the wrong port is rejected");

  const std::string localhost =
      request("/index.html", ("localhost:" + std::to_string(port)).c_str());
  Check(HasStatus(localhost, "200 OK"), "localhost with our port is allowed");

  server.Stop();
  fs::remove_all(tmp);

  if (failures == 0) std::fprintf(stdout, "http_server_test: all checks passed\n");
  return failures == 0 ? 0 : 1;
}
