#pragma once

#include <cstdint>
#include <optional>
#include <string>

namespace openaxe::midi {

// ── Message model ──────────────────────────────────────────────────────
// Mirrors apps/web/src/midi/{types,message}.ts. 0-based everywhere (channel
// 0-15, controller number 0-127). The one place 1-based conversion happens
// is at the render boundary (format helpers).
enum class MessageType {
  kNoteOn,
  kCc,
  kPc,
};

struct MidiMessage {
  MessageType type;
  int channel = 0;  // 0-15
  int number = 0;   // 0-127
  int value = 0;    // velocity / CC value (0-127), 0 for PC
};

struct MidiMatch {
  MessageType type;
  int channel = 0;
  int number = 0;
};

// Decodes a raw MIDI message into a discrete-trigger shape, or nullopt for
// anything not usable as one. Mirrors parseMidiMessage in message.ts:
//   - system messages (0xF0+) filtered first (clock, active sensing, sysex)
//   - note-off (0x80) and velocity-0 note-on dropped
//   - pitch bend / aftertouch dropped
std::optional<MidiMessage> ParseMidiMessage(const uint8_t* data, size_t size);

// Whether this message counts as a "press" for learn/dispatch.
// CC only counts at >=64 (momentary footswitch sends 127 on press, 0 on release).
bool IsTriggerEdge(const MidiMessage& message);

// Matching deliberately ignores value/velocity.
bool MessageMatches(const MidiMessage& message, const MidiMatch& match);

// Stable string identities — dedup keys and React keys in the TS, useful in
// core for testing and serialization round-trip checks.
std::string MatchKey(const MidiMatch& match);
std::string FormatMidiMatch(const MidiMatch& match);

// ── Action model ───────────────────────────────────────────────────────
// Mirrors apps/web/src/midi/actions.ts. The closed set of actions a mapping
// can target.
enum class ActionKind {
  kSlot,       // 0-7
  kScene,      // 0-63
  kNextScene,
  kPrevScene,
};

struct MidiAction {
  ActionKind kind = ActionKind::kSlot;
  int slot = 0;   // valid when kind == kSlot (0-7)
  int scene = 0;  // valid when kind == kScene (0-63)
};

std::string ActionKey(const MidiAction& action);
std::string ActionLabel(const MidiAction& action);

// Validation helpers — mirrors the TS type ranges.
bool IsValidMatch(const MidiMatch& match);
bool IsValidAction(const MidiAction& action);

// ── Mapping ────────────────────────────────────────────────────────────
struct MidiMapping {
  MidiMatch match;
  MidiAction action;
};

}  // namespace openaxe::midi
