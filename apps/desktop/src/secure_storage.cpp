#include "secure_storage.h"

// Debug builds (any platform, including a locally-built macOS/Windows dev
// binary) deliberately skip the real OS keychain/credential manager below
// and fall through to the plain-file backend instead - see secure_storage.h
// for why. An ad-hoc/dev code signature changes on every rebuild, and both
// Keychain Services and Credential Manager tie access grants to that
// signature, so a Debug developer would otherwise hit a fresh "allow access"
// prompt after every single rebuild. Release builds (the only ones that
// ever ship) are unaffected - their signature is stable, so this trade only
// ever applies during local development.
#if !defined(NDEBUG) || (!defined(__APPLE__) && !defined(_WIN32))
#define NAM_SECURE_STORAGE_USE_PLAIN_FILE 1
#endif

#if defined(NAM_SECURE_STORAGE_USE_PLAIN_FILE)
#include <cstdlib>
#include <filesystem>
#include <fstream>
#ifndef _WIN32
#include <sys/stat.h>
#endif
#elif defined(__APPLE__)
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#elif defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <wincred.h>
#endif

namespace nam_desktop::secure_storage {

namespace {
constexpr const char* kServiceName = "NAM Web Studio";
}  // namespace

#if defined(NAM_SECURE_STORAGE_USE_PLAIN_FILE)

namespace {
// NOTE: this is a plain file, not a real OS keychain/credential manager -
// see the header and the NDEBUG note above for why Debug builds land here
// on every platform. On POSIX it's chmod'd to owner-only; on Windows it
// relies on %LOCALAPPDATA%'s own per-user ACL (no chmod equivalent). Either
// way it's readable by any other process running as the same OS user, which
// a real keychain would not allow - fine for a developer's own refresh
// token during local iteration, not something to ship.
std::filesystem::path SecretsDir() {
#if defined(_WIN32)
  const char* local_app_data = std::getenv("LOCALAPPDATA");
  const std::filesystem::path base =
      local_app_data && *local_app_data ? std::filesystem::path(local_app_data) : ".";
#else
  const char* xdg = std::getenv("XDG_DATA_HOME");
  const char* home = std::getenv("HOME");
  const std::filesystem::path base = xdg && *xdg
                                          ? std::filesystem::path(xdg)
                                          : std::filesystem::path(home ? home : ".") / ".local" /
                                                "share";
#endif
  return base / "nam-web-studio" / "secrets";
}

std::filesystem::path PathFor(const std::string& key) { return SecretsDir() / key; }
}  // namespace

bool Store(const std::string& key, const std::string& value, std::string* error) {
  std::error_code ec;
  std::filesystem::create_directories(SecretsDir(), ec);
  const auto path = PathFor(key);
  std::ofstream ofs(path, std::ios::binary | std::ios::trunc);
  if (!ofs) {
    if (error) *error = "failed to open " + path.string();
    return false;
  }
  ofs << value;
  ofs.close();
#ifndef _WIN32
  ::chmod(path.c_str(), S_IRUSR | S_IWUSR);
#endif
  return true;
}

std::optional<std::string> Load(const std::string& key, std::string* /*error*/) {
  std::ifstream ifs(PathFor(key), std::ios::binary);
  if (!ifs) return std::nullopt;
  return std::string(std::istreambuf_iterator<char>(ifs), std::istreambuf_iterator<char>());
}

bool Delete(const std::string& key, std::string* /*error*/) {
  std::error_code ec;
  std::filesystem::remove(PathFor(key), ec);
  return true;
}

#elif defined(__APPLE__)

namespace {
CFStringRef CFStringFromStd(const std::string& s) {
  return CFStringCreateWithBytes(kCFAllocatorDefault, reinterpret_cast<const UInt8*>(s.data()),
                                  static_cast<CFIndex>(s.size()), kCFStringEncodingUTF8, false);
}
}  // namespace

bool Store(const std::string& key, const std::string& value, std::string* error) {
  CFStringRef service = CFStringFromStd(kServiceName);
  CFStringRef account = CFStringFromStd(key);
  CFDataRef data = CFDataCreate(kCFAllocatorDefault, reinterpret_cast<const UInt8*>(value.data()),
                                static_cast<CFIndex>(value.size()));

  // Delete-then-add rather than SecItemUpdate: this runs once per token
  // refresh at most, not a hot path, and it's simpler to reason about than
  // update-or-add branching.
  {
    const void* keys[] = {kSecClass, kSecAttrService, kSecAttrAccount};
    const void* values[] = {kSecClassGenericPassword, service, account};
    CFDictionaryRef query = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 3,
                                                &kCFTypeDictionaryKeyCallBacks,
                                                &kCFTypeDictionaryValueCallBacks);
    SecItemDelete(query);
    CFRelease(query);
  }

