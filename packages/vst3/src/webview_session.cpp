#include "webview_session.h"

#include <cstdlib>
#include <nlohmann/json.hpp>

#include "IPlugWebView.h"
#include "bridge_polyfill.h"
#include "openaxe/ui_url.h"
#include "vst_bridge.h"

namespace openaxe_vst3 {

namespace {

bool DevtoolsRequested() {
  const char* v = std::getenv("OPENAXE_DESKTOP_DEBUG");
  return v && std::string(v) == "1";
}

}  // namespace

std::string EditorUiUrl(unsigned short ui_port, const std::string& ui_root) {
  // Same shared check the editor and desktop use (issue #300 J1).
  const char* env_url = std::getenv("OPENAXE_UI_URL");
  if (env_url && *env_url && openaxe::IsTrustedUiUrl(env_url)) return env_url;
  if (ui_port != 0 && !ui_root.empty()) {
    return "http://127.0.0.1:" + std::to_string(ui_port) + "/index.html";
  }
  return {};
}

void WebViewSession::Begin(iplug::IWebView& view, const std::string& url) {
  content_loaded_ = false;
  pending_js_.clear();
  if (!url.empty()) view.LoadURL(url.c_str());
}

void WebViewSession::ContentLoaded(iplug::IWebView& view) {
  // The polyfill normally arrives inside index.html, injected by HttpServer
  // so it runs before the SPA's module scripts (issue #300 A1). This late
  // injection is only a fallback for the OPENAXE_UI_URL dev-server case,
  // where the HTML comes from Vite and we can't rewrite it. It is idempotent
  // (the script guards on __openAxePolyfilled), but in dev-server mode it is
  // still too late for useAudioEngine.ts's module-scope shell check - running
  // the plugin against `pnpm dev:web` needs a Vite plugin to inject the same
  // script. Tracked in #300 A1.
  const std::string poly = BridgePolyfillJs("plugin", DevtoolsRequested());
  view.EvaluateJavaScript(poly.c_str(), nullptr);
  content_loaded_ = true;
  for (const auto& js : pending_js_) view.EvaluateJavaScript(js.c_str(), nullptr);
  pending_js_.clear();
}

bool WebViewSession::HandleMessage(iplug::IWebView& view, const char* json) {
  if (!json || !bridge_) return true;
  std::string resp;
  int msg_id = -1;
  try {
    auto j = nlohmann::json::parse(json, nullptr, false);
    if (j.is_discarded() || !j.is_object()) return true;
    // iPlug2's own document-start scripts post key events and parameter
    // gestures through this same channel as {"msg":"SKPFUI",...}. They are
    // not bridge calls: treating them as one produced a "missing method"
    // error and a spurious IPlugWebViewResolve(-1, ...) per keystroke.
    if (!j.contains("method")) return false;
    if (j.contains("id")) msg_id = j.value("id", -1);
    resp = bridge_->HandleMessage(json);
  } catch (...) {
    resp = "{\"ok\":false,\"error\":\"handler exception\"}";
  }
  if (msg_id < 0) return true;  // fire-and-forget call; nothing to resolve

  // Build the JS string literal with the JSON serializer rather than by hand
  // (issue #300 A4): escaping only \ ' \n \r let any U+2028 / U+2029 in the
  // payload - legal inside a JSON string, illegal raw inside a JS string
  // literal - turn into a syntax error that silently dropped the reply. The
  // two line separators still need doing by hand because they are valid JSON
  // but not valid JS source.
  std::string literal = nlohmann::json(resp).dump();
  for (size_t i = 0; (i = literal.find("\xE2\x80\xA8", i)) != std::string::npos;) {
    literal.replace(i, 3, "\\u2028");
    i += 6;
  }
  for (size_t i = 0; (i = literal.find("\xE2\x80\xA9", i)) != std::string::npos;) {
    literal.replace(i, 3, "\\u2029");
    i += 6;
  }
  EvalOrQueue(view, "window.IPlugWebViewResolve(" + std::to_string(msg_id) + "," + literal + ")");
  return true;
}

void WebViewSession::EvalOrQueue(iplug::IWebView& view, const std::string& js) {
  if (content_loaded_) {
    view.EvaluateJavaScript(js.c_str(), nullptr);
    return;
  }
  // A page that somehow never finishes loading must not grow this without
  // bound. Far more than the handful of calls a boot actually makes.
  constexpr size_t kMaxPending = 256;
  if (pending_js_.size() < kMaxPending) pending_js_.push_back(js);
}

}  // namespace openaxe_vst3
