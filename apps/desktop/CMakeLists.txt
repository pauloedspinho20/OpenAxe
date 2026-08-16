cmake_minimum_required(VERSION 3.24)
project(nam_studio_desktop VERSION 0.1.0 LANGUAGES CXX)

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
# nam_studio_core target directly (packages/core/CMakeLists.txt's else
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

# ── Audio I/O (RtAudio 6.0.1, MIT) ───────────────────────────────────────
# Low-latency cross-platform audio: CoreAudio (macOS), WASAPI/ASIO (Windows),
# ALSA/JACK (Linux). Static so the app ships self-contained. Tests and the
# Python bindings are disabled; ASIO stays OFF by default (gated per the M1
# plan - it needs the Steinberg SDK at configure time).
set(RTAUDIO_BUILD_STATIC_LIBS ON CACHE BOOL "" FORCE)
set(RTAUDIO_BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(RTAUDIO_BUILD_PYTHON OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
  rtaudio
  GIT_REPOSITORY https://github.com/thestk/rtaudio
  GIT_TAG 6.0.1
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(rtaudio)

# ── Bridge JSON + native file dialogs (M2) ──────────────────────────────
# nlohmann/json (MIT, header-only): request/response marshalling for the
# window.namStudio bridge. portable-file-dialogs (MIT, single header): native
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
# nam_desktop_lib: the app logic (audio I/O now; the JS bridge in M2), built
# independently of the webview so the C++ tests can link it without pulling
# in an Objective-C++ window. nam_desktop is the thin WIN32 entry point.
add_library(nam_desktop_lib STATIC src/audio.cpp src/bridge.cpp src/latency.cpp src/debug_log.cpp)

add_executable(nam_desktop WIN32 src/main.cpp src/http_server.cpp)

target_link_libraries(nam_desktop_lib PUBLIC
  $<LINK_LIBRARY:WHOLE_ARCHIVE,nam_studio_core>
  rtaudio
  nlohmann_json::nlohmann_json
  portable_file_dialogs
)

if(APPLE)
  # webview's Cocoa backend is Objective-C++; the TU that includes
  # webview.h must compile as OBJCXX on macOS.
  enable_language(OBJCXX)
  set_source_files_properties(src/main.cpp PROPERTIES LANGUAGE OBJCXX)
endif()

# WHOLE_ARCHIVE: NAM's architecture parsers (LSTM/WaveNet/ConvNet/Linear)
# self-register via static initializers with no symbol anything here calls
# directly, so a plain static-archive link silently drops them. Link
# nam_studio_core whole-archive so NAM model loading actually works (see
# packages/core/README.md "A gotcha worth knowing if you extend this").
target_link_libraries(nam_desktop PRIVATE
  webview::core
  nam_desktop_lib
)

# ── Tests ─────────────────────────────────────────────────────────────────
option(NAM_DESKTOP_BUILD_TESTS "Build the desktop app's C++ tests" OFF)
if(NAM_DESKTOP_BUILD_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()

# ── Packaging (CPack, issue #15 M4) ──────────────────────────────────────
# Unsigned dev artifacts: .dmg (macOS .app), .zip (Windows), .deb (Linux).
# The web UI is bundled into build/ui by scripts/build.mjs before cpack runs.
set(CPACK_PACKAGE_NAME "nam-studio-desktop")
set(CPACK_PACKAGE_VENDOR "NAM Web Studio")
set(CPACK_PACKAGE_VERSION "${PROJECT_VERSION}")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "NAM Web Studio Desktop - native amp modeler shell")
set(CPACK_PACKAGE_FILE_NAME "${CPACK_PACKAGE_NAME}-${PROJECT_VERSION}")
set(CPACK_PACKAGE_INSTALL_DIRECTORY "nam-studio-desktop")
# Keep artifacts in the (gitignored) build dir, not the source tree.
set(CPACK_OUTPUT_FILE_PREFIX "${CMAKE_BINARY_DIR}")

set(NAM_DESKTOP_UI_DIR "${CMAKE_BINARY_DIR}/ui")
if(WIN32)
  set(NAM_DESKTOP_BINARY "${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/nam_desktop.exe")
else()
  set(NAM_DESKTOP_BINARY "${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/nam_desktop")
endif()
set(NAM_DESKTOP_PLIST "${CMAKE_CURRENT_SOURCE_DIR}/packaging/Info.plist")

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
  set(CPACK_DMG_VOLUME_NAME "NAM Web Studio")
elseif(WIN32)
  set(CPACK_GENERATOR "ZIP")
else()
  set(CPACK_GENERATOR "DEB")
  set(CPACK_DEBIAN_PACKAGE_MAINTAINER "NAM Web Studio <dev@namwebstudio.local>")
  set(CPACK_DEBIAN_PACKAGE_SECTION "sound")
  set(CPACK_DEBIAN_PACKAGE_DEPENDS "libwebkit2gtk-4.1-0, libasound2, libpulse0")
endif()

include(CPack)