// The IR convolution behind Cab blocks (dsp/convolver.cpp). The important test
// is parity with brute-force direct convolution: a partitioned FFT convolver has
// plenty of room for off-by-one errors in its delay line, and every one of them
// sounds like a comb filter rather than an obvious failure.
#include "nam_studio/dsp/convolver.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

#include "test_harness.h"

using nam_studio::dsp::Convolver;

namespace {

constexpr int kPartition = Convolver::kPartitionFrames;

// A deterministic pseudo-random sequence in [-1, 1) - no <random> so the
// expected values are identical on every platform and compiler.
struct Lcg {
  unsigned int state;
  float Next() {
    state = state * 1664525u + 1013904223u;
    return static_cast<float>(static_cast<int>(state >> 8) % 20000 - 10000) / 10000.0f;
  }
};

// y[n] = sum_k x[n-k] * ir[k], the definition the FFT version has to match.
std::vector<float> DirectConvolve(const std::vector<float>& input, const std::vector<float>& ir) {
  std::vector<float> out(input.size(), 0.0f);
  for (size_t n = 0; n < input.size(); ++n) {
    float sum = 0.0f;
    for (size_t k = 0; k < ir.size(); ++k) {
      if (k > n) break;
      sum += input[n - k] * ir[k];
    }
    out[n] = sum;
  }
  return out;
}

// Run `input` through the convolver in fixed-size blocks.
std::vector<float> RunBlocked(Convolver& conv, const std::vector<float>& input, int block) {
  std::vector<float> out = input;
  for (size_t offset = 0; offset < out.size(); offset += static_cast<size_t>(block)) {
    const int n = static_cast<int>(std::min(static_cast<size_t>(block), out.size() - offset));
    conv.Process(out.data() + offset, n);
  }
  return out;
}

// The core guarantee: for any IR length and any partition-aligned block size,
// the output equals direct convolution.
void TestMatchesDirectConvolution() {
  Lcg rng{12345};
  for (const int ir_length : {1, 7, 63, 64, 65, 128, 200, 1024, 2048, 4096}) {
    std::vector<float> ir(static_cast<size_t>(ir_length));
    for (float& sample : ir) sample = rng.Next();

    std::vector<float> input(4096);
    for (float& sample : input) sample = rng.Next();

    const std::vector<float> expected = DirectConvolve(input, ir);

    for (const int block : {1, 17, 64, 100, 128, 256, 512}) {
      Convolver conv;
      conv.SetImpulseResponse(ir.data(), ir_length);
      NAM_EXPECT(conv.HasImpulseResponse());
      NAM_EXPECT(conv.ImpulseResponseLength() == ir_length);
      NAM_EXPECT(conv.LatencyFrames() == 0);

      const std::vector<float> actual = RunBlocked(conv, input, block);
      NAM_EXPECT(conv.LatencyFrames() == 0);  // still aligned afterwards

      double worst = 0.0;
      for (size_t i = 0; i < expected.size(); ++i) {
        worst = std::max(worst, std::fabs(static_cast<double>(actual[i] - expected[i])));
      }
      // Float FFT round-trip error over a 4096-tap IR; a real indexing bug shows
      // up orders of magnitude above this.
      if (worst >= 2e-3) {
        std::printf("  ir_length=%d block=%d worst error %.6f\n", ir_length, block, worst);
      }
      NAM_EXPECT(worst < 2e-3);
    }
  }
}

// An impulse in, IR out - the most human-readable check that taps aren't shifted.
void TestImpulseReproducesTheIr() {
  std::vector<float> ir(300);
  Lcg rng{999};
  for (float& sample : ir) sample = rng.Next();

  Convolver conv;
  conv.SetImpulseResponse(ir.data(), static_cast<int>(ir.size()));

  std::vector<float> input(512, 0.0f);
  input[0] = 1.0f;
  const std::vector<float> out = RunBlocked(conv, input, 128);

  for (size_t i = 0; i < ir.size(); ++i) NAM_EXPECT(std::fabs(out[i] - ir[i]) < 1e-4f);
  // Past the IR's length the output must fall silent, not keep ringing.
  for (size_t i = ir.size(); i < out.size(); ++i) NAM_EXPECT(std::fabs(out[i]) < 1e-4f);
}

// Convolution has to carry its tail across Process() calls - a block-local
// implementation would truncate every repeat at the block boundary.
void TestTailCrossesBlockBoundaries() {
  std::vector<float> ir(500, 0.0f);
  ir[0] = 1.0f;
  ir[499] = 0.5f;  // a single late reflection

  Convolver conv;
  conv.SetImpulseResponse(ir.data(), static_cast<int>(ir.size()));

  std::vector<float> input(1024, 0.0f);
  input[0] = 1.0f;
  const std::vector<float> out = RunBlocked(conv, input, 64);

  NAM_EXPECT(std::fabs(out[0] - 1.0f) < 1e-4f);
  NAM_EXPECT(std::fabs(out[499] - 0.5f) < 1e-4f);  // eight blocks later
}

// Block sizes that aren't a multiple of the partition size must be just as
// correct and just as un-delayed. This is what the direct head buys: a
// single-part FFT scheme passes the aligned cases above and then either delays
// the stream or leaves a gap in it here.
void TestUnalignedBlockSizesAreExactAndUndelayed() {
  std::vector<float> ir(200);
  Lcg rng{4242};
  for (float& sample : ir) sample = rng.Next();

  std::vector<float> input(2048);
  for (float& sample : input) sample = rng.Next();
  const std::vector<float> expected = DirectConvolve(input, ir);

  Convolver conv;
  conv.SetImpulseResponse(ir.data(), static_cast<int>(ir.size()));
  const std::vector<float> actual = RunBlocked(conv, input, 100);  // not a multiple of 64

  // Find the shift that best explains the output, and assert it is under one
  // partition and consistent for the whole buffer.
  int best_shift = -1;
  double best_error = 1e9;
  for (int shift = 0; shift < kPartition; ++shift) {
    double worst = 0.0;
    for (size_t i = 0; i + static_cast<size_t>(shift) < expected.size() && i < 1500; ++i) {
      worst = std::max(worst,
                       std::fabs(static_cast<double>(actual[i + static_cast<size_t>(shift)] - expected[i])));
    }
    if (worst < best_error) {
      best_error = worst;
      best_shift = shift;
    }
  }
  NAM_EXPECT(best_error < 2e-3);
  NAM_EXPECT(best_shift == 0);  // zero latency, not merely a consistent delay
  NAM_EXPECT(conv.LatencyFrames() == 0);
  std::printf("  unaligned 100-frame blocks: shift %d samples, worst error %.6f\n", best_shift,
              best_error);
}

// No IR installed means untouched samples, not silence - a cab block with
// nothing loaded has to pass the guitar through.
void TestPassthroughWithoutIr() {
  Convolver conv;
  NAM_EXPECT(!conv.HasImpulseResponse());
  NAM_EXPECT(conv.ImpulseResponseLength() == 0);

  std::vector<float> input(128);
  for (int i = 0; i < 128; ++i) input[static_cast<size_t>(i)] = 0.01f * static_cast<float>(i);
  const std::vector<float> original = input;
  conv.Process(input.data(), 128);
  for (size_t i = 0; i < input.size(); ++i) NAM_EXPECT(input[i] == original[i]);

  // ...and clearing an installed IR restores passthrough.
  std::vector<float> ir(64, 0.5f);
  conv.SetImpulseResponse(ir.data(), 64);
  NAM_EXPECT(conv.HasImpulseResponse());
  conv.Clear();
  NAM_EXPECT(!conv.HasImpulseResponse());
  input = original;
  conv.Process(input.data(), 128);
  for (size_t i = 0; i < input.size(); ++i) NAM_EXPECT(input[i] == original[i]);
}

// ResetState drops the tail but keeps the IR, so a rewired graph can't leak the
// previous route's reverberation.
void TestResetStateDropsTailKeepsIr() {
  std::vector<float> ir(300, 0.0f);
  ir[0] = 1.0f;
  ir[200] = 1.0f;

  Convolver conv;
  conv.SetImpulseResponse(ir.data(), static_cast<int>(ir.size()));

  std::vector<float> burst(128, 0.0f);
  burst[0] = 1.0f;
  conv.Process(burst.data(), 128);

  conv.ResetState();
  NAM_EXPECT(conv.HasImpulseResponse());

  // The late reflection from the pre-reset impulse must not appear.
  std::vector<float> silence(256, 0.0f);
  conv.Process(silence.data(), 256);
  for (float sample : silence) NAM_EXPECT(std::fabs(sample) < 1e-5f);
}

// Degenerate inputs must not crash or produce NaN.
void TestEdgeCases() {
  Convolver conv;
  conv.SetImpulseResponse(nullptr, 100);   // no samples: stays cleared
  NAM_EXPECT(!conv.HasImpulseResponse());
  std::vector<float> ir(10, 1.0f);
  conv.SetImpulseResponse(ir.data(), 0);   // zero length: same
  NAM_EXPECT(!conv.HasImpulseResponse());

  conv.SetImpulseResponse(ir.data(), 10);
  conv.Process(nullptr, 128);              // must not crash
  std::vector<float> buffer(128, 1.0f);
  conv.Process(buffer.data(), 0);
  conv.Process(buffer.data(), 128);
  for (float sample : buffer) NAM_EXPECT(std::isfinite(sample));
}

}  // namespace

int main() {
  TestMatchesDirectConvolution();
  TestImpulseReproducesTheIr();
  TestTailCrossesBlockBoundaries();
  TestUnalignedBlockSizesAreExactAndUndelayed();
  TestPassthroughWithoutIr();
  TestResetStateDropsTailKeepsIr();
  TestEdgeCases();

  return nam_studio::test::g_failures == 0 ? 0 : 1;
}
