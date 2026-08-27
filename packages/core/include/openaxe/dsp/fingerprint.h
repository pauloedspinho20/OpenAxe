#pragma once

#include <optional>
#include <string>

namespace openaxe::dsp {

struct Fingerprint {
  float gain_db = 0.0f;
  float brightness = 0.5f;
};

std::optional<Fingerprint> ComputeFingerprint(const std::string& json_text);

}  // namespace openaxe::dsp
