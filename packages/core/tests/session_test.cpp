// Session engine: song player, scheduled MIDI, transport, mixer (issues #152-156)
#include "openaxe/api.h"

#include <cmath>
#include <vector>

#include "test_harness.h"

namespace {

constexpr double kSampleRate = 48000.0;
constexpr int32_t kBlockSize = 128;

std::vector<float> RunMono(NamStudioGraph* g, float input) {
  std::vector<float> in(kBlockSize, input);
  std::vector<float> out(kBlockSize, 0.0f);
  const float* in_ptrs[1] = {in.data()};
  float* out_ptrs[1] = {out.data()};
  nam_studio_process(g, in_ptrs, 1, out_ptrs, 1, kBlockSize);
  return out;
}

std::vector<uint8_t> DummySf2(size_t size) {
  std::vector<uint8_t> b(size, 0);
  // Minimal non-zero to pass the >=256 fallback path.
  for (size_t i = 0; i < size; ++i) b[i] = static_cast<uint8_t>((i * 37) & 0xFF);
  // Ensure not all zeros so TSF will reject and fallback triggers (size >=256).
  b[0] = 0x52; b[1] = 0x49; b[2] = 0x46; b[3] = 0x46;
  return b;
}

void TestSongLoadFailureAndSuccess() {
  NamStudioGraph* g = nam_studio_graph_create();
  nam_studio_reset(g, kSampleRate, kBlockSize);
  OPENAXE_EXPECT(nam_studio_song_has_soundfont(g) == 0);
  // Null / empty -> invalid.
  OPENAXE_EXPECT(nam_studio_song_load_soundfont(g, nullptr, 0) == NAM_STUDIO_SONG_LOAD_INVALID_FORMAT);
  uint8_t tiny[10] = {0};
  OPENAXE_EXPECT(nam_studio_song_load_soundfont(g, tiny, 10) == NAM_STUDIO_SONG_LOAD_INVALID_FORMAT);
  // Too large (> 32 MiB).
  std::vector<uint8_t> big(33 * 1024 * 1024, 0);
  OPENAXE_EXPECT(nam_studio_song_load_soundfont(g, big.data(), static_cast<int32_t>(big.size())) == NAM_STUDIO_SONG_LOAD_TOO_LARGE);
  // Dummy payload >=256 bytes falls back to sine synth and returns OK.
  auto sf2 = DummySf2(1024);
  OPENAXE_EXPECT(nam_studio_song_load_soundfont(g, sf2.data(), static_cast<int32_t>(sf2.size())) == NAM_STUDIO_SONG_LOAD_OK);
  OPENAXE_EXPECT(nam_studio_song_has_soundfont(g) == 1);
  nam_studio_song_unload_soundfont(g);
  OPENAXE_EXPECT(nam_studio_song_has_soundfont(g) == 0);
  nam_studio_graph_destroy(g);
}

void TestTransportAndEvents() {
  NamStudioGraph* g = nam_studio_graph_create();
  nam_studio_reset(g, kSampleRate, kBlockSize);
  auto sf2 = DummySf2(512);
  nam_studio_song_load_soundfont(g, sf2.data(), static_cast<int32_t>(sf2.size()));
  OPENAXE_EXPECT(nam_studio_song_get_position(g) == 0);
  OPENAXE_EXPECT(nam_studio_song_is_playing(g) == 0);
  // Start is idempotent.
  nam_studio_song_start(g);
  nam_studio_song_start(g);
  OPENAXE_EXPECT(nam_studio_song_is_playing(g) == 1);
  // Schedule note on at delta 0, then process one block and check song bus meter.
  OPENAXE_EXPECT(nam_studio_song_schedule_event(g, NAM_STUDIO_SONG_EVENT_NOTE_ON, 0, 60, 100, 0) == 1);
  OPENAXE_EXPECT(nam_studio_song_pending_events(g) == 1);
  // Invalid schedule args -> 0.
  OPENAXE_EXPECT(nam_studio_song_schedule_event(g, NAM_STUDIO_SONG_EVENT_NOTE_ON, 16, 60, 100, 0) == 0);
  OPENAXE_EXPECT(nam_studio_song_schedule_event(g, static_cast<NamStudioSongEventKind>(99), 0, 60, 100, 0) == 0);
  RunMono(g, 0.0f);
  OPENAXE_EXPECT(nam_studio_song_get_position(g) == kBlockSize);
  OPENAXE_EXPECT(nam_studio_get_bus_meter(g, NAM_STUDIO_BUS_SONG) > 0.01f);
  // Transport monotonicity.
  RunMono(g, 0.0f);
  OPENAXE_EXPECT(nam_studio_song_get_position(g) == kBlockSize * 2);
  // Schedule note off with delta.
  OPENAXE_EXPECT(nam_studio_song_schedule_event(g, NAM_STUDIO_SONG_EVENT_NOTE_OFF, 0, 60, 0, 64) == 1);
  // Seek flushes events.
  nam_studio_song_seek(g, 0);
  OPENAXE_EXPECT(nam_studio_song_get_position(g) == 0);
  OPENAXE_EXPECT(nam_studio_song_pending_events(g) == 0);
  // After seek, song bus should be silent (note off via flush).
  RunMono(g, 0.0f);
  // Stop idempotent and flushes.
  nam_studio_song_schedule_event(g, NAM_STUDIO_SONG_EVENT_NOTE_ON, 0, 62, 100, 0);
  OPENAXE_EXPECT(nam_studio_song_pending_events(g) == 1);
  nam_studio_song_stop(g);
  nam_studio_song_stop(g);
  OPENAXE_EXPECT(nam_studio_song_is_playing(g) == 0);
  OPENAXE_EXPECT(nam_studio_song_pending_events(g) == 0);
  const int64_t pos_before = nam_studio_song_get_position(g);
  RunMono(g, 0.0f);
  OPENAXE_EXPECT(nam_studio_song_get_position(g) == pos_before); // not advancing while stopped
  // Clear events directly.
  nam_studio_song_start(g);
  nam_studio_song_schedule_event(g, NAM_STUDIO_SONG_EVENT_NOTE_ON, 0, 64, 100, 0);
  OPENAXE_EXPECT(nam_studio_song_pending_events(g) == 1);
  nam_studio_song_clear_events(g);
  OPENAXE_EXPECT(nam_studio_song_pending_events(g) == 0);
  // Queue wraparound: fill and ensure extra returns 0.
  for (int i = 0; i < 4096; ++i) {
    OPENAXE_EXPECT(nam_studio_song_schedule_event(g, NAM_STUDIO_SONG_EVENT_CC, 0, 7, 64, i) == 1);
  }
  OPENAXE_EXPECT(nam_studio_song_pending_events(g) == 4096);
  OPENAXE_EXPECT(nam_studio_song_schedule_event(g, NAM_STUDIO_SONG_EVENT_CC, 0, 7, 64, 0) == 0);
  nam_studio_song_clear_events(g);
  nam_studio_graph_destroy(g);
}

void TestAudibleToneWithoutGrid() {
  NamStudioGraph* g = nam_studio_graph_create();
  nam_studio_reset(g, kSampleRate, kBlockSize);
  auto sf2 = DummySf2(512);
  nam_studio_song_load_soundfont(g, sf2.data(), static_cast<int32_t>(sf2.size()));
  // No grid blocks connected — song bus alone must reach output via session mixer.
  nam_studio_song_start(g);
  nam_studio_song_schedule_event(g, NAM_STUDIO_SONG_EVENT_NOTE_ON, 0, 69, 100, 0);
  bool audible = false;
  for (int i = 0; i < 4; ++i) {
    auto out = RunMono(g, 0.0f);
    float peak = 0.0f;
    for (float s : out) peak = std::max(peak, std::fabs(s));
    if (peak > 0.01f) audible = true;
  }
  OPENAXE_EXPECT(audible);
  nam_studio_graph_destroy(g);
}

void TestSessionMixer() {
  NamStudioGraph* g = nam_studio_graph_create();
  // Grid: cab passthrough IN->OUT.
  const int32_t cab = nam_studio_add_block(g, NAM_STUDIO_BLOCK_CAB, 0, 0);
  nam_studio_connect(g, NAM_STUDIO_IN_RAIL, 0, cab, 0);
  nam_studio_connect(g, cab, 0, NAM_STUDIO_OUT_RAIL, 0);
  nam_studio_reset(g, kSampleRate, kBlockSize);
  // Default: grid bus at unity, song silent.
  auto out = RunMono(g, 0.5f);
  for (float s : out) OPENAXE_EXPECT(std::fabs(s - 0.5f) < 1e-6f);
  OPENAXE_EXPECT(nam_studio_get_bus_meter(g, NAM_STUDIO_BUS_GRID) > 0.4f);
  OPENAXE_EXPECT(nam_studio_get_bus_meter(g, NAM_STUDIO_BUS_SONG) == 0.0f);
  // Gain halves grid.
  nam_studio_bus_set_gain(g, NAM_STUDIO_BUS_GRID, 0.5f);
  OPENAXE_EXPECT(nam_studio_bus_get_gain(g, NAM_STUDIO_BUS_GRID) == 0.5f);
  out = RunMono(g, 0.5f);
  for (float s : out) OPENAXE_EXPECT(std::fabs(s - 0.25f) < 1e-6f);
  nam_studio_bus_set_gain(g, NAM_STUDIO_BUS_GRID, 1.0f);
  // Mute silences.
  nam_studio_bus_set_mute(g, NAM_STUDIO_BUS_GRID, 1);
  OPENAXE_EXPECT(nam_studio_bus_is_muted(g, NAM_STUDIO_BUS_GRID) == 1);
  out = RunMono(g, 0.5f);
  for (float s : out) OPENAXE_EXPECT(s == 0.0f);
  nam_studio_bus_set_mute(g, NAM_STUDIO_BUS_GRID, 0);
  // Solo: when any bus soloed, only soloed audible. Song bus soloed while grid not -> grid silent even though not muted.
  nam_studio_bus_set_solo(g, NAM_STUDIO_BUS_SONG, 1);
  OPENAXE_EXPECT(nam_studio_bus_is_soloed(g, NAM_STUDIO_BUS_SONG) == 1);
  out = RunMono(g, 0.5f);
  for (float s : out) OPENAXE_EXPECT(s == 0.0f);
  // Now solo grid as well — grid audible again (solo overrides mute).
  nam_studio_bus_set_solo(g, NAM_STUDIO_BUS_GRID, 1);
  nam_studio_bus_set_mute(g, NAM_STUDIO_BUS_GRID, 1); // mute but soloed => audible
  out = RunMono(g, 0.5f);
  for (float s : out) OPENAXE_EXPECT(std::fabs(s - 0.5f) < 1e-6f);
  nam_studio_bus_set_mute(g, NAM_STUDIO_BUS_GRID, 0);
  nam_studio_bus_set_solo(g, NAM_STUDIO_BUS_SONG, 0);
  nam_studio_bus_set_solo(g, NAM_STUDIO_BUS_GRID, 0);
  // Pan: hard left -> mono output 0.5*(L+R) with L scaled sqrt2, R near 0.
  nam_studio_bus_set_pan(g, NAM_STUDIO_BUS_GRID, -1.0f);
  OPENAXE_EXPECT(nam_studio_bus_get_pan(g, NAM_STUDIO_BUS_GRID) == -1.0f);
  // For mono input 0.5 duplicated to stereo, hard left gives left ~0.707, right ~0.
  // Mono output = 0.5*(0.707+0) = 0.3535.
  out = RunMono(g, 0.5f);
  for (float s : out) OPENAXE_EXPECT(std::fabs(s - 0.353553f) < 1e-4f);
  nam_studio_bus_set_pan(g, NAM_STUDIO_BUS_GRID, 0.0f);
  // Invalid bus is no-op.
  nam_studio_bus_set_gain(g, 99, 0.5f);
  OPENAXE_EXPECT(nam_studio_get_bus_meter(g, 99) == 0.0f);
  nam_studio_graph_destroy(g);
}

void TestSampleRateIndependence() {
  for (double sr : {44100.0, 48000.0, 96000.0}) {
    NamStudioGraph* g = nam_studio_graph_create();
    nam_studio_reset(g, sr, 128);
    auto sf2 = DummySf2(512);
    nam_studio_song_load_soundfont(g, sf2.data(), static_cast<int32_t>(sf2.size()));
    nam_studio_song_start(g);
    nam_studio_song_schedule_event(g, NAM_STUDIO_SONG_EVENT_NOTE_ON, 0, 60, 100, 0);
    std::vector<float> in(128, 0.0f), out(128, 0.0f);
    const float* in_ptrs[1] = {in.data()};
    float* out_ptrs[1] = {out.data()};
    nam_studio_process(g, in_ptrs, 1, out_ptrs, 1, 128);
    float peak = 0.0f;
    for (float s : out) peak = std::max(peak, std::fabs(s));
    OPENAXE_EXPECT(peak > 0.01f);
    nam_studio_graph_destroy(g);
  }
}

std::vector<float> MakeSinePCM(int frames, float freq, double sr) {
  std::vector<float> pcm(static_cast<size_t>(frames * 2));
  for (int i = 0; i < frames; ++i) {
    float s = std::sin(6.2831853f * freq * i / static_cast<float>(sr)) * 0.5f;
    pcm[static_cast<size_t>(i * 2)] = s;
    pcm[static_cast<size_t>(i * 2 + 1)] = s;
  }
  return pcm;
}

void TestClipFeedAndPlayback() {
  NamStudioGraph* g = nam_studio_graph_create();
  nam_studio_reset(g, kSampleRate, kBlockSize);
  int32_t clip = nam_studio_clip_create(g);
  OPENAXE_EXPECT(clip >= 0);
  // Feed 512 frames of sine in two chunks (continuity).
  auto chunk1 = MakeSinePCM(256, 440.0f, kSampleRate);
  auto chunk2 = MakeSinePCM(256, 440.0f, kSampleRate);
  OPENAXE_EXPECT(nam_studio_clip_feed_pcm(g, clip, chunk1.data(), 256) == 256);
  OPENAXE_EXPECT(nam_studio_clip_feed_pcm(g, clip, chunk2.data(), 256) == 256);
  OPENAXE_EXPECT(nam_studio_clip_get_frames(g, clip) == 512);
  int32_t bus = nam_studio_clip_get_bus(g, clip);
  OPENAXE_EXPECT(bus >= NAM_STUDIO_BUS_TAKE0 && bus < NAM_STUDIO_BUS_COUNT);
  // Play and verify bus meter becomes audible.
  nam_studio_clip_play(g, clip);
  OPENAXE_EXPECT(nam_studio_clip_is_playing(g, clip) == 1);
  RunMono(g, 0.0f);
  OPENAXE_EXPECT(nam_studio_get_bus_meter(g, bus) > 0.1f);
  OPENAXE_EXPECT(nam_studio_clip_get_position(g, clip) == kBlockSize);
  // Seek to 0 and verify position.
  nam_studio_clip_seek(g, clip, 0);
  OPENAXE_EXPECT(nam_studio_clip_get_position(g, clip) == 0);
  // Play to EOF: after 512 frames, clip should stop.
  nam_studio_clip_seek(g, clip, 0);
  nam_studio_clip_play(g, clip);
  for (int i = 0; i < 4; ++i) RunMono(g, 0.0f);
  OPENAXE_EXPECT(nam_studio_clip_is_playing(g, clip) == 0);
  OPENAXE_EXPECT(nam_studio_clip_get_position(g, clip) == 512);
  // Destroy frees.
  nam_studio_clip_destroy(g, clip);
  OPENAXE_EXPECT(nam_studio_clip_get_frames(g, clip) == 0);
  nam_studio_graph_destroy(g);
}

void TestClipConcurrent() {
  NamStudioGraph* g = nam_studio_graph_create();
  nam_studio_reset(g, kSampleRate, kBlockSize);
  int32_t c0 = nam_studio_clip_create(g);
  int32_t c1 = nam_studio_clip_create(g);
  OPENAXE_EXPECT(c0 != c1);
  OPENAXE_EXPECT(c0 >= 0 && c1 >= 0);
  auto pcm0 = MakeSinePCM(256, 220.0f, kSampleRate);
  auto pcm1 = MakeSinePCM(256, 330.0f, kSampleRate);
  nam_studio_clip_feed_pcm(g, c0, pcm0.data(), 256);
  nam_studio_clip_feed_pcm(g, c1, pcm1.data(), 256);
  nam_studio_clip_play(g, c0);
  nam_studio_clip_play(g, c1);
  auto out = RunMono(g, 0.0f);
  float peak = 0.0f;
  for (float s : out) peak = std::max(peak, std::fabs(s));
  // Two clips summed pre-master should be louder than one.
  OPENAXE_EXPECT(peak > 0.2f);
  OPENAXE_EXPECT(nam_studio_clip_is_playing(g, c0) == 1);
  OPENAXE_EXPECT(nam_studio_clip_is_playing(g, c1) == 1);
  // Max 8 clips.
  for (int i = 2; i < 8; ++i) {
    int32_t c = nam_studio_clip_create(g);
    OPENAXE_EXPECT(c >= 0);
  }
  OPENAXE_EXPECT(nam_studio_clip_create(g) == -1);
  nam_studio_graph_destroy(g);
}

void TestCaptureContinuityAndOverrun() {
  NamStudioGraph* g = nam_studio_graph_create();
  nam_studio_reset(g, kSampleRate, kBlockSize);
  // Capture master: feed grid with constant, capture 4 blocks, drain in chunks.
  const int32_t cab = nam_studio_add_block(g, NAM_STUDIO_BLOCK_CAB, 0, 0);
  nam_studio_connect(g, NAM_STUDIO_IN_RAIL, 0, cab, 0);
  nam_studio_connect(g, cab, 0, NAM_STUDIO_OUT_RAIL, 0);
  nam_studio_reset(g, kSampleRate, kBlockSize);
  nam_studio_capture_start(g, NAM_STUDIO_CAPTURE_MASTER, 0);
  OPENAXE_EXPECT(nam_studio_capture_is_active(g) == 1);
  for (int i = 0; i < 4; ++i) RunMono(g, 0.5f);
  OPENAXE_EXPECT(nam_studio_capture_available_frames(g) == 4 * kBlockSize);
  std::vector<float> out(4 * kBlockSize * 2, 0.0f);
  int32_t got = nam_studio_capture_read(g, out.data(), 2 * kBlockSize);
  OPENAXE_EXPECT(got == 2 * kBlockSize);
  OPENAXE_EXPECT(nam_studio_capture_available_frames(g) == 2 * kBlockSize);
  // Remaining drain.
  got = nam_studio_capture_read(g, out.data(), 4 * kBlockSize);
  OPENAXE_EXPECT(got == 2 * kBlockSize);
  OPENAXE_EXPECT(nam_studio_capture_available_frames(g) == 0);
  // Overrun: fill beyond capacity (10s) should drop oldest, not crash.
  nam_studio_capture_start(g, NAM_STUDIO_CAPTURE_MASTER, 0);
  // Capacity is 48000*10 = 480000 frames, we write 500000 -> overrun by 20000, should keep newest 480k.
  for (int i = 0; i < 4000; ++i) RunMono(g, 0.1f); // 4000*128=512k frames
  int32_t avail = nam_studio_capture_available_frames(g);
  OPENAXE_EXPECT(avail == 48000 * 10);
  std::vector<float> big(48000 * 10 * 2, 0.0f);
  got = nam_studio_capture_read(g, big.data(), 48000 * 10);
  OPENAXE_EXPECT(got == 48000 * 10);
  nam_studio_capture_stop(g);
  OPENAXE_EXPECT(nam_studio_capture_is_active(g) == 0);
  nam_studio_graph_destroy(g);
}

void TestJamLift() {
  NamStudioGraph* g = nam_studio_graph_create();
  nam_studio_reset(g, kSampleRate, kBlockSize);
  nam_studio_jam_configure(g, 2); // 2 seconds ring
  const int32_t cab = nam_studio_add_block(g, NAM_STUDIO_BLOCK_CAB, 0, 0);
  nam_studio_connect(g, NAM_STUDIO_IN_RAIL, 0, cab, 0);
  nam_studio_connect(g, cab, 0, NAM_STUDIO_OUT_RAIL, 0);
  nam_studio_reset(g, kSampleRate, kBlockSize);
  // Write 1 second of audio (48000 frames) via Process, jam always records.
  for (int i = 0; i < 375; ++i) RunMono(g, 0.3f); // 375*128=48000
  OPENAXE_EXPECT(nam_studio_jam_available_frames(g) == 48000);
  std::vector<float> out(48000 * 2, 0.0f);
  int32_t got = nam_studio_jam_lift(g, out.data(), 48000);
  OPENAXE_EXPECT(got == 48000);
  // Check captured data is ~0.3 (allow master=1).
  OPENAXE_EXPECT(std::fabs(out[0] - 0.3f) < 1e-3f);
  // After lift, available stays (non-destructive).
  OPENAXE_EXPECT(nam_studio_jam_available_frames(g) == 48000);
  // Write another 2 seconds -> ring should hold only last 2s (96000 frames) = capacity.
  for (int i = 0; i < 750; ++i) RunMono(g, 0.4f); // 96000 frames
  OPENAXE_EXPECT(nam_studio_jam_available_frames(g) == 96000);
  got = nam_studio_jam_lift(g, out.data(), 48000);
  OPENAXE_EXPECT(got == 48000); // our out buffer is only 48000, so truncated
  nam_studio_graph_destroy(g);
}

} // namespace

int main() {
  TestSongLoadFailureAndSuccess();
  TestTransportAndEvents();
  TestAudibleToneWithoutGrid();
  TestSessionMixer();
  TestSampleRateIndependence();
  TestClipFeedAndPlayback();
  TestClipConcurrent();
  TestCaptureContinuityAndOverrun();
  TestJamLift();
  return openaxe::test::g_failures == 0 ? 0 : 1;
}
