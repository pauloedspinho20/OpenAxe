#include "bridge_polyfill.h"

namespace openaxe_vst3 {

std::string BridgePolyfillJs(const std::string& shell) {
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
  var methods = ["version","listDevices","getConfig","open","close","start","stop","addBlock","removeBlock","moveBlock","connect","disconnect","setParam","getParam","blockInfo","listBlocks","listEdges","loadModel","loadModelJson","unloadModel","setReverbAlgorithm","setDelayModel","setBypass","setBlockTrim","loadIrWav","unloadIr","setInputGain","setMasterLevel","setMasterMuted","setTunerMuted","meters","cpuLoad","getTap","takeStreamError","secureStore","secureLoad","secureDelete"];
  methods.forEach(bind);
})();
)JS";
  // Declared after the wrappers so the shell tag is only ever visible on a
  // fully-initialised bridge.
  return prelude + "\nwindow.openAxe.shell = " + [&] {
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
