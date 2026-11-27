#pragma once

// Scoped GDK X11 error trap for the Linux editor (plugin.cpp).
//
// iPlug2's Linux webview embeds a GtkPlug in the host's X11 window. When a
// host destroys that parent before (or while) closing the editor, X destroys
// our plug window with it, and the requests GTK then makes against it fail
// with BadWindow. GDK's default X error handler turns that into a process
// abort - the host goes down on editor close. Reproduced with pluginval's
// Editor test (request_code 12, ConfigureWindow); it is timing-dependent, and
// GDK_SYNCHRONIZE=1 hides it.
//
// While a trap is alive, X errors on GDK's display are recorded instead of
// fatal; the destructor syncs the connection and discards them, so errors from
// requests made inside the scope can't arrive later and abort then.
//
// Its own translation unit on purpose: <gdk/gdkx.h> pulls in Xlib, whose
// global `KeyCode` collides with iPlug2's in any file that includes both.
// No-op where there is no X11 GDK display.

namespace openaxe_vst3 {

class ScopedX11ErrorTrap {
 public:
  ScopedX11ErrorTrap();
  ~ScopedX11ErrorTrap();
  ScopedX11ErrorTrap(const ScopedX11ErrorTrap&) = delete;
  ScopedX11ErrorTrap& operator=(const ScopedX11ErrorTrap&) = delete;

 private:
  void* display_ = nullptr;  // GdkDisplay*, if one existed when the trap was set
};

}  // namespace openaxe_vst3
