#include "plugin.h"

#include "input_routing.h"

using openaxe_vst3::InputChannelMode;
using openaxe_vst3::InputChannelModeFromName;
using openaxe_vst3::InputChannelModeName;
using openaxe_vst3::InputChannelFromStateJson;
using openaxe_vst3::InputChannelToStateJson;
using openaxe_vst3::RouteInput;

#include "IPlug_include_in_plug_src.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

#include "config.h"

#include "asset_loading.h"
#include "automation_params.h"
#include "plugin_state.h"
#include "presets.h"

// IGraphics controls for the scaffold UI + webview.
//
// Gated on OPENAXE_HAS_IGRAPHICS, not just IPLUG_EDITOR: iPlug2's IGraphics has
// no Linux backend in the pinned revision (IGraphicsPrivate.h defines
// FONT_DESCRIPTOR_TYPE for OS_MAC/OS_IOS/OS_WIN/OS_WEB and leaves the #else
// commented "NO_IGRAPHICS"), so merely *including* these headers there fails to
// compile. See the OPENAXE_HAS_IGRAPHICS block in CMakeLists.txt. On such a
// platform the plugin is headless: DSP, params, state and MIDI work, and the
// host draws its own generic parameter UI.
#if IPLUG_EDITOR && defined(OPENAXE_HAS_IGRAPHICS)
#include "IControl.h"
#include "IControls.h"
#ifdef OPENAXE_HAS_WEBVIEW
#include "IWebViewControl.h"
#endif
#endif
#ifdef OPENAXE_HAS_WEBVIEW
#include "bridge_polyfill.h"
#include "http_server.h"
#include "openaxe/ui_url.h"
#include "ui_root.h"
#include "vst_bridge.h"
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <nlohmann/json.hpp>
// Diagnostic log, opt-in via OPENAXE_DESKTOP_DEBUG=1 (issue #300 J4).
// This used to run unconditionally on every bridge message: an open/append/
// close of /tmp/openaxe_vst.log per call, from the UI thread, unbounded, and
// logging environment variables and filesystem paths. Same env var the desktop
// shell uses so one switch turns on diagnostics for both.
static bool VstLogEnabled() {
  static const bool enabled = [] {
    const char* v = std::getenv("OPENAXE_DESKTOP_DEBUG");
    return v && *v == '1';
  }();
  return enabled;
}
static void VstLog(const std::string& msg) {
  if (!VstLogEnabled()) return;
  std::ofstream f("/tmp/openaxe_vst.log", std::ios::app);
  if (f) f << msg << std::endl;
}
#endif

#if defined(__SSE__) || defined(__x86_64__) || defined(_M_X64) || defined(__i386__) || defined(_M_IX86)
#include <xmmintrin.h>
#define OPENAXE_DENORMAL_SSE 1
#define OPENAXE_DENORMAL_ARM 0
#elif defined(__aarch64__) || defined(_M_ARM64)
#define OPENAXE_DENORMAL_SSE 0
#define OPENAXE_DENORMAL_ARM 1
#else
#define OPENAXE_DENORMAL_SSE 0
#define OPENAXE_DENORMAL_ARM 0
#endif

namespace {

// FTZ (flush-to-zero) + DAZ (denormals-are-zero) guard around the DSP call.
// Hosts don't guarantee MXCSR is set for FTZ/DAZ; reverb tails are exactly
// where denormals bite (issue #126). Mirrors the guard the web AudioWorklet
// and desktop fallback rely on — scoped so exception masks are preserved.
class ScopedDenormalDisable {
 public:
#if OPENAXE_DENORMAL_SSE
  ScopedDenormalDisable() : saved_(_mm_getcsr()) {
    // Bits 15 (FTZ) and 6 (DAZ) — leave exception masks untouched.
    _mm_setcsr(saved_ | 0x8040u);
  }
  ~ScopedDenormalDisable() { _mm_setcsr(saved_); }

 private:
  unsigned saved_;
#elif OPENAXE_DENORMAL_ARM
  // aarch64 has no MXCSR; flush-to-zero lives in FPCR bit 24 (FZ), and it is
  // OFF by default. The SSE-only guard therefore compiled to nothing on Apple
  // Silicon — which is the architecture we actually ship (issue #300 C3) — so
  // reverb tails ran denormal and burned CPU exactly where the guard was
  // supposed to help.
  ScopedDenormalDisable() : saved_(ReadFpcr()) { WriteFpcr(saved_ | (1ull << 24)); }
  ~ScopedDenormalDisable() { WriteFpcr(saved_); }

 private:
  static uint64_t ReadFpcr() {
    uint64_t v;
    __asm__ __volatile__("mrs %0, fpcr" : "=r"(v));
    return v;
  }
  static void WriteFpcr(uint64_t v) { __asm__ __volatile__("msr fpcr, %0" : : "r"(v)); }
  uint64_t saved_;
#else
  ScopedDenormalDisable() = default;
  ~ScopedDenormalDisable() = default;
#endif
};

void ZeroOutputs(float** outputs, int nChansOut, int nFrames) {
  for (int c = 0; c < nChansOut; ++c) {
    if (outputs[c]) std::memset(outputs[c], 0, static_cast<size_t>(nFrames) * sizeof(float));
  }
}
void ZeroOutputs(iplug::sample** outputs, int nChansOut, int nFrames) {
  for (int c = 0; c < nChansOut; ++c) {
    if (outputs[c]) std::memset(outputs[c], 0, static_cast<size_t>(nFrames) * sizeof(iplug::sample));
  }
}

}  // namespace

