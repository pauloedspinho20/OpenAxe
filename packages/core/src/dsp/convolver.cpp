#include "nam_studio/dsp/convolver.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <complex>
#include <vector>

namespace nam_studio::dsp {

namespace {

// One partition of input plus one of IR occupies 2 * kPartitionFrames bins - the
// overlap-save frame size.
constexpr int kFftSize = Convolver::kPartitionFrames * 2;

using Complex = std::complex<float>;

// In-place iterative radix-2 Cooley-Tukey FFT over `data` (size must be a power
// of two). `inverse` runs the conjugate transform and scales by 1/N, so
// Inverse(Forward(x)) == x.
//
// Hand-written rather than vendored: it is 40 lines, the sizes here are fixed and
// tiny (128 bins), and it keeps packages/core free of another third-party
// dependency to license and build across four platforms.
void Transform(Complex* data, int size, bool inverse) {
  // Bit-reversal permutation, so the butterflies below can run in place.
  for (int i = 1, j = 0; i < size; ++i) {
    int bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) std::swap(data[i], data[j]);
  }

  for (int len = 2; len <= size; len <<= 1) {
    const float angle =
        (inverse ? 2.0f : -2.0f) * 3.14159265358979323846f / static_cast<float>(len);
    const Complex step(std::cos(angle), std::sin(angle));
    for (int i = 0; i < size; i += len) {
      Complex w(1.0f, 0.0f);
      for (int k = 0; k < len / 2; ++k) {
        const Complex a = data[i + k];
        const Complex b = data[i + k + len / 2] * w;
        data[i + k] = a + b;
        data[i + k + len / 2] = a - b;
        w *= step;
      }
    }
  }

  if (inverse) {
    const float scale = 1.0f / static_cast<float>(size);
    for (int i = 0; i < size; ++i) data[i] *= scale;
  }
}

}  // namespace

// Zero-latency partitioned convolution, in the standard two-part form:
//
//   * The first kPartitionFrames IR taps run as a plain time-domain FIR, sample
//     by sample. This is what makes the convolver zero-latency for *any* block
//     size: the newest output sample depends on the newest input sample, and a
//     block-based FFT can never provide that.
//   * Taps beyond that are partitioned and convolved by FFT. Their contribution
//     to any output sample only involves input from at least kPartitionFrames
//     samples ago, so a whole partition of it can be computed in advance at each
//     partition boundary and simply added in as samples are produced.
//
// A single-part FFT scheme (no direct head) is cheaper to write but only works
// when every block is a multiple of the partition size; anything else either
// delays the stream or - worse - leaves a gap in it.
struct Convolver::Impl {
  // Direct part: the first taps, with a circular history of the same length.
  std::vector<float> head_taps;
  std::array<float, Convolver::kPartitionFrames> head_history{};
  int head_write = 0;  // next slot to overwrite; also "now" in the history

  // FFT part: one spectrum per IR partition from tap kPartitionFrames onward.
  std::vector<std::vector<Complex>> ir_spectra;
  // Ring of recent input spectra, one slot per IR partition (at least one).
  std::vector<std::vector<Complex>> input_spectra;
  int ring_head = 0;  // slot holding the most recently transformed partition

  // [previous partition | current partition], the overlap-save input frame.
  std::vector<float> input_frame;
  int pos = 0;  // samples filled into the current partition, 0..kPartitionFrames

  // FFT contribution for the partition currently being output, precomputed at
  // the previous partition boundary.
  std::array<float, Convolver::kPartitionFrames> tail{};

  std::vector<Complex> scratch;      // kFftSize
  std::vector<Complex> accumulator;  // kFftSize
  int ir_length = 0;

  // Transform the partition just filled and precompute the next partition's FFT
  // contribution. Called exactly at partition boundaries.
  void CrossPartitionBoundary() {
    if (!ir_spectra.empty()) {
      for (int i = 0; i < kFftSize; ++i) {
        scratch[static_cast<size_t>(i)] = Complex(input_frame[static_cast<size_t>(i)], 0.0f);
      }
      Transform(scratch.data(), kFftSize, false);
      ring_head = (ring_head + 1) % static_cast<int>(input_spectra.size());
      input_spectra[static_cast<size_t>(ring_head)] = scratch;

      // Partition k of the IR (taps (k+1)*P .. (k+2)*P-1) pairs with the input
      // partition from k steps back: the frequency-domain delay line.
      std::fill(accumulator.begin(), accumulator.end(), Complex(0.0f, 0.0f));
      const int partitions = static_cast<int>(ir_spectra.size());
      for (int k = 0; k < partitions; ++k) {
        const int slot = ((ring_head - k) % partitions + partitions) % partitions;
        const auto& x = input_spectra[static_cast<size_t>(slot)];
        const auto& h = ir_spectra[static_cast<size_t>(k)];
        for (int bin = 0; bin < kFftSize; ++bin) {
          accumulator[static_cast<size_t>(bin)] +=
              x[static_cast<size_t>(bin)] * h[static_cast<size_t>(bin)];
        }
      }
      Transform(accumulator.data(), kFftSize, true);

      // Overlap-save: the second half is the linear-convolution part, which is
      // exactly the next partition's contribution.
      for (int i = 0; i < Convolver::kPartitionFrames; ++i) {
        tail[static_cast<size_t>(i)] =
            accumulator[static_cast<size_t>(Convolver::kPartitionFrames + i)].real();
      }
    }

    // This partition becomes the "previous" half of the next frame.
    std::copy_n(input_frame.begin() + Convolver::kPartitionFrames, Convolver::kPartitionFrames,
                input_frame.begin());
    pos = 0;
  }

