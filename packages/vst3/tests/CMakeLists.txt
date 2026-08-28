# packages/vst3/tests — issue #130
# Mirrors apps/desktop/tests/: each CTest is a standalone executable that
# links openaxe_core WHOLE_ARCHIVE and exercises a contract without needing a
# host or the iPlug2 SDK. Validators (pluginval, VST3 validator, auval,
# clap-validator) are wired as additional CTest targets that skip gracefully
# when the external tool or the built bundle is absent — `ctest --test-dir
# packages/vst3/build --output-on-failure` always runs locally (CI is
# disabled repo-wide, per AGENTS.md).

# ── Unit / integration tests (no host, no SDK) ──────────────────────────────

add_executable(openaxe_vst3_smoke smoke.cpp)
target_link_libraries(openaxe_vst3_smoke PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
target_include_directories(openaxe_vst3_smoke PRIVATE ../src ${CMAKE_CURRENT_SOURCE_DIR}/..)
add_test(NAME vst3_smoke COMMAND openaxe_vst3_smoke)

add_executable(openaxe_vst3_latency_test latency_test.cpp)
target_link_libraries(openaxe_vst3_latency_test PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
target_include_directories(openaxe_vst3_latency_test PRIVATE ../src ${CMAKE_CURRENT_SOURCE_DIR}/..)
add_test(NAME vst3_latency COMMAND openaxe_vst3_latency_test)

add_executable(openaxe_vst3_suspend_test suspend_test.cpp)
target_link_libraries(openaxe_vst3_suspend_test PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
target_include_directories(openaxe_vst3_suspend_test PRIVATE ../src ${CMAKE_CURRENT_SOURCE_DIR}/..)
add_test(NAME vst3_suspend COMMAND openaxe_vst3_suspend_test)

add_executable(openaxe_vst3_param_surface_test param_surface_test.cpp ../src/automation_params.cpp)
target_link_libraries(openaxe_vst3_param_surface_test PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
target_include_directories(openaxe_vst3_param_surface_test PRIVATE ../src ${CMAKE_CURRENT_SOURCE_DIR}/..)
add_test(NAME vst3_param_surface COMMAND openaxe_vst3_param_surface_test)

add_executable(openaxe_vst3_state_test state_test.cpp ../src/plugin_state.cpp ../src/presets.cpp)
target_link_libraries(openaxe_vst3_state_test PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
target_include_directories(openaxe_vst3_state_test PRIVATE ../src ${CMAKE_CURRENT_SOURCE_DIR}/..)
add_test(NAME vst3_state COMMAND openaxe_vst3_state_test)

add_executable(openaxe_vst3_asset_test asset_loading_test.cpp ../src/asset_loading.cpp)
target_link_libraries(openaxe_vst3_asset_test PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
target_include_directories(openaxe_vst3_asset_test PRIVATE ../src ${CMAKE_CURRENT_SOURCE_DIR}/..)
add_test(NAME vst3_asset COMMAND openaxe_vst3_asset_test)

# Real-time safety: must not allocate/lock/syscall on the audio thread (#43/#53).
add_executable(openaxe_vst3_realtime_safety_test realtime_safety_test.cpp)
target_link_libraries(openaxe_vst3_realtime_safety_test PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
target_include_directories(openaxe_vst3_realtime_safety_test PRIVATE ../src ${CMAKE_CURRENT_SOURCE_DIR}/..)
add_test(NAME vst3_realtime_safety COMMAND openaxe_vst3_realtime_safety_test)

# Editor shell — webview hosting the shared React app (#132)
add_executable(openaxe_vst3_editor_test editor_test.cpp ../src/editor.cpp
  ../../shared/src/ui_url.cpp)
target_link_libraries(openaxe_vst3_editor_test PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
target_include_directories(openaxe_vst3_editor_test PRIVATE ../src ${CMAKE_CURRENT_SOURCE_DIR}/.. ${CMAKE_CURRENT_SOURCE_DIR}/../../shared/include)
add_test(NAME vst3_editor COMMAND openaxe_vst3_editor_test)

# Shared React primitives — no IControl fork (#133)
add_executable(openaxe_vst3_primitives_test primitives_test.cpp ../src/primitives.cpp ../src/automation_params.cpp ../src/editor.cpp
  ../../shared/src/ui_url.cpp)
target_link_libraries(openaxe_vst3_primitives_test PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
target_include_directories(openaxe_vst3_primitives_test PRIVATE ../src ${CMAKE_CURRENT_SOURCE_DIR}/.. ${CMAKE_CURRENT_SOURCE_DIR}/../../shared/include)
add_test(NAME vst3_primitives COMMAND openaxe_vst3_primitives_test)

# Block grid, cables, and block inspector — shared React via webview (#134)
add_executable(openaxe_vst3_grid_test grid_test.cpp ../src/grid_bridge.cpp ../src/editor.cpp
  ../../shared/src/ui_url.cpp)
target_link_libraries(openaxe_vst3_grid_test PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
target_include_directories(openaxe_vst3_grid_test PRIVATE ../src ${CMAKE_CURRENT_SOURCE_DIR}/.. ${CMAKE_CURRENT_SOURCE_DIR}/../../shared/include)
add_test(NAME vst3_grid COMMAND openaxe_vst3_grid_test)

# MIDI mapping — host event bus forwarding to core (issue #124)
# UI serving: bridge polyfill contract, HTML head injection, path containment,
# bundle UI-root resolution (issue #300 A/F/G). SDK-free by design — none of
# these TUs pull in iPlug or the webview.
add_executable(openaxe_vst3_ui_serving_test ui_serving_test.cpp
  ../src/http_server.cpp ../src/ui_root.cpp ../src/bridge_polyfill.cpp
  ../../shared/src/ui_url.cpp)
target_include_directories(openaxe_vst3_ui_serving_test PRIVATE ../src ${CMAKE_CURRENT_SOURCE_DIR}/.. ${CMAKE_CURRENT_SOURCE_DIR}/../../shared/include)
# http_server.cpp calls into Winsock; MSVC needs the import library named.
if(WIN32)
  target_link_libraries(openaxe_vst3_ui_serving_test PRIVATE ws2_32)
endif()
add_test(NAME vst3_ui_serving COMMAND openaxe_vst3_ui_serving_test)

# Monitor tap ring + seqlock (issue #300 E4c). No SDK, no graph — just the
# concurrency contract between the audio thread and the UI thread.
add_executable(openaxe_vst3_monitor_tap_test monitor_tap_test.cpp
  ../../shared/src/monitor_tap.cpp)
target_include_directories(openaxe_vst3_monitor_tap_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/../../shared/include)
find_package(Threads REQUIRED)
target_link_libraries(openaxe_vst3_monitor_tap_test PRIVATE Threads::Threads)
add_test(NAME vst3_monitor_tap COMMAND openaxe_vst3_monitor_tap_test)

add_executable(openaxe_vst3_midi_test midi_test.cpp)
target_link_libraries(openaxe_vst3_midi_test PRIVATE $<LINK_LIBRARY:WHOLE_ARCHIVE,openaxe_core>)
target_include_directories(openaxe_vst3_midi_test PRIVATE ../src ${CMAKE_CURRENT_SOURCE_DIR}/..)
add_test(NAME vst3_midi COMMAND openaxe_vst3_midi_test)

# ── ThreadSanitizer over the concurrent suspend stress (issue #130) ─────────
# Mirrors apps/desktop/tests/CMakeLists.txt's NAM_DESKTOP_ENABLE_TSAN shape.
# Run: cmake -S packages/vst3 -B packages/vst3/build -DOPENAXE_VST3_ENABLE_TSAN=ON
# TSan is Linux GCC/Clang only; Apple's Clang on arm64 ships no libclang_rt.tsan.
option(OPENAXE_VST3_ENABLE_TSAN "Instrument core/tests with ThreadSanitizer" OFF)
if(OPENAXE_VST3_ENABLE_TSAN)
  message(STATUS "vst3: TSan enabled — instrumenting core + vst3 tests")
  target_compile_options(openaxe_core PRIVATE -fsanitize=thread -g)
  add_compile_options(-fsanitize=thread -g)
  add_link_options(-fsanitize=thread)
endif()

# Optional RealtimeSanitizer for the realtime test (Clang 18+).
# Run: cmake -S packages/vst3 -B packages/vst3/build -DOPENAXE_VST3_ENABLE_RTSAN=ON
option(OPENAXE_VST3_ENABLE_RTSAN "Instrument realtime test with RealtimeSanitizer" OFF)
if(OPENAXE_VST3_ENABLE_RTSAN)
  include(CheckCXXCompilerFlag)
  check_cxx_compiler_flag("-fsanitize=realtime" HAS_RTSAN)
  if(HAS_RTSAN)
    target_compile_options(openaxe_vst3_realtime_safety_test PRIVATE -fsanitize=realtime -g)
    target_link_options(openaxe_vst3_realtime_safety_test PRIVATE -fsanitize=realtime)
    message(STATUS "vst3: RealtimeSanitizer enabled for vst3_realtime_safety")
  else()
    message(WARNING "OPENAXE_VST3_ENABLE_RTSAN=ON but compiler lacks -fsanitize=realtime")
  endif()
endif()

# ── Validators (external tools — skip if missing) ──────────────────────────
# Each validator is a separate CTest that passes with a SKIP message when the
# tool or the built bundle is absent, so the offline `ctest` harness stays
# green. Host-side scanning otherwise requires a built .vst3/.component.

find_program(PLUGINVAL_BIN pluginval)
if(PLUGINVAL_BIN)
  message(STATUS "vst3: pluginval found at ${PLUGINVAL_BIN} — vst3_pluginval will validate the bundle")
else()
  message(STATUS "vst3: pluginval not found — vst3_pluginval will SKIP (brew install pluginval / build Tracktion/pluginval)")
endif()

# pluginval strictness 10 for VST3 (and AU on macOS when bundle exists).
# Bundle path depends on generator; try common locations under the build dir.
add_test(NAME vst3_pluginval
  COMMAND bash -c "PV=\"${PLUGINVAL_BIN}\"; if [ -z \"\$PV\" ] || [ ! -x \"\$PV\" ]; then PV=\"\$(command -v pluginval 2>/dev/null)\"; fi; if [ -z \"\$PV\" ]; then echo 'SKIP: pluginval not found (https://github.com/Tracktion/pluginval) — install and re-run ctest'; exit 0; fi; VST3=''; for p in \"${CMAKE_BINARY_DIR}/OpenAxe.vst3\" \"${CMAKE_BINARY_DIR}/Release/OpenAxe.vst3\" \"${CMAKE_BINARY_DIR}/Debug/OpenAxe.vst3\" \"${CMAKE_BINARY_DIR}/openaxe_vst3.vst3\" \"${CMAKE_BINARY_DIR}/Release/openaxe_vst3.vst3\"; do if [ -e \"\$p\" ]; then VST3=\"\$p\"; break; fi; done; if [ -z \"\$VST3\" ]; then echo 'SKIP: VST3 bundle not built yet (cmake --build packages/vst3/build) — nothing to validate'; exit 0; fi; echo \"\$PV --strictness-level 10 --validate \$VST3\"; exec \"\$PV\" --strictness-level 10 --validate \"\$VST3\""
)

add_test(NAME vst3_pluginval_au
  COMMAND bash -c "if [ \"$(uname)\" != \"Darwin\" ]; then echo 'SKIP: AU validation only on macOS'; exit 0; fi; if ! command -v pluginval >/dev/null 2>&1; then echo 'SKIP: pluginval not found'; exit 0; fi; AU=''; for p in \"${CMAKE_BINARY_DIR}/OpenAxe.component\" \"${CMAKE_BINARY_DIR}/Release/OpenAxe.component\"; do if [ -e \"\$p\" ]; then AU=\"\$p\"; break; fi; done; if [ -z \"\$AU\" ]; then echo 'SKIP: AU bundle not built — nothing to validate'; exit 0; fi; echo \"pluginval --strictness-level 10 --validate \$AU\"; exec pluginval --strictness-level 10 --validate \"\$AU\""
)

find_program(VST3_VALIDATOR_BIN validator)
add_test(NAME vst3_vst3_validator
  COMMAND bash -c "VALIDATOR=''; if command -v validator >/dev/null 2>&1; then VALIDATOR=$(command -v validator); fi; if [ -z \"\$VALIDATOR\" ] && [ -n \"\$VST3_SDK_DIR\" ] && [ -x \"\$VST3_SDK_DIR/bin/validator\" ]; then VALIDATOR=\"\$VST3_SDK_DIR/bin/validator\"; fi; if [ -z \"\$VALIDATOR\" ]; then echo 'SKIP: Steinberg validator not found (build VST3 SDK or set VST3_SDK_DIR)'; exit 0; fi; VST3=''; for p in \"${CMAKE_BINARY_DIR}/OpenAxe.vst3\" \"${CMAKE_BINARY_DIR}/Release/OpenAxe.vst3\" \"${CMAKE_BINARY_DIR}/openaxe_vst3.vst3\"; do if [ -e \"\$p\" ]; then VST3=\"\$p\"; break; fi; done; if [ -z \"\$VST3\" ]; then echo 'SKIP: VST3 bundle not built — nothing to validate'; exit 0; fi; echo \"validator \$VST3\"; exec \"\$VALIDATOR\" \"\$VST3\""
)

add_test(NAME vst3_auval
  COMMAND bash -c "if [ \"$(uname)\" != \"Darwin\" ]; then echo 'SKIP: auval only on macOS'; exit 0; fi; if ! command -v auval >/dev/null 2>&1; then echo 'SKIP: auval not found (Xcode command line tools)'; exit 0; fi; echo 'auval -v aumf Nms1 NwSt (expects AU installed in ~/Library/Audio/Plug-Ins/Components/ or /Library/Audio/Plug-Ins/Components/)'; if ! auval -v aumf Nms1 NwSt 2>&1; then echo 'SKIP: AU not installed in system plug-in dir — copy OpenAxe.component there and re-run'; exit 0; fi"
)

find_program(CLAP_VALIDATOR_BIN clap-validator)
add_test(NAME vst3_clap_validator
  COMMAND bash -c "if ! command -v clap-validator >/dev/null 2>&1; then echo 'SKIP: clap-validator not found (https://github.com/free-audio/clap-validator)'; exit 0; fi; CLAP=''; for p in \"${CMAKE_BINARY_DIR}/OpenAxe.clap\" \"${CMAKE_BINARY_DIR}/Release/OpenAxe.clap\" \"${CMAKE_BINARY_DIR}/openaxe.clap\"; do if [ -e \"\$p\" ]; then CLAP=\"\$p\"; break; fi; done; if [ -z \"\$CLAP\" ]; then echo 'SKIP: CLAP bundle not built yet (CLAP target planned) — nothing to validate'; exit 0; fi; echo \"clap-validator validate \$CLAP\"; exec clap-validator validate \"\$CLAP\""
)

# The validators shell out to real hosts/tools and are slow — pluginval at
# strictness 10 takes ~13 minutes. They used to be free because they silently
# skipped (the test probed PATH while CMake found the binary inside
# /Applications/*.app), so nothing had to opt out of them. Now that they really
# run, label them so routine runs can exclude them:
#   ctest --test-dir packages/vst3/build -LE validator   # fast, ~1s
#   ctest --test-dir packages/vst3/build -L validator    # just the validators
set_tests_properties(vst3_pluginval vst3_pluginval_au vst3_vst3_validator vst3_auval vst3_clap_validator
  PROPERTIES LABELS "validator" TIMEOUT 1800)
