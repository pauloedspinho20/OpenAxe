#include "audio.h"

// On Windows, windows.h (pulled in by miniaudio.h) defines function-like
// min/max macros that break std::min/std::max on MSVC (error C2589). JUCE's
// CMake setup defined NOMINMAX for us; now we define it ourselves before
// anything can include windows.h. The CMake WIN32 compile definition below
// is the primary guard - this covers any other include path.
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#endif

#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"

#include <algorithm>
#include <chrono>
#include <cstring>
#include <map>
#include <mutex>
#include <thread>
#include <utility>

#include "debug_log.h"

namespace openaxe_desktop {

namespace {
// Sizes the monitor-tap ring buffers. Called from a non-audio thread
// (SetGraph/Open) so the audio thread never allocates.
void InitTap(RtCallbackState& state) {
  for (auto& ch : state.tap_in) ch.assign(RtCallbackState::kTapCapacity, 0.0f);
  for (auto& ch : state.tap_out) ch.assign(RtCallbackState::kTapCapacity, 0.0f);
}

// Captures the most recent in/out frames into the ring buffer. Runs on the
// audio thread; wait-free (seqlock write side - see RtCallbackState::tap_seq).
void CaptureTap(RtCallbackState& state, const float* const* in, float* const* out,
                unsigned int n_frames) {
  // Uninitialized tap buffers (e.g. in unit tests that don't go through
  // SetGraph) are never written - the audio thread must not allocate.
  if (state.tap_in[0].size() != RtCallbackState::kTapCapacity) return;
  // Mark "write in progress" (odd) before touching the ring buffer, and
  // "stable" (even) after. release ordering keeps these two updates from
  // being reordered around the plain writes between them, so a reader who
  // observes an even sequence either side of its own read is guaranteed a
  // consistent snapshot. No lock is ever taken here - this thread never waits
  // on a reader, no matter how long the reader takes.
  state.tap_seq.fetch_add(1, std::memory_order_release);
  const unsigned int cap = RtCallbackState::kTapCapacity;
  for (unsigned int i = 0; i < n_frames; ++i) {
    const unsigned int idx = (state.tap_write_pos + i) % cap;
    if (in && in[0]) state.tap_in[0][idx] = in[0][i];
    if (in && in[1]) state.tap_in[1][idx] = in[1][i];
    if (out && out[0]) state.tap_out[0][idx] = out[0][i];
    if (out && out[1]) state.tap_out[1][idx] = out[1][i];
  }
  state.tap_write_pos = (state.tap_write_pos + n_frames) % cap;
  state.tap_count = std::min(cap, state.tap_count + n_frames);
  state.tap_seq.fetch_add(1, std::memory_order_release);
}

// Sentinel meaning "platform default device" for Open().
constexpr unsigned int kDefaultDevice = 0xFFFFFFFFu;

// Smallest duplex period used for kLowestLatencyBuffer (0): the minimum
// practical full-duplex block. A heavy NAM model can overrun a block this
// small, so it stays an explicit opt-in rather than the default.
constexpr unsigned int kMinPeriodFrames = 64;
// Conversion scratch capacity: covers any backend period with headroom. Sized
// on non-audio threads (Open); the data callback chunks if a backend ever
// hands it more than this.
constexpr unsigned int kMaScratchCap = 8192;

const char* BackendApiName(ma_backend backend) {
  const char* name = ma_get_backend_name(backend);
  return (name && name[0] != '\0') ? name : "miniaudio";
}

// Max channels across a device's native formats. An entry with channels == 0
// means "any channel count supported" - treat as stereo-capable (2). Zero
// entries (no detailed info) also means unknown: assume stereo-capable so the
// device still opens rather than being skipped.
int MaxChannelsOf(const ma_device_info& info) {
  if (info.nativeDataFormatCount == 0) return 2;
  int max_ch = 0;
  for (ma_uint32 i = 0; i < info.nativeDataFormatCount; ++i) {
    const ma_uint32 ch = info.nativeDataFormats[i].channels;
    if (ch == 0) return 2;
    max_ch = std::max(max_ch, static_cast<int>(ch));
  }
  return max_ch > 0 ? max_ch : 2;
}

bool SupportsRate(const ma_device_info& info, double rate) {
  if (info.nativeDataFormatCount == 0) return true;
  const auto want = static_cast<ma_uint32>(rate);
  for (ma_uint32 i = 0; i < info.nativeDataFormatCount; ++i) {
    const ma_uint32 sr = info.nativeDataFormats[i].sampleRate;
    if (sr == 0 || sr == want) return true;
  }
  return false;
}

// Device-preferred rate: 48 kHz when offered, else the highest offered, else
// 48 kHz when anything goes (sampleRate == 0 entries) or nothing is known.
unsigned int PreferredRateOf(const ma_device_info& info) {
  if (info.nativeDataFormatCount == 0) return 48000;
  bool any = false;
  unsigned int best = 0;
  for (ma_uint32 i = 0; i < info.nativeDataFormatCount; ++i) {
    const ma_uint32 sr = info.nativeDataFormats[i].sampleRate;
    if (sr == 0) {
      any = true;
      continue;
    }
    best = std::max(best, sr);
  }
  // 48 kHz if offered (checked separately so a higher max doesn't win).
  for (ma_uint32 i = 0; i < info.nativeDataFormatCount; ++i) {
    if (info.nativeDataFormats[i].sampleRate == 48000) return 48000;
  }
  if (best != 0) return best;
  if (any) return 48000;
  return 48000;
}

double FallbackRate(double want, const ma_device_info& info) {
  if (SupportsRate(info, want)) return want;
  return static_cast<double>(PreferredRateOf(info));
}
}  // namespace

TapFrame ReadTap(const RtCallbackState& state, bool input, unsigned int max_frames) {
  const unsigned int cap = RtCallbackState::kTapCapacity;
  const auto& src = input ? state.tap_in : state.tap_out;
  TapFrame out;
  // Seqlock read side: retry if the writer (the audio thread) was mid-update
  // either at the start or end of this copy. The writer never sees or waits
  // on this loop - only this reader ever retries.
  for (;;) {
    const uint64_t s1 = state.tap_seq.load(std::memory_order_acquire);
    if (s1 & 1u) continue;
    const unsigned int write_pos = state.tap_write_pos;
    const unsigned int n = std::min({max_frames, state.tap_count, cap});
    out.l.resize(n);
    out.r.resize(n);
    out.frames = n;
    for (unsigned int i = 0; i < n; ++i) {
      // Oldest of the window is `write_pos - n`; read forward from there.
      const unsigned int idx = (write_pos + cap - n + i) % cap;
      out.l[i] = src[0][idx];
      out.r[i] = src[1][idx];
    }
    const uint64_t s2 = state.tap_seq.load(std::memory_order_acquire);
    if (s1 == s2) break;
  }
  return out;
}

int RtProcessCallback(void* output_buffer, void* input_buffer, unsigned int n_frames,
                      void* user_data) {
  auto* state = static_cast<RtCallbackState*>(user_data);
  state->callbacks.fetch_add(1, std::memory_order_relaxed);
  state->frames_processed.fetch_add(n_frames, std::memory_order_relaxed);

  // The stream errored since it opened (see AudioIO::HandleStreamError,
  // typically a device disconnect from a second process touching the same
  // shared hardware mid-stream). Checked before touching input_buffer/
  // output_buffer at all - once the backend has reported a stream-level
  // error there is no guarantee left that those buffers still match
  // input_channels/output_channels (or are even valid), so this returns
  // without reading or writing anything, rather than risk an out-of-bounds
  // access on data whose shape may have changed underneath it. The app-level
  // Stop()/Close() (driven by TakeStreamError, polled from the JS layer)
  // tears the stream down properly shortly after.
  if (state->stream_error.load(std::memory_order_acquire)) return 0;

  // Buffers are arrays of `input_channels`/`output_channels` deinterleaved
  // pointers. Read exactly that many - a mono input (built-in mic) is a
  // 1-element array, so a second read would be out of bounds.
  const int in_ch = state->input_channels;
  const int out_ch = state->output_channels;
  const float* in_l = nullptr;
  const float* in_r = nullptr;
  float* out_l = nullptr;
  float* out_r = nullptr;
  if (input_buffer && in_ch >= 1) {
    auto** in = static_cast<float**>(input_buffer);
    in_l = in[0];
    if (in_ch >= 2) in_r = in[1];
  }
  if (output_buffer && out_ch >= 1) {
    auto** out = static_cast<float**>(output_buffer);
    out_l = out[0];
    if (out_ch >= 2) out_r = out[1];
  }
  const float* in_ptrs[2] = {in_l, in_r};
  float* out_ptrs[2] = {out_l, out_r};

  // DI audition (issue #273): when active, replaces live input with the
  // looping DI buffer, still through input_gain and the graph/tap.
  const float gain = state->input_gain.load(std::memory_order_relaxed);
  if (state->di_playing.load(std::memory_order_relaxed)) {
    const size_t size = state->di_buffer.size();
    if (size > 0 && state->in_scratch[0].size() >= n_frames) {
      size_t pos = state->di_pos.load(std::memory_order_relaxed);
      for (unsigned int i = 0; i < n_frames; ++i) {
        const float s = state->di_buffer[(pos + i) % size];
        state->in_scratch[0][i] = s * gain;
      }
      in_ptrs[0] = state->in_scratch[0].data();
      in_l = in_ptrs[0];
      if (in_ch >= 2 && state->in_scratch[1].size() >= n_frames) {
        for (unsigned int i = 0; i < n_frames; ++i) state->in_scratch[1][i] = state->in_scratch[0][i];
        in_ptrs[1] = state->in_scratch[1].data();
        in_r = in_ptrs[1];
      } else if (in_ch >= 2) {
        in_ptrs[1] = nullptr;
        in_r = nullptr;
      }
      size_t new_pos = pos + n_frames;
      if (state->di_loop.load(std::memory_order_relaxed)) {
        new_pos %= size;
      } else if (new_pos >= size) {
        new_pos = size;
        state->di_playing.store(false, std::memory_order_relaxed);
      }
      state->di_pos.store(new_pos, std::memory_order_relaxed);
    } else if (size == 0) {
      // No DI data — treat as silence but keep playing flag so UI doesn't spin.
      if (state->in_scratch[0].size() >= n_frames) {
        for (unsigned int i = 0; i < n_frames; ++i) state->in_scratch[0][i] = 0.0f;
        in_ptrs[0] = state->in_scratch[0].data();
        in_l = in_ptrs[0];
        if (in_ch >= 2 && state->in_scratch[1].size() >= n_frames) {
          for (unsigned int i = 0; i < n_frames; ++i) state->in_scratch[1][i] = 0.0f;
          in_ptrs[1] = state->in_scratch[1].data();
          in_r = in_ptrs[1];
        }
      }
    }
  } else if (in_l && gain != 1.0f && state->in_scratch[0].size() >= n_frames &&
             (!in_r || state->in_scratch[1].size() >= n_frames)) {
    // Input TRIM (issue #115) for live input at non-unity — same scratch
    // path as DI, but from the live buffer.
    for (unsigned int i = 0; i < n_frames; ++i) state->in_scratch[0][i] = in_l[i] * gain;
    in_ptrs[0] = state->in_scratch[0].data();
    if (in_r) {
      for (unsigned int i = 0; i < n_frames; ++i) state->in_scratch[1][i] = in_r[i] * gain;
      in_ptrs[1] = state->in_scratch[1].data();
    }
    in_l = in_ptrs[0];
  }

  // Suspended (graph mutation in progress): write silence and signal the
  // control thread that this callback observed the pause.
  if (state->suspend.load(std::memory_order_acquire)) {
    state->suspended_callbacks.fetch_add(1, std::memory_order_release);
    if (out_l) std::memset(out_l, 0, static_cast<size_t>(n_frames) * sizeof(float));
    if (out_r) std::memset(out_r, 0, static_cast<size_t>(n_frames) * sizeof(float));
    CaptureTap(*state, in_ptrs, out_ptrs, n_frames);
    return 0;
  }

  if (state->graph_ready.load(std::memory_order_acquire) && state->graph && n_frames > 0 &&
      out_l) {
    if (in_l) {
      openaxe_process(state->graph, in_ptrs, in_ch, out_ptrs, out_ch,
                         static_cast<int32_t>(n_frames));
    } else {
      // Output-only stream: feed silence into the graph.
      openaxe_process(state->graph, nullptr, 0, out_ptrs, out_ch,
                         static_cast<int32_t>(n_frames));
    }
  } else if (out_l) {
    std::memset(out_l, 0, static_cast<size_t>(n_frames) * sizeof(float));
    if (out_r) std::memset(out_r, 0, static_cast<size_t>(n_frames) * sizeof(float));
  }
  CaptureTap(*state, in_ptrs, out_ptrs, n_frames);
  return 0;
}

// miniaudio delivers interleaved f32 frames; the DSP core consumes
// deinterleaved per-channel pointers (see RtProcessCallback). Deinterleave
// into the pre-sized scratch, run the graph, interleave back - allocating
// nothing. Chunked so an unexpectedly large backend period can never overrun
// the scratch.
void AudioIO::DataCallback(struct ma_device* p_device, void* p_output, const void* p_input,
                           unsigned int frame_count) {
  if (!p_device || frame_count == 0) return;
  auto* self = static_cast<AudioIO*>(p_device->pUserData);
  if (!self) return;
  RtCallbackState& state = self->state_;
  const int in_ch = state.input_channels;
  const int out_ch = state.output_channels;

  const float* in_interleaved = static_cast<const float*>(p_input);
  float* out_interleaved = static_cast<float*>(p_output);

  unsigned int done = 0;
  while (done < frame_count) {
    const unsigned int cap = kMaScratchCap;
    unsigned int n = std::min(cap, frame_count - done);
    // Scratch is sized in Open(); if a unit test drives the state without
    // Open (no scratch), fall back to silence rather than allocate here.
    if (self->ma_in_[0].size() < n || self->ma_out_[0].size() < n) {
      if (out_interleaved) {
        std::memset(out_interleaved + static_cast<size_t>(done) * static_cast<size_t>(out_ch), 0,
                    static_cast<size_t>(n) * static_cast<size_t>(out_ch) * sizeof(float));
      }
      // Still count the frames through the backend-agnostic path so tap /
      // suspend / stream-error semantics stay identical (it handles null
      // buffers as silence).
      float* null_out[2] = {nullptr, nullptr};
      RtProcessCallback(null_out, nullptr, 0, &state);
      done += n;
      continue;
    }

    const float* chunk_in[2] = {nullptr, nullptr};
    float* chunk_out[2] = {nullptr, nullptr};
    if (in_interleaved && in_ch >= 1) {
      for (unsigned int i = 0; i < n; ++i) {
        self->ma_in_[0][i] = in_interleaved[(static_cast<size_t>(done) + i) * in_ch + 0];
      }
      chunk_in[0] = self->ma_in_[0].data();
      if (in_ch >= 2) {
        for (unsigned int i = 0; i < n; ++i) {
          self->ma_in_[1][i] = in_interleaved[(static_cast<size_t>(done) + i) * in_ch + 1];
        }
        chunk_in[1] = self->ma_in_[1].data();
      }
    }
    if (out_ch >= 1) {
      chunk_out[0] = self->ma_out_[0].data();
      if (out_ch >= 2) chunk_out[1] = self->ma_out_[1].data();
    }

    float* in_ptrs[2] = {const_cast<float*>(chunk_in[0]), const_cast<float*>(chunk_in[1])};
    float* out_ptrs[2] = {chunk_out[0], chunk_out[1]};
    RtProcessCallback(out_ptrs, in_ptrs, n, &state);

    if (out_interleaved && out_ch >= 1) {
      for (unsigned int i = 0; i < n; ++i) {
        out_interleaved[(static_cast<size_t>(done) + i) * out_ch + 0] = chunk_out[0][i];
        if (out_ch >= 2) {
          out_interleaved[(static_cast<size_t>(done) + i) * out_ch + 1] = chunk_out[1][i];
        }
      }
    }
    done += n;
  }
}

void AudioIO::NotificationCallback(const void* p_notification_void) {
  const auto* p_notification =
      static_cast<const ma_device_notification*>(p_notification_void);
  if (!p_notification || !p_notification->pDevice) return;
  auto* self = static_cast<AudioIO*>(p_notification->pDevice->pUserData);
  if (!self) return;
  switch (p_notification->type) {
    case ma_device_notification_type_rerouted:
      self->HandleStreamError("audio device rerouted (unplugged or default changed)");
      break;
    case ma_device_notification_type_interruption_began:
      self->HandleStreamError("audio device interrupted");
      break;
    default:
      break;  // started/stopped/interruption_ended/unlocked are not errors
  }
}

AudioIO::AudioIO() {
#if defined(__APPLE__)
  const ma_backend backends[] = {ma_backend_coreaudio};
#elif defined(_WIN32)
  const ma_backend backends[] = {ma_backend_wasapi};
#else
  const ma_backend backends[] = {ma_backend_alsa, ma_backend_pulseaudio, ma_backend_jack};
#endif
  auto ctx = std::make_unique<ma_context>();
  ma_context_config config = ma_context_config_init();
  const ma_result res =
      ma_context_init(backends, static_cast<ma_uint32>(sizeof(backends) / sizeof(backends[0])),
                      &config, ctx.get());
  if (res == MA_SUCCESS) {
    context_ = std::move(ctx);
    context_ok_ = true;
  } else {
    WriteLog("audio: miniaudio context init failed");
  }
  for (auto& v : ma_in_) v.assign(kMaScratchCap, 0.0f);
  for (auto& v : ma_out_) v.assign(kMaScratchCap, 0.0f);
}

AudioIO::~AudioIO() {
  if (device_) {
    ma_device_uninit(device_.get());
    device_.reset();
  }
  if (context_) {
    ma_context_uninit(context_.get());
    context_.reset();
  }
  context_ok_ = false;
}

void AudioIO::HandleStreamError(const std::string& text) {
  WriteLog("audio: stream error: " + text);

  // Do this first and unconditionally - even if a racing Close() flips the
  // stream shut right after, an audio callback that's already in flight (or
  // one more that sneaks in before the backend fully tears down) must not
  // keep trusting input_channels/output_channels against buffers whose real
  // shape may have just changed.
  state_.stream_error.store(true, std::memory_order_release);

  std::lock_guard<std::mutex> lock(error_mutex_);
  pending_stream_error_ = text.empty() ? "audio stream error" : text;
  has_pending_stream_error_ = true;
}

bool AudioIO::TakeStreamError(std::string* message) {
  std::lock_guard<std::mutex> lock(error_mutex_);
  if (!has_pending_stream_error_) return false;
  has_pending_stream_error_ = false;
  if (message) *message = pending_stream_error_;
  return true;
}

unsigned int AudioIO::HashDeviceId(const std::string& name) {
  // FNV-1a 32-bit: a pure function of the name, so ListDevices() and
  // ResolveDeviceName() never need a cached id->name table between them (and
  // ids incidentally stay stable across relaunches, though nothing requires
  // that - see the header's AudioDeviceInfo comment).
  uint32_t h = 0x811C9DC5u;
  for (unsigned char c : name) {
    h ^= c;
    h *= 0x01000193u;
  }
  if (h == kDefaultDevice) h ^= 1u;  // never collide with the sentinel
  return h;
}

bool AudioIO::ResolveDeviceName(unsigned int id, bool input, std::string* name) const {
  if (!context_ok_ || !context_) return false;
  ma_device_info* p_playback = nullptr;
  ma_uint32 playback_count = 0;
  ma_device_info* p_capture = nullptr;
  ma_uint32 capture_count = 0;
  if (ma_context_get_devices(context_.get(), &p_playback, &playback_count, &p_capture,
                             &capture_count) != MA_SUCCESS) {
    return false;
  }

  const ma_device_info* list = input ? p_capture : p_playback;
  const ma_uint32 count = input ? capture_count : playback_count;
  if (id == kDefaultDevice) {
    for (ma_uint32 i = 0; i < count; ++i) {
      if (list[i].isDefault) {
        *name = list[i].name;
        return true;
      }
    }
    if (count > 0) {
      *name = list[0].name;
      return true;
    }
    return false;
  }

  for (ma_uint32 i = 0; i < count; ++i) {
    if (HashDeviceId(list[i].name) == id) {
      *name = list[i].name;
      return true;
    }
  }
  return false;
}

std::vector<AudioDeviceInfo> AudioIO::ListDevices() const {
  std::vector<AudioDeviceInfo> devices;
  if (!context_ok_ || !context_) return devices;
  ma_device_info* p_playback = nullptr;
  ma_uint32 playback_count = 0;
  ma_device_info* p_capture = nullptr;
  ma_uint32 capture_count = 0;
  if (ma_context_get_devices(context_.get(), &p_playback, &playback_count, &p_capture,
                             &capture_count) != MA_SUCCESS) {
    return devices;
  }
  const std::string api = BackendApiName(context_->backend);

  // A single physical interface may be reported by the backend under one
  // shared name for both directions (a true duplex device) or under separate
  // input/output names (common for USB interfaces such as the FM3). Enumerate
  // the union of every name and record which directions each provides, so all
  // interfaces show up regardless of how the backend exposes them. Open() then
  // combines an input endpoint and an output endpoint - even two names of the
  // same device - into one duplex stream.
  std::map<std::string, AudioDeviceInfo> by_name;
  auto ensure = [&](const char* name, bool is_input, const ma_device_info& info) {
    const std::string key(name ? name : "");
    if (key.empty()) return;
    auto it = by_name.find(key);
    if (it == by_name.end()) {
      AudioDeviceInfo d;
      d.id = HashDeviceId(key);
      d.name = key;
      d.api = api;
      d.is_input = false;
      d.is_output = false;
      it = by_name.emplace(key, std::move(d)).first;
    }
    if (is_input) {
      it->second.is_input = true;
      const int ch = std::min(2, MaxChannelsOf(info));
      it->second.input_channels = std::max(it->second.input_channels, ch);
    } else {
      it->second.is_output = true;
      const int ch = std::min(2, MaxChannelsOf(info));
      it->second.output_channels = std::max(it->second.output_channels, ch);
    }
    if (info.isDefault) it->second.is_default = true;
    const unsigned int pref = PreferredRateOf(info);
    if (pref != 0 && (it->second.preferred_sample_rate == 0 ||
                      pref == 48000 || it->second.preferred_sample_rate != 48000)) {
      // Prefer 48 kHz when any side offers it, else keep the first seen.
      if (it->second.preferred_sample_rate == 0 || pref == 48000) {
        it->second.preferred_sample_rate = pref;
      }
    }
  };

  for (ma_uint32 i = 0; i < capture_count; ++i) ensure(p_capture[i].name, true, p_capture[i]);
  for (ma_uint32 i = 0; i < playback_count; ++i)
    ensure(p_playback[i].name, false, p_playback[i]);

  for (auto& [name, d] : by_name) {
    if (d.is_input && d.input_channels <= 0) continue;
    if (d.is_output && d.output_channels <= 0) continue;
    // A capture-only entry still reports output_channels 0 (and vice versa);
    // fill the missing side's count from the present side only for display
    // parity with the old backend is not needed - keep 0 for the absent side
    // so the JS layer can tell directions apart. The union entry itself is
    // always kept: Open() pairs endpoints across names.
    if (d.preferred_sample_rate == 0) d.preferred_sample_rate = 48000;
    devices.push_back(std::move(d));
  }
  return devices;
}

bool AudioIO::Open(unsigned int input_device, unsigned int output_device, double sample_rate,
                   unsigned int buffer_frames) {
  std::lock_guard<std::mutex> lock(io_mutex_);
  last_error_.clear();
  state_.stream_error.store(false, std::memory_order_release);
  {
    std::lock_guard<std::mutex> error_lock(error_mutex_);
    has_pending_stream_error_ = false;
  }
  if (device_) {
    ma_device_uninit(device_.get());
    device_.reset();
  }
  if (!context_ok_ || !context_) {
    last_error_ = "no audio backend available";
    return false;
  }

  // Fresh enumeration for both directions; never rely on a cached table.
  ma_device_info* p_playback = nullptr;
  ma_uint32 playback_count = 0;
  ma_device_info* p_capture = nullptr;
  ma_uint32 capture_count = 0;
  if (ma_context_get_devices(context_.get(), &p_playback, &playback_count, &p_capture,
                             &capture_count) != MA_SUCCESS) {
    last_error_ = "failed to enumerate audio devices";
    return false;
  }

  auto find = [&](unsigned int id, bool input, const ma_device_info** out) -> bool {
    const ma_device_info* list = input ? p_capture : p_playback;
    const ma_uint32 count = input ? capture_count : playback_count;
    if (count == 0) return false;
    if (id == kDefaultDevice) {
      for (ma_uint32 i = 0; i < count; ++i) {
        if (list[i].isDefault) {
          *out = &list[i];
          return true;
        }
      }
      *out = &list[0];
      return true;
    }
    for (ma_uint32 i = 0; i < count; ++i) {
      if (HashDeviceId(list[i].name) == id) {
        *out = &list[i];
        return true;
      }
    }
    return false;
  };

  const ma_device_info* in_info = nullptr;
  const ma_device_info* out_info = nullptr;
  if (!find(input_device, true, &in_info) || !find(output_device, false, &out_info)) {
    last_error_ = "requested audio device not found";
    return false;
  }

  // An input endpoint and an output endpoint may legitimately be different
  // device names (a single USB interface like the FM3 is often exposed under
  // separate input/output names, and some setups use different physical
  // devices for each). miniaudio's duplex device bridges them into one stream
  // with basic drift compensation between independently-clocked devices. The
  // one genuine hazard is an acoustic feedback loop (live mic straight into
  // open speakers); that's a user-facing choice we no longer try to police
  // here.
  ma_device_id in_id = in_info->id;
  ma_device_id out_id = out_info->id;

  // Clamp channels to what the device actually provides: a mono built-in mic
  // has 1 input channel, stereo speakers have 2 output channels. Never
  // exceed 2 (the rig is stereo internally).
  const int in_ch = std::min(2, MaxChannelsOf(*in_info));
  const int out_ch = std::min(2, MaxChannelsOf(*out_info));
  if (in_ch <= 0 || out_ch <= 0) {
    last_error_ = "input/output device has no usable channels";
    return false;
  }
  state_.input_channels = in_ch;
  state_.output_channels = out_ch;

  // Prefer a rate the device actually runs at: opening at an unsupported rate
  // either fails outright or makes the OS resample around us, which costs
  // both latency and fidelity for no benefit. When the two sides disagree,
  // the output side wins and miniaudio resamples the input in-app.
  double rate = FallbackRate(sample_rate, *out_info);
  if (!SupportsRate(*in_info, rate) && !SupportsRate(*in_info, sample_rate)) {
    // Input can't run at the output's rate either - keep the output's rate
    // (miniaudio resamples the capture side internally).
  }

  // buffer_frames == 0 means "as small as this device allows" - opt-in,
  // since a heavy NAM model can overrun a block that small (see the header).
  const unsigned int frames =
      (buffer_frames == kLowestLatencyBuffer) ? kMinPeriodFrames : buffer_frames;

  ma_device_config config = ma_device_config_init(ma_device_type_duplex);
  config.sampleRate = static_cast<ma_uint32>(rate);
  config.periodSizeInFrames = frames;
  config.periods = 3;
  config.performanceProfile = ma_performance_profile_low_latency;
  config.dataCallback = DataCallback;
  // audio.h can't name ma_device_notification (anonymous typedef, no tag to
  // forward-declare), so adapt with a captureless lambda of the exact
  // miniaudio signature. Defined here inside a member function, it can reach
  // the private NotificationCallback.
  config.notificationCallback = [](const ma_device_notification* p) {
    AudioIO::NotificationCallback(p);
  };
  config.pUserData = this;
  config.playback.format = ma_format_f32;
  config.playback.channels = static_cast<ma_uint32>(out_ch);
  config.playback.shareMode = ma_share_mode_shared;
  config.capture.format = ma_format_f32;
  config.capture.channels = static_cast<ma_uint32>(in_ch);
  config.capture.shareMode = ma_share_mode_shared;
  // Default endpoints: NULL selects the platform default. Explicit endpoints
  // use the enumerated IDs (copies above stay alive for the init call, which
  // copies them into the device).
  ma_device_id* p_in_id = (input_device == kDefaultDevice) ? nullptr : &in_id;
  ma_device_id* p_out_id = (output_device == kDefaultDevice) ? nullptr : &out_id;
  config.capture.pDeviceID = p_in_id;
  config.playback.pDeviceID = p_out_id;

  auto dev = std::make_unique<ma_device>();
  const ma_result res = ma_device_init(context_.get(), &config, dev.get());
  if (res != MA_SUCCESS) {
    last_error_ = std::string("failed to open audio device: ") + ma_result_description(res);
    return false;
  }

  device_ = std::move(dev);
  input_device_id_ = HashDeviceId(in_info->name);
  output_device_id_ = HashDeviceId(out_info->name);
  sample_rate_ = static_cast<double>(device_->sampleRate);
  buffer_frames_ = frames;
  // Conversion scratch: sized here (non-audio thread) so the callback never
  // allocates. Generous headroom over the requested period.
  const unsigned int scratch = std::max(frames * 2u, kMaScratchCap);
  for (auto& v : ma_in_) v.assign(scratch, 0.0f);
  for (auto& v : ma_out_) v.assign(scratch, 0.0f);
  return true;
}

void AudioIO::Close() {
  std::lock_guard<std::mutex> lock(io_mutex_);
  if (device_) {
    ma_device_uninit(device_.get());
    device_.reset();
    state_.graph_ready.store(false, std::memory_order_release);
  }
}

bool AudioIO::IsOpen() const {
  std::lock_guard<std::mutex> lock(io_mutex_);
  return device_ != nullptr;
}

bool AudioIO::IsRunning() const {
  std::lock_guard<std::mutex> lock(io_mutex_);
  return device_ != nullptr && ma_device_is_started(device_.get()) == MA_TRUE;
}

void AudioIO::SetGraph(OpenAxeGraph* graph, double sample_rate, unsigned int max_block_size) {
  InitTap(state_);  // non-audio thread, so the audio thread never allocates
  // Same reasoning for the TRIM scratch buffers (see RtCallbackState::
  // in_scratch). Sized generously: a backend may hand the callback a slightly
  // larger block than the one it granted, and the callback will not allocate.
  for (auto& ch : state_.in_scratch) ch.assign(std::max(max_block_size, 1u) * 2, 0.0f);
  // openaxe_reset is documented not real-time safe - this must be called
  // from a non-audio thread before Start(). Rebuild the graph while the
  // stream is stopped (or before it starts), then publish the pointer via
  // the acquire/release pair the callback reads.
  if (graph) openaxe_reset(graph, sample_rate, static_cast<int32_t>(max_block_size));
  state_.graph = graph;
  state_.graph_ready.store(graph != nullptr, std::memory_order_release);
}

void AudioIO::SetInputGain(float gain) {
  state_.input_gain.store(gain, std::memory_order_relaxed);
}

float AudioIO::InputGain() const { return state_.input_gain.load(std::memory_order_relaxed); }

void AudioIO::SetDIBuffer(const std::vector<float>& samples) {
  // Called with di_playing==false, so the audio thread isn't reading.
  state_.di_playing.store(false, std::memory_order_release);
  state_.di_pos.store(0, std::memory_order_release);
  state_.di_buffer = samples;
}

void AudioIO::PlayDI(bool loop) {
  if (state_.di_buffer.empty()) return;
  state_.di_pos.store(0, std::memory_order_release);
  state_.di_loop.store(loop, std::memory_order_release);
  state_.di_playing.store(true, std::memory_order_release);
}

void AudioIO::StopDI() {
  state_.di_playing.store(false, std::memory_order_release);
  state_.di_pos.store(0, std::memory_order_release);
}

bool AudioIO::IsDIPlaying() const {
  return state_.di_playing.load(std::memory_order_relaxed);
}

bool AudioIO::Start() {
  std::lock_guard<std::mutex> lock(io_mutex_);
  last_error_.clear();
  if (!device_) {
    last_error_ = "no audio device open";
    return false;
  }
  // Failures surface synchronously here; runtime disconnects surface
  // asynchronously via NotificationCallback/HandleStreamError (polled through
  // TakeStreamError), not a return code after start.
  if (ma_device_start(device_.get()) != MA_SUCCESS) {
    last_error_ = "failed to start audio device";
    return false;
  }
  return true;
}

bool AudioIO::Stop() {
  std::lock_guard<std::mutex> lock(io_mutex_);
  last_error_.clear();
  if (device_) ma_device_stop(device_.get());
  return true;
}

double AudioIO::SampleRate() const {
  std::lock_guard<std::mutex> lock(io_mutex_);
  return sample_rate_;
}

unsigned int AudioIO::BufferFrames() const {
  std::lock_guard<std::mutex> lock(io_mutex_);
  return buffer_frames_;
}

std::string AudioIO::LastError() const {
  std::lock_guard<std::mutex> lock(io_mutex_);
  return last_error_;
}

long AudioIO::StreamLatencyFrames() const {
  std::lock_guard<std::mutex> lock(io_mutex_);
  if (!device_) return 0;
  const long in_lat = static_cast<long>(device_->capture.internalPeriodSizeInFrames);
  const long out_lat = static_cast<long>(device_->playback.internalPeriodSizeInFrames);
  if (in_lat > 0 && out_lat > 0) return in_lat + out_lat;
  return static_cast<long>(buffer_frames_) * 2;
}

bool AudioIO::BeginSuspend() {
  std::lock_guard<std::mutex> lock(io_mutex_);
  // If the stream isn't running there is no audio thread touching the graph,
  // so there is nothing to synchronize with.
  if (!device_ || ma_device_is_started(device_.get()) != MA_TRUE) return true;

  const unsigned int before = state_.suspended_callbacks.load(std::memory_order_acquire);
  state_.suspend.store(true, std::memory_order_release);

  // Wait for a callback that saw the pause: that guarantees every earlier
  // openaxe_process call has completed (the audio thread is now inside
  // the silence branch and stays there until EndSuspend).
  for (int i = 0; i < 2000; ++i) {
    if (state_.suspended_callbacks.load(std::memory_order_acquire) > before) return true;
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }

  // Timed out - the device is stalling. Force the stream off; with no audio
  // thread running, mutating the graph afterwards is safe.
  ma_device_stop(device_.get());
  return false;
}

void AudioIO::EndSuspend() {
  std::lock_guard<std::mutex> lock(io_mutex_);
  state_.suspend.store(false, std::memory_order_release);
}

}  // namespace openaxe_desktop
