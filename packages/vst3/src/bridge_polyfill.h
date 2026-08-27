#pragma once

// The window.openAxe.* polyfill injected into the plugin's webview
// (issue #300 A1/A2/A3).
//
// Deliberately its own translation unit with no iPlug, no webview and no
// plugin.h dependency: it is a static string asset consumed by two very
// different places — HttpServer, which splices it into index.html, and the
// IWebViewControl fallback for dev-server mode — and CTest needs to assert its
// message-channel contract without linking an SDK.

#include <string>

namespace openaxe_vst3 {

// JavaScript source defining window['openAxe.<method>'] as Promise wrappers
// over iPlug2's webview message channel, plus window.IPlugWebViewResolve /
// IPlugWebViewReject which native calls back into. Idempotent: re-running it
// in an already-initialised document is a no-op.
// `shell` is published as window.openAxe.shell so the React app can tell a
// plugin from the desktop shell synchronously, at module scope, without
// awaiting getConfig() (issue #300 E1). The desktop shell binds its bridge
// natively and injects no polyfill, so an absent value means "desktop".
std::string BridgePolyfillJs(const std::string& shell = "plugin");

}  // namespace openaxe_vst3
