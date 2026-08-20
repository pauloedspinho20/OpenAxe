#pragma once

#include <string>

// Ported from apps/web/src/engine/gridConfig.ts - TS (gridConfig.ts) is the
// source of truth; keep this header's grid size in sync with it exactly
// (scripts/check-grid-dims.mjs --check fails CI on drift). The OUT-rail sort
// column is kGridCols; if it diverges from TS's GRID_COLS, native/desktop
// OUT connections for the rightmost UI columns pass the TS pre-check but are
// rejected by the core (issue #61).
namespace nam_studio::graph {

// Grid size - must match apps/web/src/engine/gridConfig.ts. "Provisional"
// there means it may change; when it does, this header follows.
inline constexpr int kGridRows = 4;
inline constexpr int kGridCols = 10;

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
