#include "audio.h"

#include <juce_audio_devices/juce_audio_devices.h>

#include <algorithm>
#include <chrono>
#include <cstring>
#include <map>
#include <mutex>
#include <thread>
#include <utility>

#include "debug_log.h"

namespace nam_desktop {

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

namespace {
// Sentinel meaning "platform default device" for Open().
constexpr unsigned int kDefaultDevice = 0xFFFFFFFFu;
}  // namespace

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
      nam_studio_process(state->graph, in_ptrs, in_ch, out_ptrs, out_ch,
                         static_cast<int32_t>(n_frames));
    } else {
      // Output-only stream: feed silence into the graph.
      nam_studio_process(state->graph, nullptr, 0, out_ptrs, out_ch,
                         static_cast<int32_t>(n_frames));
    }
  } else if (out_l) {
    std::memset(out_l, 0, static_cast<size_t>(n_frames) * sizeof(float));
    if (out_r) std::memset(out_r, 0, static_cast<size_t>(n_frames) * sizeof(float));
  }
  CaptureTap(*state, in_ptrs, out_ptrs, n_frames);
  return 0;
}

// Adapts juce::AudioIODeviceCallback to RtProcessCallback + HandleStreamError
// - see the forward declaration's doc comment in audio.h for why this is a
// private nested class rather than AudioIO itself inheriting the JUCE type.
class AudioIO::Callback : public juce::AudioIODeviceCallback {
 public:
  Callback(AudioIO& owner, RtCallbackState& state) : owner_(owner), state_(state) {}

  void audioDeviceIOCallbackWithContext(const float* const* input, int /*numInputChannels*/,
                                        float* const* output, int /*numOutputChannels*/,
                                        int numSamples,
                                        const juce::AudioIODeviceCallbackContext&) override {
    // input/output are deinterleaved per-channel pointer arrays, exactly the
    // shape RtProcessCallback already expects (only ever reads through
    // input's pointers, so casting away its const is safe).
    RtProcessCallback(const_cast<float**>(output), const_cast<float**>(input),
                      static_cast<unsigned int>(numSamples), &state_);
  }
  void audioDeviceAboutToStart(juce::AudioIODevice*) override {}
  void audioDeviceStopped() override {}
  void audioDeviceError(const juce::String& message) override {
    owner_.HandleStreamError(message.toStdString());
  }

 private:
  AudioIO& owner_;
  RtCallbackState& state_;
};

AudioIO::AudioIO() : callback_(std::make_unique<Callback>(*this, state_)) {
  // juce_audio_devices depends on juce_events, which needs a MessageManager
  // instance for some internal facilities (e.g. WASAPI's device-list
  // watching). This app never calls its runDispatchLoop() - the webview
  // shell's own native event loop keeps everything moving, exactly like a
  // JUCE plugin never owns its host's event loop either.
  juce::MessageManager::getInstance();

#if JUCE_MAC
  type_.reset(juce::AudioIODeviceType::createAudioIODeviceType_CoreAudio());
#elif JUCE_WINDOWS
  type_.reset(juce::AudioIODeviceType::createAudioIODeviceType_WASAPI(juce::WASAPIDeviceMode::shared));
#elif JUCE_LINUX
  type_.reset(juce::AudioIODeviceType::createAudioIODeviceType_ALSA());
#endif
}

AudioIO::~AudioIO() {
  if (device_ && device_->isOpen()) device_->close();
  // Tear the JUCE audio objects down first.
  device_.reset();
  type_.reset();
  // NOTE: we intentionally do NOT call juce::MessageManager::deleteInstance()
  // here. The comment above the getInstance() in the ctor explains the
  // singleton's origin; deleting it at teardown triggered a double-free /
  // heap-corruption crash (malloc_zone_error, SIGSEGV in the webview dispatch
  // path) because JUCE's own teardown still reached the same singleton. The
  // only cost of leaving it is a benign JUCE LeakedObjectDetector warning at
  // process exit - far preferable to a crash.
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
  if (!type_) return false;
  type_->scanForDevices();
  const juce::StringArray names = type_->getDeviceNames(input);
  if (names.isEmpty()) return false;

  if (id == kDefaultDevice) {
    int index = type_->getDefaultDeviceIndex(input);
    if (index < 0 || index >= names.size()) index = 0;
    *name = names[index].toStdString();
    return true;
  }

  for (const auto& n : names) {
    if (HashDeviceId(n.toStdString()) == id) {
      *name = n.toStdString();
      return true;
    }
  }
  return false;
}