#ifdef OPENAXE_HAS_WEBVIEW
namespace {
class OpenAxeWebViewControl : public iplug::igraphics::IWebViewControl {
 public:
  OpenAxeWebViewControl(const iplug::igraphics::IRECT& bounds, openaxe_vst3::VstBridge* bridge,
                        const std::string& url)
      : IWebViewControl(bounds, true, nullptr, nullptr, true, true), bridge_(bridge), url_(url) {}
  void OnWebViewReady() override {
    VstLog("WebViewReady: loading url=" + url_);
    if (!url_.empty()) LoadURL(url_.c_str());
  }

  // Track the whole editor area whenever the host resizes the window (issue
  // #300 B2). IGraphics::Resize calls OnResize on every control but does not
  // move their rects, so without this the webview kept its original bounds and
  // the React UI never saw a different viewport width — which is what made the
  // UI look "not responsive" to the plugin window. Re-targeting the existing
  // control (rather than rebuilding it) also means the React tree, dialog state
  // and scroll position survive a resize.
  //
  // The rects are assigned directly instead of through SetTargetAndDrawRECTs:
  // that setter ends with its own OnResize() call (IControl.h), so calling it
  // from inside OnResize is unbounded recursion — it overflowed the stack and
  // took the host down with it the moment the editor opened.
  void OnResize() override {
    if (auto* ui = GetUI()) {
      const iplug::igraphics::IRECT bounds = ui->GetBounds();
      mRECT = bounds;
      mTargetRECT = bounds;
    }
    // Pushes mRECT to the platform view; does not re-enter OnResize.
    IWebViewControl::OnResize();
  }
  void OnWebContentLoaded() override {
    VstLog("WebContentLoaded: url=" + url_);
    // The polyfill normally arrives inside index.html, injected by HttpServer
    // so it runs before the SPA's module scripts (issue #300 A1). This late
    // injection is only a fallback for the OPENAXE_UI_URL dev-server case,
    // where the HTML comes from Vite and we can't rewrite it. It is
    // idempotent (the script guards on __openAxePolyfilled), but note that in
    // dev-server mode it is still too late for useAudioEngine.ts's
    // module-scope shell check — running the plugin against `pnpm dev:web`
    // needs a Vite plugin to inject the same script. Tracked in #300 A1.
    const char* dbgEnv = std::getenv("OPENAXE_DESKTOP_DEBUG");
    std::string poly =
        openaxe_vst3::BridgePolyfillJs("plugin", dbgEnv && std::string(dbgEnv) == "1");
    EvaluateJavaScript(poly.c_str(), nullptr);
    IWebViewControl::OnWebContentLoaded();
  }
  void OnMessageFromWebView(const char* json) override {
    if (VstLogEnabled()) VstLog(std::string("OnMessage: ") + (json ? json : "null"));
    if (!json || !bridge_) return;
    std::string req(json);
    std::string resp;
    int msgId = -1;
    try {
      auto j = nlohmann::json::parse(req, nullptr, false);
      if (j.is_discarded() || !j.is_object()) return;
      // iPlug2's own document-start scripts post key events through this same
      // channel as {"msg":"SKPFUI",...}. They are not bridge calls: without
      // this guard every keystroke produced a "missing method" error and a
      // spurious IPlugWebViewResolve(-1, ...).
      if (!j.contains("method")) return;
      if (j.contains("id")) msgId = j.value("id", -1);
      resp = bridge_->HandleMessage(req);
    } catch (...) {
      resp = "{\"ok\":false,\"error\":\"handler exception\"}";
    }
    if (msgId < 0) return;  // fire-and-forget call; nothing to resolve
    // Build the JS string literal with the JSON serializer rather than by
    // hand (issue #300 A4): the previous loop escaped only \ ' \n \r, so any
    // U+2028 / U+2029 in the payload — legal inside a JSON string, illegal
    // raw inside a JS string literal — produced a syntax error and silently
    // dropped the reply. nlohmann's dump() gives us a correctly quoted and
    // escaped literal; the two line separators still need doing by hand
    // because they are valid JSON but not valid JS source.
    std::string literal = nlohmann::json(resp).dump();
    for (size_t i = 0; (i = literal.find("\xE2\x80\xA8", i)) != std::string::npos;) {
      literal.replace(i, 3, "\\u2028");
      i += 6;
    }
    for (size_t i = 0; (i = literal.find("\xE2\x80\xA9", i)) != std::string::npos;) {
      literal.replace(i, 3, "\\u2029");
      i += 6;
    }
    const std::string js =
        "window.IPlugWebViewResolve(" + std::to_string(msgId) + "," + literal + ")";
    EvaluateJavaScript(js.c_str(), nullptr);
  }

