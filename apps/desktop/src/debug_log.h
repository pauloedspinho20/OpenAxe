#pragma once

#include <string>

namespace openaxe_desktop {

// Debug helpers for the desktop shell.
//
// - OPENAXE_DESKTOP_DEBUG=1  enables webview devtools (remote inspector) and
//   verbose logging.
// - OPENAXE_DESKTOP_LOG=<path> overrides where the log file is written (default:
//   <exeDir>/openaxe_desktop.log).
//
// The log file mirrors whatever goes to stderr, and the crash handler appends a
// backtrace to it before the process dies, so you can find a segfault even when
// the app was launched without a terminal attached.

// True when OPENAXE_DESKTOP_DEBUG is set to a non-empty, non-"0" value.
bool DebugEnabled();

// Opens the log file (best effort) and installs SIGSEGV/SIGABRT/SIGBUS handlers
// that write a backtrace to stderr + the log, then re-raise. No-op where
// unsupported (Windows: returns without installing a handler).
void InstallDebugLogging(const std::string& exe_dir);

// Writes a line to stderr and the log file (if open). Thread-safe-ish.
void WriteLog(const std::string& line);

}  // namespace openaxe_desktop