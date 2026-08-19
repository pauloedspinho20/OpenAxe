#include "nam_studio/graph_validation.h"

namespace nam_studio::graph {
namespace {

enum class Side { kFrom, kTo };

// IN_RAIL sorts before every real column (-1), OUT_RAIL sorts after every
// real column (kGridCols) - this single invariant is what makes cycles
// structurally impossible; there is no topological sort anywhere in this
// port, matching the TS original.
int ColumnOf(const BlockMap& blocks, const std::string& block_id) {
  if (block_id == kInRail) return -1;
  if (block_id == kOutRail) return kGridCols;
  auto it = blocks.find(block_id);
  return it != blocks.end() ? it->second.col : kGridCols;
}

// Highest valid port index for a jack on the given side. Inputs default to
// a single port 0, except a Mixer's several independent input jacks;
// outputs default to a single port 0 too, except a Splitter's several
// independent output jacks.
int MaxPortFor(const BlockMap& blocks, const std::string& block_id, Side side) {
  if (side == Side::kTo) {
    if (block_id == kOutRail) return 0;
    auto it = blocks.find(block_id);
    return (it != blocks.end() && it->second.kind == BlockKind::kMixer) ? kMixerInputCount - 1 : 0;
  }
  if (block_id == kInRail) return 0;
  auto it = blocks.find(block_id);
  return (it != blocks.end() && it->second.kind == BlockKind::kSplitter) ? kSplitterOutputCount - 1
                                                                          : 0;
}

}  // namespace

ConnectResult CanConnect(const BlockMap& blocks, const std::vector<EdgeRecord>& edges,
                          const Jack& from, const Jack& to) {
  if (JackKey(from) == JackKey(to)) return {false, RejectReason::kSelfJack};

  if (from.block_id != kInRail && !blocks.contains(from.block_id)) {
    return {false, RejectReason::kUnknownSource};
  }
  if (to.block_id != kOutRail && !blocks.contains(to.block_id)) {
    return {false, RejectReason::kUnknownTarget};
  }

  if (!(ColumnOf(blocks, from.block_id) < ColumnOf(blocks, to.block_id))) {
    return {false, RejectReason::kWrongOrder};
  }

  const int max_to_port = MaxPortFor(blocks, to.block_id, Side::kTo);
  if (to.port < 0 || to.port > max_to_port) return {false, RejectReason::kInvalidInputPort};

  const int max_from_port = MaxPortFor(blocks, from.block_id, Side::kFrom);
  if (from.port < 0 || from.port > max_from_port) return {false, RejectReason::kInvalidOutputPort};

  for (const EdgeRecord& edge : edges) {
    if (JackKey(edge.to) == JackKey(to)) return {false, RejectReason::kInputAlreadyConnected};
  }

  return {true, std::nullopt};
}

// Whether an existing edge still flows left to right. Used after a block moves
// (CanConnect covers the same rule when a cable is first drawn) - the one
// invariant that keeps the graph acyclic by construction.
bool IsEdgeOrderValid(const BlockMap& blocks, const EdgeRecord& edge) {
  return ColumnOf(blocks, edge.from.block_id) < ColumnOf(blocks, edge.to.block_id);
}

}  // namespace nam_studio::graph