  // One sample through both parts.
  float ProcessSample(float x) {
    head_history[static_cast<size_t>(head_write)] = x;
    input_frame[static_cast<size_t>(Convolver::kPartitionFrames + pos)] = x;

    float sum = tail[static_cast<size_t>(pos)];
    const int taps = static_cast<int>(head_taps.size());
    for (int j = 0; j < taps; ++j) {
      int index = head_write - j;
      if (index < 0) index += Convolver::kPartitionFrames;
      sum += head_taps[static_cast<size_t>(j)] * head_history[static_cast<size_t>(index)];
    }

    head_write = (head_write + 1) % Convolver::kPartitionFrames;
    if (++pos == Convolver::kPartitionFrames) CrossPartitionBoundary();
    return sum;
  }
};

Convolver::Convolver() : impl_(std::make_unique<Impl>()) {
  impl_->input_frame.assign(kFftSize, 0.0f);
  impl_->scratch.assign(kFftSize, Complex(0.0f, 0.0f));
  impl_->accumulator.assign(kFftSize, Complex(0.0f, 0.0f));
}

Convolver::~Convolver() = default;

// Split the IR into its direct head and its FFT partitions, transforming each
// partition once here so Process() only ever multiplies spectra. Zero-padding the
// second half of every partition is what keeps the per-partition products linear
// rather than circular convolutions.
void Convolver::SetImpulseResponse(const float* samples, int length) {
  Clear();
  if (!samples || length <= 0) return;

  const int head = std::min(length, kPartitionFrames);
  impl_->head_taps.assign(samples, samples + head);

  const int remaining = length - head;
  const int partitions = (remaining + kPartitionFrames - 1) / kPartitionFrames;
  if (partitions > 0) {
    impl_->ir_spectra.resize(static_cast<size_t>(partitions));
    impl_->input_spectra.assign(static_cast<size_t>(partitions),
                                std::vector<Complex>(kFftSize, Complex(0.0f, 0.0f)));
    std::vector<Complex> block(kFftSize);
    for (int k = 0; k < partitions; ++k) {
      std::fill(block.begin(), block.end(), Complex(0.0f, 0.0f));
      const int offset = head + k * kPartitionFrames;
      const int count = std::min(kPartitionFrames, length - offset);
      for (int i = 0; i < count; ++i) {
        block[static_cast<size_t>(i)] = Complex(samples[offset + i], 0.0f);
      }
      Transform(block.data(), kFftSize, false);
      impl_->ir_spectra[static_cast<size_t>(k)] = block;
    }
  }
  impl_->ir_length = length;
}

bool Convolver::HasImpulseResponse() const { return impl_->ir_length > 0; }

int Convolver::ImpulseResponseLength() const { return impl_->ir_length; }

// Forget the IR entirely; Process becomes a passthrough again.
void Convolver::Clear() {
  impl_->head_taps.clear();
  impl_->ir_spectra.clear();
  impl_->input_spectra.clear();
  impl_->ir_length = 0;
  ResetState();
}

// Drop the tail and all buffered input, keeping the IR.
void Convolver::ResetState() {
  impl_->head_history.fill(0.0f);
  impl_->head_write = 0;
  std::fill(impl_->input_frame.begin(), impl_->input_frame.end(), 0.0f);
  for (auto& spectrum : impl_->input_spectra) {
    std::fill(spectrum.begin(), spectrum.end(), Complex(0.0f, 0.0f));
  }
  impl_->ring_head = 0;
  impl_->pos = 0;
  impl_->tail.fill(0.0f);
}

// Convolve in place, sample by sample. Passthrough while no IR is installed.
void Convolver::Process(float* samples, int num_frames) {
  if (!samples || num_frames <= 0 || impl_->ir_length == 0) return;
  for (int i = 0; i < num_frames; ++i) samples[i] = impl_->ProcessSample(samples[i]);
}

// Always zero: the direct head means the newest output sample never waits on a
// block boundary, whatever size the caller's blocks are.
int Convolver::LatencyFrames() const { return 0; }

}  // namespace nam_studio::dsp