 private:
  openaxe_vst3::VstBridge* bridge_ = nullptr;
  std::string url_;
};
}  // namespace
#endif

OpenAxePlugin::OpenAxePlugin(const iplug::InstanceInfo& info)
    : iplug::Plugin(info, iplug::MakeConfig(openaxe_vst3::params::HostParamCount(), kNumPresets)) {
  graph_ = nam_studio_graph_create();
  editor_ = std::make_unique<openaxe_vst3::editor::Editor>(graph_);
#ifdef OPENAXE_HAS_WEBVIEW
  bridge_ = std::make_unique<openaxe_vst3::VstBridge>(this, graph_);
  uiRoot_ = openaxe_vst3::FindBundledUiRoot();
  if (!uiRoot_.empty()) {
    // The bridge polyfill is served *inside* index.html so it runs before the
    // SPA's module scripts — see HttpServer::Start (issue #300 A1). Injecting
    // it from OnWebContentLoaded instead was too late: the app had already
    // decided it was a browser and opened the microphone.
    const char* dbgEnv = std::getenv("OPENAXE_DESKTOP_DEBUG");
    const bool devtools = dbgEnv && std::string(dbgEnv) == "1";
    // One server for the whole process, not one per instance: every instance
    // serves the same bundle, and eight instances in a project used to mean
    // eight listeners and eight worker pools.
    uiPort_ = openaxe_vst3::SharedUiServer::Acquire(
        uiRoot_, openaxe_vst3::BridgePolyfillJs("plugin", devtools));
    uiServerAcquired_ = uiPort_ != 0;
  }
  VstLog("OpenAxe VST ctor: uiRoot=" + uiRoot_ + " port=" + std::to_string(uiPort_) + " hasWebView=1");
  if (const char* e = std::getenv("OPENAXE_UI_URL")) VstLog(std::string("OPENAXE_UI_URL=") + e);
  else VstLog("OPENAXE_UI_URL not set");
#endif
#if IPLUG_DSP
  // Declare the full stable 302-param list (issue #127 / #121). When the SDK
  // isn't present this is a no-op; when it is, hosts see Master + Slot 1..15
  // groups at construction and automation lanes persist across sessions.
  openaxe_vst3::params::RegisterParams(*this);
  // Factory presets — generated from the same row layouts as web (issue #128).
  // We build the JSON via the same row→graph→serialize pipeline, then store
  // as IByteChunk presets so hosts show them in their preset menus and
  // RestorePreset can suspend+swap without dropout.
  {
    auto presets = openaxe_vst3::presets::BuildFactoryPresets();
    for (auto& p : presets) {
      iplug::IByteChunk chunk;
      chunk.PutStr(p.json.c_str());
      MakePresetFromChunk(p.name.c_str(), chunk);
    }
  }
#endif

#if IPLUG_EDITOR && defined(OPENAXE_HAS_IGRAPHICS)
  mMakeGraphicsFunc = [&]() {
    // Use the size restored from the host chunk, not the compile-time default
    // (issue #300 B4): SerializeState/UnserializeState were already
    // round-tripping editorWidth/editorHeight through editor_, but this
    // lambda ignored it, so a reopened project always came back at
    // PLUG_WIDTH x PLUG_HEIGHT.
    const auto sz = editor_ ? editor_->GetSize() : openaxe_vst3::editor::DefaultSize();
    return MakeGraphics(*this, sz.width, sz.height, PLUG_FPS,
                        GetScaleForScreen(sz.width, sz.height));
  };
#ifdef OPENAXE_HAS_WEBVIEW
  mLayoutFunc = [&](iplug::igraphics::IGraphics* pGraphics) {
    // Size, not Scale (issue #300 B2). Scale mode changes the IGraphics draw
    // scale, which merely transforms the child WKWebView — CSS pixel
    // dimensions stay put, so the React app's media queries never fire. Size
    // mode changes the real bounds, and OpenAxeWebViewControl::OnResize
    // forwards them to the webview.
    pGraphics->AttachCornerResizer(iplug::igraphics::EUIResizerMode::Size, false);
    const iplug::igraphics::IRECT b = pGraphics->GetBounds();
    // Prefer webview when we have a UI to serve or a dev server to attach to
    const char* envUrl = std::getenv("OPENAXE_UI_URL");
    // Same shared check the editor and desktop use (issue #300 J1); this used
    // to be a fourth, untested copy pasted into this lambda.
    bool useDevServer = envUrl && *envUrl && openaxe::IsTrustedUiUrl(envUrl);
    VstLog("mLayout: uiPort=" + std::to_string(uiPort_) + " uiRoot=" + uiRoot_ + " useDev=" + (useDevServer ? "1" : "0") + (envUrl ? std::string(" env=") + envUrl : ""));
    if ((uiPort_ != 0 && !uiRoot_.empty()) || useDevServer) {
      std::string url;
      if (useDevServer) url = envUrl;
      else if (uiPort_ != 0) url = "http://127.0.0.1:" + std::to_string(uiPort_) + "/index.html";
      VstLog("mLayout: creating webview url=" + url);
      auto* webView = new OpenAxeWebViewControl(b, bridge_.get(), url);
      const char* dbg = std::getenv("OPENAXE_DESKTOP_DEBUG");
      if (dbg && std::string(dbg) == "1") webView->SetEnableDevTools(true);
      pGraphics->AttachControl(webView);
    } else {
      // Fallback: scaffold IGraphics UI when no web UI is available (offline)
      pGraphics->AttachPanelBackground(iplug::igraphics::COLOR_DARK_GRAY);
      pGraphics->AttachControl(new iplug::igraphics::ITextControl(b.GetMidVPadded(40), "OpenAxe — UI not found", iplug::igraphics::IText(16, iplug::igraphics::COLOR_WHITE)));
      pGraphics->AttachControl(new iplug::igraphics::ITextControl(b.GetFromTop(30), "Run pnpm --filter @openaxe/web build or set OPENAXE_UI_URL=http://127.0.0.1:5173", iplug::igraphics::IText(12, iplug::igraphics::COLOR_WHITE)));
    }
  };
#else
  mLayoutFunc = [&](iplug::igraphics::IGraphics* pGraphics) {
    pGraphics->AttachCornerResizer(iplug::igraphics::EUIResizerMode::Scale, false);
    pGraphics->AttachPanelBackground(iplug::igraphics::COLOR_DARK_GRAY);
    const iplug::igraphics::IRECT b = pGraphics->GetBounds();
    pGraphics->AttachControl(new iplug::igraphics::ITextControl(b.GetMidVPadded(40), "OpenAxe (scaffold) — IGraphics OK", iplug::igraphics::IText(20, iplug::igraphics::COLOR_WHITE)));
  };
#endif
#endif
}

