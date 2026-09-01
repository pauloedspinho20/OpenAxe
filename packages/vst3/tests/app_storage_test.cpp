// Shared on-disk app store (issue #300 follow-up: the factory pack, presets,
// scenes and the rest had to be reinstalled on every launch).
//
// The store exists because the webview's own localStorage/IndexedDB cannot
// hold this data: the UI server binds an ephemeral port, so the origin those
// APIs are scoped to changes every launch, and WKWebView/WebView2 additionally
// scope website data per host application, so the desktop app and a plugin
// inside a DAW could never share one library through them. See
// packages/shared/include/openaxe/app_storage.h.
//
// The interesting parts to pin here are the ones a naive filename-per-key
// implementation gets wrong: keys that differ only by case (macOS filesystems
// fold them together), keys carrying path separators (traversal), keys longer
// than a filename may be, and binary values containing NULs and newlines —
// the file format puts the key on its own first line, so a value with newlines
// in it must still round-trip exactly.

#include "openaxe/app_storage.h"

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>
#include <algorithm>

namespace fs = std::filesystem;
namespace store = openaxe::app_storage;

int fails = 0;
#define CHECK(c) do { if(!(c)) { std::fprintf(stderr, "FAIL: %s (line %d)\n", #c, __LINE__); ++fails; } } while(0)

static void SetDataDir(const std::string& dir) {
#if defined(_WIN32)
  _putenv_s("OPENAXE_DATA_DIR", dir.c_str());
#else
  ::setenv("OPENAXE_DATA_DIR", dir.c_str(), 1);
#endif
}

