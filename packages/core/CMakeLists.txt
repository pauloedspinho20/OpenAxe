cmake_minimum_required(VERSION 3.22)
project(nam_studio_core VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(NAM_STUDIO_BUILD_TESTS "Build packages/core unit tests" OFF)

# src/engine.cpp (issue #14's real-time extern "C" ABI) instantiates
# nam_studio::dsp::NamAmp and all 4 Dragonfly reverb wrappers directly - it's
# the layer that makes those already-wrapped families actually produce
# audio, so unlike the rest of this file it does NOT degrade gracefully if
# NAM_CORE_DIR/DRAGONFLY_DIR below turn out to be uninitialized; linking
# nam_studio_core will fail with undefined symbols in that case. Run
# `git submodule update --init --recursive` first if that happens.
add_library(nam_studio_core STATIC
  src/core.cpp
  src/graph_validation.cpp
  src/graph_rig.cpp
  src/engine.cpp
  src/api.cpp
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

# The remaining three vendored DSP libraries (analog-tape-model, byod,
# lsp-plugins) are not wrapped or built yet - see README.md.
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/third_party/CMakeLists.txt")
  add_subdirectory(third_party)
endif()

if(EMSCRIPTEN)
  # Web target (issue #14): compiled to WASM, consumed by apps/web via AudioWorklet.
  set_target_properties(nam_studio_core PROPERTIES SUFFIX ".js")
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
