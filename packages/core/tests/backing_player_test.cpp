// Backing-track player (issue #205): transport, pitch-preserving speed,
// transposition, rate compensation, A-B loop, end-of-track stop - exercised
// through the extern "C" ABI the web worklet and desktop bridge call.
#include <cmath>
#include <cstdio>
#include <vector>

#include "openaxe/api.h"
#include "test_harness.h"

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr int kBlock = 128;

std::vector<float> Sine(double freq, double rate, int frames, int channels, float amp = 0.5f) {
  std::vector<float> out(static_cast<size_t>(frames * channels));
  for (int i = 0; i < frames; ++i) {
    const float v = amp * static_cast<float>(std::sin(2.0 * kPi * freq * i / rate));
    for (int c = 0; c < channels; ++c) out[static_cast<size_t>(i * channels + c)] = v;
  }
  return out;
}

OpenAxePlayer* LoadPlayer(const std::vector<float>& pcm, int channels, double src_rate,
                          double engine_rate = 48000.0) {
  OpenAxePlayer* p = openaxe_player_create();
  openaxe_player_reset(p, engine_rate, kBlock);
  const int frames = static_cast<int>(pcm.size()) / channels;
  OPENAXE_EXPECT(openaxe_player_load_begin(p, frames, channels, src_rate) == 1);
  // Feed in uneven chunks, the way a front end streams a decoded file.
  int off = 0;
  while (off < frames) {
    const int n = std::min(7777, frames - off);
    OPENAXE_EXPECT(openaxe_player_load_write(p, off, pcm.data() + off * channels, n) == n);
    off += n;
  }
  OPENAXE_EXPECT(openaxe_player_load_end(p) == 1);
  return p;
}

// Renders `frames` (multiple of kBlock) and returns the left channel.
std::vector<float> Render(OpenAxePlayer* p, int frames) {
  std::vector<float> left(static_cast<size_t>(frames)), l(kBlock), r(kBlock);
  for (int done = 0; done < frames; done += kBlock) {
    std::fill(l.begin(), l.end(), 0.0f);
    std::fill(r.begin(), r.end(), 0.0f);
    float* outs[2] = {l.data(), r.data()};
    openaxe_player_render(p, outs, 2, kBlock);
    std::copy(l.begin(), l.end(), left.begin() + done);
  }
  return left;
}

// Frequency from rising zero crossings over a settled window.
double Frequency(const std::vector<float>& x, size_t from, double rate) {
  int crossings = 0;
  double first = -1, last = -1;
  for (size_t i = from + 1; i < x.size(); ++i) {
    if (x[i - 1] < 0.0f && x[i] >= 0.0f) {
      const double t = static_cast<double>(i - 1) + x[i - 1] / (x[i - 1] - x[i]);
      if (first < 0) first = t;
      last = t;
      ++crossings;
    }
  }
  if (crossings < 2) return 0.0;
  return (crossings - 1) * rate / (last - first);
}

float Peak(const std::vector<float>& x, size_t from, size_t to) {
  float m = 0;
  for (size_t i = from; i < to && i < x.size(); ++i) m = std::max(m, std::abs(x[i]));
  return m;
}

void TestRejectsBadArguments() {
  OpenAxePlayer* p = openaxe_player_create();
  openaxe_player_reset(p, 48000.0, kBlock);
  OPENAXE_EXPECT(openaxe_player_load_begin(p, 100, 3, 48000.0) == 0);
  OPENAXE_EXPECT(openaxe_player_load_begin(p, 0, 2, 48000.0) == 0);
  OPENAXE_EXPECT(openaxe_player_load_begin(p, 100, 2, 1000.0) == 0);
  OPENAXE_EXPECT(openaxe_player_load_end(p) == 0);
  OPENAXE_EXPECT(openaxe_player_has_track(p) == 0);
  // No track: render adds nothing and play is a no-op.
  openaxe_player_play(p);
  OPENAXE_EXPECT(openaxe_player_is_playing(p) == 0);
  std::vector<float> l(kBlock, 0.25f), r(kBlock, 0.25f);
  float* outs[2] = {l.data(), r.data()};
  openaxe_player_render(p, outs, 2, kBlock);
  OPENAXE_EXPECT(l[0] == 0.25f && r[kBlock - 1] == 0.25f);
  // Null handles are harmless.
  openaxe_player_render(nullptr, outs, 2, kBlock);
  OPENAXE_EXPECT(openaxe_player_length(nullptr) == 0);
  openaxe_player_destroy(p);
  openaxe_player_destroy(nullptr);
}

