#pragma once

#include <string>

namespace openaxe::storage_bridge {

// The window.openAxe.storage* / asset* handlers, shared verbatim by the
// desktop shell and the plugin so both see one library on disk (issue #300
// follow-up). The bridges differ in how they dispatch, not in what these do,
// so the bodies live here rather than being written twice — and once J2
// merges VstBridge and StudioBridge there is nothing left to merge here.
//
// Each takes the args JSON the webview posted (an array whose first element is
// the argument object, matching the existing handlers) and returns the JSON
// string to resolve the caller's promise with. None of them throw.
//
// Records hold text (the UI stores JSON documents). Assets hold arbitrary
// bytes — .nam captures and IR wavs — which is why they are a separate pair
// of calls carrying base64 rather than going through the record calls.

std::string HandleGet(const std::string& argsJson);
std::string HandlePut(const std::string& argsJson);
std::string HandleDelete(const std::string& argsJson);
std::string HandleKeys(const std::string& argsJson);
std::string HandleValues(const std::string& argsJson);
std::string HandleClear(const std::string& argsJson);

// Asset blobs. HandleAssetGet returns base64 and exists only as a fallback
// for when the UI has no loopback server to fetch from (the OPENAXE_UI_URL
// dev-server path); normally the UI fetches /__asset/<key> over HTTP instead,
// which streams and avoids inflating every model by a third.
std::string HandleAssetPut(const std::string& argsJson);
std::string HandleAssetGet(const std::string& argsJson);
std::string HandleAssetDelete(const std::string& argsJson);
std::string HandleAssetHas(const std::string& argsJson);
std::string HandleAssetKeys(const std::string& argsJson);

// The store name asset blobs live in, shared with the HTTP server so it can
// resolve /__asset/<key> against the same place HandleAssetPut wrote to.
extern const char* const kAssetStore;

// Where an asset's MIME type is kept, keyed the same way. Separate from the
// blob so the blob stays byte-for-byte what was downloaded.
extern const char* const kAssetTypeStore;

}  // namespace openaxe::storage_bridge
