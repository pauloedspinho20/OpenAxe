#include "nam_studio/dsp/note_utils.h"

#include <cmath>

namespace nam_studio::dsp {

DetectedNote FrequencyToNote(float frequency, double reference_a4) {
  const double midi_float = 69.0 + 12.0 * std::log2(static_cast<double>(frequency) / reference_a4);
  const int32_t midi = static_cast<int32_t>(std::round(midi_float));
  const int32_t cents = static_cast<int32_t>(std::round((midi_float - static_cast<double>(midi)) * 100.0));
  const int32_t index = ((midi % 12) + 12) % 12;
  const int32_t octave = static_cast<int32_t>(std::floor(static_cast<double>(midi) / 12.0)) - 1;
  DetectedNote note;
  note.name = kNoteNames[index];
  note.octave = octave;
  note.cents = cents;
  return note;
}

}  // namespace nam_studio::dsp
