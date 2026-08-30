#include "openaxe/app_storage.h"

#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace fs = std::filesystem;

namespace openaxe::app_storage {
namespace {

// Same product directory the bare .clap already looks in for its UI (see
// packages/vst3/src/ui_root.cpp) — one place per user for everything OpenAxe
// keeps, rather than a second parallel location.
fs::path PlatformDataDir() {
#if defined(_WIN32)
  if (const char* appdata = std::getenv("APPDATA"); appdata && *appdata) {
    return fs::path(appdata) / "OpenAxe";
  }
  return fs::path(".") / "OpenAxe";
#elif defined(__APPLE__)
  if (const char* home = std::getenv("HOME"); home && *home) {
    return fs::path(home) / "Library" / "Application Support" / "OpenAxe";
  }
  return fs::path(".") / "OpenAxe";
#else
  if (const char* xdg = std::getenv("XDG_DATA_HOME"); xdg && *xdg) {
    return fs::path(xdg) / "OpenAxe";
  }
  if (const char* home = std::getenv("HOME"); home && *home) {
    return fs::path(home) / ".local" / "share" / "OpenAxe";
  }
  return fs::path(".") / "OpenAxe";
#endif
}

std::uint64_t Fnv1a64(const std::string& s) {
  std::uint64_t h = 1469598103934665603ULL;
  for (unsigned char c : s) {
    h ^= static_cast<std::uint64_t>(c);
    h *= 1099511628211ULL;
  }
  return h;
}

std::string ToHex16(std::uint64_t v) {
  static const char* kDigits = "0123456789abcdef";
  std::string out(16, '0');
  for (int i = 15; i >= 0; --i) {
    out[static_cast<size_t>(i)] = kDigits[v & 0xF];
    v >>= 4;
  }
  return out;
}

// Percent-encoding is used only for the key line inside the file, never for
// a filename, so it just has to survive a round-trip through a text line:
// anything outside printable ASCII, plus '%' and newline, is escaped.
std::string EncodeKey(const std::string& key) {
  static const char* kDigits = "0123456789ABCDEF";
  std::string out;
  out.reserve(key.size());
  for (unsigned char c : key) {
    const bool plain = c >= 0x20 && c < 0x7F && c != '%';
    if (plain) {
      out.push_back(static_cast<char>(c));
    } else {
      out.push_back('%');
      out.push_back(kDigits[c >> 4]);
      out.push_back(kDigits[c & 0xF]);
    }
  }
  return out;
}

int HexVal(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

std::string DecodeKey(const std::string& enc) {
  std::string out;
  out.reserve(enc.size());
  for (size_t i = 0; i < enc.size(); ++i) {
    if (enc[i] == '%' && i + 2 < enc.size()) {
      const int hi = HexVal(enc[i + 1]);
      const int lo = HexVal(enc[i + 2]);
      if (hi >= 0 && lo >= 0) {
        out.push_back(static_cast<char>(hi * 16 + lo));
        i += 2;
        continue;
      }
    }
    out.push_back(enc[i]);
  }
  return out;
}

fs::path StoreDir(const std::string& store) { return fs::path(DataDir()) / store; }

// Reads just the key line of a record file. nullopt when the file cannot be
// read at all.
std::optional<std::string> ReadKeyLine(const fs::path& path, unsigned long long* value_offset) {
  std::ifstream ifs(path, std::ios::binary);
  if (!ifs) return std::nullopt;
  std::string line;
  if (!std::getline(ifs, line)) return std::nullopt;
  if (value_offset) *value_offset = static_cast<unsigned long long>(line.size()) + 1;
  return DecodeKey(line);
}

// Resolves `key` to its file, probing past hash collisions. When `for_write`
// is true the first free slot is returned if the key is not already present;
// otherwise a miss returns nullopt.
std::optional<fs::path> ResolvePath(const std::string& store, const std::string& key,
                                    bool for_write) {
  const fs::path dir = StoreDir(store);
  const std::string base = ToHex16(Fnv1a64(key));
  // A handful of probes is far more than a 64-bit hash will ever need; the
  // bound just guarantees termination.
  for (int probe = 0; probe < 64; ++probe) {
    const fs::path candidate = dir / (probe == 0 ? base : base + "-" + std::to_string(probe));
    std::error_code ec;
    if (!fs::exists(candidate, ec)) {
      return for_write ? std::optional<fs::path>(candidate) : std::nullopt;
    }
    const auto stored = ReadKeyLine(candidate, nullptr);
    if (stored && *stored == key) return candidate;
    // Occupied by a different key — keep probing.
  }
  return std::nullopt;
}

}  // namespace

bool IsValidStoreName(const std::string& store) {
  if (store.empty() || store.size() > 64) return false;
  for (char c : store) {
    const bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
    if (!ok) return false;
  }
  return true;
}

std::string DataDir() {
  if (const char* override_dir = std::getenv("OPENAXE_DATA_DIR");
      override_dir && *override_dir) {
    return (fs::path(override_dir) / "data").string();
  }
  return (PlatformDataDir() / "data").string();
}

bool Put(const std::string& store, const std::string& key, const std::string& value,
         std::string* error) {
  if (!IsValidStoreName(store)) {
    if (error) *error = "invalid store name";
    return false;
  }
  std::error_code ec;
  fs::create_directories(StoreDir(store), ec);
  const auto path = ResolvePath(store, key, /*for_write=*/true);
  if (!path) {
    if (error) *error = "could not resolve a slot for the key";
    return false;
  }

  // Write-then-rename: another process reading concurrently sees either the
  // previous record or this one, never a truncated file.
  const fs::path tmp = path->string() + ".tmp";
  {
    std::ofstream ofs(tmp, std::ios::binary | std::ios::trunc);
    if (!ofs) {
      if (error) *error = "failed to open " + tmp.string();
      return false;
    }
    ofs << EncodeKey(key) << '\n';
    ofs.write(value.data(), static_cast<std::streamsize>(value.size()));
    if (!ofs) {
      if (error) *error = "failed while writing " + tmp.string();
      return false;
    }
  }
  fs::rename(tmp, *path, ec);
  if (ec) {
    // Windows will not rename onto an existing file on every filesystem.
    fs::remove(*path, ec);
    fs::rename(tmp, *path, ec);
  }
  if (ec) {
    if (error) *error = "failed to commit " + path->string() + ": " + ec.message();
    fs::remove(tmp, ec);
    return false;
  }
  return true;
}

std::optional<std::string> Get(const std::string& store, const std::string& key,
                               std::string* error) {
  if (!IsValidStoreName(store)) {
    if (error) *error = "invalid store name";
    return std::nullopt;
  }
  const auto path = ResolvePath(store, key, /*for_write=*/false);
  if (!path) return std::nullopt;
  std::ifstream ifs(*path, std::ios::binary);
  if (!ifs) return std::nullopt;
  std::string line;
  if (!std::getline(ifs, line)) return std::nullopt;
  return std::string(std::istreambuf_iterator<char>(ifs), std::istreambuf_iterator<char>());
}

bool Delete(const std::string& store, const std::string& key, std::string* error) {
  if (!IsValidStoreName(store)) {
    if (error) *error = "invalid store name";
    return false;
  }
  const auto path = ResolvePath(store, key, /*for_write=*/false);
  if (!path) return true;
  std::error_code ec;
  fs::remove(*path, ec);
  return true;
}

std::vector<std::string> Keys(const std::string& store) {
  std::vector<std::string> keys;
  if (!IsValidStoreName(store)) return keys;
  std::error_code ec;
  for (const auto& entry : fs::directory_iterator(StoreDir(store), ec)) {
    if (!entry.is_regular_file(ec)) continue;
    if (entry.path().extension() == ".tmp") continue;
    if (auto key = ReadKeyLine(entry.path(), nullptr)) keys.push_back(*key);
  }
  return keys;
}

std::vector<std::string> Values(const std::string& store) {
  std::vector<std::string> values;
  if (!IsValidStoreName(store)) return values;
  std::error_code ec;
  for (const auto& entry : fs::directory_iterator(StoreDir(store), ec)) {
    if (!entry.is_regular_file(ec)) continue;
    if (entry.path().extension() == ".tmp") continue;
    std::ifstream ifs(entry.path(), std::ios::binary);
    if (!ifs) continue;
    std::string line;
    if (!std::getline(ifs, line)) continue;
    values.emplace_back(std::istreambuf_iterator<char>(ifs), std::istreambuf_iterator<char>());
  }
  return values;
}

bool Clear(const std::string& store, std::string* error) {
  if (!IsValidStoreName(store)) {
    if (error) *error = "invalid store name";
    return false;
  }
  std::error_code ec;
  fs::remove_all(StoreDir(store), ec);
  if (ec && error) *error = ec.message();
  return !ec;
}

std::string PathFor(const std::string& store, const std::string& key) {
  if (!IsValidStoreName(store)) return {};
  if (const auto path = ResolvePath(store, key, /*for_write=*/false)) return path->string();
  return {};
}

std::optional<unsigned long long> ValueOffsetInFile(const std::string& store,
                                                    const std::string& key) {
  if (!IsValidStoreName(store)) return std::nullopt;
  const auto path = ResolvePath(store, key, /*for_write=*/false);
  if (!path) return std::nullopt;
  unsigned long long offset = 0;
  if (!ReadKeyLine(*path, &offset)) return std::nullopt;
  return offset;
}

}  // namespace openaxe::app_storage
