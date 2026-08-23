cmake_minimum_required(VERSION 3.24)

# issue #54: root VERSION is the one source of truth
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../../VERSION" NAM_STUDIO_VERSION)
string(STRIP "${NAM_STUDIO_VERSION}" NAM_STUDIO_VERSION)

project(nam_studio_vst3 VERSION ${NAM_STUDIO_VERSION} LANGUAGES CXX C)

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

# ── Config header (plugin identity) ──────────────────────────────────────
# config.h is checked in; no generation step.

# ── Core linkage smoke test (always builds) ───────────────────────────────
# This is what makes iteration bearable without a host and what CI can build
# even offline: a tiny executable that links nam_studio_core WHOLE_ARCHIVE and
# exercises the scaffold's contract (graph create/reset/process passthrough).
add_executable(nam_studio_vst3_smoke tests/smoke.cpp)
target_link_libraries(nam_studio_vst3_smoke PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,nam_studio_core>)
target_include_directories(nam_studio_vst3_smoke PRIVATE src ${CMAKE_CURRENT_SOURCE_DIR})

# ── VST3 + standalone targets (require iPlug2 + SDKs) ─────────────────────
# SDK check — iPlug2's VST3 SDK is fetched via Dependencies/download scripts, not vendored.
set(VST3_SDK_AVAILABLE OFF)
if(IPLUG2_AVAILABLE AND EXISTS "${iplug2_SOURCE_DIR}/Dependencies/IPlug/VST3_SDK/pluginterfaces/vst/ivstaudioprocessor.h")
  set(VST3_SDK_AVAILABLE ON)
endif()

if(IPLUG2_AVAILABLE AND VST3_SDK_AVAILABLE)
  # VST3 target only for now; CLAP/AU later (issue #125 scope).
  set(PLUGIN_SOURCES src/plugin.cpp)

  add_library(nam_studio_vst3 MODULE ${PLUGIN_SOURCES})
  target_include_directories(nam_studio_vst3 PRIVATE src ${CMAKE_CURRENT_SOURCE_DIR} ${iplug2_SOURCE_DIR} ${iplug2_SOURCE_DIR}/IPlug ${iplug2_SOURCE_DIR}/WDL)
  target_link_libraries(nam_studio_vst3 PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,nam_studio_core>)
  if(TARGET iPlug2)
    target_link_libraries(nam_studio_vst3 PRIVATE iPlug2)
  endif()
  target_compile_definitions(nam_studio_vst3 PRIVATE VST3_API=1)

  add_executable(nam_studio_standalone src/plugin.cpp src/main_standalone.cpp)
  target_include_directories(nam_studio_standalone PRIVATE src ${CMAKE_CURRENT_SOURCE_DIR} ${iplug2_SOURCE_DIR} ${iplug2_SOURCE_DIR}/IPlug ${iplug2_SOURCE_DIR}/WDL)
  target_link_libraries(nam_studio_standalone PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,nam_studio_core>)
  if(TARGET iPlug2)
    target_link_libraries(nam_studio_standalone PRIVATE iPlug2)
  endif()
  target_compile_definitions(nam_studio_standalone PRIVATE STANDALONE_APP=1)
elseif(IPLUG2_AVAILABLE)
  message(STATUS "packages/vst3: VST3 SDK not found — VST3/standalone targets skipped (smoke test still builds). Run iPlug2 Dependencies/download scripts or: ${iplug2_SOURCE_DIR}/Dependencies/download-iplug-sdks.sh")
else()
  message(STATUS "packages/vst3: iPlug2 not available — VST3/standalone targets skipped (smoke test still builds). Run: git submodule update --init --recursive && cmake -B build")
endif()
