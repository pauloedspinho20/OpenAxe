#pragma once

#include <string>

// Ported from apps/web/src/engine/gridConfig.ts - keep in sync with that
// file's semantics (grid size, rail sentinels, jack identity) exactly.
namespace nam_studio::graph {

// Provisional grid size - see the app's grid rearchitecture plan for why
// this may change.
inline constexpr int kGridRows = 3;
inline constexpr int kGridCols = 8;

// The fixed rail sentinels - not real blocks, never occupy a grid cell.
inline constexpr const char* kInRail = "IN";
inline constexpr const char* kOutRail = "OUT";

// One endpoint of a cable. `port` is the input-jack slot for multi-input
// blocks (Mixer); it's always 0 for single-input blocks and for every
// output jack (a block's one output can fan out to many cables for free).
struct Jack {
  std::string block_id;
  int port = 0;
};

inline bool operator==(const Jack& a, const Jack& b) {
  return a.block_id == b.block_id && a.port == b.port;
}

inline std::string JackKey(const Jack& jack) {
  return jack.block_id + ":" + std::to_string(jack.port);
}

}  // namespace nam_studio::graph
