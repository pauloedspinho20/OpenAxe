#include "sha256.h"

#include <array>
#include <cstring>

namespace nam_studio::state {
namespace {

// FIPS 180-4 constants: the fractional parts of the cube roots of the first
// 64 primes.
constexpr std::array<uint32_t, 64> kRoundConstants = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
    0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
    0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
    0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
    0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
};

inline uint32_t Rotr(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }

void CompressBlock(const uint8_t* block, std::array<uint32_t, 8>& state) {
  std::array<uint32_t, 64> w{};
  for (int i = 0; i < 16; ++i) {
    w[static_cast<size_t>(i)] = (static_cast<uint32_t>(block[i * 4]) << 24) |
                                (static_cast<uint32_t>(block[i * 4 + 1]) << 16) |
                                (static_cast<uint32_t>(block[i * 4 + 2]) << 8) |
                                static_cast<uint32_t>(block[i * 4 + 3]);
  }
  for (int i = 16; i < 64; ++i) {
    const uint32_t s0 = Rotr(w[static_cast<size_t>(i - 15)], 7) ^
                        Rotr(w[static_cast<size_t>(i - 15)], 18) ^
                        (w[static_cast<size_t>(i - 15)] >> 3);
    const uint32_t s1 = Rotr(w[static_cast<size_t>(i - 2)], 17) ^
                        Rotr(w[static_cast<size_t>(i - 2)], 19) ^
                        (w[static_cast<size_t>(i - 2)] >> 10);
    w[static_cast<size_t>(i)] = w[static_cast<size_t>(i - 16)] + s0 +
                                w[static_cast<size_t>(i - 7)] + s1;
  }

  uint32_t a = state[0];
  uint32_t b = state[1];
  uint32_t c = state[2];
  uint32_t d = state[3];
  uint32_t e = state[4];
  uint32_t f = state[5];
  uint32_t g = state[6];
  uint32_t h = state[7];

  for (int i = 0; i < 64; ++i) {
    const uint32_t s1 = Rotr(e, 6) ^ Rotr(e, 11) ^ Rotr(e, 25);
    const uint32_t ch = (e & f) ^ (~e & g);
    const uint32_t t1 = h + s1 + ch + kRoundConstants[static_cast<size_t>(i)] +
                        w[static_cast<size_t>(i)];
    const uint32_t s0 = Rotr(a, 2) ^ Rotr(a, 13) ^ Rotr(a, 22);
    const uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
    const uint32_t t2 = s0 + maj;
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }

  state[0] += a;
  state[1] += b;
  state[2] += c;
  state[3] += d;
  state[4] += e;
  state[5] += f;
  state[6] += g;
  state[7] += h;
}

}  // namespace

std::string Sha256Hex(const uint8_t* data, size_t size) {
  std::array<uint32_t, 8> state = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                                   0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};

  // Pad to a multiple of 64 bytes: the message, one 0x80 byte, zeros, then the
  // 64-bit big-endian bit length. Held as at most two blocks of bookkeeping.
  const size_t full_blocks = size / 64;
  for (size_t i = 0; i < full_blocks; ++i) CompressBlock(data + i * 64, state);

  const size_t remainder = size - full_blocks * 64;
  uint8_t tail[128] = {};
  // memcpy with a null source is UB even for length zero (Sha256Hex(nullptr,
  // 0) hashes the empty input), hence the guard.
  if (remainder > 0) std::memcpy(tail, data + full_blocks * 64, remainder);
  tail[remainder] = 0x80;
  const size_t tail_len = remainder <= 55 ? 64 : 128;
  const uint64_t bits = static_cast<uint64_t>(size) * 8u;
  for (int i = 0; i < 8; ++i) {
    tail[tail_len - 1 - i] = static_cast<uint8_t>((bits >> (8 * i)) & 0xFFu);
  }
  CompressBlock(tail, state);
  if (tail_len == 128) CompressBlock(tail + 64, state);

  static const char* kHexDigits = "0123456789abcdef";
  std::string out;
  out.reserve(64);
  for (const uint32_t word : state) {
    for (int shift = 28; shift >= 0; shift -= 4) {
      out.push_back(kHexDigits[(word >> shift) & 0xFu]);
    }
  }
  return out;
}

}  // namespace nam_studio::state
