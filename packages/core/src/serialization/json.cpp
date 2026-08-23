#include "json.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace openaxe::json {
namespace {

// ── Writer ────────────────────────────────────────────────────────────────

// Shortest decimal form that parses back to the exact same double. Params,
// trims and master level all round-trip bit-exactly this way, while clean
// values stay readable ("0.35", not "0.3499999940..."). The precision search
// runs only during serialization - never on the audio path.
std::string FormatNumber(double v) {
  if (std::isnan(v) || std::isinf(v)) return "null";  // JSON has no NaN/Infinity
  char buf[64];
  for (int precision = 1; precision <= 15; ++precision) {
    std::snprintf(buf, sizeof(buf), "%.*g", precision, v);
    if (std::strtod(buf, nullptr) == v) return buf;
  }
  std::snprintf(buf, sizeof(buf), "%.17g", v);  // always round-trips
  return buf;
}

void WriteString(const std::string& s, std::string& out) {
  out += '"';
  for (const char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        // Bytes >= 0x20 pass through as-is (UTF-8 stays UTF-8); the C0
        // controls JSON can't represent literally get \u escapes.
        if (static_cast<unsigned char>(c) < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned>(static_cast<unsigned char>(c)));
          out += buf;
        } else {
          out += c;
        }
    }
  }
  out += '"';
}

void WriteIndent(std::string& out, int depth) {
  out.append(static_cast<size_t>(depth) * 2, ' ');
}

void WriteValue(const Value& value, std::string& out, int depth) {
  using T = Value::Type;
  switch (value.type()) {
    case T::kNull: out += "null"; break;
    case T::kBool: out += value.AsBool(false) ? std::string("true") : std::string("false"); break;
    case T::kNumber: out += FormatNumber(value.AsNumber()); break;
    case T::kString:
      WriteString(*value.AsString(), out);
      break;
    case T::kArray: {
      if (value.items().empty()) {
        out += "[]";
        break;
      }
      out += "[\n";
      bool first = true;
      for (const Value& item : value.items()) {
        if (!first) out += ",\n";
        first = false;
        WriteIndent(out, depth + 1);
        WriteValue(item, out, depth + 1);
      }
      out += '\n';
      WriteIndent(out, depth);
      out += ']';
      break;
    }
    case T::kObject: {
      if (value.members().empty()) {
        out += "{}";
        break;
      }
      out += "{\n";
      bool first = true;
      for (const auto& [key, member] : value.members()) {
        if (!first) out += ",\n";
        first = false;
        WriteIndent(out, depth + 1);
        WriteString(key, out);
        out += ": ";
        WriteValue(member, out, depth + 1);
      }
      out += '\n';
      WriteIndent(out, depth);
      out += '}';
      break;
    }
  }
}

// ── Parser ────────────────────────────────────────────────────────────────

struct Parser {
  std::string_view text;
  size_t pos = 0;
  std::string error;

  bool Fail(const char* message) {
    if (error.empty()) {
      error = std::string(message) + " at offset " + std::to_string(pos);
    }
    return false;
  }

  bool AtEnd() const { return pos >= text.size(); }
  char Peek() const { return text[pos]; }

