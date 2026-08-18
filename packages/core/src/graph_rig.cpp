#include "nam_studio/graph_rig.h"

#include <utility>
#include <vector>

namespace nam_studio::graph {

// Monotonic "block-1"/"edge-7" ids for callers that don't bring their own. The
// counter is shared between blocks and edges - the prefix is what disambiguates
// - and never resets, so an id is never reused within a rig's lifetime.
std::string GraphRig::GenId(std::string_view prefix) {
  ++next_id_;
  return std::string(prefix) + "-" + std::to_string(next_id_);
}

// Flatten the edge map into the vector the validation helpers take. Allocates,
// so it stays on the control-thread side of the engine, never in Process().
std::vector<EdgeRecord> GraphRig::EdgeValues() const {
  std::vector<EdgeRecord> values;
  values.reserve(edges_.size());
  for (const auto& [id, edge] : edges_) values.push_back(edge);
  return values;
}

// Place a block, generating an id if the caller didn't supply one, and return
// the id used. A caller-supplied id that already exists overwrites that block's
// record - the engine hands out its own unique ids, so that can't happen there.
std::string GraphRig::AddBlock(BlockKind kind, int row, int col, std::optional<std::string> id) {
  std::string block_id = id.has_value() ? std::move(*id) : GenId("block");
  blocks_[block_id] = BlockRecord{kind, row, col};
  return block_id;
}

// Remove a block and every edge touching it (a dangling edge would otherwise
// route from or to a jack that no longer exists). Unknown ids are a no-op.
void GraphRig::RemoveBlock(const std::string& id) {
  if (!blocks_.contains(id)) return;

  // Snapshot ids first (mirrors GraphRig.ts's `[...this.edges]`) since
  // erasing from edges_ while iterating it directly would invalidate the
  // iterator.
  std::vector<std::string> touching_edge_ids;
  for (const auto& [edge_id, edge] : edges_) {
    if (edge.from.block_id == id || edge.to.block_id == id) touching_edge_ids.push_back(edge_id);
  }
  for (const std::string& edge_id : touching_edge_ids) edges_.erase(edge_id);

  blocks_.erase(id);
}

// Move a block to a new grid cell and drop any edge the move would make
// backwards, returning their ids so the caller can tell the user which cables
// were cut. This is the price of using column order as the cycle-prevention
// invariant: a block dragged left past its source can't keep that cable.
MoveResult GraphRig::MoveBlock(const std::string& id, int row, int col) {
  auto it = blocks_.find(id);
  if (it == blocks_.end()) return {};

  it->second.row = row;
  it->second.col = col;

  std::vector<std::string> touching_edge_ids;
  for (const auto& [edge_id, edge] : edges_) {
    if (edge.from.block_id == id || edge.to.block_id == id) touching_edge_ids.push_back(edge_id);
  }

  MoveResult result;
  for (const std::string& edge_id : touching_edge_ids) {
    const EdgeRecord& edge = edges_.at(edge_id);
    if (!IsEdgeOrderValid(blocks_, edge)) {
      edges_.erase(edge_id);
      result.dropped_edge_ids.push_back(edge_id);
    }
  }
  return result;
}

// Kind + position of one block, or nullptr if unknown. The pointer is into the
// map, so it is invalidated by any later mutation - read it and move on.
const BlockRecord* GraphRig::GetBlock(const std::string& id) const {
  auto it = blocks_.find(id);
  return it != blocks_.end() ? &it->second : nullptr;
}

// Just the grid cell, copied out - safe to hold across mutations, unlike
// GetBlock's pointer.
std::optional<BlockPosition> GraphRig::GetBlockPosition(const std::string& id) const {
  auto it = blocks_.find(id);
  if (it == blocks_.end()) return std::nullopt;
  return BlockPosition{it->second.row, it->second.col};
}

// Every block id, in unspecified (hash) order - callers that need execution
// order sort by column themselves (see AudioEngine::RecomputeRouting).
std::vector<std::string> GraphRig::ListBlockIds() const {
  std::vector<std::string> ids;
  ids.reserve(blocks_.size());
  for (const auto& [id, block] : blocks_) ids.push_back(id);
  return ids;
}

// Wire two jacks if the rules allow it (see graph_validation.h: left to right
// by column, one cable per input jack, no self-connection), otherwise return
// the rejection reason so a UI can explain itself. The edge id is generated
// unless the caller supplies one.
ConnectOutcome GraphRig::Connect(const Jack& from, const Jack& to, std::optional<std::string> id) {
  const ConnectResult result = CanConnect(blocks_, EdgeValues(), from, to);
  if (!result.ok) return ConnectOutcome::Rejected(*result.reason);

  std::string edge_id = id.has_value() ? std::move(*id) : GenId("edge");
  edges_[edge_id] = EdgeRecord{from, to};
  return ConnectOutcome::Connected(edge_id);
}

// Drop one edge; unknown ids are a no-op.
void GraphRig::Disconnect(const std::string& edge_id) { edges_.erase(edge_id); }

// Every edge id, in unspecified (hash) order.
std::vector<std::string> GraphRig::ListEdgeIds() const {
  std::vector<std::string> ids;
  ids.reserve(edges_.size());
  for (const auto& [id, edge] : edges_) ids.push_back(id);
  return ids;
}

// The two jacks one edge connects, or nullptr if unknown. Same pointer-validity
// caveat as GetBlock.
const EdgeRecord* GraphRig::GetEdge(const std::string& id) const {
  auto it = edges_.find(id);
  return it != edges_.end() ? &it->second : nullptr;
}

// Drop the whole graph. Idempotent, and deliberately explicit rather than
// left to the destructor: the JS/web rig has the same call, so both sides tear
// down at the same point in their lifecycle.
void GraphRig::Dispose() {
  if (disposed_) return;
  disposed_ = true;
  edges_.clear();
  blocks_.clear();
}

}  // namespace nam_studio::graph
