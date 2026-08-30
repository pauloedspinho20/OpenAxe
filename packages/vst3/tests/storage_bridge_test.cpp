// The window.openAxe.storage*/asset* handlers, which the desktop shell and
// the plugin both bind.
//
// The reason this test exists: the two shells hand the handlers different
// argument shapes. webview::bind (desktop) passes the JS arguments as an
// array, `[{"store":"prefs"}]`; the plugin's dispatch passes the args value
// out of the posted message, a bare object, `{"store":"prefs"}`. The handlers
// originally accepted only the array, so every storage call inside a plugin
// failed with "invalid store" — and since the UI swallows storage failures,
// the app booted and behaved as though the shared library simply had nothing
// in it. Nothing was broken loudly enough to notice.

#include "openaxe/storage_bridge.h"

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <string>

#include <nlohmann/json.hpp>

namespace fs = std::filesystem;
namespace sb = openaxe::storage_bridge;
using nlohmann::json;

int fails = 0;
#define CHECK(c) do { if(!(c)) { std::fprintf(stderr, "FAIL: %s (line %d)\n", #c, __LINE__); ++fails; } } while(0)

static void SetDataDir(const std::string& dir) {
#if defined(_WIN32)
  _putenv_s("OPENAXE_DATA_DIR", dir.c_str());
#else
  ::setenv("OPENAXE_DATA_DIR", dir.c_str(), 1);
#endif
}

static json Parse(const std::string& s) {
  json j = json::parse(s, nullptr, false);
  return j.is_discarded() ? json::object() : j;
}

int main() {
  const fs::path root = fs::temp_directory_path() / "openaxe_storage_bridge_test";
  std::error_code ec;
  fs::remove_all(root, ec);
  SetDataDir(root.string());

  // 1. Both argument shapes must work, because both shells are real.
  {
    // Plugin shape: a bare object.
    CHECK(Parse(sb::HandlePut(R"({"store":"presets","key":"k1","value":"v1"})")).value("ok", false));
    CHECK(Parse(sb::HandleGet(R"({"store":"presets","key":"k1"})")).value("value", "") == "v1");

    // Desktop shape: an array whose first element is the object.
    CHECK(Parse(sb::HandlePut(R"([{"store":"presets","key":"k2","value":"v2"}])")).value("ok", false));
    CHECK(Parse(sb::HandleGet(R"([{"store":"presets","key":"k2"}])")).value("value", "") == "v2");

    // And each shell can read what the other wrote — the whole point of one
    // shared library on disk.
    CHECK(Parse(sb::HandleGet(R"({"store":"presets","key":"k2"})")).value("value", "") == "v2");
    CHECK(Parse(sb::HandleGet(R"([{"store":"presets","key":"k1"}])")).value("value", "") == "v1");
  }

  // 2. Listings return arrays under the keys the UI reads. A response missing
  //    them is what surfaced as "undefined is not an object" in the editor.
  {
    const json keys = Parse(sb::HandleKeys(R"({"store":"presets"})"));
    CHECK(keys.value("ok", false));
    CHECK(keys.contains("keys") && keys["keys"].is_array());
    CHECK(keys["keys"].size() == 2);

    const json values = Parse(sb::HandleValues(R"({"store":"presets"})"));
    CHECK(values.value("ok", false));
    CHECK(values.contains("values") && values["values"].is_array());
    CHECK(values["values"].size() == 2);

    // Same for the array shape.
    const json keys2 = Parse(sb::HandleKeys(R"([{"store":"presets"}])"));
    CHECK(keys2.contains("keys") && keys2["keys"].size() == 2);
  }

  // 3. An empty store still answers with an array, not with nothing.
  {
    const json values = Parse(sb::HandleValues(R"({"store":"never-written"})"));
    CHECK(values.value("ok", false));
    CHECK(values.contains("values") && values["values"].is_array() && values["values"].empty());
  }

  // 4. Delete and clear.
  {
    CHECK(Parse(sb::HandleDelete(R"({"store":"presets","key":"k1"})")).value("ok", false));
    CHECK(Parse(sb::HandleGet(R"({"store":"presets","key":"k1"})"))["value"].is_null());
    CHECK(Parse(sb::HandleClear(R"({"store":"presets"})")).value("ok", false));
    CHECK(Parse(sb::HandleKeys(R"({"store":"presets"})"))["keys"].empty());
  }

  // 5. Asset blobs round-trip through base64, keep their MIME type, and report
  //    presence without reading the bytes back.
  {
    // "OpenAxe" in base64.
    CHECK(Parse(sb::HandleAssetPut(
                    R"({"key":"model-1","base64":"T3BlbkF4ZQ==","type":"application/json"})"))
              .value("ok", false));
    const json got = Parse(sb::HandleAssetGet(R"({"key":"model-1"})"));
    CHECK(got.value("base64", "") == "T3BlbkF4ZQ==");
    CHECK(got.value("type", "") == "application/json");
    CHECK(Parse(sb::HandleAssetHas(R"({"key":"model-1"})")).value("present", false));
    CHECK(!Parse(sb::HandleAssetHas(R"({"key":"absent"})")).value("present", true));

    const json stats = Parse(sb::HandleAssetStats("{}"));
    CHECK(stats.value("count", 0) == 1);
    CHECK(stats.value("bytes", 0) == 7);  // "OpenAxe"

    // A miss is a null payload, not an error.
    const json miss = Parse(sb::HandleAssetGet(R"({"key":"absent"})"));
    CHECK(miss.value("ok", false));
    CHECK(miss["base64"].is_null());

    CHECK(Parse(sb::HandleAssetClear("{}")).value("ok", false));
    CHECK(Parse(sb::HandleAssetStats("{}")).value("count", -1) == 0);
    // Clearing assets must take the MIME types with it rather than orphaning
    // them in a parallel store.
    CHECK(Parse(sb::HandleAssetGet(R"({"key":"model-1"})"))["base64"].is_null());
  }

  // 6. Malformed input is refused, not crashed on.
  {
    CHECK(!Parse(sb::HandlePut(R"({"store":"../etc","key":"k","value":"v"})")).value("ok", true));
    CHECK(!Parse(sb::HandlePut(R"({"store":"presets","key":"","value":"v"})")).value("ok", true));
    CHECK(!Parse(sb::HandleGet("not json at all")).value("ok", true));
    CHECK(!Parse(sb::HandleValues("[]")).value("ok", true));
    CHECK(!Parse(sb::HandleAssetPut(R"({"key":"k","base64":"!!!not base64!!!"})")).value("ok", true));
  }

  fs::remove_all(root, ec);
  if (fails == 0) std::printf("storage_bridge: all checks passed\n");
  return fails == 0 ? 0 : 1;
}
