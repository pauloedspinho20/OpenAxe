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
add_test(NAME bridge COMMAND bridge_test)

add_executable(latency_test latency_test.cpp)
target_include_directories(latency_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../src)
target_link_libraries(latency_test PRIVATE
  nam_desktop_lib
)
add_test(NAME latency COMMAND latency_test)