  const void* add_keys[] = {kSecClass, kSecAttrService, kSecAttrAccount, kSecValueData,
                            kSecAttrAccessible};
  // AfterFirstUnlock (not the "ThisDeviceOnly" siblings some sample code
  // uses): a background/no-sound launch right after boot but before the
  // user has unlocked the session should still be able to read it back.
  const void* add_values[] = {kSecClassGenericPassword, service, account, data,
                              kSecAttrAccessibleAfterFirstUnlock};
  CFDictionaryRef add_query = CFDictionaryCreate(kCFAllocatorDefault, add_keys, add_values, 5,
                                                 &kCFTypeDictionaryKeyCallBacks,
                                                 &kCFTypeDictionaryValueCallBacks);
  const OSStatus status = SecItemAdd(add_query, nullptr);

  CFRelease(service);
  CFRelease(account);
  CFRelease(data);
  CFRelease(add_query);

  if (status != errSecSuccess) {
    if (error) *error = "SecItemAdd failed (" + std::to_string(status) + ")";
    return false;
  }
  return true;
}

std::optional<std::string> Load(const std::string& key, std::string* error) {
  CFStringRef service = CFStringFromStd(kServiceName);
  CFStringRef account = CFStringFromStd(key);

  const void* keys[] = {kSecClass, kSecAttrService, kSecAttrAccount, kSecReturnData,
                        kSecMatchLimit};
  const void* values[] = {kSecClassGenericPassword, service, account, kCFBooleanTrue,
                          kSecMatchLimitOne};
  CFDictionaryRef query = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 5,
                                              &kCFTypeDictionaryKeyCallBacks,
                                              &kCFTypeDictionaryValueCallBacks);

  CFTypeRef result = nullptr;
  const OSStatus status = SecItemCopyMatching(query, &result);
  CFRelease(service);
  CFRelease(account);
  CFRelease(query);

  if (status == errSecItemNotFound) return std::nullopt;
  if (status != errSecSuccess || !result) {
    if (error) *error = "SecItemCopyMatching failed (" + std::to_string(status) + ")";
    return std::nullopt;
  }

  CFDataRef data = static_cast<CFDataRef>(result);
  std::string value(reinterpret_cast<const char*>(CFDataGetBytePtr(data)),
                    static_cast<size_t>(CFDataGetLength(data)));
  CFRelease(result);
  return value;
}

bool Delete(const std::string& key, std::string* error) {
  CFStringRef service = CFStringFromStd(kServiceName);
  CFStringRef account = CFStringFromStd(key);
  const void* keys[] = {kSecClass, kSecAttrService, kSecAttrAccount};
  const void* values[] = {kSecClassGenericPassword, service, account};
  CFDictionaryRef query = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 3,
                                              &kCFTypeDictionaryKeyCallBacks,
                                              &kCFTypeDictionaryValueCallBacks);
  const OSStatus status = SecItemDelete(query);
  CFRelease(service);
  CFRelease(account);
  CFRelease(query);
  if (status != errSecSuccess && status != errSecItemNotFound) {
    if (error) *error = "SecItemDelete failed (" + std::to_string(status) + ")";
    return false;
  }
  return true;
}

#else  // _WIN32, Release (NAM_SECURE_STORAGE_USE_PLAIN_FILE excluded this already for Debug)

namespace {
// CRED_TYPE_GENERIC credentials are keyed by an app-chosen "target name"
// string - namespace it by service so this can't collide with an unrelated
// app's credentials on the same machine. Keys passed in here are always our
// own ASCII identifiers (e.g. "tone3000_refresh_token"), never user data.
std::wstring TargetNameFor(const std::string& key) {
  const std::string combined = std::string(kServiceName) + ":" + key;
  return std::wstring(combined.begin(), combined.end());
}
}  // namespace

bool Store(const std::string& key, const std::string& value, std::string* error) {
  const std::wstring target = TargetNameFor(key);
  CREDENTIALW cred = {};
  cred.Type = CRED_TYPE_GENERIC;
  cred.TargetName = const_cast<LPWSTR>(target.c_str());
  cred.CredentialBlobSize = static_cast<DWORD>(value.size());
  cred.CredentialBlob = reinterpret_cast<LPBYTE>(const_cast<char*>(value.data()));
  cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
  if (!CredWriteW(&cred, 0)) {
    if (error) *error = "CredWriteW failed (" + std::to_string(GetLastError()) + ")";
    return false;
  }
  return true;
}

std::optional<std::string> Load(const std::string& key, std::string* error) {
  const std::wstring target = TargetNameFor(key);
  PCREDENTIALW cred = nullptr;
  if (!CredReadW(target.c_str(), CRED_TYPE_GENERIC, 0, &cred)) {
    const DWORD err = GetLastError();
    if (err == ERROR_NOT_FOUND) return std::nullopt;
    if (error) *error = "CredReadW failed (" + std::to_string(err) + ")";
    return std::nullopt;
  }
  std::string value(reinterpret_cast<const char*>(cred->CredentialBlob), cred->CredentialBlobSize);
  CredFree(cred);
  return value;
}

bool Delete(const std::string& key, std::string* error) {
  const std::wstring target = TargetNameFor(key);
  if (!CredDeleteW(target.c_str(), CRED_TYPE_GENERIC, 0)) {
    const DWORD err = GetLastError();
    if (err == ERROR_NOT_FOUND) return true;
    if (error) *error = "CredDeleteW failed (" + std::to_string(err) + ")";
    return false;
  }
  return true;
}

#endif

}  // namespace nam_desktop::secure_storage
