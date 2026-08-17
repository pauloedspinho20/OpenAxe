#pragma once

#include <RtAudio.h>

#include <array>
#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>

#include "nam_studio/api.h"

// The desktop shell's audio I/O layer (issue #15 M1): a thin wrapper over
// RtAudio that opens a low-latency full-duplex stream and drives the shared
// C++ DSP core's nam_studio_graph directly from the real-time callback -
// same process, zero IPC, no Web Audio anywhere in the path.
//
// Platform backends, selected by RtAudio at configure time:
//   macOS   CoreAudio (default)
//   Windows WASAPI (default); ASIO when built with RTAUDIO_API_ASIO + ASIO SDK
//   Linux   ALSA (default); JACK when built with RTAUDIO_API_JACK
//
// Real-time thread priority is handled by the RtAudio backend itself
// (CoreAudio/ALSA/JACK schedule the callback thread; WASAPI uses the
// pro-audio thread) plus the RTAUDIO_SCHEDULE_REALTIME flag on Open().

namespace nam_desktop {

// Mirrors the web app's IODevice (apps/web/src/state/ioStore.ts): an id and a
// label per endpoint. RtAudio has no stable "groupId" concept, so the JS
// bridge synthesizes one from the backend + device name in M2.
struct AudioDeviceInfo {
  unsigned int id = 0;      // RtAudio device id
  std::string name;
  bool is_default = false;
  int input_channels = 0;
  int output_channels = 0;
  unsigned int preferred_sample_rate = 0;
  std::string api;          // e.g. "CoreAudio", "WASAPI", "JACK", "ALSA"
  bool is_input = false;    // input_channels > 0
  bool is_output = false;   // output_channels > 0
};

// The RtAudio callback state + handler. A free function + plain struct so
// the DSP-in-callback wiring is directly unit-testable without hardware
// (tests call RtProcessCallback with fake buffers).
struct RtCallbackState {
  NamStudioGraph* graph = nullptr;         // owned by the app; guarded by graph_ready
  std::atomic<bool> graph_ready{false};
  // Pause flag set by the control thread while it mutates the graph (topology
  // edits, NAM model loads, algorithm swaps). The audio callback, on observing
  // it, writes silence and bumps suspended_callbacks - the control thread waits
  // for that bump so it knows no nam_studio_process is still in flight before
  // touching the graph. See AudioIO::BeginSuspend/EndSuspend.
  std::atomic<bool> suspend{false};
  std::atomic<unsigned int> suspended_callbacks{0};
  std::atomic<unsigned int> callbacks{0};
  std::atomic<unsigned int> frames_processed{0};

  // Actual channel counts of the open stream, set by AudioIO::Open before the
  // stream starts. The callback reads exactly these many channel pointers (a
  // mono input, e.g. a built-in mic, is 1 - reading a second pointer would be
  // out of bounds).
  int input_channels = 2;
  int output_channels = 2;

  // Monitor tap: ring buffers holding the most recent input (pre-graph) and
  // output (post-graph) stereo frames, captured by the audio thread and read
  // by the UI/control thread to drive facade analysers (block/input meters,
  // the tuner). Capacity is a full FFT window - the tuner's autocorrelation
  // needs ~4096 samples at 48kHz to resolve low bass.
  //
  // Guarded by a seqlock (tap_seq), not a mutex: the audio thread is the sole
  // writer and must never block on anything a non-real-time thread could hold
  // (a reader's resize()/copy behind a plain mutex is exactly the kind of
  // unbounded work that can stall or glitch the audio callback - see issue
  // #43). tap_seq is odd while a write is in progress, even otherwise; readers
  // retry if they observe odd or see the value change mid-read.
  static constexpr unsigned int kTapCapacity = 4096;
  std::atomic<uint64_t> tap_seq{0};
  std::array<std::vector<float>, 2> tap_in;   // [0]=L, [1]=R, pre-graph
  std::array<std::vector<float>, 2> tap_out;  // [0]=L, [1]=R, post-graph
  unsigned int tap_write_pos = 0;             // ring write index
  unsigned int tap_count = 0;                 // min(total written, capacity)
};

// A copy of the tap window, oldest-to-newest.
struct TapFrame {
  std::vector<float> l;
  std::vector<float> r;
  unsigned int frames = 0;
};

// Read up to `max_frames` of the most recent input (`input=true`) or output
// (`input=false`) frames from the ring buffer, oldest-to-newest. Lock-free
// (seqlock): never blocks, and never blocks the audio thread either - it only
// retries its own copy if the writer was mid-update.
TapFrame ReadTap(const RtCallbackState& state, bool input, unsigned int max_frames);

// RtAudio callback. Runs on the real-time audio thread: allocates nothing,
// only calls nam_studio_process(). If no graph is attached yet it writes
// silence to the output.
int RtProcessCallback(void* output_buffer, void* input_buffer, unsigned int n_frames,
                      double stream_time, RtAudioStreamStatus status, void* user_data);

class AudioIO {
 public:
  AudioIO();
  ~AudioIO();

