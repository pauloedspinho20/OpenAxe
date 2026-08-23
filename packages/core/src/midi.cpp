#include "nam_studio/midi.h"

#include <string>

namespace nam_studio::midi {

std::optional<MidiMessage> ParseMidiMessage(const uint8_t* data, size_t size) {
  if (!data || size < 2) return std::nullopt;
  const uint8_t status = data[0];
  if (status < 0x80) return std::nullopt;
  if (status >= 0xf0) return std::nullopt;

  const uint8_t kind = status & 0xf0;
  const int channel = status & 0x0f;
  const int number = static_cast<int>(data[1]);

  if (kind == 0x90) {
    if (size < 3) return std::nullopt;
    const int value = static_cast<int>(data[2]);
    if (value == 0) return std::nullopt;
    return MidiMessage{MessageType::kNoteOn, channel, number, value};
  }
  if (kind == 0xb0) {
    const int value = size >= 3 ? static_cast<int>(data[2]) : 0;
    return MidiMessage{MessageType::kCc, channel, number, value};
  }
  if (kind == 0xc0) {
    return MidiMessage{MessageType::kPc, channel, number, 0};
  }
  return std::nullopt;
}

bool IsTriggerEdge(const MidiMessage& message) {
  if (message.type == MessageType::kCc) return message.value >= 64;
  return true;
}

bool MessageMatches(const MidiMessage& message, const MidiMatch& match) {
  return message.type == match.type && message.channel == match.channel && message.number == match.number;
}

std::string MatchKey(const MidiMatch& match) {
  const char* type_str = "cc";
  switch (match.type) {
    case MessageType::kNoteOn: type_str = "noteon"; break;
    case MessageType::kCc: type_str = "cc"; break;
    case MessageType::kPc: type_str = "pc"; break;
  }
  return std::string(type_str) + ":" + std::to_string(match.channel) + ":" + std::to_string(match.number);
}

std::string FormatMidiMatch(const MidiMatch& match) {
  const char* label = "CC";
  switch (match.type) {
    case MessageType::kNoteOn: label = "Note"; break;
    case MessageType::kCc: label = "CC"; break;
    case MessageType::kPc: label = "PC"; break;
  }
  return std::string(label) + " " + std::to_string(match.number) + " (ch " +
         std::to_string(match.channel + 1) + ")";
}

std::string ActionKey(const MidiAction& action) {
  switch (action.kind) {
    case ActionKind::kSlot: return "slot:" + std::to_string(action.slot);
    case ActionKind::kScene: return "scene:" + std::to_string(action.scene);
    case ActionKind::kNextScene: return "nextScene";
    case ActionKind::kPrevScene: return "prevScene";
  }
  return "";
}

std::string ActionLabel(const MidiAction& action) {
  switch (action.kind) {
    case ActionKind::kSlot: return "Slot " + std::to_string(action.slot + 1);
    case ActionKind::kScene: return "Scene " + std::to_string(action.scene + 1);
    case ActionKind::kNextScene: return "Next Scene";
    case ActionKind::kPrevScene: return "Previous Scene";
  }
  return "";
}

bool IsValidMatch(const MidiMatch& match) {
  if (match.channel < 0 || match.channel > 15) return false;
  if (match.number < 0 || match.number > 127) return false;
  return true;
}

bool IsValidAction(const MidiAction& action) {
  switch (action.kind) {
    case ActionKind::kSlot: return action.slot >= 0 && action.slot < 8;
    case ActionKind::kScene: return action.scene >= 0 && action.scene < 64;
    case ActionKind::kNextScene:
    case ActionKind::kPrevScene: return true;
  }
  return false;
}

}  // namespace nam_studio::midi
