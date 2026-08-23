// Issue #121's proof: the automation slot map gives hosts a fixed,
// session-stable parameter surface over a dynamic rig. Covers the two
// headline behaviours - a slot's value survives rebinding to a different
// block kind without jumping, and automation written against a slot lands on
// the same control after a save/reload cycle - plus master-slot immutability,
// dynamic descriptor resolution, remove/clear unbinding, normalization
// clamping, and soft-failure tolerance for malformed binding documents.

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "openaxe/api.h"
#include "openaxe/engine.h"
#include "serialization/rig_state.h"
#include "test_harness.h"

namespace {

constexpr int32_t kInRail = NAM_STUDIO_IN_RAIL;
constexpr int32_t kOutRail = NAM_STUDIO_OUT_RAIL;

// Schema rows the tests reason about (from param_schema.json / the generated
// .inc fragments; compressor[0]/delay[0]/tremolo[0]).
constexpr float kCompThresholdMin = -60.0f;
constexpr float kCompThresholdMax = 0.0f;
constexpr float kDelayTimeMin = 10.0f;
constexpr float kDelayTimeMax = 1000.0f;

float Denorm(float n, float min, float max) { return min + (max - min) * n; }

// IN -> block 0 -> OUT, one amp-free chain so no model loading is needed.
void WireThrough(NamStudioGraph* g) {
  OPENAXE_EXPECT(nam_studio_connect(g, kInRail, 0, 0, 0) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(g, 0, 0, kOutRail, 0) >= 0);
}

bool FuzzyEq(float a, float b) { return std::fabs(a - b) <= 1e-5f * std::max({1.0f, std::fabs(a), std::fabs(b)}); }

}  // namespace

