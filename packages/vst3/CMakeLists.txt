cmake_minimum_required(VERSION 3.24)

# issue #54: root VERSION is the one source of truth
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../../VERSION" OPENAXE_VERSION)
string(STRIP "${OPENAXE_VERSION}" OPENAXE_VERSION)

project(openaxe_vst3 VERSION ${OPENAXE_VERSION} LANGUAGES CXX C)

# Version, generated from the root VERSION file so the host's plugin manager,
# the bridge's openAxe.version and the update check can never disagree
# (issue #300 E6 — they were reporting 0.1.0 while VERSION said 0.2.5).
# PLUG_VERSION_HEX is iPlug2's packed 0x00MMmmpp form.
math(EXPR OPENAXE_VERSION_HEX
  "(${PROJECT_VERSION_MAJOR} << 16) + (${PROJECT_VERSION_MINOR} << 8) + ${PROJECT_VERSION_PATCH}"
  OUTPUT_FORMAT HEXADECIMAL)
math(EXPR OPENAXE_VERSION_HEX_DEC
  "(${PROJECT_VERSION_MAJOR} << 16) + (${PROJECT_VERSION_MINOR} << 8) + ${PROJECT_VERSION_PATCH}")
add_compile_definitions(
  OPENAXE_VERSION_STR="${OPENAXE_VERSION}"
  OPENAXE_VERSION_HEX=${OPENAXE_VERSION_HEX})
message(STATUS "packages/vst3: version ${OPENAXE_VERSION} (hex ${OPENAXE_VERSION_HEX})")

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
  # ── Editor availability (decided early: it gates iPlug2's own cmake includes) ──
# The webview editor is an IGraphics control (IWebViewControl), so it can only be
# built where iPlug2's IGraphics has a backend. In the pinned iPlug2 revision that
# means macOS/iOS, Windows and WEB only: IGraphicsPrivate.h defines
# FONT_DESCRIPTOR_TYPE for OS_MAC/OS_IOS/OS_WIN/OS_WEB and leaves the #else branch
# commented "NO_IGRAPHICS". Compiling any IGraphics translation unit elsewhere
# fails outright.
#
# That includes iPlug2's own IGraphics object libraries (IGraphicsFlexBox,
# NanoVG, ...) which Scripts/cmake/IGraphics.cmake defines. They are part of the
# default `all` target, so the include itself has to be skipped — gating only our
# sources still leaves `cmake --build` compiling them.
#
# Where the editor is off the plugin builds headless: DSP, host parameters, state
# chunks, presets and MIDI all work and the host draws its own generic parameter
# UI. Overridable so the headless path can be built and tested anywhere:
#   cmake -S packages/vst3 -B build -DOPENAXE_VST3_EDITOR=OFF
set(_openaxe_igraphics_default OFF)
if(APPLE OR WIN32)
  set(_openaxe_igraphics_default ON)
endif()
option(OPENAXE_VST3_EDITOR "Build the plugin's webview editor (needs iPlug2 IGraphics)"
       ${_openaxe_igraphics_default})
set(OPENAXE_HAS_IGRAPHICS ${OPENAXE_VST3_EDITOR})

