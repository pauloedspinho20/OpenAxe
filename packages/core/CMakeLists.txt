cmake_minimum_required(VERSION 3.22)

# issue #54: the root VERSION file is the one source of truth for the
# product's version (see apps/desktop/CMakeLists.txt's comment on the same
# read) - kept in sync with every package.json by scripts/sync-version.mjs.
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../../VERSION" OPENAXE_VERSION)
string(STRIP "${OPENAXE_VERSION}" OPENAXE_VERSION)

project(openaxe_core VERSION ${OPENAXE_VERSION} LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(OPENAXE_BUILD_TESTS "Build packages/core unit tests" OFF)

# Which block kinds this build contains (issue #313). effects.config.json is
# the source of truth; this file is generated from it by
# `node scripts/gen-param-schema.mjs --target=effects` and defines
# OPENAXE_BLOCK_SOURCES (the per-kind DSP sources, omitting anything marked
# compiled:false) and OPENAXE_DRAGONFLY_ENABLED. A disabled kind's .cpp is
# never listed here, so it is never handed to the compiler - the matching
# `#if OPENAXE_BLOCK_*` guards in src/engine.cpp remove its call sites.
include("${CMAKE_CURRENT_SOURCE_DIR}/generated/block_sources.cmake")

# src/engine.cpp (issue #14's real-time extern "C" ABI) instantiates
# openaxe::dsp::NamAmp, all 4 Dragonfly reverb wrappers, the 4
# DSPark-based dynamics/EQ wrappers (Compressor/Equalizer/NoiseGate/Tremolo)
# and the DaisySP-based Chorus directly - it's the layer that makes those
# already-wrapped families actually produce audio, so unlike the rest of this
# file it does NOT degrade gracefully if NAM_CORE_DIR/DRAGONFLY_DIR/DSPARK_DIR/
# DAISYSP_DIR below turn out to be uninitialized; linking openaxe_core will
# fail with undefined symbols in that case. Run `git submodule update --init
# --recursive` first if that happens.
add_library(openaxe_core STATIC
  src/core.cpp
  src/graph_validation.cpp
  src/graph_rig.cpp
  src/engine.cpp
  src/api.cpp
  src/rig_switch.cpp
  src/serialization/json.cpp
  src/serialization/rig_state.cpp
  src/serialization/sha256.cpp
  src/serialization/base64.cpp
  ${OPENAXE_BLOCK_SOURCES}
  src/dsp/tone_stack.cpp
  src/dsp/convolver.cpp
  src/dsp/wav.cpp
  src/dsp/pitch_detect.cpp
  src/dsp/note_utils.cpp
  src/dsp/fingerprint.cpp
  src/midi.cpp
)

target_include_directories(openaxe_core PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>
)

# --- NAM inference wrapper (issue #14) ---
# NeuralAmpModelerCore's own root CMakeLists.txt only builds ITS OWN
# tools/tests (add_subdirectory(tools)) and defines no reusable library
# target. Its documented downstream-integration pattern (tools/CMakeLists.txt)
# is to glob NAM/*.cpp directly into the consumer's own target, which is
# what this does. Eigen/nlohmann include dirs stay PRIVATE: nam_amp.h only
# forward-declares nam::DSP, so consumers of openaxe_core never need
# those paths themselves.
set(NAM_CORE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/nam-core")
if(EXISTS "${NAM_CORE_DIR}/NAM/dsp.cpp")
  file(GLOB NAM_CORE_SOURCES_TOP "${NAM_CORE_DIR}/NAM/*.cpp")
  file(GLOB NAM_CORE_SOURCES_SUB "${NAM_CORE_DIR}/NAM/*/*.cpp")
  target_sources(openaxe_core PRIVATE
    src/dsp/nam_amp.cpp
    ${NAM_CORE_SOURCES_TOP}
    ${NAM_CORE_SOURCES_SUB}
  )
  target_include_directories(openaxe_core PRIVATE
    "${NAM_CORE_DIR}"
    "${NAM_CORE_DIR}/Dependencies/eigen"
    "${NAM_CORE_DIR}/Dependencies/nlohmann"
  )
  target_compile_definitions(openaxe_core PRIVATE NAM_SAMPLE_FLOAT)
  set(OPENAXE_HAS_NAM_CORE TRUE)
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
#     with a CXX_STANDARD override, linked into the C++20 openaxe_core
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
if(NOT OPENAXE_DRAGONFLY_ENABLED)
  # effects.config.json has reverb compiled:false - skip all four algorithm
  # targets. engine.cpp's OPENAXE_BLOCK_REVERB guards drop the call sites.
  message(STATUS "openaxe_core: reverb disabled by effects.config.json - "
                 "not building the Dragonfly algorithms")
elseif(EXISTS "${DRAGONFLY_DIR}/plugins/dragonfly-hall-reverb/DSP.cpp"
   AND EXISTS "${DRAGONFLY_DIR}/dpf/distrho/DistrhoPlugin.hpp")
  set(OPENAXE_HAS_DRAGONFLY TRUE)

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
    # freeverb3's headers declare several inline/internal-linkage member
    # functions (slot_::alloc, biquad_::setLPF_RBJ, revbase_::getSampleRate,
    # ...) in the *_t.hpp shims that are only ever used via the template
    # specializations defined in the matching .cpp - Clang's
    # -Wundefined-internal fires on every one of them. They're a known
    # artifact of freeverb3's header layout in third-party vendored code,
    # have no runtime effect, and are out of our control, so silence the
    # warning for these targets rather than patching the subtree.
    if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
      target_compile_options(${wrapper_name}_vendor PRIVATE -Wno-undefined-internal)
    endif()
    target_link_libraries(openaxe_core PRIVATE ${wrapper_name}_vendor)
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
  target_include_directories(openaxe_core PRIVATE "${DSPARK_DIR}")
  set(OPENAXE_HAS_DSPARK TRUE)
else()
  message(WARNING
    "packages/core/third_party/dspark isn't initialized - the Compressor/"
    "Equalizer/NoiseGate/Tremolo wrappers will not build. Run: "
    "git submodule update --init -- packages/core/third_party/dspark")
endif()

# --- DaisySP-based modulation wrappers (issue #359) ---
# DaisySP (third_party/daisysp) is the MIT-licensed DSP library from
# Electro-Smith (the Daisy hardware platform). Unlike DSPark it is NOT
# header-only: the chorus wrapper needs its own translation unit compiled.
# Only the MIT part of the repo is used - the separate DaisySP-LGPL tree is
# deliberately never compiled or included. The wrapper (src/dsp/chorus.cpp)
# drives daisysp::Chorus through the same openaxe::dsp contract as every
# other effect; the engine's public ABI is untouched, so this is purely an
# internal quality swap (issue #359). Include dirs stay PRIVATE: chorus.h
# only forward-declares the pimpl, so consumers of openaxe_core never need
# these paths. chorus.cpp needs "Source" (for Effects/chorus.h and
# Utility/delayline.h) and "Source/Utility" (for its `#include "dsp.h"`).
set(DAISYSP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/daisysp")
if(EXISTS "${DAISYSP_DIR}/Source/Effects/chorus.h")
  target_include_directories(openaxe_core PRIVATE
    "${DAISYSP_DIR}/Source"
    "${DAISYSP_DIR}/Source/Utility"
    # The wrapper includes the header as "daisysp/Source/Effects/chorus.h"
    # (via the third_party root below) rather than the ambiguous
    # "Effects/chorus.h": dspark also ships an Effects/Chorus.h, and on a
    # case-insensitive filesystem (macOS) the bare name resolves to whichever
    # include dir comes first. The prefixed path pins it to DaisySP.
    "${CMAKE_CURRENT_SOURCE_DIR}/third_party"
  )
  target_sources(openaxe_core PRIVATE "${DAISYSP_DIR}/Source/Effects/chorus.cpp")
  set(OPENAXE_HAS_DAISYSP TRUE)
else()
  message(WARNING
    "packages/core/third_party/daisysp isn't initialized - the Chorus "
    "wrapper will not build. Run: "
    "git submodule update --init -- packages/core/third_party/daisysp")
endif()

if(EMSCRIPTEN)
  # Web target (issue #22): compiled to WASM, consumed by apps/web via
  # AudioWorklet. Emscripten's exports/link flags only apply to a final
  # linked module, not a static archive - openaxe_core itself stays a
  # plain STATIC library (as every other target links it), and this small
  # executable is what actually gets Emscripten's MODULARIZE treatment.
  # wasm_entry.cpp is deliberately empty; nothing needs a main() for the
  # MODULARIZE=1 factory-function pattern used here.
  # C++ exceptions must be enabled for this target. Emscripten disables them by
  # default, which turns any `throw` into an abort() that takes the whole
  # AudioWorklet down - and the core relies on catching them: NAMCore signals a
  # bad model by throwing, and openaxe::dsp::NamAmp catches that to return a
  # NamLoadError instead (the ABI can't propagate exceptions). Without this, a
  # malformed .nam file killed the audio thread instead of returning an error.
  # -fexceptions (the JS-based implementation) rather than -fwasm-exceptions:
  # universally supported, and the cost lands on unwinding paths, not on
  # openaxe_process.
  target_compile_options(openaxe_core PRIVATE -fexceptions)
  add_executable(openaxe_core_wasm src/wasm_entry.cpp)
  target_compile_options(openaxe_core_wasm PRIVATE -fexceptions)
  # WHOLE_ARCHIVE for the same reason the desktop app and the tests need it:
  # NAM's architecture parsers (LSTM/WaveNet/ConvNet/Linear) self-register via
  # static initializers that nothing calls directly, so a plain archive link
  # drops them and every model load fails - silently, with a "bad model" error.
  # This only started to matter once the web app's amp block ran core's own NAM
  # inference (ampWorklet.js) instead of a separate npm engine.
  target_link_libraries(openaxe_core_wasm PRIVATE
    $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
  # OUTPUT_NAME stays "openaxe_core": the committed artifacts the web app fetches
  # are openaxe_core.{js,wasm}; renaming the output without an Emscripten
  # rebuild + recommit would break the loader (see api.h's ABI note).
  set_target_properties(openaxe_core_wasm PROPERTIES OUTPUT_NAME "openaxe_core")
  target_link_options(openaxe_core_wasm PRIVATE
    "SHELL:-s MODULARIZE=1"
    "SHELL:-s EXPORT_ES6=1"
    "SHELL:-s ENVIRONMENT=web,worklet"
    "SHELL:-s EXPORT_NAME=OpenAxeCoreModule"
    "SHELL:-s ALLOW_MEMORY_GROWTH=1"
    -fexceptions
    # Extend this list as more of the graph ABI gets used from the browser.
    # Every name here must exist in the linked archive: wasm-ld fails the build
    # on an export it can't find, which is how _openaxe_set_drive_model
    # (removed with the Drive effect) went unnoticed - the compiled artifacts
    # are checked in and nothing rebuilds them automatically. wasm-ld only
    # catches an export listed here that doesn't exist though - the opposite
    # drift (a symbol the web app calls that ISN'T listed here) fails silently
    # at runtime instead, since Emscripten just leaves it undefined on the JS
    # Module object. scripts/check-wasm-exports.mjs (issue #70) catches that
    # direction by diffing every `_openaxe_*`/`_malloc`/`_free` identifier
    # referenced in apps/web against this list - run in CI, and standalone
    # with `--fix` to add any it finds missing (a wasm rebuild is still
    # required after - see scripts/build-core-wasm.sh).
 "SHELL:-s EXPORTED_FUNCTIONS=['_openaxe_graph_create','_openaxe_graph_destroy','_openaxe_add_block','_openaxe_remove_block','_openaxe_move_block','_openaxe_connect','_openaxe_disconnect','_openaxe_reset','_openaxe_process','_openaxe_staged_graph_create','_openaxe_staged_graph_commit','_openaxe_switch_active','_openaxe_set_param','_openaxe_block_param_count','_openaxe_block_param_info','_openaxe_load_nam_model_json','_openaxe_unload_nam_model','_openaxe_block_has_model','_openaxe_block_model_info','_openaxe_block_model_slim_breakpoints','_openaxe_load_ir','_openaxe_unload_ir','_openaxe_block_ir_length','_openaxe_set_reverb_algorithm','_openaxe_set_reverb_control','_openaxe_set_delay_model','_openaxe_set_bypass','_openaxe_set_block_input_trim','_openaxe_set_block_output_trim','_openaxe_set_master_level','_openaxe_set_master_muted','_openaxe_set_tuner_muted','_openaxe_get_meter','_openaxe_get_input_meter','_openaxe_get_gain_reduction','_openaxe_get_gate_gain','_openaxe_detect_pitch','_openaxe_frequency_to_note','_openaxe_midi_mapping_count','_openaxe_midi_get_mapping','_openaxe_midi_add_mapping','_openaxe_midi_remove_mapping','_openaxe_midi_clear_mappings','_openaxe_midi_arm_learn','_openaxe_midi_cancel_learn','_openaxe_midi_is_learning','_openaxe_midi_get_learn_target','_openaxe_midi_parse_message','_openaxe_midi_is_trigger_edge','_openaxe_midi_message_matches','_openaxe_midi_handle_message','_openaxe_serialize_state','_openaxe_serialize_state_ex','_openaxe_load_state','_openaxe_state_missing_asset_count','_openaxe_state_missing_asset','_openaxe_state_unsupported_block_count','_openaxe_state_unsupported_block','_openaxe_block_kind_compiled','_openaxe_compute_fingerprint','_malloc','_free']"
    # HEAPU8/HEAPF64/HEAP32 are for the amp worklet: it writes a model's JSON
    # into WASM memory as UTF-8 bytes and reads openaxe_block_model_info's
    # double/int32 out-params back out.
    "SHELL:-s EXPORTED_RUNTIME_METHODS=['HEAPF32','HEAPU32','HEAPU8','HEAPF64','HEAP32','UTF8ToString']"
    -O3
  )
elseif(CMAKE_SYSTEM_NAME STREQUAL "iOS")
  # iOS target (issue #17): linked into apps/ios via an XCFramework.
  set_target_properties(openaxe_core PROPERTIES
    FRAMEWORK TRUE
    MACOSX_FRAMEWORK_IDENTIFIER "io.miew.openaxe.core"
  )
elseif(CMAKE_SYSTEM_NAME STREQUAL "Android")
  # Android target (issue #17): shared lib for the JNI bridge.
  add_library(openaxe_core_jni SHARED src/core.cpp)
  target_include_directories(openaxe_core_jni PUBLIC include)
else()
  # Native desktop (issue #15) and VST3 plugin (issue #16) both link
  # against the static openaxe_core target directly.
endif()

if(OPENAXE_BUILD_TESTS AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/tests/CMakeLists.txt")
  enable_testing()
  add_subdirectory(tests)
endif()
