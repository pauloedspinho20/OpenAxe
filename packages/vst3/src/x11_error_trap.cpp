#include "x11_error_trap.h"

#include <gdk/gdkx.h>

namespace openaxe_vst3 {

ScopedX11ErrorTrap::ScopedX11ErrorTrap() {
  // Only an already-open display: this must not be what initialises GTK
  // (iPlug2's OpenWebView does that, after gtk_disable_setlocale()).
  GdkDisplay* display = gdk_display_get_default();
  if (display && GDK_IS_X11_DISPLAY(display)) {
    gdk_x11_display_error_trap_push(display);
    display_ = display;
  }
}

ScopedX11ErrorTrap::~ScopedX11ErrorTrap() {
  if (display_) gdk_x11_display_error_trap_pop_ignored(static_cast<GdkDisplay*>(display_));
}

}  // namespace openaxe_vst3
