#include "openaxe/storage_bridge.h"

#include <cstdint>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "openaxe/app_storage.h"

using nlohmann::json;

namespace openaxe::storage_bridge {

const char* const kAssetStore = "assets";
const char* const kAssetTypeStore = "asset-types";

namespace {

std::string JsonError(const std::string& message) {
  return json{{"ok", false}, {"error", message}}.dump();
}

// The webview posts args as an array whose first element is the argument
// object, the same shape the other handlers already parse.
json FirstArg(const std::string& argsJson) {
  json parsed = json::parse(argsJson, nullptr, /*allow_exceptions=*/false);
  if (parsed.is_discarded() || !parsed.is_array() || parsed.empty()) return json::object();
  if (!parsed[0].is_object()) return json::object();
  return parsed[0];
}

constexpr const char* kB64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string Base64Encode(const std::string& bytes) {
  std::string out;
  out.reserve((bytes.size() + 2) / 3 * 4);
  size_t i = 0;
  for (; i + 2 < bytes.size(); i += 3) {
    const uint32_t v = (static_cast<uint8_t>(bytes[i]) << 16) |
                       (static_cast<uint8_t>(bytes[i + 1]) << 8) |
                       static_cast<uint8_t>(bytes[i + 2]);
    out.push_back(kB64[(v >> 18) & 0x3F]);
    out.push_back(kB64[(v >> 12) & 0x3F]);
    out.push_back(kB64[(v >> 6) & 0x3F]);
    out.push_back(kB64[v & 0x3F]);
  }
  if (i + 1 == bytes.size()) {
    const uint32_t v = static_cast<uint32_t>(static_cast<uint8_t>(bytes[i])) << 16;
    out.push_back(kB64[(v >> 18) & 0x3F]);
    out.push_back(kB64[(v >> 12) & 0x3F]);
    out += "==";
  } else if (i + 2 == bytes.size()) {
    const uint32_t v = (static_cast<uint32_t>(static_cast<uint8_t>(bytes[i])) << 16) |
                       (static_cast<uint32_t>(static_cast<uint8_t>(bytes[i + 1])) << 8);
    out.push_back(kB64[(v >> 18) & 0x3F]);
    out.push_back(kB64[(v >> 12) & 0x3F]);
    out.push_back(kB64[(v >> 6) & 0x3F]);
    out.push_back('=');
  }
  return out;
}

int Base64Value(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

// Tolerates whitespace and missing padding; '=' ends the payload. Returns
// false on a character that is not valid base64 at all, so a truncated or
// corrupted payload is reported rather than silently stored short.
bool Base64Decode(const std::string& text, std::string* out) {
  out->clear();
  out->reserve(text.size() / 4 * 3);
  uint32_t buffer = 0;
  int bits = 0;
  for (char c : text) {
    if (c == '=' ) break;
    if (c == '\n' || c == '\r' || c == ' ' || c == '\t') continue;
    const int value = Base64Value(c);
    if (value < 0) return false;
    buffer = (buffer << 6) | static_cast<uint32_t>(value);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out->push_back(static_cast<char>((buffer >> bits) & 0xFF));
    }
  }
  return true;
}

}  // namespace

std::string HandleGet(const std::string& argsJson) {
  try {
    const json o = FirstArg(argsJson);
    const std::string store = o.value("store", "");
    const std::string key = o.value("key", "");
    if (!app_storage::IsValidStoreName(store)) return JsonError("storageGet: invalid store");
    const auto value = app_storage::Get(store, key);
    // A miss is the ordinary case, not an error.
    if (!value) return json{{"ok", true}, {"value", nullptr}}.dump();
    return json{{"ok", true}, {"value", *value}}.dump();
  } catch (...) {
    return JsonError("storageGet failed");
  }
}

std::string HandlePut(const std::string& argsJson) {
  try {
    const json o = FirstArg(argsJson);
    const std::string store = o.value("store", "");
    const std::string key = o.value("key", "");
    const std::string value = o.value("value", "");
    if (!app_storage::IsValidStoreName(store)) return JsonError("storagePut: invalid store");
    if (key.empty()) return JsonError("storagePut: empty key");
    std::string error;
    if (!app_storage::Put(store, key, value, &error)) return JsonError("storagePut: " + error);
    return json{{"ok", true}}.dump();
  } catch (...) {
    return JsonError("storagePut failed");
  }
}

std::string HandleDelete(const std::string& argsJson) {
  try {
    const json o = FirstArg(argsJson);
    const std::string store = o.value("store", "");
    const std::string key = o.value("key", "");
    if (!app_storage::IsValidStoreName(store)) return JsonError("storageDelete: invalid store");
    std::string error;
    if (!app_storage::Delete(store, key, &error)) return JsonError("storageDelete: " + error);
    return json{{"ok", true}}.dump();
  } catch (...) {
    return JsonError("storageDelete failed");
  }
}

std::string HandleKeys(const std::string& argsJson) {
  try {
    const json o = FirstArg(argsJson);
    const std::string store = o.value("store", "");
    if (!app_storage::IsValidStoreName(store)) return JsonError("storageKeys: invalid store");
    return json{{"ok", true}, {"keys", app_storage::Keys(store)}}.dump();
  } catch (...) {
    return JsonError("storageKeys failed");
  }
}

std::string HandleValues(const std::string& argsJson) {
  try {
    const json o = FirstArg(argsJson);
    const std::string store = o.value("store", "");
    if (!app_storage::IsValidStoreName(store)) return JsonError("storageValues: invalid store");
    return json{{"ok", true}, {"values", app_storage::Values(store)}}.dump();
  } catch (...) {
    return JsonError("storageValues failed");
  }
}

std::string HandleClear(const std::string& argsJson) {
  try {
    const json o = FirstArg(argsJson);
    const std::string store = o.value("store", "");
    if (!app_storage::IsValidStoreName(store)) return JsonError("storageClear: invalid store");
    std::string error;
    if (!app_storage::Clear(store, &error)) return JsonError("storageClear: " + error);
    return json{{"ok", true}}.dump();
  } catch (...) {
    return JsonError("storageClear failed");
  }
}

std::string HandleAssetPut(const std::string& argsJson) {
  try {
    const json o = FirstArg(argsJson);
    const std::string key = o.value("key", "");
    const std::string encoded = o.value("base64", "");
    const std::string type = o.value("type", "");
    if (key.empty()) return JsonError("assetPut: empty key");
    std::string bytes;
    if (!Base64Decode(encoded, &bytes)) return JsonError("assetPut: could not decode the payload");
    std::string error;
    if (!app_storage::Put(kAssetStore, key, bytes, &error)) {
      return JsonError("assetPut: " + error);
    }
    // The MIME type rides alongside rather than inside the blob, because the
    // blob is served to the webview verbatim over /__asset/<key> and the
    // export bundle records the type it was stored with.
    app_storage::Put(kAssetTypeStore, key, type, nullptr);
    return json{{"ok", true}, {"bytes", bytes.size()}}.dump();
  } catch (...) {
    return JsonError("assetPut failed");
  }
}

std::string HandleAssetGet(const std::string& argsJson) {
  try {
    const json o = FirstArg(argsJson);
    const std::string key = o.value("key", "");
    const auto bytes = app_storage::Get(kAssetStore, key);
    if (!bytes) return json{{"ok", true}, {"base64", nullptr}}.dump();
    return json{{"ok", true},
                {"base64", Base64Encode(*bytes)},
                {"type", app_storage::Get(kAssetTypeStore, key).value_or("")}}
        .dump();
  } catch (...) {
    return JsonError("assetGet failed");
  }
}

std::string HandleAssetDelete(const std::string& argsJson) {
  try {
    const json o = FirstArg(argsJson);
    const std::string key = o.value("key", "");
    std::string error;
    if (!app_storage::Delete(kAssetStore, key, &error)) return JsonError("assetDelete: " + error);
    app_storage::Delete(kAssetTypeStore, key, nullptr);
    return json{{"ok", true}}.dump();
  } catch (...) {
    return JsonError("assetDelete failed");
  }
}

std::string HandleAssetHas(const std::string& argsJson) {
  try {
    const json o = FirstArg(argsJson);
    const std::string key = o.value("key", "");
    // Cheaper than HandleAssetGet: this resolves the path without reading or
    // base64-encoding the file, and "is it cached?" is asked per library row.
    const bool present = !app_storage::PathFor(kAssetStore, key).empty();
    return json{{"ok", true}, {"present", present}}.dump();
  } catch (...) {
    return JsonError("assetHas failed");
  }
}

std::string HandleAssetKeys(const std::string& /*argsJson*/) {
  try {
    return json{{"ok", true}, {"keys", app_storage::Keys(kAssetStore)}}.dump();
  } catch (...) {
    return JsonError("assetKeys failed");
  }
}

}  // namespace openaxe::storage_bridge
