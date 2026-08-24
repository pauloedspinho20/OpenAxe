cmake_minimum_required(VERSION 3.24)

# issue #54: root VERSION is the one source of truth
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../../VERSION" OPENAXE_VERSION)
string(STRIP "${OPENAXE_VERSION}" OPENAXE_VERSION)

project(openaxe_vst3 VERSION ${OPENAXE_VERSION} LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# macOS deployment target — mirrors iPlug2's 10.13 floor until we need newer.
if(APPLE)
  enable_language(OBJC)
  enable_language(OBJCXX)
  if(NOT CMAKE_OSX_DEPLOYMENT_TARGET)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "10.13" CACHE STRING "Minimum macOS version")
  endif()
endif()

# ── Shared core (issue #14) ────────────────────────────────────────────────
add_subdirectory(../../packages/core core)

# ── iPlug2 (issue #125) ───────────────────────────────────────────────────
# Precedent: apps/desktop/CMakeLists.txt FetchContent_Declare with pinned GIT_TAG.
# iPlug2 vendors VST3/AU/CLAP SDKs via Dependencies/ (VST3_SDK, etc.) and
# Scripts/download scripts (download-iplug-sdks.sh / download-prebuilt-libs.sh).
# Decision: use FetchContent for iPlug2 itself plus its SDK-download scripts,
# NOT pinned submodules for each SDK. Rationale: upstream curates SDK revisions
# alongside iPlug2 commits; pinning iPlug2 (GIT_TAG below) pins the SDKs
# transitively, keeps this repo from duplicating several hundred MB of SDK
# copies, and follows the iPlug2 wiki's "Getting Started" flow. If offline /
# reproducible builds without network are later required, switch to submodules
# and record SDK SHAs in .gitmodules — the choice is documented here so #74's
# floating-pin lesson is not repeated.
include(FetchContent)
# Pinned to 2026-08-19 master (d54f69050f517e43b941d88c2a170f0a840b9ee4). Never float — see #74.
FetchContent_Declare(
  iplug2
  GIT_REPOSITORY https://github.com/iPlug2/iPlug2
  GIT_TAG d54f69050f517e43b941d88c2a170f0a840b9ee4
  GIT_SHALLOW TRUE
)

# Try to fetch iPlug2 source; if offline, keep configuring (smoke test still builds).
# Use Populate (not MakeAvailable) so we don't run iPlug2's top-level CMakeLists.txt
# which unconditionally adds Examples/Tests and requires VST3_SDK/Dependencies.
if(POLICY CMP0169)
  cmake_policy(SET CMP0169 OLD)
endif()
set(IPLUG2_AVAILABLE OFF)
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../packages/core/third_party/nam-core/NAM/dsp.cpp")
  FetchContent_GetProperties(iplug2)
  if(NOT iplug2_POPULATED)
    FetchContent_Populate(iplug2)
  endif()
  if(EXISTS "${iplug2_SOURCE_DIR}/IPlug/IPlug_include_in_plug_hdr.h")
    set(IPLUG2_AVAILABLE ON)
    set(IPLUG2_DIR "${iplug2_SOURCE_DIR}" CACHE PATH "iPlug2 root" FORCE)
    # Do not include iPlug2's top-level CMake (it adds Examples/Tests needing SDKs).
    # Include only the core IPlug2 cmake helpers if needed.
    if(EXISTS "${iplug2_SOURCE_DIR}/IPlug/IPlug.cmake")
      include(${iplug2_SOURCE_DIR}/IPlug/IPlug.cmake)
    endif()
  endif()
endif()

# ── Native file dialogs (issue #129): portable-file-dialogs (MIT) ───────
# Reuse the same single-header picker apps/desktop uses (popen AppleScript/
# Win32/zenity-kdialog). Header-only, so offline builds just skip Pick* tests.
FetchContent_Declare(
  portable_file_dialogs
  GIT_REPOSITORY https://github.com/samhocevar/portable-file-dialogs
  GIT_TAG 0.1.0
  GIT_SHALLOW TRUE
)
set(CMAKE_POLICY_VERSION_MINIMUM 3.5)
FetchContent_MakeAvailable(portable_file_dialogs)
if(EXISTS "${portable_file_dialogs_SOURCE_DIR}/portable-file-dialogs.h")
  add_compile_definitions(OPENAXE_HAS_PFD)
  include_directories("${portable_file_dialogs_SOURCE_DIR}")
endif()

# ── Config header (plugin identity) ──────────────────────────────────────
# config.h is checked in; no generation step.

# ── Editor shell (issue #132): webview + shared React ───────────────────
# Like apps/desktop (webview/webview 0.12 + nlohmann/json for the bridge),
# the plugin editor hosts the shared React SPA via a webview rather than an
# IGraphics fork. Header-only, so offline builds still work — the editor
# compiles as a stub without the webview headers.
set(WEBVIEW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WEBVIEW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WEBVIEW_BUILD_DOCS OFF CACHE BOOL "" FORCE)
set(WEBVIEW_BUILD_SHARED_LIBRARY OFF CACHE BOOL "" FORCE)
set(WEBVIEW_BUILD_STATIC_LIBRARY OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
  webview
  GIT_REPOSITORY https://github.com/webview/webview
  GIT_TAG 0.12.0
  GIT_SHALLOW TRUE
)
FetchContent_Declare(
  nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json
  GIT_TAG v3.11.3
  GIT_SHALLOW TRUE
)
set(JSON_BuildTests OFF CACHE BOOL "" FORCE)
# FetchContent may fail offline — don't break smoke tests.
FetchContent_GetProperties(webview)
if(NOT webview_POPULATED)
  FetchContent_Populate(webview)
