# Tests for the desktop audio I/O layer. The callback tests are deterministic
# (fake buffers, no hardware); the open/start/stop test skips on hosts without
# audio devices so it stays green in headless CI.
add_executable(audio_io_test audio_io_test.cpp)
target_include_directories(audio_io_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../src)
target_link_libraries(audio_io_test PRIVATE
  openaxe_desktop_lib
)
add_test(NAME audio_io COMMAND audio_io_test)

add_executable(bridge_test bridge_test.cpp)
target_include_directories(bridge_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../src)
target_link_libraries(bridge_test PRIVATE
  openaxe_desktop_lib
)
add_test(NAME bridge COMMAND bridge_test)

add_executable(latency_test latency_test.cpp)
target_include_directories(latency_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../src)
target_link_libraries(latency_test PRIVATE
  openaxe_desktop_lib
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
  openaxe_desktop_lib
)
add_test(NAME teardown_race COMMAND teardown_race_test)
