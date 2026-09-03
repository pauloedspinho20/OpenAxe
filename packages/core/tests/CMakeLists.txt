add_executable(graph_validation_test graph_validation_test.cpp)
target_link_libraries(graph_validation_test PRIVATE openaxe_core)
add_test(NAME graph_validation_test COMMAND graph_validation_test)

# effects.config.json's invariants + the loader's drop-and-report path (#313).
# Plain C++ with no vendored dependency, like the graph tests.
add_executable(effects_config_test effects_config_test.cpp)
target_link_libraries(effects_config_test PRIVATE openaxe_core)
add_test(NAME effects_config_test COMMAND effects_config_test)

add_executable(graph_rig_test graph_rig_test.cpp)
target_link_libraries(graph_rig_test PRIVATE openaxe_core)
add_test(NAME graph_rig_test COMMAND graph_rig_test)

# The tone stack is plain DSP with no vendored dependency, so it builds
# unconditionally like the graph tests.
add_executable(wav_test wav_test.cpp)
target_link_libraries(wav_test PRIVATE openaxe_core)
add_test(NAME wav_test COMMAND wav_test)

add_executable(convolver_test convolver_test.cpp)
target_link_libraries(convolver_test PRIVATE openaxe_core)
add_test(NAME convolver_test COMMAND convolver_test)

# Phase-2 DSP kinds (issue #268) are plain C++ with no vendored dependency,
# but each one's test links the DSP its kind owns - so a kind that
# effects.config.json compiled out has no test to build either (issue #313).
# The OPENAXE_BLOCK_* flags come from generated/block_sources.cmake.
if(OPENAXE_BLOCK_RING_MOD)
  add_executable(ring_mod_test ring_mod_test.cpp)
  target_link_libraries(ring_mod_test PRIVATE openaxe_core)
  add_test(NAME ring_mod_test COMMAND ring_mod_test)
endif()

if(OPENAXE_BLOCK_FILTER)
  add_executable(filter_test filter_test.cpp)
  target_link_libraries(filter_test PRIVATE openaxe_core)
  add_test(NAME filter_test COMMAND filter_test)
endif()

if(OPENAXE_BLOCK_PITCH_SHIFTER)
  add_executable(pitch_shifter_test pitch_shifter_test.cpp)
  target_link_libraries(pitch_shifter_test PRIVATE openaxe_core)
  add_test(NAME pitch_shifter_test COMMAND pitch_shifter_test)
endif()

if(OPENAXE_BLOCK_GRANULAR_DELAY)
  add_executable(granular_delay_test granular_delay_test.cpp)
  target_link_libraries(granular_delay_test PRIVATE openaxe_core)
  add_test(NAME granular_delay_test COMMAND granular_delay_test)
endif()

if(OPENAXE_BLOCK_ROTARY)
  add_executable(rotary_test rotary_test.cpp)
  target_link_libraries(rotary_test PRIVATE openaxe_core)
  add_test(NAME rotary_test COMMAND rotary_test)
endif()

add_executable(tone_stack_test tone_stack_test.cpp)
target_link_libraries(tone_stack_test PRIVATE openaxe_core)
add_test(NAME tone_stack_test COMMAND tone_stack_test)

add_executable(api_test api_test.cpp)
target_link_libraries(api_test PRIVATE openaxe_core)
add_test(NAME api_test COMMAND api_test)

# Tuner pitch detection + note mapping (issue #123): pure DSP, no vendored
# dependency — builds unconditionally like wav_test/tone_stack_test.
add_executable(pitch_detect_test pitch_detect_test.cpp)
target_link_libraries(pitch_detect_test PRIVATE openaxe_core)
add_test(NAME pitch_detect_test COMMAND pitch_detect_test)

# The JSON module is dependency-free, so it builds unconditionally. Its header
# lives under src/ (it's private to the library), hence the extra include path.
add_executable(json_test json_test.cpp)
target_include_directories(json_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../src)
target_link_libraries(json_test PRIVATE openaxe_core)
add_test(NAME json_test COMMAND json_test)

