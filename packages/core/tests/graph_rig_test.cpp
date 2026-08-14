// Ports the audio-agnostic cases in apps/web/src/engine/GraphRig.test.ts.
// Excluded (need the un-ported Web-Audio-specific layer): getBlockAnalyser,
// setTunerMuted/master-gain silencing, countActiveHeavyBlocks.
#include "nam_studio/graph_rig.h"

#include "test_harness.h"

using nam_studio::graph::BlockKind;
using nam_studio::graph::GraphRig;
using nam_studio::graph::Jack;

namespace {

Jack J(std::string block_id, int port = 0) { return Jack{std::move(block_id), port}; }

void TestStartsEmpty() {
  GraphRig rig;
  NAM_EXPECT(rig.ListBlockIds().empty());
  NAM_EXPECT(rig.ListEdgeIds().empty());
}

void TestAddsBlockAndLooksItUp() {
  GraphRig rig;
  std::string id = rig.AddBlock(BlockKind::kEq, 1, 2);
  auto pos = rig.GetBlockPosition(id);
  NAM_EXPECT(pos.has_value());
  NAM_EXPECT(pos->row == 1);
  NAM_EXPECT(pos->col == 2);
  const auto* block = rig.GetBlock(id);
  NAM_EXPECT(block != nullptr && block->kind == BlockKind::kEq);
}

void TestHonorsExplicitBlockId() {
  GraphRig rig;
  std::string id = rig.AddBlock(BlockKind::kMixer, 0, 0, std::string("my-mixer"));
  NAM_EXPECT(id == "my-mixer");
  auto ids = rig.ListBlockIds();
  NAM_EXPECT(ids.size() == 1 && ids[0] == "my-mixer");
}

void TestConnectsInIncreasingColumnOrder() {
  GraphRig rig;
  std::string a = rig.AddBlock(BlockKind::kEq, 0, 0);
  std::string b = rig.AddBlock(BlockKind::kEq, 0, 1);
  auto result = rig.Connect(J(a), J(b));
  NAM_EXPECT(result.ok);
  NAM_EXPECT(rig.ListEdgeIds().size() == 1);
}

void TestRejectsBackwardConnection() {
  GraphRig rig;
  std::string a = rig.AddBlock(BlockKind::kEq, 0, 1);
  std::string b = rig.AddBlock(BlockKind::kEq, 0, 0);
  auto result = rig.Connect(J(a), J(b));
  NAM_EXPECT(!result.ok);
}

void TestRejectsSecondCableIntoOccupiedJack() {
  GraphRig rig;
  std::string a = rig.AddBlock(BlockKind::kEq, 0, 0);
  std::string b = rig.AddBlock(BlockKind::kEq, 0, 1);
  std::string c = rig.AddBlock(BlockKind::kEq, 0, 1);
  NAM_EXPECT(rig.Connect(J(a), J(b)).ok);
  NAM_EXPECT(!rig.Connect(J(c), J(b)).ok);
}

void TestHonorsExplicitEdgeId() {
  GraphRig rig;
  std::string a = rig.AddBlock(BlockKind::kEq, 0, 0);
  std::string b = rig.AddBlock(BlockKind::kEq, 0, 1);
  auto result = rig.Connect(J(a), J(b), std::string("my-edge"));
  NAM_EXPECT(result.ok);
  NAM_EXPECT(result.id == "my-edge");
  auto ids = rig.ListEdgeIds();
  NAM_EXPECT(ids.size() == 1 && ids[0] == "my-edge");
}

void TestDisconnectsEdgeById() {
  GraphRig rig;
  std::string a = rig.AddBlock(BlockKind::kEq, 0, 0);
  std::string b = rig.AddBlock(BlockKind::kEq, 0, 1);
  auto result = rig.Connect(J(a), J(b));
  rig.Disconnect(result.id);
  NAM_EXPECT(rig.ListEdgeIds().empty());
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
  NAM_EXPECT(remaining.size() == 2);
  NAM_EXPECT(rig.ListEdgeIds().empty());
}

void TestMovingBlockAutoDropsInvalidCable() {
  GraphRig rig;
  std::string a = rig.AddBlock(BlockKind::kEq, 0, 0);
  std::string b = rig.AddBlock(BlockKind::kEq, 0, 1);
  auto connected = rig.Connect(J(a), J(b));

  auto move_result = rig.MoveBlock(a, 0, 5);

  NAM_EXPECT(move_result.dropped_edge_ids.size() == 1);
  NAM_EXPECT(move_result.dropped_edge_ids[0] == connected.id);
  NAM_EXPECT(rig.ListEdgeIds().empty());
}

void TestRoutesMultipleCablesIntoDistinctMixerPorts() {
  GraphRig rig;
  std::string a = rig.AddBlock(BlockKind::kEq, 0, 0);
  std::string b = rig.AddBlock(BlockKind::kEq, 1, 0);
  std::string mixer = rig.AddBlock(BlockKind::kMixer, 0, 1);
  NAM_EXPECT(rig.Connect(J(a), J(mixer, 0)).ok);
  NAM_EXPECT(rig.Connect(J(b), J(mixer, 1)).ok);
  NAM_EXPECT(rig.ListEdgeIds().size() == 2);
}

void TestConnectsInRailAndOutRail() {
  GraphRig rig;
  std::string a = rig.AddBlock(BlockKind::kEq, 0, 0);
  NAM_EXPECT(rig.Connect(J("IN"), J(a)).ok);
  NAM_EXPECT(rig.Connect(J(a), J("OUT")).ok);
}

void TestNoOpForUnknownIdRemoveOrMove() {
  GraphRig rig;
  rig.RemoveBlock("ghost");  // must not crash
  auto move_result = rig.MoveBlock("ghost", 0, 0);
  NAM_EXPECT(move_result.dropped_edge_ids.empty());
}

void TestDisposeIsIdempotent() {
  GraphRig rig;
  std::string a = rig.AddBlock(BlockKind::kEq, 0, 0);
  std::string b = rig.AddBlock(BlockKind::kEq, 0, 1);
  rig.Connect(J(a), J(b));

  rig.Dispose();
  rig.Dispose();

  NAM_EXPECT(rig.ListBlockIds().empty());
  NAM_EXPECT(rig.ListEdgeIds().empty());
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

  return nam_studio::test::g_failures == 0 ? 0 : 1;
}