std::vector<AudioDeviceInfo> AudioIO::ListDevices() const {
  std::vector<AudioDeviceInfo> devices;
  if (!type_) return devices;
  type_->scanForDevices();

  const juce::StringArray input_names = type_->getDeviceNames(true);
  const juce::StringArray output_names = type_->getDeviceNames(false);
  const int default_input = type_->getDefaultDeviceIndex(true);
  const int default_output = type_->getDefaultDeviceIndex(false);
  const std::string api = type_->getTypeName().toStdString();

  // A single physical interface may be reported by the backend under one
  // shared name for both directions (a true duplex device) or under separate
  // input/output names (common for USB interfaces such as the FM3). Enumerate
  // the union of every name and record which directions each provides, so all
  // interfaces show up regardless of how the backend exposes them. Open() then
  // combines an input endpoint and an output endpoint - even two names of the
  // same device - via createDevice(output_name, input_name).
  const juce::String def_in_name =
      (default_input >= 0 && default_input < input_names.size()) ? input_names[default_input]
                                                                 : juce::String();
  const juce::String def_out_name =
      (default_output >= 0 && default_output < output_names.size()) ? output_names[default_output]
                                                                    : juce::String();

  std::map<juce::String, AudioDeviceInfo> by_name;
  auto ensure = [&](const juce::String& name, bool is_input) -> AudioDeviceInfo& {
    auto it = by_name.find(name);
    if (it == by_name.end()) {
      AudioDeviceInfo d;
      d.id = HashDeviceId(name.toStdString());
      d.name = name.toStdString();
      d.api = api;
      d.is_input = false;
      d.is_output = false;
      it = by_name.emplace(name, std::move(d)).first;
    }
    if (is_input) it->second.is_input = true;
    else it->second.is_output = true;
    if (name == def_in_name || name == def_out_name) it->second.is_default = true;
    return it->second;
  };

  for (int i = 0; i < input_names.size(); ++i) ensure(input_names[i], true);
  for (int i = 0; i < output_names.size(); ++i) ensure(output_names[i], false);

  for (auto& [name, d] : by_name) {
    // Probe channel counts by creating the device for the directions it has.
    std::unique_ptr<juce::AudioIODevice> probe(
        type_->createDevice(d.is_output ? name : juce::String(),
                            d.is_input ? name : juce::String()));
    if (!probe) continue;
    const int in_ch = probe->getInputChannelNames().size();
    const int out_ch = probe->getOutputChannelNames().size();
    if (d.is_input && in_ch <= 0) continue;
    if (d.is_output && out_ch <= 0) continue;
    d.input_channels = in_ch;
    d.output_channels = out_ch;

    const juce::Array<double> rates = probe->getAvailableSampleRates();
    double preferred = 0.0;
    for (double r : rates) {
      if (r > preferred) preferred = r;
    }
    if (rates.contains(48000.0)) preferred = 48000.0;
    d.preferred_sample_rate = static_cast<unsigned int>(preferred);
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
    if (device_->isOpen()) device_->close();
    device_.reset();
  }
  if (!type_) {
    last_error_ = "no audio backend available";
    return false;
  }

  std::string input_name, output_name;
  if (!ResolveDeviceName(input_device, /*input=*/true, &input_name) ||
      !ResolveDeviceName(output_device, /*input=*/false, &output_name)) {
    last_error_ = "requested audio device not found";
    return false;
  }

  // An input endpoint and an output endpoint may legitimately be different
  // device names (a single USB interface like the FM3 is often exposed by
  // CoreAudio under separate input/output names, and some setups use
  // different physical devices for each). JUCE's createDevice(output, input)
  // bridges them into one stream cleanly - the old RtAudio CoreAudio crash
  // doing this (issue #53) no longer applies. The one genuine hazard is an
  // acoustic feedback loop (live mic straight into open speakers); that's a
  // user-facing choice we no longer try to police here.
  std::unique_ptr<juce::AudioIODevice> device(type_->createDevice(output_name, input_name));
  if (!device) {
    last_error_ = "failed to create audio device";
    return false;
  }

  // Clamp channels to what the device actually provides: a mono built-in mic
  // has 1 input channel, stereo speakers have 2 output channels. Never
  // exceed 2 (the rig is stereo internally).
  const int in_ch = std::min(2, device->getInputChannelNames().size());
  const int out_ch = std::min(2, device->getOutputChannelNames().size());
  if (in_ch <= 0 || out_ch <= 0) {
    last_error_ = "input/output device has no usable channels";
    return false;
  }
  state_.input_channels = in_ch;
  state_.output_channels = out_ch;

  // Prefer a rate the device actually runs at: opening at an unsupported rate
  // either fails outright or makes the OS resample around us, which costs
  // both latency and fidelity for no benefit.
  const juce::Array<double> rates = device->getAvailableSampleRates();
  double rate = sample_rate;
  if (!rates.contains(rate)) {
    double preferred = 0.0;
    for (double r : rates) {
      if (r > preferred) preferred = r;
    }
    if (rates.contains(48000.0)) preferred = 48000.0;
    if (preferred != 0.0) rate = preferred;
  }

  // buffer_frames == 0 means "as small as this device allows" - opt-in,
  // since a heavy NAM model can overrun a block that small (see the header).
  unsigned int frames = buffer_frames;
  if (buffer_frames == kLowestLatencyBuffer) {
    const juce::Array<int> sizes = device->getAvailableBufferSizes();
    int smallest = device->getDefaultBufferSize();
    for (int s : sizes) {
      if (s > 0 && (smallest <= 0 || s < smallest)) smallest = s;
    }
    frames = static_cast<unsigned int>(smallest);
  }

  juce::BigInteger in_mask, out_mask;
  in_mask.setRange(0, in_ch, true);
  out_mask.setRange(0, out_ch, true);

  const juce::String error = device->open(in_mask, out_mask, rate, static_cast<int>(frames));
  if (error.isNotEmpty()) {
    last_error_ = error.toStdString();
    return false;
  }

  device_ = std::move(device);
  input_device_id_ = HashDeviceId(input_name);
  output_device_id_ = HashDeviceId(output_name);
  sample_rate_ = device_->getCurrentSampleRate();
  buffer_frames_ = static_cast<unsigned int>(device_->getCurrentBufferSizeSamples());
  return true;
}

