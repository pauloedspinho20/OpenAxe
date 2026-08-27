#include "ui_root.h"

#include <cstdlib>
#include <filesystem>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace openaxe_vst3 {

namespace {
namespace fs = std::filesystem;

// Anchor whose address we hand to the loader to identify our own module.
void AddressAnchor() {}

bool HasIndex(const fs::path& dir) {
  std::error_code ec;
  return fs::is_regular_file(dir / "index.html", ec);
}
}  // namespace

std::string ThisBinaryPath() {
#ifdef _WIN32
  HMODULE mod = nullptr;
  if (!GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                              GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                          reinterpret_cast<LPCSTR>(&AddressAnchor), &mod)) {
    return {};
  }
  char buf[MAX_PATH] = {};
  const DWORD n = GetModuleFileNameA(mod, buf, MAX_PATH);
  if (n == 0 || n >= MAX_PATH) return {};
  return std::string(buf, n);
#else
  Dl_info info{};
  if (dladdr(reinterpret_cast<void*>(&AddressAnchor), &info) == 0) return {};
  if (!info.dli_fname || !*info.dli_fname) return {};
  return std::string(info.dli_fname);
#endif
}

std::vector<std::string> UiRootCandidates(const std::string& binary_path) {
  std::vector<std::string> out;
  if (binary_path.empty()) return out;

  std::error_code ec;
  fs::path bin = fs::weakly_canonical(fs::path(binary_path), ec);
  if (ec) bin = fs::path(binary_path);
  const fs::path bin_dir = bin.parent_path();

  // Walk up looking for the bundle's "Contents" directory. Bounded so a
  // pathological path can't spin: no bundle nests the binary this deep.
  fs::path p = bin_dir;
  for (int depth = 0; depth < 6 && !p.empty() && p != p.root_path(); ++depth) {
    if (p.filename() == "Contents") {
      out.push_back((p / "Resources" / "ui").lexically_normal().string());
      break;
    }
    p = p.parent_path();
  }

  // Bare (non-bundle) module: a sibling ui/ directory next to the binary, and
  // one level up for build trees that put the module in a subdirectory.
  out.push_back((bin_dir / "ui").lexically_normal().string());
  out.push_back((bin_dir / ".." / "ui").lexically_normal().string());
  out.push_back((bin_dir / ".." / "Resources" / "ui").lexically_normal().string());
  return out;
}

std::string FindBundledUiRoot() {
  // Development override, checked first so a dev can point the plugin at a
  // freshly built apps/web/dist without reinstalling the bundle.
  if (const char* env = std::getenv("OPENAXE_UI_DIR"); env && *env) {
    const fs::path p(env);
    if (HasIndex(p)) return p.lexically_normal().string();
  }
  for (const auto& cand : UiRootCandidates(ThisBinaryPath())) {
    if (HasIndex(fs::path(cand))) return cand;
  }
  return {};
}

}  // namespace openaxe_vst3
