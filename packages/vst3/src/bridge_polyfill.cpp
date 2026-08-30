#include "bridge_polyfill.h"

namespace openaxe_vst3 {

std::string BridgePolyfillJs(const std::string& shell, bool devtools) {
  // Defines window['openAxe.*'] as Promise wrappers over iPlug2's webview
  // message channel, plus the resolver native calls via EvaluateJavaScript.
  //
  // Two hard constraints, both learned the hard way (issue #300 A2/A3):
  //
  //  1. Post through IPlugSendMsg, NOT
  //     webkit.messageHandlers.<name>.postMessage. iPlug2 registers its
  //     handler under the name "callback" (IPlugWebView_mac.mm) and injects
  //     IPlugSendMsg at document start on every platform; naming the handler
  //     ourselves couples us to that internal name and threw TypeError.
  //
  //  2. Pass an OBJECT, not a JSON string. The macOS handler casts
  //     message.body to NSDictionary* and runs it through
  //     +dataWithJSONObject:options:NSJSONWritingPrettyPrinted, which
  //     rejects a non-container top level — a posted string yielded nil data
  //     and OnMessageFromWebView(nullptr), so the promise never settled.
  //     (The Windows path uses get_WebMessageAsJson and tolerates strings,
  //     which is why this looked platform-specific.)
  //
  // This script is injected by HttpServer before the SPA's module scripts, so
  // window['openAxe.version'] exists by the time useAudioEngine.ts decides
  // whether this is a native shell.
  const std::string prelude = R"JS(
(function(){
  if (window.__openAxePolyfilled) return;
  window.__openAxePolyfilled = true;
  window.openAxe = window.openAxe || {};
  window.openAxe._nextId = 0;
  window.openAxe._pending = {};
  window.IPlugWebViewResolve = function(id, resultJson) {
    var cb = window.openAxe._pending[id];
    if (cb) { try { cb.resolve(JSON.parse(resultJson)); } catch(e){ cb.resolve(resultJson); } delete window.openAxe._pending[id]; }
  };
  window.IPlugWebViewReject = function(id, err) {
    var cb = window.openAxe._pending[id];
    if (cb) { cb.reject(new Error(String(err))); delete window.openAxe._pending[id]; }
  };
  function post(payload) {
    if (typeof window.IPlugSendMsg === 'function') { window.IPlugSendMsg(payload); return; }
    // IPlugSendMsg is injected at document start by iPlug2 itself. If it is
    // somehow absent, fall back to the raw handler rather than failing silently.
    var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.callback;
    if (h) { h.postMessage(payload); return; }
    if (window.chrome && window.chrome.webview) { window.chrome.webview.postMessage(payload); return; }
    throw new Error('no webview message channel');
  }
  function bind(method) {
    window['openAxe.' + method] = function(args) {
      return new Promise(function(resolve, reject){
        var id = ++window.openAxe._nextId;
        window.openAxe._pending[id] = {resolve: resolve, reject: reject};
        try { post({method: 'openAxe.' + method, args: args || {}, id: id}); }
        catch(e){ delete window.openAxe._pending[id]; reject(e); }
      });
    };
  }
  var methods = ["version","listDevices","getConfig","open","close","start","stop","addBlock","removeBlock","moveBlock","connect","disconnect","setParam","getParam","blockInfo","listBlocks","listEdges","loadModel","loadModelJson","unloadModel","setReverbAlgorithm","setDelayModel","setBypass","setBlockTrim","loadIrWav","unloadIr","setInputGain","setInputChannel","setMasterLevel","setMasterMuted","setTunerMuted","meters","cpuLoad","getTap","takeStreamError","secureStore","secureLoad","secureDelete","getState",
    // Shared on-disk library. This list is the whole bridge surface the
    // plugin's webview gets — a handler added to VstBridge but not named here
    // simply does not exist as far as the UI is concerned, and the app
    // silently falls back to browser storage.
    "storageGet","storagePut","storageDelete","storageKeys","storageValues","storageClear",
    "assetPut","assetGet","assetDelete","assetHas","assetKeys","assetStats","assetClear"];
  methods.forEach(bind);

  // ── Let people type (issue #300 B5) ────────────────────────────────
  // iPlug2 injects its own document-start keydown/keyup listeners that forward
  // every key to the host and then call preventDefault(), unless
  // document.activeElement.type is exactly "text". An <input type="email">,
  // "password", "search" or "number", a <textarea>, and anything
  // contenteditable all fail that check — so keystrokes were swallowed and the
  // Tone3000 email field (and preset names, and the token box) could not be
  // typed into at all.
  //
  // Their listeners are on `document` in the bubble phase and were registered
  // before this script runs, so they cannot be removed or preempted in the same
  // phase. A capture-phase listener on `document` does fire first: stopping
  // propagation there means their handler never runs, so preventDefault() is
  // never called and the browser performs the key's default action normally.
  //
  // Propagation is only stopped when the key is genuinely going into an
  // editable field. Everywhere else the event is left alone, so the host still
  // receives transport keys — spacebar in a DAW should start playback, not type
  // a space into the grid.
  //
  // Note this stops keydown/keyup from reaching React's root listener while a
  // field has focus, which is what you want: app shortcuts should not fire
  // mid-word. `input`/`change` are separate events and are untouched, so
  // controlled inputs still update.
  function isEditableTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    var tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag !== 'INPUT') return false;
    var t = (el.getAttribute('type') || 'text').toLowerCase();
    // Types that carry no text entry; everything else accepts keystrokes.
    return ['button', 'checkbox', 'radio', 'range', 'color', 'file', 'image',
            'reset', 'submit'].indexOf(t) === -1;
  }
  // ── Suppress the webview's own context menu (issue #300 H3) ────────
  // Right-clicking anywhere gave the native WKWebView menu — Reload, Back,
  // and Inspect Element when devtools are on — which is a large part of what
  // makes the shell read as a browser rather than an app. Suppressed unless
  // OPENAXE_DESKTOP_DEBUG put the webview in devtools mode, where Inspect
  // Element is the whole point; the native side flips that flag before this
  // script runs.
  //
  // Elements that opt in with data-native-menu (a future text field wanting
  // the system spelling/substitution menu) are left alone.
  document.addEventListener('contextmenu', function (e) {
    if (window.__openAxeDevTools) return;
    if (e.target && e.target.closest && e.target.closest('[data-native-menu]')) return;
    e.preventDefault();
  });

  ['keydown', 'keyup', 'keypress'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      if (isEditableTarget(e.target)) e.stopPropagation();
    }, true);
  });
})();
)JS";
  // Declared after the wrappers so the shell tag is only ever visible on a
  // fully-initialised bridge.
  const std::string devtools_line =
      std::string("\nwindow.__openAxeDevTools = ") + (devtools ? "true" : "false") + ";";
  return devtools_line + prelude + "\nwindow.openAxe.shell = " + [&] {
    std::string quoted = "\"";
    for (char c : shell) {
      if (c == '"' || c == '\\') continue;  // shell names are internal identifiers
      quoted.push_back(c);
    }
    quoted.push_back('"');
    return quoted;
  }() + ";\n";
}

}  // namespace openaxe_vst3