void AudioIO::Close() {
  std::lock_guard<std::mutex> lock(io_mutex_);
  if (device_) {
    if (device_->isOpen()) device_->close();
    device_.reset();
    state_.graph_ready.store(false, std::memory_order_release);
  }
}

bool AudioIO::IsOpen() const {
  std::lock_guard<std::mutex> lock(io_mutex_);
  return device_ && device_->isOpen();
}

bool AudioIO::IsRunning() const {
  std::lock_guard<std::mutex> lock(io_mutex_);
  return device_ && device_->isPlaying();
}

void AudioIO::SetGraph(NamStudioGraph* graph, double sample_rate, unsigned int max_block_size) {
  InitTap(state_);  // non-audio thread, so the audio thread never allocates
  // nam_studio_reset is documented not real-time safe - this must be called
  // from a non-audio thread before Start(). Rebuild the graph while the
  // stream is stopped (or before it starts), then publish the pointer via
  // the acquire/release pair the callback reads.
  if (graph) nam_studio_reset(graph, sample_rate, static_cast<int32_t>(max_block_size));
  state_.graph = graph;
  state_.graph_ready.store(graph != nullptr, std::memory_order_release);
}

bool AudioIO::Start() {
  std::lock_guard<std::mutex> lock(io_mutex_);
  last_error_.clear();
  if (!device_) {
    last_error_ = "no audio device open";
    return false;
  }
  // JUCE's start() is void - unlike RtAudio's startStream(), failures
  // surface asynchronously via audioDeviceError/HandleStreamError (polled
  // through TakeStreamError), not a synchronous return code here.
  device_->start(callback_.get());
  return true;
}

bool AudioIO::Stop() {
  std::lock_guard<std::mutex> lock(io_mutex_);
  last_error_.clear();
  if (device_ && device_->isPlaying()) device_->stop();
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
  return static_cast<long>(device_->getInputLatencyInSamples()) +
         static_cast<long>(device_->getOutputLatencyInSamples());
}

bool AudioIO::BeginSuspend() {
  std::lock_guard<std::mutex> lock(io_mutex_);
  // If the stream isn't running there is no audio thread touching the graph,
  // so there is nothing to synchronize with.
  if (!device_ || !device_->isPlaying()) return true;

  const unsigned int before = state_.suspended_callbacks.load(std::memory_order_acquire);
  state_.suspend.store(true, std::memory_order_release);

  // Wait for a callback that saw the pause: that guarantees every earlier
  // nam_studio_process call has completed (the audio thread is now inside
  // the silence branch and stays there until EndSuspend).
  for (int i = 0; i < 2000; ++i) {
    if (state_.suspended_callbacks.load(std::memory_order_acquire) > before) return true;
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }

  // Timed out - the device is stalling. Force the stream off; with no audio
  // thread running, mutating the graph afterwards is safe.
  device_->stop();
  return false;
}

void AudioIO::EndSuspend() {
  std::lock_guard<std::mutex> lock(io_mutex_);
  state_.suspend.store(false, std::memory_order_release);
}

}  // namespace nam_desktop
