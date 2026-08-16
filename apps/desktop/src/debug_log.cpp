#include "debug_log.h"

#include <atomic>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <mutex>
#include <string>

#ifdef _WIN32
#include <windows.h>
#else
#include <csignal>
#include <execinfo.h>
#include <unistd.h>
#endif

namespace nam_desktop {

namespace {

std::mutex g_log_mutex;
FILE* g_log_file = nullptr;
std::atomic<bool> g_crash_installed{false};

#ifdef _WIN32
constexpr const char* kDefaultLog = "nam_desktop.log";
#else
constexpr const char* kDefaultLog = "nam_desktop.log";
#endif

void WriteLine(FILE* f, const char* line) {
  if (!f) return;
  std::fputs(line, f);
  std::fputc('\n', f);
  std::fflush(f);
}

void WriteBacktraceTo(FILE* f) {
#ifndef _WIN32
  void* frames[64];
  const int n = backtrace(frames, 64);
  WriteLine(f, "===== backtrace =====");
  backtrace_symbols_fd(frames, n, fileno(f));
  WriteLine(f, "=====================");
#endif
}

void CrashHandler(int sig) {
  char msg[128];
  std::snprintf(msg, sizeof(msg), "===== crash: signal %d (%s) =====", sig,
                sig == SIGSEGV ? "SIGSEGV" : sig == SIGABRT ? "SIGABRT" : "SIGBUS");
  std::lock_guard<std::mutex> lock(g_log_mutex);
  WriteLine(stderr, msg);
  WriteLine(g_log_file, msg);
  WriteBacktraceTo(stderr);
  WriteBacktraceTo(g_log_file);
  std::fflush(g_log_file);
  std::signal(sig, SIG_DFL);  // restore so the crash report is also captured
  std::raise(sig);
}

}  // namespace

bool DebugEnabled() {
  const char* v = std::getenv("NAM_DESKTOP_DEBUG");
  return v && *v && std::strcmp(v, "0") != 0;
}

void InstallDebugLogging(const std::string& exe_dir) {
#ifdef _WIN32
  // Crash backtraces aren't available via signal() on Windows; the log file is
  // still created. SEH/unhandled-exception capture is out of scope here.
#endif
  const char* override = std::getenv("NAM_DESKTOP_LOG");
  std::string path = override && *override ? override : exe_dir + "/" + kDefaultLog;

  FILE* f = std::fopen(path.c_str(), "a");
  if (!f) {
    // Fall back to the current directory if the exe dir isn't writable.
    f = std::fopen(kDefaultLog, "a");
  }
  {
    std::lock_guard<std::mutex> lock(g_log_mutex);
    g_log_file = f;
  }
  std::fprintf(stderr, "nam_desktop: logging to %s\n", path.c_str());

  if (!g_crash_installed.exchange(true)) {
#ifndef _WIN32
    std::signal(SIGSEGV, CrashHandler);
    std::signal(SIGABRT, CrashHandler);
    std::signal(SIGBUS, CrashHandler);
#endif
  }
}

void WriteLog(const std::string& line) {
  std::lock_guard<std::mutex> lock(g_log_mutex);
  WriteLine(stderr, line.c_str());
  WriteLine(g_log_file, line.c_str());
}

}  // namespace nam_desktop