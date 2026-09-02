// Ports every case in apps/web/src/engine/graphValidation.test.ts.
#include "openaxe/graph_validation.h"

#include <string>
#include <vector>

#include "test_harness.h"

using openaxe::graph::BlockKind;
using openaxe::graph::BlockMap;
using openaxe::graph::BlockRecord;
using openaxe::graph::CanConnect;
using openaxe::graph::EdgeRecord;
using openaxe::graph::IsEdgeOrderValid;
using openaxe::graph::Jack;
using openaxe::graph::RejectReason;

namespace {

Jack J(std::string block_id, int port = 0) { return Jack{std::move(block_id), port}; }

void TestForwardConnectionAllowed() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}}, {"b", {BlockKind::kEq, 0, 1}}};
  auto result = CanConnect(blocks, {}, J("a"), J("b"));
  OPENAXE_EXPECT(result.ok);
}

void TestBackwardConnectionRejected() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 2}}, {"b", {BlockKind::kEq, 0, 0}}};
  auto result = CanConnect(blocks, {}, J("a"), J("b"));
  OPENAXE_EXPECT(!result.ok);
  OPENAXE_EXPECT(result.reason == RejectReason::kWrongOrder);
}

void TestSameColumnRejected() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 3}}, {"b", {BlockKind::kEq, 0, 3}}};
  auto result = CanConnect(blocks, {}, J("a"), J("b"));
  OPENAXE_EXPECT(!result.ok);
}

void TestSelfJackRejected() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}}};
  auto result = CanConnect(blocks, {}, J("a"), J("a"));
  OPENAXE_EXPECT(!result.ok);
  OPENAXE_EXPECT(result.reason == RejectReason::kSelfJack);
}

void TestUnknownSourceOrTargetRejected() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}}};
  OPENAXE_EXPECT(!CanConnect(blocks, {}, J("ghost"), J("a")).ok);
  OPENAXE_EXPECT(!CanConnect(blocks, {}, J("a"), J("ghost")).ok);
}

void TestRailsBypassRealColumns() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}}};
  OPENAXE_EXPECT(CanConnect(blocks, {}, J("IN"), J("a")).ok);
  OPENAXE_EXPECT(CanConnect(blocks, {}, J("a"), J("OUT")).ok);
}

void TestSecondCableIntoNormalJackRejected() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}},
                  {"b", {BlockKind::kEq, 0, 1}},
                  {"c", {BlockKind::kReverb, 0, 0}}};
  std::vector<EdgeRecord> existing{{J("a"), J("b")}};
  auto result = CanConnect(blocks, existing, J("c"), J("b"));
  OPENAXE_EXPECT(!result.ok);
  OPENAXE_EXPECT(result.reason == RejectReason::kInputAlreadyConnected);
}

void TestMixerDistinctPortsAllowed() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}},
                  {"b", {BlockKind::kEq, 0, 0}},
                  {"m", {BlockKind::kMixer, 0, 1}}};
  std::vector<EdgeRecord> existing{{J("a"), J("m", 0)}};
  auto result = CanConnect(blocks, existing, J("b"), J("m", 1));
  OPENAXE_EXPECT(result.ok);
}

void TestMixerDuplicatePortRejected() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}},
                  {"b", {BlockKind::kEq, 0, 0}},
                  {"m", {BlockKind::kMixer, 0, 1}}};
  std::vector<EdgeRecord> existing{{J("a"), J("m", 0)}};
  auto result = CanConnect(blocks, existing, J("b"), J("m", 0));
  OPENAXE_EXPECT(!result.ok);
}

void TestMixerPortOutOfRangeRejected() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}}, {"m", {BlockKind::kMixer, 0, 1}}};
  auto result = CanConnect(blocks, {}, J("a"), J("m", 4));
  OPENAXE_EXPECT(!result.ok);
  OPENAXE_EXPECT(result.reason == RejectReason::kInvalidInputPort);
}