  AudioIO(const AudioIO&) = delete;
  AudioIO& operator=(const AudioIO&) = delete;

  // Enumerate every audio endpoint (input- and output-capable). Never throws.
  std::vector<AudioDeviceInfo> ListDevices() const;

  // Open a full-duplex stream. input_device/output_device use RtAudio device
  // ids; pass 0xFFFFFFFF (kDefaultDeviceId, the classic RtAudio sentinel) for
  // the platform default input/output - Open() resolves it to the actual
  // default device id before calling openStream(). Channels are fixed at 2
  // in / 2 out for now (the M3 UI's channel-routing modes land with the
  // bridge). Returns false on failure (see LastError).
  bool Open(unsigned int input_device, unsigned int output_device, double sample_rate,
            unsigned int buffer_frames);
  // Stop (if running) and close the stream.
  void Close();
  bool IsOpen() const;
  bool IsRunning() const;

  // Attach the DSP graph driven from the audio callback. Calls
  // nam_studio_reset (not real-time safe) so it must be called before
  // Start(), from a non-audio thread. Passing nullptr detaches.
  void SetGraph(NamStudioGraph* graph, double sample_rate, unsigned int max_block_size);

  // Start/stop the stream. Start() arms the callback's graph pointer, so it
  // is not real-time safe; call it from the UI thread before audio flows.
  bool Start();
  bool Stop();

  // Suspend/resume the audio callback around graph mutations. BeginSuspend
  // blocks until a callback has observed the pause (so any in-flight
  // nam_studio_process has fully returned), then the caller may safely run
  // nam_studio_* topology/model/algorithm calls. EndSuspend lifts the pause.
  // Both are no-ops thread-safely if the stream isn't running. BeginSuspend
  // returns false only if it timed out waiting (it force-stops the stream
  // first, so mutating the graph is still safe afterwards).
  bool BeginSuspend();
  void EndSuspend();

  double SampleRate() const;
  unsigned int BufferFrames() const;
  std::string LastError() const;

  // Diagnostics (also surfaced to the UI via the M2 bridge): number of
  // callbacks and sample frames processed since the stream opened.
  unsigned int CallbackCount() const { return state_.callbacks.load(); }
  unsigned int FramesProcessed() const { return state_.frames_processed.load(); }

  // Copy of the monitor tap (see ReadTap). Safe from any thread.
  TapFrame GetTap(bool input, unsigned int max_frames) const {
    return ReadTap(state_, input, max_frames);
  }

  // The OS/device-reported I/O latency in frames (0 if no stream is open).
  long StreamLatencyFrames() const;

 private:
  // RtAudio 6.x marks none of its query methods const; mutable lets
  // ListDevices() stay const even though it walks the device list.
  mutable RtAudio audio_;
  // Serializes stream control (Open/Close/Start/Stop) and BeginSuspend's
  // stopStream against queries, since the webview thread and the control
  // thread both call into this object. Never taken by the audio callback.
  mutable std::mutex io_mutex_;
  RtCallbackState state_;
  unsigned int input_device_id_ = 0;
  unsigned int output_device_id_ = 0;
  double sample_rate_ = 48000.0;
  unsigned int buffer_frames_ = 128;
  std::string last_error_;
};

}  // namespace nam_desktop