OpenAxePlugin::~OpenAxePlugin() {
#ifdef OPENAXE_HAS_WEBVIEW
  if (uiServerAcquired_) {
    openaxe_vst3::SharedUiServer::Release();
    uiServerAcquired_ = false;
  }
  bridge_.reset();
#endif
  nam_studio_graph_destroy(graph_);
}

#if IPLUG_DSP
void OpenAxePlugin::OnReset() {
  // Host calls OnReset on the audio thread before the first ProcessBlock
  // and on every sample-rate or block-size change (including host resume).
  // This is Tier 2 (allocates) so it must not race ProcessBlock. iPlug2
  // guarantees OnReset is not concurrent with ProcessBlock, but future
  // control-thread callers (UI-driven reconfigure) should use WithSuspend.
  const double sr = GetSampleRate();
  int bs = GetBlockSize();
  // Guard against hosts reporting 0 before a stream is fully configured.
  if (bs <= 0) bs = 512;
  sample_rate_.store(sr, std::memory_order_release);
  max_block_size_.store(bs, std::memory_order_release);
  // Size the channel-conversion scratch here, once, so ProcessBlock never
  // touches the heap or a large stack frame (issue #300 C2).
  EnsureScratch(bs);
  tap_.Clear();  // the retained window is from the previous configuration
  nam_studio_reset(graph_, sr, bs);
}

void OpenAxePlugin::EnsureScratch(int frames) const {
  // Main/reset-thread only — allocates.
  if (frames <= scratch_frames_) return;
  scratch_frames_ = frames;
  scratch_in_.assign(static_cast<size_t>(kMaxChans) * static_cast<size_t>(frames), 0.0f);
  scratch_out_.assign(static_cast<size_t>(kMaxChans) * static_cast<size_t>(frames), 0.0f);
}

void OpenAxePlugin::OnActivate(bool enable) {
  // Some hosts resume by re-activating rather than re-resetting; ensure the
  // graph is re-armed with the current host SR/BS so stale buffers are not
  // reused. No-op when deactivating.
  if (!enable) return;
  const double sr = GetSampleRate();
  const int bs = GetBlockSize();
  // Only poke the graph if something actually changed (host sample-rate
  // queries can spuriously round-trip through OnActivate with no change).
  if (sr == sample_rate_.load(std::memory_order_acquire) &&
      bs == max_block_size_.load(std::memory_order_acquire)) {
    return;
  }
  const int effective_bs = bs > 0 ? bs : max_block_size_.load(std::memory_order_acquire);
  sample_rate_.store(sr, std::memory_order_release);
  max_block_size_.store(effective_bs, std::memory_order_release);
  EnsureScratch(effective_bs);
  nam_studio_reset(graph_, sr, effective_bs);
}

void OpenAxePlugin::SetInputChannelModeName(const std::string& name) {
  input_channel_mode_.store(static_cast<int>(InputChannelModeFromName(name)),
                            std::memory_order_relaxed);
}

std::string OpenAxePlugin::InputChannelModeNameValue() const {
  return InputChannelModeName(
      static_cast<InputChannelMode>(input_channel_mode_.load(std::memory_order_relaxed)));
}