void TestNonZeroPortOnNonMixerRejected() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}}, {"b", {BlockKind::kEq, 0, 1}}};
  auto result = CanConnect(blocks, {}, J("a"), J("b", 1));
  OPENAXE_EXPECT(!result.ok);
}

// Nothing has a second output port any more - the splitter was the only kind
// that did - so any non-zero source port is invalid.
void TestNonZeroSourcePortRejected() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}}, {"b", {BlockKind::kEq, 0, 1}}};
  auto result = CanConnect(blocks, {}, J("a", 1), J("b"));
  OPENAXE_EXPECT(!result.ok);
}

void TestIsEdgeOrderValidTrueWhenForward() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 0}}, {"b", {BlockKind::kEq, 0, 1}}};
  OPENAXE_EXPECT(IsEdgeOrderValid(blocks, {J("a"), J("b")}));
}

void TestIsEdgeOrderValidFalseAfterMove() {
  BlockMap blocks{{"a", {BlockKind::kCompressor, 0, 3}}, {"b", {BlockKind::kEq, 0, 1}}};
  OPENAXE_EXPECT(!IsEdgeOrderValid(blocks, {J("a"), J("b")}));
}

// Send/Return (issue #274): a Send is input-only and a Return output-only -
// the pairing is implicit in the engine, never a cable, so CanConnect must
// refuse a cable out of a Send and a cable into a Return, while the valid
// sides (cable into a Send, cable out of a Return) keep working like normal.
void TestSendAcceptsInputButNoOutput() {
  BlockMap blocks{{"s", {BlockKind::kSend1, 0, 0}}, {"b", {BlockKind::kEq, 0, 1}}};
  OPENAXE_EXPECT(CanConnect(blocks, {}, J("IN"), J("s")).ok);
  auto out = CanConnect(blocks, {}, J("s"), J("b"));
  OPENAXE_EXPECT(!out.ok);
  OPENAXE_EXPECT(out.reason == RejectReason::kInvalidOutputPort);
  auto to_rail = CanConnect(blocks, {}, J("s"), J("OUT"));
  OPENAXE_EXPECT(!to_rail.ok);
  OPENAXE_EXPECT(to_rail.reason == RejectReason::kInvalidOutputPort);
}

void TestReturnAcceptsOutputButNoInput() {
  BlockMap blocks{{"b", {BlockKind::kEq, 0, 0}}, {"r", {BlockKind::kReturn1, 0, 1}}};
  OPENAXE_EXPECT(CanConnect(blocks, {}, J("r"), J("OUT")).ok);
  auto in = CanConnect(blocks, {}, J("b"), J("r"));
  OPENAXE_EXPECT(!in.ok);
  OPENAXE_EXPECT(in.reason == RejectReason::kInvalidInputPort);
  auto from_rail = CanConnect(blocks, {}, J("IN"), J("r"));
  OPENAXE_EXPECT(!from_rail.ok);
  OPENAXE_EXPECT(from_rail.reason == RejectReason::kInvalidInputPort);
}

// Send 2 / Return 2 behave identically to Send 1 / Return 1.
void TestSendReturnSecondPairSameRules() {
  BlockMap blocks{{"s", {BlockKind::kSend2, 0, 0}}, {"r", {BlockKind::kReturn2, 0, 1}}};
  OPENAXE_EXPECT(CanConnect(blocks, {}, J("IN"), J("s")).ok);
  OPENAXE_EXPECT(CanConnect(blocks, {}, J("r"), J("OUT")).ok);
  OPENAXE_EXPECT(!CanConnect(blocks, {}, J("s"), J("r")).ok);
  OPENAXE_EXPECT(!CanConnect(blocks, {}, J("IN"), J("r")).ok);
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
  TestNonZeroSourcePortRejected();
  TestIsEdgeOrderValidTrueWhenForward();
  TestIsEdgeOrderValidFalseAfterMove();
  TestSendAcceptsInputButNoOutput();
  TestReturnAcceptsOutputButNoInput();
  TestSendReturnSecondPairSameRules();

  return openaxe::test::g_failures == 0 ? 0 : 1;
}