FetchContent_GetProperties(iplug2)
  if(NOT iplug2_POPULATED)
    FetchContent_Populate(iplug2)
  endif()
  if(EXISTS "${iplug2_SOURCE_DIR}/IPlug/IPlug_include_in_plug_hdr.h")
    set(IPLUG2_AVAILABLE ON)
    set(IPLUG2_DIR "${iplug2_SOURCE_DIR}" CACHE PATH "iPlug2 root" FORCE)
    # Do not include iPlug2's top-level CMake (it adds Examples/Tests needing SDKs).
    # Include only the core IPlug2 cmake helpers if needed.
  if(EXISTS "${iplug2_SOURCE_DIR}/Scripts/cmake/IPlug.cmake")
    include(${iplug2_SOURCE_DIR}/Scripts/cmake/IPlug.cmake)
  endif()
  if(EXISTS "${iplug2_SOURCE_DIR}/IPlug/IPlug.cmake")
    include(${iplug2_SOURCE_DIR}/IPlug/IPlug.cmake)
  endif()
  if(OPENAXE_HAS_IGRAPHICS AND EXISTS "${iplug2_SOURCE_DIR}/Scripts/cmake/IGraphics.cmake")
    include(${iplug2_SOURCE_DIR}/Scripts/cmake/IGraphics.cmake)
  endif()
  # Fallback defines for standalone plugin CMake (not using IPlugPlugin.cmake's PROJECT_DIR)
  if(NOT DEFINED PROJECT_DIR)
    set(PROJECT_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
  endif()
  if(NOT DEFINED PLUG_RESOURCES_DIR)
    set(PLUG_RESOURCES_DIR "${CMAKE_CURRENT_SOURCE_DIR}/resources")
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
set(OPENAXE_WEBVIEW_SOURCES OFF)
if(EXISTS "${webview_SOURCE_DIR}/webview.h" OR EXISTS "${webview_SOURCE_DIR}/core/include/webview/webview.h")
  set(OPENAXE_WEBVIEW_SOURCES ON)
  if(EXISTS "${webview_SOURCE_DIR}/core/include/webview/webview.h")
    include_directories("${webview_SOURCE_DIR}/core/include")
  else()
    include_directories("${webview_SOURCE_DIR}")
  endif()
endif()

if(OPENAXE_HAS_IGRAPHICS)
  add_compile_definitions(OPENAXE_HAS_IGRAPHICS)
else()
  # Gating our own includes is not enough: iPlug2's IPlugDelegate_select.h
  # includes IGraphicsEditorDelegate.h unless one of COCOA_EDITOR_DELEGATE /
  # WEBVIEW_EDITOR_DELEGATE / NO_IGRAPHICS is defined. NO_IGRAPHICS selects the
  # plain iplug::IEditorDelegate, which is what a headless plugin wants.
  add_compile_definitions(NO_IGRAPHICS)
endif()

set(OPENAXE_ENABLE_WEBVIEW OFF)
if(OPENAXE_WEBVIEW_SOURCES AND OPENAXE_HAS_IGRAPHICS)
  set(OPENAXE_ENABLE_WEBVIEW ON)
  # NOTE: the compile definition and the CMake variable are two different
  # things. add_compile_definitions() only reaches the compiler — guards below
  # must test OPENAXE_ENABLE_WEBVIEW, not OPENAXE_HAS_WEBVIEW, or they evaluate
  # an undefined variable and silently disable the editor's link libraries.
  add_compile_definitions(OPENAXE_HAS_WEBVIEW)
  if(APPLE)
    enable_language(OBJCXX)
  endif()
  message(STATUS "packages/vst3: webview available — editor will use webview shell")
elseif(NOT OPENAXE_WEBVIEW_SOURCES)
  message(STATUS "packages/vst3: webview not available — editor builds as stub (offline)")
else()
  message(STATUS
    "packages/vst3: iPlug2 IGraphics has no backend on this platform — building "
    "the plugin headless (DSP/params/state/MIDI, host-generic UI). The webview "
    "editor needs IGraphics, see the comment above this message.")
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


# ── macOS bundle Info.plists (issue #300 F3) ──────────────────────────────
# Generated from resources/Info.plist.in so the identifiers and version come
# from config.h and the root VERSION file rather than being restated. CMake's
# default plist declared CFBundlePackageType APPL (VST3 and AU require BNDL)
# and left CFBundleIdentifier/Name/Version empty, which auval rejects outright
# and which makes codesigning meaningless.
if(APPLE)
  # AU component type follows iPlug2's own rule
  # (IPlugProcessor::GetAUPluginType, mirrored in Scripts/validate_audiounit.sh):
  # an effect that accepts MIDI in is a music effect 'aumf', not 'aufx'. Getting
  # this wrong is not cosmetic — auval reports "Class Data fields aumf, Nms1,
  # NwSt do not match component description" and fails validation, because the
  # plugin registers one type and the plist advertises another.
  #
  # Parsed out of config.h rather than restated, so flipping PLUG_DOES_MIDI_IN
  # or PLUG_TYPE cannot silently desync the plist from the binary.
  file(READ "${CMAKE_CURRENT_SOURCE_DIR}/config.h" _openaxe_config_h)
  string(REGEX MATCH "#define[ \t]+PLUG_TYPE[ \t]+([0-9]+)" _m "${_openaxe_config_h}")
  set(_plug_type "${CMAKE_MATCH_1}")
  string(REGEX MATCH "#define[ \t]+PLUG_DOES_MIDI_IN[ \t]+([0-9]+)" _m "${_openaxe_config_h}")
  set(_plug_midi_in "${CMAKE_MATCH_1}")
  if(_plug_type STREQUAL "1")
    set(OPENAXE_AU_TYPE "aumu")   # instrument
  elseif(_plug_type STREQUAL "2")
    set(OPENAXE_AU_TYPE "aumi")   # MIDI effect
  elseif(_plug_midi_in STREQUAL "1")
    set(OPENAXE_AU_TYPE "aumf")   # effect that takes MIDI in
  else()
    set(OPENAXE_AU_TYPE "aufx")   # plain effect
  endif()
  message(STATUS "packages/vst3: AU component type ${OPENAXE_AU_TYPE} "
                 "(PLUG_TYPE=${_plug_type}, PLUG_DOES_MIDI_IN=${_plug_midi_in})")

  set(OPENAXE_PLUG_NAME "OpenAxe")
  set(OPENAXE_PLUG_UID "Nms1")   # PLUG_UNIQUE_ID in config.h
  set(OPENAXE_PLUG_MFR_ID "NwSt")  # PLUG_MFR_ID
  set(OPENAXE_COPYRIGHT "Copyright 2026 OpenAxe (GPLv3)")

  # The identifier must match iPlug2's BUNDLE_ID exactly:
  #   BUNDLE_DOMAIN "." BUNDLE_MFR "." API_EXT "." BUNDLE_NAME
  # (IPlug_include_in_plug_hdr.h). IPlugAU::GetProperty looks the bundle up with
  # CFBundleGetBundleWithIdentifier(BUNDLE_ID) when the host asks for the Cocoa
  # UI and passes the result straight to CFBundleCopyBundleURL — so an
  # identifier that does not match returns NULL and segfaults the host. Getting
  # this subtly wrong (omitting BUNDLE_MFR) is what crashed auval at
  # "VERIFYING CUSTOM UI".
  set(OPENAXE_BUNDLE_DOMAIN "com.openaxe")  # BUNDLE_DOMAIN in config.h
  set(OPENAXE_BUNDLE_MFR "OpenAxe")         # BUNDLE_MFR
  function(openaxe_write_plist out_var kind api_ext extra)
    set(OPENAXE_BUNDLE_ID
        "${OPENAXE_BUNDLE_DOMAIN}.${OPENAXE_BUNDLE_MFR}.${api_ext}.${OPENAXE_PLUG_NAME}")
    set(OPENAXE_PLIST_EXTRA "${extra}")
    set(_out "${CMAKE_BINARY_DIR}/generated_plists/${OPENAXE_PLUG_NAME}-${kind}-Info.plist")
    configure_file("${CMAKE_CURRENT_SOURCE_DIR}/resources/Info.plist.in" "${_out}" @ONLY)
    set(${out_var} "${_out}" PARENT_SCOPE)
  endfunction()

  openaxe_write_plist(OPENAXE_VST3_PLIST "VST3" "vst3" "")   # API_EXT for VST3_API
  openaxe_write_plist(OPENAXE_CLAP_PLIST "CLAP" "clap" "")   # API_EXT for CLAP_API

  # The AU needs its AudioComponents registration, or the system never
  # advertises the plugin and auval cannot find it. factoryFunction and
  # NSPrincipalClass must match AUV2_FACTORY / AUV2_VIEW_CLASS_STR in config.h.
  string(CONCAT OPENAXE_AU_EXTRA
    "  <key>AudioComponents</key>\n"
    "  <array>\n"
    "    <dict>\n"
    "      <key>description</key>\n"
    "      <string>Guitar/bass amp + cab + effects powered by Neural Amp Modeler</string>\n"
    "      <key>factoryFunction</key>\n"
    "      <string>OpenAxePlugin_Factory</string>\n"
    "      <key>manufacturer</key>\n"
    "      <string>${OPENAXE_PLUG_MFR_ID}</string>\n"
    "      <key>name</key>\n"
    "      <string>OpenAxe: OpenAxe</string>\n"
    "      <key>sandboxSafe</key>\n"
    "      <true/>\n"
    "      <key>subtype</key>\n"
    "      <string>${OPENAXE_PLUG_UID}</string>\n"
    "      <key>type</key>\n"
    "      <string>${OPENAXE_AU_TYPE}</string>\n"
    "      <key>version</key>\n"
    "      <integer>${OPENAXE_VERSION_HEX_DEC}</integer>\n"
    "    </dict>\n"
    "  </array>\n"
    "  <key>AudioUnit Version</key>\n"
    "  <string>${OPENAXE_VERSION_HEX}</string>\n"
    "  <key>NSPrincipalClass</key>\n"
    "  <string>OpenAxePlugin_View</string>")
  openaxe_write_plist(OPENAXE_AU_PLIST "AU" "audiounit" "${OPENAXE_AU_EXTRA}")  # API_EXT for AU_API
endif()


# A conformant macOS bundle carries Contents/PkgInfo; CMake does not create one
# for a plain MODULE library bundle (issue #300 F3).
function(openaxe_write_pkginfo target)
  if(NOT APPLE OR NOT TARGET ${target})
    return()
  endif()
  set(_pkginfo "${CMAKE_BINARY_DIR}/generated_plists/PkgInfo")
  file(WRITE "${_pkginfo}" "BNDL????")
  add_custom_command(TARGET ${target} POST_BUILD
    COMMAND "${CMAKE_COMMAND}" -E copy "${_pkginfo}"
            "$<TARGET_BUNDLE_CONTENT_DIR:${target}>/PkgInfo"
    COMMENT "${target}: writing Contents/PkgInfo"
    VERBATIM)
endfunction()

# ── Plugin sources (shared across all formats) ───────────────────────
# Editor shell (issue #132) hosts the shared React app via webview — thin
# bridge like desktop, no IGraphics fork. Primitives (issue #133) reuse the
# same React primitives via the webview — no IControl fork. Grid/cables/
# inspector (issue #134) reuses GridEditor/BlockInspector via the same webview.
# src/http_server.cpp uses the Winsock API, which needs an explicit link on
# Windows (apps/desktop already does this for its own copy). Applies to every
# target that compiles it, tests included — the ui_serving test failed to link
# with 11 unresolved __imp_* socket symbols before this.
function(openaxe_link_sockets target)
  if(WIN32 AND TARGET ${target})
    target_link_libraries(${target} PRIVATE ws2_32)
  endif()
endfunction()

set(PLUGIN_SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/../shared/src/secure_storage.cpp ${CMAKE_CURRENT_SOURCE_DIR}/../shared/src/ui_url.cpp ${CMAKE_CURRENT_SOURCE_DIR}/../shared/src/monitor_tap.cpp src/plugin.cpp src/automation_params.cpp src/plugin_state.cpp src/presets.cpp src/asset_loading.cpp src/editor.cpp src/primitives.cpp src/grid_bridge.cpp src/http_server.cpp src/vst_bridge.cpp src/ui_root.cpp src/bridge_polyfill.cpp)

if(IPLUG2_AVAILABLE AND VST3_SDK_AVAILABLE)
  # VST3 target (issue #125) — the first format, always built when SDK present.
  if(EXISTS "${iplug2_SOURCE_DIR}/Scripts/cmake/VST3.cmake")
    include("${iplug2_SOURCE_DIR}/Scripts/cmake/VST3.cmake")
  endif()

  add_library(openaxe_vst3 MODULE ${PLUGIN_SOURCES})
  target_include_directories(openaxe_vst3 PRIVATE src ${CMAKE_CURRENT_SOURCE_DIR} ${iplug2_SOURCE_DIR} ${iplug2_SOURCE_DIR}/IPlug ${iplug2_SOURCE_DIR}/IPlug/VST3 ${iplug2_SOURCE_DIR}/IPlug/Extras/WebView ${iplug2_SOURCE_DIR}/IGraphics ${iplug2_SOURCE_DIR}/IGraphics/Platforms ${iplug2_SOURCE_DIR}/IGraphics/Controls ${iplug2_SOURCE_DIR}/IGraphics/Drawing ${iplug2_SOURCE_DIR}/WDL)
  # VST3 SDK headers for pluginterfaces etc. (iPlug2::VST3 adds them via INTERFACE, but add explicitly for robustness)
  if(EXISTS "${iplug2_SOURCE_DIR}/Dependencies/IPlug/VST3_SDK")
    target_include_directories(openaxe_vst3 PRIVATE ${iplug2_SOURCE_DIR}/Dependencies/IPlug/VST3_SDK ${iplug2_SOURCE_DIR}/Dependencies/IPlug/VST3_SDK/pluginterfaces ${iplug2_SOURCE_DIR}/Dependencies/IPlug/VST3_SDK/base)
  endif()
  target_link_libraries(openaxe_vst3 PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
  if(OPENAXE_HAS_IGRAPHICS AND TARGET iPlug2::IGraphics)
    target_link_libraries(openaxe_vst3 PRIVATE iPlug2::IGraphics)
  endif()
  if(APPLE)
    if(TARGET iPlug2::IGraphics::NanoVG::Metal)
      target_link_libraries(openaxe_vst3 PRIVATE iPlug2::IGraphics::NanoVG::Metal)
    elseif(TARGET iPlug2::IGraphics::Metal)
      target_link_libraries(openaxe_vst3 PRIVATE iPlug2::IGraphics::Metal)
    endif()
  else()
    if(TARGET iPlug2::IGraphics::NanoVG)
      target_link_libraries(openaxe_vst3 PRIVATE iPlug2::IGraphics::NanoVG)
    endif()
  endif()
  if(TARGET iPlug2::VST3)
    target_link_libraries(openaxe_vst3 PRIVATE iPlug2::VST3)
  elseif(TARGET iPlug2)
    target_link_libraries(openaxe_vst3 PRIVATE iPlug2)
  endif()
  if(OPENAXE_ENABLE_WEBVIEW AND TARGET iPlug2::Extras::IWebViewControl)
    target_link_libraries(openaxe_vst3 PRIVATE iPlug2::Extras::IWebViewControl)
  endif()
  if(OPENAXE_ENABLE_WEBVIEW AND TARGET iPlug2_Extras_IWebViewControl_obj)
    target_link_libraries(openaxe_vst3 PRIVATE iPlug2_Extras_IWebViewControl_obj)
  endif()
  if(OPENAXE_ENABLE_WEBVIEW AND TARGET webview)
    target_link_libraries(openaxe_vst3 PRIVATE webview::core)
  endif()
  if(TARGET nlohmann_json)
    target_link_libraries(openaxe_vst3 PRIVATE nlohmann_json::nlohmann_json)
  endif()
  target_compile_definitions(openaxe_vst3 PRIVATE VST3_API=1)
  if(APPLE)
    # webview Cocoa backend is Objective-C++ on macOS
    set_source_files_properties(src/editor.cpp PROPERTIES LANGUAGE OBJCXX)
    if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
      target_compile_options(openaxe_vst3 PRIVATE -Wno-auto-var-id)
    endif()
  endif()
  # Configure bundle layout — use iPlug helper when plist exists, else minimal bundle without plist
  if(COMMAND iplug_configure_vst3 AND EXISTS "${PLUG_RESOURCES_DIR}/OpenAxe-VST3-Info.plist")
    iplug_configure_vst3(openaxe_vst3 OpenAxe)
  else()
    if(APPLE)
      set_target_properties(openaxe_vst3 PROPERTIES
        BUNDLE TRUE
        BUNDLE_EXTENSION "vst3"
        OUTPUT_NAME "OpenAxe"
        PREFIX ""
        LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
        MACOSX_BUNDLE_INFO_PLIST "${OPENAXE_VST3_PLIST}"
      )
      openaxe_write_pkginfo(openaxe_vst3)
      # (The Info.plist is generated above from resources/Info.plist.in and
      # attached via MACOSX_BUNDLE_INFO_PLIST — no template file is expected
      # in PLUG_RESOURCES_DIR.)
    else()
      set_target_properties(openaxe_vst3 PROPERTIES
        OUTPUT_NAME "OpenAxe"
        PREFIX ""
        SUFFIX ".vst3"
      )
    endif()
  endif()

  add_executable(openaxe_standalone src/plugin.cpp src/automation_params.cpp src/plugin_state.cpp src/presets.cpp src/asset_loading.cpp src/editor.cpp src/primitives.cpp src/grid_bridge.cpp src/http_server.cpp src/vst_bridge.cpp src/ui_root.cpp src/bridge_polyfill.cpp ${CMAKE_CURRENT_SOURCE_DIR}/../shared/src/secure_storage.cpp ${CMAKE_CURRENT_SOURCE_DIR}/../shared/src/ui_url.cpp ${CMAKE_CURRENT_SOURCE_DIR}/../shared/src/monitor_tap.cpp src/main_standalone.cpp)
  target_include_directories(openaxe_standalone PRIVATE src ${CMAKE_CURRENT_SOURCE_DIR} ${iplug2_SOURCE_DIR} ${iplug2_SOURCE_DIR}/IPlug ${iplug2_SOURCE_DIR}/IPlug/APP ${iplug2_SOURCE_DIR}/IPlug/Extras/WebView ${iplug2_SOURCE_DIR}/IGraphics ${iplug2_SOURCE_DIR}/IGraphics/Platforms ${iplug2_SOURCE_DIR}/IGraphics/Controls ${iplug2_SOURCE_DIR}/IGraphics/Drawing ${iplug2_SOURCE_DIR}/WDL ${iplug2_SOURCE_DIR}/Dependencies/IGraphics/NanoSVG/src ${iplug2_SOURCE_DIR}/Dependencies/IGraphics/NanoVG/src)
  if(TARGET iPlug2::IGraphics)
    target_link_libraries(openaxe_standalone PRIVATE iPlug2::IGraphics)
  endif()
  if(TARGET iPlug2::IGraphics::NanoVG)
    target_link_libraries(openaxe_standalone PRIVATE iPlug2::IGraphics::NanoVG)
  endif()
  if(OPENAXE_ENABLE_WEBVIEW AND TARGET iPlug2::Extras::IWebViewControl)
    target_link_libraries(openaxe_standalone PRIVATE iPlug2::Extras::IWebViewControl)
  endif()
  if(OPENAXE_ENABLE_WEBVIEW AND TARGET iPlug2_Extras_IWebViewControl_obj)
    target_link_libraries(openaxe_standalone PRIVATE iPlug2_Extras_IWebViewControl_obj)
  endif()
  if(EXISTS "${iplug2_SOURCE_DIR}/Scripts/cmake/APP.cmake")
    include("${iplug2_SOURCE_DIR}/Scripts/cmake/APP.cmake")
  endif()
  if(TARGET iPlug2::APP)
    target_link_libraries(openaxe_standalone PRIVATE iPlug2::APP)
  endif()
  target_link_libraries(openaxe_standalone PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
  if(OPENAXE_ENABLE_WEBVIEW AND TARGET webview)
    target_link_libraries(openaxe_standalone PRIVATE webview::core)
  endif()
  if(TARGET nlohmann_json)
    target_link_libraries(openaxe_standalone PRIVATE nlohmann_json::nlohmann_json)
  endif()
  if(TARGET iPlug2)
    target_link_libraries(openaxe_standalone PRIVATE iPlug2)
  endif()
  target_compile_definitions(openaxe_standalone PRIVATE APP_API=1 STANDALONE_APP=1)
  set_target_properties(openaxe_standalone PROPERTIES EXCLUDE_FROM_ALL TRUE)
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

# ── CLAP target (issue #135) ─────────────────────────────────────────
# VST3 alone leaves out Bitwig (where CLAP is the better citizen). iPlug2
# builds all three formats from one source tree. The plugin's 302 param IDs
# stay stable across formats — AU and CLAP expose the same slot-major IDs
# (2 + (slot-1)*20 + entry) so a lane's meaning never collides across
# formats. `.aupreset`/`.vstpreset` share the same JSON chunk (issue #128).
set(CLAP_SDK_AVAILABLE OFF)
if(IPLUG2_AVAILABLE AND EXISTS "${iplug2_SOURCE_DIR}/Dependencies/IPlug/CLAP_SDK/include/clap/clap.h")
  set(CLAP_SDK_AVAILABLE ON)
endif()
# CLAP dynamic parameters: CLAP can rescan its param list at runtime, so in
# theory the plugin could mirror the rig exactly and skip the fixed slot map.
# Evaluated and rejected as the primary design — it would fork behaviour
# per format (VST3/AU must be static), and the formats we most need are the
# ones whose lists must be static. A CLAP build can still simulate a dynamic
# list cheaply by rescanning after rebinds, but the slot map stays the source
# of truth for all formats (capability flag, not a second implementation).
if(IPLUG2_AVAILABLE AND CLAP_SDK_AVAILABLE)
  add_library(openaxe_clap MODULE ${PLUGIN_SOURCES})
  target_include_directories(openaxe_clap PRIVATE src ${CMAKE_CURRENT_SOURCE_DIR} ${iplug2_SOURCE_DIR} ${iplug2_SOURCE_DIR}/IPlug ${iplug2_SOURCE_DIR}/IPlug/CLAP ${iplug2_SOURCE_DIR}/IPlug/Extras/WebView ${iplug2_SOURCE_DIR}/IGraphics ${iplug2_SOURCE_DIR}/IGraphics/Platforms ${iplug2_SOURCE_DIR}/IGraphics/Controls ${iplug2_SOURCE_DIR}/IGraphics/Drawing ${iplug2_SOURCE_DIR}/WDL ${iplug2_SOURCE_DIR}/Dependencies/IGraphics/NanoSVG/src ${iplug2_SOURCE_DIR}/Dependencies/IGraphics/NanoVG/src)
  if(TARGET iPlug2::IGraphics)
    target_link_libraries(openaxe_clap PRIVATE iPlug2::IGraphics)
  endif()
  if(TARGET iPlug2::IGraphics::NanoVG)
    target_link_libraries(openaxe_clap PRIVATE iPlug2::IGraphics::NanoVG)
  endif()
  if(OPENAXE_ENABLE_WEBVIEW AND TARGET iPlug2::Extras::IWebViewControl)
    target_link_libraries(openaxe_clap PRIVATE iPlug2::Extras::IWebViewControl)
  endif()
  if(OPENAXE_ENABLE_WEBVIEW AND TARGET iPlug2_Extras_IWebViewControl_obj)
    target_link_libraries(openaxe_clap PRIVATE iPlug2_Extras_IWebViewControl_obj)
  endif()
  target_link_libraries(openaxe_clap PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
  if(OPENAXE_ENABLE_WEBVIEW AND TARGET webview)
    target_link_libraries(openaxe_clap PRIVATE webview::core)
  endif()
  if(TARGET nlohmann_json)
    target_link_libraries(openaxe_clap PRIVATE nlohmann_json::nlohmann_json)
  endif()
  if(TARGET iPlug2)
    target_link_libraries(openaxe_clap PRIVATE iPlug2)
  endif()
  if(EXISTS "${iplug2_SOURCE_DIR}/Scripts/cmake/CLAP.cmake")
    include("${iplug2_SOURCE_DIR}/Scripts/cmake/CLAP.cmake")
    if(TARGET iPlug2::CLAP)
      target_link_libraries(openaxe_clap PRIVATE iPlug2::CLAP)
    endif()
    # iplug_configure_clap is deliberately not used: it relocates output to
    # ${CMAKE_BINARY_DIR}/out, which every path in the CI artifact globs, the
    # VS Code tasks and the validator tests would have to follow. We configure
    # the bundle ourselves and supply the same generated plist.
  endif()
  target_compile_definitions(openaxe_clap PRIVATE CLAP_API=1)
  if(APPLE)
    # A real directory bundle, not a bare Mach-O file. The CLAP shipped as a
    # bare file had no Contents/Resources to hold the React UI, so an installed
    # .clap found no index.html and opened an empty editor (issue #300 F3).
    set_target_properties(openaxe_clap PROPERTIES
      BUNDLE TRUE
      BUNDLE_EXTENSION "clap"
      OUTPUT_NAME "OpenAxe"
      PREFIX ""
      LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
      MACOSX_BUNDLE_INFO_PLIST "${OPENAXE_CLAP_PLIST}"
      EXCLUDE_FROM_ALL TRUE
    )
    openaxe_write_pkginfo(openaxe_clap)
  else()
    set_target_properties(openaxe_clap PROPERTIES OUTPUT_NAME "OpenAxe" PREFIX "" SUFFIX ".clap" EXCLUDE_FROM_ALL TRUE)
  endif()
  if(APPLE)
    set_source_files_properties(src/editor.cpp PROPERTIES LANGUAGE OBJCXX)
    if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
      target_compile_options(openaxe_clap PRIVATE -Wno-auto-var-id)
    endif()
  endif()
  message(STATUS "packages/vst3: CLAP target enabled — OpenAxe.clap")
else()
  if(IPLUG2_AVAILABLE)
    message(STATUS "packages/vst3: CLAP SDK not found — CLAP target skipped (run ${iplug2_SOURCE_DIR}/Dependencies/download-iplug-sdks.sh or ${iplug2_SOURCE_DIR}/Dependencies/download-clap-sdks.sh)")
  endif()
endif()

# ── AUv2 target (issue #135, macOS only) ──────────────────────────────
# Logic/GarageBand gate: auval -v aufx Nms1 NwSt must be clean. Same Plugin
# class, same 302 IDs, same chunk — parameter IDs stay stable and don't
# collide across VST3/AU/CLAP. AUv3 (app extension) is out of scope (#17).
if(APPLE AND IPLUG2_AVAILABLE)
  # AU wrapper sources are header-only except the iPlug AU glue; we build
  # the same PLUGIN_SOURCES with AU_API defined and produce a .component
  # bundle. The host loads it via AudioComponentManager, not a plain dlopen.
  add_library(openaxe_au MODULE ${PLUGIN_SOURCES})
  target_include_directories(openaxe_au PRIVATE src ${CMAKE_CURRENT_SOURCE_DIR} ${iplug2_SOURCE_DIR} ${iplug2_SOURCE_DIR}/IPlug ${iplug2_SOURCE_DIR}/IPlug/AUv2 ${iplug2_SOURCE_DIR}/IPlug/Extras/WebView ${iplug2_SOURCE_DIR}/IGraphics ${iplug2_SOURCE_DIR}/IGraphics/Platforms ${iplug2_SOURCE_DIR}/IGraphics/Controls ${iplug2_SOURCE_DIR}/IGraphics/Drawing ${iplug2_SOURCE_DIR}/WDL ${iplug2_SOURCE_DIR}/Dependencies/IGraphics/NanoSVG/src ${iplug2_SOURCE_DIR}/Dependencies/IGraphics/NanoVG/src)
  if(TARGET iPlug2::IGraphics)
    target_link_libraries(openaxe_au PRIVATE iPlug2::IGraphics)
  endif()
  if(TARGET iPlug2::IGraphics::NanoVG)
    target_link_libraries(openaxe_au PRIVATE iPlug2::IGraphics::NanoVG)
  endif()
  if(OPENAXE_ENABLE_WEBVIEW AND TARGET iPlug2::Extras::IWebViewControl)
    target_link_libraries(openaxe_au PRIVATE iPlug2::Extras::IWebViewControl)
  endif()
  if(OPENAXE_ENABLE_WEBVIEW AND TARGET iPlug2_Extras_IWebViewControl_obj)
    target_link_libraries(openaxe_au PRIVATE iPlug2_Extras_IWebViewControl_obj)
  endif()
  target_link_libraries(openaxe_au PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
  if(OPENAXE_ENABLE_WEBVIEW AND TARGET webview)
    target_link_libraries(openaxe_au PRIVATE webview::core)
  endif()
  if(TARGET nlohmann_json)
    target_link_libraries(openaxe_au PRIVATE nlohmann_json::nlohmann_json)
  endif()
  if(TARGET iPlug2)
    target_link_libraries(openaxe_au PRIVATE iPlug2)
  endif()
  if(EXISTS "${iplug2_SOURCE_DIR}/Scripts/cmake/AUv2.cmake")
    include("${iplug2_SOURCE_DIR}/Scripts/cmake/AUv2.cmake")
    if(TARGET iPlug2::AUv2)
      target_link_libraries(openaxe_au PRIVATE iPlug2::AUv2)
    endif()
  endif()
  target_compile_definitions(openaxe_au PRIVATE AU_API=1)
  # Minimal AU bundle — the validator scans bundles, not plain .so.
  # iPlug's own AUv2.cmake would wire a custom Info.plist; we keep the
  # default bundle plist so offline smoke builds don't require that file.
  # Not part of the default `cmake --build` — hosts build it explicitly
  # (`cmake --build --target openaxe_au`) so offline smoke tests stay green.
  set_target_properties(openaxe_au PROPERTIES
    BUNDLE TRUE
    BUNDLE_EXTENSION "component"
    OUTPUT_NAME "OpenAxe"
    PREFIX ""
    MACOSX_BUNDLE_INFO_PLIST "${OPENAXE_AU_PLIST}"
    EXCLUDE_FROM_ALL TRUE
  )
  # Without the AudioComponents dict in this plist the system never advertises
  # the component and auval reports "didn't find the component" (issue #300 F3).
  openaxe_write_pkginfo(openaxe_au)
  # APPL needs Obj-C++ for the AU glue + webview.
  set_source_files_properties(src/editor.cpp PROPERTIES LANGUAGE OBJCXX)
  if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    target_compile_options(openaxe_au PRIVATE -Wno-auto-var-id)
  endif()
  find_library(AUDIOUNIT_FW AudioUnit)
  find_library(AUDIOTOOLBOX_FW AudioToolbox)
  if(AUDIOUNIT_FW)
    target_link_libraries(openaxe_au PRIVATE ${AUDIOUNIT_FW} ${AUDIOTOOLBOX_FW})
  endif()
  message(STATUS "packages/vst3: AUv2 target enabled — OpenAxe.component")
else()
  if(IPLUG2_AVAILABLE AND NOT APPLE)
    message(STATUS "packages/vst3: AUv2 skipped — macOS only")
  endif()
endif()

# ── Packaging (CPack, issue #136) ──────────────────────────────────────
# Produces installers for the three plugin formats, versioned from the root
# VERSION file (like desktop). Artifacts are attached to the tag-triggered
# Release (see plugin.yml) — same flow as desktop's release.yml (#54).
set(CPACK_PACKAGE_NAME "openaxe-plugin")
set(CPACK_PACKAGE_VENDOR "OpenAxe")
set(CPACK_PACKAGE_VERSION "${PROJECT_VERSION}")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "OpenAxe — guitar/bass amp + cab + effects (VST3/CLAP/AU)")
set(CPACK_PACKAGE_FILE_NAME "${CPACK_PACKAGE_NAME}-${CPACK_PACKAGE_VERSION}-${CMAKE_SYSTEM_NAME}")
set(CPACK_PACKAGE_INSTALL_DIRECTORY "openaxe-plugin")
set(CPACK_OUTPUT_FILE_PREFIX "${CMAKE_BINARY_DIR}")

# Shared secret store (issue #300 D4). Same module and same keychain service
# name as apps/desktop, so one Tone3000 login covers the desktop app and the
# plugin instead of each keeping its own copy — the plugin previously held the
# token in a std::map that died with the instance.
foreach(_t openaxe_vst3 openaxe_clap openaxe_au openaxe_standalone)
  openaxe_link_sockets(${_t})
  if(TARGET ${_t})
    target_include_directories(${_t} PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/../shared/include")
    if(APPLE)
      target_link_libraries(${_t} PRIVATE "-framework Security" "-framework CoreFoundation")
    elseif(WIN32)
      target_link_libraries(${_t} PRIVATE credui advapi32)
    endif()
  endif()
endforeach()

# ── Bundle the React UI into every plugin bundle (issue #300 F2) ─────────
# The plugin serves apps/web's build over loopback HTTP (WKWebView sandboxes
# file:// subresources), so the built UI has to physically live inside the
# bundle. Without this step an installed plugin found no index.html and fell
# back to the "UI not found" IGraphics placeholder — it only worked in-tree
# because plugin.cpp used to resolve the UI through __FILE__ (see F1).
#
# The existence check lives in cmake/copy_ui.cmake so it runs at BUILD time,
# not configure time: configuring the plugin before building the web app is
# the normal order, and a configure-time `if(EXISTS)` would silently skip the
# copy forever after. A missing UI is a loud build warning, not a hard error,
# so C++-only CI stays green.
set(OPENAXE_WEB_DIST "${CMAKE_CURRENT_SOURCE_DIR}/../../apps/web/dist")

function(openaxe_bundle_ui target)
  if(NOT TARGET ${target})
    return()
  endif()
  get_target_property(_is_bundle ${target} BUNDLE)
  if(APPLE AND _is_bundle)
    set(_ui_dest "$<TARGET_BUNDLE_CONTENT_DIR:${target}>/Resources/ui")
  else()
    # Bare module (Linux/Windows .vst3/.clap, or a non-bundle build): the
    # resolver also looks for a sibling ui/ directory next to the binary.
    set(_ui_dest "$<TARGET_FILE_DIR:${target}>/ui")
  endif()
  add_custom_command(TARGET ${target} POST_BUILD
    COMMAND "${CMAKE_COMMAND}"
            -DSRC=${OPENAXE_WEB_DIST}
            -DDST=${_ui_dest}
            -DTARGET=${target}
            -P "${CMAKE_CURRENT_SOURCE_DIR}/cmake/copy_ui.cmake"
    COMMENT "${target}: bundling apps/web/dist into Resources/ui"
    VERBATIM)
endfunction()

if(OPENAXE_ENABLE_WEBVIEW)
  foreach(_t openaxe_vst3 openaxe_clap openaxe_au openaxe_standalone)
    openaxe_bundle_ui(${_t})
  endforeach()
else()
  message(STATUS "packages/vst3: headless build — skipping the bundled UI copy")
endif()

# Install the built bundles to standard locations (CPack + workflow's
# productbuild/WIX/DEB generators handle the platform specifics).
if(TARGET openaxe_vst3)
  install(TARGETS openaxe_vst3 LIBRARY DESTINATION "Library/Audio/Plug-Ins/VST3" NAMELINK_SKIP)
  # Also allow manual copy from build dir (what the smoke test + validators use)
endif()
if(TARGET openaxe_clap)
  install(TARGETS openaxe_clap LIBRARY DESTINATION "Library/Audio/Plug-Ins/CLAP" NAMELINK_SKIP)
endif()
if(TARGET openaxe_au)
  install(TARGETS openaxe_au LIBRARY DESTINATION "Library/Audio/Plug-Ins/Components" NAMELINK_SKIP)
endif()
# Fallback tarball always works (even when productbuild/WIX/DEB are missing)
set(CPACK_GENERATOR "TGZ")
if(APPLE)
  list(APPEND CPACK_GENERATOR "productbuild")
elseif(WIN32)
  list(APPEND CPACK_GENERATOR "WIX;ZIP")
else()
  list(APPEND CPACK_GENERATOR "DEB")
  set(CPACK_DEBIAN_PACKAGE_MAINTAINER "OpenAxe <dev@openaxe.local>")
  set(CPACK_DEBIAN_PACKAGE_SECTION "sound")
endif()
include(CPack)
