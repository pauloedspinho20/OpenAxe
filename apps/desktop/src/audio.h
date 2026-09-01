#pragma once

#include <array>
#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "openaxe/api.h"

// Forward-declared rather than #include <juce_audio_devices/...>: JUCE's own
// CMake support compiles a linked module's sources directly into whichever
// target links it (see the PRIVATE-linking note on openaxe_desktop_lib in
// CMakeLists.txt), so anything that just #includes this header - the tests -
// must not also need JUCE's own headers/include paths, only these type names
// behind a unique_ptr (fine without a complete type - see audio.cpp, which
// does include the real header, for every actual use).
namespace juce {
class AudioIODeviceType;
class AudioIODevice;
}  // namespace juce

// The desktop shell's audio I/O layer (issue #15 M1): a thin wrapper over
// JUCE's juce_audio_devices module that opens a low-latency full-duplex
// stream and drives the shared C++ DSP core's openaxe_graph directly from
// the real-time callback - same process, zero IPC, no Web Audio anywhere in
// the path.
//
// Previously wrapped RtAudio; swapped out after a reproducible RtAudio
// CoreAudio-backend crash (garbage input pointer during its internal duplex
// bridging - see Open()'s comment). juce_audio_devices ships its own
// from-scratch per-platform backends, independent of RtAudio's source.
//
// Platform backends, selected at compile time (see the ctor):
//   macOS   CoreAudio
//   Windows WASAPI (shared mode); ASIO is a future opt-in
//   Linux   ALSA; JACK is a future opt-in
//
// Real-time thread priority is handled by the backend itself, same as it was
// under RtAudio.

namespace openaxe_desktop {

// Mirrors the web app's IODevice (apps/web/src/state/ioStore.ts): an id and a
// label per endpoint. JUCE identifies devices by name string, not a stable
// numeric id, so the id here is a hash of the name (see HashDeviceId in
// audio.cpp) - stable within a session and, incidentally, across relaunches,
// but the JS layer already treats device ids as ephemeral/not persisted
// across sessions (see ioStore.ts), so that's not a requirement.
struct AudioDeviceInfo {
  unsigned int id = 0;      // hash of the JUCE device name - see HashDeviceId
  std::string name;
  bool is_default = false;
  int input_channels = 0;
  int output_channels = 0;
  unsigned int preferred_sample_rate = 0;
  std::string api;          // e.g. "CoreAudio", "WASAPI", "JACK", "ALSA"
  // Directions the device provides. ListDevices() enumerates the union of
  // every backend-reported name and records which directions each has, so a
  // true duplex device sets both, while an interface exposed under separate
  // input/output names (e.g. the FM3) may set only one here and be paired up
  // at Open() time.
  bool is_input = true;
  bool is_output = true;
};

// The audio callback state + handler. A free function + plain struct so the
// DSP-in-callback wiring is directly unit-testable without hardware (tests
// call RtProcessCallback with fake buffers).
struct RtCallbackState {
  OpenAxeGraph* graph = nullptr;         // owned by the app; guarded by graph_ready
  std::atomic<bool> graph_ready{false};
  // Pause flag set by the control thread while it mutates the graph (topology
  // edits, NAM model loads, algorithm swaps). The audio callback, on observing
  // it, writes silence and bumps suspended_callbacks - the control thread waits
  // for that bump so it knows no openaxe_process is still in flight before
  // touching the graph. See AudioIO::BeginSuspend/EndSuspend.
  std::atomic<bool> suspend{false};
  std::atomic<unsigned int> suspended_callbacks{0};
  std::atomic<unsigned int> callbacks{0};
  std::atomic<unsigned int> frames_processed{0};

  // Set by AudioIO's device error callback (a different thread - see
  // AudioIO::HandleStreamError) when the stream hits a runtime error after
  // opening, most commonly a device disconnect: a second process (e.g.
  // a browser tab also using the same physical mic/speakers) forcing the OS
  // to reconfigure a device this stream is mid-callback on. The callback
  // checks this exactly like `suspend` - writes silence and stops calling
  // openaxe_process - so it never keeps reading/writing buffers against
  // input_channels/output_channels that may no longer match what the backend
  // is actually handing it. Cleared only by the next successful Open().
  std::atomic<bool> stream_error{false};

  // Actual channel counts of the open stream, set by AudioIO::Open before the
  // stream starts. The callback reads exactly these many channel pointers (a
  // mono input, e.g. a built-in mic, is 1 - reading a second pointer would be
  // out of bounds).
  int input_channels = 2;
  int output_channels = 2;

