#include "webview/webview.h"

#include "bridge.h"
#include "debug_log.h"
#include "http_server.h"

#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

namespace {

// Path to the bundled React UI (apps/web build). Skipped entirely when
// OPENAXE_UI_URL is set (dev-server mode, see below). Resolved, in order,
// from:
//   1. the OPENAXE_UI_DIR env override,
//   2. <exeDir>/ui/index.html               (Windows ZIP: exe + ui in same dir),
//   3. <exeDir>/../ui/index.html            (dev: build/bin + build/ui),
//   4. <exeDir>/../Resources/ui/index.html  (packaged macOS .app bundle),
//   5. <exeDir>/../share/.../ui/index.html  (packaged Linux /usr/bin + /usr/share).
// Returns "" (-> placeholder console) when none exist.
std::string UiIndexPath(const std::string& argv0) {
  namespace fs = std::filesystem;
  if (const char* env = std::getenv("OPENAXE_UI_DIR"); env && *env) {
    fs::path p = fs::path(env) / "index.html";
    if (fs::exists(p)) return p.lexically_normal().string();
  }

  fs::path exe = argv0.empty() ? fs::path() : fs::weakly_canonical(argv0);
  if (exe.empty()) exe = fs::absolute(fs::current_path());
  const fs::path exe_dir = exe.parent_path();
  const std::vector<fs::path> candidates = {
      exe_dir / "ui" / "index.html",
      exe_dir / ".." / "ui" / "index.html",
      exe_dir / ".." / "Resources" / "ui" / "index.html",
      exe_dir / ".." / "share" / "openaxe-desktop" / "ui" / "index.html",
  };
  for (const auto& c : candidates) {
    const fs::path n = c.lexically_normal();
    if (fs::exists(n)) return n.string();
  }
  return {};
}

// M2 placeholder UI - a functional console that exercises the full
// window.openAxe.* bridge (devices, stream control, graph topology, NAM
// model loading, metering) against the real C++ DSP core. Replaced by the
// real React UI (apps/web build) in issue #15 M3, which will navigate the
// webview to the built index.html instead of set_html().
constexpr const char* kPlaceholderHtml = R"(<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
         background: #1a1d21; color: #e8eaed; margin: 0; }
  header { padding: 16px 20px; border-bottom: 1px solid #2a2d33; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  #ver { color: #7dd3fc; font-family: ui-monospace, monospace; }
  main { padding: 16px 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  section { border: 1px solid #2a2d33; border-radius: 8px; padding: 12px 14px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em;
       color: #9aa0a6; margin: 0 0 10px; }
  select, button { background: #26292f; color: #e8eaed; border: 1px solid #3a3e45;
                   border-radius: 6px; padding: 5px 8px; margin: 2px 4px 2px 0; }
  button { cursor: pointer; }
  button:hover { background: #30343c; }
  #config { font-family: ui-monospace, monospace; font-size: 12px; color: #9aa0a6; }
  ul { list-style: none; margin: 8px 0 0; padding: 0; font-size: 13px; }
  li { padding: 3px 0; display: flex; gap: 8px; align-items: center; }
  li .params { color: #9aa0a6; font-family: ui-monospace, monospace; font-size: 11px; }
  pre { margin: 0; font-family: ui-monospace, monospace; font-size: 12px; color: #9aa0a6;
        max-height: 200px; overflow: auto; }
  .ok { color: #6ee7a0; } .err { color: #fca5a5; }
</style>
</head>
<body>
<header>
  <h1>OpenAxe &mdash; desktop shell (M2 bridge console)</h1>
  <p>core version: <span id="ver">loading&hellip;</span></p>
</header>
<main>
  <section>
    <h2>Devices &amp; stream</h2>
    <div><label>Input</label> <select id="inDev"></select></div>
    <div><label>Output</label> <select id="outDev"></select></div>
    <div><label>Rate</label>
      <select id="sampleRate"><option value="44100">44100</option><option value="48000" selected>48000</option><option value="96000">96000</option></select>
      <label>Buffer</label>
      <select id="buffer"><option value="16">16</option><option value="32">32</option><option value="64">64</option><option value="128" selected>128</option><option value="256">256</option><option value="512">512</option></select>
    </div>
    <p>
      <button id="open">Open</button>
      <button id="start">Start</button>
      <button id="stop">Stop</button>
    </p>
    <p id="config"></p>
  </section>
  <section>
    <h2>Graph</h2>
    <div>
      <select id="kind">
        <option>noise-gate</option><option>compressor</option><option>eq</option>
        <option>chorus</option><option>flanger</option><option>phaser</option>
        <option>tremolo</option><option>ring-mod</option><option>filter</option>
        <option>pitch-shifter</option><option>granular-delay</option><option>rotary</option>
        <option>delay</option><option>ping-pong-delay</option>
        <option>reverb</option><option>amp</option>
        <option>amp-cab</option><option>pedal</option><option>outboard</option>
        <option>space</option><option>cab</option><option>mixer</option><option>splitter</option>
      </select>
      <button id="add">Add block</button>
      <button id="wire">Wire IN &rarr; blocks &rarr; OUT</button>
      <button id="loadModel">Load NAM model</button>
    </div>
    <ul id="blocks"></ul>
  </section>
  <section style="grid-column: 1 / -1;">
    <h2>Meters &amp; CPU</h2>
    <pre id="meters"></pre>
  </section>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  const call = (method, arg) => window['openAxe.' + method](arg);

  let lastError = null;

  async function refreshDevices() {
    const devices = await call('listDevices');
    // Only surface the platform default device in each picker - the app always
    // runs on the system default I/O, so there's no point offering the rest.
    const ins = devices.filter((d) => d.isInput && d.isDefault);
    const outs = devices.filter((d) => d.isOutput && d.isDefault);
    const fill = (sel, list, empty) => {
      sel.innerHTML = '';
      if (!list.length) { const o = document.createElement('option'); o.textContent = empty; sel.appendChild(o); return; }
      for (const d of list) {
        const o = document.createElement('option');
        o.value = d.id;
        o.textContent = d.name + (d.isDefault ? ' (default)' : '');
        sel.appendChild(o);
      }
    };
    fill($('inDev'), ins, 'No input devices');
    fill($('outDev'), outs, 'No output devices');
    return { ins, outs };
  }

  function showConfig() {
    call('getConfig').then((c) => {
      $('config').textContent =
        'open: ' + c.open + ' | running: ' + c.running +
        ' | ' + c.sampleRate + ' Hz | buffer ' + c.bufferFrames +
        (c.lastError ? ' | err: ' + c.lastError : '');
    }).catch((e) => { $('config').textContent = 'err: ' + e; });
  }

  function renderBlocks() {
    call('listBlocks').then(async (blocks) => {
      const ul = $('blocks');
      ul.innerHTML = '';
      for (const b of blocks) {
        const li = document.createElement('li');
        const info = await call('blockInfo', { blockId: b.id });
        const model = info.hasModel ? ' [model]' : '';
        const params = (info.params || []).map((p) => p.symbol + '=' + p.value.toFixed(3)).join(' ');
        li.innerHTML =
          '<span>' + b.id + ' (' + b.kind + ' @' + b.row + ',' + b.col + ')' + model + '</span>' +
          '<span class="params">' + params + '</span>' +
          '<button data-del="' + b.id + '">remove</button>' +
          '<button data-model="' + b.id + '">load model</button>';
        ul.appendChild(li);
      }
      ul.querySelectorAll('[data-del]').forEach((btn) =>
        btn.onclick = () => call('removeBlock', { blockId: btn.dataset.del }).then(renderBlocks));
      ul.querySelectorAll('[data-model]').forEach((btn) =>
        btn.onclick = () => call('loadModel', { blockId: btn.dataset.model }).then(renderBlocks));
    });
  }

  async function refreshAll() {
    try {
      $('ver').textContent = await call('version');
      await refreshDevices();
      showConfig();
      renderBlocks();
    } catch (e) {
      $('ver').textContent = 'bridge error: ' + e;
    }
  }

  $('open').onclick = async () => {
    const r = await call('open', {
      inputDeviceId: Number($('inDev').value) || 0xFFFFFFFF,
      outputDeviceId: Number($('outDev').value) || 0xFFFFFFFF,
      sampleRate: Number($('sampleRate').value),
      bufferFrames: Number($('buffer').value),
    });
    if (!r.ok) lastError = r.error;
    showConfig();
  };
  $('start').onclick = async () => { const r = await call('start'); if (!r.ok) lastError = r.error; showConfig(); };
  $('stop').onclick = async () => { const r = await call('stop'); if (!r.ok) lastError = r.error; showConfig(); };
  $('add').onclick = async () => {
    const r = await call('addBlock', { kind: $('kind').value, row: 0, col: 0 });
    if (!r.ok) lastError = r.error;
    renderBlocks();
  };
  $('wire').onclick = async () => {
    const blocks = await call('listBlocks');
    let prev = -1;
    for (const b of blocks) {
      await call('connect', { fromId: prev, fromPort: 0, toId: b.id, toPort: 0 });
      prev = b.id;
    }
    if (prev !== -1) await call('connect', { fromId: prev, fromPort: 0, toId: -2, toPort: 0 });
    renderBlocks();
  };
  $('loadModel').onclick = async () => {
    const blocks = await call('listBlocks');
    if (!blocks.length) { lastError = 'add a block first'; return; }
    const r = await call('loadModel', { blockId: blocks[0].id });
    if (!r.ok) lastError = r.error || (r.canceled ? 'cancelled' : '');
    renderBlocks();
  };

  setInterval(async () => {
    try {
      const meters = await call('meters');
      const cpu = await call('cpuLoad');
      $('meters').textContent =
        'cpu load: ' + (cpu * 100).toFixed(1) + '%\n' +
        meters.map((m) => m.id + ': ' + m.value.toFixed(4) + (lastError ? '\nlast error: ' + lastError : '')).join('\n');
      lastError = null;
    } catch (e) {
      $('meters').textContent = 'poll error: ' + e;
    }
  }, 250);

  refreshAll();
</script>
</body>
</html>)";

template <typename Method>
void Bind(webview::webview& w, openaxe_desktop::StudioBridge& bridge, const char* name,
          Method method) {
  w.bind(name, [&bridge, method](const std::string& req) { return (bridge.*method)(req); });
}

}  // namespace

#ifdef _WIN32
int WINAPI WinMain(HINSTANCE /*hInst*/, HINSTANCE /*hPrevInst*/,
                   LPSTR /*lpCmdLine*/, int /*nCmdShow*/) {
  std::string argv0;
#else
int main(int argc, char** argv) {
  std::string argv0 = argc > 0 ? argv[0] : "";
#endif
  try {
    // Log to a file + install a crash backtrace handler (OPENAXE_DESKTOP_DEBUG=1
    // also turns on the webview devtools / remote inspector). Log lives next
    // to the executable by default.
    const std::string exe_dir =
        argv0.empty() ? std::filesystem::current_path().string()
                      : std::filesystem::weakly_canonical(argv0).parent_path().string();
    openaxe_desktop::InstallDebugLogging(exe_dir);

    // Construct the bridge BEFORE the webview. On exit the webview's
    // destructor drains its dispatch queue (pending JS getTap/meters calls
    // from the React UI's ~50ms poll), which invoke bridge handlers that read
    // RtCallbackState. Declaring the bridge first makes it destruct LAST
    // (reverse order), so the webview finishes draining while the bridge and
    // its state_ are still alive - otherwise a drained getTap touches freed
    // state_ (the exit-time heap corruption / std::terminate in
    // ~cocoa_wkwebview_engine).
    openaxe_desktop::StudioBridge bridge;

    webview::webview w(openaxe_desktop::DebugEnabled(), nullptr);
    w.set_title("OpenAxe");
    w.set_size(1280, 800, WEBVIEW_HINT_NONE);

    // window.openAxe.* bridge surface (issue #15 M2). Each bind exposes a
    // global JS function; webview marshals its JSON args here and resolves
    // the JS promise with the returned JSON.
    Bind(w, bridge, "openAxe.version", &openaxe_desktop::StudioBridge::HandleVersion);
    Bind(w, bridge, "openAxe.listDevices", &openaxe_desktop::StudioBridge::HandleListDevices);
    Bind(w, bridge, "openAxe.getConfig", &openaxe_desktop::StudioBridge::HandleGetConfig);
    Bind(w, bridge, "openAxe.open", &openaxe_desktop::StudioBridge::HandleOpen);
    Bind(w, bridge, "openAxe.close", &openaxe_desktop::StudioBridge::HandleClose);
    Bind(w, bridge, "openAxe.start", &openaxe_desktop::StudioBridge::HandleStart);
    Bind(w, bridge, "openAxe.stop", &openaxe_desktop::StudioBridge::HandleStop);
    Bind(w, bridge, "openAxe.addBlock", &openaxe_desktop::StudioBridge::HandleAddBlock);
    Bind(w, bridge, "openAxe.removeBlock", &openaxe_desktop::StudioBridge::HandleRemoveBlock);
    Bind(w, bridge, "openAxe.moveBlock", &openaxe_desktop::StudioBridge::HandleMoveBlock);
    Bind(w, bridge, "openAxe.connect", &openaxe_desktop::StudioBridge::HandleConnect);
    Bind(w, bridge, "openAxe.disconnect", &openaxe_desktop::StudioBridge::HandleDisconnect);
    Bind(w, bridge, "openAxe.setParam", &openaxe_desktop::StudioBridge::HandleSetParam);
    Bind(w, bridge, "openAxe.getParam", &openaxe_desktop::StudioBridge::HandleGetParam);
    Bind(w, bridge, "openAxe.blockInfo", &openaxe_desktop::StudioBridge::HandleBlockInfo);
    Bind(w, bridge, "openAxe.listBlocks", &openaxe_desktop::StudioBridge::HandleListBlocks);
    Bind(w, bridge, "openAxe.listEdges", &openaxe_desktop::StudioBridge::HandleListEdges);
    Bind(w, bridge, "openAxe.loadModel", &openaxe_desktop::StudioBridge::HandleLoadModel);
    Bind(w, bridge, "openAxe.loadModelJson", &openaxe_desktop::StudioBridge::HandleLoadModelJson);
    Bind(w, bridge, "openAxe.unloadModel", &openaxe_desktop::StudioBridge::HandleUnloadModel);
    Bind(w, bridge, "openAxe.setReverbAlgorithm",
         &openaxe_desktop::StudioBridge::HandleSetReverbAlgorithm);
    Bind(w, bridge, "openAxe.setDelayModel", &openaxe_desktop::StudioBridge::HandleSetDelayModel);
    Bind(w, bridge, "openAxe.meters", &openaxe_desktop::StudioBridge::HandleMeters);
    Bind(w, bridge, "openAxe.cpuLoad", &openaxe_desktop::StudioBridge::HandleCpuLoad);
    Bind(w, bridge, "openAxe.getTap", &openaxe_desktop::StudioBridge::HandleGetTap);
    Bind(w, bridge, "openAxe.takeStreamError", &openaxe_desktop::StudioBridge::HandleTakeStreamError);
    Bind(w, bridge, "openAxe.setBypass", &openaxe_desktop::StudioBridge::HandleSetBypass);
    Bind(w, bridge, "openAxe.setBlockTrim", &openaxe_desktop::StudioBridge::HandleSetBlockTrim);
    Bind(w, bridge, "openAxe.loadIrWav", &openaxe_desktop::StudioBridge::HandleLoadIrWav);
    Bind(w, bridge, "openAxe.unloadIr", &openaxe_desktop::StudioBridge::HandleUnloadIr);
    Bind(w, bridge, "openAxe.setInputGain", &openaxe_desktop::StudioBridge::HandleSetInputGain);
    Bind(w, bridge, "openAxe.setMasterLevel", &openaxe_desktop::StudioBridge::HandleSetMasterLevel);
    Bind(w, bridge, "openAxe.setMasterMuted", &openaxe_desktop::StudioBridge::HandleSetMasterMuted);
    Bind(w, bridge, "openAxe.setTunerMuted", &openaxe_desktop::StudioBridge::HandleSetTunerMuted);
    Bind(w, bridge, "openAxe.loadSoundfont", &openaxe_desktop::StudioBridge::HandleLoadSoundfont);
    Bind(w, bridge, "openAxe.unloadSoundfont", &openaxe_desktop::StudioBridge::HandleUnloadSoundfont);
    Bind(w, bridge, "openAxe.songScheduleEvent", &openaxe_desktop::StudioBridge::HandleSongScheduleEvent);
    Bind(w, bridge, "openAxe.songClearEvents", &openaxe_desktop::StudioBridge::HandleSongClearEvents);
    Bind(w, bridge, "openAxe.songStart", &openaxe_desktop::StudioBridge::HandleSongStart);
    Bind(w, bridge, "openAxe.songStop", &openaxe_desktop::StudioBridge::HandleSongStop);
    Bind(w, bridge, "openAxe.songSeek", &openaxe_desktop::StudioBridge::HandleSongSeek);
    Bind(w, bridge, "openAxe.songPosition", &openaxe_desktop::StudioBridge::HandleSongPosition);
    Bind(w, bridge, "openAxe.songIsPlaying", &openaxe_desktop::StudioBridge::HandleSongIsPlaying);
    Bind(w, bridge, "openAxe.setBusGain", &openaxe_desktop::StudioBridge::HandleSetBusGain);
    Bind(w, bridge, "openAxe.setBusPan", &openaxe_desktop::StudioBridge::HandleSetBusPan);
    Bind(w, bridge, "openAxe.setBusMute", &openaxe_desktop::StudioBridge::HandleSetBusMute);
    Bind(w, bridge, "openAxe.setBusSolo", &openaxe_desktop::StudioBridge::HandleSetBusSolo);
    Bind(w, bridge, "openAxe.getBusMeter", &openaxe_desktop::StudioBridge::HandleGetBusMeter);
    Bind(w, bridge, "openAxe.clipCreate", &openaxe_desktop::StudioBridge::HandleClipCreate);
    Bind(w, bridge, "openAxe.clipDestroy", &openaxe_desktop::StudioBridge::HandleClipDestroy);
    Bind(w, bridge, "openAxe.clipFeedPcm", &openaxe_desktop::StudioBridge::HandleClipFeedPcm);
    Bind(w, bridge, "openAxe.clipPlay", &openaxe_desktop::StudioBridge::HandleClipPlay);
    Bind(w, bridge, "openAxe.clipStop", &openaxe_desktop::StudioBridge::HandleClipStop);
    Bind(w, bridge, "openAxe.clipSeek", &openaxe_desktop::StudioBridge::HandleClipSeek);
    Bind(w, bridge, "openAxe.clipGetPosition", &openaxe_desktop::StudioBridge::HandleClipGetPosition);
    Bind(w, bridge, "openAxe.clipGetFrames", &openaxe_desktop::StudioBridge::HandleClipGetFrames);
    Bind(w, bridge, "openAxe.clipGetBus", &openaxe_desktop::StudioBridge::HandleClipGetBus);
    Bind(w, bridge, "openAxe.captureStart", &openaxe_desktop::StudioBridge::HandleCaptureStart);
    Bind(w, bridge, "openAxe.captureStop", &openaxe_desktop::StudioBridge::HandleCaptureStop);
    Bind(w, bridge, "openAxe.captureRead", &openaxe_desktop::StudioBridge::HandleCaptureRead);
    Bind(w, bridge, "openAxe.captureAvailable", &openaxe_desktop::StudioBridge::HandleCaptureAvailable);
    Bind(w, bridge, "openAxe.jamConfigure", &openaxe_desktop::StudioBridge::HandleJamConfigure);
    Bind(w, bridge, "openAxe.jamLift", &openaxe_desktop::StudioBridge::HandleJamLift);
    Bind(w, bridge, "openAxe.jamAvailable", &openaxe_desktop::StudioBridge::HandleJamAvailable);
    Bind(w, bridge, "openAxe.secureStore", &openaxe_desktop::StudioBridge::HandleSecureStore);
    Bind(w, bridge, "openAxe.secureLoad", &openaxe_desktop::StudioBridge::HandleSecureLoad);
    Bind(w, bridge, "openAxe.secureDelete", &openaxe_desktop::StudioBridge::HandleSecureDelete);

    // OPENAXE_UI_URL wins over the bundled copy: it points the webview at
    // an already-running dev server (Vite, http://127.0.0.1:5173) so the
    // native shell can run against `pnpm dev:web` with HMR - the bridge binds
    // above are installed on the webview itself, so window.openAxe is there
    // whichever URL the UI comes from.
    const char* ui_url_env = std::getenv("OPENAXE_UI_URL");
    const bool use_dev_server =
        ui_url_env && *ui_url_env && openaxe_desktop::IsTrustedUiUrl(ui_url_env);
    if (ui_url_env && *ui_url_env && !use_dev_server) {
      std::cerr << "openaxe_desktop: refusing OPENAXE_UI_URL=" << ui_url_env
                << " - only loopback http(s) UI origins are allowed (issue #71)\n";
    }

    // Otherwise serve the bundled React UI over loopback HTTP when present
    // (WKWebView sandboxes file:// subresources, so file:// navigation would
    // leave a blank page), else the M3 placeholder console which still
    // exercises the full bridge against the C++ core.
    const std::string ui = use_dev_server ? std::string() : UiIndexPath(argv0);
    openaxe_desktop::HttpServer uiServer;
    // The UI server's port above is ephemeral (by design - see its header,
    // it must never fight Vite for 5173), so it can't be the Tone3000 OAuth
    // redirect_uri: an OAuth provider needs an exact, pre-registered value,
    // and that value can't shift every launch. This second, fixed-port
    // listener is registered with Tone3000 instead; its only job is 302-ing
    // the redirect back to whatever port the UI actually ended up on this
    // launch, read live out of `ui_port` below. Skipped in dev-server mode -
    // there the webview's origin already *is* the fixed, registered
    // http://localhost:5173 (see apps/web/.env.example), so no bounce is
    // needed. See tone3000/config.ts's DESKTOP_OAUTH_REDIRECT_PORT.
    unsigned short ui_port = 0;
    openaxe_desktop::HttpServer oauthRedirectServer;
    if (use_dev_server) {
      std::cerr << "openaxe_desktop: loading UI from " << ui_url_env << " (dev server)\n";
      w.navigate(ui_url_env);
    } else if (!ui.empty()) {
      const std::string uiDir = std::filesystem::path(ui).parent_path().string();
      if (uiServer.Start(uiDir, ui_port)) {
        std::cerr << "openaxe_desktop: serving UI at http://127.0.0.1:" << ui_port << "\n";
        if (!oauthRedirectServer.StartOAuthRedirect(openaxe_desktop::kOAuthRedirectPort, &ui_port)) {
          std::cerr << "openaxe_desktop: OAuth redirect listener on port "
                    << openaxe_desktop::kOAuthRedirectPort
                    << " failed to start (already in use?) - Tone3000 login will not complete\n";
        }
        w.navigate("http://127.0.0.1:" + std::to_string(ui_port) + "/index.html");
      } else {
        std::cerr << "openaxe_desktop: UI HTTP server failed to start; using placeholder\n";
        w.set_html(kPlaceholderHtml);
      }
    } else {
      w.set_html(kPlaceholderHtml);
    }
    w.run();
  } catch (const webview::exception& e) {
    std::cerr << "openaxe_desktop: " << e.what() << '\n';
    return 1;
  }
  return 0;
}