endif()
if(EXISTS "${webview_SOURCE_DIR}/webview.h" OR EXISTS "${webview_SOURCE_DIR}/core/include/webview/webview.h")
  add_compile_definitions(OPENAXE_HAS_WEBVIEW)
  if(EXISTS "${webview_SOURCE_DIR}/core/include/webview/webview.h")
    include_directories("${webview_SOURCE_DIR}/core/include")
  else()
    include_directories("${webview_SOURCE_DIR}")
  endif()
  if(APPLE)
    enable_language(OBJCXX)
  endif()
  message(STATUS "packages/vst3: webview available — editor will use webview shell")
else()
  message(STATUS "packages/vst3: webview not available — editor builds as stub (offline)")
endif()
FetchContent_GetProperties(nlohmann_json)
if(NOT nlohmann_json_POPULATED)
  FetchContent_Populate(nlohmann_json)
endif()
if(EXISTS "${nlohmann_json_SOURCE_DIR}/include/nlohmann/json.hpp")
  include_directories("${nlohmann_json_SOURCE_DIR}/include")
endif()

# ── Tests (issue #130) ─────────────────────────────────────────────────────
# Structured like apps/desktop/tests/: tests/CMakeLists.txt owns every
# executable + CTest, including the validator harness and the realtime-safety
# + TSan instrumentation. Single entry point:
#   ctest --test-dir packages/vst3/build --output-on-failure
enable_testing()
add_subdirectory(tests)

# ── VST3 + standalone targets (require iPlug2 + SDKs) ─────────────────────
# SDK check — iPlug2's VST3 SDK is fetched via Dependencies/download scripts, not vendored.
set(VST3_SDK_AVAILABLE OFF)
if(IPLUG2_AVAILABLE AND EXISTS "${iplug2_SOURCE_DIR}/Dependencies/IPlug/VST3_SDK/pluginterfaces/vst/ivstaudioprocessor.h")
  set(VST3_SDK_AVAILABLE ON)
endif()

if(IPLUG2_AVAILABLE AND VST3_SDK_AVAILABLE)
  # VST3 target only for now; CLAP/AU later (issue #125 scope).
  # Editor shell (issue #132) hosts the shared React app via webview — thin
  # bridge like desktop, no IGraphics fork. Primitives (issue #133) reuse the
  # same React primitives via the webview — no IControl fork.
  set(PLUGIN_SOURCES src/plugin.cpp src/automation_params.cpp src/plugin_state.cpp src/presets.cpp src/asset_loading.cpp src/editor.cpp src/primitives.cpp)

  add_library(openaxe_vst3 MODULE ${PLUGIN_SOURCES})
  target_include_directories(openaxe_vst3 PRIVATE src ${CMAKE_CURRENT_SOURCE_DIR} ${iplug2_SOURCE_DIR} ${iplug2_SOURCE_DIR}/IPlug ${iplug2_SOURCE_DIR}/WDL)
  target_link_libraries(openaxe_vst3 PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
  if(TARGET webview)
    target_link_libraries(openaxe_vst3 PRIVATE webview::core)
  endif()
  if(TARGET nlohmann_json)
    target_link_libraries(openaxe_vst3 PRIVATE nlohmann_json::nlohmann_json)
  endif()
  if(TARGET iPlug2)
    target_link_libraries(openaxe_vst3 PRIVATE iPlug2)
  endif()
  target_compile_definitions(openaxe_vst3 PRIVATE VST3_API=1)
  if(APPLE)
    # webview Cocoa backend is Objective-C++ on macOS
    set_source_files_properties(src/editor.cpp PROPERTIES LANGUAGE OBJCXX)
    if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
      target_compile_options(openaxe_vst3 PRIVATE -Wno-auto-var-id)
    endif()
  endif()

  add_executable(openaxe_standalone src/plugin.cpp src/automation_params.cpp src/plugin_state.cpp src/presets.cpp src/asset_loading.cpp src/editor.cpp src/primitives.cpp src/main_standalone.cpp)
  target_include_directories(openaxe_standalone PRIVATE src ${CMAKE_CURRENT_SOURCE_DIR} ${iplug2_SOURCE_DIR} ${iplug2_SOURCE_DIR}/IPlug ${iplug2_SOURCE_DIR}/WDL)
  target_link_libraries(openaxe_standalone PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
  if(TARGET webview)
    target_link_libraries(openaxe_standalone PRIVATE webview::core)
  endif()
  if(TARGET nlohmann_json)
    target_link_libraries(openaxe_standalone PRIVATE nlohmann_json::nlohmann_json)
  endif()
  if(TARGET iPlug2)
    target_link_libraries(openaxe_standalone PRIVATE iPlug2)
  endif()
  target_compile_definitions(openaxe_standalone PRIVATE STANDALONE_APP=1)
  if(APPLE)
    set_source_files_properties(src/editor.cpp PROPERTIES LANGUAGE OBJCXX)
    if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
      target_compile_options(openaxe_standalone PRIVATE -Wno-auto-var-id)
    endif()
  endif()
elseif(IPLUG2_AVAILABLE)
  message(STATUS "packages/vst3: VST3 SDK not found — VST3/standalone targets skipped (smoke test still builds). Run iPlug2 Dependencies/download scripts or: ${iplug2_SOURCE_DIR}/Dependencies/download-iplug-sdks.sh")
else()
  message(STATUS "packages/vst3: iPlug2 not available — VST3/standalone targets skipped (smoke test still builds). Run: git submodule update --init --recursive && cmake -B build")
endif()
