cmake_minimum_required(VERSION 3.22)
project(nam_studio_core VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(NAM_STUDIO_BUILD_TESTS "Build packages/core unit tests" OFF)

add_library(nam_studio_core STATIC
  src/core.cpp
  src/graph_validation.cpp
  src/graph_rig.cpp
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

# The other five vendored DSP libraries (dragonfly-reverb, analog-tape-model,
# byod, lsp-plugins, rtneural) are not wrapped or built yet - see README.md.
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