void OpenAxePlugin::ProcessBlock(iplug::sample** inputs, iplug::sample** outputs, int nFrames) {
  // Suspend handshake: control thread raised suspend_requested_ before
  // mutating the graph. Acknowledge and silence this block so no
  // nam_studio_process runs concurrently with that mutation (port of
  // RtProcessCallback's suspend branch in apps/desktop/src/audio.cpp).
  if (suspend_requested_.load(std::memory_order_acquire)) {
    suspend_ack_.fetch_add(1, std::memory_order_release);
    ZeroOutputs(outputs, NOutChansConnected(), nFrames);
    return;
  }

  const int chunkLimit = max_block_size_.load(std::memory_order_acquire);
  // No OnReset yet (or a host that reported nothing usable): the core has not
  // been sized, and openaxe/api.h requires num_frames <= the max_block_size
  // passed to nam_studio_reset. A silent first block beats undefined
  // behaviour inside the core (issue #300 C5).
  if (chunkLimit <= 0 || scratch_frames_ <= 0) {
    ZeroOutputs(outputs, NOutChansConnected(), nFrames);
    return;
  }

  // Clamp to the scratch width. PLUG_CHANNEL_IO is "1-1 2-2" so a host should
  // never exceed kMaxChans, but inPtrs/outPtrs below are kMaxChans-wide arrays
  // and the core reads exactly as many as we declare — an unclamped count
  // would hand it pointers past the end of those arrays.
  const int nChansIn = std::min(NInChansConnected(), kMaxChans);
  const int nChansOut = std::min(NOutChansConnected(), kMaxChans);
  // Anything the host connected beyond what we process would otherwise be left
  // holding whatever was in the buffer.
  for (int c = kMaxChans; c < NOutChansConnected(); ++c) {
    if (outputs[c]) std::memset(outputs[c], 0, static_cast<size_t>(nFrames) * sizeof(iplug::sample));
  }
  ScopedDenormalDisable denormalGuard;

  // iplug::sample is double on macOS, core expects float. Convert through the
  // preallocated scratch — the per-chunk ceiling is min(host block size,
  // scratch capacity), so a host handing us more than it declared is still
  // processed, just in more pieces.
  const int maxChunk = std::min(chunkLimit, scratch_frames_);
  float* const inBase = scratch_in_.data();
  float* const outBase = scratch_out_.data();

  int offset = 0;
  while (offset < nFrames) {
    const int frames = std::min(maxChunk, nFrames - offset);
    const float* inPtrs[kMaxChans] = {nullptr, nullptr};
    float* outPtrs[kMaxChans] = {nullptr, nullptr};

    // Convert the host's channels into our float scratch first, then decide
    // which of them the rig actually hears. Routing after the conversion
    // means kSum can average in place, into a buffer we own.
    float* staged[kMaxChans] = {nullptr, nullptr};
    for (int c = 0; c < nChansIn; ++c) {
      if (!inputs[c]) continue;
      float* dst = inBase + static_cast<size_t>(c) * static_cast<size_t>(scratch_frames_);
      const iplug::sample* src = inputs[c] + offset;
      for (int i = 0; i < frames; ++i) dst[i] = static_cast<float>(src[i]);
      staged[c] = dst;
    }
    // A guitar is one cable on a stereo track, so feeding the bus through
    // untouched would run the rig on a half-silent pair. Mirrors the web's
    // channel modes exactly (see input_routing.h).
    const int coreChansIn = RouteInput(
        static_cast<InputChannelMode>(input_channel_mode_.load(std::memory_order_relaxed)),
        staged, nChansIn, frames, inPtrs);
    for (int c = 0; c < nChansOut; ++c) {
      if (!outputs[c]) continue;
      outPtrs[c] = outBase + static_cast<size_t>(c) * static_cast<size_t>(scratch_frames_);
    }

    nam_studio_process(graph_, inPtrs, coreChansIn, outPtrs, nChansOut, frames);

    // Capture the window the UI's meters/scope/tuner read (issue #300 E4c).
    // Both sides come from the float scratch, so this is a straight copy into a
    // preallocated ring — no allocation and no locking on the audio thread.
    //
    // When the routing collapsed the input to mono, show that mono signal on
    // both sides rather than passing a null second channel: MonitorTap skips
    // a null channel instead of clearing it, so the input meter's right half
    // would otherwise sit on whatever it last held, frozen and stale.
    const float* tapIn[kMaxChans] = {inPtrs[0], coreChansIn >= 2 ? inPtrs[1] : inPtrs[0]};
    tap_.Write(coreChansIn > 0 ? tapIn : nullptr, outPtrs, static_cast<unsigned int>(frames));

    for (int c = 0; c < nChansOut; ++c) {
      if (!outputs[c] || !outPtrs[c]) continue;
      iplug::sample* dst = outputs[c] + offset;
      const float* src = outPtrs[c];
      for (int i = 0; i < frames; ++i) dst[i] = static_cast<iplug::sample>(src[i]);
    }
    offset += frames;
  }
}

