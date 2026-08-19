cmake_minimum_required(VERSION 3.22)
project(nam_studio_core VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(NAM_STUDIO_BUILD_TESTS "Build packages/core unit tests" OFF)

# src/engine.cpp (issue #14's real-time extern "C" ABI) instantiates
# nam_studio::dsp::NamAmp, all 4 Dragonfly reverb wrappers, and the 4
# DSPark-based dynamics/EQ wrappers (Compressor/Equalizer/NoiseGate/Tremolo)
# directly - it's the layer that makes those already-wrapped families
# actually produce audio, so unlike the rest of this file it does NOT
# degrade gracefully if NAM_CORE_DIR/DRAGONFLY_DIR/DSPARK_DIR below turn out
# to be uninitialized; linking nam_studio_core will fail with undefined
# symbols in that case. Run `git submodule update --init --recursive` first
# if that happens.
add_library(nam_studio_core STATIC
  src/core.cpp
  src/graph_validation.cpp
  src/graph_rig.cpp
  src/engine.cpp
  src/api.cpp
  src/dsp/chorus.cpp
  src/dsp/delay.cpp
  src/dsp/flanger.cpp
  src/dsp/phaser.cpp
  src/dsp/ping_pong_delay.cpp
  src/dsp/compressor.cpp
  src/dsp/equalizer.cpp
  src/dsp/noise_gate.cpp
  src/dsp/tremolo.cpp
  src/dsp/tone_stack.cpp
  src/dsp/convolver.cpp
  src/dsp/wav.cpp
)

target_include_directories(nam_studio_core PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>
)

# --- NAM inference wrapper (issue #14) ---
# NeuralAmpModelerCore's own root CMakeLists.txt only builds ITS OWN
# tools/tests (add_subdirectory(tools)) and defines no reusable library
# target. Its documented downstream-integration pattern (tools/CMakeLists.txt)
# is to glob NAM/*.cpp directly into the consumer's own target, which is
# what this does. Eigen/nlohmann include dirs stay PRIVATE: nam_amp.h only
# forward-declares nam::DSP, so consumers of nam_studio_core never need
# those paths themselves.
set(NAM_CORE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/nam-core")
if(EXISTS "${NAM_CORE_DIR}/NAM/dsp.cpp")
  file(GLOB NAM_CORE_SOURCES_TOP "${NAM_CORE_DIR}/NAM/*.cpp")
  file(GLOB NAM_CORE_SOURCES_SUB "${NAM_CORE_DIR}/NAM/*/*.cpp")
  target_sources(nam_studio_core PRIVATE
    src/dsp/nam_amp.cpp
    ${NAM_CORE_SOURCES_TOP}
    ${NAM_CORE_SOURCES_SUB}
  )
  target_include_directories(nam_studio_core PRIVATE
    "${NAM_CORE_DIR}"
    "${NAM_CORE_DIR}/Dependencies/eigen"
    "${NAM_CORE_DIR}/Dependencies/nlohmann"
  )
  target_compile_definitions(nam_studio_core PRIVATE NAM_SAMPLE_FLOAT)
  set(NAM_STUDIO_HAS_NAM_CORE TRUE)
else()
  message(WARNING
    "packages/core/third_party/nam-core has no NAM/dsp.cpp - the NAM "
    "inference wrapper will not build. Run: git submodule update --init "
    "--recursive -- packages/core/third_party/nam-core")
endif()

# --- Dragonfly Reverb wrappers (issue #14) ---
# Each reverb algorithm (hall/room/plate/early-reflections) lives in its own
# self-contained DSP.{hpp,cpp} under plugins/<name>/, separate from the DPF
# plugin/UI scaffolding - only that gets compiled, not DPF itself. Three
# wrinkles this works around, all inside each wrapper's own .cpp (e.g.
# src/dsp/dragonfly_hall_reverb.cpp) rather than here:
#  1. The underlying freeverb3 library (common/freeverb/) uses dynamic
#     exception specifications removed in C++17, so it (and DSP.cpp, and
#     this wrapper's own .cpp, which all transitively include those
#     headers) must compile at C++14 - each algorithm gets its own target
#     with a CXX_STANDARD override, linked into the C++20 nam_studio_core
#     target (mixing standards across TUs in one binary is fine; only
#     same-TU consistency matters).
#  2. DSP.cpp includes two small DPF header-only utilities
#     (DistrhoPlugin.hpp, extra/ScopedDenormalDisable.hpp) despite never
#     using DPF's actual plugin machinery, so Dragonfly's own nested `dpf`
#     submodule needs initializing too (see README.md).
#  3. All four algorithms define an identically-named DragonflyReverbDSP
#     class (and depend on identically-named freeverb3 classes), which
#     would be a duplicate-symbol conflict the moment two of them were
#     ever linked into the same final binary. Each wrapper .cpp compiles
#     freeverb3 + its own DSP.cpp inside an anonymous namespace (see the
#     wrapper source for why it must be *all* of freeverb3 together, not
#     just DSP.cpp) - so each algorithm's target here is just that one
#     self-contained wrapper source file, nothing else to list.
set(DRAGONFLY_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/dragonfly-reverb")
if(EXISTS "${DRAGONFLY_DIR}/plugins/dragonfly-hall-reverb/DSP.cpp"
   AND EXISTS "${DRAGONFLY_DIR}/dpf/distrho/DistrhoPlugin.hpp")
  set(NAM_STUDIO_HAS_DRAGONFLY TRUE)

  # (plugin subdirectory name, wrapper source/target base name) pairs.
  set(DRAGONFLY_ALGOS
    "dragonfly-hall-reverb:dragonfly_hall_reverb"
    "dragonfly-room-reverb:dragonfly_room_reverb"
    "dragonfly-plate-reverb:dragonfly_plate_reverb"
    "dragonfly-early-reflections:dragonfly_early_reflections"
  )
  foreach(algo ${DRAGONFLY_ALGOS})
    string(REPLACE ":" ";" algo_parts ${algo})
    list(GET algo_parts 0 plugin_dir)
    list(GET algo_parts 1 wrapper_name)

    add_library(${wrapper_name}_vendor STATIC "src/dsp/${wrapper_name}.cpp")
    target_include_directories(${wrapper_name}_vendor PRIVATE
      "${DRAGONFLY_DIR}/common"
      "${DRAGONFLY_DIR}/common/freeverb"
      "${DRAGONFLY_DIR}/plugins/${plugin_dir}"
      "${DRAGONFLY_DIR}/dpf/distrho"
      "${DRAGONFLY_DIR}/dpf/distrho/extra"
      "${CMAKE_CURRENT_SOURCE_DIR}/include"
    )
    set_target_properties(${wrapper_name}_vendor PROPERTIES
      CXX_STANDARD 14
      CXX_STANDARD_REQUIRED ON
    )
    # freeverb3 picks its internal sample type (float/double/long double)
    # via one of these macros - Dragonfly's own Makefile always builds
    # with LIBFV3_FLOAT.
    target_compile_definitions(${wrapper_name}_vendor PRIVATE LIBFV3_FLOAT)
    target_link_libraries(nam_studio_core PRIVATE ${wrapper_name}_vendor)
  endforeach()
else()
  message(WARNING
    "packages/core/third_party/dragonfly-reverb's dpf submodule isn't "
    "initialized - the Dragonfly Reverb wrappers will not build. Run: "
    "git -C packages/core/third_party/dragonfly-reverb submodule update "
    "--init --depth 1 -- dpf")
endif()

# --- DSPark-based dynamics/EQ wrappers (issue #22) ---
# DSPark (third_party/dspark) is a header-only, dependency-free C++20 DSP
# framework. None of its source gets compiled - the wrappers (compressor.cpp/
# equalizer.cpp/noise_gate.cpp/tremolo.cpp) just need its include path and
# drive its processors through the shared DsparkEffect adapter
# (src/dsp/internal/dspark_wrapper.h). Adding a new DSPark-backed block is
# then just a Traits table + a thin concrete class (see compressor.cpp for the
# minimal example); this include path is all the build wiring it needs.
set(DSPARK_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/dspark")
if(EXISTS "${DSPARK_DIR}/Effects/Compressor.h")
  target_include_directories(nam_studio_core PRIVATE "${DSPARK_DIR}")
  set(NAM_STUDIO_HAS_DSPARK TRUE)
else()
  message(WARNING
    "packages/core/third_party/dspark isn't initialized - the Compressor/"
    "Equalizer/NoiseGate/Tremolo wrappers will not build. Run: "
    "git submodule update --init -- packages/core/third_party/dspark")
endif()

if(EMSCRIPTEN)
  # Web target (issue #22): compiled to WASM, consumed by apps/web via
  # AudioWorklet. Emscripten's exports/link flags only apply to a final
  # linked module, not a static archive - nam_studio_core itself stays a
  # plain STATIC library (as every other target links it), and this small
  # executable is what actually gets Emscripten's MODULARIZE treatment.
  # wasm_entry.cpp is deliberately empty; nothing needs a main() for the
  # MODULARIZE=1 factory-function pattern used here.
  # C++ exceptions must be enabled for this target. Emscripten disables them by
  # default, which turns any `throw` into an abort() that takes the whole
  # AudioWorklet down - and the core relies on catching them: NAMCore signals a
  # bad model by throwing, and nam_studio::dsp::NamAmp catches that to return a
  # NamLoadError instead (the ABI can't propagate exceptions). Without this, a
  # malformed .nam file killed the audio thread instead of returning an error.
  # -fexceptions (the JS-based implementation) rather than -fwasm-exceptions:
  # universally supported, and the cost lands on unwinding paths, not on
  # nam_studio_process.
  target_compile_options(nam_studio_core PRIVATE -fexceptions)
  add_executable(nam_studio_core_wasm src/wasm_entry.cpp)
  target_compile_options(nam_studio_core_wasm PRIVATE -fexceptions)
  # WHOLE_ARCHIVE for the same reason the desktop app and the tests need it:
  # NAM's architecture parsers (LSTM/WaveNet/ConvNet/Linear) self-register via
  # static initializers that nothing calls directly, so a plain archive link
  # drops them and every model load fails - silently, with a "bad model" error.
  # This only started to matter once the web app's amp block ran core's own NAM
  # inference (ampWorklet.js) instead of a separate npm engine.
  target_link_libraries(nam_studio_core_wasm PRIVATE
    $<LINK_LIBRARY:WHOLE_ARCHIVE,nam_studio_core>)
  set_target_properties(nam_studio_core_wasm PROPERTIES OUTPUT_NAME "nam_studio_core")
  target_link_options(nam_studio_core_wasm PRIVATE
    "SHELL:-s MODULARIZE=1"
    "SHELL:-s EXPORT_ES6=1"
    "SHELL:-s ENVIRONMENT=worklet"
    "SHELL:-s EXPORT_NAME=NamStudioCoreModule"
    "SHELL:-s ALLOW_MEMORY_GROWTH=1"
    -fexceptions
    # Extend this list as more of the graph ABI gets used from the browser.
    # Every name here must exist in the linked archive: wasm-ld fails the build
    # on an export it can't find, which is how _nam_studio_set_drive_model
    # (removed with the Drive effect) went unnoticed - the compiled artifacts
    # are checked in and nothing rebuilds them automatically.
    "SHELL:-s EXPORTED_FUNCTIONS=['_nam_studio_graph_create','_nam_studio_graph_destroy','_nam_studio_add_block','_nam_studio_remove_block','_nam_studio_move_block','_nam_studio_connect','_nam_studio_disconnect','_nam_studio_reset','_nam_studio_process','_nam_studio_set_param','_nam_studio_block_param_count','_nam_studio_block_param_info','_nam_studio_load_nam_model_json','_nam_studio_unload_nam_model','_nam_studio_block_has_model','_nam_studio_block_model_info','_nam_studio_block_model_slim_breakpoints','_nam_studio_load_ir','_nam_studio_unload_ir','_nam_studio_block_ir_length','_nam_studio_set_reverb_algorithm','_nam_studio_set_reverb_control','_nam_studio_set_delay_model','_nam_studio_set_bypass','_nam_studio_set_block_input_trim','_nam_studio_set_block_output_trim','_nam_studio_set_master_level','_nam_studio_set_master_muted','_nam_studio_set_tuner_muted','_nam_studio_get_meter','_malloc','_free']"
    # HEAPU8/HEAPF64/HEAP32 are for the amp worklet: it writes a model's JSON
    # into WASM memory as UTF-8 bytes and reads nam_studio_block_model_info's
    # double/int32 out-params back out.
    "SHELL:-s EXPORTED_RUNTIME_METHODS=['HEAPF32','HEAPU32','HEAPU8','HEAPF64','HEAP32','UTF8ToString']"
    -O3
  )
elseif(CMAKE_SYSTEM_NAME STREQUAL "iOS")
  # iOS target (issue #17): linked into apps/ios via an XCFramework.
  set_target_properties(nam_studio_core PROPERTIES
    FRAMEWORK TRUE
    MACOSX_FRAMEWORK_IDENTIFIER "io.miew.namstudio.core"
  )
elseif(CMAKE_SYSTEM_NAME STREQUAL "Android")
  # Android target (issue #17): shared lib for the JNI bridge.
  add_library(nam_studio_core_jni SHARED src/core.cpp)
  target_include_directories(nam_studio_core_jni PUBLIC include)
else()
  # Native desktop (issue #15) and VST3 plugin (issue #16) both link
  # against the static nam_studio_core target directly.
endif()

if(NAM_STUDIO_BUILD_TESTS AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/tests/CMakeLists.txt")
  enable_testing()
  add_subdirectory(tests)
endif()
