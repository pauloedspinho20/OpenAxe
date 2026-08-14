#include "nam_studio/graph_rig.h"

#include <utility>
#include <vector>

namespace nam_studio::graph {

std::string GraphRig::GenId(std::string_view prefix) {
  ++next_id_;
  return std::string(prefix) + "-" + std::to_string(next_id_);
}

std::vector<EdgeRecord> GraphRig::EdgeValues() const {
  std::vector<EdgeRecord> values;
  values.reserve(edges_.size());
  for (const auto& [id, edge] : edges_) values.push_back(edge);
  return values;
}

std::string GraphRig::AddBlock(BlockKind kind, int row, int col, std::optional<std::string> id) {
  std::string block_id = id.has_value() ? std::move(*id) : GenId("block");
  blocks_[block_id] = BlockRecord{kind, row, col};
  return block_id;
}

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

const BlockRecord* GraphRig::GetBlock(const std::string& id) const {
  auto it = blocks_.find(id);
  return it != blocks_.end() ? &it->second : nullptr;
}

std::optional<BlockPosition> GraphRig::GetBlockPosition(const std::string& id) const {
  auto it = blocks_.find(id);
  if (it == blocks_.end()) return std::nullopt;
  return BlockPosition{it->second.row, it->second.col};
}

std::vector<std::string> GraphRig::ListBlockIds() const {
  std::vector<std::string> ids;
  ids.reserve(blocks_.size());
  for (const auto& [id, block] : blocks_) ids.push_back(id);
  return ids;
}

ConnectOutcome GraphRig::Connect(const Jack& from, const Jack& to, std::optional<std::string> id) {
  const ConnectResult result = CanConnect(blocks_, EdgeValues(), from, to);
  if (!result.ok) return ConnectOutcome::Rejected(*result.reason);

  std::string edge_id = id.has_value() ? std::move(*id) : GenId("edge");
  edges_[edge_id] = EdgeRecord{from, to};
  return ConnectOutcome::Connected(edge_id);
}

void GraphRig::Disconnect(const std::string& edge_id) { edges_.erase(edge_id); }

std::vector<std::string> GraphRig::ListEdgeIds() const {
  std::vector<std::string> ids;
  ids.reserve(edges_.size());
  for (const auto& [id, edge] : edges_) ids.push_back(id);
  return ids;
}

const EdgeRecord* GraphRig::GetEdge(const std::string& id) const {
  auto it = edges_.find(id);
  return it != edges_.end() ? &it->second : nullptr;
}

void GraphRig::Dispose() {
  if (disposed_) return;
  disposed_ = true;
  edges_.clear();
  blocks_.clear();
}

}  // namespace nam_studio::graph
