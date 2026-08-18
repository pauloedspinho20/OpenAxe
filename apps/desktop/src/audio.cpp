#include "audio.h"

#include <RtAudio.h>

#include <algorithm>
#include <chrono>
#include <cstring>
#include <mutex>
#include <thread>
#include <utility>

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

// RtAudio 6.x reports errors via return codes (RtAudioErrorType) and
// getErrorText(); it no longer throws exceptions. Every failure path below
// stores the backend's message in last_error_ so the JS bridge can surface
// it verbatim.

namespace {
// Sentinel meaning "platform default device" for Open(); RtAudio 6.x removed
// the RtAudio::ADevice constant but kept this historical value in spirit.
constexpr unsigned int kDefaultDevice = 0xFFFFFFFFu;

unsigned int ResolveDevice(unsigned int requested, bool input, RtAudio& audio) {
  if (requested != kDefaultDevice) return requested;
  const unsigned int count = audio.getDeviceCount();
  if (count == 0) return kDefaultDevice;
  return input ? audio.getDefaultInputDevice() : audio.getDefaultOutputDevice();
}
}  // namespace

int RtProcessCallback(void* output_buffer, void* input_buffer, unsigned int n_frames,
                      double /*stream_time*/, RtAudioStreamStatus /*status*/, void* user_data) {
  auto* state = static_cast<RtCallbackState*>(user_data);
  state->callbacks.fetch_add(1, std::memory_order_relaxed);
  state->frames_processed.fetch_add(n_frames, std::memory_order_relaxed);

  // RtAudio was opened with RTAUDIO_NONINTERLEAVED, so input_buffer/output_buffer
  // are arrays of `input_channels`/`output_channels` pointers. Read exactly that
  // many - a mono input (built-in mic) is a 1-element array, so a second read
  // would be out of bounds.
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

AudioIO::AudioIO() = default;

AudioIO::~AudioIO() {
  if (audio_.isStreamOpen()) audio_.closeStream();
}

std::vector<AudioDeviceInfo> AudioIO::ListDevices() const {
  std::vector<AudioDeviceInfo> devices;
  // RtAudio device ids are not contiguous across backends (CoreAudio uses
  // raw AudioDeviceIDs), so enumerate via getDeviceIds() - never 0..count-1.
  const std::vector<unsigned int> ids = audio_.getDeviceIds();
  if (ids.empty()) return devices;

  devices.reserve(ids.size());
  const std::string api = RtAudio::getApiName(audio_.getCurrentApi());
  for (const unsigned int id : ids) {
    RtAudio::DeviceInfo info = audio_.getDeviceInfo(id);
    AudioDeviceInfo d;
    d.id = id;
    d.name = info.name.empty() ? "Unknown device" : info.name;
    d.is_default = info.isDefaultInput || info.isDefaultOutput;
    d.input_channels = info.inputChannels;
    d.output_channels = info.outputChannels;
    d.preferred_sample_rate = info.preferredSampleRate;
    d.api = api;
    d.is_input = info.inputChannels > 0;
    d.is_output = info.outputChannels > 0;
    devices.push_back(std::move(d));
  }
  return devices;
}

bool AudioIO::Open(unsigned int input_device, unsigned int output_device, double sample_rate,
                   unsigned int buffer_frames) {
  std::lock_guard<std::mutex> lock(io_mutex_);
  last_error_.clear();
  if (audio_.isStreamOpen()) audio_.closeStream();

  const unsigned int input_id = ResolveDevice(input_device, /*input=*/true, audio_);
  const unsigned int output_id = ResolveDevice(output_device, /*input=*/false, audio_);

  // Two independent physical devices (this is the common case with no
  // external interface: the built-in mic + built-in speakers are separate
  // devices) hit two real problems - RtAudio's CoreAudio backend can crash
  // bridging them into one "asynchronous duplex" stream (issue #53), and
  // even when it doesn't, live mic monitoring straight into open speakers is
  // an acoustic feedback loop with no fix at this layer. Refuse outright
  // rather than let either happen - the user needs a single device that
  // does both (an audio interface, aggregate device, or virtual loopback),
  // not a silently degraded or crash-prone session.
  if (input_id != output_id) {
    last_error_ =
        "Input and output must be the same audio device - pick a single "
        "audio interface (or aggregate/loopback device) for both, not "
        "separate input and output devices.";
    return false;
  }

  RtAudio::StreamParameters in;
  in.deviceId = input_id;
  in.nChannels = 2;
  in.firstChannel = 0;

  RtAudio::StreamParameters out;
  out.deviceId = output_id;
  out.nChannels = 2;
  out.firstChannel = 0;

  RtAudio::StreamOptions options;
  options.flags = RTAUDIO_NONINTERLEAVED;
  options.flags |= RTAUDIO_SCHEDULE_REALTIME;
  options.numberOfBuffers = 0;  // backend default
  options.priority = 0;         // backend default

  // Clamp channels to what each device actually provides: a mono built-in mic
  // has 1 input channel, stereo speakers have 2 output channels. Requesting
  // more than a device offers makes RtAudio fail with "does not support the
  // requested channel count". Never exceed 2 (the rig is stereo internally).
  const RtAudio::DeviceInfo in_info = audio_.getDeviceInfo(input_id);
  const RtAudio::DeviceInfo out_info = audio_.getDeviceInfo(output_id);
  const int in_ch = std::min(2, static_cast<int>(in_info.inputChannels));
  const int out_ch = std::min(2, static_cast<int>(out_info.outputChannels));
  if (in_ch <= 0 || out_ch <= 0) {
    last_error_ = "input/output device has no usable channels";
    return false;
  }
  in.nChannels = in_ch;
  out.nChannels = out_ch;
  state_.input_channels = in_ch;
  state_.output_channels = out_ch;

  unsigned int frames = buffer_frames;
  const RtAudioErrorType result =
      audio_.openStream(&out, &in, RTAUDIO_FLOAT32, sample_rate, &frames, &RtProcessCallback,
                        &state_, &options);
  if (result != RTAUDIO_NO_ERROR) {
    last_error_ = audio_.getErrorText();
    return false;
  }

  input_device_id_ = input_id;
  output_device_id_ = output_id;
  sample_rate_ = audio_.getStreamSampleRate();
  buffer_frames_ = frames;  // backend may have adjusted the buffer size
  return true;
}

void AudioIO::Close() {
  std::lock_guard<std::mutex> lock(io_mutex_);
  if (audio_.isStreamOpen()) {
    audio_.closeStream();
    state_.graph_ready.store(false, std::memory_order_release);
  }
}

bool AudioIO::IsOpen() const {
  std::lock_guard<std::mutex> lock(io_mutex_);
  return audio_.isStreamOpen();
}

bool AudioIO::IsRunning() const {
  std::lock_guard<std::mutex> lock(io_mutex_);
  return audio_.isStreamRunning();
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
  const RtAudioErrorType result = audio_.startStream();
  if (result != RTAUDIO_NO_ERROR) {
    last_error_ = audio_.getErrorText();
    return false;
  }
  return true;
}

bool AudioIO::Stop() {
  std::lock_guard<std::mutex> lock(io_mutex_);
  last_error_.clear();
  if (audio_.isStreamRunning()) {
    const RtAudioErrorType result = audio_.stopStream();
    if (result != RTAUDIO_NO_ERROR) {
      last_error_ = audio_.getErrorText();
      return false;
    }
  }
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
  return audio_.getStreamLatency();
}

bool AudioIO::BeginSuspend() {
  std::lock_guard<std::mutex> lock(io_mutex_);
  // If the stream isn't running there is no audio thread touching the graph,
  // so there is nothing to synchronize with.
  if (!audio_.isStreamRunning()) return true;

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
  audio_.stopStream();
  return false;
}

void AudioIO::EndSuspend() {
  std::lock_guard<std::mutex> lock(io_mutex_);
  state_.suspend.store(false, std::memory_order_release);
}

}  // namespace nam_desktop