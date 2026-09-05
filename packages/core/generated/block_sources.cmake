# GENERATED FILE - do not edit by hand.
# Produced by scripts/gen-param-schema.mjs --target=effects from packages/core/effects.config.json.
#
# Included by packages/core/CMakeLists.txt. A block with compiled:false has
# its source omitted here entirely - it is never handed to the compiler, which
# is the whole point of the config.
#
# Omitted by effects.config.json: ring-mod, granular-delay, filter, pitch-shifter

set(OPENAXE_BLOCK_SOURCES
  src/dsp/noise_gate.cpp
  src/dsp/compressor.cpp
  src/dsp/equalizer.cpp
  src/dsp/chorus.cpp
  src/dsp/flanger.cpp
  src/dsp/phaser.cpp
  src/dsp/tremolo.cpp
  src/dsp/delay.cpp
  src/dsp/spring_reverb.cpp
  src/dsp/rotary.cpp
)

# The four Dragonfly algorithms are separate targets with their own include
# paths and a C++14 override, so the reverb kind gates the whole group.
set(OPENAXE_DRAGONFLY_ENABLED ON)

# One flag per kind, mirroring enabled_blocks.h's macros - tests/CMakeLists.txt
# gates each effect's test target on its own flag.
set(OPENAXE_BLOCK_NOISE_GATE ON)
set(OPENAXE_BLOCK_COMPRESSOR ON)
set(OPENAXE_BLOCK_EQ ON)
set(OPENAXE_BLOCK_CHORUS ON)
set(OPENAXE_BLOCK_FLANGER ON)
set(OPENAXE_BLOCK_PHASER ON)
set(OPENAXE_BLOCK_TREMOLO ON)
set(OPENAXE_BLOCK_DELAY ON)
set(OPENAXE_BLOCK_REVERB ON)
set(OPENAXE_BLOCK_RING_MOD OFF)
set(OPENAXE_BLOCK_GRANULAR_DELAY OFF)
set(OPENAXE_BLOCK_FILTER OFF)
set(OPENAXE_BLOCK_PITCH_SHIFTER OFF)
set(OPENAXE_BLOCK_ROTARY ON)
set(OPENAXE_BLOCK_AMP ON)
set(OPENAXE_BLOCK_AMP_CAB ON)
set(OPENAXE_BLOCK_PEDAL ON)
set(OPENAXE_BLOCK_OUTBOARD ON)
set(OPENAXE_BLOCK_SPACE ON)
set(OPENAXE_BLOCK_CAB ON)
set(OPENAXE_BLOCK_MIXER ON)
set(OPENAXE_BLOCK_SEND_1 ON)
set(OPENAXE_BLOCK_RETURN_1 ON)
set(OPENAXE_BLOCK_SEND_2 ON)
set(OPENAXE_BLOCK_RETURN_2 ON)
