#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

// SHA-256 for rig-state asset hashing (#120): a saved rig records each
// embedded model/IR's content hash so a UI can verify a relinked file is the
// same capture without embedding it. Hand-written and dependency-free for the
// same reason serialization/json is - the only hash library reachable from
// this target would drag a third-party dependency into every front end.
//
// Not constant-time, not hardened against side channels: it hashes files the
// user chose, not secrets.
namespace nam_studio::state {

// Returns the 64-character lowercase hex digest of `size` bytes at `data`.
std::string Sha256Hex(const uint8_t* data, size_t size);

}  // namespace nam_studio::state
