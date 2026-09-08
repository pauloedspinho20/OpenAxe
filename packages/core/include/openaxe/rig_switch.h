#pragma once

#include <cstdint>
#include <memory>

#include "openaxe/engine.h"

// Gapless A/B rig switching (issue #367). A RigSwitch sits beside one live
// AudioEngine (owned by the OpenAxeGraph wrapper in api.cpp, which keeps
// owning the live engine itself) and orchestrates staged commits:
//
//   1. The front end builds the next rig into a separate AudioEngine using
//      the ordinary Tier-2 calls (add blocks, load models, connect, reset).
//      That engine is never processed before the commit, so staging needs no
//      audio suspension - on desktop it can even run on a background thread
//      while audio keeps playing.
//   2. Commit() publishes the staged engine with a single atomic store.
//      Process() picks it up at the top of the next buffer, rotates the old
//      engine into a drain slot, and crossfades old->new (equal-power, via
//      dspark::Crossfade) while the old engine's input is faded to silence.
//      After the fade the old engine keeps rendering with silent input so
//      reverb/delay tails ring out naturally under the new rig, mixed back
//      in with a short ramp and retired with a short fade-out - never a cut.
//   3. Retired engines are never freed on the audio thread: Process() parks
//      them in a garbage ring the control thread reclaims (Reclaim, called
//      from Commit/Clear/the destructor).
//
// Threading: Commit/Reclaim/Clear are control-thread calls. Commit is
// lock-free with respect to Process() - it only does atomic stores plus work
// on engines Process() cannot reach yet - but it must be serialized against
// other control-thread calls (other Commits, Clear, Reset on the live
// engine), like every Tier-2 call. At most one commit may be in flight:
// Commit fails (returns false, staged engine unconsumed) while a previous
// switch is still fading/draining. Process() itself is real-time safe:
// after pickup it allocates nothing, takes no locks, and frees nothing.
namespace openaxe::switcher {

class RigSwitch {
 public:
  RigSwitch();
  ~RigSwitch();
  RigSwitch(const RigSwitch&) = delete;
  RigSwitch& operator=(const RigSwitch&) = delete;

  // Publish `staged` as the next live engine. The current live engine's
  // session-level state (master bus, tuner mute, automation slots, MIDI
  // mappings) is carried onto `staged` first - see
  // AudioEngine::ImportSessionStateFrom. Scratch is (re)allocated here on
  // the control thread, sized for max_block_size frames. Returns false (and
  // leaves `staged` untouched) when arguments are invalid or a previous
  // switch is still in flight.
  bool Commit(std::unique_ptr<engine::AudioEngine>& staged, double sample_rate,
              int max_block_size, int fade_ms, int drain_ms);

  // Real-time safe. Runs the live engine every buffer; while a switch is in
  // flight it additionally runs the retiring engine and mixes the two as
  // described above.
  void Process(const float* const* input, int input_channels, float* const* output,
               int output_channels, int num_frames);

  // True while a fade or tail drain is in flight (for UI/tests).
  bool Active() const;

  // The current live engine for Tier-1 routing (atomic load - always
  // dereferenceable; see the ownership comment in rig_switch.cpp).
  engine::AudioEngine* Current() const;

  // Control thread: an engine for the next staged build - a retired engine
  // from the freelist when one is waiting (topology cleared, ready to
  // rebuild), otherwise a fresh one. Reclaims parked garbage first, so
  // repeated switches never accumulate engines.
  std::unique_ptr<engine::AudioEngine> TakeStagedEngine();

  // Control thread: delete every retired engine parked in the garbage ring.
  void Reclaim();

  // Control thread, Tier-2 context only (no Process() in flight): abandon a
  // pending commit and any in-flight switch, free all scratch/retired state.
  void Clear();

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace openaxe::switcher
