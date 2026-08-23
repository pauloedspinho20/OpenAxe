#pragma once

#include <optional>
#include <string>

namespace openaxe_desktop::secure_storage {

// Small per-key secret store for the desktop shell (issue #146): persists
// the Tone3000 refresh token across app restarts without going through the
// webview's own storage, which can't survive a restart here - the UI server
// (and therefore the webview's origin) binds a fresh ephemeral port every
// launch, and sessionStorage/localStorage are both scoped to that origin.
//
// Backed by the platform's real credential store where one exists:
//   - macOS:   Keychain Services (Security.framework).
//   - Windows: Credential Manager (wincred.h).
//   - Linux:   a permission-restricted file under $XDG_DATA_HOME - Secret
//              Service/libsecret isn't wired up (yet), so this is NOT
//              equivalent to a real keychain there; see the .cpp.
//
// Debug builds skip the macOS/Windows keychain entirely and use that same
// plain-file fallback, regardless of platform - see the NDEBUG check at the
// top of the .cpp. A locally-built dev binary's ad-hoc code signature
// changes every rebuild, and both Keychain Services and Credential Manager
// gate access on that signature, so without this a developer would hit a
// fresh OS "allow access" prompt after every single rebuild. Only Release
// builds (the only ones that ever ship) use the real keychain/credential
// manager.

// Persists `value` under `key`, scoped to this app. Overwrites any existing
// value for the same key. Returns false (and sets *error, if given) only on
// an unexpected platform failure.
bool Store(const std::string& key, const std::string& value, std::string* error = nullptr);

// Returns the stored value, or std::nullopt if there is none - that's the
// ordinary "never connected" case, not a failure. *error is set only on an
// unexpected platform failure while looking it up.
std::optional<std::string> Load(const std::string& key, std::string* error = nullptr);

// Removes any stored value for `key`. A no-op (still returns true) if there
// was nothing stored.
bool Delete(const std::string& key, std::string* error = nullptr);

}  // namespace openaxe_desktop::secure_storage
