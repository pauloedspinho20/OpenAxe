#include "openaxe/backing_player.h"

#include <algorithm>
#include <cmath>

#include "signalsmith-stretch/signalsmith-stretch.h"

namespace openaxe::player {

namespace {

// Largest input/output frame ratio Render ever asks of the stretcher: top
// speed times a generous source/engine rate mismatch (e.g. 96 kHz file on a
// 48 kHz device). Beyond it the effective rate is clamped (plays slower than
// asked rather than allocating on the audio thread).
constexpr double kMaxRatio = 8.0;
// Play/pause fade, so starting and stopping never clicks.
constexpr double kFadeSeconds = 0.012;
constexpr float kInt16Scale = 1.0f / 32768.0f;

}  // namespace

class Stretcher {
 public:
  // Explicit seed: the default constructor seeds from std::random_device,
  // which in WASM needs `crypto` - absent in AudioWorkletGlobalScope, where it
  // throws and takes the whole rig worklet down. A fixed seed is also what
  // keeps renders deterministic for tests.
  signalsmith::stretch::SignalsmithStretch<float> s{0x0A7E5EEDL};
};

BackingPlayer::BackingPlayer() : stretch_(std::make_unique<Stretcher>()) {}
BackingPlayer::~BackingPlayer() = default;

void BackingPlayer::Reset(double sample_rate, int max_block_size) {
  if (!(sample_rate > 0.0) || max_block_size <= 0) return;
  sample_rate_ = sample_rate;
  max_block_ = max_block_size;
  // splitComputation spreads each STFT hop's work across the blocks of the
  // following interval instead of doing it all in the block where the hop
  // lands: same average cost, but the worst 128-frame block drops from ~1/3
  // of its budget to a few percent, which is what matters next to the amp
  // models in one audio callback. It costs one extra interval of latency,
  // which the position report already compensates.
#if defined(__EMSCRIPTEN__)
  // The WASM build has no SIMD FFT; the cheaper preset (shorter block, larger
  // hop) keeps the worklet comfortably inside its render quantum.
  stretch_->s.presetCheaper(2, static_cast<float>(sample_rate), true);
#else
  stretch_->s.presetDefault(2, static_cast<float>(sample_rate), true);
#endif
  const int prime_max = stretch_->s.inputLatency() +
                        static_cast<int>(std::ceil(kMaxRatio * stretch_->s.outputLatency()));
  const int in_cap = std::max(static_cast<int>(std::ceil(max_block_size * kMaxRatio)), prime_max) + 16;
  for (int c = 0; c < 2; ++c) {
    in_[c].assign(static_cast<size_t>(in_cap), 0.0f);
    out_[c].assign(static_cast<size_t>(max_block_size), 0.0f);
  }
  // Force the next Render to re-prime the stretcher at the audible position.
  stretching_ = false;
  applied_semitones_ = 0.0f;
  applied_factor_ = 1.0;
  in_accum_ = 0.0;
  read_pos_ = static_cast<double>(position_.load(std::memory_order_relaxed));
  gain_ = 0.0f;
}

bool BackingPlayer::LoadBegin(int64_t frames, int channels, double source_rate) {
  if (frames <= 0 || frames > kMaxFrames || (channels != 1 && channels != 2) ||
      !(source_rate >= 8000.0 && source_rate <= 384000.0)) {
    return false;
  }
  ready_.store(false, std::memory_order_release);
  playing_.store(false, std::memory_order_relaxed);
  pcm_.assign(static_cast<size_t>(frames) * static_cast<size_t>(channels), 0);
  frames_ = frames;
  channels_ = channels;
  source_rate_ = source_rate;
  loading_ = true;
  return true;
}

int64_t BackingPlayer::LoadWrite(int64_t offset, const float* interleaved, int64_t count) {
  if (!loading_ || interleaved == nullptr || offset < 0 || count <= 0 || offset >= frames_) return 0;
  const int64_t n = std::min(count, frames_ - offset);
  int16_t* dst = pcm_.data() + offset * channels_;
  const int64_t samples = n * channels_;
  for (int64_t i = 0; i < samples; ++i) {
    const float v = std::clamp(interleaved[i], -1.0f, 1.0f);
    dst[i] = static_cast<int16_t>(std::lrint(v * 32767.0f));
  }
  return n;
}

bool BackingPlayer::LoadEnd() {
  if (!loading_) return false;
  loading_ = false;
  loop_enabled_.store(false, std::memory_order_relaxed);
  loop_start_.store(0, std::memory_order_relaxed);
  loop_end_.store(0, std::memory_order_relaxed);
  position_.store(0, std::memory_order_relaxed);
  seek_request_.store(0, std::memory_order_relaxed);
  ready_.store(true, std::memory_order_release);
  return true;
}

void BackingPlayer::Unload() {
  ready_.store(false, std::memory_order_release);
  playing_.store(false, std::memory_order_relaxed);
  loading_ = false;
  std::vector<int16_t>().swap(pcm_);
  frames_ = 0;
  position_.store(0, std::memory_order_relaxed);
  meter_.store(0.0f, std::memory_order_relaxed);
}

void BackingPlayer::Play() {
  if (!HasTrack()) return;
  // Restart from the top when play is pressed at the very end.
  if (Position() >= frames_ && !LoopEnabled()) Seek(0);
  playing_.store(true, std::memory_order_relaxed);
}

void BackingPlayer::Pause() { playing_.store(false, std::memory_order_relaxed); }

void BackingPlayer::Seek(int64_t frame) {
  const int64_t len = LengthFrames();
  const int64_t clamped = std::clamp<int64_t>(frame, 0, std::max<int64_t>(0, len));
  position_.store(clamped, std::memory_order_relaxed);
  seek_request_.store(clamped, std::memory_order_relaxed);
}

void BackingPlayer::SetSpeed(float speed) {
  if (!std::isfinite(speed)) return;
  speed_.store(std::clamp(speed, kMinSpeed, kMaxSpeed), std::memory_order_relaxed);
}

void BackingPlayer::SetSemitones(float semitones) {
  if (!std::isfinite(semitones)) return;
  semitones_.store(std::clamp(semitones, kMinSemitones, kMaxSemitones), std::memory_order_relaxed);
}

void BackingPlayer::SetVolume(float volume) {
  if (!std::isfinite(volume)) return;
  volume_.store(std::clamp(volume, 0.0f, kMaxVolume), std::memory_order_relaxed);
}

void BackingPlayer::SetLoop(int64_t start, int64_t end, bool enabled) {
  loop_start_.store(std::max<int64_t>(0, start), std::memory_order_relaxed);
  loop_end_.store(std::max<int64_t>(0, end), std::memory_order_relaxed);
  loop_enabled_.store(enabled, std::memory_order_relaxed);
}

float BackingPlayer::Sample(int64_t frame, int channel) const {
  const int c = channels_ == 1 ? 0 : channel;
  return static_cast<float>(pcm_[static_cast<size_t>(frame * channels_ + c)]) * kInt16Scale;
}

void BackingPlayer::FillInput(int count) {
  const bool loop = loop_enabled_.load(std::memory_order_relaxed);
  const int64_t ls = loop_start_.load(std::memory_order_relaxed);
  const int64_t le = std::min(loop_end_.load(std::memory_order_relaxed), frames_);
  const bool looping = loop && le > ls;
  auto pos = static_cast<int64_t>(read_pos_);
  for (int i = 0; i < count; ++i) {
    if (looping && pos >= le) pos = ls;
    if (pos >= 0 && pos < frames_) {
      in_[0][static_cast<size_t>(i)] = Sample(pos, 0);
      in_[1][static_cast<size_t>(i)] = Sample(pos, 1);
    } else {
      in_[0][static_cast<size_t>(i)] = 0.0f;
      in_[1][static_cast<size_t>(i)] = 0.0f;
    }
    ++pos;
  }
  read_pos_ = static_cast<double>(pos);
}

void BackingPlayer::Prime(int64_t frame, double rate) {
  auto& s = stretch_->s;
  const int len = std::min(s.outputSeekLength(static_cast<float>(rate)),
                           static_cast<int>(in_[0].size()));
  read_pos_ = static_cast<double>(frame);
  FillInput(len);
  float* ins[2] = {in_[0].data(), in_[1].data()};
  s.outputSeek(ins, len);
  latency_frames_ = static_cast<double>(len);
  in_accum_ = 0.0;
}

void BackingPlayer::Render(float* const* output, int output_channels, int num_frames) {
  if (output == nullptr || output_channels <= 0 || num_frames <= 0) return;
  if (!ready_.load(std::memory_order_acquire) || max_block_ <= 0) {
    meter_.store(0.0f, std::memory_order_relaxed);
    return;
  }
  num_frames = std::min(num_frames, max_block_);

  const double src_ratio = source_rate_ / sample_rate_;
  const double speed = speed_.load(std::memory_order_relaxed);
  const double rate = std::min(speed * src_ratio, kMaxRatio);
  const float semis = semitones_.load(std::memory_order_relaxed);
  const bool want_stretch = std::abs(speed - 1.0) > 1e-4 || std::abs(semis) > 1e-3 ||
                            std::abs(src_ratio - 1.0) > 1e-6;

  const int64_t seek = seek_request_.exchange(-1, std::memory_order_relaxed);
  if (seek >= 0) {
    tail_left_ = 0;
    if (want_stretch) {
      Prime(seek, rate);
      stretching_ = true;
    } else {
      read_pos_ = static_cast<double>(seek);
      stretching_ = false;
    }
  }

  const bool playing = playing_.load(std::memory_order_relaxed);
  const float target = playing ? volume_.load(std::memory_order_relaxed) : 0.0f;
  if (!playing && gain_ <= 0.0f) {
    meter_.store(0.0f, std::memory_order_relaxed);
    return;  // paused and faded out: the transport holds still
  }

  // Bypass <-> stretch transitions re-anchor at the audible position.
  const auto audible = [&]() {
    const double p = stretching_ ? read_pos_ - latency_frames_ : read_pos_;
    return static_cast<int64_t>(std::max(0.0, p));
  };
  if (want_stretch != stretching_) {
    const int64_t at = audible();
    if (want_stretch) {
      Prime(at, rate);
    } else {
      read_pos_ = static_cast<double>(at);
    }
    stretching_ = want_stretch;
  }

  float* outs[2] = {out_[0].data(), out_[1].data()};
  if (stretching_) {
    const double factor = std::pow(2.0, static_cast<double>(semis) / 12.0) * src_ratio;
    if (factor != applied_factor_ || semis != applied_semitones_) {
      stretch_->s.setTransposeFactor(static_cast<float>(factor));
      applied_factor_ = factor;
      applied_semitones_ = semis;
    }
    in_accum_ += rate * num_frames;
    int need = static_cast<int>(in_accum_);
    in_accum_ -= need;
    need = std::min(need, static_cast<int>(in_[0].size()));
    FillInput(need);
    float* ins[2] = {in_[0].data(), in_[1].data()};
    stretch_->s.process(ins, need, outs, num_frames);
    latency_frames_ = stretch_->s.outputSeekLength(static_cast<float>(rate));
  } else {
    FillInput(num_frames);
    std::copy_n(in_[0].data(), num_frames, out_[0].data());
    std::copy_n(in_[1].data(), num_frames, out_[1].data());
  }

  // End of track (no loop): let the stretcher's tail drain, then stop.
  const bool loop = loop_enabled_.load(std::memory_order_relaxed) &&
                    loop_end_.load(std::memory_order_relaxed) > loop_start_.load(std::memory_order_relaxed);
  bool ended = false;
  if (!loop && read_pos_ >= static_cast<double>(frames_)) {
    if (!stretching_) {
      playing_.store(false, std::memory_order_relaxed);
      gain_ = 0.0f;
      ended = true;
    } else {
      if (tail_left_ <= 0) tail_left_ = stretch_->s.outputLatency() + 1;
      tail_left_ -= num_frames;
      if (tail_left_ <= 0) {
        playing_.store(false, std::memory_order_relaxed);
        gain_ = 0.0f;
        ended = true;
      }
    }
  }

  if (ended) {
    // The track (and, when stretching, its tail) is done: stop at the end.
    in_accum_ = 0.0;
    meter_.store(0.0f, std::memory_order_relaxed);
    position_.store(frames_, std::memory_order_relaxed);
    return;
  }

  // Gain ramp + mix into the output.
  const float step = static_cast<float>(1.0 / (kFadeSeconds * sample_rate_));
  float peak = 0.0f;
  float g = gain_;
  for (int i = 0; i < num_frames; ++i) {
    if (g < target) {
      g = std::min(target, g + step);
    } else if (g > target) {
      g = std::max(target, g - step);
    }
    const float l = out_[0][static_cast<size_t>(i)] * g;
    const float r = out_[1][static_cast<size_t>(i)] * g;
    peak = std::max(peak, std::max(std::abs(l), std::abs(r)));
    if (output_channels == 1) {
      output[0][i] += 0.5f * (l + r);
    } else {
      output[0][i] += l;
      output[1][i] += r;
    }
  }
  gain_ = g;
  meter_.store(peak, std::memory_order_relaxed);

  int64_t pos = std::min(audible(), frames_);
  if (loop) {
    // Just after a wrap the latency-compensated position can land before the
    // loop start; fold it back to the end of the loop it is still playing.
    const int64_t ls = loop_start_.load(std::memory_order_relaxed);
    const int64_t le = std::min(loop_end_.load(std::memory_order_relaxed), frames_);
    if (pos < ls && le > ls && static_cast<double>(pos) < read_pos_) {
      pos = std::max(ls, le - (ls - pos));
    }
  }
  position_.store(seek_request_.load(std::memory_order_relaxed) >= 0
                      ? seek_request_.load(std::memory_order_relaxed)
                      : pos,
                  std::memory_order_relaxed);
}

}  // namespace openaxe::player
