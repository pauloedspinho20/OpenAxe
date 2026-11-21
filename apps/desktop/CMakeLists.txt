cmake_minimum_required(VERSION 3.24)

# issue #54: the root VERSION file is the one source of truth for the
# product's version - every package.json's "version" field is kept in sync
# with it by scripts/sync-version.mjs, and this is what actually names the
# built installer (CPACK_PACKAGE_FILE_NAME below), so reading it here instead
# of a second hardcoded literal is what keeps the artifact filename and the
# app's own version from drifting apart again.
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../../VERSION" OPENAXE_VERSION)
string(STRIP "${OPENAXE_VERSION}" OPENAXE_VERSION)

# miniaudio is compiled as C++ inside audio.cpp (MINIAUDIO_IMPLEMENTATION in
# that TU), so no C language is needed - CXX alone covers core + shell.
project(openaxe_desktop VERSION ${OPENAXE_VERSION} LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Suppress install() rules everywhere (packages/core and FetchContent deps) -
# the app is a self-contained static binary and its layout is staged by a
# dedicated CPack script (see the Packaging section). Must be set before any
# add_subdirectory / FetchContent so no install rules are generated.
set(CMAKE_SKIP_INSTALL_RULES ON)

set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/lib")
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/lib")

# ── Shared C++ DSP core (issue #14) ─────────────────────────────────────
# The audio graph + full extern "C" ABI. Native desktop links the static
# openaxe_core target directly (packages/core/CMakeLists.txt's else
# branch). Topology, DSP, params, meters, NAM model loading all live here;
# this shell only adds the window, the JS bridge and the audio I/O.
add_subdirectory(../../packages/core core)

# ── Native webview shell (webview/webview, MIT) ─────────────────────────
# C++ API is header-only (the backend implementation is inline in
# core/include/webview/webview.h), so only the headers target is needed -
# no shared/static library build. Windows WebView2, macOS WKWebView,
# Linux WebKitGTK, picked automatically by CMake.
set(WEBVIEW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WEBVIEW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WEBVIEW_BUILD_DOCS OFF CACHE BOOL "" FORCE)
set(WEBVIEW_BUILD_SHARED_LIBRARY OFF CACHE BOOL "" FORCE)
set(WEBVIEW_BUILD_STATIC_LIBRARY OFF CACHE BOOL "" FORCE)
include(FetchContent)
FetchContent_Declare(
  webview
  GIT_REPOSITORY https://github.com/webview/webview
  GIT_TAG 0.12.0
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(webview)

# ── Audio I/O (miniaudio 0.11.25, public domain / MIT-0) ─────────────────
# Low-latency duplex audio via miniaudio's own from-scratch per-platform
# backends: CoreAudio (macOS), WASAPI shared (Windows; exclusive opt-in
# later), ALSA + PulseAudio + JACK (Linux, same order miniaudio probes).
# Single C header vendored at third_party/miniaudio/miniaudio.h (no
# FetchContent, no dependencies); MINIAUDIO_IMPLEMENTATION lives in exactly
# one TU (src/audio.cpp). Replaces JUCE juce_audio_devices (AGPLv3/
# commercial - issue #374) and, before that, RtAudio, whose CoreAudio backend
# had a reproducible bug (garbage input pointer during its internal duplex
# bridging - see audio.cpp's Open()).
#
# miniaudio's AAudio backend is the future apps/android answer.

# ── Bridge JSON + native file dialogs (M2) ──────────────────────────────
# nlohmann/json (MIT, header-only): request/response marshalling for the
# window.openAxe bridge. portable-file-dialogs (MIT, single header): native
# open-file picker for NAM model loading (webview 0.12 dropped its dialog
# API). pfd uses AppleScript on macOS / Win32 on Windows / zenity-kdialog on
# Linux, so no extra frameworks to link.
set(JSON_BuildTests OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
  nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json
  GIT_TAG v3.11.3
  GIT_SHALLOW TRUE
)
FetchContent_Declare(
  portable_file_dialogs
  GIT_REPOSITORY https://github.com/samhocevar/portable-file-dialogs
  GIT_TAG 0.1.0
  GIT_SHALLOW TRUE
)
# portable-file-dialogs 0.1.0 still declares cmake_minimum_required(3.1); CMake
# 4.x rejects subprojects whose floor predates the running policies. Lower the
# floor for the fetched deps only (this project itself already requires 3.24).
set(CMAKE_POLICY_VERSION_MINIMUM 3.5)
FetchContent_MakeAvailable(nlohmann_json portable_file_dialogs)

# ── The desktop app ──────────────────────────────────────────────────────
# openaxe_desktop_lib: the app logic (audio I/O now; the JS bridge in M2), built
# independently of the webview so the C++ tests can link it without pulling
# in an Objective-C++ window. openaxe_desktop is the thin WIN32 entry point.
add_library(openaxe_desktop_lib STATIC
  src/audio.cpp
  src/bridge.cpp
  src/latency.cpp
  src/debug_log.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/../../packages/shared/src/secure_storage.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/../../packages/shared/src/app_storage.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/../../packages/shared/src/storage_bridge.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/../../packages/shared/src/ui_url.cpp
)

# Shared with packages/vst3 so both shells hit the same keychain item and one
# Tone3000 login covers desktop and plugin (issue #300 D4). PUBLIC so the
# executable that links this library inherits it too — secure_storage.cpp is
# compiled here, not in the executable.
target_include_directories(openaxe_desktop_lib PUBLIC
  "${CMAKE_CURRENT_SOURCE_DIR}/../../packages/shared/include")

add_executable(openaxe_desktop WIN32 src/main.cpp src/http_server.cpp)

# Windows Explorer icon: compiled into the exe via a resource file (no-op on
# other platforms - .rc sources are MSVC-only).
if(WIN32)
  target_sources(openaxe_desktop PRIVATE packaging/openaxe_desktop.rc)
endif()

target_link_libraries(openaxe_desktop_lib PUBLIC
  $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>
  nlohmann_json::nlohmann_json
  portable_file_dialogs
)
# miniaudio is vendored (third_party/miniaudio/miniaudio.h, header-only with
# MINIAUDIO_IMPLEMENTATION in src/audio.cpp) - only its include dir is needed.
# Nothing outside audio.cpp needs miniaudio symbols.
target_include_directories(openaxe_desktop_lib PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/third_party/miniaudio")
if(UNIX AND NOT APPLE)
  # miniaudio Linux backends (ALSA/Pulse/JACK): pthreads, libm, dlopen.
  target_link_libraries(openaxe_desktop_lib PRIVATE pthread m dl)
endif()
if(WIN32)
  # miniaudio.h pulls in windows.h, whose function-like min/max macros break
  # std::min/std::max on MSVC (error C2589 in audio.cpp). JUCE's CMake setup
  # used to define NOMINMAX for us; now we do it ourselves (audio.cpp has a
  # matching #define guard as belt-and-braces).
  target_compile_definitions(openaxe_desktop_lib PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
endif()
if(APPLE)
  # miniaudio CoreAudio backend frameworks.
  target_link_libraries(openaxe_desktop_lib PRIVATE "-framework CoreAudio" "-framework AudioToolbox")
endif()

if(APPLE)
  # webview's Cocoa backend is Objective-C++; the TU that includes
  # webview.h must compile as OBJCXX on macOS.
  enable_language(OBJCXX)
  set_source_files_properties(src/main.cpp PROPERTIES LANGUAGE OBJCXX)
  # mac_menu.mm is Objective-C++ and only added on Apple: adding it
  # unconditionally breaks the Linux/Windows builds, where OBJCXX is not enabled
  # (issue #300 H1). main.cpp calls InstallMainMenu unconditionally; the header
  # provides a no-op definition off Apple, so no #ifdef at the call site.
  target_sources(openaxe_desktop PRIVATE src/mac_menu.mm)
  target_link_libraries(openaxe_desktop PRIVATE "-framework Cocoa")
  # secure_storage.cpp's macOS branch persists the Tone3000 refresh token in
  # the Keychain (issue #146) - Security.framework is the Keychain Services
  # API, CoreFoundation is its CFString/CFData/CFDictionary plumbing.
  find_library(SECURITY_FRAMEWORK Security REQUIRED)
  find_library(COREFOUNDATION_FRAMEWORK CoreFoundation REQUIRED)
  target_link_libraries(openaxe_desktop_lib PRIVATE ${SECURITY_FRAMEWORK} ${COREFOUNDATION_FRAMEWORK})
elseif(WIN32)
  # secure_storage.cpp's Windows branch persists the Tone3000 refresh token
  # via Credential Manager (wincred.h) - CredWrite/Read/DeleteW live in
  # Advapi32.
  target_link_libraries(openaxe_desktop_lib PRIVATE Advapi32)
endif()

# WHOLE_ARCHIVE: NAM's architecture parsers (LSTM/WaveNet/ConvNet/Linear)
# self-register via static initializers with no symbol anything here calls
# directly, so a plain static-archive link silently drops them. Link
# openaxe_core whole-archive so NAM model loading actually works (see
# packages/core/README.md "A gotcha worth knowing if you extend this").
target_link_libraries(openaxe_desktop PRIVATE
  webview::core
  openaxe_desktop_lib
)
# webview.h (fetched, third-party) declares several locals with `auto` that
# Clang deduces as Objective-C `id` in the OBJCXX translation units that pull
# it in (main.cpp) - every one trips -Wauto-var-id. The library is vendored
# and out of our control, so silence the warning for this target rather than
# patching the fetched header.
if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  target_compile_options(openaxe_desktop PRIVATE -Wno-auto-var-id)
endif()

# http_server.cpp (compiled directly into this target, not openaxe_desktop_lib)
# calls raw Winsock functions on Windows (accept/bind/socket/...) - unlike
# POSIX sockets, those live in a separate import library that must be linked
# explicitly rather than coming for free with libc.
if(WIN32)
  target_link_libraries(openaxe_desktop PRIVATE ws2_32)
endif()

# ── Tests ─────────────────────────────────────────────────────────────────
option(OPENAXE_DESKTOP_BUILD_TESTS "Build the desktop app's C++ tests" OFF)
if(OPENAXE_DESKTOP_BUILD_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()

# ── Packaging (CPack, issue #15 M4) ──────────────────────────────────────
# Unsigned dev artifacts: .dmg (macOS .app), .zip (Windows), .deb (Linux).
# The web UI is bundled into build/ui by scripts/build.mjs before cpack runs.
set(CPACK_PACKAGE_NAME "openaxe-desktop")
set(CPACK_PACKAGE_VENDOR "OpenAxe")
set(CPACK_PACKAGE_VERSION "${PROJECT_VERSION}")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "OpenAxe Desktop - native amp modeler shell")
set(CPACK_PACKAGE_FILE_NAME "${CPACK_PACKAGE_NAME}-${PROJECT_VERSION}")
set(CPACK_PACKAGE_INSTALL_DIRECTORY "openaxe-desktop")
# Keep artifacts in the (gitignored) build dir, not the source tree.
set(CPACK_OUTPUT_FILE_PREFIX "${CMAKE_BINARY_DIR}")

set(OPENAXE_DESKTOP_UI_DIR "${CMAKE_BINARY_DIR}/ui")
if(WIN32)
  # Windows has no -G passed anywhere in this project's build scripts, so
  # CMake defaults to a Visual Studio generator - the one multi-config
  # generator this project actually hits (Makefiles/Ninja on macOS/Linux are
  # single-config). Multi-config generators append a $<CONFIG> subdirectory
  # to the runtime output dir that CMAKE_BUILD_TYPE alone doesn't capture;
  # scripts/build.mjs always keeps -DCMAKE_BUILD_TYPE=<x> and --config <x> in
  # sync, so CMAKE_BUILD_TYPE's cached value is a safe stand-in for it here.
  set(OPENAXE_DESKTOP_BINARY "${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/${CMAKE_BUILD_TYPE}/openaxe_desktop.exe")
else()
  set(OPENAXE_DESKTOP_BINARY "${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/openaxe_desktop")
endif()
set(OPENAXE_DESKTOP_PLIST "${CMAKE_CURRENT_SOURCE_DIR}/packaging/Info.plist")

# GPLv3 (section 4) requires the license to be conveyed with the work, and the
# permissive dependencies require their own notices to travel with the binary.
# licenses/ is generated by scripts/sync-licenses.mjs; stage.cmake copies both
# into every package. See THIRD_PARTY_NOTICES.md.
get_filename_component(OPENAXE_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)

# Stage the app layout into the CPack staging dir (runs in cmake -P mode).
# With CMAKE_SKIP_INSTALL_RULES set, the generated top-level install target
# tries to include subproject install files that no longer exist, so tell CPack
# not to run any project's install target at all - the stage script is the only
# thing that populates the package.
configure_file("${CMAKE_CURRENT_SOURCE_DIR}/packaging/stage.cmake.in"
               "${CMAKE_BINARY_DIR}/stage.cmake" @ONLY)
set(CPACK_INSTALL_SCRIPT "${CMAKE_BINARY_DIR}/stage.cmake")
set(CPACK_INSTALL_CMAKE_PROJECTS "")

if(APPLE)
  set(CPACK_GENERATOR "DragNDrop")
  set(CPACK_DMG_VOLUME_NAME "OpenAxe")
elseif(WIN32)
  set(CPACK_GENERATOR "ZIP")
else()
  set(CPACK_GENERATOR "DEB")
  set(CPACK_DEBIAN_PACKAGE_MAINTAINER "OpenAxe <dev@openaxe.local>")
  set(CPACK_DEBIAN_PACKAGE_SECTION "sound")
  set(CPACK_DEBIAN_PACKAGE_DEPENDS "libwebkit2gtk-4.1-0, libasound2, libpulse0")
endif()

include(CPack)