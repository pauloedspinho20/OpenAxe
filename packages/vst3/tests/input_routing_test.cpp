// Input channel routing in the plugin — which of the host's input channels
// actually reach the rig.
//
// A guitar is one cable on a stereo track, so "Ch 1" has to mean the rig sees
// that channel as mono rather than a half-silent pair. The modes mirror the
// web's (buildChannelRouter in apps/web/src/hooks/useAudioEngine.ts), so the
// same selection must produce the same signal in a browser and in a DAW.

#include "input_routing.h"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

int fails = 0;
#define CHECK(c) do { if(!(c)) { std::fprintf(stderr, "FAIL: %s (line %d)\n", #c, __LINE__); ++fails; } } while(0)

using openaxe_vst3::InputChannelMode;
using openaxe_vst3::InputChannelModeFromName;
using openaxe_vst3::InputChannelModeName;
using openaxe_vst3::RouteInput;

namespace {
constexpr int kFrames = 4;

struct Bus {
  std::vector<float> left{1.0f, 2.0f, 3.0f, 4.0f};
  std::vector<float> right{-1.0f, -2.0f, -3.0f, -4.0f};
  float* channels[2];
  Bus() {
    channels[0] = left.data();
    channels[1] = right.data();
  }
};
}  // namespace

int main() {
  // 1. Names round-trip, and match the strings the UI already persists.
  {
    CHECK(InputChannelModeFromName("stereo") == InputChannelMode::kStereo);
    CHECK(InputChannelModeFromName("l") == InputChannelMode::kLeft);
    CHECK(InputChannelModeFromName("r") == InputChannelMode::kRight);
    CHECK(InputChannelModeFromName("sum") == InputChannelMode::kSum);
    CHECK(std::string(InputChannelModeName(InputChannelMode::kStereo)) == "stereo");
    CHECK(std::string(InputChannelModeName(InputChannelMode::kLeft)) == "l");
    CHECK(std::string(InputChannelModeName(InputChannelMode::kRight)) == "r");
    CHECK(std::string(InputChannelModeName(InputChannelMode::kSum)) == "sum");
    // A chunk written by a newer build must degrade to the passthrough, not
    // to silence or to whatever the first enumerator happens to be.
    CHECK(InputChannelModeFromName("side-chain") == InputChannelMode::kStereo);
    CHECK(InputChannelModeFromName("") == InputChannelMode::kStereo);
  }

  // 2. Stereo passes the bus straight through.
  {
    Bus bus;
    const float* out[2] = {nullptr, nullptr};
    CHECK(RouteInput(InputChannelMode::kStereo, bus.channels, 2, kFrames, out) == 2);
    CHECK(out[0] == bus.left.data());
    CHECK(out[1] == bus.right.data());
    CHECK(bus.left[0] == 1.0f && bus.right[0] == -1.0f);  // untouched
  }

  // 3. Ch 1 and Ch 2 each pick one channel, as mono. One channel is the whole
  //    point: the core duplicates a mono input to both internal channels, so
  //    the guitar ends up centred rather than hard on one side.
  {
    Bus bus;
    const float* out[2] = {nullptr, nullptr};
    CHECK(RouteInput(InputChannelMode::kLeft, bus.channels, 2, kFrames, out) == 1);
    CHECK(out[0] == bus.left.data());

    const float* out2[2] = {nullptr, nullptr};
    CHECK(RouteInput(InputChannelMode::kRight, bus.channels, 2, kFrames, out2) == 1);
    CHECK(out2[0] == bus.right.data());
    // Neither mode may alter the samples it did not select.
    CHECK(bus.left[3] == 4.0f && bus.right[3] == -4.0f);
  }

  // 4. Sum averages rather than adds. Adding two channels carrying the same
  //    signal would be +6 dB into the amp, which for a neural capture is a
  //    different sound, not just a louder one.
  {
    std::vector<float> l{1.0f, 1.0f, 0.5f, 0.0f};
    std::vector<float> r{1.0f, -1.0f, 0.5f, 1.0f};
    float* channels[2] = {l.data(), r.data()};
    const float* out[2] = {nullptr, nullptr};
    CHECK(RouteInput(InputChannelMode::kSum, channels, 2, 4, out) == 1);
    CHECK(out[0] == l.data());
    CHECK(std::fabs(l[0] - 1.0f) < 1e-6f);   // identical channels stay at unity
    CHECK(std::fabs(l[1] - 0.0f) < 1e-6f);   // opposite cancel
    CHECK(std::fabs(l[2] - 0.5f) < 1e-6f);
    CHECK(std::fabs(l[3] - 0.5f) < 1e-6f);
    CHECK(r[0] == 1.0f);  // the source channel is not disturbed
  }

  // 5. A mono bus has nothing to choose between, so every mode collapses to
  //    the single channel rather than reading past the end of the array.
  {
    std::vector<float> only{7.0f, 8.0f, 9.0f, 10.0f};
    float* channels[2] = {only.data(), nullptr};
    for (auto mode : {InputChannelMode::kStereo, InputChannelMode::kLeft,
                      InputChannelMode::kRight, InputChannelMode::kSum}) {
      const float* out[2] = {nullptr, nullptr};
      CHECK(RouteInput(mode, channels, 1, 4, out) == 1);
      CHECK(out[0] == only.data());
      // Notably kRight must not silently produce nothing just because there
      // is no second channel to pick.
      CHECK(only[0] == 7.0f);
    }
    // Same when the host reports two channels but only wired one up.
    for (auto mode : {InputChannelMode::kRight, InputChannelMode::kSum}) {
      const float* out[2] = {nullptr, nullptr};
      CHECK(RouteInput(mode, channels, 2, 4, out) == 1);
      CHECK(out[0] == only.data());
    }
  }

  // 6. No input at all is "process silence", not a crash.
  {
    const float* out[2] = {nullptr, nullptr};
    CHECK(RouteInput(InputChannelMode::kStereo, nullptr, 2, 4, out) == 0);
    float* none[2] = {nullptr, nullptr};
    CHECK(RouteInput(InputChannelMode::kLeft, none, 2, 4, out) == 0);
    std::vector<float> l{1.0f};
    float* channels[2] = {l.data(), nullptr};
    CHECK(RouteInput(InputChannelMode::kStereo, channels, 0, 4, out) == 0);
  }

  // 7. The choice rides the host's state chunk, so a saved project reopens
  //    with the routing it was mixed with.
  {
    const std::string base = "{\"schemaVersion\":1,\"blocks\":[]}";
    const std::string saved = openaxe_vst3::InputChannelToStateJson(InputChannelMode::kRight, base);
    CHECK(openaxe_vst3::InputChannelFromStateJson(saved) == InputChannelMode::kRight);
    // The rest of the document survives the splice.
    CHECK(saved.find("schemaVersion") != std::string::npos);

    // An older chunk has no such field and must open as the passthrough
    // rather than as silence or as whatever was last set.
    CHECK(openaxe_vst3::InputChannelFromStateJson(base) == InputChannelMode::kStereo);
    // Garbage in is not a crash and not a wrong answer.
    CHECK(openaxe_vst3::InputChannelFromStateJson("not json") == InputChannelMode::kStereo);
    CHECK(openaxe_vst3::InputChannelFromStateJson("[]") == InputChannelMode::kStereo);
    CHECK(openaxe_vst3::InputChannelFromStateJson("{\"inputChannel\":7}") ==
          InputChannelMode::kStereo);
    // Splicing into a document that is not an object leaves it alone rather
    // than replacing it with one.
    CHECK(openaxe_vst3::InputChannelToStateJson(InputChannelMode::kSum, "nope") == "nope");
  }

  if (fails == 0) std::printf("input_routing: all checks passed\n");
  return fails == 0 ? 0 : 1;
}
