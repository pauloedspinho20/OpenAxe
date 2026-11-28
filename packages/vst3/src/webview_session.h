#pragma once

// The plugin editor's webview plumbing, shared by both editor shells:
//
//   - macOS / Windows: OpenAxeWebViewControl, an IGraphics IWebViewControl
//     (plugin.cpp).
//   - Linux: the plugin itself, as iPlug2's WebViewEditorDelegate. iPlug2's
//     Linux webview (WebKitGTK in a GtkPlug) has no IWebViewControl, only the
//     delegate form, so there the plugin *is* the webview (plugin.cpp,
//     WEBVIEW_EDITOR_DELEGATE).
//
// Both are an iplug::IWebView underneath, so everything that is about talking
// to the page - navigating, the bridge polyfill, routing bridge calls to
// VstBridge and resolving their promises, and holding replies until the page
// can take them - lives here once instead of being kept in step in two places.

#include <string>
#include <vector>

namespace iplug {
class IWebView;
}

namespace openaxe_vst3 {

class VstBridge;

// The URL the editor should load: a trusted OPENAXE_UI_URL dev server if one
// is set, else the bundled UI on the shared loopback server, else "" (no UI to
// show). `ui_port`/`ui_root` are the plugin's SharedUiServer port and the
// bundled UI directory.
std::string EditorUiUrl(unsigned short ui_port, const std::string& ui_root);

class WebViewSession {
 public:
  explicit WebViewSession(VstBridge* bridge) : bridge_(bridge) {}

  // From IWebView::OnWebViewReady: forget the previous page and navigate.
  void Begin(iplug::IWebView& view, const std::string& url);

  // From IWebView::OnWebContentLoaded: inject the bridge polyfill (a fallback
  // for the dev-server case - the bundled UI gets it inside index.html) and
  // deliver every reply that arrived while the page was loading.
  void ContentLoaded(iplug::IWebView& view);

  // From IWebView::OnMessageFromWebView. Returns false only for a well-formed
  // message that is not a bridge call (iPlug2's own {"msg": ...} traffic such
  // as key presses), so the caller can hand it to iPlug2. Bridge calls and
  // malformed input are consumed.
  bool HandleMessage(iplug::IWebView& view, const char* json);

 private:
  // iPlug2's EvaluateJavaScript is a silent no-op while the page is still
  // loading (no queue, no error), so a bridge call made from the page's module
  // scope would never see its reply. Queue until ContentLoaded instead.
  void EvalOrQueue(iplug::IWebView& view, const std::string& js);

  VstBridge* bridge_ = nullptr;
  bool content_loaded_ = false;
  std::vector<std::string> pending_js_;
};

}  // namespace openaxe_vst3