if(OPENAXE_HAS_NAM_CORE)
  # Rig-state round-trip (issue #119) drives the full engine - amp-family
  # blocks, Dragonfly reverb and DSPark effects all get instantiated - so it
  # needs every DSP family present, like engine_test below. WHOLE_ARCHIVE for
  # the same reason nam_amp_test does: NAMCore's architecture parsers
  # self-register via static initializers nothing else references directly.
  add_executable(api_state_test api_state_test.cpp)
  target_link_libraries(api_state_test PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
  add_test(NAME api_state_test COMMAND api_state_test)
endif()

if(OPENAXE_HAS_NAM_CORE AND OPENAXE_HAS_DRAGONFLY AND OPENAXE_HAS_DSPARK)
  # Embedded-asset state round-trip (issue #120): a rig with a real NAM model
  # and a real IR serialized with embed_assets=1 must restore bit-identically
  # into a fresh graph whose source files are gone. Same linking story as
  # api_realtime_test below - full engine, whole archive, example models dir.
  add_executable(api_state_assets_test api_state_assets_test.cpp)
  # src/ include path: the test also drives the serialization-private
  # sha256/base64 helpers directly (same pattern as json_test).
  target_include_directories(api_state_assets_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../src)
  target_link_libraries(api_state_assets_test PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
  target_compile_definitions(api_state_assets_test PRIVATE
    NAM_CORE_EXAMPLE_MODELS_DIR="${NAM_CORE_DIR}/example_models")
  add_test(NAME api_state_assets_test COMMAND api_state_assets_test)
else()
  message(WARNING "Skipping api_state_assets_test - nam-core/dragonfly/dspark submodules must all be initialized")
endif()

if(OPENAXE_HAS_NAM_CORE AND OPENAXE_HAS_DRAGONFLY AND OPENAXE_HAS_DSPARK)
  # Automation slot map (issue #121): binds slots to real blocks of several
  # kinds (compressor/delay/tremolo wrappers), so like api_state_assets_test
  # it needs every DSP family present. WHOLE_ARCHIVE for NAMCore's
  # self-registering parsers, and src/ on the include path for the C++-level
  # LoadState stats assertions.
  add_executable(api_automation_slots_test api_automation_slots_test.cpp)
  target_include_directories(api_automation_slots_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../src)
  target_link_libraries(api_automation_slots_test PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
  add_test(NAME api_automation_slots_test COMMAND api_automation_slots_test)
else()
  message(WARNING "Skipping api_automation_slots_test - nam-core/dragonfly/dspark submodules must all be initialized")
endif()

add_executable(api_midi_test api_midi_test.cpp)
target_link_libraries(api_midi_test PRIVATE openaxe_core)
add_test(NAME api_midi_test COMMAND api_midi_test)

if(OPENAXE_HAS_NAM_CORE)
  add_executable(nam_amp_test nam_amp_test.cpp)
  # WHOLE_ARCHIVE: NAMCore's architecture parsers (LSTM, WaveNet, ConvNet,
  # Linear) self-register via static initializers with no other symbol this
  # test references directly. A plain static-archive link only pulls object
  # files that resolve an undefined symbol, so those registration-only
  # translation units get silently dropped and get_dsp() fails at runtime
  # with "No config parser registered for architecture: ...". Force the
  # whole openaxe_core archive in so every registration actually runs.
  target_link_libraries(nam_amp_test PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
  target_compile_definitions(nam_amp_test PRIVATE
    NAM_CORE_EXAMPLE_MODELS_DIR="${NAM_CORE_DIR}/example_models")
  add_test(NAME nam_amp_test COMMAND nam_amp_test)
else()
  message(WARNING "Skipping nam_amp_test - packages/core/third_party/nam-core not initialized")
endif()

if(OPENAXE_HAS_NAM_CORE AND OPENAXE_HAS_DRAGONFLY AND OPENAXE_HAS_DSPARK)
  # engine.cpp (issue #14's real-time ABI) instantiates NamAmp, all 4
  # Dragonfly wrappers, and the 4 DSPark-based wrappers unconditionally - see
  # CMakeLists.txt's comment on openaxe_core - so anything that links it
  # needs all three families present, unlike the single-DSP-family tests
  # above.
  add_executable(engine_test engine_test.cpp)
  target_link_libraries(engine_test PRIVATE openaxe_core)
  add_test(NAME engine_test COMMAND engine_test)

  # Golden-audio regression harness (issue #315). Drives AudioEngine over every
  # compiled effect, so it needs the same three families this block guards.
  # WHOLE_ARCHIVE for NAM's self-registering architecture parsers. Reads json.h
  # out of src/ (same pattern as json_test), and is handed its golden directory
  # as a define rather than guessing a path relative to cwd - that differs
  # between a bare run and ctest.
  add_executable(dsp_regression_test dsp_regression_test.cpp)
  target_include_directories(dsp_regression_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../src)
  target_link_libraries(dsp_regression_test PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
  target_compile_definitions(dsp_regression_test PRIVATE
    OPENAXE_GOLDEN_DIR="${CMAKE_CURRENT_SOURCE_DIR}/golden")
  add_test(NAME dsp_regression_test COMMAND dsp_regression_test)

  add_executable(smoothing_test smoothing_test.cpp)
  target_link_libraries(smoothing_test PRIVATE openaxe_core)
  add_test(NAME smoothing_test COMMAND smoothing_test)

  # Concurrent stress for the Tier-1 (any-thread) core surface (issue #211):
  # races openaxe_process against the lock-free param/reverb-control/trim/
  # master-bus calls. Plain link like engine_test - it loads no NAM model, so
  # it doesn't need the whole-archive self-registering-parser treatment.
  add_executable(api_threading_test api_threading_test.cpp)
  target_link_libraries(api_threading_test PRIVATE openaxe_core)
  add_test(NAME api_threading COMMAND api_threading_test)

  # Needs WHOLE_ARCHIVE for the same reason nam_amp_test does (see its own
  # comment above): NAMCore's architecture parsers self-register via static
  # initializers with no other referenced symbol, so a plain static-archive
  # link silently drops those object files.
  add_executable(api_realtime_test api_realtime_test.cpp)
  target_link_libraries(api_realtime_test PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
  target_compile_definitions(api_realtime_test PRIVATE
    NAM_CORE_EXAMPLE_MODELS_DIR="${NAM_CORE_DIR}/example_models")
  add_test(NAME api_realtime_test COMMAND api_realtime_test)
else()
  message(WARNING "Skipping engine_test/api_realtime_test - nam-core and dragonfly-reverb submodules must both be initialized")
endif()

if(OPENAXE_HAS_DRAGONFLY AND OPENAXE_BLOCK_REVERB)
  add_executable(dragonfly_hall_reverb_test dragonfly_hall_reverb_test.cpp)
  target_link_libraries(dragonfly_hall_reverb_test PRIVATE openaxe_core)
  add_test(NAME dragonfly_hall_reverb_test COMMAND dragonfly_hall_reverb_test)

  add_executable(dragonfly_room_reverb_test dragonfly_room_reverb_test.cpp)
  target_link_libraries(dragonfly_room_reverb_test PRIVATE openaxe_core)
  add_test(NAME dragonfly_room_reverb_test COMMAND dragonfly_room_reverb_test)

  add_executable(dragonfly_plate_reverb_test dragonfly_plate_reverb_test.cpp)
  target_link_libraries(dragonfly_plate_reverb_test PRIVATE openaxe_core)
  add_test(NAME dragonfly_plate_reverb_test COMMAND dragonfly_plate_reverb_test)

  add_executable(dragonfly_early_reflections_test dragonfly_early_reflections_test.cpp)
  target_link_libraries(dragonfly_early_reflections_test PRIVATE openaxe_core)
  add_test(NAME dragonfly_early_reflections_test COMMAND dragonfly_early_reflections_test)

  # The actual regression test for the symbol-collision fix: all four
  # algorithms in ONE executable. See the test source for why this is the
  # real proof, not the individual per-algorithm tests above.
  add_executable(dragonfly_all_algorithms_test dragonfly_all_algorithms_test.cpp)
  target_link_libraries(dragonfly_all_algorithms_test PRIVATE openaxe_core)
  add_test(NAME dragonfly_all_algorithms_test COMMAND dragonfly_all_algorithms_test)
else()
  message(WARNING "Skipping Dragonfly Reverb tests - dragonfly-reverb's dpf submodule not initialized")
endif()

# The hand-rolled spring tank is plain C++ (no Dragonfly/DPF machinery), so it
# only needs the reverb kind to be compiled.
if(OPENAXE_BLOCK_REVERB)
  add_executable(spring_reverb_test spring_reverb_test.cpp)
  target_link_libraries(spring_reverb_test PRIVATE openaxe_core)
  add_test(NAME spring_reverb_test COMMAND spring_reverb_test)
endif()

if(OPENAXE_HAS_DSPARK)
  if(OPENAXE_BLOCK_COMPRESSOR)
    add_executable(compressor_test compressor_test.cpp)
    target_link_libraries(compressor_test PRIVATE openaxe_core)
    add_test(NAME compressor_test COMMAND compressor_test)
  endif()

  if(OPENAXE_BLOCK_EQ)
    add_executable(equalizer_test equalizer_test.cpp)
    target_link_libraries(equalizer_test PRIVATE openaxe_core)
    add_test(NAME equalizer_test COMMAND equalizer_test)
  endif()

  if(OPENAXE_BLOCK_NOISE_GATE)
    add_executable(noise_gate_test noise_gate_test.cpp)
    target_link_libraries(noise_gate_test PRIVATE openaxe_core)
    add_test(NAME noise_gate_test COMMAND noise_gate_test)
  endif()

  if(OPENAXE_BLOCK_TREMOLO)
    add_executable(tremolo_test tremolo_test.cpp)
    target_link_libraries(tremolo_test PRIVATE openaxe_core)
    add_test(NAME tremolo_test COMMAND tremolo_test)
  endif()

  # The Phaser wrapper backs onto dspark::Phaser voiced as an MXR Phase 90
  # (issue #317), so like the other DSPark wrappers it builds only when that
  # submodule is initialized - and only when the kind is compiled in.
  if(OPENAXE_BLOCK_PHASER)
    add_executable(phaser_test phaser_test.cpp)
    target_link_libraries(phaser_test PRIVATE openaxe_core)
    add_test(NAME phaser_test COMMAND phaser_test)
  endif()
else()
  message(WARNING "Skipping compressor_test/equalizer_test/noise_gate_test/tremolo_test/phaser_test - packages/core/third_party/dspark not initialized")
endif()

# The Chorus wrapper backs onto the vendored DaisySP chorus (issue #359), so
# it builds and tests only when that submodule is initialized.
if(OPENAXE_HAS_DAISYSP)
  if(OPENAXE_BLOCK_CHORUS)
    add_executable(chorus_test chorus_test.cpp)
    target_link_libraries(chorus_test PRIVATE openaxe_core)
    add_test(NAME chorus_test COMMAND chorus_test)
  endif()
else()
  message(WARNING "Skipping chorus_test - packages/core/third_party/daisysp not initialized")
endif()