void TestPlaysThroughUnchangedAtUnitySpeed() {
  const auto pcm = Sine(440.0, 48000.0, 48000, 2);
  OpenAxePlayer* p = LoadPlayer(pcm, 2, 48000.0);
  OPENAXE_EXPECT(openaxe_player_length(p) == 48000);
  // Paused: nothing is added, the transport holds.
  auto silent = Render(p, kBlock * 4);
  OPENAXE_EXPECT(Peak(silent, 0, silent.size()) == 0.0f);
  OPENAXE_EXPECT(openaxe_player_position(p) == 0);

  openaxe_player_play(p);
  const auto out = Render(p, kBlock * 100);
  OPENAXE_EXPECT(openaxe_player_position(p) == kBlock * 100);
  // After the fade-in, samples match the source to int16 precision.
  float max_err = 0;
  for (size_t i = 2000; i < out.size(); ++i) max_err = std::max(max_err, std::abs(out[i] - pcm[i * 2]));
  OPENAXE_EXPECT(max_err < 1e-4f);
  OPENAXE_EXPECT(openaxe_player_get_meter(p) > 0.4f);

  // Pause fades out and stops advancing.
  openaxe_player_pause(p);
  Render(p, kBlock * 10);
  const int held = openaxe_player_position(p);
  const auto after = Render(p, kBlock * 10);
  OPENAXE_EXPECT(openaxe_player_position(p) == held);
  OPENAXE_EXPECT(Peak(after, 0, after.size()) == 0.0f);
  openaxe_player_destroy(p);
}

void TestHalfSpeedKeepsPitch() {
  const auto pcm = Sine(440.0, 48000.0, 48000 * 4, 2);
  OpenAxePlayer* p = LoadPlayer(pcm, 2, 48000.0);
  openaxe_player_set_speed(p, 0.5f);
  openaxe_player_play(p);
  const int frames = kBlock * 750;  // 2 s of output
  const auto out = Render(p, frames);
  const double f = Frequency(out, 24000, 48000.0);
  std::printf("half speed: freq %.2f Hz, pos %d\n", f, openaxe_player_position(p));
  OPENAXE_EXPECT(std::abs(f - 440.0) < 3.0);
  // Two seconds of output consumed about one second of source.
  OPENAXE_EXPECT(std::abs(openaxe_player_position(p) - frames / 2) < 2400);
  OPENAXE_EXPECT(Peak(out, 24000, out.size()) > 0.3f);
  openaxe_player_destroy(p);
}

void TestTransposeShiftsPitch() {
  const auto pcm = Sine(220.0, 48000.0, 48000 * 3, 2);
  OpenAxePlayer* p = LoadPlayer(pcm, 2, 48000.0);
  openaxe_player_set_semitones(p, 12.0f);
  openaxe_player_play(p);
  const auto out = Render(p, kBlock * 600);
  const double f = Frequency(out, 24000, 48000.0);
  std::printf("+12 st: freq %.2f Hz\n", f);
  OPENAXE_EXPECT(std::abs(f - 440.0) < 4.0);
  OPENAXE_EXPECT(std::abs(openaxe_player_position(p) - kBlock * 600) < 2400);
  openaxe_player_destroy(p);
}

void TestCompensatesSourceRate() {
  // A 44.1 kHz mono file on a 48 kHz engine plays at the right pitch and pace.
  const auto pcm = Sine(440.0, 44100.0, 44100 * 3, 1);
  OpenAxePlayer* p = LoadPlayer(pcm, 1, 44100.0, 48000.0);
  OPENAXE_EXPECT(openaxe_player_source_rate(p) == 44100.0);
  openaxe_player_play(p);
  const int frames = kBlock * 750;  // 2 s at 48 kHz
  const auto out = Render(p, frames);
  const double f = Frequency(out, 24000, 48000.0);
  std::printf("44.1k on 48k: freq %.2f Hz, pos %d\n", f, openaxe_player_position(p));
  OPENAXE_EXPECT(std::abs(f - 440.0) < 3.0);
  OPENAXE_EXPECT(std::abs(openaxe_player_position(p) - 88200) < 2400);
  openaxe_player_destroy(p);
}

void TestLoopStaysInsideRegion() {
  const auto pcm = Sine(330.0, 48000.0, 48000 * 2, 2);
  for (const float speed : {1.0f, 0.75f}) {
    OpenAxePlayer* p = LoadPlayer(pcm, 2, 48000.0);
    openaxe_player_set_speed(p, speed);
    openaxe_player_set_loop(p, 12000, 24000, 1);
    openaxe_player_seek(p, 12000);
    openaxe_player_play(p);
    bool inside = true;
    for (int i = 0; i < 400; ++i) {
      Render(p, kBlock);
      const int pos = openaxe_player_position(p);
      if (pos < 12000 - 10 || pos > 24000 + 10) inside = false;
    }
    OPENAXE_EXPECT(inside);
    OPENAXE_EXPECT(openaxe_player_is_playing(p) == 1);
    openaxe_player_destroy(p);
  }
}

