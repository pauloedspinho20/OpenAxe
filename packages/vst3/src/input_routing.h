#pragma once

#include <string>

namespace openaxe_vst3 {

// Which of the host's input channels actually feed the rig.
//
// A plugin sits on a track whose input bus is usually stereo, but a guitar is
// one cable: it arrives on one side, and the other side is either silence or
// a second instrument. Feeding the pair in as-is means the rig processes a
// half-silent stereo signal, which is not what the player wants and is not
// what the web app does either.
//
// These mirror the web's modes exactly (see buildChannelRouter in
// apps/web/src/hooks/useAudioEngine.ts), so the same choice means the same
// thing in a browser tab and in a DAW:
//
//   kStereo — pass the bus through untouched.
//   kLeft   — channel 1 only, as mono.
//   kRight  — channel 2 only, as mono.
//   kSum    — both channels averaged to mono.
//
// "As mono" means one channel handed to openaxe_process, which the core
// documents as duplicating to both of its internal channels — the same result
// the web gets by downmixing to a one-channel node.
enum class InputChannelMode { kStereo = 0, kLeft = 1, kRight = 2, kSum = 3 };

// Name <-> mode, using the same short strings the UI's ioStore already
// persists ('stereo' | 'l' | 'r' | 'sum'), so nothing has to translate.
// An unknown name is kStereo: a state chunk written by a newer build must
// degrade to the passthrough rather than to silence.
InputChannelMode InputChannelModeFromName(const std::string& name);
const char* InputChannelModeName(InputChannelMode mode);

// Picks which of `channels` to hand the core, writing up to 2 pointers into
// `out` and returning how many. `channels` are this plugin's own scratch
// buffers, so kSum is free to average into channel 0 in place.
//
// Real-time safe: no allocation, no locking, no branching on anything but the
// mode. Returns 0 when there is no usable input, which the caller should treat
// as "process silence" rather than as an error.
int RouteInput(InputChannelMode mode, float* const* channels, int channel_count, int frames,
               const float** out);

// The choice rides the host's state chunk, not the shared on-disk store: it
// describes how *this* track is wired, so two instances in one project can
// legitimately differ, and a project opened on another machine should keep
// the routing it was mixed with. Mirrors editor::SizeToStateJson's approach
// of splicing one field into the rig document rather than inventing a second
// chunk. A document without the field reads back as kStereo.
std::string InputChannelToStateJson(InputChannelMode mode, const std::string& base_json);
InputChannelMode InputChannelFromStateJson(const std::string& json);

}  // namespace openaxe_vst3
