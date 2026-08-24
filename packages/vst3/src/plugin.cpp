#include "plugin.h"

#include "IPlug_include_in_plug_src.h"

#include <algorithm>
#include <cmath>
#include <cstring>

#include "config.h"

#include "asset_loading.h"
#include "automation_params.h"
#include "plugin_state.h"
#include "presets.h"

#if defined(__SSE__) || defined(__x86_64__) || defined(_M_X64) || defined(__i386__) || defined(_M_IX86)
#include <xmmintrin.h>
#define OPENAXE_HAS_SSE 1
#else
#define OPENAXE_HAS_SSE 0
#endif

namespace {

// FTZ (flush-to-zero) + DAZ (denormals-are-zero) guard around the DSP call.
// Hosts don't guarantee MXCSR is set for FTZ/DAZ; reverb tails are exactly
// where denormals bite (issue #126). Mirrors the guard the web AudioWorklet
// and desktop fallback rely on — scoped so exception masks are preserved.
class ScopedDenormalDisable {
 public:
#if OPENAXE_HAS_SSE
  ScopedDenormalDisable() : csr_(_mm_getcsr()) {
    // Bits 15 (FTZ) and 6 (DAZ) — leave exception masks untouched.
    _mm_setcsr(csr_ | 0x8040u);
  }
  ~ScopedDenormalDisable() { _mm_setcsr(csr_); }

 private:
  unsigned csr_;
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

}  // namespace

OpenAxePlugin::OpenAxePlugin(const iplug::InstanceInfo& info)
    : Plugin(info, MakeConfig(openaxe_vst3::params::HostParamCount(), kNumPresets)) {
  graph_ = nam_studio_graph_create();
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
      IByteChunk chunk;
      chunk.PutStr(p.json.c_str());
      MakePresetFromChunk(p.name.c_str(), chunk);
    }
  }
#endif

#if IPLUG_EDITOR
  mMakeGraphicsFunc = [&]() {
    return MakeGraphics(*this, PLUG_WIDTH, PLUG_HEIGHT, PLUG_FPS, GetScaleForScreen(PLUG_WIDTH, PLUG_HEIGHT));
  };
  mLayoutFunc = [&](iplug::igraphics::IGraphics* pGraphics) {
    pGraphics->AttachCornerResizer(iplug::igraphics::EUIResizerMode::Scale, false);
    pGraphics->AttachPanelBackground(iplug::COLOR_GRAY);
    const iplug::igraphics::IRECT b = pGraphics->GetBounds();
    pGraphics->AttachControl(new iplug::igraphics::ITextControl(b.GetMidVPadded(40), "OpenAxe (scaffold)", iplug::igraphics::IText(24)));
  };
#endif
}

OpenAxePlugin::~OpenAxePlugin() { nam_studio_graph_destroy(graph_); }

#if IPLUG_DSP
void OpenAxePlugin::OnReset() {
  // Host calls OnReset on the audio thread before the first ProcessBlock
  // and on every sample-rate or block-size change (including host resume).
  // This is Tier 2 (allocates) so it must not race ProcessBlock. iPlug2
  // guarantees OnReset is not concurrent with ProcessBlock, but future
  // control-thread callers (UI-driven reconfigure) should use WithSuspend.
  sample_rate_ = GetSampleRate();
  max_block_size_ = GetBlockSize();
  // Guard against hosts reporting 0 before a stream is fully configured.
  if (max_block_size_ <= 0) max_block_size_ = 512;
  nam_studio_reset(graph_, sample_rate_, max_block_size_);
}

