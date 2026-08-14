add_executable(graph_validation_test graph_validation_test.cpp)
target_link_libraries(graph_validation_test PRIVATE nam_studio_core)
add_test(NAME graph_validation_test COMMAND graph_validation_test)

add_executable(graph_rig_test graph_rig_test.cpp)
target_link_libraries(graph_rig_test PRIVATE nam_studio_core)
add_test(NAME graph_rig_test COMMAND graph_rig_test)

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

if(NAM_STUDIO_HAS_DRAGONFLY)
  add_executable(dragonfly_hall_reverb_test dragonfly_hall_reverb_test.cpp)
  target_link_libraries(dragonfly_hall_reverb_test PRIVATE nam_studio_core)
  add_test(NAME dragonfly_hall_reverb_test COMMAND dragonfly_hall_reverb_test)
else()
  message(WARNING "Skipping dragonfly_hall_reverb_test - dragonfly-reverb's dpf submodule not initialized")
endif()
