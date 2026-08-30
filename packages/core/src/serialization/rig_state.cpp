#include "rig_state.h"

#include <cmath>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <system_error>
#include <unordered_map>
#include <vector>

#include "base64.h"
#include "json.h"
#include "openaxe/block.h"
#include "openaxe/generated/enabled_blocks.h"
#include "openaxe/dsp/delay.h"
#include "openaxe/midi.h"
#include "sha256.h"

namespace openaxe::state {
namespace {

using engine::AudioEngine;
using engine::BlockId;
using json::Value;

// ── Wire-format string maps ──────────────────────────────────────────────
// block.h documents the hyphenated wire strings as the TS union's literals;
// this is that mapping (the "documented non-goal" of the PR that added
// BlockKind itself). The reverb algorithm and delay model strings match the
// web UI's select values (paramSchema.ts), which is what existing preset
// files already contain.

const char* BlockKindToString(graph::BlockKind kind) {
  switch (kind) {
    case graph::BlockKind::kNoiseGate: return "noise-gate";
    case graph::BlockKind::kCompressor: return "compressor";
    case graph::BlockKind::kEq: return "eq";
    case graph::BlockKind::kChorus: return "chorus";
    case graph::BlockKind::kFlanger: return "flanger";
    case graph::BlockKind::kPhaser: return "phaser";
    case graph::BlockKind::kTremolo: return "tremolo";
    case graph::BlockKind::kDelay: return "delay";
    case graph::BlockKind::kPingPongDelay: return "ping-pong-delay";
    case graph::BlockKind::kReverb: return "reverb";
    case graph::BlockKind::kAmp: return "amp";
    case graph::BlockKind::kAmpCab: return "amp-cab";
    case graph::BlockKind::kPedal: return "pedal";
    case graph::BlockKind::kOutboard: return "outboard";
    case graph::BlockKind::kSpace: return "space";
    case graph::BlockKind::kCab: return "cab";
    case graph::BlockKind::kMixer: return "mixer";
    case graph::BlockKind::kSplitter: return "splitter";
    case graph::BlockKind::kRingMod: return "ring-mod";
    case graph::BlockKind::kFilter: return "filter";
    case graph::BlockKind::kPitchShifter: return "pitch-shifter";
    case graph::BlockKind::kGranularDelay: return "granular-delay";
    case graph::BlockKind::kRotary: return "rotary";
    case graph::BlockKind::kSend1: return "send-1";
    case graph::BlockKind::kReturn1: return "return-1";
    case graph::BlockKind::kSend2: return "send-2";
    case graph::BlockKind::kReturn2: return "return-2";
  }
  return nullptr;  // unreachable for a valid enum value
}

bool StringToBlockKind(const std::string& text, graph::BlockKind& out) {
  static const std::unordered_map<std::string, graph::BlockKind> kMap = {
      {"noise-gate", graph::BlockKind::kNoiseGate},
      {"compressor", graph::BlockKind::kCompressor},
      {"eq", graph::BlockKind::kEq},
      {"chorus", graph::BlockKind::kChorus},
      {"flanger", graph::BlockKind::kFlanger},
      {"phaser", graph::BlockKind::kPhaser},
      {"tremolo", graph::BlockKind::kTremolo},
      {"delay", graph::BlockKind::kDelay},
      {"ping-pong-delay", graph::BlockKind::kPingPongDelay},
      {"reverb", graph::BlockKind::kReverb},
      {"amp", graph::BlockKind::kAmp},
      {"amp-cab", graph::BlockKind::kAmpCab},
      {"pedal", graph::BlockKind::kPedal},
      {"outboard", graph::BlockKind::kOutboard},
      {"space", graph::BlockKind::kSpace},
      {"cab", graph::BlockKind::kCab},
      {"mixer", graph::BlockKind::kMixer},
      {"splitter", graph::BlockKind::kSplitter},
      {"ring-mod", graph::BlockKind::kRingMod},
      {"filter", graph::BlockKind::kFilter},
      {"pitch-shifter", graph::BlockKind::kPitchShifter},
      {"granular-delay", graph::BlockKind::kGranularDelay},
      {"rotary", graph::BlockKind::kRotary},
      {"send-1", graph::BlockKind::kSend1},
      {"return-1", graph::BlockKind::kReturn1},
      {"send-2", graph::BlockKind::kSend2},
      {"return-2", graph::BlockKind::kReturn2},
  };
  const auto it = kMap.find(text);
  if (it == kMap.end()) return false;
  out = it->second;
  return true;
}

// Record a kind the document wanted and this build cannot place, de-duped:
// a rig with four ring-mods should read as one missing pedal type, not four.
void NoteUnsupportedBlock(LoadOutcome& outcome, const std::string& kind_text) {
  for (const std::string& seen : outcome.unsupported_blocks) {
    if (seen == kind_text) return;
  }
  outcome.unsupported_blocks.push_back(kind_text.empty() ? "(unnamed kind)" : kind_text);
}

const char* ReverbAlgorithmToString(engine::ReverbAlgorithm algorithm) {
  switch (algorithm) {
    case engine::ReverbAlgorithm::kHall: return "hall";
    case engine::ReverbAlgorithm::kRoom: return "room";
    case engine::ReverbAlgorithm::kPlate: return "plate";
    case engine::ReverbAlgorithm::kEarlyReflections: return "early-reflections";
  }
  return "hall";  // unreachable for a valid enum value
}

bool StringToReverbAlgorithm(const std::string& text, engine::ReverbAlgorithm& out) {
  if (text == "hall") {
    out = engine::ReverbAlgorithm::kHall;
  } else if (text == "room") {
    out = engine::ReverbAlgorithm::kRoom;
  } else if (text == "plate") {
    out = engine::ReverbAlgorithm::kPlate;
  } else if (text == "early-reflections") {
    out = engine::ReverbAlgorithm::kEarlyReflections;
  } else {
    return false;
  }
  return true;
}

const char* DelayModelToString(dsp::Delay::Model model) {
  switch (model) {
    case dsp::Delay::Model::kDigital: return "digital";
    case dsp::Delay::Model::kAnalog: return "analog";
    case dsp::Delay::Model::kTape: return "tape";
  }
  return "digital";  // unreachable for a valid enum value
}

bool StringToDelayModel(const std::string& text, dsp::Delay::Model& out) {
  if (text == "digital") {
    out = dsp::Delay::Model::kDigital;
  } else if (text == "analog") {
    out = dsp::Delay::Model::kAnalog;
  } else if (text == "tape") {
    out = dsp::Delay::Model::kTape;
  } else {
    return false;
  }
  return true;
}

// Bypass is a concept for the effect kinds + the NAM gear kinds - cab/mixer/
// splitter and the Send/Return routing kinds have none (types.ts's
// PresetBlockData doc comment). Mirroring that, those serialize without a
// bypass field.
bool KindHasBypass(graph::BlockKind kind) {
  return kind != graph::BlockKind::kCab && kind != graph::BlockKind::kMixer &&
         kind != graph::BlockKind::kSplitter && kind != graph::BlockKind::kSend1 &&
         kind != graph::BlockKind::kReturn1 && kind != graph::BlockKind::kSend2 &&
         kind != graph::BlockKind::kReturn2;
}

// Filename without directory or extension - the display name a path-loaded
// asset reports when nothing more explicit was recorded.
std::string StemOfPath(const std::string& path) {
  const auto slash = path.find_last_of("/\\");
  std::string file = slash == std::string::npos ? path : path.substr(slash + 1);
  const auto dot = file.find_last_of('.');
  if (dot != std::string::npos && dot > 0) file.resize(dot);
  return file;
}

// The "model"/"ir" object a block carries (#120): display name and content
// hash always (hash lets a UI verify a relinked file is the same capture),
// source path best-effort for relinking, and the asset itself as base64 only
// when the caller asked for embedding.
json::Value BuildAssetObject(const std::string& name, const std::string& path,
                             const uint8_t* bytes, size_t size, bool embed) {
  json::Value asset = json::Value::Object();
  asset.Set("name", json::Value::String(name));
  asset.Set("hash", json::Value::String(Sha256Hex(bytes, size)));
  asset.Set("path", json::Value::String(path));
  if (embed) asset.Set("payload", json::Value::String(Base64Encode(bytes, size)));
  return asset;
}

bool IsAmpFamilyKind(graph::BlockKind kind) {
  switch (kind) {
    case graph::BlockKind::kAmp:
    case graph::BlockKind::kAmpCab:
    case graph::BlockKind::kPedal:
    case graph::BlockKind::kOutboard:
    case graph::BlockKind::kSpace:
      return true;
    default:
      return false;
  }
}

// Block ids in the document are strings - GraphRig's own form, and what web
// presets already carry. Rails serialize as "-1"/"-2" (the engine's decimal
// GraphIdOf form); their grid names load too.
std::string BlockIdToString(int64_t id) { return std::to_string(id); }

// Every param by SYMBOL, never by index - index order is a core
// implementation detail (GetParamInfo tables) and a reorder must not silently
// remap a user's saved rig (the issue's headline requirement).
Value SerializeParams(const AudioEngine& engine, BlockId id, bool amp_family) {
  Value params = Value::Object();
  const int count = engine.ParamCount(id);
  for (int i = 0; i < count; ++i) {
    const auto info = engine.ParamInfo(id, i);
    if (!info || info->symbol == nullptr) continue;
    // The amp family's input_level/output_level slots hold the loaded model's
    // dBu calibration. While the corresponding active flag is down there is no
    // meaningful value to save - writing one on restore would flip the flag
    // and fabricate an override over whatever model gets loaded later.
    if (amp_family && std::strcmp(info->symbol, "input_level") == 0 &&
        !engine.IsAmpInputLevelActive(id)) {
      continue;
    }
    if (amp_family && std::strcmp(info->symbol, "output_level") == 0 &&
        !engine.IsAmpOutputLevelActive(id)) {
      continue;
    }
    params.Set(info->symbol, Value::Number(engine.GetParam(id, i)));
  }
  return params;
}

}  // namespace

std::string SerializeState(const AudioEngine& engine, bool embed_assets) {
  Value root = Value::Object();
  root.Set("schemaVersion", Value::Number(kCurrentSchemaVersion));

  Value blocks = Value::Array();
  for (const engine::BlockSnapshot& snap : engine.ListBlocks()) {
    Value block = Value::Object();
    block.Set("id", Value::String(BlockIdToString(snap.id)));
    block.Set("kind", Value::String(BlockKindToString(snap.kind)));
    block.Set("row", Value::Number(snap.row));
    block.Set("col", Value::Number(snap.col));
    if (KindHasBypass(snap.kind)) {
      block.Set("bypass", Value::Bool(engine.IsBypassed(snap.id)));
    }
    block.Set("inputTrim", Value::Number(engine.GetInputTrim(snap.id)));
    block.Set("outputTrim", Value::Number(engine.GetOutputTrim(snap.id)));

    // Core extensions beyond the TS Preset shape: which algorithm/model backs
    // reverb/delay blocks. These aren't params - they choose the DSP object -
    // so they ride as block fields (the loader also accepts the legacy homes).
    if (snap.kind == graph::BlockKind::kReverb) {
      block.Set("reverbAlgorithm",
                Value::String(ReverbAlgorithmToString(engine.GetReverbAlgorithm(snap.id))));
    }
    if (snap.kind == graph::BlockKind::kDelay) {
      block.Set("delayModel", Value::String(DelayModelToString(engine.GetDelayModel(snap.id))));
    }

    // Asset references / payloads (#120). Amp-family blocks carry their loaded
    // capture's .nam JSON; cab blocks their IR's WAV bytes. Written whenever
    // an asset is loaded: name/hash/path as relinkable references always,
    // the payload itself only under embed_assets.
    if (IsAmpFamilyKind(snap.kind)) {
      if (const auto model = engine.BlockModelAsset(snap.id)) {
        const std::string name =
            model->name.empty() ? StemOfPath(model->path) : model->name;
        block.Set("model", BuildAssetObject(
                               name, model->path,
                               reinterpret_cast<const uint8_t*>(model->json.data()),
                               model->json.size(), embed_assets));
      }
    }
    if (snap.kind == graph::BlockKind::kCab) {
      if (const auto ir = engine.BlockIrAsset(snap.id)) {
        const std::string name = ir->name.empty() ? StemOfPath(ir->path) : ir->name;
        block.Set("ir",
                  BuildAssetObject(name, ir->path, ir->wav_bytes.data(), ir->wav_bytes.size(),
                                   embed_assets));
      }
    }

    block.Set("params", SerializeParams(engine, snap.id, IsAmpFamilyKind(snap.kind)));
    blocks.items().push_back(std::move(block));
  }
  root.Set("blocks", std::move(blocks));

  Value edges = Value::Array();
  for (const engine::EdgeSnapshot& edge : engine.ListEdges()) {
    Value entry = Value::Object();
    entry.Set("id", Value::String(BlockIdToString(edge.id)));
    Value from = Value::Object();
    from.Set("blockId", Value::String(BlockIdToString(edge.from_block)));
    from.Set("port", Value::Number(edge.from_port));
    entry.Set("from", std::move(from));
    Value to = Value::Object();
    to.Set("blockId", Value::String(BlockIdToString(edge.to_block)));
    to.Set("port", Value::Number(edge.to_port));
    entry.Set("to", std::move(to));
    edges.items().push_back(std::move(entry));
  }
  root.Set("edges", std::move(edges));

  root.Set("masterLevel", Value::Number(engine.GetMasterLevel()));
  root.Set("masterMuted", Value::Bool(engine.IsMasterMuted()));

  // Automation slot bindings (#121): which slot points at which block, keyed
  // by slot number. Slot 0 is the master bus - implicit, never serialized.
  // Values don't ride here; they live in the blocks' own params (restored by
  // symbol above) and re-derive from them once bindings are re-applied.
  {
    const auto bound = engine.ListBoundAutomationSlots();
    if (!bound.empty()) {
      Value slots = Value::Object();
      for (const auto& entry : bound) {
        Value binding = Value::Object();
        binding.Set("blockId", Value::String(BlockIdToString(entry.block)));
        slots.Set(BlockIdToString(entry.slot), std::move(binding));
      }
      root.Set("automationSlots", std::move(slots));
    }
  }

  // MIDI mappings (#124): array of {match:{type,channel,number}, action:{kind,...}}
  {
    const auto mappings = engine.ListMidiMappings();
    if (!mappings.empty()) {
      Value midi = Value::Array();
      for (const auto& m : mappings) {
        Value entry = Value::Object();
        Value match = Value::Object();
        const char* type_str = nullptr;
        switch (m.match.type) {
          case midi::MessageType::kNoteOn: type_str = "noteon"; break;
          case midi::MessageType::kCc: type_str = "cc"; break;
          case midi::MessageType::kPc: type_str = "pc"; break;
        }
        match.Set("type", Value::String(type_str));
        match.Set("channel", Value::Number(m.match.channel));
        match.Set("number", Value::Number(m.match.number));
        entry.Set("match", std::move(match));
        Value action = Value::Object();
        switch (m.action.kind) {
          case midi::ActionKind::kSlot:
            action.Set("kind", Value::String("slot"));
            action.Set("slot", Value::Number(m.action.slot));
            break;
          case midi::ActionKind::kScene:
            action.Set("kind", Value::String("scene"));
            action.Set("scene", Value::Number(m.action.scene));
            break;
          case midi::ActionKind::kNextScene:
            action.Set("kind", Value::String("nextScene"));
            break;
          case midi::ActionKind::kPrevScene:
            action.Set("kind", Value::String("prevScene"));
            break;
        }
        entry.Set("action", std::move(action));
        midi.items().push_back(std::move(entry));
      }
      root.Set("midiMappings", std::move(midi));
    }
  }

  return json::Write(root);
}

// ── Loading ──────────────────────────────────────────────────────────────

namespace {

// The legacy param keys existing web presets use that are NOT core symbols -
// resolved exactly as RigBlock.ts + namStudioRigWorklet.js resolve them today:
// input_level/output_level mean the per-block I/O trims everywhere, and a
// reverb block's roomSize/damping/... route through ReverbControl.
struct ReverbControlKey {
  const char* key;
  engine::ReverbControl control;
};
constexpr ReverbControlKey kReverbControlKeys[] = {
    {"roomSize", engine::ReverbControl::kRoomSize},
    {"damping", engine::ReverbControl::kDamping},
    {"width", engine::ReverbControl::kWidth},
    {"predelay", engine::ReverbControl::kPredelay},
    {"spin", engine::ReverbControl::kSpin},
    {"wander", engine::ReverbControl::kWander},
    {"earlySend", engine::ReverbControl::kEarlySend},
    {"dryLevel", engine::ReverbControl::kDryLevel},
};

const ReverbControlKey* FindReverbControlKey(const std::string& key) {
  for (const ReverbControlKey& entry : kReverbControlKeys) {
    if (key == entry.key) return &entry;
  }
  return nullptr;
}

// Sets one param by symbol - the document never carries index order. Returns
// false when the block's current param table has no such symbol (skipped with
// a warning, per the issue: unknown symbols are not a hard failure).
bool SetParamBySymbol(AudioEngine& engine, BlockId id, const std::string& symbol, float value) {
  const int count = engine.ParamCount(id);
  for (int i = 0; i < count; ++i) {
    const auto info = engine.ParamInfo(id, i);
    if (info && info->symbol != nullptr && symbol == info->symbol) {
      engine.SetParam(id, i, value);
      return true;
    }
  }
  return false;
}

// Resolves a delay block's model choice from whatever shape the document used:
// canonical "delayModel" string, legacy params.model string ('analog'), or
// legacy numeric params.model (the `model` symbol's own 0..2 range).
bool ResolveDelayModelChoice(const Value& block, const Value* params, dsp::Delay::Model& out) {
  const Value* field = block.Find("delayModel");
  if (field != nullptr && field->IsString() && StringToDelayModel(*field->AsString(), out)) {
    return true;
  }
  if (params != nullptr) {
    const Value* legacy = params->Find("model");
    if (legacy != nullptr && legacy->IsString() && StringToDelayModel(*legacy->AsString(), out)) {
      return true;
    }
    if (legacy != nullptr && legacy->IsNumber()) {
      const double v = legacy->AsNumber();
      const double rounded = std::round(v);
      if (rounded == v && rounded >= 0.0 && rounded <= 2.0) {
        out = static_cast<dsp::Delay::Model>(static_cast<int>(rounded));
        return true;
      }
    }
  }
  return false;
}

// Same for a reverb block's algorithm: canonical block field first, then the
// legacy params.reverbAlgorithm select value.
bool ResolveReverbAlgorithmChoice(const Value& block, const Value* params,
                                  engine::ReverbAlgorithm& out) {
  const Value* field = block.Find("reverbAlgorithm");
  if (field != nullptr && field->IsString() && StringToReverbAlgorithm(*field->AsString(), out)) {
    return true;
  }
  if (params != nullptr) {
    const Value* legacy = params->Find("reverbAlgorithm");
    if (legacy != nullptr && legacy->IsString() &&
        StringToReverbAlgorithm(*legacy->AsString(), out)) {
      return true;
    }
  }
  return false;
}

// One document jack -> this layer's int id, through the doc-id map built
// while blocks were added ("IN"/"OUT"/"-1"/"-2" hit the rail sentinels).
bool MapJack(const Value& jack, const std::unordered_map<std::string, BlockId>& block_ids,
             BlockId& out_block, int& out_port) {
  if (!jack.IsObject()) return false;
  const Value* id_field = jack.Find("blockId");
  const Value* port_field = jack.Find("port");
  if (id_field == nullptr || !id_field->IsString() || port_field == nullptr ||
      !port_field->IsNumber()) {
    return false;
  }
  const std::string& name = *id_field->AsString();
  if (name == graph::kInRail || name == "-1") {
    out_block = engine::kInRailId;
  } else if (name == graph::kOutRail || name == "-2") {
    out_block = engine::kOutRailId;
  } else {
    const auto it = block_ids.find(name);
    if (it == block_ids.end()) return false;  // dangling endpoint - skip edge
    out_block = it->second;
  }
  out_port = static_cast<int>(port_field->AsNumber());
  return true;
}

// ── Asset restoration (#120) ─────────────────────────────────────────────

// Read a file's bytes for a cab IR's path-relink fallback, refusing anything
// over `limit` up front so a huge local file can't be pulled into memory.
std::vector<uint8_t> ReadFileBytesCapped(const std::string& path, size_t limit) {
  std::error_code size_error;
  const auto size = std::filesystem::file_size(path, size_error);
  if (size_error || size > limit) return {};
  std::ifstream ifs(path, std::ios::binary);
  if (!ifs.good()) return {};
  std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(ifs)),
                             std::istreambuf_iterator<char>());
  if (bytes.size() > limit) return {};
  return bytes;
}