int main() {
  // ── Layout sanity + slot 0 immutability ──────────────────────────────────
  {
    NamStudioGraph* g = nam_studio_graph_create();
    const int32_t comp = nam_studio_add_block(g, NAM_STUDIO_BLOCK_COMPRESSOR, 0, 0);

    OPENAXE_EXPECT(nam_studio_bind_automation_slot(g, 0, comp) == 0);   // master: never bindable
    OPENAXE_EXPECT(nam_studio_unbind_automation_slot(g, 0) == 0);       // ...nor unbindable
    OPENAXE_EXPECT(nam_studio_automation_slot_block(g, 0) == -3);       // exists, is the bus
    OPENAXE_EXPECT(nam_studio_automation_slot_param_count(g, 0) == 2);  // level + mute

    OPENAXE_EXPECT(nam_studio_bind_automation_slot(g, -1, comp) == 0);
    OPENAXE_EXPECT(nam_studio_bind_automation_slot(g, NAM_STUDIO_AUTOMATION_SLOT_COUNT, comp) == 0);
    OPENAXE_EXPECT(nam_studio_bind_automation_slot(g, 3, 999) == 0);  // unknown block
    OPENAXE_EXPECT(nam_studio_automation_slot_block(g, -5) == -2);
    OPENAXE_EXPECT(nam_studio_automation_slot_param_count(g, NAM_STUDIO_AUTOMATION_SLOT_COUNT + 3) ==
               0);

    // Unbound block slots report themselves and expose the full stride.
    OPENAXE_EXPECT(nam_studio_automation_slot_block(g, 7) == -1);
    OPENAXE_EXPECT(nam_studio_automation_slot_param_count(g, 7) ==
               NAM_STUDIO_AUTOMATION_PARAMS_PER_SLOT);
    // Nothing resolves on an unbound slot.
    const char* name = nullptr;
    OPENAXE_EXPECT(nam_studio_automation_slot_param_info(g, 7, 0, &name, nullptr, nullptr, nullptr,
                                                     nullptr) == 0);
    nam_studio_graph_destroy(g);
  }

  // ── Master slot: fixed descriptors, writes land on the bus ───────────────
  {
    NamStudioGraph* g = nam_studio_graph_create();
    const char* symbol = nullptr;
    const char* name = nullptr;
    float min = 0.0f;
    float max = 0.0f;
    OPENAXE_EXPECT(nam_studio_automation_slot_param_info(g, 0, 0, &name, &symbol, &min, &max,
                                                     nullptr) == 1);
    OPENAXE_EXPECT(std::strcmp(symbol, "level") == 0 && std::strcmp(name, "Master Level") == 0);
    OPENAXE_EXPECT(min == 0.0f && max == 1.5f);
    OPENAXE_EXPECT(nam_studio_automation_slot_param_info(g, 0, 1, nullptr, &symbol, nullptr, nullptr,
                                                     nullptr) == 1);
    OPENAXE_EXPECT(std::strcmp(symbol, "muted") == 0);
    OPENAXE_EXPECT(nam_studio_automation_slot_param_info(g, 0, 2, nullptr, &symbol, nullptr, nullptr,
                                                     nullptr) == 0);  // past the master table

    nam_studio_set_automation_param_normalized(g, 0, 0, 0.5f);
    OPENAXE_EXPECT(FuzzyEq(nam_studio_get_master_level(g), 0.75f));  // midpoint of 0..1.5
    OPENAXE_EXPECT(FuzzyEq(nam_studio_get_automation_param_normalized(g, 0, 0), 0.5f));

    nam_studio_set_automation_param_normalized(g, 0, 1, 0.4f);
    OPENAXE_EXPECT(nam_studio_is_master_muted(g) == 0);  // below the 0.5 flip point
    nam_studio_set_automation_param_normalized(g, 0, 1, 1.0f);
    OPENAXE_EXPECT(nam_studio_is_master_muted(g) == 1);
    OPENAXE_EXPECT(nam_studio_get_automation_param_normalized(g, 0, 1) == 1.0f);
    nam_studio_graph_destroy(g);
  }

  // ── Write-through with dynamic resolution ────────────────────────────────
  {
    NamStudioGraph* g = nam_studio_graph_create();
    const int32_t comp = nam_studio_add_block(g, NAM_STUDIO_BLOCK_COMPRESSOR, 0, 0);
    OPENAXE_EXPECT(nam_studio_bind_automation_slot(g, 3, comp) == 1);
    OPENAXE_EXPECT(nam_studio_automation_slot_block(g, 3) == comp);

    const char* symbol = nullptr;
    float min = 0.0f;
    float max = 0.0f;
    OPENAXE_EXPECT(nam_studio_automation_slot_param_info(g, 3, 0, nullptr, &symbol, &min, &max,
                                                     nullptr) == 1);
    OPENAXE_EXPECT(std::strcmp(symbol, "threshold") == 0);  // resolved from the live table
    OPENAXE_EXPECT(min == kCompThresholdMin && max == kCompThresholdMax);

    nam_studio_set_automation_param_normalized(g, 3, 0, 0.25f);
    OPENAXE_EXPECT(FuzzyEq(nam_studio_get_param(g, comp, 0), Denorm(0.25f, kCompThresholdMin,
                                                               kCompThresholdMax)));
    OPENAXE_EXPECT(FuzzyEq(nam_studio_get_automation_param_normalized(g, 3, 0), 0.25f));

    // Clamping: out-of-range normalized values pin to the range edges.
    nam_studio_set_automation_param_normalized(g, 3, 0, 42.0f);
    OPENAXE_EXPECT(FuzzyEq(nam_studio_get_param(g, comp, 0), kCompThresholdMax));
    nam_studio_set_automation_param_normalized(g, 3, 0, -7.0f);
    OPENAXE_EXPECT(FuzzyEq(nam_studio_get_param(g, comp, 0), kCompThresholdMin));
    nam_studio_set_automation_param_normalized(g, 3, 0, 0.25f);

    // Entries beyond the bound block's own table resolve to nothing...
    OPENAXE_EXPECT(nam_studio_automation_slot_param_info(g, 3, 15, nullptr, &symbol, nullptr, nullptr,
                                                     nullptr) == 0);
    // ...but still remember what was written through them.
    nam_studio_set_automation_param_normalized(g, 3, 15, 0.9f);
    OPENAXE_EXPECT(nam_studio_get_automation_param_normalized(g, 3, 15) == 0.9f);
    nam_studio_graph_destroy(g);
  }

  // ── THE REBIND TEST: value survives a kind swap without jumping ─────────
  {
    NamStudioGraph* g = nam_studio_graph_create();
    const int32_t comp = nam_studio_add_block(g, NAM_STUDIO_BLOCK_COMPRESSOR, 0, 0);
    const int32_t delay = nam_studio_add_block(g, NAM_STUDIO_BLOCK_DELAY, 0, 1);
    // A fresh delay as reference for what rebinding must NOT touch.
    NamStudioGraph* ref = nam_studio_graph_create();
    const int32_t ref_delay = nam_studio_add_block(ref, NAM_STUDIO_BLOCK_DELAY, 0, 0);

    OPENAXE_EXPECT(nam_studio_bind_automation_slot(g, 3, comp) == 1);
    nam_studio_set_automation_param_normalized(g, 3, 0, 0.25f);  // threshold = -45 dB
    OPENAXE_EXPECT(FuzzyEq(nam_studio_get_param(g, comp, 0), -45.0f));
    // A second, deliberately untouched lane: rebinding must not invent values
    // for entries nobody automated.
    nam_studio_set_automation_param_normalized(g, 3, 2, 0.8f);  // attack = 80 ms

    // Swap the target: same slot, different block KIND (compressor -> delay).
    OPENAXE_EXPECT(nam_studio_unbind_automation_slot(g, 3) == 1);
    OPENAXE_EXPECT(nam_studio_bind_automation_slot(g, 3, delay) == 1);

    // The slot's normalized position is exactly where automation left it -
    // nothing jumped.
    OPENAXE_EXPECT(FuzzyEq(nam_studio_get_automation_param_normalized(g, 3, 0), 0.25f));
    // ...and it now maps through the DELAY's ranges onto delay.time.
    const char* symbol = nullptr;
    OPENAXE_EXPECT(nam_studio_automation_slot_param_info(g, 3, 0, nullptr, &symbol, nullptr, nullptr,
                                                     nullptr) == 1);
    OPENAXE_EXPECT(std::strcmp(symbol, "time") == 0);
    OPENAXE_EXPECT(FuzzyEq(nam_studio_get_param(g, delay, 0),
                       Denorm(0.25f, kDelayTimeMin, kDelayTimeMax)));  // 257.5 ms
    // The second lane remapped too (attack index 2 = delay.tone here).
    OPENAXE_EXPECT(FuzzyEq(nam_studio_get_automation_param_normalized(g, 3, 2), 0.8f));

    // Untouched entries kept the new block's own defaults - compare every
    // non-carried param against a never-bound delay.
    for (int32_t i = 0; i < nam_studio_block_param_count(g, delay); ++i) {
      if (i == 0 || i == 2) continue;  // carried by lanes 0 and 2
      OPENAXE_EXPECT(nam_studio_get_param(g, delay, i) == nam_studio_get_param(ref, ref_delay, i));
    }
    nam_studio_graph_destroy(ref);
    nam_studio_graph_destroy(g);
  }

  // ── THE SAVE/RELOAD TEST: slot 3 lands on the same control ───────────────
  std::string document;
  {
    NamStudioGraph* g = nam_studio_graph_create();
    const int32_t comp = nam_studio_add_block(g, NAM_STUDIO_BLOCK_COMPRESSOR, 0, 0);
    const int32_t gate = nam_studio_add_block(g, NAM_STUDIO_BLOCK_NOISE_GATE, 0, 1);
    WireThrough(g);
    nam_studio_set_bypass(g, gate, 1);

    OPENAXE_EXPECT(nam_studio_bind_automation_slot(g, 3, comp) == 1);
    OPENAXE_EXPECT(nam_studio_bind_automation_slot(g, 11, gate) == 1);
    nam_studio_set_automation_param_normalized(g, 3, 1, 0.75f);   // ratio = 15.25 :1
    nam_studio_set_automation_param_normalized(g, 11, 0, 0.6f);   // gate threshold

    // Direct (non-slot) knob move alongside: must round-trip independently.
    nam_studio_set_param(g, comp, 6, 2.5f);  // character

    const int32_t needed = nam_studio_serialize_state(g, nullptr, 0);
    std::vector<char> buf(static_cast<size_t>(needed));
    nam_studio_serialize_state(g, buf.data(), needed);
    document.assign(buf.data());

    // Byte-stable serialization while bindings are live.
    {
      std::vector<char> buf2(static_cast<size_t>(needed));
      nam_studio_serialize_state(g, buf2.data(), needed);
      OPENAXE_EXPECT(document == std::string(buf2.data()));
    }
    OPENAXE_EXPECT(document.find("\"automationSlots\"") != std::string::npos);
    OPENAXE_EXPECT(document.find("\"blockId\": \"0\"") != std::string::npos);
    nam_studio_graph_destroy(g);
  }
  {
    NamStudioGraph* g = nam_studio_graph_create();
    OPENAXE_EXPECT(nam_studio_load_state(g, document.c_str()) == NAM_STUDIO_LOAD_STATE_OK);
    // Same build order => same ids: compressor is 0 again, but the test goes
    // through the SLOT surface regardless - that's the whole point.
    OPENAXE_EXPECT(nam_studio_automation_slot_block(g, 3) == 0);
    OPENAXE_EXPECT(nam_studio_automation_slot_block(g, 11) == 1);

    // The lane's position survived, and it points at the SAME CONTROL:
    // slot 3 entry 1 still resolves to compressor.ratio holding 0.75 of its
    // range (15.25:1).
    const char* symbol = nullptr;
    OPENAXE_EXPECT(nam_studio_automation_slot_param_info(g, 3, 1, nullptr, &symbol, nullptr, nullptr,
                                                     nullptr) == 1);
    OPENAXE_EXPECT(std::strcmp(symbol, "ratio") == 0);
    OPENAXE_EXPECT(FuzzyEq(nam_studio_get_automation_param_normalized(g, 3, 1), 0.75f));
    OPENAXE_EXPECT(FuzzyEq(nam_studio_get_param(g, 0, 1), Denorm(0.75f, 1.0f, 20.0f)));

    // And writing NEW automation against slot 3 post-reload lands there too.
    nam_studio_set_automation_param_normalized(g, 3, 1, 0.0f);
    OPENAXE_EXPECT(FuzzyEq(nam_studio_get_param(g, 0, 1), 1.0f));

    // Non-slot state came back independently.
    OPENAXE_EXPECT(FuzzyEq(nam_studio_get_param(g, 0, 6), 2.5f));
    OPENAXE_EXPECT(nam_studio_is_bypassed(g, 1) == 1);

    // Rigs without bindings serialize without the key at all.
    NamStudioGraph* bare = nam_studio_graph_create();
    nam_studio_add_block(bare, NAM_STUDIO_BLOCK_TREMOLO, 0, 0);
    const int32_t needed = nam_studio_serialize_state(bare, nullptr, 0);
    std::vector<char> buf(static_cast<size_t>(needed));
    nam_studio_serialize_state(bare, buf.data(), needed);
    OPENAXE_EXPECT(std::strstr(buf.data(), "automationSlots") == nullptr);
    OPENAXE_EXPECT(std::strstr(buf.data(), "\"slot") == nullptr);
    nam_studio_graph_destroy(bare);
    nam_studio_graph_destroy(g);
  }

  // ── Removal/clear unbinding; mirror survives for later carryover ─────────
  {
    NamStudioGraph* g = nam_studio_graph_create();
    const int32_t comp = nam_studio_add_block(g, NAM_STUDIO_BLOCK_COMPRESSOR, 0, 0);
    const int32_t tremolo = nam_studio_add_block(g, NAM_STUDIO_BLOCK_TREMOLO, 0, 1);
    OPENAXE_EXPECT(nam_studio_bind_automation_slot(g, 5, comp) == 1);
    nam_studio_set_automation_param_normalized(g, 5, 0, 0.5f);  // threshold = -30

    nam_studio_remove_block(g, comp);
    OPENAXE_EXPECT(nam_studio_automation_slot_block(g, 5) == -1);  // never dangles
    // Writes while unbound only update the slot's memory...
    nam_studio_set_automation_param_normalized(g, 5, 0, 0.75f);
    OPENAXE_EXPECT(nam_studio_get_automation_param_normalized(g, 5, 0) == 0.75f);
    // ...and a rebind carries them onto the new target.
    OPENAXE_EXPECT(nam_studio_bind_automation_slot(g, 5, tremolo) == 1);
    const char* symbol = nullptr;
    OPENAXE_EXPECT(nam_studio_automation_slot_param_info(g, 5, 0, nullptr, &symbol, nullptr, nullptr,
                                                     nullptr) == 1);
    OPENAXE_EXPECT(std::strcmp(symbol, "rate") == 0);
    OPENAXE_EXPECT(FuzzyEq(nam_studio_get_param(g, tremolo, 0), Denorm(0.75f, 0.1f, 20.0f)));
    nam_studio_graph_destroy(g);
  }

  // ── Malformed binding documents: soft failures, rest restores ────────────
  {
    // Direct C++-level call so LoadStats are visible; the ABI returns only
    // the result enum.
    openaxe::engine::AudioEngine engine;
    const char* doc =
        R"({
          "schemaVersion": 1,
          "blocks": [
            { "id": "c", "kind": "compressor", "row": 0, "col": 0, "params": {} }
          ],
          "edges": [],
          "masterLevel": 1.0, "masterMuted": false,
          "automationSlots": {
            "3": { "blockId": "c" },
            "4": { "blockId": "ghost" },
            "zero": { "blockId": "c" },
            "99": { "blockId": "c" },
            "0": { "blockId": "c" },
            "7": "not-an-object"
          }
        })";
    const auto outcome = openaxe::state::LoadState(engine, doc);
    OPENAXE_EXPECT(outcome.error == openaxe::state::LoadError::kNone);
    // Exactly one binding survived: slot 3 -> "c". Skipped were the dangling
    // ghost reference, the non-numeric key, the out-of-range 99, the master
    // slot 0, and the non-object value.
    OPENAXE_EXPECT(outcome.stats.slots_restored == 1);
    OPENAXE_EXPECT(outcome.stats.slots_skipped == 5);
    OPENAXE_EXPECT(engine.AutomationSlotBlock(3) == 0);   // first block placed
    OPENAXE_EXPECT(engine.AutomationSlotBlock(4) == -1);  // its skip left it free
  }

  if (::openaxe::test::g_failures == 0) {
    std::printf("api_automation_slots_test passed\n");
    return 0;
  }
  std::printf("api_automation_slots_test FAILED (%d)\n", ::openaxe::test::g_failures);
  return 1;
}