int main() {
  // A real temp dir, not a hard-coded /tmp — the Windows CI run has no such
  // path and silently skipped these tests once already.
  const fs::path root = fs::temp_directory_path() / "openaxe_app_storage_test";
  std::error_code ec;
  fs::remove_all(root, ec);
  SetDataDir(root.string());

  // 1. Round-trip, overwrite, and miss.
  {
    CHECK(!store::Get("presets", "nothing-here").has_value());
    CHECK(store::Put("presets", "a", "{\"n\":1}"));
    CHECK(store::Get("presets", "a").value_or("") == "{\"n\":1}");
    CHECK(store::Put("presets", "a", "{\"n\":2}"));
    CHECK(store::Get("presets", "a").value_or("") == "{\"n\":2}");
    CHECK(store::Delete("presets", "a"));
    CHECK(!store::Get("presets", "a").has_value());
    // Deleting something absent is a no-op, not a failure.
    CHECK(store::Delete("presets", "a"));
  }

  // 2. Keys differing only by case must stay distinct. A filename-per-key
  //    store collapses these on macOS's case-insensitive filesystem, so a
  //    Tone3000 id like "AbC" would silently return "abc"'s model.
  {
    CHECK(store::Put("assets", "AbC", "upper"));
    CHECK(store::Put("assets", "abc", "lower"));
    CHECK(store::Get("assets", "AbC").value_or("") == "upper");
    CHECK(store::Get("assets", "abc").value_or("") == "lower");
  }

  // 3. A key must never be able to escape its store directory.
  {
    CHECK(store::Put("assets", "../../escape", "contained"));
    CHECK(store::Get("assets", "../../escape").value_or("") == "contained");
    CHECK(!fs::exists(root / "escape"));
    CHECK(!fs::exists(root.parent_path() / "escape"));
    // Everything written so far lives under the store's own directory.
    CHECK(fs::exists(root / "data" / "assets"));
  }

  // 4. Keys longer than any filesystem allows in a filename.
  {
    const std::string long_key(4096, 'k');
    CHECK(store::Put("assets", long_key, "long"));
    CHECK(store::Get("assets", long_key).value_or("") == "long");
  }

  // 5. Binary values: NULs, newlines and high bytes must survive verbatim.
  //    Newlines matter most — the key occupies the file's first line, so a
  //    value containing '\n' is exactly where a sloppy line-based read breaks.
  {
    std::string blob;
    blob.push_back('\0');
    blob += "line one\nline two\r\n";
    blob.push_back(static_cast<char>(0xFF));
    blob.push_back('\0');
    blob += "tail";
    CHECK(store::Put("assets", "binary", blob));
    const auto got = store::Get("assets", "binary");
    CHECK(got.has_value());
    CHECK(got.value_or("").size() == blob.size());
    CHECK(got.value_or("") == blob);
  }

  // 6. Keys with newlines: the key line is encoded, so these round-trip too
  //    and stay distinct from a key that merely looks similar.
  {
    CHECK(store::Put("assets", "we\nird%key", "v1"));
    CHECK(store::Get("assets", "we\nird%key").value_or("") == "v1");
    // A key that merely looks similar is a different record.
    CHECK(!store::Get("assets", "weird%key").has_value());
  }

  // 7. Keys() and Values() cover exactly what was stored.
  {
    CHECK(store::Clear("listing"));
    CHECK(store::Put("listing", "k1", "v1"));
    CHECK(store::Put("listing", "k2", "v2"));
    CHECK(store::Put("listing", "k3", "v3"));
    auto keys = store::Keys("listing");
    std::sort(keys.begin(), keys.end());
    CHECK(keys.size() == 3);
    CHECK(keys.size() == 3 && keys[0] == "k1" && keys[1] == "k2" && keys[2] == "k3");
    auto values = store::Values("listing");
    std::sort(values.begin(), values.end());
    CHECK(values.size() == 3);
    CHECK(values.size() == 3 && values[0] == "v1" && values[1] == "v2" && values[2] == "v3");
    // Listing a store that was never written is empty, not an error.
    CHECK(store::Keys("never-written").empty());
    CHECK(store::Values("never-written").empty());
  }

  // 8. Clear empties one store and leaves the others alone.
  {
    CHECK(store::Put("keepme", "k", "v"));
    CHECK(store::Clear("listing"));
    CHECK(store::Keys("listing").empty());
    CHECK(store::Get("keepme", "k").value_or("") == "v");
  }

  // 9. Store names are restricted, so a caller cannot use one to walk the
  //    filesystem either.
  {
    CHECK(store::IsValidStoreName("presets"));
    CHECK(store::IsValidStoreName("preset-bank_2"));
    CHECK(!store::IsValidStoreName(""));
    CHECK(!store::IsValidStoreName("../etc"));
    CHECK(!store::IsValidStoreName("Presets"));   // uppercase folds on macOS
    CHECK(!store::IsValidStoreName("a/b"));
    CHECK(!store::Put("../etc", "k", "v"));
    CHECK(!store::Get("../etc", "k").has_value());
  }

  // 10. PathFor()/ValueOffsetInFile() describe the file the HTTP server sends
  //     for an asset: the value starts past the key line, so serving from
  //     offset 0 would prepend the key to every model the UI fetches.
  {
    CHECK(store::Put("assets", "served", "PAYLOAD"));
    const std::string path = store::PathFor("assets", "served");
    CHECK(!path.empty());
    CHECK(fs::exists(path));
    const auto offset = store::ValueOffsetInFile("assets", "served");
    CHECK(offset.has_value());
    std::ifstream ifs(path, std::ios::binary);
    ifs.seekg(static_cast<std::streamoff>(offset.value_or(0)));
    const std::string tail((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
    CHECK(tail == "PAYLOAD");
    CHECK(fs::file_size(path) == offset.value_or(0) + 7);
    // A record that does not exist has neither.
    CHECK(store::PathFor("assets", "absent").empty());
    CHECK(!store::ValueOffsetInFile("assets", "absent").has_value());
  }

  fs::remove_all(root, ec);
  if (fails == 0) std::printf("app_storage: all checks passed\n");
  return fails == 0 ? 0 : 1;
}
