#pragma once

// macOS main menu bar (issue #300 H1/H2).
//
// webview.h creates an NSWindow and an NSApplication but never an NSMenu, and
// the shell didn't add one either. The obvious symptom is cosmetic — no app
// menu, and Cmd+Q doesn't quit — but the expensive one isn't: AppKit routes
// Cut / Copy / Paste / Select All / Undo through the *Edit menu's* key
// equivalents, so with no Edit menu those shortcuts are dead in every text
// field in the app (preset names, the Tone3000 token field).
//
// It also fixes the dead-end webview.h leaves behind: its app delegate answers
// applicationShouldTerminateAfterLastWindowClosed: with NO, so closing the
// window used to leave a running process with no window, no menu and no way to
// quit short of Force Quit. A real Quit item is the fix.
//
// No-op on non-Apple platforms so callers don't need their own #ifdef. The
// implementation lives in mac_menu.mm, which CMake only compiles on Apple
// (OBJCXX is not enabled elsewhere) — hence the inline no-op below rather than
// a second translation unit.

namespace openaxe_desktop {

#ifdef __APPLE__
// Installs the standard main menu (App / Edit / Window / Help) on the shared
// NSApplication. Call once from the main thread before the webview's run loop
// starts. Safe to call more than once — a second call replaces the menu.
void InstallMainMenu(const char* app_name);
#else
inline void InstallMainMenu(const char*) {}
#endif

}  // namespace openaxe_desktop