  // Input TRIM (the web UI's ioStore.inputGain), 1 = unity. The web engine
  // applies this with a GainNode between the input source and the rig; the
  // desktop shell owns its own device I/O, so it applies the same scalar here
  // instead (issue #115). Scaling happens before both openaxe_process and
  // the monitor tap, so the input meter and tuner see post-trim signal exactly
  // as they do on the web (where they hang off the GainNode's output).
  //
  // Atomic because the UI thread writes it while the audio thread reads it;
  // the callback never scales the backend's own input buffers in place (those
  // belong to the driver) - it copies into in_scratch, which is sized by
  // SetGraph on a non-audio thread so the callback never allocates.
  std::atomic<float> input_gain{1.0f};
  std::array<std::vector<float>, 2> in_scratch;

  // DI audition — replaces live input when playing (issue #273). The UI
  // thread writes di_buffer/di_playing via SetDIBuffer/PlayDI/StopDI;
  // the audio thread only reads when di_playing is true, so no lock is
  // taken on the real-time path. Loads happen while stopped, so the
  // audio thread never sees a torn write.
  std::vector<float> di_buffer;           // mono, graph sample rate
  std::atomic<size_t> di_pos{0};
  std::atomic<bool> di_playing{false};
  std::atomic<bool> di_loop{true};

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

// The real-time audio callback. Runs on the audio thread: allocates nothing,
// only calls openaxe_process(). If no graph is attached yet it writes
// silence to the output. Backend-agnostic (plain buffer pointers), called
// from AudioIO::Callback's audioDeviceIOCallbackWithContext override in
// audio.cpp.
int RtProcessCallback(void* output_buffer, void* input_buffer, unsigned int n_frames,
                      void* user_data);

class AudioIO {
 public:
  AudioIO();
  ~AudioIO();

  AudioIO(const AudioIO&) = delete;
  AudioIO& operator=(const AudioIO&) = delete;

  // Enumerate every audio endpoint (input and/or output), recording which
  // direction(s) each provides independently. A single physical interface may
  // appear under one shared name for both directions (true duplex) or under
  // separate input/output names; both show up. Open() accepts an input
  // endpoint and an output endpoint that need not be the same device (see
  // Open()'s createDevice(output_name, input_name) call - the old RtAudio
  // CoreAudio crash doing this, issue #53, no longer applies). Never throws.
  std::vector<AudioDeviceInfo> ListDevices() const;

  // Open a full-duplex stream. input_device/output_device are the ids
  // ListDevices() returned (see AudioDeviceInfo::id); pass 0xFFFFFFFF
  // (kDefaultDeviceId) for the platform default input/output - Open()
  // resolves it to the actual default device before opening. Channels are
  // fixed at 2 in / 2 out for now (the M3 UI's channel-routing modes land
  // with the bridge). Returns false on failure (see LastError).
  //
  // Latency:
  // - buffer_frames is the block size to request; the backend may adjust it
  //   (read BufferFrames() afterwards for what it actually granted).
  // - buffer_frames == kLowestLatencyBuffer (0) asks the backend for the
  //   smallest block the device supports (the minimum entry from
  //   AudioIODevice::getAvailableBufferSizes()). That is the lowest
  //   achievable round-trip, but a heavy NAM model can overrun a very small
  //   block, so it stays an explicit opt-in rather than the default.
  // - sample_rate falls back to the device's preferred rate when the
  //   requested one isn't in its supported list, which both avoids an open
  //   failure and keeps the OS from resampling underneath us.
  static constexpr unsigned int kLowestLatencyBuffer = 0;
  bool Open(unsigned int input_device, unsigned int output_device, double sample_rate,
            unsigned int buffer_frames);
  // Stop (if running) and close the stream.
  void Close();
  bool IsOpen() const;
  bool IsRunning() const;

  // Attach the DSP graph driven from the audio callback. Calls
  // openaxe_reset (not real-time safe) so it must be called before
  // Start(), from a non-audio thread. Passing nullptr detaches.
  void SetGraph(OpenAxeGraph* graph, double sample_rate, unsigned int max_block_size);

  // Input TRIM applied to the incoming signal before the graph and before the
  // monitor tap (see RtCallbackState::input_gain). 1 = unity. Safe to call
  // from any thread at any time, including while the stream is running -
  // it's a single atomic store, no suspend handshake needed.
  void SetInputGain(float gain);
  float InputGain() const;

  // DI audition (issue #273): replaces live input with a looping buffer
  // when active, still through input_gain and the graph.
  void SetDIBuffer(const std::vector<float>& samples);
  void PlayDI(bool loop);
  void StopDI();
  bool IsDIPlaying() const;

