#pragma once

#include <cstdint>

namespace nam_studio::dsp {

// Piano-roll note names, chromatic, starting at C.
inline constexpr const char* kNoteNames[12] = {
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};

struct DetectedNote {
  // e.g. "E", "A#" — no octave suffix, so it lines up with kNoteNames directly.
  const char* name = "A";
  int32_t octave = 4;
  // How far off the nearest note this frequency is, in cents (-50..50, 0 = dead on).
  int32_t cents = 0;
};

// Convert a frequency to the nearest note name/octave and how far off (in
// cents) it is — relative to a tunable A4 reference (concert pitch is 440Hz,
// but some players tune to 432/442 etc). Ported from
// apps/web/src/tuner/noteUtils.ts (issue #123) so every front end displays
// the same reading. `frequency` must be > 0; behaviour is undefined otherwise.
DetectedNote FrequencyToNote(float frequency, double reference_a4 = 440.0);

}  // namespace nam_studio::dsp
