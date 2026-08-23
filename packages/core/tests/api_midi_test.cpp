// Issue #124: port of apps/web/src/midi/{message,actions,dispatch}.test.ts
// plus MIDI state (mappings, learn, serialization) into packages/core.

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include "nam_studio/api.h"
#include "nam_studio/midi.h"
#include "test_harness.h"

using namespace nam_studio::midi;

namespace {

std::vector<uint8_t> Bytes(std::initializer_list<int> b) {
  std::vector<uint8_t> out;
  for (int v : b) out.push_back(static_cast<uint8_t>(v));
  return out;
}

}  // namespace

int main() {
  // ── parseMidiMessage ──────────────────────────────────────────────
  {
    auto bytes = Bytes({0x90, 60, 100});
    auto msg = ParseMidiMessage(bytes.data(), bytes.size());
    NAM_EXPECT(msg.has_value());
    NAM_EXPECT(msg->type == MessageType::kNoteOn);
    NAM_EXPECT(msg->channel == 0);
    NAM_EXPECT(msg->number == 60);
    NAM_EXPECT(msg->value == 100);
  }
  {
    auto bytes = Bytes({0x99, 60, 100});
    auto msg = ParseMidiMessage(bytes.data(), bytes.size());
    NAM_EXPECT(msg.has_value() && msg->channel == 9);
  }
  {
    auto bytes = Bytes({0xb0, 20, 127});
    auto msg = ParseMidiMessage(bytes.data(), bytes.size());
    NAM_EXPECT(msg.has_value());
    NAM_EXPECT(msg->type == MessageType::kCc);
    NAM_EXPECT(msg->channel == 0);
    NAM_EXPECT(msg->number == 20);
    NAM_EXPECT(msg->value == 127);
  }
  {
    auto bytes = Bytes({0xc0, 5});
    auto msg = ParseMidiMessage(bytes.data(), bytes.size());
    NAM_EXPECT(msg.has_value());
    NAM_EXPECT(msg->type == MessageType::kPc);
    NAM_EXPECT(msg->channel == 0);
    NAM_EXPECT(msg->number == 5);
    NAM_EXPECT(msg->value == 0);
  }
  {
    auto bytes = Bytes({0x80, 60, 0});
    NAM_EXPECT(!ParseMidiMessage(bytes.data(), bytes.size()).has_value());
  }
  {
    auto bytes = Bytes({0x90, 60, 0});
    NAM_EXPECT(!ParseMidiMessage(bytes.data(), bytes.size()).has_value());
  }
  {
    auto bytes = Bytes({0xf8});
    NAM_EXPECT(!ParseMidiMessage(bytes.data(), bytes.size()).has_value());
  }
  {
    auto bytes = Bytes({0xfe});
    NAM_EXPECT(!ParseMidiMessage(bytes.data(), bytes.size()).has_value());
  }
  {
    auto bytes = Bytes({0xf0, 0x7e, 0x00, 0xf7});
    NAM_EXPECT(!ParseMidiMessage(bytes.data(), bytes.size()).has_value());
  }
  {
    auto bytes = Bytes({0xe0, 0, 64});
    NAM_EXPECT(!ParseMidiMessage(bytes.data(), bytes.size()).has_value());
    bytes = Bytes({0xa0, 60, 100});
    NAM_EXPECT(!ParseMidiMessage(bytes.data(), bytes.size()).has_value());
    bytes = Bytes({0xd0, 100});
    NAM_EXPECT(!ParseMidiMessage(bytes.data(), bytes.size()).has_value());
  }
  {
    auto bytes = Bytes({0x90});
    NAM_EXPECT(!ParseMidiMessage(bytes.data(), bytes.size()).has_value());
    NAM_EXPECT(!ParseMidiMessage(nullptr, 0).has_value());
  }

  // ── isTriggerEdge ─────────────────────────────────────────────────
  {
    NAM_EXPECT(!IsTriggerEdge(MidiMessage{MessageType::kCc, 0, 1, 0}));
    NAM_EXPECT(!IsTriggerEdge(MidiMessage{MessageType::kCc, 0, 1, 63}));
    NAM_EXPECT(IsTriggerEdge(MidiMessage{MessageType::kCc, 0, 1, 64}));
    NAM_EXPECT(IsTriggerEdge(MidiMessage{MessageType::kCc, 0, 1, 127}));
    NAM_EXPECT(IsTriggerEdge(MidiMessage{MessageType::kPc, 0, 1, 0}));
    NAM_EXPECT(IsTriggerEdge(MidiMessage{MessageType::kNoteOn, 0, 1, 1}));
  }

  // ── messageMatches / matchKey / formatMidiMatch ───────────────────
  {
    MidiMatch match{MessageType::kCc, 0, 20};
    NAM_EXPECT(MessageMatches(MidiMessage{MessageType::kCc, 0, 20, 1}, match));
    NAM_EXPECT(MessageMatches(MidiMessage{MessageType::kCc, 0, 20, 127}, match));
    NAM_EXPECT(!MessageMatches(MidiMessage{MessageType::kCc, 0, 21, 1}, match));
    NAM_EXPECT(!MessageMatches(MidiMessage{MessageType::kPc, 0, 20, 0}, match));
  }
  {
    NAM_EXPECT(MatchKey({MessageType::kCc, 0, 1}) != MatchKey({MessageType::kCc, 1, 1}));
  }
  {
    NAM_EXPECT(FormatMidiMatch({MessageType::kPc, 0, 0}) == "PC 0 (ch 1)");
    NAM_EXPECT(FormatMidiMatch({MessageType::kCc, 0, 20}) == "CC 20 (ch 1)");
    NAM_EXPECT(FormatMidiMatch({MessageType::kNoteOn, 9, 36}) == "Note 36 (ch 10)");
  }

  // ── actionKey uniqueness (ported from actions.test.ts) ────────────
  {
    std::vector<MidiAction> actions;
    for (int s = 0; s < 8; ++s) actions.push_back(MidiAction{ActionKind::kSlot, s, 0});
    for (int sc = 0; sc < 64; ++sc) actions.push_back(MidiAction{ActionKind::kScene, 0, sc});
    actions.push_back(MidiAction{ActionKind::kNextScene, 0, 0});
    actions.push_back(MidiAction{ActionKind::kPrevScene, 0, 0});
    std::vector<std::string> keys;
    for (auto& a : actions) keys.push_back(ActionKey(a));
    std::sort(keys.begin(), keys.end());
    keys.erase(std::unique(keys.begin(), keys.end()), keys.end());
    NAM_EXPECT(keys.size() == actions.size());
  }
  {
    NAM_EXPECT(ActionLabel(MidiAction{ActionKind::kSlot, 0, 0}) == "Slot 1");
    NAM_EXPECT(ActionLabel(MidiAction{ActionKind::kSlot, 7, 0}) == "Slot 8");
    NAM_EXPECT(ActionLabel(MidiAction{ActionKind::kScene, 0, 11}) == "Scene 12");
    NAM_EXPECT(ActionLabel(MidiAction{ActionKind::kNextScene, 0, 0}) == "Next Scene");
    NAM_EXPECT(ActionLabel(MidiAction{ActionKind::kPrevScene, 0, 0}) == "Previous Scene");
  }

  // ── Engine MIDI mapping + dispatch (ported dispatch.test.ts) ──────
  {
    NamStudioGraph* g = nam_studio_graph_create();
    // Add mappings like dispatch.test expects: slot/scene/next/prev.
    NAM_EXPECT(nam_studio_midi_add_mapping(g, NAM_STUDIO_MIDI_CC, 0, 20,
                                           NAM_STUDIO_MIDI_ACTION_SLOT, 3, 0) == 1);
    NAM_EXPECT(nam_studio_midi_add_mapping(g, NAM_STUDIO_MIDI_PC, 0, 5,
                                           NAM_STUDIO_MIDI_ACTION_SCENE, 0, 12) == 1);
    NAM_EXPECT(nam_studio_midi_add_mapping(g, NAM_STUDIO_MIDI_CC, 1, 10,
                                           NAM_STUDIO_MIDI_ACTION_NEXT_SCENE, 0, 0) == 1);
    NAM_EXPECT(nam_studio_midi_add_mapping(g, NAM_STUDIO_MIDI_NOTEON, 0, 60,
                                           NAM_STUDIO_MIDI_ACTION_PREV_SCENE, 0, 0) == 1);
    NAM_EXPECT(nam_studio_midi_mapping_count(g) == 4);

    // CC trigger edge gating: value <64 is not a press.
    {
      uint8_t data_cc_low[] = {0xb0, 20, 10};
      NamStudioMidiActionKind kind;
      int32_t slot, scene;
      NAM_EXPECT(nam_studio_midi_handle_message(g, data_cc_low, 3, 0, &kind, &slot, &scene, nullptr, nullptr, nullptr) == 0);
    }
    {
      uint8_t data_cc[] = {0xb0, 20, 127};
      NamStudioMidiActionKind kind;
      int32_t slot = -1, scene = -1;
      int32_t ret = nam_studio_midi_handle_message(g, data_cc, 3, 0, &kind, &slot, &scene, nullptr, nullptr, nullptr);
      NAM_EXPECT(ret == 1);
      NAM_EXPECT(kind == NAM_STUDIO_MIDI_ACTION_SLOT && slot == 3);
    }
    {
      uint8_t data_pc[] = {0xc0, 5};
      NamStudioMidiActionKind kind;
      int32_t slot, scene;
      int32_t ret = nam_studio_midi_handle_message(g, data_pc, 2, 0, &kind, &slot, &scene, nullptr, nullptr, nullptr);
      NAM_EXPECT(ret == 1);
      NAM_EXPECT(kind == NAM_STUDIO_MIDI_ACTION_SCENE && scene == 12);
    }
    {
      uint8_t data_next[] = {0xb1, 10, 127};
      NamStudioMidiActionKind kind;
      int32_t ret = nam_studio_midi_handle_message(g, data_next, 3, 0, &kind, nullptr, nullptr, nullptr, nullptr, nullptr);
      NAM_EXPECT(ret == 1 && kind == NAM_STUDIO_MIDI_ACTION_NEXT_SCENE);
    }
    {
      uint8_t data_prev[] = {0x90, 60, 100};
      NamStudioMidiActionKind kind;
      int32_t ret = nam_studio_midi_handle_message(g, data_prev, 3, 0, &kind, nullptr, nullptr, nullptr, nullptr, nullptr);
      NAM_EXPECT(ret == 1 && kind == NAM_STUDIO_MIDI_ACTION_PREV_SCENE);
    }

    // Channel filtering: same number different channel does not match.
    {
      uint8_t data_wrong_ch[] = {0xb1, 20, 127}; // ch 1, but mapping is ch 0
      NAM_EXPECT(nam_studio_midi_handle_message(g, data_wrong_ch, 3, 0, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr) == 0);
    }

    // Sample offset is accepted but dispatch is immediate.
    {
      uint8_t data[] = {0xb0, 20, 127};
      NamStudioMidiActionKind kind;
      int32_t ret = nam_studio_midi_handle_message(g, data, 3, 42, &kind, nullptr, nullptr, nullptr, nullptr, nullptr);
      NAM_EXPECT(ret == 1);
    }

    // Dedup: adding a mapping with same match replaces old action.
    NAM_EXPECT(nam_studio_midi_add_mapping(g, NAM_STUDIO_MIDI_CC, 0, 20,
                                           NAM_STUDIO_MIDI_ACTION_SCENE, 0, 5) == 1);
    NAM_EXPECT(nam_studio_midi_mapping_count(g) == 4); // replaced, not grew
    {
      uint8_t data[] = {0xb0, 20, 127};
      NamStudioMidiActionKind kind;
      int32_t scene;
      int32_t ret = nam_studio_midi_handle_message(g, data, 3, 0, &kind, nullptr, &scene, nullptr, nullptr, nullptr);
      NAM_EXPECT(ret == 1 && kind == NAM_STUDIO_MIDI_ACTION_SCENE && scene == 5);
    }

    // Dedup: same action key replaces old match.
    NAM_EXPECT(nam_studio_midi_add_mapping(g, NAM_STUDIO_MIDI_CC, 0, 99,
                                           NAM_STUDIO_MIDI_ACTION_SCENE, 0, 5) == 1);
    NAM_EXPECT(nam_studio_midi_mapping_count(g) == 4);
    {
      uint8_t old_match[] = {0xb0, 20, 127};
      NAM_EXPECT(nam_studio_midi_handle_message(g, old_match, 3, 0, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr) == 0);
      uint8_t new_match[] = {0xb0, 99, 127};
      NamStudioMidiActionKind kind;
      int32_t scene;
      NAM_EXPECT(nam_studio_midi_handle_message(g, new_match, 3, 0, &kind, nullptr, &scene, nullptr, nullptr, nullptr) == 1);
      NAM_EXPECT(kind == NAM_STUDIO_MIDI_ACTION_SCENE && scene == 5);
    }

    // Learn mode: arm then next trigger completes learn (consumed, not dispatched).
    NAM_EXPECT(nam_studio_midi_arm_learn(g, NAM_STUDIO_MIDI_ACTION_SLOT, 2, 0) == 1);
    NAM_EXPECT(nam_studio_midi_is_learning(g) == 1);
    {
      NamStudioMidiActionKind k;
      int32_t s, sc;
      NAM_EXPECT(nam_studio_midi_get_learn_target(g, &k, &s, &sc) == 1);
      NAM_EXPECT(k == NAM_STUDIO_MIDI_ACTION_SLOT && s == 2);
    }
    {
      uint8_t learn_msg[] = {0x90, 40, 100};
      NamStudioMidiActionKind k;
      int32_t ret = nam_studio_midi_handle_message(g, learn_msg, 3, 0, &k, nullptr, nullptr, nullptr, nullptr, nullptr);
      NAM_EXPECT(ret == 2); // learn completed
      NAM_EXPECT(nam_studio_midi_is_learning(g) == 0);
      NAM_EXPECT(nam_studio_midi_mapping_count(g) == 5); // new unique mapping appended
      // Now that match is bound to slot 2, dispatch works.
      uint8_t same[] = {0x90, 40, 100};
      int32_t slot;
      ret = nam_studio_midi_handle_message(g, same, 3, 0, &k, &slot, nullptr, nullptr, nullptr, nullptr);
      NAM_EXPECT(ret == 1 && k == NAM_STUDIO_MIDI_ACTION_SLOT && slot == 2);
    }

    // Learn is cancelled if we cancel.
    NAM_EXPECT(nam_studio_midi_arm_learn(g, NAM_STUDIO_MIDI_ACTION_SLOT, 1, 0) == 1);
    nam_studio_midi_cancel_learn(g);
    NAM_EXPECT(nam_studio_midi_is_learning(g) == 0);
    {
      uint8_t data[] = {0xb0, 55, 127};
      NAM_EXPECT(nam_studio_midi_handle_message(g, data, 3, 0, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr) == 0);
      NAM_EXPECT(nam_studio_midi_mapping_count(g) == 5); // no new mapping
    }

    // Non-trigger (clock) while learning does NOT complete learn.
    NAM_EXPECT(nam_studio_midi_arm_learn(g, NAM_STUDIO_MIDI_ACTION_SLOT, 0, 0) == 1);
    {
      uint8_t clock[] = {0xF8};
      NAM_EXPECT(nam_studio_midi_handle_message(g, clock, 1, 0, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr) == 0);
      NAM_EXPECT(nam_studio_midi_is_learning(g) == 1);
    }
    nam_studio_midi_cancel_learn(g);

    nam_studio_graph_destroy(g);
  }

  // ── Pure ABI helpers ──────────────────────────────────────────────
  {
    uint8_t data[] = {0xb0, 20, 127};
    NamStudioMidiMessageType t;
    int32_t ch, num, val;
    NAM_EXPECT(nam_studio_midi_parse_message(data, 3, &t, &ch, &num, &val) == 1);
    NAM_EXPECT(t == NAM_STUDIO_MIDI_CC && ch == 0 && num == 20 && val == 127);
    NAM_EXPECT(nam_studio_midi_is_trigger_edge(NAM_STUDIO_MIDI_CC, 10) == 0);
    NAM_EXPECT(nam_studio_midi_is_trigger_edge(NAM_STUDIO_MIDI_CC, 64) == 1);
    NAM_EXPECT(nam_studio_midi_is_trigger_edge(NAM_STUDIO_MIDI_PC, 0) == 1);
    NAM_EXPECT(nam_studio_midi_message_matches(NAM_STUDIO_MIDI_CC, 0, 20, NAM_STUDIO_MIDI_CC, 0, 20) == 1);
    NAM_EXPECT(nam_studio_midi_message_matches(NAM_STUDIO_MIDI_CC, 0, 20, NAM_STUDIO_MIDI_PC, 0, 20) == 0);
  }

  // ── Serialization round-trip ──────────────────────────────────────
  {
    NamStudioGraph* g = nam_studio_graph_create();
    nam_studio_midi_add_mapping(g, NAM_STUDIO_MIDI_CC, 0, 20, NAM_STUDIO_MIDI_ACTION_SLOT, 3, 0);
    nam_studio_midi_add_mapping(g, NAM_STUDIO_MIDI_PC, 1, 5, NAM_STUDIO_MIDI_ACTION_SCENE, 0, 12);
    nam_studio_midi_add_mapping(g, NAM_STUDIO_MIDI_NOTEON, 9, 36, NAM_STUDIO_MIDI_ACTION_NEXT_SCENE, 0, 0);

    int32_t needed = nam_studio_serialize_state(g, nullptr, 0);
    NAM_EXPECT(needed > 0);
    std::vector<char> buf(static_cast<size_t>(needed));
    NAM_EXPECT(nam_studio_serialize_state(g, buf.data(), needed) == needed);
    std::string doc(buf.data());
    NAM_EXPECT(doc.find("\"midiMappings\"") != std::string::npos);
    NAM_EXPECT(doc.find("\"noteon\"") != std::string::npos);
    NAM_EXPECT(doc.find("\"nextScene\"") != std::string::npos);

    NamStudioGraph* h = nam_studio_graph_create();
    NAM_EXPECT(nam_studio_load_state(h, doc.c_str()) == NAM_STUDIO_LOAD_STATE_OK);
    NAM_EXPECT(nam_studio_midi_mapping_count(h) == 3);
    {
      NamStudioMidiMessageType t; int32_t ch, num; NamStudioMidiActionKind k; int32_t slot, scene;
      NAM_EXPECT(nam_studio_midi_get_mapping(h, 0, &t, &ch, &num, &k, &slot, &scene) == 1);
      NAM_EXPECT(t == NAM_STUDIO_MIDI_CC && ch == 0 && num == 20);
      NAM_EXPECT(k == NAM_STUDIO_MIDI_ACTION_SLOT && slot == 3);
    }
    // Handles still work after reload — sample-accurate offset accepted.
    {
      uint8_t data[] = {0xb0, 20, 127};
      NamStudioMidiActionKind k;
      int32_t slot;
      NAM_EXPECT(nam_studio_midi_handle_message(h, data, 3, 10, &k, &slot, nullptr, nullptr, nullptr, nullptr) == 1);
      NAM_EXPECT(k == NAM_STUDIO_MIDI_ACTION_SLOT && slot == 3);
    }

    // Re-serialize must be byte-stable.
    int32_t needed2 = nam_studio_serialize_state(h, nullptr, 0);
    std::vector<char> buf2(static_cast<size_t>(needed2));
    nam_studio_serialize_state(h, buf2.data(), needed2);
    NAM_EXPECT(std::string(buf2.data()) == doc);

    // Malformed MIDI entries skip without failing the load.
    const char* bad_doc = R"({
      "schemaVersion": 1, "blocks": [], "edges": [],
      "masterLevel": 1.0, "masterMuted": false,
      "midiMappings": [
        {"match": {"type": "cc", "channel": 0, "number": 20}, "action": {"kind": "slot", "slot": 0}},
        {"match": {"type": "bogus", "channel": 0, "number": 20}, "action": {"kind": "slot", "slot": 1}},
        {"match": {"type": "cc", "channel": 0, "number": 20}, "action": {"kind": "slot"}},
        {"bad": "shape"}
      ]
    })";
    NamStudioGraph* b = nam_studio_graph_create();
    NAM_EXPECT(nam_studio_load_state(b, bad_doc) == NAM_STUDIO_LOAD_STATE_OK);
    NAM_EXPECT(nam_studio_midi_mapping_count(b) == 1);
    nam_studio_graph_destroy(b);

    // Non-array midiMappings skips, not hard failure.
    const char* non_array = R"({"schemaVersion":1,"blocks":[],"edges":[],"masterLevel":1.0,"masterMuted":false,"midiMappings": {"a":1}})";
    NamStudioGraph* n = nam_studio_graph_create();
    NAM_EXPECT(nam_studio_load_state(n, non_array) == NAM_STUDIO_LOAD_STATE_OK);
    NAM_EXPECT(nam_studio_midi_mapping_count(n) == 0);
    nam_studio_graph_destroy(n);

    nam_studio_graph_destroy(g);
    nam_studio_graph_destroy(h);
  }

  // ── Edge: invalid action/match rejected ───────────────────────────
  {
    NamStudioGraph* g = nam_studio_graph_create();
    NAM_EXPECT(nam_studio_midi_add_mapping(g, NAM_STUDIO_MIDI_CC, 0, 20, NAM_STUDIO_MIDI_ACTION_SLOT, 8, 0) == 0); // slot out of range
    NAM_EXPECT(nam_studio_midi_add_mapping(g, NAM_STUDIO_MIDI_CC, 16, 20, NAM_STUDIO_MIDI_ACTION_SLOT, 0, 0) == 0); // channel out of range
    NAM_EXPECT(nam_studio_midi_add_mapping(g, NAM_STUDIO_MIDI_CC, 0, 128, NAM_STUDIO_MIDI_ACTION_SLOT, 0, 0) == 0); // number out of range
    NAM_EXPECT(nam_studio_midi_add_mapping(g, NAM_STUDIO_MIDI_CC, 0, 20, NAM_STUDIO_MIDI_ACTION_SCENE, 0, 64) == 0); // scene out of range
    NAM_EXPECT(nam_studio_midi_mapping_count(g) == 0);
    NAM_EXPECT(nam_studio_midi_arm_learn(g, NAM_STUDIO_MIDI_ACTION_SLOT, 8, 0) == 0);
    NAM_EXPECT(nam_studio_midi_is_learning(g) == 0);
    nam_studio_graph_destroy(g);
  }

  if (::nam_studio::test::g_failures == 0) {
    std::printf("api_midi_test passed\n");
    return 0;
  }
  std::printf("api_midi_test FAILED (%d)\n", ::nam_studio::test::g_failures);
  return 1;
}
