#include "openaxe/monitor_tap.h"

#include <algorithm>

namespace openaxe {

MonitorTap::MonitorTap() {
  // Allocated once here so Write() never touches the heap.
  for (auto& ch : in_) ch.assign(kCapacity, 0.0f);
  for (auto& ch : out_) ch.assign(kCapacity, 0.0f);
}

void MonitorTap::Write(const float* const* in, const float* const* out, unsigned int frames) {
  if (frames == 0) return;
  // More frames than the ring holds: only the tail is retained, so skip ahead
  // rather than wrapping repeatedly over ourselves.
  unsigned int offset = 0;
  if (frames > kCapacity) {
    offset = frames - kCapacity;
    frames = kCapacity;
  }

  seq_.fetch_add(1, std::memory_order_release);  // now odd: write in progress
  for (unsigned int i = 0; i < frames; ++i) {
    const unsigned int idx = (write_pos_ + i) % kCapacity;
    const unsigned int s = offset + i;
    if (in) {
      if (in[0]) in_[0][idx] = in[0][s];
      if (in[1]) in_[1][idx] = in[1][s];
    }
    if (out) {
      if (out[0]) out_[0][idx] = out[0][s];
      if (out[1]) out_[1][idx] = out[1][s];
    }
  }
  write_pos_ = (write_pos_ + frames) % kCapacity;
  count_ = std::min(kCapacity, count_ + frames);
  seq_.fetch_add(1, std::memory_order_release);  // even again: write complete
}

TapFrame MonitorTap::Read(bool input, unsigned int max_frames) const {
  const auto& src = input ? in_ : out_;
  TapFrame frame;
  for (;;) {
    const uint64_t s1 = seq_.load(std::memory_order_acquire);
    if (s1 & 1u) continue;  // writer mid-update
    const unsigned int write_pos = write_pos_;
    const unsigned int n = std::min({max_frames, count_, kCapacity});
    frame.l.resize(n);
    frame.r.resize(n);
    frame.frames = n;
    for (unsigned int i = 0; i < n; ++i) {
      // Oldest frame of the window is at write_pos - n; read forward.
      const unsigned int idx = (write_pos + kCapacity - n + i) % kCapacity;
      frame.l[i] = src[0][idx];
      frame.r[i] = src[1][idx];
    }
    if (seq_.load(std::memory_order_acquire) == s1) break;  // no tear
  }
  return frame;
}

void MonitorTap::Clear() {
  seq_.fetch_add(1, std::memory_order_release);
  count_ = 0;
  seq_.fetch_add(1, std::memory_order_release);
}

}  // namespace openaxe
