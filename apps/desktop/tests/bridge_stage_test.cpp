#include <nlohmann/json.hpp>

#include <cstdio>
#include <string>

#include "bridge.h"

// Gapless staged switching through the desktop bridge (issue #367): the
// staged lifecycle (begin -> build with "stage":true -> commit -> adopted
// bookkeeping), discard, error paths, and the no-suspend property (no audio
// stream is ever opened here - if staging suspended audio the way live
// mutations do, these calls would hit the suspend-timeout path; they don't).
//
// loadModel is deliberately not exercised (it opens a native modal dialog).

static int g_failures = 0;

#define CHECK(cond)                                      \
  do {                                                   \
    if (!(cond)) {                                       \
      std::fprintf(stderr, "CHECK failed: %s (%s:%d)\n", \
                   #cond, __FILE__, __LINE__);           \
      ++g_failures;                                      \
    }                                                    \
  } while (0)

namespace {

nlohmann::json Parse(const std::string& s) {
  const auto j = nlohmann::json::parse(s, nullptr, false);
  CHECK(!j.is_discarded());
  return j.is_discarded() ? nlohmann::json() : j;
}

const char* Arr(const char* obj) { return obj; }

nlohmann::json Call(openaxe_desktop::StudioBridge& bridge,
                    std::string (openaxe_desktop::StudioBridge::*handler)(const std::string&),
                    const char* req) {
  return Parse((bridge.*handler)(Arr(req)));
}

}  // namespace

// Full lifecycle: live rig with one block, stage a different rig, commit,
// and the live bookkeeping now describes the staged rig (same js ids, new
// core graph) while the old blocks are gone.
static void TestStageLifecycleAdoptsBookkeeping() {
  openaxe_desktop::StudioBridge bridge;
  using H = std::string (openaxe_desktop::StudioBridge::*)(const std::string&);

  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleAddBlock),
             R"([{"kind":"delay","row":0,"col":0,"id":"d1"}])")["ok"] == true);

  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleStageBegin), "")["ok"] ==
        true);
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleAddBlock),
             R"([{"kind":"eq","row":0,"col":0,"id":"e1","stage":true}])")["ok"] == true);
  // The live graph is untouched by the staged build.
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleBlockInfo),
             R"([{"blockId":"e1"}])")["ok"] == false);
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleBlockInfo),
             R"([{"blockId":"e1","stage":true}])")["ok"] == true);
  // Staged param write lands on the staged engine.
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleSetParam),
             R"([{"blockId":"e1","key":"band0_gain","value":3.0,"stage":true}])")["ok"] ==
        true);
  auto got = Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleGetParam),
                  R"([{"blockId":"e1","key":"band0_gain","stage":true}])");
  CHECK(got["ok"] == true);

  auto commit = Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleStageCommit),
                     R"([{"fadeMs":5,"drainMs":20}])");
  CHECK(commit["ok"] == true);

  // Adopted: the staged block is now live, the old live block is gone.
  auto info = Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleBlockInfo),
                   R"([{"blockId":"e1"}])");
  CHECK(info["ok"] == true && info["kind"] == "eq");
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleBlockInfo),
             R"([{"blockId":"d1"}])")["ok"] == false);
  auto blocks = Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleListBlocks), "");
  CHECK(blocks.is_array() && blocks.size() == 1 && blocks[0]["id"] == "e1");
}

// Staged connect resolves against the staged maps, and staged edges ride the
// commit into the live bookkeeping.
static void TestStagedConnectCommitsEdges() {
  openaxe_desktop::StudioBridge bridge;
  using H = std::string (openaxe_desktop::StudioBridge::*)(const std::string&);

  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleStageBegin), "")["ok"] ==
        true);
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleAddBlock),
             R"([{"kind":"mixer","row":0,"col":1,"id":"m1","stage":true}])")["ok"] == true);
  auto connect = Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleConnect),
                      R"([{"fromId":-1,"fromPort":0,"toId":"m1","toPort":0,"id":"e1","stage":true}])");
  CHECK(connect["ok"] == true);
  // Unknown staged block rejects cleanly.
  auto bad = Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleConnect),
                  R"([{"fromId":-1,"fromPort":0,"toId":"nope","toPort":0,"stage":true}])");
  CHECK(bad["ok"] == false);

  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleStageCommit),
             R"([{"fadeMs":5,"drainMs":20}])")["ok"] == true);
  auto edges = Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleListEdges), "");
  CHECK(edges.is_array() && edges.size() == 1 && edges[0]["id"] == "e1");
}

