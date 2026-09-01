#pragma once

#include <optional>
#include <string>
#include <vector>

namespace openaxe::app_storage {

// Shared on-disk store for everything the app persists locally: presets,
// scenes, the preset bank, MIDI mappings, Tone3000 library metadata, the
// factory pack's model/IR blobs and the UI's own preferences.
//
// This exists for the same reason secure_storage does, and it is worth
// stating plainly because it is not obvious: the webview's own localStorage
// and IndexedDB are useless to us.
//
//   1. The UI server binds an ephemeral port, so the webview's origin
//      (http://127.0.0.1:<port>) is different on every single launch, and
//      both localStorage and IndexedDB are scoped to an origin. Everything
//      written last launch is still on disk, under an origin nothing will
//      ever visit again. That is why the factory pack appeared to need
//      reinstalling every time the app was opened (issue #300).
//   2. Even with a fixed port, WKWebView/WebView2 scope their website data
//      to the *host application*. The desktop app's data lives under
//      ~/Library/WebKit/com.openaxe.desktop and the plugin's under whatever
//      the DAW's bundle id is (com.cockos.reaper, and a different one per
//      DAW). A stable origin fixes (1) but can never make the desktop app
//      and the plugin see one library.
//
// So the store lives in the filesystem, in one place both shells can reach,
// and the UI talks to it over the openAxe.storage* bridge calls.
//
// Layout, under DataDir():
//
//   <store>/<hash>          one record; see the file format below
//
// `store` is a logical namespace ("presets", "assets", "scenes", …) and is
// restricted to [a-z0-9_-] so it is always a safe directory name.
//
// File format is two parts so that a key needs no reversible encoding into
// a filename:
//
//   <percent-encoded key>\n<value bytes verbatim>
//
// The filename is a hash of the key, which sidesteps case-insensitive
// filesystems (macOS would collide "AbC" with "abc"), filename length
// limits, and path traversal via a crafted key, all at once. The key is
// re-checked against the first line on read, and a colliding hash probes to
// <hash>-1, <hash>-2, … on write, so a collision costs a little work rather
// than the wrong record.
//
// Values are opaque bytes: JSON for records, raw file contents for blobs.
// Nothing here parses them.
//
// Concurrency: writes go to a temp file and are renamed into place, which is
// atomic on POSIX and on NTFS. Several processes may have the store open at
// once — the desktop app, and one instance per plugin per DAW — so a reader
// always sees either the old record or the new one, never a half-written
// one. There is no locking beyond that and no change notification: last
// writer wins, and a shell picks up another's writes the next time it reads.

// Root directory of the store. Honours OPENAXE_DATA_DIR when set, which is
// what the tests use; otherwise the platform's per-user application data
// directory. Created on first write, not here.
std::string DataDir();

// Writes `value` under `key` in `store`, replacing any existing record.
// Returns false (and sets *error, if given) on an I/O failure.
bool Put(const std::string& store, const std::string& key, const std::string& value,
         std::string* error = nullptr);

// Returns the stored value, or nullopt when there is no such record — the
// ordinary cache-miss case, not a failure.
std::optional<std::string> Get(const std::string& store, const std::string& key,
                               std::string* error = nullptr);

// Removes a record. A no-op (still true) when there was nothing stored.
bool Delete(const std::string& store, const std::string& key, std::string* error = nullptr);

// Every key in `store`, in unspecified order. Empty when the store does not
// exist yet.
std::vector<std::string> Keys(const std::string& store);

// Every value in `store`, in unspecified order. Mirrors IndexedDB's
// getAll(), which is what the preset and library lists are built from.
std::vector<std::string> Values(const std::string& store);

// Removes every record in `store`.
bool Clear(const std::string& store, std::string* error = nullptr);

// Record count and total value bytes in `store`, from file sizes alone —
// nothing is read or decoded. The Settings dialog shows this for the model/IR
// cache, and reading every capture back just to total them up would mean
// pulling the whole cache through the bridge.
struct StoreStats {
  unsigned long long count = 0;
  unsigned long long bytes = 0;
};
StoreStats Stats(const std::string& store);

// Absolute path of the file backing a record, whether or not it exists. The
// HTTP server uses this to serve asset blobs to the webview directly,
// skipping a base64 round-trip through the bridge — see
// ValueOffsetInFile() for the one wrinkle that involves.
std::string PathFor(const std::string& store, const std::string& key);

// Byte offset at which the value starts within the file at PathFor(), i.e.
// just past the key line. Returns nullopt when the record does not exist.
// Serving a blob over HTTP means sending the file from this offset, not
// from its start.
std::optional<unsigned long long> ValueOffsetInFile(const std::string& store,
                                                    const std::string& key);

// True when `store` is an acceptable namespace name ([a-z0-9_-], non-empty).
// Exposed so the bridge can reject a bad name with a clear error rather than
// failing obscurely later.
bool IsValidStoreName(const std::string& store);

}  // namespace openaxe::app_storage