// Restore one amp-family block's model from a document's "model" object.
// Order: embedded payload first (the point of #120 - the payload is
// self-contained), then the recorded source path (relinking when the same
// machine still has the file), then nothing: the block stays empty and the
// asset joins the outcome's missing list. A payload that fails to load - bad
// base64, oversized, not a valid .nam - falls through to the path attempt
// rather than giving up. Never a hard failure: partial-failure tolerance
// applies to assets like everything else.
void RestoreAmpAsset(AudioEngine& engine, BlockId id, const Value& entry, LoadOutcome& outcome) {
  const Value* model_obj = entry.Find("model");
  if (model_obj == nullptr || !model_obj->IsObject()) return;

  std::string name;
  std::string path;
  if (const Value* n = model_obj->Find("name"); n != nullptr && n->IsString()) {
    name = *n->AsString();
  }
  if (const Value* p = model_obj->Find("path"); p != nullptr && p->IsString()) {
    path = *p->AsString();
  }

  bool restored = false;
  if (const Value* payload = model_obj->Find("payload");
      payload != nullptr && payload->IsString() && !payload->AsString()->empty()) {
    std::vector<uint8_t> bytes;
    // The decode cap runs before allocation - the payload is untrusted input
    // arriving from a project file (issue #69's limits apply on load too).
    if (Base64Decode(payload->AsString()->data(), payload->AsString()->size(),
                     engine::kMaxModelBytes, bytes)) {
      restored = !engine.LoadNamModelJson(id, std::string(bytes.begin(), bytes.end())).has_value();
    }
  }
  if (!restored && !path.empty()) {
    restored = !engine.LoadNamModel(id, path).has_value();
  }

  if (restored) {
    // Keep the document's own name/path rather than deriving them anew, so
    // re-serializing the restored rig reproduces it byte for byte.
    engine.SetModelSourceInfo(id, name, path);
    ++outcome.stats.assets_restored;
  } else {
    ++outcome.stats.assets_missing;
    outcome.missing_assets.push_back(name.empty() ? "(unnamed model)" : name);
  }
}

