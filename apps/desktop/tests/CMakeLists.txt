# Tests for the desktop audio I/O layer. The callback tests are deterministic
# (fake buffers, no hardware); the open/start/stop test skips on hosts without
# audio devices so it stays green in headless CI.
add_executable(audio_io_test audio_io_test.cpp)
target_include_directories(audio_io_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../src)
target_link_libraries(audio_io_test PRIVATE
  nam_desktop_lib
)
add_test(NAME audio_io COMMAND audio_io_test)

add_executable(bridge_test bridge_test.cpp)
target_include_directories(bridge_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../src)
target_link_libraries(bridge_test PRIVATE
  nam_desktop_lib
)
# bridge_test's TestSlimSizeMutationsWhileStreamRunning loads a genuinely
# slimmable NAM capture so SetSlimSize actually rebuilds NAMCore's buffers
# under the stress (issue #211) - point it at the same example models the core
# tests use.
target_compile_definitions(bridge_test PRIVATE
  NAM_CORE_EXAMPLE_MODELS_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../../../packages/core/third_party/nam-core/example_models"
)
add_test(NAME bridge COMMAND bridge_test)

# ThreadSanitizer build for the threading stress tests (issue #211's acceptance
# criterion: mutate-during-process must pass under TSan). Instruments the core,
# the desktop lib, and the test binaries - NOT JUCE/webview (a TSan build of
# those is slow and they aren't what the stress tests exercise; mixing
# instrumented and uninstrumented code is fine for the races under test). The
# device-gated stress tests skip on hosts without a duplex audio device, so a
# TSan run needs one to be meaningful. Requires a toolchain that ships a TSan
# runtime - Linux GCC/Clang yes; Apple's Clang on macOS links no
# libclang_rt.tsan for arm64, so this is for Linux CI.
option(NAM_DESKTOP_ENABLE_TSAN "Instrument core/lib/tests with ThreadSanitizer" OFF)
if(NAM_DESKTOP_ENABLE_TSAN)
  target_compile_options(nam_studio_core PRIVATE -fsanitize=thread -g)
  target_compile_options(nam_desktop_lib PRIVATE -fsanitize=thread -g)
  add_compile_options(-fsanitize=thread -g)
  add_link_options(-fsanitize=thread)
endif()

add_executable(latency_test latency_test.cpp)
target_include_directories(latency_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../src)
target_link_libraries(latency_test PRIVATE
  nam_desktop_lib
)
add_test(NAME latency COMMAND latency_test)

# Regression test for the exit-time SIGABRT: a poll thread calls into AudioIO
# (getTap, like the React UI's ~50ms poll) and must never touch RtCallbackState
# after it is destroyed. The test asserts the correct contract - the poller is
# joined before the AudioIO destructs - so a stray accessor after teardown
# (the original bug) trips AddressSanitizer's use-after-free here.
add_executable(teardown_race_test teardown_race_test.cpp)
target_include_directories(teardown_race_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../src)
target_link_libraries(teardown_race_test PRIVATE
  nam_desktop_lib
)
add_test(NAME teardown_race COMMAND teardown_race_test)
