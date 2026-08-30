#pragma once

// Which origins may host the privileged UI (issue #71; unified for #300 J1).
//
// The webview that loads this URL gets the full window.openAxe bridge — direct
// access to the DSP graph, the filesystem pickers and the keychain. Only our
// own loopback origins may ever receive that.
//
// This lived in three places: apps/desktop/src/bridge.cpp,
// packages/vst3/src/editor.cpp, and again as an inline lambda inside
// packages/vst3/src/plugin.cpp's layout function. The copies had already
// drifted on userinfo handling (one stripped it, one rejected it), which is
// exactly how a security check rots. One implementation, one test suite.

#include <string>

namespace openaxe {

// True only for loopback http(s) origins: 127.0.0.1, localhost, [::1], ::1.
//
// Userinfo is rejected outright rather than parsed away. Strictly,
// "http://evil.example@127.0.0.1/" does have 127.0.0.1 as its host, so
// stripping is correct URL parsing — but no dev server URL we ever generate
// carries credentials, and a form designed to make a reader misjudge the host
// has no business reaching the bridge.
bool IsTrustedUiUrl(const std::string& url);

}  // namespace openaxe