// Same for a cab block's "ir" object: WAV bytes embedded as base64, else the
// source file read back from disk, else missing.
void RestoreIrAsset(AudioEngine& engine, BlockId id, const Value& entry, LoadOutcome& outcome) {
  const Value* ir_obj = entry.Find("ir");
  if (ir_obj == nullptr || !ir_obj->IsObject()) return;

  std::string name;
  std::string path;
  if (const Value* n = ir_obj->Find("name"); n != nullptr && n->IsString()) {
    name = *n->AsString();
  }
  if (const Value* p = ir_obj->Find("path"); p != nullptr && p->IsString()) {
    path = *p->AsString();
  }

  bool restored = false;
  if (const Value* payload = ir_obj->Find("payload");
      payload != nullptr && payload->IsString() && !payload->AsString()->empty()) {
    std::vector<uint8_t> bytes;
    if (Base64Decode(payload->AsString()->data(), payload->AsString()->size(),
                     engine::kMaxIrBytes, bytes)) {
      restored =
          !bytes.empty() && engine.LoadIrWav(id, bytes.data(), bytes.size()) != 0;
    }
  }
  if (!restored && !path.empty()) {
    const auto bytes = ReadFileBytesCapped(path, engine::kMaxIrBytes);
    restored = !bytes.empty() && engine.LoadIrWav(id, bytes.data(), bytes.size()) != 0;
  }

  if (restored) {
    engine.SetIrSourceInfo(id, name, path);
    ++outcome.stats.assets_restored;
  } else {
    ++outcome.stats.assets_missing;
    outcome.missing_assets.push_back(name.empty() ? "(unnamed IR)" : name);
  }
}

}  // namespace

