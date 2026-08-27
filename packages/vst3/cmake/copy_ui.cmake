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

file(REMOVE_RECURSE "${DST}")
file(COPY "${SRC}/" DESTINATION "${DST}")
message(STATUS "${TARGET}: bundled UI from ${SRC}")
