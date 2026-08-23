#include "base64.h"

namespace nam_studio::state {
namespace {

constexpr char kAlphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Reverse lookup: negative for anything that isn't an alphabet character
// (including '=' - padding is handled positionally before this runs).
int DecodeDigit(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

void EmitGroup(uint32_t accumulator, std::vector<uint8_t>& buffer) {
  buffer.push_back(static_cast<uint8_t>((accumulator >> 16) & 0xFFu));
  buffer.push_back(static_cast<uint8_t>((accumulator >> 8) & 0xFFu));
  buffer.push_back(static_cast<uint8_t>(accumulator & 0xFFu));
}

}  // namespace

std::string Base64Encode(const uint8_t* data, size_t size) {
  std::string out;
  out.reserve(((size + 2) / 3) * 4);
  size_t i = 0;
  while (i + 3 <= size) {
    const uint32_t v = (static_cast<uint32_t>(data[i]) << 16) |
                       (static_cast<uint32_t>(data[i + 1]) << 8) | data[i + 2];
    out.push_back(kAlphabet[(v >> 18) & 0x3F]);
    out.push_back(kAlphabet[(v >> 12) & 0x3F]);
    out.push_back(kAlphabet[(v >> 6) & 0x3F]);
    out.push_back(kAlphabet[v & 0x3F]);
    i += 3;
  }
  const size_t remainder = size - i;
  if (remainder == 1) {
    const uint32_t v = static_cast<uint32_t>(data[i]) << 16;
    out.push_back(kAlphabet[(v >> 18) & 0x3F]);
    out.push_back(kAlphabet[(v >> 12) & 0x3F]);
    out.push_back('=');
    out.push_back('=');
  } else if (remainder == 2) {
    const uint32_t v = (static_cast<uint32_t>(data[i]) << 16) |
                       (static_cast<uint32_t>(data[i + 1]) << 8);
    out.push_back(kAlphabet[(v >> 18) & 0x3F]);
    out.push_back(kAlphabet[(v >> 12) & 0x3F]);
    out.push_back(kAlphabet[(v >> 6) & 0x3F]);
    out.push_back('=');
  }
  return out;
}

bool Base64Decode(const char* data, size_t size, size_t max_output,
                  std::vector<uint8_t>& out) {
  // Empty input is a valid (empty) payload - the honest inverse of encoding
  // zero bytes. Callers that treat empty as "absent" check before decoding.
  if (size == 0) {
    out.clear();
    return true;
  }
  if (size % 4 != 0) return false;

  // Padding may be only the last one or two characters. Strip it first; any
  // '=' elsewhere fails the alphabet scan below.
  size_t content_len = size;
  if (data[content_len - 1] == '=') --content_len;
  if (content_len > 0 && data[content_len - 1] == '=') --content_len;
  const size_t padding = size - content_len;
  if (padding > 2) return false;  // e.g. "====" - nothing but padding

  // Enforce the caller's cap BEFORE allocating: a hostile document must not
  // be able to buy a huge allocation with one long string.
  const size_t decoded_size = (size / 4) * 3 - padding;
  if (decoded_size > max_output) return false;

  std::vector<uint8_t> buffer;
  buffer.reserve(decoded_size);

  uint32_t accumulator = 0;
  int digits = 0;
  for (size_t i = 0; i < content_len; ++i) {
    const int d = DecodeDigit(data[i]);
    if (d < 0) return false;
    accumulator = (accumulator << 6) | static_cast<uint32_t>(d);
    if (++digits == 4) {
      EmitGroup(accumulator, buffer);
      accumulator = 0;
      digits = 0;
    }
  }

  // Final partial group: two sextets carry one byte, three carry two. (One is
  // impossible with size % 4 == 0 and padding <= 2.)
  constexpr int kSextetBits = 6;
  if (digits == 2) {
    accumulator <<= (4 - digits) * kSextetBits;
    buffer.push_back(static_cast<uint8_t>((accumulator >> 16) & 0xFFu));
  } else if (digits == 3) {
    accumulator <<= (4 - digits) * kSextetBits;
    buffer.push_back(static_cast<uint8_t>((accumulator >> 16) & 0xFFu));
    buffer.push_back(static_cast<uint8_t>((accumulator >> 8) & 0xFFu));
  } else if (digits != 0) {
    return false;  // unreachable given the length/padding rules above
  }

  if (buffer.size() != decoded_size) return false;  // belt and braces
  out = std::move(buffer);
  return true;
}

}  // namespace nam_studio::state
