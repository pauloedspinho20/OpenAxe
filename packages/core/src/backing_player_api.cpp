// extern "C" forwarders for the backing-track player (issue #205) - see the
// "Backing-track player" section of api.h for the threading contract.
#include <new>

#include "openaxe/api.h"
#include "openaxe/backing_player.h"

struct OpenAxePlayer {
  openaxe::player::BackingPlayer player;
};

namespace {
openaxe::player::BackingPlayer* P(OpenAxePlayer* handle) {
  return handle != nullptr ? &handle->player : nullptr;
}
}  // namespace

extern "C" {

OpenAxePlayer* openaxe_player_create(void) { return new OpenAxePlayer(); }

void openaxe_player_destroy(OpenAxePlayer* player) { delete player; }

void openaxe_player_reset(OpenAxePlayer* player, double sample_rate, int32_t max_block_size) {
  if (auto* p = P(player)) p->Reset(sample_rate, max_block_size);
}

int32_t openaxe_player_load_begin(OpenAxePlayer* player, int32_t num_frames, int32_t num_channels,
                                  double source_rate) {
  auto* p = P(player);
  if (p == nullptr) return 0;
  try {
    return p->LoadBegin(num_frames, num_channels, source_rate) ? 1 : 0;
  } catch (const std::bad_alloc&) {
    return 0;
  }
}

int32_t openaxe_player_load_write(OpenAxePlayer* player, int32_t frame_offset,
                                  const float* interleaved, int32_t num_frames) {
  auto* p = P(player);
  return p != nullptr ? static_cast<int32_t>(p->LoadWrite(frame_offset, interleaved, num_frames)) : 0;
}

int32_t openaxe_player_load_end(OpenAxePlayer* player) {
  auto* p = P(player);
  return p != nullptr && p->LoadEnd() ? 1 : 0;
}

void openaxe_player_unload(OpenAxePlayer* player) {
  if (auto* p = P(player)) p->Unload();
}

int32_t openaxe_player_has_track(OpenAxePlayer* player) {
  auto* p = P(player);
  return p != nullptr && p->HasTrack() ? 1 : 0;
}

int32_t openaxe_player_length(OpenAxePlayer* player) {
  auto* p = P(player);
  return p != nullptr ? static_cast<int32_t>(p->LengthFrames()) : 0;
}

double openaxe_player_source_rate(OpenAxePlayer* player) {
  auto* p = P(player);
  return p != nullptr && p->HasTrack() ? p->SourceRate() : 0.0;
}

void openaxe_player_play(OpenAxePlayer* player) {
  if (auto* p = P(player)) p->Play();
}

void openaxe_player_pause(OpenAxePlayer* player) {
  if (auto* p = P(player)) p->Pause();
}

int32_t openaxe_player_is_playing(OpenAxePlayer* player) {
  auto* p = P(player);
  return p != nullptr && p->IsPlaying() ? 1 : 0;
}

void openaxe_player_seek(OpenAxePlayer* player, int32_t frame) {
  if (auto* p = P(player)) p->Seek(frame);
}

int32_t openaxe_player_position(OpenAxePlayer* player) {
  auto* p = P(player);
  return p != nullptr ? static_cast<int32_t>(p->Position()) : 0;
}

void openaxe_player_set_speed(OpenAxePlayer* player, float speed) {
  if (auto* p = P(player)) p->SetSpeed(speed);
}

void openaxe_player_set_semitones(OpenAxePlayer* player, float semitones) {
  if (auto* p = P(player)) p->SetSemitones(semitones);
}

void openaxe_player_set_volume(OpenAxePlayer* player, float volume) {
  if (auto* p = P(player)) p->SetVolume(volume);
}

void openaxe_player_set_loop(OpenAxePlayer* player, int32_t start_frame, int32_t end_frame,
                             int32_t enabled) {
  if (auto* p = P(player)) p->SetLoop(start_frame, end_frame, enabled != 0);
}

float openaxe_player_get_meter(OpenAxePlayer* player) {
  auto* p = P(player);
  return p != nullptr ? p->Meter() : 0.0f;
}

void openaxe_player_set_count_in(OpenAxePlayer* player, int32_t clicks, float interval_seconds,
                                 int32_t accent_every) {
  if (auto* p = P(player)) p->SetCountIn(clicks, interval_seconds, accent_every);
}

int32_t openaxe_player_is_counting(OpenAxePlayer* player) {
  auto* p = P(player);
  return p != nullptr && p->IsCounting() ? 1 : 0;
}

void openaxe_player_render(OpenAxePlayer* player, float* const* output, int32_t output_channels,
                           int32_t num_frames) {
  if (auto* p = P(player)) p->Render(output, output_channels, num_frames);
}

}  // extern "C"