// Discarding abandons the staged build; the live rig is untouched and a fresh
// stage works afterwards.
static void TestStageDiscard() {
  openaxe_desktop::StudioBridge bridge;
  using H = std::string (openaxe_desktop::StudioBridge::*)(const std::string&);

  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleAddBlock),
             R"([{"kind":"delay","row":0,"col":0,"id":"d1"}])")["ok"] == true);
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleStageBegin), "")["ok"] ==
        true);
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleAddBlock),
             R"([{"kind":"eq","row":0,"col":0,"id":"e1","stage":true}])")["ok"] == true);
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleStageDiscard),
             "")["ok"] == true);

  // Staged maps are gone; the live block survived.
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleBlockInfo),
             R"([{"blockId":"e1","stage":true}])")["ok"] == false);
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleBlockInfo),
             R"([{"blockId":"d1"}])")["ok"] == true);

  // Committing with nothing staged fails cleanly.
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleStageCommit),
             R"([{"fadeMs":5,"drainMs":20}])")["ok"] == false);

  // A fresh stage still works afterwards.
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleStageBegin), "")["ok"] ==
        true);
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleAddBlock),
             R"([{"kind":"eq","row":0,"col":0,"id":"e1","stage":true}])")["ok"] == true);
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleStageCommit),
             R"([{"fadeMs":5,"drainMs":20}])")["ok"] == true);
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleBlockInfo),
             R"([{"blockId":"e1"}])")["ok"] == true);
}

// Staged mutations with no staged graph open fail cleanly (never a crash),
// and stageBegin twice abandons the first stage.
static void TestStagedWithoutBegin() {
  openaxe_desktop::StudioBridge bridge;
  using H = std::string (openaxe_desktop::StudioBridge::*)(const std::string&);

  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleAddBlock),
             R"([{"kind":"eq","row":0,"col":0,"id":"e1","stage":true}])")["ok"] == false);
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleSetParam),
             R"([{"blockId":"e1","key":"band0_gain","value":1.0,"stage":true}])")["ok"] ==
        false);

  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleStageBegin), "")["ok"] ==
        true);
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleAddBlock),
             R"([{"kind":"eq","row":0,"col":0,"id":"abandoned","stage":true}])")["ok"] == true);
  // Second begin drops the first staged build.
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleStageBegin), "")["ok"] ==
        true);
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleBlockInfo),
             R"([{"blockId":"abandoned","stage":true}])")["ok"] == false);
}

// A second commit while the first is still unpublished reports busy (no audio
// stream runs here, so the first commit is never picked up by process()).
static void TestCommitWhileUnpickedIsBusy() {
  openaxe_desktop::StudioBridge bridge;
  using H = std::string (openaxe_desktop::StudioBridge::*)(const std::string&);

  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleStageBegin), "")["ok"] ==
        true);
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleAddBlock),
             R"([{"kind":"eq","row":0,"col":0,"id":"e1","stage":true}])")["ok"] == true);
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleStageCommit),
             R"([{"fadeMs":5,"drainMs":20}])")["ok"] == true);

  // The staged handle is consumed, so begin a new stage and try to commit it
  // while the first commit is still unpublished (no process() call picks it
  // up without a running stream).
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleStageBegin), "")["ok"] ==
        true);
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleAddBlock),
             R"([{"kind":"delay","row":0,"col":0,"id":"d1","stage":true}])")["ok"] == true);
  auto second = Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleStageCommit),
                     R"([{"fadeMs":5,"drainMs":20}])");
  CHECK(second["ok"] == false && second["busy"] == true);
  // The staged build survives the busy reply - discarding still works.
  CHECK(Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleStageDiscard),
             "")["ok"] == true);
}

// switchActive reflects the core with no stream running (no switch in
// flight -> inactive).
static void TestSwitchActive() {
  openaxe_desktop::StudioBridge bridge;
  using H = std::string (openaxe_desktop::StudioBridge::*)(const std::string&);
  auto r = Call(bridge, static_cast<H>(&openaxe_desktop::StudioBridge::HandleSwitchActive), "");
  CHECK(r["ok"] == true && r["active"] == false);
}

int main() {
  TestStageLifecycleAdoptsBookkeeping();
  TestStagedConnectCommitsEdges();
  TestStageDiscard();
  TestStagedWithoutBegin();
  TestCommitWhileUnpickedIsBusy();
  TestSwitchActive();

  if (g_failures == 0) std::printf("bridge_stage_test: all passed\n");
  return g_failures == 0 ? 0 : 1;
}
