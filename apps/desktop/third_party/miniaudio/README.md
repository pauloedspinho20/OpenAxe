# third_party/miniaudio

Vendored single-header audio backend for `apps/desktop` (issue #374).

- **Upstream:** https://github.com/mackron/miniaudio
- **Version:** 0.11.25 (2026-03-04, commit `9634bed`)
- **File:** `miniaudio.h` (single header, ~4 MB)
- **License:** public domain / MIT-0 (see the license block at the end of
  `miniaudio.h` and `THIRD_PARTY_NOTICES.md`)
- **Usage:** `src/audio.cpp` defines `MINIAUDIO_IMPLEMENTATION` in exactly one
  TU and includes this header; `src/audio.h` only forward-declares
  `struct ma_context` / `struct ma_device` so tests build without the full
  header. No FetchContent, no dependencies, no system packages to install.

To upgrade: download the new `miniaudio.h` from the upstream release tag,
replace this file, update the version above + the CMake comment in
`apps/desktop/CMakeLists.txt` + the `THIRD_PARTY_NOTICES.md` row, rebuild the
desktop target and run
`ctest --test-dir apps/desktop/build --output-on-failure`.
