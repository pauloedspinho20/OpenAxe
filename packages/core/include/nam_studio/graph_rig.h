#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "nam_studio/block.h"
#include "nam_studio/graph_validation.h"
#include "nam_studio/grid_config.h"

// Ported from apps/web/src/engine/GraphRig.ts - the audio-graph-agnostic
// topology/bookkeeping layer only. Deliberately excludes everything
// Web-Audio-specific from the TS original (AudioContext/GainNode wiring,
// analyser taps, master bus, NAM model loading, countActiveHeavyBlocks) -
// that's the native real-time audio wiring layer, a separate later concern.
namespace nam_studio::graph {

struct BlockPosition {
  int row = 0;
  int col = 0;
};

struct MoveResult {
  std::vector<std::string> dropped_edge_ids;
};

// Mirrors GraphRig.ts's `{ok:true,id}|{ok:false,reason}` connect() return.
struct ConnectOutcome {
  bool ok = false;
  std::string id;                      // valid iff ok
  std::optional<RejectReason> reason;  // valid iff !ok

  static ConnectOutcome Connected(std::string id) { return {true, std::move(id), std::nullopt}; }
  static ConnectOutcome Rejected(RejectReason reason) { return {false, {}, reason}; }
};

// Blocks on a kGridRows x kGridCols grid, wired left-to-right by column.
// Column ordering alone makes cycles structurally impossible (see
// graph_validation.h) - no topological sort anywhere in this class.
//
// AddBlock is synchronous here (unlike TS's `async addBlock`, which awaits
// constructing a live Web Audio node) since there is no live object to
// construct yet at this layer.
class GraphRig {
 public:
  GraphRig() = default;
  ~GraphRig() { Dispose(); }
  GraphRig(const GraphRig&) = delete;
  GraphRig& operator=(const GraphRig&) = delete;

  std::string AddBlock(BlockKind kind, int row, int col, std::optional<std::string> id = std::nullopt);
  void RemoveBlock(const std::string& id);                        // no-op if unknown
  MoveResult MoveBlock(const std::string& id, int row, int col);  // no-op if unknown

  const BlockRecord* GetBlock(const std::string& id) const;
  std::optional<BlockPosition> GetBlockPosition(const std::string& id) const;
  std::vector<std::string> ListBlockIds() const;

  ConnectOutcome Connect(const Jack& from, const Jack& to, std::optional<std::string> id = std::nullopt);
  void Disconnect(const std::string& edge_id);  // no-op if unknown
  std::vector<std::string> ListEdgeIds() const;
  const EdgeRecord* GetEdge(const std::string& id) const;

  // Idempotent; the destructor calls it too, matching GraphRig.ts's dispose().
  void Dispose();

 private:
  std::string GenId(std::string_view prefix);
  std::vector<EdgeRecord> EdgeValues() const;

  BlockMap blocks_;
  std::unordered_map<std::string, EdgeRecord> edges_;
  int next_id_ = 0;
  bool disposed_ = false;
};

}  // namespace nam_studio::graph
