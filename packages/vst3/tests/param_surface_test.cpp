// CTest for the host parameter surface scaffolding (issue #127).
// Verifies the stable 302-param layout from generated/automation_param_map.h,
// normalized<->real helpers, group names, and the slim_size control-thread
// routing signal — all without needing the iPlug2 SDK or a host.
//
// This mirrors the "drift check" (#121 generator) and the contract in
// src/automation_params.h: changing any id here breaks every saved project.

#include <cmath>
#include <cstdio>
#include <string>

#include "../generated/automation_param_map.h"
#include "../src/automation_params.h"
#include "openaxe/api.h"

static int g_failures = 0;
#define CHECK(cond) do { if (!(cond)) { std::fprintf(stderr, "CHECK failed: %s (%s:%d)\n", #cond, __FILE__, __LINE__); ++g_failures; } } while (0)

namespace {

void TestHostParamCount() {
  CHECK(openaxe_vst3::params::HostParamCount() == 302);
  CHECK(openaxe::automation::kTotalPluginParams == 302);
  std::printf("  param count: %d (2 master + 15*20)\n", openaxe_vst3::params::HostParamCount());
}

void TestHostIdLayout() {
  using namespace openaxe::automation;
  // Master ids 0,1
  CHECK(SlotParamId(1, 0) == 2);
  CHECK(SlotParamId(1, 19) == 21);
  CHECK(SlotParamId(15, 0) == 2 + 14*20);
  CHECK(SlotParamId(15, 19) == 2 + 15*20 -1);
  // Round-trip through helper
  for (int id = 0; id < kTotalPluginParams; ++id) {
    int slot=-1, entry=-1;
    CHECK(openaxe_vst3::params::HostIdToSlotEntry(id, slot, entry));
    const int back = openaxe_vst3::params::SlotEntryToHostId(slot, entry);
    CHECK(back == id);
  }
  // Master round-trip
  int s,e;
  CHECK(openaxe_vst3::params::HostIdToSlotEntry(0, s, e) && s==0 && e==0);
  CHECK(openaxe_vst3::params::HostIdToSlotEntry(1, s, e) && s==0 && e==1);
  CHECK(openaxe_vst3::params::HostIdToSlotEntry(2, s, e) && s==1 && e==0);
  std::printf("  host id layout: SlotParamId + HostId<->SlotEntry round-trip ok\n");
}

void TestNormalizedHelpers() {
  CHECK(std::fabs(openaxe_vst3::params::NormalizedToReal(0.0f, -60, 0) - (-60.f)) < 1e-6);
  CHECK(std::fabs(openaxe_vst3::params::NormalizedToReal(1.0f, -60, 0) - 0.f) < 1e-6);
  CHECK(std::fabs(openaxe_vst3::params::NormalizedToReal(0.5f, -60, 0) - (-30.f)) < 1e-6);
  CHECK(std::fabs(openaxe_vst3::params::RealToNormalized(-30.f, -60, 0) - 0.5f) < 1e-6);
  // dB range clamp
  CHECK(openaxe_vst3::params::NormalizedToReal(2.0f, 0, 1) == 1.0f);
  CHECK(openaxe_vst3::params::RealToNormalized(999.f, 0, 1) == 1.0f);
  std::printf("  normalized<->real linear mapping ok\n");
}

void TestGroups() {
  CHECK(openaxe_vst3::params::GroupForSlot(0) == "Master");
  CHECK(openaxe_vst3::params::GroupForSlot(1) == "Slot 1");
  CHECK(openaxe_vst3::params::GroupForSlot(15) == "Slot 15");
  std::printf("  groups: Master, Slot 1..15\n");
}

void TestDisplayAndSlimRouting() {
  NamStudioGraph* g = nam_studio_graph_create();
  // Master slot display should work even with no blocks bound — it resolves
  // to the fixed master descriptors (level at norm 0.5 -> 0.75x).
  const std::string disp = openaxe_vst3::params::DisplayForSlotEntry(g, 0, 0, 0.5f);
  CHECK(!disp.empty() && disp != "—");
  // Master mute too
  const std::string mute = openaxe_vst3::params::DisplayForSlotEntry(g, 0, 1, 1.0f);
  CHECK(!mute.empty());
  // Unbound block slot entry resolves to "—"
  const std::string unbound = openaxe_vst3::params::DisplayForSlotEntry(g, 5, 0, 0.5f);
  CHECK(unbound == "—");

  // Bind a real block to slot 1 and verify display resolves live.
  int32_t comp = nam_studio_add_block(g, NAM_STUDIO_BLOCK_COMPRESSOR, 0, 0);
  nam_studio_bind_automation_slot(g, 1, comp);
  const std::string compDisp = openaxe_vst3::params::DisplayForSlotEntry(g, 1, 0, 0.5f);
  CHECK(compDisp != "—");
  CHECK(compDisp.find("dB") != std::string::npos || compDisp.find("x") != std::string::npos || compDisp.find("%") != std::string::npos);

  // HostParamWrite for a normal param should succeed lock-free.
  bool needs=false;
  CHECK(openaxe_vst3::params::HostParamWrite(g, 2, 0.5f, needs) && !needs);
  // For an unbound slot, write still succeeds (remembered value update).
  CHECK(openaxe_vst3::params::HostParamWrite(g, openaxe_vst3::params::SlotEntryToHostId(5, 0), 0.25f, needs) && !needs);
  CHECK(std::fabs(nam_studio_get_automation_param_normalized(g, 5, 0) - 0.25f) < 1e-6);

  // Amp slim_size is the Tier-2 special case. Bind an amp to slot 2 and drive
  // its slim_size entry — HostParamWrite must signal needs_suspend.
  NamStudioGraph* g2 = nam_studio_graph_create();
  int32_t amp = nam_studio_add_block(g2, NAM_STUDIO_BLOCK_AMP, 0, 0);
  // Amp param table: input_level=0, output_level=1, slim_size=2 (see param_schema)
  const int32_t ampCount = nam_studio_block_param_count(g2, amp);
  CHECK(ampCount >= 3);
  nam_studio_bind_automation_slot(g2, 2, amp);
  const int slimHostId = openaxe_vst3::params::SlotEntryToHostId(2, 2);
  bool needs2=false;
  // Before the fix this mistakenly went lock-free; now it must route via suspend
  const bool ok = openaxe_vst3::params::HostParamWrite(g2, slimHostId, 0.5f, needs2);
  CHECK(!ok && needs2);
  std::printf("  slim_size write correctly signals needs_suspend\n");

  nam_studio_graph_destroy(g);
  nam_studio_graph_destroy(g2);
}

} // namespace

int main() {
  TestHostParamCount();
  TestHostIdLayout();
  TestNormalizedHelpers();
  TestGroups();
  TestDisplayAndSlimRouting();
  if (g_failures) { std::fprintf(stderr, "%d failure(s)\n", g_failures); return 1; }
  std::printf("param_surface_test: all checks passed\n");
  return 0;
}
