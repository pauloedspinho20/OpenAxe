// Ports the audio-agnostic cases in apps/web/src/engine/GraphRig.test.ts.
// Excluded (need the un-ported Web-Audio-specific layer): getBlockAnalyser,
// setTunerMuted/master-gain silencing, countActiveHeavyBlocks.
#include "openaxe/graph_rig.h"

#include <string>

#include "test_harness.h"

using openaxe::graph::BlockKind;
using openaxe::graph::GraphRig;
using openaxe::graph::Jack;

namespace {

Jack J(std::string block_id, int port = 0) { return Jack{std::move(block_id), port}; }

void TestStartsEmpty() {
  GraphRig rig;
  OPENAXE_EXPECT(rig.ListBlockIds().empty());
  OPENAXE_EXPECT(rig.ListEdgeIds().empty());
}

void TestAddsBlockAndLooksItUp() {
  GraphRig rig;
  std::string id = rig.AddBlock(BlockKind::kEq, 1, 2);
  auto pos = rig.GetBlockPosition(id);
  OPENAXE_EXPECT(pos.has_value());
  OPENAXE_EXPECT(pos->row == 1);
  OPENAXE_EXPECT(pos->col == 2);
  const auto* block = rig.GetBlock(id);
  OPENAXE_EXPECT(block != nullptr && block->kind == BlockKind::kEq);
}

void TestHonorsExplicitBlockId() {
  GraphRig rig;
  std::string id = rig.AddBlock(BlockKind::kMixer, 0, 0, std::string("my-mixer"));
  OPENAXE_EXPECT(id == "my-mixer");
  auto ids = rig.ListBlockIds();
  OPENAXE_EXPECT(ids.size() == 1 && ids[0] == "my-mixer");
}

void TestConnectsInIncreasingColumnOrder() {
  GraphRig rig;
  std::string a = rig.AddBlock(BlockKind::kEq, 0, 0);
  std::string b = rig.AddBlock(BlockKind::kEq, 0, 1);
  auto result = rig.Connect(J(a), J(b));
  OPENAXE_EXPECT(result.ok);
  OPENAXE_EXPECT(rig.ListEdgeIds().size() == 1);
}

void TestRejectsBackwardConnection() {
  GraphRig rig;
  std::string a = rig.AddBlock(BlockKind::kEq, 0, 1);
  std::string b = rig.AddBlock(BlockKind::kEq, 0, 0);
  auto result = rig.Connect(J(a), J(b));
  OPENAXE_EXPECT(!result.ok);
}

void TestRejectsSecondCableIntoOccupiedJack() {
  GraphRig rig;
  std::string a = rig.AddBlock(BlockKind::kEq, 0, 0);
  std::string b = rig.AddBlock(BlockKind::kEq, 0, 1);
  std::string c = rig.AddBlock(BlockKind::kEq, 0, 1);
  OPENAXE_EXPECT(rig.Connect(J(a), J(b)).ok);
  OPENAXE_EXPECT(!rig.Connect(J(c), J(b)).ok);
}

void TestHonorsExplicitEdgeId() {
  GraphRig rig;
  std::string a = rig.AddBlock(BlockKind::kEq, 0, 0);
  std::string b = rig.AddBlock(BlockKind::kEq, 0, 1);
  auto result = rig.Connect(J(a), J(b), std::string("my-edge"));
  OPENAXE_EXPECT(result.ok);
  OPENAXE_EXPECT(result.id == "my-edge");
  auto ids = rig.ListEdgeIds();
  OPENAXE_EXPECT(ids.size() == 1 && ids[0] == "my-edge");
}

void TestDisconnectsEdgeById() {
  GraphRig rig;
  std::string a = rig.AddBlock(BlockKind::kEq, 0, 0);
  std::string b = rig.AddBlock(BlockKind::kEq, 0, 1);
  auto result = rig.Connect(J(a), J(b));
  rig.Disconnect(result.id);
  OPENAXE_EXPECT(rig.ListEdgeIds().empty());
}

void TestRemovingBlockDropsTouchingEdges() {
  GraphRig rig;
  std::string a = rig.AddBlock(BlockKind::kEq, 0, 0);
  std::string b = rig.AddBlock(BlockKind::kEq, 0, 1);
  std::string c = rig.AddBlock(BlockKind::kEq, 0, 2);
  rig.Connect(J(a), J(b));
  rig.Connect(J(b), J(c));

  rig.RemoveBlock("nonexistent");
  rig.RemoveBlock(b);

  auto remaining = rig.ListBlockIds();
  OPENAXE_EXPECT(remaining.size() == 2);
  OPENAXE_EXPECT(rig.ListEdgeIds().empty());
}

void TestMovingBlockAutoDropsInvalidCable() {
  GraphRig rig;
  std::string a = rig.AddBlock(BlockKind::kEq, 0, 0);
  std::string b = rig.AddBlock(BlockKind::kEq, 0, 1);
  auto connected = rig.Connect(J(a), J(b));

  auto move_result = rig.MoveBlock(a, 0, 5);

  OPENAXE_EXPECT(move_result.dropped_edge_ids.size() == 1);
  OPENAXE_EXPECT(move_result.dropped_edge_ids[0] == connected.id);
  OPENAXE_EXPECT(rig.ListEdgeIds().empty());
}

void TestRoutesMultipleCablesIntoDistinctMixerPorts() {
  GraphRig rig;
  std::string a = rig.AddBlock(BlockKind::kEq, 0, 0);
  std::string b = rig.AddBlock(BlockKind::kEq, 1, 0);
  std::string mixer = rig.AddBlock(BlockKind::kMixer, 0, 1);
  OPENAXE_EXPECT(rig.Connect(J(a), J(mixer, 0)).ok);
  OPENAXE_EXPECT(rig.Connect(J(b), J(mixer, 1)).ok);
  OPENAXE_EXPECT(rig.ListEdgeIds().size() == 2);
}

void TestConnectsInRailAndOutRail() {
  GraphRig rig;
  std::string a = rig.AddBlock(BlockKind::kEq, 0, 0);
  OPENAXE_EXPECT(rig.Connect(J("IN"), J(a)).ok);
  OPENAXE_EXPECT(rig.Connect(J(a), J("OUT")).ok);
}

void TestNoOpForUnknownIdRemoveOrMove() {
  GraphRig rig;
  rig.RemoveBlock("ghost");  // must not crash
  auto move_result = rig.MoveBlock("ghost", 0, 0);
  OPENAXE_EXPECT(move_result.dropped_edge_ids.empty());
}

void TestDisposeIsIdempotent() {
  GraphRig rig;
  std::string a = rig.AddBlock(BlockKind::kEq, 0, 0);
  std::string b = rig.AddBlock(BlockKind::kEq, 0, 1);
  rig.Connect(J(a), J(b));

  rig.Dispose();
  rig.Dispose();

  OPENAXE_EXPECT(rig.ListBlockIds().empty());
  OPENAXE_EXPECT(rig.ListEdgeIds().empty());
}

}  // namespace

int main() {
  TestStartsEmpty();
  TestAddsBlockAndLooksItUp();
  TestHonorsExplicitBlockId();
  TestConnectsInIncreasingColumnOrder();
  TestRejectsBackwardConnection();
  TestRejectsSecondCableIntoOccupiedJack();
  TestHonorsExplicitEdgeId();
  TestDisconnectsEdgeById();
  TestRemovingBlockDropsTouchingEdges();
  TestMovingBlockAutoDropsInvalidCable();
  TestRoutesMultipleCablesIntoDistinctMixerPorts();
  TestConnectsInRailAndOutRail();
  TestNoOpForUnknownIdRemoveOrMove();
  TestDisposeIsIdempotent();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}
