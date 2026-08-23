#pragma once

#include <memory>

namespace openaxe::dsp {

// The 4-band tone stack every NAM-backed "gear" block carries, wired after the
// model the way a real amp's tone controls sit before the speaker: Bass (low
// shelf), Mid (peaking), Treble (high shelf), Presence (peaking), each ±12dB.
//
// Frequencies, Q values and ranges deliberately match the Web Audio
// BiquadFilterNode chain apps/web's AmpBlock used to own on its own
// (lowshelf 100Hz / peaking 1kHz Q0.7 / highshelf 5kHz / peaking 8kHz Q0.5), so
// moving the stack into the core doesn't change how the web app sounds - and so
// the desktop app and a future plugin, which had no tone stack at all, now match
// it. The filters are the standard RBJ cookbook forms, which is also what Web
// Audio implements.
//
// Real-time safety: Process and SetGainDb are both real-time safe (coefficient
// arithmetic, no allocation). Reset allocates nothing either but discards the
// filter history, so call it between blocks.
class ToneStack {
 public:
  enum class Band {
    kBass,
    kMid,
    kTreble,
    kPresence,
  };

  ToneStack();
  ~ToneStack();
  ToneStack(const ToneStack&) = delete;
  ToneStack& operator=(const ToneStack&) = delete;

  // Adopt a sample rate (every coefficient depends on it) and clear history.
  void Reset(double sample_rate);

  // Gain for one band in dB, clamped to ±12. 0 leaves that band flat, and a
  // stack with all four at 0 is bit-exact passthrough (Process returns early).
  void SetGainDb(Band band, float db);
  float GetGainDb(Band band) const;

  // Filter `num_frames` samples in place, mono. Mono because it sits directly
  // after the NAM model, which is itself mono - the engine duplicates to stereo
  // afterwards, exactly as the Web Audio chain did.
  void Process(float* samples, int num_frames);

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace openaxe::dsp