  // Start/stop the stream. Start() arms the callback's graph pointer, so it
  // is not real-time safe; call it from the UI thread before audio flows.
  bool Start();
  bool Stop();

  // Suspend/resume the audio callback around graph mutations. BeginSuspend
  // blocks until a callback has observed the pause (so any in-flight
  // openaxe_process has fully returned), then the caller may safely run
  // openaxe_* topology/model/algorithm calls. EndSuspend lifts the pause.
  // Both are no-ops thread-safely if the stream isn't running. BeginSuspend
  // returns false only if it timed out waiting (it force-stops the stream
  // first, so mutating the graph is still safe afterwards).
  bool BeginSuspend();
  void EndSuspend();

  double SampleRate() const;
  unsigned int BufferFrames() const;
  std::string LastError() const;

  // True (and clears the flag) if the stream hit a runtime error since the
  // last call - see RtCallbackState::stream_error. The caller (the bridge,
  // polled from the JS layer) is expected to Stop()/Close() the now-silent
  // stream and surface `message`; it must not call Stop/Close from inside
  // the device error callback itself (may run on a non-owning thread mid
  // teardown - see HandleStreamError).
  bool TakeStreamError(std::string* message);

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
  // Adapts juce::AudioIODeviceCallback (which AudioIO can't publicly inherit
  // without leaking JUCE types into this header) to RtProcessCallback, and
  // forwards device errors to HandleStreamError. Defined in audio.cpp.
  class Callback;

  // Registered on the device (device_->start(callback_.get())); JUCE invokes
  // it from whichever internal thread noticed the problem - not necessarily
  // the audio thread, and not synchronized with io_mutex_. Never opens/
  // closes/starts/stops the stream itself - only records the error for
  // TakeStreamError to pick up later from a normal caller thread. JUCE gives
  // no error-severity type to filter on (unlike RtAudio's RTAUDIO_WARNING),
  // so every call is treated as a real error.
  void HandleStreamError(const std::string& text);

  // Hashes a JUCE device name into the stable-within-a-session numeric id
  // AudioDeviceInfo::id/Open() use (see audio.h's top comment). Pure
  // function, defined in audio.cpp.
  static unsigned int HashDeviceId(const std::string& name);

  // Resolves an id (from ListDevices() or the kDefaultDevice sentinel) back
  // to the JUCE device name it came from, by freshly re-scanning type_ -
  // never relies on a cached id->name table, so it can't go stale between a
  // ListDevices() call and the Open() that follows it. Returns false (name
  // untouched) if no currently-present device matches.
  bool ResolveDeviceName(unsigned int id, bool input, std::string* name) const;

  // The platform's default device type (CoreAudio/WASAPI/ALSA), constructed
  // once in the ctor. Mutable so ListDevices()/ResolveDeviceName can stay
  // const even though scanForDevices()/createDevice() aren't const in JUCE.
  mutable std::unique_ptr<juce::AudioIODeviceType> type_;

  // Serializes stream control (Open/Close/Start/Stop) and BeginSuspend's
  // stop() against queries, since the webview thread and the control thread
  // both call into this object. Never taken by the audio callback.
  mutable std::mutex io_mutex_;

  // Declared BEFORE device_/callback_ so it is destroyed LAST. The audio
  // callback and the webview bridge both reach into this struct by reference;
  // its lifetime must outlive both the JUCE audio thread (owned by device_)
  // and the Callback that carries a RtCallbackState&. Destroying it first (its
  // old position, after those members) freed the tap/in_scratch vectors while
  // a still-referencing thread could touch them - the exit-time heap
  // corruption (free_list_checksum_botch) / use-after-free in the bridge.
  RtCallbackState state_;

  // Created fresh by Open(), destroyed by Close(). Mutable for the same
  // reason as type_ (StreamLatencyFrames() etc. stay const).
  mutable std::unique_ptr<juce::AudioIODevice> device_;
  std::unique_ptr<Callback> callback_;

  unsigned int input_device_id_ = 0;
  unsigned int output_device_id_ = 0;
  double sample_rate_ = 48000.0;
  unsigned int buffer_frames_ = 128;
  std::string last_error_;

  // Separate from io_mutex_ - HandleStreamError must never risk blocking on
  // a lock an Open()/Close() call already holds while tearing the stream
  // down, since JUCE may invoke it from within that same teardown.
  mutable std::mutex error_mutex_;
  bool has_pending_stream_error_ = false;
  std::string pending_stream_error_;
};

}  // namespace openaxe_desktop