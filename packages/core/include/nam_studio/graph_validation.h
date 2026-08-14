#pragma once

#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "nam_studio/block.h"
#include "nam_studio/grid_config.h"

// Ported from apps/web/src/engine/graphValidation.ts - pure functions, no
// classes, shared verbatim between the graph engine and (eventually) any
// plain-data mirror of it, so a UI-level connect and an engine-level connect
// can never disagree.
namespace nam_studio::graph {

using BlockMap = std::unordered_map<std::string, BlockRecord>;

struct EdgeRecord {
  Jack from;
  Jack to;
};

// Distinguishable rejection categories - doesn't need to match
// graphValidation.ts's human-readable strings, just the same branch
// order/semantics (tests pin exact rejection per case).
enum class RejectReason {
  kSelfJack,
  kUnknownSource,
  kUnknownTarget,
  kWrongOrder,
  kInvalidInputPort,
  kInvalidOutputPort,
  kInputAlreadyConnected,
};

struct ConnectResult {
  bool ok = false;
  std::optional<RejectReason> reason;  // nullopt iff ok
};

// Shared connection rules: left-to-right by column only (no cycles possible
// by construction - see kInRail/kOutRail's virtual columns below), and at
// most one cable per input jack (a Mixer's several ports each count
// separately). Checks, in order: self-jack, unknown source, unknown target,
// column order, target port range, source port range, duplicate-target-jack.
ConnectResult CanConnect(const BlockMap& blocks, const std::vector<EdgeRecord>& edges,
                          const Jack& from, const Jack& to);

// True while this edge's ordering is still valid given blocks' current
// columns - reused when a block moves, to detect now-invalid edges.
bool IsEdgeOrderValid(const BlockMap& blocks, const EdgeRecord& edge);

}  // namespace nam_studio::graph
