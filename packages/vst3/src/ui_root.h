#pragma once

// Locating the bundled React UI (issue #300 F1/F2).
//
// The plugin serves apps/web's build over loopback HTTP because WKWebView
// sandboxes file:// subresources. That means it has to find the built UI on
// disk at runtime, from inside a shared library that a host dlopen'd from a
// path we don't control.
//
// The previous implementation walked up from `__FILE__`, which resolved to the
// developer's own source checkout — it worked on the build machine and nowhere
// else, and it baked that absolute path into every shipped binary. We instead
// ask the dynamic loader where *this* code was loaded from and look for the
// bundle's Resources directory relative to it.
//
// Kept SDK-free (no iPlug, no webview) so CTest can exercise the layout logic
// offline.

#include <string>
#include <vector>

namespace openaxe_vst3 {

// Candidate UI roots relative to the loaded plugin binary at `binary_path`,
// most-specific first. Exposed for tests; callers want FindBundledUiRoot.
//
// Handles the bundle layouts we ship:
//   macOS VST3/CLAP/AU  <name>.vst3/Contents/MacOS/<bin>        -> ../Resources/ui
//   Linux VST3          <name>.vst3/Contents/x86_64-linux/<bin> -> ../../Resources/ui
//   Windows VST3        <name>.vst3/Contents/x86_64-win/<bin>   -> ../../Resources/ui
//   bare module         <dir>/<bin>.clap                        -> <dir>/ui
//
// Rather than special-casing each triplet it walks up looking for a directory
// named "Contents", which covers all three bundle forms and any future one.
std::vector<std::string> UiRootCandidates(const std::string& binary_path);

// Absolute path to the directory holding index.html, or "" when none is found.
// Order: OPENAXE_UI_DIR override (development), then the candidates above.
std::string FindBundledUiRoot();

// Path of the shared library / executable containing this function, as
// reported by the dynamic loader. Empty when unavailable.
std::string ThisBinaryPath();

}  // namespace openaxe_vst3
