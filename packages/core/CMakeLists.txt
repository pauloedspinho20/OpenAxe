cmake_minimum_required(VERSION 3.22)
project(nam_studio_core VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(NAM_STUDIO_BUILD_TESTS "Build packages/core unit tests" OFF)

add_library(nam_studio_core STATIC src/core.cpp)

target_include_directories(nam_studio_core PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>
)

# third_party/ is intentionally empty scaffolding, populated by issue #14
# (NAM inference + DSP graph). Guarded so an empty dir doesn't break configure.
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
