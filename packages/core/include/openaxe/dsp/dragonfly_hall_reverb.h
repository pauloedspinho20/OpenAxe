#pragma once

// Note: this file (and dragonfly_hall_reverb.cpp) is compiled at C++14 -
// see CMakeLists.txt - so it avoids the C++17 nested-namespace shorthand
// used elsewhere in this codebase.
namespace openaxe {
namespace dsp {

// Wraps Dragonfly Reverb's hall-style algorithm (DragonflyReverbDSP),
// exposing its full 18-parameter surface: dry/early/late levels, room
// size/width, predelay, diffusion, low/high cut+crossover+multiplier,
// modulation spin/wander, decay time, and early-reflections send. This
// replaces the app's current basic Freeverb effect with a modulated,
// frequency-dependent-decay algorithmic reverb.
//
// Unlike NamAmp/RTNeural, there's no external model file to load - the
// reverb algorithm itself is the "model," parameterized directly. Stereo
// only (Dragonfly's own DSP class processes left/right independently with
// shared parameters), matching how reverb is actually used.
//
// Implementation note: dragonfly_hall_reverb.cpp compiles the real
// DragonflyReverbDSP class (and all of freeverb3) inside an anonymous
// namespace, giving it internal linkage private to that one translation
// unit - Dragonfly's four reverb algorithms (hall/room/plate/early
// reflections) all define an identically-named DragonflyReverbDSP class,
// which would otherwise be a duplicate-symbol conflict the moment two of
// them were ever linked into the same final binary (e.g. a VST3 plugin
// offering all four). Because the real type is invisible outside its own
// .cpp, this header can't forward-declare it the normal way - hence the
// opaque `void*` below instead of `std::unique_ptr<DragonflyReverbDSP>`.
class DragonflyHallReverb {
 public:
  struct ParamInfo {
    const char* name;    // e.g. "Dry Level"
    const char* symbol;  // e.g. "dry_level" - stable machine-readable id
    float min_value;
    float max_value;
    const char* unit;  // e.g. "%", "Hz", "s", "ms", "m", "X"
  };

  DragonflyHallReverb();
  ~DragonflyHallReverb();
  DragonflyHallReverb(const DragonflyHallReverb&) = delete;
  DragonflyHallReverb& operator=(const DragonflyHallReverb&) = delete;

  // Updates the sample rate the reverb's internal delay lines/filters run
  // at. Not real-time safe. Safe to call at any time (cheaper than
  // reconstruction - preserves current parameter values).
  void Reset(double sample_rate);

  // Real-time safe. Stereo: input[0]/output[0] = left, input[1]/output[1]
  // = right. Internally self-chunks in 256-frame blocks, so num_frames may
  // be arbitrary.
  void Process(const float* const* input, float* const* output, int num_frames);

  // Silences the internal reverb tail immediately (e.g. on transport stop),
  // without discarding parameter values.
  void Mute();

  static int ParamCount();
  static const ParamInfo& GetParamInfo(int index);

  // Values are in each parameter's native range/unit (see GetParamInfo) -
  // e.g. dry/early/late levels are 0-100 (%), not normalized 0-1.
  float GetParam(int index) const;
  void SetParam(int index, float value);

 private:
  void* dsp_;  // owning pointer to an (anonymous namespace)::DragonflyReverbDSP*
};

}  // namespace dsp
}  // namespace openaxe