LoadOutcome LoadState(AudioEngine& engine, const char* json_text) {
  LoadOutcome outcome;

  // ── Document-level validation: hard failures leave the graph untouched ──
  if (json_text == nullptr) {
    outcome.error = LoadError::kBadDocument;
    outcome.detail = "null input";
    return outcome;
  }

  Value root;
  std::string parse_error;
  if (!json::Parse(json_text, root, &parse_error)) {
    outcome.error = LoadError::kParseError;
    outcome.detail = parse_error;
    return outcome;
  }
  if (!root.IsObject()) {
    outcome.error = LoadError::kBadDocument;
    outcome.detail = "document root must be an object";
    return outcome;
  }

  // schemaVersion policy: missing means 1 (the web app's existing preset
  // files predate the field); anything newer than what this loader knows is
  // rejected rather than guessed at. A missing field also flips the loader's
  // legacy-compat behaviour on (see pass 3): those files carry UI-level keys,
  // not core symbols, in a couple of places.
  int version = 1;
  bool legacy = true;
  if (const Value* v = root.Find("schemaVersion"); v != nullptr) {
    legacy = false;
    if (!v->IsNumber()) {
      outcome.error = LoadError::kBadDocument;
      outcome.detail = "schemaVersion must be a number";
      return outcome;
    }
    const double raw = v->AsNumber();
    if (raw != std::floor(raw) || raw < 1.0) {
      outcome.error = LoadError::kBadDocument;
      outcome.detail = "schemaVersion must be a positive integer";
      return outcome;
    }
    version = static_cast<int>(raw);
  }
  if (version > kCurrentSchemaVersion) {
    outcome.error = LoadError::kUnsupportedVersion;
    outcome.detail = "document schemaVersion " + std::to_string(version) +
                     " is newer than this build's " + std::to_string(kCurrentSchemaVersion);
    return outcome;
  }

  const Value* blocks_doc = root.Find("blocks");
  const Value* edges_doc = root.Find("edges");
  if (blocks_doc == nullptr || !blocks_doc->IsArray() || edges_doc == nullptr ||
      !edges_doc->IsArray()) {
    outcome.error = LoadError::kBadDocument;
    outcome.detail = "document requires 'blocks' and 'edges' arrays";
    return outcome;
  }

  // ── Rebuild: clear first, exactly like applyPreset (#64) ────────────────
  engine.ClearTopology();
  engine.ClearMidiMappings();

  // Pass 1 - place every well-formed block, recording doc-id -> new id so
  // edges can reference blocks regardless of how ids renumber.
  struct DocBlock {
    const Value* entry;
    BlockId new_id;
    graph::BlockKind kind;
  };
  std::vector<DocBlock> placed;
  placed.reserve(blocks_doc->items().size());
  std::unordered_map<std::string, BlockId> block_ids;

  for (const Value& entry : blocks_doc->items()) {
    const Value* id_field = entry.Find("id");
    const Value* kind_field = entry.Find("kind");
    const Value* row_field = entry.Find("row");
    const Value* col_field = entry.Find("col");
    if (id_field == nullptr || !id_field->IsString() || kind_field == nullptr ||
        !kind_field->IsString() || row_field == nullptr || !row_field->IsNumber() ||
        col_field == nullptr || !col_field->IsNumber()) {
      ++outcome.stats.blocks_skipped;
      continue;
    }
    graph::BlockKind kind;
    const std::string& kind_text = *kind_field->AsString();
    if (!StringToBlockKind(kind_text, kind)) {
      // A kind this build has no name for - most likely a document written by
      // a newer OpenAxe. Skip it, don't abort, and tell the caller which one.
      ++outcome.stats.blocks_skipped;
      NoteUnsupportedBlock(outcome, kind_text);
      continue;
    }
    if (!blocks::IsCompiled(kind)) {
      // A kind this build knows but was compiled without
      // (effects.config.json). Same outcome as the unknown-string case: the
      // rest of the rig still restores, and the caller can say what was lost.
      ++outcome.stats.blocks_skipped;
      NoteUnsupportedBlock(outcome, kind_text);
      continue;
    }
    const std::string& doc_id = *id_field->AsString();
    if (block_ids.contains(doc_id)) {
      ++outcome.stats.blocks_skipped;  // duplicate id in one document
      continue;
    }
    const BlockId new_id = engine.AddBlock(kind, static_cast<int>(row_field->AsNumber()),
                                           static_cast<int>(col_field->AsNumber()));
    block_ids.emplace(doc_id, new_id);
    placed.push_back(DocBlock{&entry, new_id, kind});
    ++outcome.stats.blocks_restored;
  }

  // Pass 2 - reverb algorithm / delay model choices BEFORE params: both calls
  // replace or re-seed the block's whole param table, so applying them after
  // would wipe values restored around them.
  for (const DocBlock& doc_block : placed) {
    const Value* params = doc_block.entry->Find("params");
    if (doc_block.kind == graph::BlockKind::kReverb) {
      engine::ReverbAlgorithm algorithm;
      if (ResolveReverbAlgorithmChoice(*doc_block.entry, params, algorithm)) {
        engine.SetReverbAlgorithm(doc_block.new_id, algorithm);
      }
    } else if (doc_block.kind == graph::BlockKind::kDelay) {
      dsp::Delay::Model model;
      if (ResolveDelayModelChoice(*doc_block.entry, params, model)) {
        engine.SetDelayModel(doc_block.new_id, model);
      }
    }
  }

  // Pass 2.5 - assets (#120), also before params: loading a model seeds its
  // dBu calibration into the amp param table, and the document's own values
  // (including any explicit user override of those symbols) must be applied
  // on top afterwards - exactly why pass 2's choices run first too. Assets
  // that can't be resolved leave their block empty and land in the outcome's
  // missing list; they never abort the restore.
  for (const DocBlock& doc_block : placed) {
    if (IsAmpFamilyKind(doc_block.kind)) {
      RestoreAmpAsset(engine, doc_block.new_id, *doc_block.entry, outcome);
    }
    if (doc_block.kind == graph::BlockKind::kCab) {
      RestoreIrAsset(engine, doc_block.new_id, *doc_block.entry, outcome);
    }
  }

  // Pass 3 - params (by symbol), bypass and trims per block. Anything that
  // doesn't resolve - unknown symbol, non-numeric value - is skipped and
  // counted, never a reason to abort the restore.
  for (const DocBlock& doc_block : placed) {
    if (const Value* bypass = doc_block.entry->Find("bypass");
        bypass != nullptr && bypass->IsBool()) {
      engine.SetBypass(doc_block.new_id, bypass->AsBool(false));
    }
    if (const Value* trims_in = doc_block.entry->Find("inputTrim"); trims_in != nullptr &&
                                                                 trims_in->IsNumber()) {
      engine.SetInputTrim(doc_block.new_id,
                          static_cast<float>(trims_in->AsNumber()));
    }
    if (const Value* trims_out = doc_block.entry->Find("outputTrim");
        trims_out != nullptr && trims_out->IsNumber()) {
      engine.SetOutputTrim(doc_block.new_id,
                           static_cast<float>(trims_out->AsNumber()));
    }

    const Value* params = doc_block.entry->Find("params");
    if (params == nullptr || !params->IsObject()) continue;

    for (const auto& [key, value] : params->members()) {
      // Legacy web meaning first: in documents WITHOUT a schemaVersion (the
      // web app's existing preset files), these two keys are the I/O trims on
      // every kind - RigBlock.setParams routes them to setTrim. In canonical
      // core documents they are what they say: the amp family's dBu
      // calibration symbols, and they fall through to the by-symbol path
      // below.
      if (legacy && (key == "input_level" || key == "output_level") && value.IsNumber()) {
        const float gain = static_cast<float>(value.AsNumber());
        if (key == "input_level") {
          engine.SetInputTrim(doc_block.new_id, gain);
        } else {
          engine.SetOutputTrim(doc_block.new_id, gain);
        }
        continue;
      }
      // Legacy reverb abstractions -> the core's ReverbControl mapping, same
      // special case the rig worklet makes for kind == reverb.
      if (doc_block.kind == graph::BlockKind::kReverb) {
        if (const ReverbControlKey* control = FindReverbControlKey(key);
            control != nullptr && value.IsNumber()) {
          engine.SetReverbControl(doc_block.new_id, control->control,
                                  static_cast<float>(value.AsNumber()));
          continue;
        }
        if (key == "reverbAlgorithm") continue;  // handled in pass 2
      }
      if (doc_block.kind == graph::BlockKind::kDelay && key == "model") {
        continue;  // handled in pass 2 (string select or numeric param)
      }
      if (!value.IsNumber()) {
        ++outcome.stats.params_skipped;  // booleans/strings have no core slot
        continue;
      }
      if (!SetParamBySymbol(engine, doc_block.new_id, key,
                            static_cast<float>(value.AsNumber()))) {
        ++outcome.stats.params_skipped;  // unknown symbol: warning, not failure
      }
    }
  }

  // ── Edges ───────────────────────────────────────────────────────────────
  for (const Value& edge : edges_doc->items()) {
    const Value* from = edge.Find("from");
    const Value* to = edge.Find("to");
    if (from == nullptr || to == nullptr) {
      ++outcome.stats.edges_skipped;
      continue;
    }
    BlockId from_block = 0;
    BlockId to_block = 0;
    int from_port = 0;
    int to_port = 0;
    if (!MapJack(*from, block_ids, from_block, from_port) ||
        !MapJack(*to, block_ids, to_block, to_port)) {
      ++outcome.stats.edges_skipped;  // malformed jack or dangling block id
      continue;
    }
    // Connect validates ordering/port range/jack conflicts itself; a rejected
    // connection is one skipped cable, not a failed restore.
    const auto result = engine.Connect(from_block, from_port, to_block, to_port);
    if (result.ok) {
      ++outcome.stats.edges_restored;
    } else {
      ++outcome.stats.edges_skipped;
    }
  }

  // ── Master bus ──────────────────────────────────────────────────────────
  if (const Value* level = root.Find("masterLevel"); level != nullptr && level->IsNumber()) {
    engine.SetMasterLevel(static_cast<float>(level->AsNumber()));
  }
  if (const Value* muted = root.Find("masterMuted"); muted != nullptr && muted->IsBool()) {
    engine.SetMasterMuted(muted->AsBool(false));
  }

  // ── Automation slot bindings (#121) ─────────────────────────────────────
  // Restored last: blocks (and their params) must exist before slots can
  // point at them. Bindings are {"<slot>": {"blockId": "<doc id>"}}; anything
  // malformed - unknown slot, dangling block id, refused rebind - skips and
  // counts, like every other soft failure. Absent key (older documents,
  // rigs with no bindings) restores nothing.
  if (const Value* slots_doc = root.Find("automationSlots");
      slots_doc != nullptr && slots_doc->IsObject()) {
    for (const auto& [key, binding] : slots_doc->members()) {
      // Slot keys are decimal strings from our own serializer; a hostile
      // document may hold anything, so validate shape before converting.
      const bool numeric =
          !key.empty() && key.size() <= 8 &&
          key.find_first_not_of("0123456789") == std::string::npos;
      const int slot = numeric ? std::atoi(key.c_str()) : -1;
      if (!numeric) {
        ++outcome.stats.slots_skipped;  // non-numeric slot key
        continue;
      }
      const Value* block_field = binding.IsObject() ? binding.Find("blockId") : nullptr;
      if (block_field == nullptr || !block_field->IsString()) {
        ++outcome.stats.slots_skipped;
        continue;
      }
      const auto it = block_ids.find(*block_field->AsString());
      // Rails are never automation targets; a dangling doc id is the same
      // skip-with-count as any other broken reference.
      if (it == block_ids.end() ||
          (*block_field->AsString() == graph::kInRail ||
           *block_field->AsString() == graph::kOutRail)) {
        ++outcome.stats.slots_skipped;
        continue;
      }
      if (engine.BindAutomationSlot(slot, it->second)) {
        ++outcome.stats.slots_restored;
      } else {
        ++outcome.stats.slots_skipped;
      }
    }
  }

  // ── MIDI mappings (#124) ────────────────────────────────────────────────
  // Array of {match:{type,channel,number}, action:{kind,...}}. Restored
  // after automation slots (order doesn't matter, but consistent). Each entry
  // is validated; malformed ones skip with a count like every other soft
  // failure. Midi state was cleared with the topology above, so restores here.
  if (const Value* midi_doc = root.Find("midiMappings"); midi_doc != nullptr) {
    if (!midi_doc->IsArray()) {
      // Treat non-array like a soft skip of the whole section — not a hard failure.
      outcome.stats.midi_skipped += 1;
    } else {
      for (const Value& entry : midi_doc->items()) {
        if (!entry.IsObject()) {
          ++outcome.stats.midi_skipped;
          continue;
        }
        const Value* match_obj = entry.Find("match");
        const Value* action_obj = entry.Find("action");
        if (!match_obj || !match_obj->IsObject() || !action_obj || !action_obj->IsObject()) {
          ++outcome.stats.midi_skipped;
          continue;
        }
        const Value* type_v = match_obj->Find("type");
        const Value* chan_v = match_obj->Find("channel");
        const Value* num_v = match_obj->Find("number");
        if (!type_v || !type_v->IsString() || !chan_v || !chan_v->IsNumber() ||
            !num_v || !num_v->IsNumber()) {
          ++outcome.stats.midi_skipped;
          continue;
        }
        midi::MidiMatch match;
        const std::string& type_str = *type_v->AsString();
        if (type_str == "noteon") match.type = midi::MessageType::kNoteOn;
        else if (type_str == "cc") match.type = midi::MessageType::kCc;
        else if (type_str == "pc") match.type = midi::MessageType::kPc;
        else {
          ++outcome.stats.midi_skipped;
          continue;
        }
        match.channel = static_cast<int>(chan_v->AsNumber());
        match.number = static_cast<int>(num_v->AsNumber());

        const Value* kind_v = action_obj->Find("kind");
        if (!kind_v || !kind_v->IsString()) {
          ++outcome.stats.midi_skipped;
          continue;
        }
        midi::MidiAction action;
        const std::string& kind_str = *kind_v->AsString();
        if (kind_str == "slot") {
          const Value* slot_v = action_obj->Find("slot");
          if (!slot_v || !slot_v->IsNumber()) {
            ++outcome.stats.midi_skipped;
            continue;
          }
          action.kind = midi::ActionKind::kSlot;
          action.slot = static_cast<int>(slot_v->AsNumber());
        } else if (kind_str == "scene") {
          const Value* scene_v = action_obj->Find("scene");
          if (!scene_v || !scene_v->IsNumber()) {
            ++outcome.stats.midi_skipped;
            continue;
          }
          action.kind = midi::ActionKind::kScene;
          action.scene = static_cast<int>(scene_v->AsNumber());
        } else if (kind_str == "nextScene") {
          action.kind = midi::ActionKind::kNextScene;
        } else if (kind_str == "prevScene") {
          action.kind = midi::ActionKind::kPrevScene;
        } else {
          ++outcome.stats.midi_skipped;
          continue;
        }

        if (!midi::IsValidMatch(match) || !midi::IsValidAction(action)) {
          ++outcome.stats.midi_skipped;
          continue;
        }

        if (engine.AddMidiMapping(match, action)) {
          ++outcome.stats.midi_restored;
        } else {
          ++outcome.stats.midi_skipped;
        }
      }
    }
  }

  return outcome;
}

}  // namespace openaxe::state
