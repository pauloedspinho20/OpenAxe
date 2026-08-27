#pragma once
// Dummy resource.h for standalone build — iPlug2's IPlugAPP_dialog.cpp expects this
// when building the APP target outside the full IPlug example structure.
// The full resource.h is normally generated from config.h + resources, but for
// the minimal standalone (which just runs the DSP without a complex dialog)
// an empty header is sufficient to satisfy the include.
#define IDD_DIALOG1 101