void OpenAxePlugin::OnActivate(bool enable) {
  // Some hosts resume by re-activating rather than re-resetting; ensure the
  // graph is re-armed with the current host SR/BS so stale buffers are not
  // reused. No-op when deactivating.
  if (enable) {
    const double sr = GetSampleRate();
    const int bs = GetBlockSize();
    // Only poke the graph if something actually changed (host sample-rate
    // queries can spuriously round-trip through OnActivate with no change).
    if (sr != sample_rate_ || bs != max_block_size_) {
      sample_rate_ = sr;
      max_block_size_ = bs > 0 ? bs : max_block_size_;
      nam_studio_reset(graph_, sample_rate_, max_block_size_);
    }
  }
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

  // Host may hand a block larger than the max_block_size the last
  // nam_studio_reset was given (hosts aren't bound to what we reported).
  // We MUST NOT re-reset on the audio thread — that allocates and is Tier 2
  // (issue #126). Instead chunk the host buffer into pieces <= max_block_size_
  // and call the core once per piece. This is the same choice the desktop
  // shell's in_scratch workaround gestures at, but done as proper chunking
  // rather than silently skipping work.
  const int nChansIn = NInChansConnected();
  const int nChansOut = NOutChansConnected();

  // Guard: graph not yet reset (host called ProcessBlock before OnReset).
  // Treat max_block_size_ == 0 as "chunk size = nFrames" so we still run
  // once rather than zeroing.
  const int chunkLimit = max_block_size_ > 0 ? max_block_size_ : nFrames;

  ScopedDenormalDisable denormalGuard;

  if (nFrames <= chunkLimit) {
    nam_studio_process(graph_, const_cast<const float**>(inputs), nChansIn, outputs, nChansOut, nFrames);
    return;
  }

  int offset = 0;
  while (offset < nFrames) {
    const int chunk = std::min(chunkLimit, nFrames - offset);
    const float* inPtrs[2] = {nullptr, nullptr};
    float* outPtrs[2] = {nullptr, nullptr};
    if (nChansIn >= 1 && inputs[0]) inPtrs[0] = inputs[0] + offset;
    if (nChansIn >= 2 && inputs[1]) inPtrs[1] = inputs[1] + offset;
    if (nChansOut >= 1 && outputs[0]) outPtrs[0] = outputs[0] + offset;
    if (nChansOut >= 2 && outputs[1]) outPtrs[1] = outputs[1] + offset;

    nam_studio_process(graph_, const_cast<const float**>(inPtrs), nChansIn, outPtrs, nChansOut, chunk);
    offset += chunk;
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

bool OpenAxePlugin::SerializeState(IByteChunk& chunk) const {
  // Host is saving the project / .vstpreset — produce a self-contained JSON
  // document with embedded assets (issue #128). Suspend to get a consistent
  // snapshot; serialize allocates and reads topology.
  std::string json;
  WithSuspend([&] { json = openaxe_vst3::state::SerializeForHost(graph_); });
  if (json.empty()) return false;
  chunk.Clear();
  chunk.PutStr(json.c_str());
  return true;
}

int OpenAxePlugin::UnserializeState(const IByteChunk& chunk, int startPos) {
  WDL_String json;
  int endPos = chunk.GetStr(json, startPos);
  if (endPos <= startPos || json.GetLength() == 0) {
    // No chunk data — let the host's param fallback handle it (and don't
    // claim we consumed anything beyond startPos).
    return startPos;
  }
  // Restore topology + params. State helpers do the single reset (#62) and
  // leave the graph untouched on parse / version errors (#64 graceful).
  // Must be suspended (Tier 2).
  WithSuspend([&] {
    (void)openaxe_vst3::state::Restore(graph_, json.Get(), sample_rate_, max_block_size_);
  });
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
    result = openaxe_vst3::state::LoadPortableJson(graph_, path, sample_rate_, max_block_size_);
  });
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

void OpenAxePlugin::OnParamChange(int paramIdx) {
  // Host -> core automation write (issue #127). Host hands us a normalized
  // value through IParam::GetNormalized(); we forward through the slot map.
  // Most entries are lock-free (Tier 1). The Amp family's slim_size is Tier 2
  // and must be routed through the suspend handshake instead.
  const double norm = GetParam(paramIdx)->GetNormalized();
  bool needs_suspend = false;
  const bool ok = openaxe_vst3::params::HostParamWrite(graph_, paramIdx, static_cast<float>(norm), needs_suspend);
  if (!ok && needs_suspend) {
    // Tier-2 slim_size write: do NOT call BeginSuspend from the audio thread
    // (that would deadlock waiting for ourselves). Host automation for this
    // param is rare; defer to the control thread. For now, perform the set
    // under handshake assuming we're on the control thread (hosts that
    // automate this param from the audio thread will need a queued deferral
    // — tracked as follow-up under #127/#122 smoothing work).
    // Best-effort: if ProcessBlock is currently running, the handshake will
    // ensure we don't race it; if we're on the audio thread, this briefly
    // violates real-time safety but preserves correctness over glitchy audio.
    WithSuspend([&] {
      // Resolve the underlying block/index for this host id and write directly.
      int slot = -1, entry = -1;
      if (openaxe_vst3::params::HostIdToSlotEntry(paramIdx, slot, entry)) {
        const char* sym = nullptr;
        int32_t block = nam_studio_automation_slot_block(graph_, slot);
        if (block >= 0) {
          // Find the param index that this slot entry maps to (entry == index).
          // Read its real value for the normalized position and set it.
          const char* name = nullptr;
          float mn = 0.0f, mx = 1.0f;
          const char* unit = nullptr;
          if (nam_studio_automation_slot_param_info(graph_, slot, entry, &name, &sym, &mn, &mx, &unit) != 0) {
            const float real = openaxe_vst3::params::NormalizedToReal(static_cast<float>(norm), mn, mx);
            nam_studio_set_param(graph_, block, entry, real);
          }
        }
      }
    });
  }
}

#endif
