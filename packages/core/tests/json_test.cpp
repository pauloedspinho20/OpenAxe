// Unit tests for src/serialization/json.{h,cpp} - the dependency-free JSON
// value/writer/parser rig-state (de)serialization rides on (issue #119).
// Focus: parse correctness on the shapes real documents use, round-trip
// fidelity, and clean failure on malformed input.

#include "serialization/json.h"

#include <cmath>
#include <cstdio>
#include <string>

#include "test_harness.h"

using nam_studio::json::Parse;
using nam_studio::json::Value;
using nam_studio::json::Write;

namespace {

void ExpectRoundTrip(const std::string& json) {
  Value parsed;
  std::string error;
  NAM_EXPECT(Parse(json, parsed, &error));
  if (!error.empty()) return;
  const std::string written = Write(parsed);
  Value reparsed;
  std::string error2;
  NAM_EXPECT(Parse(written, reparsed, &error2));
  if (!error2.empty()) return;
  // Re-serializing must be stable (idempotent formatting).
  NAM_EXPECT(Write(reparsed) == written);
}

}  // namespace

int main() {
  // ── Parsing basics ────────────────────────────────────────────────────
  {
    Value v;
    NAM_EXPECT(Parse("null", v, nullptr));
    NAM_EXPECT(v.IsNull());
    NAM_EXPECT(Parse("true", v, nullptr));
    NAM_EXPECT(v.IsBool() && v.AsBool(false));
    NAM_EXPECT(Parse("false", v, nullptr));
    NAM_EXPECT(v.IsBool() && !v.AsBool(true));
    NAM_EXPECT(Parse("-12.5e2", v, nullptr));
    NAM_EXPECT(v.IsNumber() && v.AsNumber() == -1250.0);
    NAM_EXPECT(Parse("\"hi\"", v, nullptr));
    NAM_EXPECT(v.IsString() && *v.AsString() == "hi");
  }

  // Number forms JSON allows (and one it doesn't).
  {
    Value v;
    NAM_EXPECT(Parse("0", v, nullptr) && v.AsNumber() == 0.0);
    NAM_EXPECT(Parse("-0", v, nullptr) && v.AsNumber() == -0.0);
    NAM_EXPECT(Parse("1E+3", v, nullptr) && v.AsNumber() == 1000.0);
    NAM_EXPECT(!Parse("01", v, nullptr));   // leading zero
    NAM_EXPECT(!Parse(".5", v, nullptr));   // no leading digit
    NAM_EXPECT(!Parse("1.", v, nullptr));   // trailing dot
    NAM_EXPECT(!Parse("+1", v, nullptr));   // no leading sign
  }

  // String escapes, including \u with a surrogate pair and UTF-8 passthrough.
  {
    Value v;
    NAM_EXPECT(Parse("\"a\\nb\\t\\\"c\\\\d\"", v, nullptr));
    NAM_EXPECT(*v.AsString() == "a\nb\t\"c\\d");
    NAM_EXPECT(Parse("\"\\u0041\"", v, nullptr));
    NAM_EXPECT(*v.AsString() == "A");
    // U+1F600 as a surrogate pair -> 4-byte UTF-8.
    NAM_EXPECT(Parse("\"\\uD83D\\uDE00\"", v, nullptr));
    NAM_EXPECT(*v.AsString() == "\xF0\x9F\x98\x80");
    NAM_EXPECT(!Parse("\"\\uD83D\"", v, nullptr));       // lone high surrogate
    NAM_EXPECT(!Parse("\"\\uDC00\"", v, nullptr));       // lone low surrogate
    NAM_EXPECT(!Parse("\"unterminated", v, nullptr));
    NAM_EXPECT(!Parse("\"bad \\x escape\"", v, nullptr));
  }

  // Nested containers, insertion order preserved, duplicate keys last-wins.
  {
    Value v;
    NAM_EXPECT(Parse("{\"a\":1,\"b\":[1,{\"c\":true}],\"a\":2}", v, nullptr));
    NAM_EXPECT(v.Find("a") != nullptr && v.Find("a")->AsNumber() == 2.0);
    NAM_EXPECT(v.members()[0].first == "a");  // order kept
    NAM_EXPECT(v.members()[1].first == "b");
    const Value& b = *v.Find("b");
    NAM_EXPECT(b.items().size() == 2);
    NAM_EXPECT(b.items()[1].Find("c")->AsBool(false));
  }

  // Malformed documents fail without crashing (and report where).
  {
    Value v;
    std::string error;
    NAM_EXPECT(!Parse("{", v, &error) && !error.empty());
    NAM_EXPECT(!Parse("[1,", v, nullptr));
    NAM_EXPECT(!Parse("{\"a\" 1}", v, nullptr));
    NAM_EXPECT(Parse("{}", v, nullptr));                 // empty object is fine
    NAM_EXPECT(Parse("[]", v, nullptr));                 // empty array too
    NAM_EXPECT(!Parse("{} {}", v, nullptr));             // trailing content
    NAM_EXPECT(!Parse("1 2", v, nullptr));
    NAM_EXPECT(!Parse("", v, nullptr));
    // Depth bomb: must be rejected, not blow the stack. Build 5000 nested
    // arrays.
    std::string deep(5000, '[');
    deep.append(5000, ']');
    NAM_EXPECT(!Parse(deep, v, nullptr));
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
    NAM_EXPECT(Parse(text, back, nullptr));
    NAM_EXPECT(back.Find("clean")->AsNumber() == 0.35);
    NAM_EXPECT(text.find("\"clean\": 0.35") != std::string::npos);
    NAM_EXPECT(back.Find("big")->AsNumber() == 12000.0);
    NAM_EXPECT(back.Find("neg")->AsNumber() == -12.0);
    NAM_EXPECT(back.Find("flag")->AsBool(false));
    NAM_EXPECT(back.Find("nothing")->IsNull());
    NAM_EXPECT(*back.Find("s")->AsString() == "x\"y\n");
    // Control characters get \u escapes; C0 shortcuts stay short.
    Value ctrl = Value::String(std::string("a\x01z"));
    NAM_EXPECT(Write(ctrl).find("\\u0001") != std::string::npos);
  }

  // Float bit-exactness through write->parse for awkward values.
  {
    const double awkward[] = {0.1f, 1.0f / 3.0f, 123456.789f, 2.5e-8f};
    for (const double original : awkward) {
      Value v = Value::Number(original);
      const std::string text = Write(v);
      Value back;
      NAM_EXPECT(Parse(text, back, nullptr));
      // Values originate from float params: exact after a float round-trip.
      NAM_EXPECT(static_cast<float>(back.AsNumber()) == static_cast<float>(original));
    }
  }

  // Whole-document round trips.
  ExpectRoundTrip("{\"schemaVersion\": 1,\n\"blocks\": []}");
  ExpectRoundTrip(
      "{\"blocks\": [{\"id\": \"7\", \"kind\": \"ping-pong-delay\", \"row\": 0, "
      "\"col\": 3, \"bypass\": false, \"params\": {\"time\": 250, \"tone\": 6000}}],"
      " \"edges\": [], \"masterLevel\": 0.8, \"masterMuted\": false}");

  if (::nam_studio::test::g_failures == 0) {
    std::printf("json_test passed\n");
    return 0;
  }
  std::printf("json_test FAILED (%d)\n", ::nam_studio::test::g_failures);
  return 1;
}