  void SkipWhitespace() {
    while (!AtEnd()) {
      const char c = Peek();
      if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
        ++pos;
      } else {
        break;
      }
    }
  }

  bool Expect(char c) {
    SkipWhitespace();
    if (AtEnd() || Peek() != c) {
      char buf[48];
      std::snprintf(buf, sizeof(buf), "expected '%c'", c);
      return Fail(buf);
    }
    ++pos;
    return true;
  }

  // Recursion depth is bounded so a hostile document ("[[[[[...", megabytes
  // deep) fails cleanly instead of overflowing the stack.
  bool ParseValue(Value& out, int depth);

  bool ParseString(std::string& out) {
    SkipWhitespace();
    if (AtEnd() || Peek() != '"') return Fail("expected string");
    ++pos;
    out.clear();
    while (true) {
      if (AtEnd()) return Fail("unterminated string");
      const char c = text[pos++];
      if (c == '"') return true;
      if (c != '\\') {
        out += c;
        continue;
      }
      if (AtEnd()) return Fail("unterminated escape");
      const char esc = text[pos++];
      switch (esc) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'u': {
          unsigned code = 0;
          if (!ParseHex4(code)) return false;
          // Surrogate pair: high surrogate must be followed by \uXXXX low.
          if (code >= 0xD800 && code <= 0xDBFF) {
            if (pos + 1 < text.size() && text[pos] == '\\' && text[pos + 1] == 'u') {
              pos += 2;
              unsigned low = 0;
              if (!ParseHex4(low)) return false;
              if (low < 0xDC00 || low > 0xDFFF) return Fail("invalid low surrogate");
              code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
            } else {
              return Fail("lone high surrogate");
            }
          } else if (code >= 0xDC00 && code <= 0xDFFF) {
            return Fail("lone low surrogate");
          }
          AppendUtf8(code, out);
          break;
        }
        default: return Fail("bad escape");
      }
    }
  }

  bool ParseHex4(unsigned& out) {
    if (pos + 4 > text.size()) return Fail("truncated \\u escape");
    for (int i = 0; i < 4; ++i) {
      const char c = text[pos + static_cast<size_t>(i)];
      unsigned digit;
      if (c >= '0' && c <= '9') {
        digit = static_cast<unsigned>(c - '0');
      } else if (c >= 'a' && c <= 'f') {
        digit = static_cast<unsigned>(c - 'a' + 10);
      } else if (c >= 'A' && c <= 'F') {
        digit = static_cast<unsigned>(c - 'A' + 10);
      } else {
        return Fail("bad \\u escape");
      }
      out = (out << 4) | digit;
    }
    pos += 4;
    return true;
  }

  static void AppendUtf8(unsigned code, std::string& out) {
    if (code < 0x80) {
      out += static_cast<char>(code);
    } else if (code < 0x800) {
      out += static_cast<char>(0xC0 | (code >> 6));
      out += static_cast<char>(0x80 | (code & 0x3F));
    } else if (code < 0x10000) {
      out += static_cast<char>(0xE0 | (code >> 12));
      out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
      out += static_cast<char>(0x80 | (code & 0x3F));
    } else {
      out += static_cast<char>(0xF0 | (code >> 18));
      out += static_cast<char>(0x80 | ((code >> 12) & 0x3F));
      out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
      out += static_cast<char>(0x80 | (code & 0x3F));
    }
  }

  bool ParseNumber(double& out) {
    SkipWhitespace();
    const size_t start = pos;
    if (!AtEnd() && Peek() == '-') ++pos;
    // int part: 0 | [1-9][0-9]*  (JSON rejects leading zeroes)
    if (AtEnd() || Peek() < '0' || Peek() > '9') return Fail("expected number");
    if (Peek() == '0') {
      ++pos;
    } else {
      while (!AtEnd() && Peek() >= '0' && Peek() <= '9') ++pos;
    }
    // fraction
    if (!AtEnd() && Peek() == '.') {
      ++pos;
      if (AtEnd() || Peek() < '0' || Peek() > '9') return Fail("bad fraction");
      while (!AtEnd() && Peek() >= '0' && Peek() <= '9') ++pos;
    }
    // exponent
    if (!AtEnd() && (Peek() == 'e' || Peek() == 'E')) {
      ++pos;
      if (!AtEnd() && (Peek() == '+' || Peek() == '-')) ++pos;
      if (AtEnd() || Peek() < '0' || Peek() > '9') return Fail("bad exponent");
      while (!AtEnd() && Peek() >= '0' && Peek() <= '9') ++pos;
    }
    const std::string token(text.substr(start, pos - start));
    out = std::strtod(token.c_str(), nullptr);
    return true;
  }

  bool ParseLiteral(const char* literal, Value::Type type, Value& out) {
    const size_t len = std::strlen(literal);
    if (text.size() - pos < len || text.compare(pos, len, literal) != 0) {
      return Fail("expected a value");
    }
    pos += len;
    if (type == Value::Type::kBool) out = Value::Bool(literal[0] == 't');
    return true;  // kNull leaves `out` a default null
  }
};