void TestStopsAtEnd() {
  for (const float speed : {1.0f, 1.5f}) {
    const auto pcm = Sine(440.0, 48000.0, 9600, 2);
    OpenAxePlayer* p = LoadPlayer(pcm, 2, 48000.0);
    openaxe_player_set_speed(p, speed);
    openaxe_player_play(p);
    Render(p, kBlock * 200);
    OPENAXE_EXPECT(openaxe_player_is_playing(p) == 0);
    std::printf("end speed %.2f pos %d playing %d\n", speed, openaxe_player_position(p), openaxe_player_is_playing(p));
    OPENAXE_EXPECT(openaxe_player_position(p) == 9600);
    // Play again from the end restarts at the top.
    openaxe_player_play(p);
    OPENAXE_EXPECT(openaxe_player_is_playing(p) == 1);
    Render(p, kBlock);
    OPENAXE_EXPECT(openaxe_player_position(p) < 9600);
    openaxe_player_destroy(p);
  }
}

void TestSeekReportsTarget() {
  const auto pcm = Sine(440.0, 48000.0, 48000 * 2, 2);
  OpenAxePlayer* p = LoadPlayer(pcm, 2, 48000.0);
  openaxe_player_seek(p, 30000);
  OPENAXE_EXPECT(openaxe_player_position(p) == 30000);
  openaxe_player_seek(p, 10'000'000);
  OPENAXE_EXPECT(openaxe_player_position(p) == 96000);
  openaxe_player_seek(p, 24000);
  openaxe_player_set_speed(p, 0.8f);
  openaxe_player_play(p);
  Render(p, kBlock * 10);
  const int pos = openaxe_player_position(p);
  OPENAXE_EXPECT(pos >= 24000 && pos < 24000 + kBlock * 10);
  // Reset (device change) keeps the track and the position.
  openaxe_player_reset(p, 44100.0, 256);
  OPENAXE_EXPECT(openaxe_player_has_track(p) == 1);
  OPENAXE_EXPECT(std::abs(openaxe_player_position(p) - pos) < 10);
  openaxe_player_unload(p);
  OPENAXE_EXPECT(openaxe_player_has_track(p) == 0 && openaxe_player_length(p) == 0);
  openaxe_player_destroy(p);
}

void TestCountIn() {
  const auto pcm = Sine(440.0, 48000.0, 48000 * 2, 2);
  OpenAxePlayer* p = LoadPlayer(pcm, 2, 48000.0);
  // 4 clicks, 0.25 s apart = 1 s of count-in before the track starts.
  openaxe_player_set_count_in(p, 4, 0.25f, 4);
  openaxe_player_play(p);
  OPENAXE_EXPECT(openaxe_player_is_counting(p) == 1);
  const auto out = Render(p, kBlock * 300);  // 0.8 s
  OPENAXE_EXPECT(openaxe_player_is_counting(p) == 1);
  OPENAXE_EXPECT(openaxe_player_position(p) == 0);  // the track hasn't moved
  // Clicks sound at 0, 0.25, 0.5 s; silence between them.
  OPENAXE_EXPECT(Peak(out, 0, 200) > 0.2f);
  OPENAXE_EXPECT(Peak(out, 6000, 11000) < 1e-6f);
  OPENAXE_EXPECT(Peak(out, 12000, 12200) > 0.2f);
  Render(p, kBlock * 200);  // past 1 s
  OPENAXE_EXPECT(openaxe_player_is_counting(p) == 0);
  OPENAXE_EXPECT(openaxe_player_position(p) > 0);
  // Pausing mid count-in cancels it; disabled count-in plays straight away.
  openaxe_player_pause(p);
  openaxe_player_seek(p, 0);
  openaxe_player_set_count_in(p, 0, 0.25f, 4);
  Render(p, kBlock * 20);
  openaxe_player_play(p);
  OPENAXE_EXPECT(openaxe_player_is_counting(p) == 0);
  Render(p, kBlock * 10);
  // Started at once (the pause fade-out may have moved it a few ms first).
  OPENAXE_EXPECT(openaxe_player_position(p) >= kBlock * 9 && openaxe_player_position(p) < kBlock * 16);
  openaxe_player_destroy(p);
}

}  // namespace

int main() {
  TestRejectsBadArguments();
  TestPlaysThroughUnchangedAtUnitySpeed();
  TestHalfSpeedKeepsPitch();
  TestTransposeShiftsPitch();
  TestCompensatesSourceRate();
  TestLoopStaysInsideRegion();
  TestStopsAtEnd();
  TestSeekReportsTarget();
  TestCountIn();
  if (openaxe::test::g_failures != 0) {
    std::fprintf(stderr, "%d failure(s)\n", openaxe::test::g_failures);
    return 1;
  }
  std::printf("backing_player_test: all passed\n");
  return 0;
}
