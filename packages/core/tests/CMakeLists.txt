add_executable(graph_validation_test graph_validation_test.cpp)
target_link_libraries(graph_validation_test PRIVATE nam_studio_core)
add_test(NAME graph_validation_test COMMAND graph_validation_test)

add_executable(graph_rig_test graph_rig_test.cpp)
target_link_libraries(graph_rig_test PRIVATE nam_studio_core)
add_test(NAME graph_rig_test COMMAND graph_rig_test)

# The tone stack is plain DSP with no vendored dependency, so it builds
# unconditionally like the graph tests.
add_executable(wav_test wav_test.cpp)
target_link_libraries(wav_test PRIVATE nam_studio_core)
add_test(NAME wav_test COMMAND wav_test)

add_executable(convolver_test convolver_test.cpp)
target_link_libraries(convolver_test PRIVATE nam_studio_core)
add_test(NAME convolver_test COMMAND convolver_test)

add_executable(tone_stack_test tone_stack_test.cpp)
target_link_libraries(tone_stack_test PRIVATE nam_studio_core)
add_test(NAME tone_stack_test COMMAND tone_stack_test)

add_executable(api_test api_test.cpp)
target_link_libraries(api_test PRIVATE nam_studio_core)
add_test(NAME api_test COMMAND api_test)

if(NAM_STUDIO_HAS_NAM_CORE)
  add_executable(nam_amp_test nam_amp_test.cpp)
  # WHOLE_ARCHIVE: NAMCore's architecture parsers (LSTM, WaveNet, ConvNet,
  # Linear) self-register via static initializers with no other symbol this
  # test references directly. A plain static-archive link only pulls object
  # files that resolve an undefined symbol, so those registration-only
  # translation units get silently dropped and get_dsp() fails at runtime
  # with "No config parser registered for architecture: ...". Force the
  # whole nam_studio_core archive in so every registration actually runs.
  target_link_libraries(nam_amp_test PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,nam_studio_core>)
  target_compile_definitions(nam_amp_test PRIVATE
    NAM_CORE_EXAMPLE_MODELS_DIR="${NAM_CORE_DIR}/example_models")
  add_test(NAME nam_amp_test COMMAND nam_amp_test)
else()
  message(WARNING "Skipping nam_amp_test - packages/core/third_party/nam-core not initialized")
endif()

if(NAM_STUDIO_HAS_NAM_CORE AND NAM_STUDIO_HAS_DRAGONFLY AND NAM_STUDIO_HAS_DSPARK)
  # engine.cpp (issue #14's real-time ABI) instantiates NamAmp, all 4
  # Dragonfly wrappers, and the 4 DSPark-based wrappers unconditionally - see
  # CMakeLists.txt's comment on nam_studio_core - so anything that links it
  # needs all three families present, unlike the single-DSP-family tests
  # above.
  add_executable(engine_test engine_test.cpp)
  target_link_libraries(engine_test PRIVATE nam_studio_core)
  add_test(NAME engine_test COMMAND engine_test)

  # Needs WHOLE_ARCHIVE for the same reason nam_amp_test does (see its own
  # comment above): NAMCore's architecture parsers self-register via static
  # initializers with no other referenced symbol, so a plain static-archive
  # link silently drops those object files.
  add_executable(api_realtime_test api_realtime_test.cpp)
  target_link_libraries(api_realtime_test PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,nam_studio_core>)
  target_compile_definitions(api_realtime_test PRIVATE
    NAM_CORE_EXAMPLE_MODELS_DIR="${NAM_CORE_DIR}/example_models")
  add_test(NAME api_realtime_test COMMAND api_realtime_test)
else()
  message(WARNING "Skipping engine_test/api_realtime_test - nam-core and dragonfly-reverb submodules must both be initialized")
endif()

if(NAM_STUDIO_HAS_DRAGONFLY)
  add_executable(dragonfly_hall_reverb_test dragonfly_hall_reverb_test.cpp)
  target_link_libraries(dragonfly_hall_reverb_test PRIVATE nam_studio_core)
  add_test(NAME dragonfly_hall_reverb_test COMMAND dragonfly_hall_reverb_test)

  add_executable(dragonfly_room_reverb_test dragonfly_room_reverb_test.cpp)
  target_link_libraries(dragonfly_room_reverb_test PRIVATE nam_studio_core)
  add_test(NAME dragonfly_room_reverb_test COMMAND dragonfly_room_reverb_test)

  add_executable(dragonfly_plate_reverb_test dragonfly_plate_reverb_test.cpp)
  target_link_libraries(dragonfly_plate_reverb_test PRIVATE nam_studio_core)
  add_test(NAME dragonfly_plate_reverb_test COMMAND dragonfly_plate_reverb_test)

  add_executable(dragonfly_early_reflections_test dragonfly_early_reflections_test.cpp)
  target_link_libraries(dragonfly_early_reflections_test PRIVATE nam_studio_core)
  add_test(NAME dragonfly_early_reflections_test COMMAND dragonfly_early_reflections_test)

  # The actual regression test for the symbol-collision fix: all four
  # algorithms in ONE executable. See the test source for why this is the
  # real proof, not the individual per-algorithm tests above.
  add_executable(dragonfly_all_algorithms_test dragonfly_all_algorithms_test.cpp)
  target_link_libraries(dragonfly_all_algorithms_test PRIVATE nam_studio_core)
  add_test(NAME dragonfly_all_algorithms_test COMMAND dragonfly_all_algorithms_test)
else()
  message(WARNING "Skipping Dragonfly Reverb tests - dragonfly-reverb's dpf submodule not initialized")
endif()

if(NAM_STUDIO_HAS_DSPARK)
  add_executable(compressor_test compressor_test.cpp)
  target_link_libraries(compressor_test PRIVATE nam_studio_core)
  add_test(NAME compressor_test COMMAND compressor_test)

  add_executable(equalizer_test equalizer_test.cpp)
  target_link_libraries(equalizer_test PRIVATE nam_studio_core)
  add_test(NAME equalizer_test COMMAND equalizer_test)

  add_executable(noise_gate_test noise_gate_test.cpp)
  target_link_libraries(noise_gate_test PRIVATE nam_studio_core)
  add_test(NAME noise_gate_test COMMAND noise_gate_test)

  add_executable(tremolo_test tremolo_test.cpp)
  target_link_libraries(tremolo_test PRIVATE nam_studio_core)
  add_test(NAME tremolo_test COMMAND tremolo_test)
else()
  message(WARNING "Skipping compressor_test/equalizer_test/noise_gate_test/tremolo_test - packages/core/third_party/dspark not initialized")
endif()
