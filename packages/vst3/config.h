#pragma once

// packages/vst3/config.h — plugin identity and I/O (issue #125)
// Unique IDs generated for NAM Web Studio — do not change; hosts persist them.

#define PLUG_NAME "OpenAxe"
#define PLUG_MFR "OpenAxe"
// Generated from the root VERSION file by CMake (issue #300 E6). The fallbacks
// only apply to builds that compile this header without the project's CMake.
#ifdef OPENAXE_VERSION_HEX
#define PLUG_VERSION_HEX OPENAXE_VERSION_HEX
#else
#define PLUG_VERSION_HEX 0x00000000
#endif
#ifdef OPENAXE_VERSION_STR
#define PLUG_VERSION_STR OPENAXE_VERSION_STR
#else
#define PLUG_VERSION_STR "0.0.0-dev"
#endif
#define PLUG_UNIQUE_ID 'Nms1'  // Registered to this project; must stay stable
#define PLUG_MFR_ID 'NwSt'
#define PLUG_URL_STR "https://github.com/pauloedspinho20/OpenAxe"
#define PLUG_EMAIL_STR "dev@openaxe.local"
#define PLUG_COPYRIGHT_STR "Copyright 2026 OpenAxe (GPLv3)"
#define PLUG_CLASS_NAME OpenAxePlugin

#define BUNDLE_NAME "OpenAxe"
#define BUNDLE_MFR "OpenAxe"
#define BUNDLE_DOMAIN "com.openaxe"

#define SHARED_RESOURCES_SUBPATH "OpenAxe"

// Stereo in/out — the graph itself is stereo; mono hosts are bridged by the engine.
#define PLUG_CHANNEL_IO "1-1 2-2"

#define PLUG_LATENCY 0
#define PLUG_TYPE 0
#define PLUG_DOES_MIDI_IN 1
#define PLUG_DOES_MIDI_OUT 0
#define PLUG_DOES_MPE 0
#define PLUG_DOES_STATE_CHUNKS 1
#define PLUG_HAS_UI 1
#define PLUG_WIDTH 1100
#define PLUG_HEIGHT 720
#define PLUG_FPS 60
#define PLUG_SHARED_RESOURCES 0
// Host-driven resizing (issue #300 B1). With this at 0 the host never offered
// a resize grip and never called back with a new size, so the React UI was
// pinned at PLUG_WIDTH x PLUG_HEIGHT forever. The minimums below are the
// narrowest the grid UI lays out at without horizontal scrolling; they are
// also what editor.h's ClampSize enforces, so keep the two in step.
#define PLUG_HOST_RESIZE 1
#define PLUG_MIN_WIDTH 720
#define PLUG_MIN_HEIGHT 520
#define PLUG_MAX_WIDTH 3840
#define PLUG_MAX_HEIGHT 2400

#define AUV2_ENTRY OpenAxePlugin_Entry
#define AUV2_ENTRY_STR "OpenAxePlugin_Entry"
#define AUV2_FACTORY OpenAxePlugin_Factory
#define AUV2_VIEW_CLASS OpenAxePlugin_View
#define AUV2_VIEW_CLASS_STR "OpenAxePlugin_View"

#define AAX_TYPE_IDS 'NMS1', 'NMS2'
#define AAX_TYPE_IDS_AUDIOSUITE 'NMA1', 'NMA2'
#define AAX_PLUG_MFR_STR "OpenAxe"
#define AAX_PLUG_NAME_STR "OpenAxe\nNms1"
#define AAX_PLUG_CATEGORY_STR "Effect"
#define AAX_DOES_AUDIOSUITE 1

#define VST3_SUBCATEGORY "Fx|Amp"

#define CLAP_MANUAL_URL "https://github.com/pauloedspinho20/OpenAxe"
#define CLAP_SUPPORT_URL "https://github.com/pauloedspinho20/OpenAxe/issues"
#define CLAP_DESCRIPTION "Guitar/bass amp + cab + effects powered by Neural Amp Modeler"
#define CLAP_FEATURES "audio-effect", "amp"

#define APP_NUM_CHANNELS 2
#define APP_N_VECTOR_WAIT 0
#define APP_MULT 1
#define APP_COPY_AUV3 0
#define APP_SIGNAL_VECTOR_SIZE 64

#define ROBOTO_FN "Roboto-Regular.ttf"
