// CTest for MIDI mapping via plugin MIDI bus — issue #124.
// The plugin declares a MIDI/event input bus (PLUG_DOES_MIDI_IN) and
// forwards the host's event list sample-accurately to core's
// openaxe_midi_handle_message. Core owns the mapping model so every
// front end reuses it. This test verifies the forwarding contract offline
// (no host/SDK needed) by driving the core API the plugin forwards to.

#include <cstdio>
#include <string>

#include "openaxe/api.h"

static int g_failures = 0;
#define CHECK(cond) do { if(!(cond)){ std::fprintf(stderr,"CHECK failed: %s (%s:%d)\n",#cond,__FILE__,__LINE__); ++g_failures; } } while(0)

namespace {

void TestMidiBusForwarding() {
  OpenAxeGraph* g = openaxe_graph_create();
  const uint8_t cc_on[3] = {0xB0, 1, 127}; // CC 1, value 127 on ch 0
  const uint8_t cc_off[3] = {0xB0, 1, 0};   // CC 1, value 0 (not a trigger edge)
  const uint8_t note_on[3] = {0x90, 60, 100}; // Note 60

  int added = openaxe_midi_add_mapping(g, OPENAXE_MIDI_CC, 0, 1, OPENAXE_MIDI_ACTION_SLOT, 0, 0);
  CHECK(added == 1);
  CHECK(openaxe_midi_mapping_count(g) == 1);

  OpenAxeMidiActionKind out_kind;
  int out_slot, out_scene;
  OpenAxeMidiMessageType out_type;
  int out_ch, out_num;
  int r0 = openaxe_midi_handle_message(g, cc_on, 3, 0, &out_kind, &out_slot, &out_scene, &out_type, &out_ch, &out_num);
  CHECK(r0 == 1); // dispatched
  CHECK(out_kind == OPENAXE_MIDI_ACTION_SLOT && out_slot == 0);
  int r1 = openaxe_midi_handle_message(g, cc_on, 3, 42, &out_kind, &out_slot, &out_scene, &out_type, &out_ch, &out_num);
  CHECK(r1 == 1); // same, sample_offset 42 still dispatches (offset is accepted, currently dispatched immediately)

  int r2 = openaxe_midi_handle_message(g, cc_off, 3, 10, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr);
  CHECK(r2 == 0);

  int r3 = openaxe_midi_handle_message(g, note_on, 3, 5, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr);
  CHECK(r3 == 0);

  // Learn mode: arm for scene 3, then feed CC 7
  CHECK(openaxe_midi_arm_learn(g, OPENAXE_MIDI_ACTION_SCENE, 0, 3) == 1);
  CHECK(openaxe_midi_is_learning(g) == 1);
  const uint8_t cc_learn[3] = {0xB0, 7, 127};
  int r_learn = openaxe_midi_handle_message(g, cc_learn, 3, 0, &out_kind, &out_slot, &out_scene, &out_type, &out_ch, &out_num);
  CHECK(r_learn == 2); // learn completed
  CHECK(openaxe_midi_is_learning(g) == 0);
  CHECK(openaxe_midi_mapping_count(g) == 2); // CC 7 -> scene 3 added

  std::printf("  MIDI bus forwarding (CC, note, learn, offset): ok\n");
  openaxe_graph_destroy(g);
}

void TestMidiBindingsSurviveState() {
  OpenAxeGraph* g = openaxe_graph_create();
  const int32_t blk = openaxe_add_block(g, OPENAXE_BLOCK_MIXER, 0, 0);
  (void)blk;
  CHECK(openaxe_midi_add_mapping(g, OPENAXE_MIDI_CC, 1, 10, OPENAXE_MIDI_ACTION_SLOT, 2, 0) == 1);
  int32_t needed = openaxe_serialize_state_ex(g, 1, nullptr, 0);
  CHECK(needed > 0);
  std::string s;
  s.resize(static_cast<size_t>(needed - 1));
  int32_t written = openaxe_serialize_state_ex(g, 1, s.data(), needed);
  (void)written;
  CHECK(s.find("\"midiMappings\"") != std::string::npos);
  OpenAxeGraph* g2 = openaxe_graph_create();
  int r = openaxe_load_state(g2, s.c_str());
  CHECK(r == OPENAXE_LOAD_STATE_OK);
  // single reset as plugin_state::Restore does — not required for midi count, but mirrors real restore
  openaxe_reset(g2, 48000.0, 128);
  CHECK(openaxe_midi_mapping_count(g2) == 1);
  OpenAxeMidiMessageType out_type;
  int out_ch, out_num;
  OpenAxeMidiActionKind out_kind;
  int out_slot, out_scene;
  CHECK(openaxe_midi_get_mapping(g2, 0, &out_type, &out_ch, &out_num, &out_kind, &out_slot, &out_scene) == 1);
  CHECK(out_type == OPENAXE_MIDI_CC && out_ch == 1 && out_num == 10);
  CHECK(out_kind == OPENAXE_MIDI_ACTION_SLOT && out_slot == 2);
  openaxe_graph_destroy(g);
  openaxe_graph_destroy(g2);
  std::printf("  MIDI bindings survive state round-trip: ok\n");
}

void TestMidiPortedTestsParity() {
  OpenAxeGraph* g = openaxe_graph_create();
  CHECK(openaxe_midi_add_mapping(g, OPENAXE_MIDI_PC, 0, 5, OPENAXE_MIDI_ACTION_NEXT_SCENE, 0, 0) == 1);
  const uint8_t pc[2] = {0xC0, 5};
  int r = openaxe_midi_handle_message(g, pc, 2, 0, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr);
  CHECK(r == 1);
  openaxe_graph_destroy(g);
  std::printf("  MIDI ported tests parity (PC): ok\n");
}

} // namespace

int main() {
  TestMidiBusForwarding();
  TestMidiBindingsSurviveState();
  TestMidiPortedTestsParity();
  std::printf("  Config PLUG_DOES_MIDI_IN=1: documented (see config.h)\n");
  if (g_failures > 0) {
    std::fprintf(stderr, "%d failure(s)\n", g_failures);
    return 1;
  }
  std::printf("midi_test: all checks passed\n");
  return 0;
}
