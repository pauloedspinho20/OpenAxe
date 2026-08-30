#pragma once
// Resource IDs for the standalone app (issue #300 F5).
//
// iPlug2's APP target compiles IPlugAPP_main.cpp / IPlugAPP_dialog.cpp against
// the *project's* resource.h, and those files reference this whole set by
// name: the host window and preferences dialog, the app menu, and every
// control inside the audio/MIDI preferences panel. This header used to define
// only IDD_DIALOG1, above a comment claiming an empty header was "sufficient
// to satisfy the include" — it was not, and the standalone target failed to
// compile with two dozen "use of undeclared identifier IDC_COMBO_*" errors.
//
// The values match iPlug2's own example projects, and must match the dialog
// and menu resources in ../resources/main.rc, which were taken from the same
// place. The plugin targets include this header too; nothing here collides
// with anything they use.

#define IDR_ACCELERATOR1                40000
#define IDD_DIALOG_MAIN                 40001
#define IDD_DIALOG_PREF                 40002
#define IDI_ICON1                       40003
#define IDR_MENU1                       40004
#define ID_ABOUT                        40005
#define ID_PREFERENCES                  40006
#define ID_QUIT                         40007
#define ID_HELP                         40008
#define IDC_COMBO_AUDIO_DRIVER          40009
#define IDC_COMBO_AUDIO_IN_DEV          40010
#define IDC_COMBO_AUDIO_OUT_DEV         40011
#define IDC_COMBO_AUDIO_BUF_SIZE        40012
#define IDC_COMBO_AUDIO_SR              40013
#define IDC_COMBO_AUDIO_IN_L            40014
#define IDC_COMBO_AUDIO_IN_R            40015
#define IDC_COMBO_AUDIO_OUT_R           40016
#define IDC_COMBO_AUDIO_OUT_L           40017
#define IDC_COMBO_MIDI_IN_DEV           40018
#define IDC_COMBO_MIDI_OUT_DEV          40019
#define IDC_COMBO_MIDI_IN_CHAN          40020
#define IDC_COMBO_MIDI_OUT_CHAN         40021
#define IDC_BUTTON_OS_DEV_SETTINGS      40022
#define IDC_CB_MONO_INPUT               40023
#define IDAPPLY                         40024
#define ID_LIVE_EDIT                    40025
#define ID_SHOW_DRAWN                   40026
#define ID_SHOW_FPS                     40027
#define ID_SHOW_BOUNDS                  40028
#define ID_SCREENSHOT                   40029
