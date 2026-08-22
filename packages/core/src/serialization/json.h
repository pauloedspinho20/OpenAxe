#pragma once

#include <string>
#include <utility>
#include <vector>

// Minimal JSON value model, writer and parser for packages/core's rig-state
// (de)serialization (issue #119). Hand-written rather than vendored: the only
// JSON library reachable from this target is NeuralAmpModelerCore's private
// nlohmann copy (see CMakeLists.txt), which would make serialization
// conditionally compilable on a submodule - the same reason dsp/convolver.cpp
// carries its own small FFT. The document shape this needs to round-trip is
// plain JSON (objects/arrays/strings/numbers/bools/null); nothing here
// pretends to be a general-purpose JSON toolkit.
//
// Objects preserve insertion order so serialized documents are stable across
// runs; duplicate keys parse last-wins. Numbers are held as double, which
// covers every value core writes (params, trims, master level are floats;
// row/col/schemaVersion are ints well inside double's exact range).
namespace nam_studio::json {

class Value {
 public:
  enum class Type { kNull, kBool, kNumber, kString, kArray, kObject };

  Value() = default;  // null

  static Value Bool(bool v);
  static Value Number(double v);
  static Value String(std::string v);
  static Value Array();
  static Value Object();

  Type type() const { return type_; }
  bool IsNull() const { return type_ == Type::kNull; }
  bool IsBool() const { return type_ == Type::kBool; }
  bool IsNumber() const { return type_ == Type::kNumber; }
  bool IsString() const { return type_ == Type::kString; }
  bool IsArray() const { return type_ == Type::kArray; }
  bool IsObject() const { return type_ == Type::kObject; }

  // Typed reads with caller-supplied fallbacks - no exceptions, matching the
  // rest of this library's style.
  bool AsBool(bool fallback) const;
  double AsNumber(double fallback = 0.0) const;
  const std::string* AsString() const;  // nullptr unless a string

  // Array access. Empty for non-arrays.
  std::vector<Value>& items() { return array_; }
  const std::vector<Value>& items() const { return array_; }

  // Object access, preserving insertion order. Empty for non-objects.
  std::vector<std::pair<std::string, Value>>& members() { return object_; }
  const std::vector<std::pair<std::string, Value>>& members() const { return object_; }

  // First member with this key, or nullptr. Linear scan - documents here have
  // single-digit member counts.
  const Value* Find(std::string_view key) const;
  void Set(std::string key, Value value);  // appends (or replaces an existing key)

 private:
  Type type_ = Type::kNull;
  bool bool_ = false;
  double number_ = 0.0;
  std::string string_;
  std::vector<Value> array_;
  std::vector<std::pair<std::string, Value>> object_;
};

// Serializes to pretty-printed JSON with two-space indent (the same shape
// presetIO.ts's `JSON.stringify(preset, null, 2)` produces, so core-written
// files read like the web app's).
std::string Write(const Value& value);

// Parses one JSON document. Returns false (with `error` filled in when
// non-null) for anything malformed: bad syntax, trailing content, or nesting
// deeper than kMaxDepth - a hostile input must not overflow the stack.
inline constexpr int kMaxDepth = 128;
bool Parse(std::string_view text, Value& out_value, std::string* out_error);

}  // namespace nam_studio::json
