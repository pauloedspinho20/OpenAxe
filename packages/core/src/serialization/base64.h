#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

// Base64 for rig-state asset payloads (#120): embedded .nam JSON and cab IR
// WAV bytes ride inside the JSON document as standard-alphabet base64. The
// decoder takes an output cap so a hostile document cannot make us allocate
// gigabytes before the caller's own size check runs - the payload is
// untrusted input arriving from a project file.
namespace nam_studio::state {

// Standard RFC 4648 alphabet with padding.
std::string Base64Encode(const uint8_t* data, size_t size);

// Decodes into `out`. Returns false on any invalid character, length, or
// padding, or when the decoded size would exceed `max_output` (checked BEFORE
// allocating). `out` is only touched on success.
bool Base64Decode(const char* data, size_t size, size_t max_output,
                  std::vector<uint8_t>& out);

}  // namespace nam_studio::state
