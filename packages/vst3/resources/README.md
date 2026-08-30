# SWELL resources for the standalone app

`main.rc` and its two generated companions come from iPlug2's own example
projects (`Examples/IPlugVisualizer/resources`), with the example's name
replaced by ours throughout — the window caption in particular, which is what
the title bar shows. They are the
stock iPlug2 APP scaffolding: the host window (`IDD_DIALOG_MAIN`) that
IGraphics — and in our case the webview editor — attaches into, the audio/MIDI
preferences dialog (`IDD_DIALOG_PREF`), and the app menu.

They live here rather than being referenced inside `build/_deps` because
`IPlug/APP/IPlugAPP_main.cpp` includes them by the literal relative path
`"resources/main.rc_mac_dlg"`, resolved against the _project's_ include
directories. Every iPlug2 project is expected to supply this directory; ours
did not, which is half of why the standalone target did not build (issue #300
F5).

`main.rc` is the Windows-format source. The `.rc_mac_dlg` / `.rc_mac_menu`
files are what SWELL actually compiles on macOS, generated from it by
iPlug2's `swell_resgen.php`. They are committed pre-generated, exactly as
iPlug2's own examples commit them, so building needs no PHP. Regenerate both
if `main.rc` is ever edited.

The dialog IDs these reference are defined in `../src/resource.h`.
