// Ports every case in apps/web/src/engine/graphValidation.test.ts.
#include "nam_studio/graph_validation.h"

#include "test_harness.h"

using nam_studio::graph::BlockKind;
using nam_studio::graph::BlockMap;
using nam_studio::graph::BlockRecord;
using nam_studio::graph::CanConnect;
using nam_studio::graph::EdgeRecord;
using nam_studio::graph::IsEdgeOrderValid;
using nam_studio::graph::Jack;
using nam_studio::graph::RejectReason;

namespace {

Jack J(std::string block_id, int port = 0) { return Jack{std::move(block_id), port}; }

void TestForwardConnectionAllowed() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}}, {"b", {BlockKind::kEq, 0, 1}}};
  auto result = CanConnect(blocks, {}, J("a"), J("b"));
  NAM_EXPECT(result.ok);
}

void TestBackwardConnectionRejected() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 2}}, {"b", {BlockKind::kEq, 0, 0}}};
  auto result = CanConnect(blocks, {}, J("a"), J("b"));
  NAM_EXPECT(!result.ok);
  NAM_EXPECT(result.reason == RejectReason::kWrongOrder);
}

void TestSameColumnRejected() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 3}}, {"b", {BlockKind::kEq, 0, 3}}};
  auto result = CanConnect(blocks, {}, J("a"), J("b"));
  NAM_EXPECT(!result.ok);
}

void TestSelfJackRejected() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}}};
  auto result = CanConnect(blocks, {}, J("a"), J("a"));
  NAM_EXPECT(!result.ok);
  NAM_EXPECT(result.reason == RejectReason::kSelfJack);
}

void TestUnknownSourceOrTargetRejected() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}}};
  NAM_EXPECT(!CanConnect(blocks, {}, J("ghost"), J("a")).ok);
  NAM_EXPECT(!CanConnect(blocks, {}, J("a"), J("ghost")).ok);
}

void TestRailsBypassRealColumns() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}}};
  NAM_EXPECT(CanConnect(blocks, {}, J("IN"), J("a")).ok);
  NAM_EXPECT(CanConnect(blocks, {}, J("a"), J("OUT")).ok);
}

void TestSecondCableIntoNormalJackRejected() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}},
                  {"b", {BlockKind::kEq, 0, 1}},
                  {"c", {BlockKind::kReverb, 0, 0}}};
  std::vector<EdgeRecord> existing{{J("a"), J("b")}};
  auto result = CanConnect(blocks, existing, J("c"), J("b"));
  NAM_EXPECT(!result.ok);
  NAM_EXPECT(result.reason == RejectReason::kInputAlreadyConnected);
}

void TestMixerDistinctPortsAllowed() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}},
                  {"b", {BlockKind::kEq, 0, 0}},
                  {"m", {BlockKind::kMixer, 0, 1}}};
  std::vector<EdgeRecord> existing{{J("a"), J("m", 0)}};
  auto result = CanConnect(blocks, existing, J("b"), J("m", 1));
  NAM_EXPECT(result.ok);
}

void TestMixerDuplicatePortRejected() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}},
                  {"b", {BlockKind::kEq, 0, 0}},
                  {"m", {BlockKind::kMixer, 0, 1}}};
  std::vector<EdgeRecord> existing{{J("a"), J("m", 0)}};
  auto result = CanConnect(blocks, existing, J("b"), J("m", 0));
  NAM_EXPECT(!result.ok);
}

void TestMixerPortOutOfRangeRejected() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}}, {"m", {BlockKind::kMixer, 0, 1}}};
  auto result = CanConnect(blocks, {}, J("a"), J("m", 4));
  NAM_EXPECT(!result.ok);
  NAM_EXPECT(result.reason == RejectReason::kInvalidInputPort);
}

void TestNonZeroPortOnNonMixerRejected() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}}, {"b", {BlockKind::kEq, 0, 1}}};
  auto result = CanConnect(blocks, {}, J("a"), J("b", 1));
  NAM_EXPECT(!result.ok);
}

void TestSplitterDistinctPortsAllowed() {
  BlockMap blocks{{"s", {BlockKind::kSplitter, 0, 0}},
                  {"a", {BlockKind::kCompressor, 0, 1}},
                  {"b", {BlockKind::kEq, 0, 1}}};
  std::vector<EdgeRecord> existing{{J("s", 0), J("a")}};
  auto result = CanConnect(blocks, existing, J("s", 1), J("b"));
  NAM_EXPECT(result.ok);
}

void TestSplitterPortOutOfRangeRejected() {
  BlockMap blocks{{"s", {BlockKind::kSplitter, 0, 0}}, {"a", {BlockKind::kCompressor, 0, 1}}};
  auto result = CanConnect(blocks, {}, J("s", 4), J("a"));
  NAM_EXPECT(!result.ok);
  NAM_EXPECT(result.reason == RejectReason::kInvalidOutputPort);
}

void TestNonZeroSourcePortOnNonSplitterRejected() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}}, {"b", {BlockKind::kEq, 0, 1}}};
  auto result = CanConnect(blocks, {}, J("a", 1), J("b"));
  NAM_EXPECT(!result.ok);
}

void TestIsEdgeOrderValidTrueWhenForward() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}}, {"b", {BlockKind::kEq, 0, 1}}};
  NAM_EXPECT(IsEdgeOrderValid(blocks, {J("a"), J("b")}));
}

void TestIsEdgeOrderValidFalseAfterMove() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 3}}, {"b", {BlockKind::kEq, 0, 1}}};
  NAM_EXPECT(!IsEdgeOrderValid(blocks, {J("a"), J("b")}));
}

}  // namespace

int main() {
  TestForwardConnectionAllowed();
  TestBackwardConnectionRejected();
  TestSameColumnRejected();
  TestSelfJackRejected();
  TestUnknownSourceOrTargetRejected();
  TestRailsBypassRealColumns();
  TestSecondCableIntoNormalJackRejected();
  TestMixerDistinctPortsAllowed();
  TestMixerDuplicatePortRejected();
  TestMixerPortOutOfRangeRejected();
  TestNonZeroPortOnNonMixerRejected();
  TestSplitterDistinctPortsAllowed();
  TestSplitterPortOutOfRangeRejected();
  TestNonZeroSourcePortOnNonSplitterRejected();
  TestIsEdgeOrderValidTrueWhenForward();
  TestIsEdgeOrderValidFalseAfterMove();

  return nam_studio::test::g_failures == 0 ? 0 : 1;
}
