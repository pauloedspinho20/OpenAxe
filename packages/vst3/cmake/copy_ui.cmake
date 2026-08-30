# Copies the built React UI into a plugin bundle, checked at BUILD time.
#
# Run via `cmake -DSRC=... -DDST=... -DTARGET=... -P copy_ui.cmake`.
#
# The check has to happen here rather than in an `if(EXISTS)` around the
# add_custom_command: that would be evaluated at configure time, so the very
# common order — configure the plugin, then build the web app, then build the
# plugin — would silently produce a bundle with no UI and no warning
# (issue #300 F2).

if(NOT DEFINED SRC OR NOT DEFINED DST)
  message(FATAL_ERROR "copy_ui.cmake requires -DSRC and -DDST")
endif()

if(NOT EXISTS "${SRC}/index.html")
  message(WARNING
    "${TARGET}: no UI at ${SRC} — the bundle will show the \"UI not found\" "
    "placeholder instead of the React app.\n"
    "   Fix: pnpm --filter @openaxe/web build   (then rebuild this target)")
  return()
endif()

# Skip when the bundled copy is already current. This runs on every build (see
# the always-out-of-date target in CMakeLists.txt), so an unconditional
# directory copy would be wasted work on most builds.
set(_stale TRUE)
if(EXISTS "${DST}/index.html")
  file(TIMESTAMP "${SRC}/index.html" _src_ts "%Y%m%d%H%M%S")
  file(TIMESTAMP "${DST}/index.html" _dst_ts "%Y%m%d%H%M%S")
  if(NOT _src_ts STRGREATER _dst_ts)
    set(_stale FALSE)
  endif()
endif()

if(_stale)
  file(REMOVE_RECURSE "${DST}")
  file(COPY "${SRC}/" DESTINATION "${DST}")
  message(STATUS "${TARGET}: bundled UI from ${SRC}")
endif()
