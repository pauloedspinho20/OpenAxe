#include "input_routing.h"

#include <nlohmann/json.hpp>

namespace openaxe_vst3 {

InputChannelMode InputChannelModeFromName(const std::string& name) {
  if (name == "l") return InputChannelMode::kLeft;
  if (name == "r") return InputChannelMode::kRight;
  if (name == "sum") return InputChannelMode::kSum;
  return InputChannelMode::kStereo;
}

const char* InputChannelModeName(InputChannelMode mode) {
  switch (mode) {
    case InputChannelMode::kLeft:
      return "l";
    case InputChannelMode::kRight:
      return "r";
    case InputChannelMode::kSum:
      return "sum";
    case InputChannelMode::kStereo:
      break;
  }
  return "stereo";
}

int RouteInput(InputChannelMode mode, float* const* channels, int channel_count, int frames,
               const float** out) {
  if (!channels || channel_count <= 0 || !channels[0]) return 0;

  // A mono bus has nothing to choose between: every mode collapses to the one
  // channel that exists. Handling it here keeps the cases below from each
  // needing their own fallback.
  if (channel_count < 2 || !channels[1]) {
    out[0] = channels[0];
    return 1;
  }

  switch (mode) {
    case InputChannelMode::kLeft:
      out[0] = channels[0];
      return 1;

    case InputChannelMode::kRight:
      out[0] = channels[1];
      return 1;

    case InputChannelMode::kSum:
      // Averaged, not added: summing two channels carrying the same signal
      // would be +6 dB into the amp, which for a neural capture is a
      // different sound and not just a louder one. This matches the web,
      // where the downmix to a one-channel node is 0.5 * (L + R).
      for (int i = 0; i < frames; ++i) {
        channels[0][i] = 0.5f * (channels[0][i] + channels[1][i]);
      }
      out[0] = channels[0];
      return 1;

    case InputChannelMode::kStereo:
      break;
  }

  out[0] = channels[0];
  out[1] = channels[1];
  return 2;
}

std::string InputChannelToStateJson(InputChannelMode mode, const std::string& base_json) {
  auto doc = nlohmann::json::parse(base_json, nullptr, /*allow_exceptions=*/false);
  if (doc.is_discarded() || !doc.is_object()) return base_json;
  doc["inputChannel"] = InputChannelModeName(mode);
  return doc.dump();
}

InputChannelMode InputChannelFromStateJson(const std::string& json) {
  const auto doc = nlohmann::json::parse(json, nullptr, /*allow_exceptions=*/false);
  if (doc.is_discarded() || !doc.is_object()) return InputChannelMode::kStereo;
  const auto it = doc.find("inputChannel");
  if (it == doc.end() || !it->is_string()) return InputChannelMode::kStereo;
  return InputChannelModeFromName(it->get<std::string>());
}

}  // namespace openaxe_vst3