bool Parser::ParseValue(Value& out, int depth) {
  if (depth > kMaxDepth) return Fail("nesting too deep");
  SkipWhitespace();
  if (AtEnd()) return Fail("unexpected end of input");

  switch (Peek()) {
    case '{': {
      ++pos;
      out = Value::Object();
      SkipWhitespace();
      if (!AtEnd() && Peek() == '}') {
        ++pos;
        return true;
      }
      while (true) {
        SkipWhitespace();
        std::string key;
        if (!ParseString(key)) return false;
        if (!Expect(':')) return false;
        Value member;
        if (!ParseValue(member, depth + 1)) return false;
        out.Set(std::move(key), std::move(member));  // duplicate keys: last wins
        SkipWhitespace();
        if (AtEnd()) return Fail("unterminated object");
        if (Peek() == ',') {
          ++pos;
          continue;
        }
        if (Peek() == '}') {
          ++pos;
          return true;
        }
        return Fail("expected ',' or '}'");
      }
    }
    case '[': {
      ++pos;
      out = Value::Array();
      SkipWhitespace();
      if (!AtEnd() && Peek() == ']') {
        ++pos;
        return true;
      }
      while (true) {
        Value item;
        if (!ParseValue(item, depth + 1)) return false;
        out.items().push_back(std::move(item));
        SkipWhitespace();
        if (AtEnd()) return Fail("unterminated array");
        if (Peek() == ',') {
          ++pos;
          continue;
        }
        if (Peek() == ']') {
          ++pos;
          return true;
        }
        return Fail("expected ',' or ']'");
      }
    }
    case '"': {
      std::string s;
      if (!ParseString(s)) return false;
      out = Value::String(std::move(s));
      return true;
    }
    case 't':
      return ParseLiteral("true", Value::Type::kBool, out);
    case 'f':
      return ParseLiteral("false", Value::Type::kBool, out);
    case 'n':
      return ParseLiteral("null", Value::Type::kNull, out);
    default: {
      double n = 0.0;
      if (!ParseNumber(n)) return false;
      out = Value::Number(n);
      return true;
    }
  }
}

}  // namespace

// ── Value ────────────────────────────────────────────────────────────────

Value Value::Bool(bool v) {
  Value v2;
  v2.type_ = Type::kBool;
  v2.bool_ = v;
  return v2;
}

Value Value::Number(double v) {
  Value v2;
  v2.type_ = Type::kNumber;
  v2.number_ = v;
  return v2;
}

Value Value::String(std::string v) {
  Value v2;
  v2.type_ = Type::kString;
  v2.string_ = std::move(v);
  return v2;
}

Value Value::Array() {
  Value v2;
  v2.type_ = Type::kArray;
  return v2;
}

Value Value::Object() {
  Value v2;
  v2.type_ = Type::kObject;
  return v2;
}

bool Value::AsBool(bool fallback) const { return IsBool() ? bool_ : fallback; }

double Value::AsNumber(double fallback) const { return IsNumber() ? number_ : fallback; }

const std::string* Value::AsString() const { return IsString() ? &string_ : nullptr; }

const Value* Value::Find(std::string_view key) const {
  if (!IsObject()) return nullptr;
  for (const auto& [k, v] : object_) {
    if (k == key) return &v;
  }
  return nullptr;
}

void Value::Set(std::string key, Value value) {
  for (auto& [k, v] : object_) {
    if (k == key) {
      v = std::move(value);
      return;
    }
  }
  object_.emplace_back(std::move(key), std::move(value));
}

// ── Free functions ───────────────────────────────────────────────────────

std::string Write(const Value& value) {
  std::string out;
  WriteValue(value, out, 0);
  out += '\n';
  return out;
}

bool Parse(std::string_view text, Value& out_value, std::string* out_error) {
  Parser parser{text};
  bool ok = parser.ParseValue(out_value, 0);
  if (ok) {
    parser.SkipWhitespace();
    if (!parser.AtEnd()) ok = parser.Fail("trailing content after document");
  }
  if (!ok && out_error != nullptr) *out_error = parser.error;
  return ok;
}

}  // namespace openaxe::json
