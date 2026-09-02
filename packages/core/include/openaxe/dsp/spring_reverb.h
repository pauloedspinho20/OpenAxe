#pragma once

#include <memory>

namespace openaxe::dsp {

// Spring tank reverb, a from-scratch C++ implementation of the classic
// spring-tank model (the Dattorro spring-reverb topology popularised by
// J. Dattorro's "Effect Design" papers, JAES 1997/2002). A real spring
// tank is a handful of helical springs driven by a transducer: the signal
// travels down each spring, bounces off the far end, and the resulting
// comb-filtered, dispersive reflections are picked up by output
// transducers. The audible signature is the "boing" - metallic, twangy,
// pitch-gliding echoes - quite unlike the diffuse, continuous decay of a
// hall/room/plate algorithmic reverb.
//
// This wrapper implements that model with four parallel delay lines (the
// springs) of incommensurate lengths per channel, each with:
//   - a one-pole damping lowpass in the feedback path (springs are lossy,
//     high frequencies die out faster), and
//   - an allpass dispersion stage (a spring is dispersive - the round-trip
//     time depends on frequency, which is what smears a transient into the
//     characteristic metallic "boing" rather than a clean echo).
// Each spring's input is scaled by sqrt(1 - feedback^2), so lengthening the
// decay does not also raise the level.
//
// The two channels run separate tanks - the right one's springs stretched by
// ~3% and its modulation LFO a quarter cycle behind - and tap them with
// complementary even/odd weights set by `width`. That asymmetry, not a
// cross-feed, is what gives a mono source a stereo image. An input-drive
// saturation stage adds the "crunch" a real transducer/spring-tank has at
// high levels.
//
// Process() is frame-outer: the pre-delay lines (one per channel) and the LFO
// advance exactly once per frame, so the output is bit-identical whatever
// block size the host renders in.
//
// Parameter surface mirrors the engine's ReverbControl abstraction where it
// can (decay/high_cut/width/predelay/spin/wander/dry_level), so the UI's
// roomSize/damping/width/predelay/spin/wander knobs map straight onto it;
// `drive` is spring-specific (the input saturation) and `early_send` does
// not exist because a spring tank has no early-reflection stage.
//
// Stereo, like every DSP wrapper here. Real-time safe after Reset(); Reset
// is the only allocating method.
class SpringReverb {
 public:
  struct ParamInfo {
    const char* name;
    const char* symbol;
    float min_value;
    float max_value;
    const char* unit;
  };

  SpringReverb();
  ~SpringReverb();
  SpringReverb(const SpringReverb&) = delete;
  SpringReverb& operator=(const SpringReverb&) = delete;

  // (Re)allocates the spring delay lines for the given sample rate. Must be
  // called at least once before Process(). Not real-time safe.
  void Reset(double sample_rate);

  // Real-time safe. input/output are planar stereo (input[0] = L, input[1] =
  // R). num_frames must be ≤ the max_block_size the engine was Reset() with.
  void Process(const float* const* input, float* const* output, int num_frames);

  // Silences the spring tails immediately (e.g. on transport stop) without
  // discarding parameter values. Real-time safe.
  void Mute();

  static int ParamCount();
  static const ParamInfo& GetParamInfo(int index);
  float GetParam(int index) const;
  void SetParam(int index, float value);

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace openaxe::dsp