bool OpenAxePlugin::BeginSuspend() const {
  // Matches AudioIO::BeginSuspend semantics: if the host isn't currently
  // inside ProcessBlock (no reliable way to know from the plugin API), we
  // still raise the flag and wait one ack cycle. If the audio thread is
  // idle (host stopped), we'll time out — mutation is still safe because
  // no process() is running anyway. Timeout mirrors desktop's 2s window.
  const unsigned before = suspend_ack_.load(std::memory_order_acquire);
  suspend_requested_.store(true, std::memory_order_release);
  for (int i = 0; i < 2000; ++i) {
    if (suspend_ack_.load(std::memory_order_acquire) > before) return true;
    // First few spins are cheap (hosts call ProcessBlock every few ms); yield
    // before sleeping so sub-ms handoffs don't burn 1ms each.
    if (i < 20) std::this_thread::yield();
    else std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  // Audio thread stalled or host not processing — safe to mutate anyway
  // (desktop's fallback stops the stream first; there's no stream to stop
  // here, but the guarantee "no process() in flight" holds as long as the
  // host honourably doesn't call ProcessBlock while suspended).
  return false;
}

void OpenAxePlugin::EndSuspend() const { suspend_requested_.store(false, std::memory_order_release); }

bool OpenAxePlugin::SerializeState(iplug::IByteChunk& chunk) const {
  // Host is saving the project / .vstpreset — produce a self-contained JSON
  // document with embedded assets (issue #128). Suspend to get a consistent
  // snapshot; serialize allocates and reads topology.
  std::string json;
  WithSuspend([&] { json = openaxe_vst3::state::SerializeForHost(graph_); });
  if (json.empty()) return false;
  // Persist editor size (issue #132) alongside the rig — hosts that save the
  // chunk also save the window size; ignored when absent (defaults).
  if (editor_) {
    json = openaxe_vst3::editor::SizeToStateJson(editor_->GetSize(), json);
  }
  // Input routing belongs to the track, so it rides the host chunk rather
  // than the shared library — reopening the project restores the same wiring.
  json = InputChannelToStateJson(
      static_cast<InputChannelMode>(input_channel_mode_.load(std::memory_order_relaxed)), json);
  chunk.Clear();
  chunk.PutStr(json.c_str());
  return true;
}

int OpenAxePlugin::UnserializeState(const iplug::IByteChunk& chunk, int startPos) {
  WDL_String json;
  int endPos = chunk.GetStr(json, startPos);
  if (endPos <= startPos || json.GetLength() == 0) {
    // No chunk data — let the host's param fallback handle it (and don't
    // claim we consumed anything beyond startPos).
    return startPos;
  }
  // Restore editor size (issue #132) before topology — size never touches audio.
  if (editor_) {
    const auto sz = openaxe_vst3::editor::SizeFromStateJson(json.Get());
    editor_->SetSize(sz.width, sz.height);
  }
  // Same as size: no audio thread involvement, so restore it before topology.
  input_channel_mode_.store(static_cast<int>(InputChannelFromStateJson(json.Get())),
                            std::memory_order_relaxed);
  // Restore topology + params. State helpers do the single reset (#62) and
  // leave the graph untouched on parse / version errors (#64 graceful).
  // Must be suspended (Tier 2).
  WithSuspend([&] {
    (void)openaxe_vst3::state::Restore(graph_, json.Get(),
                                      sample_rate_.load(std::memory_order_acquire),
                                      max_block_size_.load(std::memory_order_acquire));
  });
#ifdef OPENAXE_HAS_WEBVIEW
  // The graph was just replaced and the core reassigned block ids, so the
  // bridge's maps describe the previous session. Rebuilding them here is what
  // makes host save/restore work at all: without it every subsequent
  // setParam/blockInfo from the UI addressed the wrong block (issue #300 D1).
  if (bridge_) bridge_->SyncFromCore();
#endif
  // Hosts that also serialized params after the JSON (some iPlug callers do
  // PutChunk of params) will have trailing bytes — try to apply them for
  // forward-compat, but don't fail if absent.
  if (endPos < chunk.Size()) {
    const int afterParams = UnserializeParams(chunk, endPos);
    if (afterParams > endPos) endPos = afterParams;
  }
  // For preset switching without glitches: the host will call this back-to-back;
  // suspend ensures ProcessBlock silences during the swap (no dropout due to
  // concurrent access, though a brief silence is audible — acceptable for
  // Phase 1, #128 Program change bullet).
  return endPos;
}

bool OpenAxePlugin::SavePortableJson(const std::string& path) const {
  bool ok = false;
  WithSuspend([&] { ok = openaxe_vst3::state::SavePortableJson(graph_, path); });
  return ok;
}

int OpenAxePlugin::LoadPortableJson(const std::string& path) {
  int result = NAM_STUDIO_LOAD_STATE_BAD_DOCUMENT;
  WithSuspend([&] {
    result = openaxe_vst3::state::LoadPortableJson(graph_, path,
                                                  sample_rate_.load(std::memory_order_acquire),
                                                  max_block_size_.load(std::memory_order_acquire));
  });
#ifdef OPENAXE_HAS_WEBVIEW
  if (bridge_) bridge_->SyncFromCore();  // same reason as UnserializeState
#endif
  return result;
}

std::vector<std::string> OpenAxePlugin::GetMissingAssets() const {
  // No suspend needed — MissingAssets reads atomic-adjacent state set by
  // Restore/UnserializeState, and that state is only written while suspended.
  return openaxe_vst3::state::MissingAssets(graph_);
}

int OpenAxePlugin::LoadNamModelFromPath(int32_t block_id, const std::string& path, std::string* error) {
  int res = static_cast<int>(openaxe_vst3::assets::LoadResult::UnknownBlock);
  WithSuspend([&] { res = static_cast<int>(openaxe_vst3::assets::LoadNamModelFromPath(graph_, block_id, path, error)); });
  return res;
}
int OpenAxePlugin::LoadNamModelFromJson(int32_t block_id, const std::string& json, std::string* error) {
  int res = static_cast<int>(openaxe_vst3::assets::LoadResult::UnknownBlock);
  WithSuspend([&] { res = static_cast<int>(openaxe_vst3::assets::LoadNamModelFromJson(graph_, block_id, json, error)); });
  return res;
}
int OpenAxePlugin::LoadIrWavFromPath(int32_t block_id, const std::string& path, std::string* error) {
  int res = static_cast<int>(openaxe_vst3::assets::LoadResult::UnknownBlock);
  WithSuspend([&] { res = static_cast<int>(openaxe_vst3::assets::LoadIrWavFromPath(graph_, block_id, path, error)); });
  return res;
}
int OpenAxePlugin::LoadIrWavFromBytes(int32_t block_id, const std::vector<uint8_t>& wav_bytes, std::string* error) {
  int res = static_cast<int>(openaxe_vst3::assets::LoadResult::UnknownBlock);
  WithSuspend([&] {
    res = static_cast<int>(openaxe_vst3::assets::LoadIrWavFromBytes(graph_, block_id, wav_bytes.data(), wav_bytes.size(), error));
  });
  return res;
}
int OpenAxePlugin::PickAndLoadNamModel(int32_t block_id, std::string* error) {
  auto path = openaxe_vst3::assets::PickNamFile();
  if (!path) {
    if (error) *error = "cancelled";
    return static_cast<int>(openaxe_vst3::assets::LoadResult::Cancelled);
  }
  return LoadNamModelFromPath(block_id, *path, error);
}
int OpenAxePlugin::PickAndLoadIrWav(int32_t block_id, std::string* error) {
  auto path = openaxe_vst3::assets::PickIrWavFile();
  if (!path) {
    if (error) *error = "cancelled";
    return static_cast<int>(openaxe_vst3::assets::LoadResult::Cancelled);
  }
  return LoadIrWavFromPath(block_id, *path, error);
}
bool OpenAxePlugin::GetModelInfo(int32_t block_id, double* out_sample_rate, int* out_has_loudness,
                                 double* out_loudness_db, int* out_is_slimmable, int* out_bp_count) const {
  auto info = openaxe_vst3::assets::GetModelInfo(graph_, block_id);
  if (!info || !info->has_model) return false;
  if (out_sample_rate) *out_sample_rate = info->sample_rate;
  if (out_has_loudness) *out_has_loudness = info->has_loudness ? 1 : 0;
  if (out_loudness_db) *out_loudness_db = info->loudness_db;
  if (out_is_slimmable) *out_is_slimmable = info->is_slimmable ? 1 : 0;
  if (out_bp_count) *out_bp_count = info->slim_breakpoint_count;
  return true;
}


bool OpenAxePlugin::NotifyHostParamChangedFromUI(int32_t block, int32_t param_index,
                                                 float real_value) {
#if IPLUG_DSP
  if (!graph_ || block < 0 || param_index < 0) return false;

  // No reverse block->slot lookup in the core ABI, and with only 16 slots a
  // linear scan is cheaper than maintaining a second map that could drift.
  for (int slot = openaxe::automation::kFirstBlockSlot;
       slot < openaxe::automation::kSlotCount; ++slot) {
    if (nam_studio_automation_slot_block(graph_, slot) != block) continue;
    if (param_index >= openaxe::automation::kParamsPerSlot) return false;

    const char* name = nullptr;
    const char* sym = nullptr;
    const char* unit = nullptr;
    float mn = 0.0f, mx = 1.0f;
    if (nam_studio_automation_slot_param_info(graph_, slot, param_index, &name, &sym, &mn, &mx,
                                              &unit) == 0) {
      return false;  // slot has no descriptor at this entry
    }
    const int host_id = openaxe_vst3::params::SlotEntryToHostId(slot, param_index);
    if (host_id < 0 || host_id >= openaxe_vst3::params::HostParamCount()) return false;

    const double norm = openaxe_vst3::params::RealToNormalized(real_value, mn, mx);
    // Begin/end bracket the change as a gesture, which is what a host records
    // as an automation move rather than a one-off value poke.
    BeginInformHostOfParamChangeFromUI(host_id);
    SendParameterValueFromUI(host_id, norm);
    EndInformHostOfParamChangeFromUI(host_id);
    return true;
  }
  return false;
#else
  (void)block; (void)param_index; (void)real_value;
  return false;
#endif
}

openaxe_vst3::editor::Editor& OpenAxePlugin::GetEditor() {
  if (!editor_) editor_ = std::make_unique<openaxe_vst3::editor::Editor>(graph_);
  return *editor_;
}
const openaxe_vst3::editor::Editor& OpenAxePlugin::GetEditor() const {
  if (!editor_) editor_ = std::make_unique<openaxe_vst3::editor::Editor>(graph_);
  return *editor_;
}

void OpenAxePlugin::OnParamChange(int paramIdx) {
  // Host -> core automation write (issue #127). Host hands us a normalized
  // value through IParam::GetNormalized(); we forward through the slot map.
  // Most entries are lock-free (Tier 1). The Amp family's slim_size is Tier 2
  // and must be routed through the suspend handshake instead.
  const double norm = GetParam(paramIdx)->GetNormalized();
  bool needs_suspend = false;
  const bool ok = openaxe_vst3::params::HostParamWrite(graph_, paramIdx, static_cast<float>(norm),
                                                      needs_suspend);
  if (ok || !needs_suspend) return;

  // Tier-2 write (slim_size). VST3 and AU deliver parameter changes at block
  // start ON THE AUDIO THREAD, so calling WithSuspend here used to spin
  // BeginSuspend for up to ~2 s waiting for an ack that only ProcessBlock can
  // post — i.e. waiting for the thread we are already on. That is a
  // self-deadlock and a guaranteed dropout (issue #300 C1).
  //
  // Instead the request is parked in a lock-free slot and applied from
  // OnIdle() on the main thread. Coalescing to one pending value per host
  // param is deliberate: automation writes arrive far faster than a Tier-2
  // reset can be performed, and only the newest value matters.
  QueueDeferredParamWrite(paramIdx, static_cast<float>(norm));
}

void OpenAxePlugin::QueueDeferredParamWrite(int host_id, float normalized) {
  // Audio-thread side: no allocation, no lock, no wait.
  // Pass 1: coalesce onto the slot already owned by this param.
  for (auto& slot : deferred_writes_) {
    if (slot.host_id.load(std::memory_order_acquire) == host_id) {
      slot.normalized.store(normalized, std::memory_order_release);
      slot.pending.store(true, std::memory_order_release);
      return;
    }
  }
  // Pass 2: claim a free slot. A slot's host_id is claimed once and never
  // released, so the set of Tier-2 params seen this session is stable.
  for (auto& slot : deferred_writes_) {
    int empty = kNoHostParam;
    if (slot.host_id.compare_exchange_strong(empty, host_id, std::memory_order_acq_rel)) {
      slot.normalized.store(normalized, std::memory_order_release);
      slot.pending.store(true, std::memory_order_release);
      return;
    }
  }
  // Every slot taken by a different param. Dropping is the right failure mode
  // here: kDeferredWriteSlots covers every Tier-2 param the schema has, so
  // this is unreachable in practice, and stalling the audio thread to make
  // room would reintroduce exactly the bug this queue exists to fix.
}

void OpenAxePlugin::DrainDeferredParamWrites() {
  // Main-thread side: safe to suspend and allocate.
  for (auto& slot : deferred_writes_) {
    if (!slot.pending.exchange(false, std::memory_order_acq_rel)) continue;
    const int host_id = slot.host_id.load(std::memory_order_acquire);
    const float norm = slot.normalized.load(std::memory_order_acquire);
    if (host_id == kNoHostParam) continue;
    int slot_idx = -1, entry = -1;
    if (!openaxe_vst3::params::HostIdToSlotEntry(host_id, slot_idx, entry)) continue;
    WithSuspend([&] {
      const int32_t block = nam_studio_automation_slot_block(graph_, slot_idx);
      if (block < 0) return;
      const char* name = nullptr;
      const char* sym = nullptr;
      const char* unit = nullptr;
      float mn = 0.0f, mx = 1.0f;
      if (nam_studio_automation_slot_param_info(graph_, slot_idx, entry, &name, &sym, &mn, &mx,
                                                &unit) != 0) {
        const float real = openaxe_vst3::params::NormalizedToReal(norm, mn, mx);
        nam_studio_set_param(graph_, block, entry, real);
      }
    });
  }
}

void OpenAxePlugin::OnIdle() {
  // Called by iPlug2 on the main thread. This is where Tier-2 work parked by
  // the audio thread actually happens (issue #300 C1).
  DrainDeferredParamWrites();
}

void OpenAxePlugin::ProcessMidiMsg(const iplug::IMidiMsg& msg) {
  // Plugin MIDI bus — issue #124. The host forwards its event list
  // sample-accurately; the transport is CoreMIDI/ALSA/JACK on desktop
  // and the host's own event queue in a DAW. Core owns the mapping
  // model (which CC controls which param, learn mode, channel filter)
  // so every front end reuses it — this shell only forwards raw bytes
  // plus the per-event sample offset (mOffset) and lets core resolve
  // and apply the binding. Safe from any thread (shared lock), so
  // calling from the audio thread preserves sample accuracy.
  uint8_t data[3] = {msg.mStatus, msg.mData1, msg.mData2};
  int size = 3;
  // PC has only 2 bytes; the third is unused but core's parser tolerates it.
  if ((msg.mStatus & 0xF0) == 0xC0) size = 2;
  // Core returns 0 = not a trigger / no binding, 1 = dispatched, 2 = learn
  // completed — we don't need to act on it here (the core already applied).
  nam_studio_midi_handle_message(graph_, data, size, msg.mOffset, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr);
}

#endif
