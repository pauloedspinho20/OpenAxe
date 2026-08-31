// Unit tests for src/serialization/json.{h,cpp} - the dependency-free JSON
// value/writer/parser rig-state (de)serialization rides on (issue #119).
// Focus: parse correctness on the shapes real documents use, round-trip
// fidelity, and clean failure on malformed input.

#include "serialization/json.h"

#include <cmath>
#include <cstdio>
#include <string>

#include "test_harness.h"

using openaxe::json::Parse;
using openaxe::json::Value;
using openaxe::json::Write;

namespace {

void ExpectRoundTrip(const std::string& json) {
  Value parsed;
  std::string error;
  OPENAXE_EXPECT(Parse(json, parsed, &error));
  if (!error.empty()) return;
  const std::string written = Write(parsed);
  Value reparsed;
  std::string error2;
  OPENAXE_EXPECT(Parse(written, reparsed, &error2));
  if (!error2.empty()) return;
  // Re-serializing must be stable (idempotent formatting).
  OPENAXE_EXPECT(Write(reparsed) == written);
}

}  // namespace

int main() {
  // ── Parsing basics ────────────────────────────────────────────────────
  {
    Value v;
    OPENAXE_EXPECT(Parse("null", v, nullptr));
    OPENAXE_EXPECT(v.IsNull());
    OPENAXE_EXPECT(Parse("true", v, nullptr));
    OPENAXE_EXPECT(v.IsBool() && v.AsBool(false));
    OPENAXE_EXPECT(Parse("false", v, nullptr));
    OPENAXE_EXPECT(v.IsBool() && !v.AsBool(true));
    OPENAXE_EXPECT(Parse("-12.5e2", v, nullptr));
    OPENAXE_EXPECT(v.IsNumber() && v.AsNumber() == -1250.0);
    OPENAXE_EXPECT(Parse("\"hi\"", v, nullptr));
    OPENAXE_EXPECT(v.IsString() && *v.AsString() == "hi");
  }

  // Number forms JSON allows (and one it doesn't).
  {
    Value v;
    OPENAXE_EXPECT(Parse("0", v, nullptr) && v.AsNumber() == 0.0);
    OPENAXE_EXPECT(Parse("-0", v, nullptr) && v.AsNumber() == -0.0);
    OPENAXE_EXPECT(Parse("1E+3", v, nullptr) && v.AsNumber() == 1000.0);
    OPENAXE_EXPECT(!Parse("01", v, nullptr));   // leading zero
    OPENAXE_EXPECT(!Parse(".5", v, nullptr));   // no leading digit
    OPENAXE_EXPECT(!Parse("1.", v, nullptr));   // trailing dot
    OPENAXE_EXPECT(!Parse("+1", v, nullptr));   // no leading sign
  }

  // String escapes, including \u with a surrogate pair and UTF-8 passthrough.
  {
    Value v;
    OPENAXE_EXPECT(Parse("\"a\\nb\\t\\\"c\\\\d\"", v, nullptr));
    OPENAXE_EXPECT(*v.AsString() == "a\nb\t\"c\\d");
    OPENAXE_EXPECT(Parse("\"\\u0041\"", v, nullptr));
    OPENAXE_EXPECT(*v.AsString() == "A");
    // U+1F600 as a surrogate pair -> 4-byte UTF-8.
    OPENAXE_EXPECT(Parse("\"\\uD83D\\uDE00\"", v, nullptr));
    OPENAXE_EXPECT(*v.AsString() == "\xF0\x9F\x98\x80");
    OPENAXE_EXPECT(!Parse("\"\\uD83D\"", v, nullptr));       // lone high surrogate
    OPENAXE_EXPECT(!Parse("\"\\uDC00\"", v, nullptr));       // lone low surrogate
    OPENAXE_EXPECT(!Parse("\"unterminated", v, nullptr));
    OPENAXE_EXPECT(!Parse("\"bad \\x escape\"", v, nullptr));
  }

  // Nested containers, insertion order preserved, duplicate keys last-wins.
  {
    Value v;
    OPENAXE_EXPECT(Parse("{\"a\":1,\"b\":[1,{\"c\":true}],\"a\":2}", v, nullptr));
    OPENAXE_EXPECT(v.Find("a") != nullptr && v.Find("a")->AsNumber() == 2.0);
    OPENAXE_EXPECT(v.members()[0].first == "a");  // order kept
    OPENAXE_EXPECT(v.members()[1].first == "b");
    const Value& b = *v.Find("b");
    OPENAXE_EXPECT(b.items().size() == 2);
    OPENAXE_EXPECT(b.items()[1].Find("c")->AsBool(false));
  }

  // Malformed documents fail without crashing (and report where).
  {
    Value v;
    std::string error;
    OPENAXE_EXPECT(!Parse("{", v, &error) && !error.empty());
    OPENAXE_EXPECT(!Parse("[1,", v, nullptr));
    OPENAXE_EXPECT(!Parse("{\"a\" 1}", v, nullptr));
    OPENAXE_EXPECT(Parse("{}", v, nullptr));                 // empty object is fine
    OPENAXE_EXPECT(Parse("[]", v, nullptr));                 // empty array too
    OPENAXE_EXPECT(!Parse("{} {}", v, nullptr));             // trailing content
    OPENAXE_EXPECT(!Parse("1 2", v, nullptr));
    OPENAXE_EXPECT(!Parse("", v, nullptr));
    // Depth bomb: must be rejected, not blow the stack. Build 5000 nested
    // arrays.
    std::string deep(5000, '[');
    deep.append(5000, ']');
    OPENAXE_EXPECT(!Parse(deep, v, nullptr));
  }

  // ── Writing ───────────────────────────────────────────────────────────
  {
    // Shortest form that round-trips exactly: clean values stay readable.
    Value obj = Value::Object();
    obj.Set("clean", Value::Number(0.35));
    obj.Set("big", Value::Number(12000.0));
    obj.Set("neg", Value::Number(-12.0));
    obj.Set("flag", Value::Bool(true));
    obj.Set("nothing", Value());
    obj.Set("s", Value::String("x\"y\n"));
    const std::string text = Write(obj);
    Value back;
    OPENAXE_EXPECT(Parse(text, back, nullptr));
    OPENAXE_EXPECT(back.Find("clean")->AsNumber() == 0.35);
    OPENAXE_EXPECT(text.find("\"clean\": 0.35") != std::string::npos);
    OPENAXE_EXPECT(back.Find("big")->AsNumber() == 12000.0);
    OPENAXE_EXPECT(back.Find("neg")->AsNumber() == -12.0);
    OPENAXE_EXPECT(back.Find("flag")->AsBool(false));
    OPENAXE_EXPECT(back.Find("nothing")->IsNull());
    OPENAXE_EXPECT(*back.Find("s")->AsString() == "x\"y\n");
    // Control characters get \u escapes; C0 shortcuts stay short.
    Value ctrl = Value::String(std::string("a\x01z"));
    OPENAXE_EXPECT(Write(ctrl).find("\\u0001") != std::string::npos);
  }

  // Float bit-exactness through write->parse for awkward values.
  {
    const double awkward[] = {0.1f, 1.0f / 3.0f, 123456.789f, 2.5e-8f};
    for (const double original : awkward) {
      Value v = Value::Number(original);
      const std::string text = Write(v);
      Value back;
      OPENAXE_EXPECT(Parse(text, back, nullptr));
      // Values originate from float params: exact after a float round-trip.
      OPENAXE_EXPECT(static_cast<float>(back.AsNumber()) == static_cast<float>(original));
    }
  }

  // Whole-document round trips.
  ExpectRoundTrip("{\"schemaVersion\": 1,\n\"blocks\": []}");
  ExpectRoundTrip(
      "{\"blocks\": [{\"id\": \"7\", \"kind\": \"delay\", \"row\": 0, "
      "\"col\": 3, \"bypass\": false, \"params\": {\"time\": 250, \"tone\": 6000}}],"
      " \"edges\": [], \"masterLevel\": 0.8, \"masterMuted\": false}");

  if (::openaxe::test::g_failures == 0) {
    std::printf("json_test passed\n");
    return 0;
  }
  std::printf("json_test FAILED (%d)\n", ::openaxe::test::g_failures);
  return 1;
}
